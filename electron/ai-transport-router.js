"use strict";

const { AI_PROVIDER_SPECS, providerBaseUrl } = require("./ai-provider");
const { AIHttpClientError } = require("./ai-http-client");

const CONFIGURATION_KEYS = Object.freeze([
  "mode", "provider", "model", "base_url", "endpoint_kind", "credential",
]);
const SEMANTIC_REQUEST_KEYS = Object.freeze([
  "system_instruction", "user_instruction", "issue_context",
]);
const RESULT_KEYS = Object.freeze(["text"]);
const MAX_ADAPTERS = 6;
const MAX_TEXT_BYTES = 32 * 1024;

class AITransportRouterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AITransportRouterError";
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

function validateConfiguration(input) {
  const value = exactKeys(input, CONFIGURATION_KEYS, "AI transport 配置");
  const spec = AI_PROVIDER_SPECS[value.provider];
  if (value.mode !== "byo" || !spec || value.endpoint_kind !== spec.endpoint_kind ||
      typeof value.model !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/u.test(value.model) ||
      typeof value.base_url !== "string" || value.base_url.length < 1 ||
      value.base_url.length > 2_048 ||
      (value.credential !== null && (typeof value.credential !== "string" ||
        value.credential.length < 8 || value.credential.length > 4_096 ||
        /[\u0000-\u001f\u007f]/u.test(value.credential))) ||
      (spec.credential_required && value.credential === null)) {
    throw new TypeError("AI transport 配置非法");
  }
  try {
    if (providerBaseUrl(spec, value.base_url) !== value.base_url) {
      throw new TypeError("AI transport 地址非法");
    }
  } catch { throw new TypeError("AI transport 地址非法"); }
  return value;
}

function validateSemanticRequest(input) {
  const value = exactKeys(input, SEMANTIC_REQUEST_KEYS, "AI 语义请求");
  if (typeof value.system_instruction !== "string" || !value.system_instruction ||
      typeof value.user_instruction !== "string" || !value.user_instruction ||
      !value.issue_context || typeof value.issue_context !== "object" ||
      Array.isArray(value.issue_context)) {
    throw new TypeError("AI 语义请求非法");
  }
  return value;
}

function validateAdapters(adapters) {
  if (!(adapters instanceof Map) || adapters.size > MAX_ADAPTERS) {
    throw new TypeError("AI 供应商适配器注册表非法");
  }
  const output = new Map();
  for (const [provider, adapter] of adapters) {
    if (!Object.hasOwn(AI_PROVIDER_SPECS, provider) || !adapter ||
        typeof adapter !== "object" || Array.isArray(adapter) ||
        Object.keys(adapter).sort().join(",") !== "buildRequest,parseResponse" ||
        typeof adapter.buildRequest !== "function" ||
        typeof adapter.parseResponse !== "function") {
      throw new TypeError("AI 供应商适配器非法");
    }
    output.set(provider, Object.freeze({
      buildRequest: adapter.buildRequest,
      parseResponse: adapter.parseResponse,
    }));
  }
  return output;
}

class AITransportRouter {
  constructor({ httpClient, adapters = new Map() } = {}) {
    if (!httpClient || typeof httpClient.requestJson !== "function") {
      throw new TypeError("AI transport HTTP 客户端非法");
    }
    this.httpClient = httpClient;
    this.adapters = validateAdapters(adapters);
  }

  supports(binding) {
    return Boolean(binding && typeof binding === "object" && binding.mode === "byo" &&
      typeof binding.provider === "string" && this.adapters.has(binding.provider));
  }

  async request(input) {
    const envelope = exactKeys(input, ["configuration", "request"], "AI transport 请求");
    const configuration = validateConfiguration(envelope.configuration);
    const semanticRequest = validateSemanticRequest(envelope.request);
    const adapter = this.adapters.get(configuration.provider);
    if (!adapter) {
      throw new AITransportRouterError(
        "PROVIDER_UNAVAILABLE", "当前 AI 供应商 transport 尚未配置",
      );
    }
    let descriptor;
    try {
      descriptor = adapter.buildRequest(configuration, semanticRequest);
      if (!descriptor || typeof descriptor !== "object" ||
          typeof descriptor.url !== "string" ||
          (configuration.credential && descriptor.url.includes(configuration.credential))) {
        throw new TypeError("AI 供应商请求描述非法");
      }
    } catch {
      throw new AITransportRouterError("ADAPTER_FAILED", "AI 供应商请求适配失败");
    }
    let upstream;
    try {
      upstream = await this.httpClient.requestJson(descriptor);
    } catch (error) {
      if (error instanceof AIHttpClientError) throw error;
      throw new AITransportRouterError("NETWORK_FAILED", "AI 网络请求失败");
    }
    if (configuration.credential) {
      let serialized;
      try { serialized = JSON.stringify(upstream); } catch { serialized = ""; }
      if (serialized.includes(configuration.credential)) {
        throw new AITransportRouterError("CREDENTIAL_ECHO", "AI 响应包含受保护凭据，已拒绝显示");
      }
    }
    let parsed;
    try { parsed = adapter.parseResponse(upstream); }
    catch { throw new AITransportRouterError("ADAPTER_FAILED", "AI 供应商响应适配失败"); }
    const result = exactKeys(parsed, RESULT_KEYS, "AI transport 结果");
    if (typeof result.text !== "string" || result.text.length < 1 ||
        Buffer.byteLength(result.text, "utf8") > MAX_TEXT_BYTES ||
        (configuration.credential && result.text.includes(configuration.credential))) {
      throw new AITransportRouterError("INVALID_RESULT", "AI 供应商响应内容非法");
    }
    return Object.freeze({ text: result.text });
  }
}

module.exports = {
  AITransportRouter,
  AITransportRouterError,
  CONFIGURATION_KEYS,
  MAX_ADAPTERS,
  MAX_TEXT_BYTES,
  SEMANTIC_REQUEST_KEYS,
  validateAdapters,
  validateConfiguration,
  validateSemanticRequest,
};
