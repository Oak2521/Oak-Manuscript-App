"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { AIProvider } = require("../electron/ai-provider");
const {
  AIRequestCoordinator,
  DEFAULT_USER_INSTRUCTION,
  PLAN_TTL_MS,
  REVIEW_TTL_MS,
  transportFailure,
  validateAIContext,
} = require("../electron/ai-request");

const PRO = Object.freeze({ effectiveTier: "pro" });
const PROJECT = "C:\\projects\\oak-manuscript";
const SECRET = "sk-request-secret-never-return";
const FIXED_NOW = Date.parse("2026-07-28T20:00:00.000Z");

function context(overrides = {}) {
  return {
    schema_version: "1.0",
    context_type: "oak_manuscript_issue_suggestion",
    binding: {
      issue_id: "check-0001-0001",
      check_id: "check-0001",
      working_sha256: "a".repeat(64),
      rulepack_manifest_sha256: "b".repeat(64),
    },
    request_content: {
      rule_id: "CN-001",
      severity: "warning",
      title: "连续空格",
      explanation: "这里包含不必要的连续空格。",
      location: "正文第 3 段",
      preview: "湖岸  稿件",
      standard_refs: ["GB/T 15834—2011"],
      status: "open",
    },
    ...overrides,
  };
}

function provider() {
  const value = new AIProvider();
  value.configure({
    mode: "byo", provider: "openai", model: "gpt-5-mini", base_url: null,
    credential_action: "replace", credential: SECRET,
  }, PRO);
  return value;
}

function ids() {
  let counter = 0;
  return () => `ai-plan-00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
}

function reviewIds() {
  let counter = 0;
  return () => `ai-review-00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
}

function coordinator(overrides = {}) {
  const aiProvider = overrides.aiProvider || provider();
  return new AIRequestCoordinator({
    aiProvider,
    licenseProvider: { status: () => PRO },
    contextSource: async () => context(),
    reviewSink: async () => {},
    now: () => FIXED_NOW,
    idFactory: ids(),
    reviewIdFactory: reviewIds(),
    transport: null,
    ...overrides,
  });
}

test("AI request preview exposes exact destination and content but no local binding or credential", async () => {
  const requests = coordinator();
  const plan = await requests.planIssueSuggestion({
    project: PROJECT, issueId: "check-0001-0001", instruction: "",
  });
  assert.equal(plan.destination.provider, "openai");
  assert.equal(plan.destination.base_url, "https://api.openai.com/v1");
  assert.equal(plan.request.user_instruction, DEFAULT_USER_INSTRUCTION);
  assert.equal(plan.request.issue_context.preview, "湖岸  稿件");
  assert.equal(plan.transport_available, false);
  assert.equal(plan.output_policy, "suggestion_only");
  assert.equal(plan.automatic_writeback, false);
  const serialized = JSON.stringify(plan);
  for (const forbidden of [SECRET, PROJECT, "a".repeat(64), "check-0001"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.request.issue_context), true);
});

test("preview alone never calls transport and unavailable confirmation is one-shot", async () => {
  const requests = coordinator();
  const plan = await requests.planIssueSuggestion({
    project: PROJECT, issueId: "check-0001-0001", instruction: "重点解释标点。",
  });
  await assert.rejects(() => requests.confirmSuggestion(plan.plan_id), /尚未配置/u);
  await assert.rejects(() => requests.confirmSuggestion(plan.plan_id), /已过期或已使用/u);
});

test("transport failures become actionable stable errors without leaking upstream details", async () => {
  const cases = [
    ["NETWORK_FAILED", "AI_SERVICE_UNREACHABLE", /服务已启动且地址正确/u],
    ["NETWORK_TIMEOUT", "AI_SERVICE_TIMEOUT", /模型已经加载/u],
    ["UPSTREAM_STATUS", "AI_SERVICE_REJECTED", /模型名称和凭据/u],
    ["REDIRECT_REJECTED", "AI_SERVICE_REDIRECTED", /不允许的重定向/u],
    ["INVALID_RESPONSE", "AI_SERVICE_INCOMPATIBLE", /兼容格式/u],
    ["ADAPTER_FAILED", "AI_SERVICE_INCOMPATIBLE", /兼容格式/u],
    ["RESPONSE_TOO_LARGE", "AI_RESPONSE_TOO_LARGE", /安全上限/u],
    ["CREDENTIAL_ECHO", "AI_CREDENTIAL_ECHO_REJECTED", /受保护凭据/u],
  ];
  for (const [internal, publicCode, message] of cases) {
    const mapped = transportFailure({ code: internal, message: `leak ${SECRET}` });
    assert.equal(mapped.code, publicCode);
    assert.match(mapped.message, message);
    assert.equal(mapped.message.includes(SECRET), false);
    assert.match(mapped.message, /没有修改稿件或配置/u);
  }
  const fallback = transportFailure({
    get code() { throw new Error(`leak ${SECRET}`); },
  });
  assert.equal(fallback.code, "MODEL_REQUEST_FAILED");
  assert.equal(fallback.message.includes(SECRET), false);
});

