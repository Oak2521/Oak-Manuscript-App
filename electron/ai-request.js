"use strict";

const { randomUUID } = require("node:crypto");
const { AIProviderError } = require("./ai-provider");

const PLAN_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_PLANS = 8;
const REVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_REVIEWS = 8;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_SUGGESTION_BYTES = 32 * 1024;
const PLAN_ID_RE = /^ai-plan-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REVIEW_ID_RE = /^ai-review-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const CONTEXT_KEYS = Object.freeze(["schema_version", "context_type", "binding", "request_content"]);
const BINDING_KEYS = Object.freeze([
  "issue_id", "check_id", "working_sha256", "rulepack_manifest_sha256",
]);
const CONTENT_KEYS = Object.freeze([
  "rule_id", "severity", "title", "explanation", "location", "preview",
  "standard_refs", "status",
]);
const RESULT_KEYS = Object.freeze(["text"]);
const SYSTEM_INSTRUCTION =
  "你是稿件规范审阅助手。只根据用户明确发送的单条问题上下文给出建议；不得声称已修改稿件，不得把建议冒充确定性规则结论。上下文不足时必须明确说明。";
const DEFAULT_USER_INSTRUCTION = "请解释这个问题，并给出尽量保持原意的修订建议。";

class AIRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AIRequestError";
    this.code = code;
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} 必须是对象`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} 字段集合非法`);
  }
  return value;
}

