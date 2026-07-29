"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { registerAIIpc } = require("../electron/ai-ipc");

const PROJECT = "C:\\projects\\oak";

function requestDeps(overrides = {}) {
  return {
    aiRequests: {
      planIssueSuggestion: async (payload) => ({ plan_id: "ai-plan-test", payload }),
      confirmSuggestion: async (planId) => ({ text: `suggestion:${planId}` }),
      cancelSuggestion: () => ({ canceled: true }),
      clear: () => {},
      ...overrides,
    },
    pathPolicy: { looksLikeProject: (value) => value === PROJECT },
  };
}

test("AI IPC passes only exact settings to the main-process provider and never returns credentials", async () => {
  const handlers = new Map();
  const calls = [];
  const secret = "sk-renderer-one-shot-secret";
  const aiProvider = {
    status: (license) => ({ mode: "off", license }),
    configure: (payload, license) => {
      calls.push([payload, license]);
      return { mode: payload.mode, has_credential: true, transport_configured: false };
    },
    clearCredential: () => {},
  };
  const license = { effectiveTier: "pro" };
  registerAIIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    aiProvider,
    licenseProvider: { status: () => license },
    ...requestDeps({ clear: () => calls.push(["clear"]) }),
  });
  const status = await handlers.get("provider:ai-status")();
  assert.equal(status.ok, true);
  const configured = await handlers.get("provider:ai-configure")(null, {
    mode: "byo", provider: "openai", model: "gpt-5-mini", base_url: null,
    credential_action: "replace", credential: secret,
  });
  assert.equal(configured.ok, true);
  assert.equal(JSON.stringify(configured).includes(secret), false);
  assert.equal(calls[0][0].credential, secret);
  assert.equal(calls[0][1], license);
  assert.deepEqual(await handlers.get("provider:ai-clear-credential")(), {
    ok: true, status: { mode: "off", license },
  });
  assert.equal(calls.filter((item) => item[0] === "clear").length, 2);
});

test("AI request IPC accepts only a trusted project and exact one-shot plan operations", async () => {
  const handlers = new Map();
  const requestCalls = [];
  registerAIIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    aiProvider: { status: () => ({}), configure: () => ({}), clearCredential: () => {} },
    licenseProvider: { status: () => ({ effectiveTier: "pro" }) },
    ...requestDeps({
      planIssueSuggestion: async (payload) => { requestCalls.push(["plan", payload]); return { plan_id: "p" }; },
      confirmSuggestion: async (planId) => { requestCalls.push(["confirm", planId]); return { text: "只读建议" }; },
      cancelSuggestion: (planId) => { requestCalls.push(["cancel", planId]); return { canceled: true }; },
    }),
  });
  assert.deepEqual(await handlers.get("provider:ai-plan-suggestion")(null, {
    project: PROJECT, issueId: "check-0001-0001", instruction: "保持原意",
  }), { ok: true, plan: { plan_id: "p" } });
  assert.deepEqual(await handlers.get("provider:ai-confirm-suggestion")(null, { planId: "p" }), {
    ok: true, suggestion: { text: "只读建议" },
  });
  assert.deepEqual(await handlers.get("provider:ai-cancel-suggestion")(null, { planId: "p" }), {
    ok: true, canceled: true,
  });
  assert.equal(requestCalls.length, 3);

  const smuggled = await handlers.get("provider:ai-plan-suggestion")(null, {
    project: PROJECT, issueId: "check-0001-0001", instruction: "", manuscript: "secret",
  });
  assert.equal(smuggled.ok, false);
  const unsafe = await handlers.get("provider:ai-plan-suggestion")(null, {
    project: "C:\\not-a-project", issueId: "check-0001-0001", instruction: "",
  });
  assert.equal(unsafe.ok, false);
  assert.equal(requestCalls.length, 3);
});

test("AI IPC sanitizes provider failures and rejects incomplete dependencies", async () => {
  assert.throws(() => registerAIIpc(), /依赖/u);
  const handlers = new Map();
  registerAIIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    aiProvider: {
      status: () => ({ mode: "off" }),
      configure: () => { throw new Error("secret upstream details"); },
      clearCredential: () => ({ mode: "off" }),
    },
    licenseProvider: { status: () => ({ effectiveTier: "free" }) },
    ...requestDeps(),
  });
  const result = await handlers.get("provider:ai-configure")(null, {});
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("secret upstream details"), false);
  assert.match(result.error, /没有发送内容/u);
});
