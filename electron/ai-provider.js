"use strict";

const AI_MODES = Object.freeze(["off", "oak", "byo"]);
const AI_PROVIDER_SPECS = Object.freeze({
  openai: Object.freeze({
    label: "OpenAI", endpoint_kind: "cloud", default_base_url: "https://api.openai.com/v1",
    credential_required: true,
  }),
  anthropic: Object.freeze({
    label: "Anthropic", endpoint_kind: "cloud", default_base_url: "https://api.anthropic.com/v1",
    credential_required: true,
  }),
  google: Object.freeze({
    label: "Google Gemini", endpoint_kind: "cloud",
    default_base_url: "https://generativelanguage.googleapis.com/v1beta",
    credential_required: true,
  }),
  openai_compatible: Object.freeze({
    label: "OpenAI-compatible", endpoint_kind: "self_hosted", default_base_url: null,
    credential_required: false,
  }),
  ollama: Object.freeze({
    label: "Ollama", endpoint_kind: "local", default_base_url: "http://127.0.0.1:11434/v1",
    credential_required: false,
  }),
  lm_studio: Object.freeze({
    label: "LM Studio", endpoint_kind: "local", default_base_url: "http://127.0.0.1:1234/v1",
    credential_required: false,
  }),
});
const STATE_KEYS = Object.freeze([
  "schema_version", "store_type", "revision", "mode", "provider", "model", "base_url",
  "endpoint_kind", "credential",
]);
const CONFIG_KEYS = Object.freeze([
  "mode", "provider", "model", "base_url", "credential_action", "credential",
]);
const CREDENTIAL_ACTIONS = new Set(["keep", "replace", "clear"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REQUEST_BINDING_KEYS = Object.freeze([
  "schema_version", "revision", "mode", "provider", "model", "base_url",
  "endpoint_kind", "has_credential",
]);

class AIProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AIProviderError";
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

function safeModel(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/.test(value)) {
    throw new TypeError("model 非法");
  }
  return value;
}

function safeCredential(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 4_096 ||
      /[\u0000-\u001f\u007f\r\n]/u.test(value)) {
    throw new TypeError("credential 非法");
  }
  return value;
}

function canonicalBaseUrl(value, { allowDefault, defaultValue } = {}) {
  if ((value === null || value === "") && allowDefault && defaultValue) return defaultValue;
  if (typeof value !== "string" || value.length < 8 || value.length > 2_048) {
    throw new TypeError("base_url 非法");
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError("base_url 非法"); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash ||
      !["https:", "http:"].includes(parsed.protocol)) {
    throw new TypeError("base_url 非法");
  }
  if (parsed.protocol === "http:" && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new TypeError("非本机服务必须使用 HTTPS");
  }
  const pathname = parsed.pathname.replace(/\/+$/u, "") || "";
  return `${parsed.origin}${pathname}`;
}

function providerBaseUrl(spec, value) {
  const baseUrl = canonicalBaseUrl(value, {
    allowDefault: true,
    defaultValue: spec.default_base_url,
  });
  if (spec.endpoint_kind === "cloud" && baseUrl !== spec.default_base_url) {
    throw new TypeError("官方云供应商地址不可修改；自定义服务请选择 OpenAI-compatible");
  }
  return baseUrl;
}

function defaultState() {
  return {
    schema_version: "1.0",
    store_type: "oak_manuscript_ai_settings",
    revision: 0,
    mode: "off",
    provider: null,
    model: null,
    base_url: null,
    endpoint_kind: null,
    credential: null,
  };
}

function validateAISettingsState(input) {
  const state = exactKeys(input, STATE_KEYS, "AI 设置状态");
  if (state.schema_version !== "1.0" || state.store_type !== "oak_manuscript_ai_settings" ||
      !Number.isSafeInteger(state.revision) || state.revision < 0 || !AI_MODES.includes(state.mode)) {
    throw new TypeError("AI 设置状态非法");
  }
  if (state.mode !== "byo") {
    if ([state.provider, state.model, state.base_url, state.endpoint_kind, state.credential]
      .some((value) => value !== null)) {
      throw new TypeError("非我的 AI 模式不得保留供应商配置或凭据");
    }
    return state;
  }
  const spec = AI_PROVIDER_SPECS[state.provider];
  if (!spec || state.endpoint_kind !== spec.endpoint_kind || safeModel(state.model) !== state.model ||
      providerBaseUrl(spec, state.base_url) !== state.base_url) {
    throw new TypeError("我的 AI 配置非法");
  }
  if (state.credential !== null) safeCredential(state.credential);
  return state;
}

