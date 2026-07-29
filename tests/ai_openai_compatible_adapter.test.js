"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SUPPORTED_PROVIDERS,
  buildRequest,
  createOpenAICompatibleAdapters,
  parseResponse,
} = require("../electron/ai-openai-compatible-adapter");
const { AITransportRouter } = require("../electron/ai-transport-router");
const { AIProvider } = require("../electron/ai-provider");
const { AIRequestCoordinator } = require("../electron/ai-request");

const SECRET = "sk-compatible-secret-never-return";
const request = Object.freeze({
  system_instruction: "只处理当前问题。",
  user_instruction: "解释并给出建议。",
  issue_context: Object.freeze({ rule_id: "CN-001", preview: "湖岸  稿件" }),
});

function configuration(provider, overrides = {}) {
  const local = provider !== "openai_compatible";
  return {
    mode: "byo",
    provider,
    model: "qwen3:8b",
    base_url: local
      ? (provider === "ollama" ? "http://127.0.0.1:11434/v1" : "http://127.0.0.1:1234/v1")
      : "https://models.example.com/v1",
    endpoint_kind: local ? "local" : "self_hosted",
    credential: null,
    ...overrides,
  };
}

test("compatible adapters build one non-streaming chat request for all three supported providers", () => {
  const adapters = createOpenAICompatibleAdapters();
  assert.deepEqual([...adapters.keys()], [...SUPPORTED_PROVIDERS]);
  for (const provider of SUPPORTED_PROVIDERS) {
    const descriptor = adapters.get(provider).buildRequest(configuration(provider), request);
    assert.equal(descriptor.url.endsWith("/v1/chat/completions"), true);
    assert.deepEqual(descriptor.headers, {});
    assert.equal(descriptor.json.model, "qwen3:8b");
    assert.equal(descriptor.json.stream, false);
    assert.deepEqual(descriptor.json.messages.map((item) => item.role), ["system", "user"]);
    assert.equal(descriptor.json.messages[1].content.includes("CN-001"), true);
    assert.equal(descriptor.json.messages[1].content.includes("湖岸  稿件"), true);
  }
  const authenticated = buildRequest(configuration("openai_compatible", {
    credential: SECRET,
  }), request);
  assert.deepEqual(authenticated.headers, { authorization: `Bearer ${SECRET}` });
  assert.equal(JSON.stringify(authenticated.json).includes(SECRET), false);
});

test("compatible parser accepts one assistant string and rejects ambiguous or tool responses", () => {
  assert.deepEqual(parseResponse({
    id: "response-1",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "建议删除一个空格。" } }],
  }), { text: "建议删除一个空格。" });
  for (const value of [
    {},
    { choices: [] },
    { choices: [{ message: { role: "assistant", content: "one" } }, { message: { role: "assistant", content: "two" } }] },
    { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: "call", tool_calls: [] } }] },
    { choices: [{ finish_reason: "length", message: { role: "assistant", content: "truncated" } }] },
    { choices: [{ message: { role: "user", content: "wrong role" } }] },
    { choices: [{ message: { role: "assistant", content: "   " } }] },
    { choices: [{ message: { role: "assistant", content: [{ type: "text", text: "array" }] } }] },
  ]) assert.throws(() => parseResponse(value), /响应/u);
});

test("router exposes only the compatible family and returns a bounded text-only result", async () => {
  const calls = [];
  const router = new AITransportRouter({
    adapters: createOpenAICompatibleAdapters(),
    httpClient: { requestJson: async (descriptor) => {
      calls.push(descriptor);
      return { choices: [{ message: { role: "assistant", content: "只读建议" }, finish_reason: "stop" }] };
    } },
  });
  for (const provider of SUPPORTED_PROVIDERS) {
    assert.equal(router.supports({ mode: "byo", provider }), true);
  }
  for (const provider of ["openai", "anthropic", "google"]) {
    assert.equal(router.supports({ mode: "byo", provider }), false);
  }
  assert.deepEqual(await router.request({
    configuration: configuration("ollama"), request,
  }), { text: "只读建议" });
  assert.equal(calls.length, 1);
});

test("Ollama configuration completes preview, explicit send, and read-only review end to end", async () => {
  const calls = []; const reviews = [];
  const router = new AITransportRouter({
    adapters: createOpenAICompatibleAdapters(),
    httpClient: { requestJson: async (descriptor) => {
      calls.push(descriptor);
      return { choices: [{ message: { role: "assistant", content: "建议删除一个空格。" }, finish_reason: "stop" }] };
    } },
  });
  const provider = new AIProvider(); provider.configureTransport(router);
  provider.configure({
    mode: "byo", provider: "ollama", model: "qwen3:8b", base_url: null,
    credential_action: "clear", credential: null,
  }, { effectiveTier: "pro" });
  const coordinator = new AIRequestCoordinator({
    aiProvider: provider,
    licenseProvider: { status: () => ({ effectiveTier: "pro" }) },
    contextSource: async () => ({
      schema_version: "1.0", context_type: "oak_manuscript_issue_suggestion",
      binding: { issue_id: "check-0001-0001", check_id: "check-0001", working_sha256: "a".repeat(64), rulepack_manifest_sha256: "b".repeat(64) },
      request_content: { rule_id: "CN-001", severity: "warning", title: "连续空格", explanation: "这里包含连续空格。", location: "正文第 3 段", preview: "湖岸  稿件", standard_refs: ["GB/T 15834—2011"], status: "open" },
    }),
    reviewSink: async (value) => reviews.push(value),
    now: () => Date.parse("2026-07-29T12:00:00.000Z"),
    idFactory: () => "ai-plan-00000000-0000-4000-8000-000000000001",
    reviewIdFactory: () => "ai-review-00000000-0000-4000-8000-000000000001",
    transport: router,
  });
  const plan = await coordinator.planIssueSuggestion({
    project: "C:\\projects\\oak-manuscript", issueId: "check-0001-0001", instruction: "保持原意。",
  });
  assert.equal(plan.transport_available, true);
  assert.equal(calls.length, 0);
  const suggestion = await coordinator.confirmSuggestion(plan.plan_id);
  assert.equal(suggestion.text, "建议删除一个空格。");
  assert.equal(suggestion.persistence, "memory_only");
  assert.equal(calls.length, 1);
  const review = await coordinator.reviewSuggestion(suggestion.review_id, "accepted");
  assert.equal(review.manuscript_modified, false);
  assert.deepEqual(reviews, [{ project: "C:\\projects\\oak-manuscript", issueId: "check-0001-0001", status: "accepted" }]);
});