test("a failed send consumes the plan and exposes the bounded recovery category", async () => {
  const requests = coordinator({
    transport: {
      supports: () => true,
      request: async () => { throw Object.assign(new Error(`leak ${SECRET}`), { code: "NETWORK_FAILED" }); },
    },
  });
  const plan = await requests.planIssueSuggestion({
    project: PROJECT, issueId: "check-0001-0001", instruction: "",
  });
  await assert.rejects(
    () => requests.confirmSuggestion(plan.plan_id),
    (error) => error.code === "AI_SERVICE_UNREACHABLE" &&
      /重新预览/u.test(error.message) && !error.message.includes(SECRET),
  );
  await assert.rejects(() => requests.confirmSuggestion(plan.plan_id), /已过期或已使用/u);
});

test("one confirmed plan passes the credential only to transport and returns a memory-only suggestion", async () => {
  const calls = [];
  const reviewCalls = [];
  const transport = {
    supports: (binding) => binding.provider === "openai",
    request: async (input) => {
      calls.push(input);
      return { text: "建议删除其中一个空格；请确认这不会改变原意。" };
    },
  };
  const requests = coordinator({
    transport,
    reviewSink: async (input) => reviewCalls.push(input),
  });
  const plan = await requests.planIssueSuggestion({
    project: PROJECT, issueId: "check-0001-0001", instruction: "保持原意。",
  });
  assert.equal(calls.length, 0);
  assert.equal(plan.transport_available, true);
  const suggestion = await requests.confirmSuggestion(plan.plan_id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].configuration.credential, SECRET);
  assert.equal(calls[0].request, plan.request);
  assert.equal(suggestion.text.includes("删除"), true);
  assert.equal(suggestion.persistence, "memory_only");
  assert.equal(suggestion.review_state, "pending");
  assert.equal(suggestion.automatic_writeback, false);
  assert.equal(JSON.stringify(suggestion).includes(SECRET), false);
  const review = await requests.reviewSuggestion(suggestion.review_id, "accepted");
  assert.equal(review.decision, "accepted");
  assert.equal(review.issue_status, "accepted");
  assert.equal(review.manuscript_modified, false);
  assert.equal(review.suggestion_persisted, false);
  assert.deepEqual(reviewCalls, [{
    project: PROJECT, issueId: "check-0001-0001", status: "accepted",
  }]);
  await assert.rejects(
    () => requests.reviewSuggestion(suggestion.review_id, "accepted"), /已处理/u,
  );
  await assert.rejects(() => requests.confirmSuggestion(plan.plan_id), /已过期或已使用/u);
});

test("rejecting an AI suggestion changes neither issue status nor manuscript", async () => {
  let reviewCalls = 0;
  const requests = coordinator({
    transport: { supports: () => true, request: async () => ({ text: "只读建议" }) },
    reviewSink: async () => { reviewCalls += 1; },
  });
  const plan = await requests.planIssueSuggestion({
    project: PROJECT, issueId: "check-0001-0001", instruction: "",
  });
  const suggestion = await requests.confirmSuggestion(plan.plan_id);
  const review = await requests.reviewSuggestion(suggestion.review_id, "rejected");
  assert.equal(review.decision, "rejected");
  assert.equal(review.issue_status, "unchanged");
  assert.equal(review.manuscript_modified, false);
  assert.equal(review.suggestion_persisted, false);
  assert.equal(reviewCalls, 0);
});

test("AI review rejects stale context and sanitizes sink failures", async () => {
  let current = context();
  const requests = coordinator({
    contextSource: async () => current,
    transport: { supports: () => true, request: async () => ({ text: "只读建议" }) },
  });
  let plan = await requests.planIssueSuggestion({
    project: PROJECT, issueId: "check-0001-0001", instruction: "",
  });
  let suggestion = await requests.confirmSuggestion(plan.plan_id);
  current = context({ request_content: { ...context().request_content, status: "accepted" } });
  await assert.rejects(
    () => requests.reviewSuggestion(suggestion.review_id, "accepted"), /不能采纳旧建议/u,
  );

  current = context();
  const failing = coordinator({
    contextSource: async () => current,
    transport: { supports: () => true, request: async () => ({ text: "只读建议" }) },
    reviewSink: async () => { throw new Error(`leak ${SECRET}`); },
  });
  plan = await failing.planIssueSuggestion({
    project: PROJECT, issueId: "check-0001-0001", instruction: "",
  });
  suggestion = await failing.confirmSuggestion(plan.plan_id);
  await assert.rejects(
    () => failing.reviewSuggestion(suggestion.review_id, "accepted"),
    (error) => /没有修改稿件/u.test(error.message) && !error.message.includes(SECRET),
  );
});