function requirePro(licenseStatus) {
  if (!licenseStatus || licenseStatus.effectiveTier !== "pro") {
    throw new AIProviderError("PRO_REQUIRED", "我的 AI 是 Pro 功能；本地项目、检查与导出不受影响");
  }
}

class AIProvider {
  constructor({ requirePersistence = false } = {}) {
    this.requirePersistence = requirePersistence === true;
    this.state = defaultState();
    this.store = null;
    this.transport = null;
    this.persistence = this.requirePersistence
      ? { state: "not_configured", encrypted: false, persistent: false }
      : { state: "memory_only", encrypted: false, persistent: false };
  }

  configureTransport(transport) {
    if (!transport || typeof transport.supports !== "function" ||
        typeof transport.request !== "function") {
      throw new TypeError("AI transport 非法");
    }
    this.transport = transport;
    return this.status();
  }

  _transportConfigured() {
    if (this.state.mode !== "byo" || !this.transport) return false;
    try {
      return this.transport.supports({ mode: "byo", provider: this.state.provider }) === true;
    } catch { return false; }
  }

  configurePersistence(store) {
    if (!store || store.encrypted !== true || typeof store.load !== "function" ||
        typeof store.save !== "function") {
      throw new TypeError("AI 设置存储必须是加密持久存储");
    }
    const loaded = store.load();
    this.state = loaded === null ? defaultState() : validateAISettingsState(loaded);
    this.store = store;
    this.persistence = { state: "ready", encrypted: true, persistent: true };
    return this.status();
  }

  disablePersistence() {
    this.store = null;
    this.state = defaultState();
    this.persistence = { state: "unavailable", encrypted: false, persistent: false };
    return this.status();
  }

  _commit(next) {
    validateAISettingsState(next);
    if (this.requirePersistence && !this.store) {
      throw new AIProviderError("SECURE_STORAGE_UNAVAILABLE",
        "系统加密 AI 设置存储不可用，拒绝保存配置或凭据");
    }
    if (this.store) this.store.save(next, { expectedRevision: this.state.revision });
    this.state = next;
  }

  configure(input, licenseStatus) {
    exactKeys(input, CONFIG_KEYS, "AI 配置");
    if (!AI_MODES.includes(input.mode) || !CREDENTIAL_ACTIONS.has(input.credential_action)) {
      throw new TypeError("AI 模式或凭据动作非法");
    }
    if (input.mode !== "byo") {
      if ([input.provider, input.model, input.base_url, input.credential]
        .some((value) => value !== null) || input.credential_action !== "clear") {
        throw new TypeError("非我的 AI 模式只能清除供应商配置与凭据");
      }
      this._commit({ ...defaultState(), revision: this.state.revision + 1, mode: input.mode });
      return this.status(licenseStatus);
    }

    requirePro(licenseStatus);
    const spec = AI_PROVIDER_SPECS[input.provider];
    if (!spec) throw new TypeError("AI provider 非法");
    const model = safeModel(input.model);
    const baseUrl = providerBaseUrl(spec, input.base_url);
    let credential = null;
    if (input.credential_action === "replace") credential = safeCredential(input.credential);
    else {
      if (input.credential !== null) throw new TypeError("未替换凭据时 credential 必须为空");
      if (input.credential_action === "keep") {
        if (this.state.mode !== "byo" || this.state.provider !== input.provider ||
            this.state.base_url !== baseUrl) {
          throw new AIProviderError("CREDENTIAL_REBIND_REQUIRED",
            "供应商或地址变化后不能沿用旧凭据");
        }
        credential = this.state.credential;
      }
    }
    this._commit({
      schema_version: "1.0",
      store_type: "oak_manuscript_ai_settings",
      revision: this.state.revision + 1,
      mode: "byo",
      provider: input.provider,
      model,
      base_url: baseUrl,
      endpoint_kind: spec.endpoint_kind,
      credential,
    });
    return this.status(licenseStatus);
  }

