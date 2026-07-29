"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { AIProvider } = require("../electron/ai-provider");
const {
  AIRequestCoordinator,
  DEFAULT_USER_INSTRUCTION,
  PLAN_TTL_MS,
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

function coordinator(overrides = {}) {
  const aiProvider = overrides.aiProvider || provider();
  return new AIRequestCoordinator({
    aiProvider,
    licenseProvider: { status: () => PRO },
    contextSource: async () => context(),
    now: () => FIXED_NOW,
    idFactory: ids(),
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

test("one confirmed plan passes the credential only to transport and returns a memory-only suggestion", async () => {
  const calls = [];
  const transport = {
    supports: (binding) => binding.provider === "openai",
    request: async (input) => {
      calls.push(input);
      return { text: "建议删除其中一个空格；请确认这不会改变原意。" };
    },
  };
  const requests = coordinator({ transport });
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
  assert.equal(suggestion.automatic_writeback, false);
  assert.equal(JSON.stringify(suggestion).includes(SECRET), false);
  await assert.rejects(() => requests.confirmSuggestion(plan.plan_id), /已过期或已使用/u);
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