function text(value, label, { min = 1, max = 4096, allowEmpty = false } = {}) {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && value.length < min) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} 非法`);
  }
  return value;
}

function opaqueId(value, label) {
  if (typeof value !== "string" || !OPAQUE_ID_RE.test(value)) throw new TypeError(`${label} 非法`);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validateAIContext(input) {
  const context = exactKeys(input, CONTEXT_KEYS, "AI 上下文");
  if (context.schema_version !== "1.0" ||
      context.context_type !== "oak_manuscript_issue_suggestion") {
    throw new TypeError("AI 上下文版本非法");
  }
  const binding = exactKeys(context.binding, BINDING_KEYS, "AI 上下文绑定");
  opaqueId(binding.issue_id, "binding.issue_id");
  opaqueId(binding.check_id, "binding.check_id");
  if (!SHA256_RE.test(binding.working_sha256) ||
      !SHA256_RE.test(binding.rulepack_manifest_sha256)) {
    throw new TypeError("AI 上下文摘要非法");
  }
  const content = exactKeys(context.request_content, CONTENT_KEYS, "AI 发送内容");
  opaqueId(content.rule_id, "request_content.rule_id");
  if (!["error", "warning", "suggestion"].includes(content.severity) ||
      !["open", "accepted", "rejected", "resolved"].includes(content.status)) {
    throw new TypeError("AI 问题枚举非法");
  }
  text(content.title, "request_content.title", { max: 512 });
  text(content.explanation, "request_content.explanation", { max: 16_384 });
  text(content.location, "request_content.location", { max: 256 });
  text(content.preview, "request_content.preview", { max: 2_048, allowEmpty: true });
  if (!Array.isArray(content.standard_refs) || content.standard_refs.length > 16) {
    throw new TypeError("request_content.standard_refs 非法");
  }
  for (const ref of content.standard_refs) text(ref, "standard_ref", { max: 512 });
  return context;
}

function normalizeInstruction(value) {
  if (value === undefined || value === null) return DEFAULT_USER_INSTRUCTION;
  if (typeof value !== "string") throw new TypeError("AI 附加要求非法");
  if (value.trim() === "") return DEFAULT_USER_INSTRUCTION;
  text(value, "AI 附加要求", { max: 2_000 });
  return value.trim();
}

function transportSupports(transport, binding) {
  if (!transport || typeof transport.supports !== "function" ||
      typeof transport.request !== "function") return false;
  try { return transport.supports(binding) === true; } catch { return false; }
}

function safeNow(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) {
    throw new TypeError("AI 请求时钟非法");
  }
  return value;
}

class AIRequestCoordinator {
  constructor({ aiProvider, licenseProvider, contextSource, reviewSink, transport = null,
    now = () => Date.now(), idFactory = () => `ai-plan-${randomUUID()}`,
    reviewIdFactory = () => `ai-review-${randomUUID()}` } = {}) {
    if (!aiProvider || typeof aiProvider.requestBinding !== "function" ||
        typeof aiProvider.withRequestCredential !== "function" ||
        !licenseProvider || typeof licenseProvider.status !== "function" ||
        typeof contextSource !== "function" || typeof reviewSink !== "function" ||
        typeof now !== "function" || typeof idFactory !== "function" ||
        typeof reviewIdFactory !== "function") {
      throw new TypeError("AI 请求协调器依赖非法");
    }
    this.aiProvider = aiProvider;
    this.licenseProvider = licenseProvider;
    this.contextSource = contextSource;
    this.reviewSink = reviewSink;
    this.transport = transport;
    this.now = now;
    this.idFactory = idFactory;
    this.reviewIdFactory = reviewIdFactory;
    this.plans = new Map();
    this.reviews = new Map();
  }

  clear() {
    this.plans.clear();
    this.reviews.clear();
  }

  _prune(nowMs) {
    for (const [id, plan] of this.plans) {
      if (plan.expiresMs <= nowMs) this.plans.delete(id);
    }
    while (this.plans.size >= MAX_PENDING_PLANS) {
      this.plans.delete(this.plans.keys().next().value);
    }
  }

  _pruneReviews(nowMs) {
    for (const [id, review] of this.reviews) {
      if (review.expiresMs <= nowMs) this.reviews.delete(id);
    }
    while (this.reviews.size >= MAX_PENDING_REVIEWS) {
      this.reviews.delete(this.reviews.keys().next().value);
    }
  }

  async planIssueSuggestion({ project, issueId, instruction } = {}) {
    text(project, "project", { max: 32_768 });
    opaqueId(issueId, "issueId");
    const userInstruction = normalizeInstruction(instruction);
    const license = this.licenseProvider.status();
    const providerBinding = this.aiProvider.requestBinding(license);
    const context = validateAIContext(await this.contextSource(project, issueId));
    if (context.binding.issue_id !== issueId) {
      throw new AIRequestError("CONTEXT_MISMATCH", "AI 上下文与所选问题不一致");
    }
    const request = {
      system_instruction: SYSTEM_INSTRUCTION,
      user_instruction: userInstruction,
      issue_context: context.request_content,
    };
    if (Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_REQUEST_BYTES) {
      throw new AIRequestError("REQUEST_TOO_LARGE", "AI 发送预览超过本地安全上限");
    }
    const nowMs = safeNow(this.now);
    this._prune(nowMs);
    const planId = this.idFactory();
    if (typeof planId !== "string" || !PLAN_ID_RE.test(planId) || this.plans.has(planId)) {
      throw new TypeError("AI 计划 ID 非法或重复");
    }
    const status = this.aiProvider.status(license);
    const publicPlan = deepFreeze({
      schema_version: "1.0",
      plan_id: planId,
      purpose: "issue_suggestion",
      created_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + PLAN_TTL_MS).toISOString(),
      destination: {
        mode: providerBinding.mode,
        provider: providerBinding.provider,
        provider_label: status.provider_label || "湖岸 AI",
        model: providerBinding.model,
        base_url: providerBinding.base_url,
      },
      request,
      disclosure: {
        sends: [
          "当前单条问题的规则编号、严重级别、标题、解释、位置、原文预览、标准引用和状态",
          "您在预览前填写的附加要求",
        ],
        does_not_send: [
          "完整稿件或其他问题", "文件名和本地路径", "项目、检查或湖岸账号标识",
          "原稿/工作稿哈希、同步记录或本机 AI 凭据",
        ],
      },
      transport_available: transportSupports(this.transport, providerBinding),
      output_policy: "suggestion_only",
      automatic_writeback: false,
    });
    this.plans.set(planId, {
      expiresMs: nowMs + PLAN_TTL_MS,
      project,
      issueId,
      context,
      providerBinding,
      request,
      publicPlan,
    });
    return publicPlan;
  }

  async confirmSuggestion(planId) {
    if (typeof planId !== "string" || !PLAN_ID_RE.test(planId)) {
      throw new TypeError("AI 计划 ID 非法");
    }
    const plan = this.plans.get(planId);
    this.plans.delete(planId);
    const nowMs = safeNow(this.now);
    if (!plan || plan.expiresMs <= nowMs) {
      throw new AIRequestError("AI_PLAN_STALE", "AI 发送预览已过期或已使用；请重新预览");
    }
    const currentContext = validateAIContext(await this.contextSource(plan.project, plan.issueId));
    if (canonical(currentContext) !== canonical(plan.context)) {
      throw new AIRequestError("AI_PLAN_STALE", "稿件问题或检查状态已变化；请重新预览发送内容");
    }
    if (!transportSupports(this.transport, plan.providerBinding)) {
      throw new AIRequestError("TRANSPORT_UNAVAILABLE", "模型 transport 尚未配置；没有发送任何内容");
    }
    let raw;
    try {
      raw = await this.aiProvider.withRequestCredential(
        plan.providerBinding,
        this.licenseProvider.status(),
        async (configuration) => {
          try {
            return await this.transport.request({ configuration, request: plan.request });
          } catch {
            throw new AIRequestError(
              "MODEL_REQUEST_FAILED", "AI 请求失败；没有修改稿件或配置",
            );
          }
        },
      );
    } catch (error) {
      if (error instanceof AIProviderError || error instanceof AIRequestError) throw error;
      throw new AIRequestError("MODEL_REQUEST_FAILED", "AI 请求失败；没有修改稿件或配置");
    }
    const result = exactKeys(raw, RESULT_KEYS, "AI transport 结果");
    text(result.text, "AI 建议", { max: MAX_SUGGESTION_BYTES });
    if (Buffer.byteLength(result.text, "utf8") > MAX_SUGGESTION_BYTES) {
      throw new AIRequestError("RESPONSE_TOO_LARGE", "AI 响应超过本地安全上限");
    }
    const completedAt = safeNow(this.now);
    this._pruneReviews(completedAt);
    const reviewId = this.reviewIdFactory();
    if (typeof reviewId !== "string" || !REVIEW_ID_RE.test(reviewId) ||
        this.reviews.has(reviewId)) {
      throw new TypeError("AI 审阅 ID 非法或重复");
    }
    const suggestion = deepFreeze({
      schema_version: "1.0",
      suggestion_id: randomUUID(),
      review_id: reviewId,
      created_at: new Date(completedAt).toISOString(),
      expires_at: new Date(completedAt + REVIEW_TTL_MS).toISOString(),
      provider_label: plan.publicPlan.destination.provider_label,
      model: plan.publicPlan.destination.model,
      text: result.text,
      output_policy: "suggestion_only",
      automatic_writeback: false,
      persistence: "memory_only",
      review_state: "pending",
    });
    this.reviews.set(reviewId, {
      expiresMs: completedAt + REVIEW_TTL_MS,
      project: plan.project,
      issueId: plan.issueId,
      context: plan.context,
      suggestion,
    });
    return suggestion;
  }

  async reviewSuggestion(reviewId, decision) {
    if (typeof reviewId !== "string" || !REVIEW_ID_RE.test(reviewId)) {
      throw new TypeError("AI 审阅 ID 非法");
    }
    if (!new Set(["accepted", "rejected"]).has(decision)) {
      throw new TypeError("AI 审阅决定非法");
    }
    const review = this.reviews.get(reviewId);
    this.reviews.delete(reviewId);
    const nowMs = safeNow(this.now);
    if (!review || review.expiresMs <= nowMs) {
      throw new AIRequestError("AI_REVIEW_STALE", "AI 建议审阅已过期或已处理");
    }
    if (decision === "accepted") {
      const currentContext = validateAIContext(
        await this.contextSource(review.project, review.issueId),
      );
      if (canonical(currentContext) !== canonical(review.context)) {
        throw new AIRequestError("AI_REVIEW_STALE", "稿件问题或检查状态已变化；不能采纳旧建议");
      }
      try {
        await this.reviewSink({
          project: review.project,
          issueId: review.issueId,
          status: "accepted",
        });
      } catch {
        throw new AIRequestError(
          "AI_REVIEW_FAILED", "AI 建议采纳记录失败；没有修改稿件",
        );
      }
    }
    return deepFreeze({
      schema_version: "1.0",
      review_id: reviewId,
      decision,
      issue_status: decision === "accepted" ? "accepted" : "unchanged",
      manuscript_modified: false,
      suggestion_persisted: false,
    });
  }

  cancelSuggestion(planId) {
    if (typeof planId !== "string" || !PLAN_ID_RE.test(planId)) {
      throw new TypeError("AI 计划 ID 非法");
    }
    this.plans.delete(planId);
    return Object.freeze({ canceled: true });
  }
}

module.exports = {
  AIRequestCoordinator,
  AIRequestError,
  DEFAULT_USER_INSTRUCTION,
  MAX_PENDING_PLANS,
  MAX_PENDING_REVIEWS,
  MAX_REQUEST_BYTES,
  MAX_SUGGESTION_BYTES,
  PLAN_TTL_MS,
  REVIEW_TTL_MS,
  SYSTEM_INSTRUCTION,
  validateAIContext,
};