  clearCredential() {
    if (this.state.mode !== "byo" || this.state.credential === null) return this.status();
    this._commit({ ...this.state, revision: this.state.revision + 1, credential: null });
    return this.status();
  }

  status(licenseStatus = null) {
    const spec = this.state.provider === null ? null : AI_PROVIDER_SPECS[this.state.provider];
    const proEligible = licenseStatus ? licenseStatus.effectiveTier === "pro" : null;
    const hasCredential = this.state.credential !== null;
    const needsCredential = this.state.mode === "byo" && spec.credential_required && !hasCredential;
    const transportConfigured = !needsCredential && this._transportConfigured();
    const configurationState = this.state.mode === "off"
      ? "disabled"
      : this.state.mode === "oak"
        ? "oak_transport_unavailable"
        : needsCredential
          ? "credential_required"
          : transportConfigured ? "ready" : "transport_unavailable";
    const message = this.state.mode === "off"
      ? "当前不使用 AI；确定性检查、机械修复与导出均可正常使用。"
      : this.state.mode === "oak"
        ? "已选择湖岸 AI，但生产模型服务尚未配置；不会发起网络请求。"
        : needsCredential
          ? "我的 AI 配置已保存，但该供应商仍需要凭据；当前不会发起网络请求。"
          : transportConfigured
            ? "我的 AI 已就绪；只有在你预览内容并确认一次后才会发送请求。"
            : "我的 AI 配置与凭据已由主进程保存；该供应商 transport 尚未实现，当前不会发起网络请求。";
    return Object.freeze({
      schema_version: "1.0",
      mode: this.state.mode,
      provider: this.state.provider,
      provider_label: spec ? spec.label : null,
      model: this.state.model,
      base_url: this.state.base_url,
      endpoint_kind: this.state.endpoint_kind,
      has_credential: hasCredential,
      credential_required: Boolean(spec && spec.credential_required),
      persistence: Object.freeze({ ...this.persistence }),
      pro_eligible: proEligible,
      configuration_state: configurationState,
      transport_configured: transportConfigured,
      fallback_mode: "none",
      output_policy: "suggestion_only",
      automatic_writeback: false,
      uses_oak_ai_quota: this.state.mode === "oak",
      credential_sync: "never",
      message,
    });
  }

  requestBinding(licenseStatus = null) {
    if (this.state.mode === "off") {
      throw new AIProviderError("AI_DISABLED", "请先在设置中选择湖岸 AI 或我的 AI");
    }
    if (this.state.mode === "byo") {
      requirePro(licenseStatus);
      const spec = AI_PROVIDER_SPECS[this.state.provider];
      if (spec.credential_required && this.state.credential === null) {
        throw new AIProviderError("CREDENTIAL_REQUIRED", "当前供应商需要 API 凭据");
      }
    }
    return Object.freeze({
      schema_version: "1.0",
      revision: this.state.revision,
      mode: this.state.mode,
      provider: this.state.provider,
      model: this.state.model,
      base_url: this.state.base_url,
      endpoint_kind: this.state.endpoint_kind,
      has_credential: this.state.credential !== null,
    });
  }

  async withRequestCredential(binding, licenseStatus, operation) {
    exactKeys(binding, REQUEST_BINDING_KEYS, "AI 请求绑定");
    if (typeof operation !== "function") throw new TypeError("AI 请求操作非法");
    const current = this.requestBinding(licenseStatus);
    if (JSON.stringify(current) !== JSON.stringify(binding)) {
      throw new AIProviderError("AI_PLAN_STALE", "AI 配置已变化；请重新预览发送内容");
    }
    return operation(Object.freeze({
      mode: this.state.mode,
      provider: this.state.provider,
      model: this.state.model,
      base_url: this.state.base_url,
      endpoint_kind: this.state.endpoint_kind,
      credential: this.state.credential,
    }));
  }

  exportConfiguration() {
    const status = this.status();
    return Object.freeze({
      schema_version: status.schema_version,
      mode: status.mode,
      provider: status.provider,
      model: status.model,
      base_url: status.base_url,
    });
  }
}

module.exports = {
  AI_MODES,
  AI_PROVIDER_SPECS,
  AIProviderError,
  AIProvider,
  canonicalBaseUrl,
  providerBaseUrl,
  REQUEST_BINDING_KEYS,
  validateAISettingsState,
};
