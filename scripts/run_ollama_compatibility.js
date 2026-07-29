"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const { BoundedAIHttpClient } = require("../electron/ai-http-client");
const { createOpenAICompatibleAdapters } = require("../electron/ai-openai-compatible-adapter");
const { AIProvider } = require("../electron/ai-provider");
const { AIRequestCoordinator } = require("../electron/ai-request");
const { AITransportRouter } = require("../electron/ai-transport-router");

const PRO = Object.freeze({ effectiveTier: "pro" });
const ISSUE_ID = "check-0001-0001";
const PROJECT = "C:\\oak-manuscript-validation\\synthetic-project";
const DIGEST_RE = /^[0-9a-f]{64}$/u;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/u;
const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(REPO_ROOT, "out", "external-validation", "ollama");
const PACKAGE_PATH = path.join(REPO_ROOT, "package.json");
const RULE_PACK_PATH = path.join(REPO_ROOT, "config", "rule-packs", "oak-rules-2.0.0.json");

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

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readValidationFixture() {
  const packageBytes = fs.readFileSync(PACKAGE_PATH);
  const rulePackBytes = fs.readFileSync(RULE_PACK_PATH);
  if (packageBytes.length > 256 * 1024 || rulePackBytes.length > 1024 * 1024) {
    throw new Error("验收源文件超限");
  }
  let packageJson;
  let rulePack;
  try {
    packageJson = JSON.parse(packageBytes.toString("utf8"));
    rulePack = JSON.parse(rulePackBytes.toString("utf8"));
  } catch {
    throw new Error("验收源文件不是合法 JSON");
  }
  const rule = rulePack && Array.isArray(rulePack.rules)
    ? rulePack.rules.find((item) => item && item.rule_id === "DOCX-SPACE-001")
    : null;
  if (!VERSION_RE.test(packageJson && packageJson.version) ||
      !rule || rule.title !== "连续空格" || rule.fix_id !== "FIX-SPACE-001" ||
      rule.auto_fixable !== true || typeof rule.explanation !== "string" ||
      !rule.explanation.includes("合并为一个空格") ||
      !Array.isArray(rule.standard_refs) || rule.standard_refs.length !== 1 ||
      rule.standard_refs[0] !== "OAK-DOCX-STYLE-001") {
    throw new Error("当前连续空格规则不符合验收夹具合同");
  }
  return Object.freeze({
    appVersion: packageJson.version,
    rulePackVersion: rulePack.pack_version,
    rulePackSha256: sha256(rulePackBytes),
    rule: Object.freeze({
      ruleId: rule.rule_id,
      fixId: rule.fix_id,
      title: rule.title,
      explanation: rule.explanation,
      standardRefs: Object.freeze([...rule.standard_refs]),
    }),
  });
}

function parseArgs(argv) {
  const values = Object.create(null);
  const allowed = new Set([
    "--base-url", "--model", "--expected-version", "--expected-model-digest", "--evidence",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || value === undefined || value.startsWith("--") ||
        Object.hasOwn(values, name)) {
      throw new TypeError("Ollama 验收参数非法");
    }
    values[name] = value;
  }
  return validateOptions({
    baseUrl: values["--base-url"],
    model: values["--model"],
    expectedVersion: values["--expected-version"],
    expectedModelDigest: values["--expected-model-digest"],
    evidencePath: values["--evidence"],
  });
}

