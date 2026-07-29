"use strict";

const crypto = require("node:crypto");
const { REDIRECT_URI } = require("./desktop-auth-config");
const { validToken } = require("./auth-http-client");

const EMPTY_STATE = Object.freeze({ schema_version: "1.0", store_type: "oak_manuscript_auth_session", revision: 0, session: null, pending: null });
const PENDING_TTL_MS = 10 * 60 * 1000;
const REFRESH_WINDOW_MS = 60 * 1000;

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function iso(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value; }
function accountId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) throw new Error("账号会话状态错误：account_id 非法");
  return value;
}
function validateState(value) {
  if (!exactKeys(value, ["schema_version", "store_type", "revision", "session", "pending"]) ||
      value.schema_version !== "1.0" || value.store_type !== "oak_manuscript_auth_session" ||
      !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("账号会话状态错误：顶层结构非法");
  if (value.session !== null) {
    const session = value.session;
    if (!exactKeys(session, ["account_id", "access_token", "refresh_token", "token_type", "issued_at", "expires_at", "refresh_expires_at"]) ||
        !validToken(session.access_token) || !validToken(session.refresh_token) || session.token_type !== "bearer" ||
        !iso(session.issued_at) || !iso(session.expires_at) || (session.refresh_expires_at !== null && !iso(session.refresh_expires_at))) {
      throw new Error("账号会话状态错误：session 非法");
    }
    accountId(session.account_id);
  }
  if (value.pending !== null) {
    const pending = value.pending;
    if (!exactKeys(pending, ["state", "code_verifier", "redirect_uri", "created_at", "expires_at"]) ||
        typeof pending.state !== "string" || !/^[A-Za-z0-9_-]{43,128}$/u.test(pending.state) ||
        typeof pending.code_verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/u.test(pending.code_verifier) ||
        pending.redirect_uri !== REDIRECT_URI || !iso(pending.created_at) || !iso(pending.expires_at)) {
      throw new Error("账号会话状态错误：pending 非法");
    }
  }
  return value;
}
function b64url(bytes) { return Buffer.from(bytes).toString("base64url"); }
function callbackUrl(value) {
  if (typeof value !== "string" || value.length > 8192) throw new Error("账号回调非法");
  let parsed; try { parsed = new URL(value); } catch { throw new Error("账号回调非法"); }
  if (parsed.protocol !== "oak-manuscript-auth:" || parsed.hostname !== "callback" || parsed.pathname !== "" || parsed.hash ||
      parsed.username || parsed.password || [...parsed.searchParams.keys()].sort().join("\0") !== ["code", "state"].sort().join("\0") ||
      parsed.searchParams.getAll("code").length !== 1 || parsed.searchParams.getAll("state").length !== 1) throw new Error("账号回调非法");
  const code = parsed.searchParams.get("code"); const state = parsed.searchParams.get("state");
  if (!code || code.length < 16 || code.length > 4096 || /[\s\0]/u.test(code) || !/^[A-Za-z0-9_-]{43,128}$/u.test(state || "")) throw new Error("账号回调参数非法");
  return { code, state };
}

class DesktopAuthProvider {
  constructor({ config, store = null, client = null, openExternal = null, clock = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
    if (!config || !["pending_configuration", "configured"].includes(config.status)) throw new TypeError("桌面账号配置非法");
    this.config = config; this.store = store; this.client = client; this.openExternal = openExternal; this.clock = clock; this.randomBytes = randomBytes;
    this.callbackInFlight = false;
    this.state = EMPTY_STATE; this.available = config.status === "pending_configuration";
    if (config.status === "configured") {
      if (!store || typeof store.load !== "function" || typeof store.save !== "function" || !client ||
          typeof client.exchangeAuthorizationCode !== "function" || typeof client.refresh !== "function" || typeof client.identity !== "function" ||
          typeof openExternal !== "function") throw new TypeError("已配置账号提供方依赖不完整");
      const loaded = store.load(); this.state = validateState(loaded === null ? EMPTY_STATE : loaded); this.available = true;
    }
  }
  _save(changes) {
    const next = validateState({ ...this.state, ...changes, revision: this.state.revision + 1 });
    this.state = this.store.save(next, { expectedRevision: this.state.revision }); return this.state;
  }
  status() {
    if (this.config.status !== "configured") return { state: "signed_out", loggedIn: false, accountId: null, sessionExpiresAt: null, authMode: "system_browser_pkce", productionConfigured: false, message: "湖岸统一账号尚未接入生产服务；当前不会打开登录页或发起网络请求。" };
    if (!this.available) return { state: "unavailable", loggedIn: false, accountId: null, sessionExpiresAt: null, authMode: "system_browser_pkce", productionConfigured: true, message: "系统加密账号存储不可用；登录与同步已安全停止。" };
    const session = this.state.session; const expired = session && Date.parse(session.expires_at) <= this.clock().getTime();
    return session ? { state: expired ? "expired" : "authenticated", loggedIn: !expired, accountId: expired ? null : session.account_id, sessionExpiresAt: expired ? null : session.expires_at, authMode: "system_browser_pkce", productionConfigured: true, message: expired ? "湖岸账号会话已过期；需要重新登录。" : "已登录湖岸统一账号；结果仍只在你明确点击发送后同步。" }
      : { state: "signed_out", loggedIn: false, accountId: null, sessionExpiresAt: null, authMode: "system_browser_pkce", productionConfigured: true, message: "尚未登录湖岸统一账号。" };
  }
  async beginLogin() {
    if (this.config.status !== "configured") return { state: "configuration_required", opened: false, authMode: "system_browser_pkce", message: "生产账号服务尚未配置，未发起网络请求。" };
    if (!this.available) throw new Error("系统加密账号存储不可用");
    const verifier = b64url(this.randomBytes(64)); const state = b64url(this.randomBytes(32));
    const now = this.clock(); const pending = { state, code_verifier: verifier, redirect_uri: REDIRECT_URI, created_at: now.toISOString(), expires_at: new Date(now.getTime() + PENDING_TTL_MS).toISOString() };
    this._save({ pending });
    const url = new URL(this.config.authorization_endpoint);
    url.searchParams.set("response_type", "code"); url.searchParams.set("client_id", this.config.client_id);
    url.searchParams.set("redirect_uri", REDIRECT_URI); url.searchParams.set("scope", this.config.scopes.join(" "));
    url.searchParams.set("state", state); url.searchParams.set("code_challenge", b64url(crypto.createHash("sha256").update(verifier, "ascii").digest()));
    url.searchParams.set("code_challenge_method", "S256");
    await this.openExternal(url.toString());
    return { state: "awaiting_callback", opened: true, authMode: "system_browser_pkce", message: "已在系统浏览器打开湖岸账号页面；请完成登录。" };
  }
  async handleCallback(value) {
    if (this.config.status !== "configured" || !this.available) throw new Error("湖岸账号尚未配置或不可用");
    if (this.callbackInFlight) throw new Error("账号回调正在处理，拒绝并发重放");
    const { code, state } = callbackUrl(value); const pending = this.state.pending;
    if (!pending || Date.parse(pending.expires_at) <= this.clock().getTime() ||
        pending.state.length !== state.length || !crypto.timingSafeEqual(Buffer.from(pending.state), Buffer.from(state))) {
      throw new Error("账号回调已过期、已使用或 state 不匹配");
    }
    this.callbackInFlight = true;
    try {
      const tokens = await this.client.exchangeAuthorizationCode({ code, codeVerifier: pending.code_verifier });
      const identity = await this.client.identity(tokens.access_token); const now = this.clock();
      const session = { account_id: accountId(identity.accountId), access_token: tokens.access_token, refresh_token: tokens.refresh_token, token_type: "bearer", issued_at: now.toISOString(), expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(), refresh_expires_at: null };
      this._save({ session, pending: null }); return this.status();
    } finally { this.callbackInFlight = false; }
  }
  async accessToken({ accountId: expected } = {}) {
    if (this.config.status !== "configured" || !this.available || !this.state.session || this.state.session.account_id !== expected) throw new Error("湖岸账号会话无效或账号不匹配");
    if (Date.parse(this.state.session.expires_at) - this.clock().getTime() <= REFRESH_WINDOW_MS) {
      const tokens = await this.client.refresh(this.state.session.refresh_token); const identity = await this.client.identity(tokens.access_token);
      if (identity.accountId !== expected) { this._save({ session: null, pending: null }); throw new Error("刷新后的账号身份不匹配"); }
      const now = this.clock(); this._save({ session: { account_id: expected, access_token: tokens.access_token, refresh_token: tokens.refresh_token, token_type: "bearer", issued_at: now.toISOString(), expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(), refresh_expires_at: null }, pending: null });
    }
    return Object.freeze({ accountId: expected, accessToken: this.state.session.access_token });
  }
  async logout() {
    if (this.config.status === "configured" && this.available) this._save({ session: null, pending: null });
    return this.status();
  }
}

module.exports = { DesktopAuthProvider, EMPTY_STATE, PENDING_TTL_MS, REFRESH_WINDOW_MS, callbackUrl, validateState };
