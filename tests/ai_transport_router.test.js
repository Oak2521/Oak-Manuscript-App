"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { AIHttpClientError } = require("../electron/ai-http-client");
const {
  AITransportRouter,
  AITransportRouterError,
  validateAdapters,
  validateConfiguration,
  validateSemanticRequest,
} = require("../electron/ai-transport-router");

const SECRET = "sk-router-secret-never-return";

function configuration(overrides = {}) {
  return {
    mode: "byo",
    provider: "openai",
    model: "gpt-fixed",
    base_url: "https://api.openai.com/v1",
    endpoint_kind: "cloud",
    credential: SECRET,
    ...overrides,
  };
}

function semanticRequest(overrides = {}) {
  return {
    system_instruction: "只处理当前单条问题。",
    user_instruction: "请解释并给出建议。",
    issue_context: { rule_id: "CN-001", preview: "湖岸  稿件" },
    ...overrides,
  };
}

function adapter(overrides = {}) {
  return {
    buildRequest: (config, request) => ({
      url: `${config.base_url}/responses`,
      headers: { Authorization: `Bearer ${config.credential}` },
      json: { model: config.model, request },
    }),
    parseResponse: (json) => ({ text: json.output_text }),
    ...overrides,
  };
}

test("router exposes only registered BYO providers and bridges one exact request", async () => {
  const calls = [];
  const router = new AITransportRouter({
    httpClient: {
      requestJson: async (descriptor) => {
        calls.push(descriptor);
        return { output_text: "建议删除一个空格。" };
      },
    },
    adapters: new Map([["openai", adapter()]]),
  });
  assert.equal(router.supports({ mode: "byo", provider: "openai" }), true);
  assert.equal(router.supports({ mode: "oak", provider: "openai" }), false);
  assert.equal(router.supports({ mode: "byo", provider: "anthropic" }), false);
  const result = await router.request({
    configuration: configuration(), request: semanticRequest(),
  });
  assert.deepEqual(result, { text: "建议删除一个空格。" });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(calls[0].json.model, "gpt-fixed");
});

test("router rejects unregistered providers and every smuggled envelope field before HTTP", async () => {
  let calls = 0;
  const router = new AITransportRouter({
    httpClient: { requestJson: async () => { calls += 1; return {}; } },
    adapters: new Map(),
  });
  await assert.rejects(
    () => router.request({ configuration: configuration(), request: semanticRequest() }),
    (error) => error.code === "PROVIDER_UNAVAILABLE",
  );
  await assert.rejects(
    () => router.request({
      configuration: configuration(), request: semanticRequest(), manuscript: "secret",
    }), /字段集合/u,
  );
  assert.equal(calls, 0);
});

test("configuration and semantic request boundaries independently reject drift", () => {
  for (const value of [
    configuration({ mode: "oak" }),
    configuration({ base_url: "https://attacker.test/v1" }),
    configuration({ credential: null }),
    configuration({ credential: `${SECRET}\nsmuggled` }),
    configuration({ model: "bad model" }),
    { ...configuration(), fallback: "oak" },
  ]) assert.throws(() => validateConfiguration(value), /非法|字段集合/u);
  for (const value of [
    { ...semanticRequest(), manuscript: "secret" },
    semanticRequest({ issue_context: null }),
    semanticRequest({ system_instruction: "" }),
  ]) assert.throws(() => validateSemanticRequest(value), /非法|字段集合/u);
});

test("adapter registry is exact, known, bounded, and immutable from caller replacement", async () => {
  const original = adapter();
  const adapters = new Map([["openai", original]]);
  const validated = validateAdapters(adapters);
  adapters.set("anthropic", adapter());
  original.parseResponse = () => ({ text: "caller replacement" });
  assert.equal(validated.size, 1);
  assert.equal(validated.has("anthropic"), false);
  assert.throws(() => validateAdapters({ openai: adapter() }), /注册表/u);
  assert.throws(() => validateAdapters(new Map([["unknown", adapter()]])), /适配器/u);
  assert.throws(() => validateAdapters(new Map([["openai", {
    ...adapter(), extra: () => {},
  }]])), /适配器/u);
});

test("credential in URL or upstream response is rejected before it can reach the UI", async () => {
  let calls = 0;
  const urlLeak = new AITransportRouter({
    httpClient: { requestJson: async () => { calls += 1; return {}; } },
    adapters: new Map([["openai", adapter({
      buildRequest: (config) => ({
        url: `${config.base_url}/responses/${config.credential}`, headers: {}, json: {},
      }),
    })]]),
  });
  await assert.rejects(
    () => urlLeak.request({ configuration: configuration(), request: semanticRequest() }),
    (error) => error.code === "ADAPTER_FAILED" && !error.message.includes(SECRET),
  );
  assert.equal(calls, 0);

  const responseLeak = new AITransportRouter({
    httpClient: { requestJson: async () => ({ output_text: `echo ${SECRET}` }) },
    adapters: new Map([["openai", adapter()]]),
  });
  await assert.rejects(
    () => responseLeak.request({ configuration: configuration(), request: semanticRequest() }),
    (error) => error.code === "CREDENTIAL_ECHO" && !error.message.includes(SECRET),
  );
});

test("adapter failures, arbitrary network errors, and invalid parsed results are sanitized", async () => {
  const cases = [
    {
      httpClient: { requestJson: async () => ({ output_text: "unused" }) },
      adapter: adapter({ buildRequest: () => { throw new Error(`leak ${SECRET}`); } }),
      code: "ADAPTER_FAILED",
    },
    {
      httpClient: { requestJson: async () => { throw new Error(`leak ${SECRET}`); } },
      adapter: adapter(),
      code: "NETWORK_FAILED",
    },
    {
      httpClient: { requestJson: async () => ({ output_text: "ok" }) },
      adapter: adapter({ parseResponse: () => ({ text: "ok", raw: SECRET }) }),
      code: undefined,
    },
  ];
  for (const item of cases) {
    const router = new AITransportRouter({
      httpClient: item.httpClient,
      adapters: new Map([["openai", item.adapter]]),
    });
    await assert.rejects(
      () => router.request({ configuration: configuration(), request: semanticRequest() }),
      (error) => (error instanceof AITransportRouterError || error instanceof TypeError) &&
        !error.message.includes(SECRET) && (item.code === undefined || error.code === item.code),
    );
  }

  const safeNetwork = new AITransportRouter({
    httpClient: { requestJson: async () => {
      throw new AIHttpClientError("NETWORK_TIMEOUT", "AI 网络请求超时");
    } },
    adapters: new Map([["openai", adapter()]]),
  });
  await assert.rejects(
    () => safeNetwork.request({ configuration: configuration(), request: semanticRequest() }),
    (error) => error instanceof AIHttpClientError && error.code === "NETWORK_TIMEOUT",
  );
});