function validateOptions(input) {
  const value = exactKeys(input, [
    "baseUrl", "model", "expectedVersion", "expectedModelDigest", "evidencePath",
  ], "Ollama 验收配置");
  let endpoint;
  try { endpoint = new URL(value.baseUrl); } catch { throw new TypeError("base URL 非法"); }
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" ||
      endpoint.pathname.replace(/\/+$/u, "") !== "/v1" || endpoint.search || endpoint.hash ||
      endpoint.username || endpoint.password || !endpoint.port) {
    throw new TypeError("真实 Ollama 验收仅允许 127.0.0.1 独立端口的 /v1");
  }
  if (!MODEL_RE.test(value.model) || !VERSION_RE.test(value.expectedVersion) ||
      !DIGEST_RE.test(value.expectedModelDigest)) {
    throw new TypeError("Ollama 版本、模型或摘要非法");
  }
  if (typeof value.evidencePath !== "string" || value.evidencePath.length < 1) {
    throw new TypeError("证据路径非法");
  }
  const evidencePath = path.resolve(value.evidencePath);
  if (evidencePath !== OUTPUT_ROOT && !evidencePath.startsWith(`${OUTPUT_ROOT}${path.sep}`)) {
    throw new TypeError("证据必须写入仓库 out/external-validation/ollama");
  }
  return Object.freeze({
    baseUrl: endpoint.toString().replace(/\/$/u, ""),
    origin: endpoint.origin,
    model: value.model,
    expectedVersion: value.expectedVersion,
    expectedModelDigest: value.expectedModelDigest,
    evidencePath,
  });
}

function getJson(url, { timeoutMs = 10_000, maxBytes = 128 * 1024 } = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1") {
    throw new TypeError("Ollama 探针只允许 127.0.0.1");
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
        reject(new Error(`Ollama 探针状态 ${response.statusCode}`));
        return;
      }
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy();
          reject(new Error("Ollama 探针响应超限"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("Ollama 探针响应非法")); }
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Ollama 探针超时")));
    request.on("error", reject);
  });
}

