"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { registerAIIpc } = require("../electron/ai-ipc");

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
  });
  const result = await handlers.get("provider:ai-configure")(null, {});
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("secret upstream details"), false);
  assert.match(result.error, /配置未更改/u);
});
