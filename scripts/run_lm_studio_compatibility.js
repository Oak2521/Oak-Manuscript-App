"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const { BoundedAIHttpClient } = require("../electron/ai-http-client");
const { createOpenAICompatibleAdapters } = require("../electron/ai-openai-compatible-adapter");
const { AIProvider } = require("../electron/ai-provider");
const { AIRequestCoordinator } = require("../electron/ai-request");
const { AITransportRouter } = require("../electron/ai-transport-router");
const {
  evaluateSuggestionQuality,
  readValidationFixture,
  syntheticContext,
  writeEvidence,
} = require("./run_ollama_compatibility");

const PRO = Object.freeze({ effectiveTier: "pro" });
const ISSUE_ID = "check-0001-0001";
const PROJECT = "C:\\oak-manuscript-validation\\synthetic-project";
const DIGEST_RE = /^[0-9a-f]{64}$/u;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/u;
const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(REPO_ROOT, "out", "external-validation", "lm-studio");

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

function insideOutputRoot(value, label) {
  if (typeof value !== "string" || value.length < 1) throw new TypeError(`${label}非法`);
  const resolved = path.resolve(value);
  if (resolved !== OUTPUT_ROOT && !resolved.startsWith(`${OUTPUT_ROOT}${path.sep}`)) {
    throw new TypeError(`${label}必须位于仓库 out/external-validation/lm-studio`);
  }
  return resolved;
}

function parseArgs(argv) {
  const values = Object.create(null);
  const allowed = new Set([
    "--base-url", "--model", "--expected-version", "--expected-binary-sha256",
    "--expected-model-sha256", "--expected-model-size", "--llmster-path",
    "--model-path", "--evidence",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || value === undefined || value.startsWith("--") ||
        Object.hasOwn(values, name)) {
      throw new TypeError("LM Studio 验收参数非法");
    }
    values[name] = value;
  }
  return validateOptions({
    baseUrl: values["--base-url"],
    model: values["--model"],
    expectedVersion: values["--expected-version"],
    expectedBinarySha256: values["--expected-binary-sha256"],
    expectedModelSha256: values["--expected-model-sha256"],
    expectedModelSize: Number(values["--expected-model-size"]),
    llmsterPath: values["--llmster-path"],
    modelPath: values["--model-path"],
    evidencePath: values["--evidence"],
  });
}

function validateOptions(input) {
  const value = exactKeys(input, [
    "baseUrl", "model", "expectedVersion", "expectedBinarySha256",
    "expectedModelSha256", "expectedModelSize", "llmsterPath", "modelPath",
    "evidencePath",
  ], "LM Studio 验收配置");
  let endpoint;
  try { endpoint = new URL(value.baseUrl); } catch { throw new TypeError("base URL 非法"); }
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" ||
      endpoint.pathname.replace(/\/+$/u, "") !== "/v1" || endpoint.search || endpoint.hash ||
      endpoint.username || endpoint.password || !endpoint.port) {
    throw new TypeError("真实 LM Studio 验收仅允许 127.0.0.1 独立端口的 /v1");
  }
  if (!MODEL_RE.test(value.model) || !VERSION_RE.test(value.expectedVersion) ||
      !DIGEST_RE.test(value.expectedBinarySha256) ||
      !DIGEST_RE.test(value.expectedModelSha256) ||
      !Number.isSafeInteger(value.expectedModelSize) || value.expectedModelSize < 1) {
    throw new TypeError("LM Studio 版本、模型或摘要非法");
  }
  return Object.freeze({
    baseUrl: endpoint.toString().replace(/\/$/u, ""),
    origin: endpoint.origin,
    model: value.model,
    expectedVersion: value.expectedVersion,
    expectedBinarySha256: value.expectedBinarySha256,
    expectedModelSha256: value.expectedModelSha256,
    expectedModelSize: value.expectedModelSize,
    llmsterPath: insideOutputRoot(value.llmsterPath, "llmster 路径"),
    modelPath: insideOutputRoot(value.modelPath, "模型路径"),
    evidencePath: insideOutputRoot(value.evidencePath, "证据路径"),
  });
}