test("AI reviews are bounded to eight and expire after thirty minutes", async () => {
  let now = FIXED_NOW;
  const requests = coordinator({
    now: () => now,
    transport: { supports: () => true, request: async () => ({ text: "只读建议" }) },
  });
  const suggestions = [];
  for (let index = 0; index < 9; index += 1) {
    const plan = await requests.planIssueSuggestion({
      project: PROJECT, issueId: "check-0001-0001", instruction: "",
    });
    suggestions.push(await requests.confirmSuggestion(plan.plan_id));
  }
  await assert.rejects(
    () => requests.reviewSuggestion(suggestions[0].review_id, "rejected"), /已处理/u,
  );
  now += REVIEW_TTL_MS;
  await assert.rejects(
    () => requests.reviewSuggestion(suggestions.at(-1).review_id, "rejected"), /已过期/u,
  );
});

test("context or AI configuration drift invalidates the plan before transport", async () => {
  let current = context();
  let transportCalls = 0;
  const aiProvider = provider();
  const requests = coordinator({
    aiProvider,
    contextSource: async () => current,
    transport: {
      supports: () => true,
      request: async () => { transportCalls += 1; return { text: "never" }; },
    },
  });
  const contextPlan = await requests.planIssueSuggestion({
    project: PROJECT, issueId: "check-0001-0001", instruction: "",
  });
  current = context({
    binding: { ...context().binding, working_sha256: "c".repeat(64) },
  });
  await assert.rejects(() => requests.confirmSuggestion(contextPlan.plan_id), /已变化/u);
  assert.equal(transportCalls, 0);

  current = context();
  const configPlan = await requests.planIssueSuggestion({
    project: PROJECT, issueId: "check-0001-0001", instruction: "",
  });
  aiProvider.configure({
    mode: "byo", provider: "openai", model: "gpt-5-mini", base_url: null,
    credential_action: "replace", credential: "sk-another-secret-value",
  }, PRO);
  await assert.rejects(() => requests.confirmSuggestion(configPlan.plan_id), /AI 配置已变化/u);
  assert.equal(transportCalls, 0);
});

test("cancel and expiry remove local disclosure without revealing whether a plan existed", async () => {
  let now = FIXED_NOW;
  const requests = coordinator({ now: () => now });
  const plan = await requests.planIssueSuggestion({
    project: PROJECT, issueId: "check-0001-0001", instruction: "",
  });
  assert.deepEqual(requests.cancelSuggestion(plan.plan_id), { canceled: true });
  assert.deepEqual(requests.cancelSuggestion(plan.plan_id), { canceled: true });
  const expired = await requests.planIssueSuggestion({
    project: PROJECT, issueId: "check-0001-0001", instruction: "",
  });
  now += PLAN_TTL_MS;
  await assert.rejects(() => requests.confirmSuggestion(expired.plan_id), /已过期/u);
});

test("malformed contexts and smuggled fields fail before a transport can be selected", async () => {
  assert.throws(() => validateAIContext({ ...context(), manuscript: "secret" }), /字段集合/u);
  assert.throws(() => validateAIContext(context({
    request_content: { ...context().request_content, path: "C:\\secret.docx" },
  })), /字段集合/u);
  const requests = coordinator({ contextSource: async () => context({
    binding: { ...context().binding, issue_id: "another-issue" },
  }) });
  await assert.rejects(() => requests.planIssueSuggestion({
    project: PROJECT, issueId: "check-0001-0001", instruction: "",
  }), /所选问题不一致/u);
});

test("transport failures, extra result fields and oversized responses are fail-closed", async () => {
  for (const transport of [
    { supports: () => true, request: async () => { throw new Error(`leak ${SECRET}`); } },
    { supports: () => true, request: async () => ({ text: "ok", raw: SECRET }) },
    { supports: () => true, request: async () => ({ text: "界".repeat(20_000) }) },
  ]) {
    const requests = coordinator({ transport });
    const plan = await requests.planIssueSuggestion({
      project: PROJECT, issueId: "check-0001-0001", instruction: "",
    });
    await assert.rejects(
      () => requests.confirmSuggestion(plan.plan_id),
      (error) => !String(error.message).includes(SECRET),
    );
  }
});