function syntheticContext() {
  const fixture = readValidationFixture();
  return {
    schema_version: "1.0",
    context_type: "oak_manuscript_issue_suggestion",
    binding: {
      issue_id: ISSUE_ID,
      check_id: "check-0001",
      working_sha256: "a".repeat(64),
      rulepack_manifest_sha256: "b".repeat(64),
    },
    request_content: {
      rule_id: fixture.rule.ruleId,
      severity: "warning",
      title: fixture.rule.title,
      explanation: fixture.rule.explanation,
      location: "正文第 3 段",
      preview: "湖岸  稿件",
      standard_refs: [...fixture.rule.standardRefs],
      status: "open",
    },
  };
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
    provider: "ollama",
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

function evaluateSuggestionQuality(text) {
  if (typeof text !== "string") throw new TypeError("建议必须为文本");
  const bytes = Buffer.byteLength(text, "utf8");
  const normalized = text.replace(/\u00a0/gu, " ");
  const targetsExtraSpacing =
    /(?:连续|多余|重复|两个|两处|以上|第[二2]个).{0,8}(?:空格|间隔)|(?:空格|间隔).{0,8}(?:连续|多余|重复|两个|两处|以上|第[二2]个)/u
      .test(text);
  const proposesCorrection =
    /(?:合并|删(?:除|去)|去(?:除|掉)|移除|替换|改为|调整|保留)/u.test(text);
  const removesAllSpacing =
    /(?:删除|删去|去除|去掉|移除).{0,8}(?:所有|全部)空格|(?:所有|全部)空格.{0,8}(?:删除|删去|去除|去掉|移除)/u
      .test(text);
  const checks = Object.freeze({
    bounded_nonempty: bytes > 0 && bytes <= 32 * 1024,
    identifies_spacing_problem: /空格|间隔/u.test(text),
    proposes_rule_aligned_correction:
      !removesAllSpacing && (
        /(?:单个|一个)空格/u.test(text) || normalized.includes("湖岸 稿件") ||
        (targetsExtraSpacing && proposesCorrection)
      ),
    avoids_false_write_claim:
      !/(?:我|本助手).{0,6}(?:已|已经).{0,4}(?:修改|删除|改写|合并|修复|处理)/u.test(text),
  });
  return Object.freeze({
    pass: Object.values(checks).every(Boolean),
    checks,
    bytes,
    sha256: sha256(Buffer.from(text, "utf8")),
  });
}

async function waitForUnload(origin, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await getJson(`${origin}/api/ps`);
    if (response && Array.isArray(response.models) && response.models.length === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Ollama 模型未在时限内卸载");
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

function writeEvidence(filePath, evidence) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const candidate = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  const bytes = Buffer.from(`${canonical(evidence)}\n`, "utf8");
  const handle = fs.openSync(candidate, "wx", 0o600);
  try {
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
  } finally { fs.closeSync(handle); }
  fs.renameSync(candidate, filePath);
  return Object.freeze({ bytes: bytes.length, sha256: sha256(bytes) });
}

async function run(options) {
  const started = Date.now();
  const fixture = readValidationFixture();
  const harnessSha256 = sha256(fs.readFileSync(__filename));
  const version = await getJson(`${options.origin}/api/version`);
  if (!version || version.version !== options.expectedVersion) {
    throw new Error(`Ollama 服务版本不符：${version && version.version}`);
  }
  const tags = await getJson(`${options.origin}/api/tags`);
  const model = tags && Array.isArray(tags.models)
    ? tags.models.find((item) => item && item.name === options.model)
    : null;
  if (!model || model.digest !== options.expectedModelDigest ||
      !Number.isSafeInteger(model.size) || model.size < 1) {
    throw new Error("Ollama 模型身份不符");
  }

  const missing = await expectFailure(createSystem({
    baseUrl: options.baseUrl,
    model: "oak-manuscript-missing-model:latest",
    timeoutMs: 10_000,
    suffix: "43",
  }), "AI_SERVICE_REJECTED");

  const reviews = [];
  const successSystem = createSystem({
    baseUrl: options.baseUrl,
    model: options.model,
    timeoutMs: 120_000,
    suffix: "44",
    reviewSink: async (value) => reviews.push(value),
  });
  const plan = await successSystem.coordinator.planIssueSuggestion({
    project: PROJECT,
    issueId: ISSUE_ID,
    instruction: "保持原意，只给出简洁修订建议，并明确指出连续空格。",
  });
  if (successSystem.requestCount() !== 0 || plan.transport_available !== true) {
    throw new Error("真实 Ollama 预览阶段不满足零请求合同");
  }
  const inferenceStarted = Date.now();
  const suggestion = await successSystem.coordinator.confirmSuggestion(plan.plan_id);
  const inferenceMs = Date.now() - inferenceStarted;
  if (successSystem.requestCount() !== 1 || suggestion.persistence !== "memory_only" ||
      suggestion.automatic_writeback !== false) {
    throw new Error("真实 Ollama 成功响应违反只读建议合同");
  }
  const quality = evaluateSuggestionQuality(suggestion.text);
  const review = await successSystem.coordinator.reviewSuggestion(
    suggestion.review_id, "accepted",
  );
  if (review.manuscript_modified !== false || review.suggestion_persisted !== false ||
      reviews.length !== 1 || reviews[0].status !== "accepted") {
    throw new Error("真实 Ollama 人工审阅违反不改稿合同");
  }

  await waitForUnload(options.origin);
  const timeout = await expectFailure(createSystem({
    baseUrl: options.baseUrl,
    model: options.model,
    timeoutMs: 100,
    suffix: "45",
  }), "AI_SERVICE_TIMEOUT");
  await waitForUnload(options.origin);

  const evidence = Object.freeze({
    schema_version: 1,
    product: "湖岸稿件 Oak Manuscript",
    validation_type: "real_ollama_compatibility",
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
      product: "Ollama",
      version: version.version,
      origin: options.origin,
    }),
    model: Object.freeze({
      name: options.model,
      digest: model.digest,
      size_bytes: model.size,
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
      missing_model: missing,
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
    process.stderr.write(`OLLAMA-COMPATIBILITY: FAIL ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  OUTPUT_ROOT,
  canonical,
  evaluateSuggestionQuality,
  parseArgs,
  readValidationFixture,
  run,
  syntheticContext,
  validateOptions,
  writeEvidence,
};