function getJson(url, { timeoutMs = 10_000, maxBytes = 128 * 1024 } = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1") {
    throw new TypeError("LM Studio 探针只允许 127.0.0.1");
  }
  return new Promise((resolve, reject) => {
    const request = http.get(endpoint, {
      agent: false,
      headers: { accept: "application/json", "accept-encoding": "identity" },
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      let total = 0;
      if (response.statusCode !== 200) {
        response.destroy();
        reject(new Error(`LM Studio 探针状态 ${response.statusCode}`));
        return;
      }
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy();
          reject(new Error("LM Studio 探针响应超限"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("LM Studio 探针响应非法")); }
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("LM Studio 探针超时")));
    request.on("error", reject);
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function createSystem({ baseUrl, model, timeoutMs, suffix, reviewSink = async () => {} }) {
  let requests = 0;
  const client = new BoundedAIHttpClient({ timeoutMs });
  const countedClient = {
    requestJson: async (descriptor) => {
      requests += 1;
      return client.requestJson(descriptor);
    },
  };
  const router = new AITransportRouter({
    adapters: createOpenAICompatibleAdapters(),
    httpClient: countedClient,
  });
  const provider = new AIProvider();
  provider.configureTransport(router);
  provider.configure({
    mode: "byo",
    provider: "lm_studio",
    model,
    base_url: baseUrl,
    credential_action: "clear",
    credential: null,
  }, PRO);
  const coordinator = new AIRequestCoordinator({
    aiProvider: provider,
    licenseProvider: { status: () => PRO },
    contextSource: async () => syntheticContext(),
    reviewSink,
    idFactory: () => `ai-plan-00000000-0000-4000-8000-0000000000${suffix}`,
    reviewIdFactory: () => `ai-review-00000000-0000-4000-8000-0000000000${suffix}`,
    transport: router,
  });
  return { coordinator, requestCount: () => requests };
}

async function expectFailure(system, expectedCode) {
  const plan = await system.coordinator.planIssueSuggestion({
    project: PROJECT,
    issueId: ISSUE_ID,
    instruction: "保持原意，只给出简洁修订建议。",
  });
  if (system.requestCount() !== 0) throw new Error("预览阶段意外请求模型");
  let code = null;
  try { await system.coordinator.confirmSuggestion(plan.plan_id); }
  catch (error) { code = error && error.code; }
  if (code !== expectedCode || system.requestCount() !== 1) {
    throw new Error(`预期 ${expectedCode}，实际 ${code || "成功"}`);
  }
  let replayCode = null;
  try { await system.coordinator.confirmSuggestion(plan.plan_id); }
  catch (error) { replayCode = error && error.code; }
  if (replayCode !== "AI_PLAN_STALE" || system.requestCount() !== 1) {
    throw new Error("失败计划可以重放或产生额外请求");
  }
  return Object.freeze({ code, requests: system.requestCount(), replay_code: replayCode });
}

async function run(options) {
  const started = Date.now();
  const fixture = readValidationFixture();
  const harnessSha256 = await sha256File(__filename);
  for (const filePath of [options.llmsterPath, options.modelPath]) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error("LM Studio 验收输入不是普通文件");
  }
  const version = execFileSync(options.llmsterPath, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  }).trim();
  const [binarySha256, modelSha256] = await Promise.all([
    sha256File(options.llmsterPath),
    sha256File(options.modelPath),
  ]);
  const modelStat = fs.statSync(options.modelPath);
  if (version !== options.expectedVersion || binarySha256 !== options.expectedBinarySha256 ||
      modelSha256 !== options.expectedModelSha256 || modelStat.size !== options.expectedModelSize) {
    throw new Error("LM Studio 运行时或模型本地身份不符");
  }

  const nativeModels = await getJson(`${options.origin}/api/v1/models`);
  const model = nativeModels && Array.isArray(nativeModels.models)
    ? nativeModels.models.find((item) => item && Array.isArray(item.loaded_instances) &&
      item.loaded_instances.some((instance) => instance && instance.id === options.model))
    : null;
  if (!model || model.type !== "llm" || model.format !== "gguf" ||
      model.size_bytes !== options.expectedModelSize) {
    throw new Error("LM Studio 原生模型身份不符或固定标识未加载");
  }
  const compatibleModels = await getJson(`${options.origin}/v1/models`);
  if (!compatibleModels || !Array.isArray(compatibleModels.data) ||
      !compatibleModels.data.some((item) => item && item.id === options.model)) {
    throw new Error("LM Studio OpenAI-compatible 模型标识不可用");
  }

  const substitution = await expectFailure(createSystem({
    baseUrl: options.baseUrl,
    model: "oak-manuscript-missing-model",
    timeoutMs: 120_000,
    suffix: "46",
  }), "AI_SERVICE_INCOMPATIBLE");

  const reviews = [];
  const successSystem = createSystem({
    baseUrl: options.baseUrl,
    model: options.model,
    timeoutMs: 120_000,
    suffix: "47",
    reviewSink: async (value) => reviews.push(value),
  });
  const plan = await successSystem.coordinator.planIssueSuggestion({
    project: PROJECT,
    issueId: ISSUE_ID,
    instruction: "保持原意，只给出简洁修订建议，并明确指出连续空格。",
  });
  if (successSystem.requestCount() !== 0 || plan.transport_available !== true) {
    throw new Error("真实 LM Studio 预览阶段不满足零请求合同");
  }
  const inferenceStarted = Date.now();
  const suggestion = await successSystem.coordinator.confirmSuggestion(plan.plan_id);
  const inferenceMs = Date.now() - inferenceStarted;
  if (successSystem.requestCount() !== 1 || suggestion.persistence !== "memory_only" ||
      suggestion.automatic_writeback !== false) {
    throw new Error("真实 LM Studio 成功响应违反只读建议合同");
  }
  const quality = evaluateSuggestionQuality(suggestion.text);
  const review = await successSystem.coordinator.reviewSuggestion(
    suggestion.review_id, "accepted",
  );
  if (review.manuscript_modified !== false || review.suggestion_persisted !== false ||
      reviews.length !== 1 || reviews[0].status !== "accepted") {
    throw new Error("真实 LM Studio 人工审阅违反不改稿合同");
  }

  const timeout = await expectFailure(createSystem({
    baseUrl: options.baseUrl,
    model: options.model,
    timeoutMs: 100,
    suffix: "48",
  }), "AI_SERVICE_TIMEOUT");

  const evidence = Object.freeze({
    schema_version: 1,
    product: "湖岸稿件 Oak Manuscript",
    validation_type: "real_lm_studio_headless_compatibility",
    validated_at: new Date().toISOString(),
    application: Object.freeze({
      version: fixture.appVersion,
      harness_sha256: harnessSha256,
      rule_pack_version: fixture.rulePackVersion,
      rule_pack_sha256: fixture.rulePackSha256,
      rule_id: fixture.rule.ruleId,
      fix_id: fixture.rule.fixId,
    }),
    server: Object.freeze({
      product: "LM Studio llmster",
      version,
      binary_sha256: binarySha256,
      origin: options.origin,
    }),
    model: Object.freeze({
      api_identifier: options.model,
      key: model.key,
      architecture: model.architecture,
      quantization: model.quantization && model.quantization.name,
      sha256: modelSha256,
      size_bytes: modelStat.size,
    }),
    scenarios: Object.freeze({
      preview_zero_request: true,
      success: Object.freeze({
        requests: successSystem.requestCount(),
        inference_ms: inferenceMs,
        persistence: suggestion.persistence,
        automatic_writeback: suggestion.automatic_writeback,
        review_manuscript_modified: review.manuscript_modified,
        review_suggestion_persisted: review.suggestion_persisted,
      }),
      silent_model_substitution_rejected: substitution,
      timeout,
    }),
    suggestion_quality: quality,
    privacy: Object.freeze({
      synthetic_context_only: true,
      suggestion_text_persisted: false,
      user_manuscript_read: false,
      credential_used: false,
    }),
    total_ms: Date.now() - started,
  });
  const file = writeEvidence(options.evidencePath, evidence);
  return Object.freeze({ evidence, file, path: options.evidencePath });
}

async function main() {
  const result = await run(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.evidence.suggestion_quality.pass) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`LM-STUDIO-COMPATIBILITY: FAIL ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  OUTPUT_ROOT,
  parseArgs,
  run,
  validateOptions,
};
