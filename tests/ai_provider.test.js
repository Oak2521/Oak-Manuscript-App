"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AI_PROVIDER_SPECS,
  AIProvider,
  canonicalBaseUrl,
  validateAISettingsState,
} = require("../electron/ai-provider");

const FREE = Object.freeze({ effectiveTier: "free" });
const PRO = Object.freeze({ effectiveTier: "pro" });

function config(overrides = {}) {
  return {
    mode: "byo",
    provider: "openai",
    model: "gpt-5-mini",
    base_url: null,
    credential_action: "replace",
    credential: "sk-test-value-that-must-never-return",
    ...overrides,
  };
}

test("AI provider defaults to no AI and publishes the frozen safety contract", () => {
  const status = new AIProvider().status(FREE);
  assert.equal(status.mode, "off");
  assert.equal(status.configuration_state, "disabled");
  assert.equal(status.transport_configured, false);
  assert.equal(status.fallback_mode, "none");
  assert.equal(status.output_policy, "suggestion_only");
  assert.equal(status.automatic_writeback, false);
  assert.equal(status.credential_sync, "never");
  assert.equal(status.uses_oak_ai_quota, false);
  assert.equal(Object.isFrozen(status), true);
  assert.equal(Object.isFrozen(status.persistence), true);
});

test("my AI is Pro-only and a rejected configuration changes no state", () => {
  const provider = new AIProvider();
  assert.throws(() => provider.configure(config(), FREE), /Pro 功能/u);
  assert.equal(provider.status(FREE).mode, "off");
});

test("cloud BYO configuration never returns or exports the credential", () => {
  const provider = new AIProvider();
  const secret = config().credential;
  const status = provider.configure(config(), PRO);
  assert.equal(status.mode, "byo");
  assert.equal(status.provider, "openai");
  assert.equal(status.base_url, AI_PROVIDER_SPECS.openai.default_base_url);
  assert.equal(status.has_credential, true);
  assert.equal(status.configuration_state, "transport_unavailable");
  assert.equal(status.uses_oak_ai_quota, false);
  assert.equal(JSON.stringify(status).includes(secret), false);
  assert.equal(JSON.stringify(provider.exportConfiguration()).includes(secret), false);
  const cleared = provider.clearCredential();
  assert.equal(cleared.has_credential, false);
  assert.equal(cleared.configuration_state, "credential_required");
});

test("provider or endpoint changes cannot silently reuse a credential", () => {
  const provider = new AIProvider();
  provider.configure(config(), PRO);
  assert.throws(() => provider.configure(config({
    provider: "anthropic",
    model: "claude-test",
    credential_action: "keep",
    credential: null,
  }), PRO), /不能沿用/u);
  assert.throws(() => provider.configure(config({
    provider: "openai_compatible",
    base_url: "https://models.example.com/v1",
    credential_action: "keep",
    credential: null,
  }), PRO), /不能沿用/u);
});

test("self-hosted endpoints require HTTPS except exact loopback HTTP", () => {
  assert.equal(canonicalBaseUrl("http://localhost:11434/v1/"), "http://localhost:11434/v1");
  assert.equal(canonicalBaseUrl("http://127.0.0.1:1234/v1"), "http://127.0.0.1:1234/v1");
  assert.equal(canonicalBaseUrl("https://models.example.com/v1/"), "https://models.example.com/v1");
  assert.throws(() => canonicalBaseUrl("http://192.168.1.20:11434/v1"), /HTTPS/u);
  assert.throws(() => canonicalBaseUrl("https://user:pass@example.com/v1"), /base_url/u);
  assert.throws(() => canonicalBaseUrl("https://example.com/v1?token=secret"), /base_url/u);

  const provider = new AIProvider();
  const local = provider.configure(config({
    provider: "ollama",
    model: "qwen3:8b",
    base_url: null,
    credential_action: "clear",
    credential: null,
  }), PRO);
  assert.equal(local.endpoint_kind, "local");
  assert.equal(local.has_credential, false);
  assert.equal(local.configuration_state, "transport_unavailable");
});

test("official cloud labels are bound to their fixed endpoints", () => {
  const provider = new AIProvider();
  assert.throws(() => provider.configure(config({
    base_url: "https://attacker.example/v1",
  }), PRO), /官方云供应商地址不可修改/u);
  assert.throws(() => validateAISettingsState({
    schema_version: "1.0", store_type: "oak_manuscript_ai_settings", revision: 1,
    mode: "byo", provider: "openai", model: "gpt-5-mini",
    base_url: "https://attacker.example/v1", endpoint_kind: "cloud",
    credential: "sk-persisted-secret-value",
  }), /官方云供应商地址不可修改/u);
});

test("switching to no AI or Oak AI clears every BYO field and never performs fallback", () => {
  const provider = new AIProvider();
  provider.configure(config(), PRO);
  const oak = provider.configure({
    mode: "oak", provider: null, model: null, base_url: null,
    credential_action: "clear", credential: null,
  }, FREE);
  assert.equal(oak.mode, "oak");
  assert.equal(oak.provider, null);
  assert.equal(oak.has_credential, false);
  assert.equal(oak.configuration_state, "oak_transport_unavailable");
  assert.equal(oak.uses_oak_ai_quota, true);
  assert.equal(oak.fallback_mode, "none");
  const off = provider.configure({
    mode: "off", provider: null, model: null, base_url: null,
    credential_action: "clear", credential: null,
  }, FREE);
  assert.equal(off.mode, "off");
});

test("exact configuration and persisted state validation reject smuggled fields", () => {
  const provider = new AIProvider();
  assert.throws(() => provider.configure({ ...config(), manuscript: "secret" }, PRO), /字段集合/u);
  assert.throws(() => validateAISettingsState({
    schema_version: "1.0", store_type: "oak_manuscript_ai_settings", revision: 1,
    mode: "off", provider: null, model: null, base_url: null, endpoint_kind: null,
    credential: null, fallback: "oak",
  }), /字段集合/u);
});

test("required persistence fails closed without affecting local manuscript capabilities", () => {
  const provider = new AIProvider({ requirePersistence: true });
  assert.throws(() => provider.configure({
    mode: "off", provider: null, model: null, base_url: null,
    credential_action: "clear", credential: null,
  }, FREE), /加密 AI 设置存储不可用/u);
  assert.equal(provider.disablePersistence().persistence.state, "unavailable");
});
