"use strict";
const crypto = require("node:crypto");
const { LoopbackAuthListener } = require("./loopback-auth-listener");
const { verifyDesktopAccessToken, UUID } = require("./oak-account-token");
const EMPTY_STATE = Object.freeze({ schema_version: "2.0", store_type: "oak_manuscript_application_login", revision: 0, session: null, pending: null });
const PENDING_TTL_MS = 600000; const REFRESH_WINDOW_MS = 60000; const REFRESH_IDLE_MS = 604800000; const REFRESH_ABSOLUTE_MS = 2592000000;
function exact(v, keys) { return v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join("\0") === [...keys].sort().join("\0"); }
function iso(v) { return typeof v === "string" && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v; }
function token(v) { return typeof v === "string" && /^[A-Za-z0-9_-]{43,512}$/u.test(v); }
function validateState(value) {
  if (!exact(value, ["schema_version", "store_type", "revision", "session", "pending"]) || value.schema_version !== "2.0" || value.store_type !== "oak_manuscript_application_login" || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("账号会话状态错误：顶层结构非法");
  if (value.session !== null && (!exact(value.session, ["oak_account_id", "session_id", "refresh_token", "refresh_issued_at", "refresh_last_used_at", "refresh_expires_at"]) || !UUID.test(value.session.oak_account_id || "") || !UUID.test(value.session.session_id || "") || !token(value.session.refresh_token) || ![value.session.refresh_issued_at, value.session.refresh_last_used_at, value.session.refresh_expires_at].every(iso))) throw new Error("账号会话状态错误：session 非法");
  if (value.pending !== null && (!exact(value.pending, ["state", "code_verifier", "redirect_uri", "created_at", "expires_at"]) || !token(value.pending.state) || !/^[A-Za-z0-9._~-]{43,128}$/u.test(value.pending.code_verifier || "") || !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}\/application-login\/callback\/[A-Za-z0-9_-]{43,128}$/u.test(value.pending.redirect_uri || "") || !iso(value.pending.created_at) || !iso(value.pending.expires_at))) throw new Error("账号会话状态错误：pending 非法");
  return value;
}
function b64(bytes) { return Buffer.from(bytes).toString("base64url"); }
class DesktopAuthProvider {
  constructor({ config, store = null, client = null, openExternal = null, clock = () => new Date(), randomBytes = crypto.randomBytes, listenerFactory = (options) => new LoopbackAuthListener(options), secureStorageAvailable = true } = {}) {
    this.config = config; this.store = store; this.client = client; this.openExternal = openExternal; this.clock = clock; this.randomBytes = randomBytes; this.listenerFactory = listenerFactory; this.access = null; this.listener = null; this.lifecycle = null;
    this.available = config?.status === "pending_configuration" || (secureStorageAvailable && store?.encrypted === true && client && typeof openExternal === "function"); this.state = EMPTY_STATE;
    if (config?.status === "configured" && this.available) { this.state = validateState(store.load() || EMPTY_STATE); if (this.state.pending) this._save({ pending: null }); }
  }
  _save(changes) { const old = this.state.revision; const next = validateState({ ...this.state, ...changes, revision: old + 1 }); this.state = validateState(this.store.save(next, { expectedRevision: old })); return this.state; }
  _clear(lifecycle = null) { this.access = null; this.listener?.close(); this.listener = null; if (this.config.status === "configured" && this.available) this._save({ session: null, pending: null }); this.lifecycle = lifecycle; }
  status() {
    const base = { loggedIn: false, oakAccountId: null, sessionExpiresAt: null, authMode: "system_browser_application_login_pkce", productionConfigured: this.config.status === "configured" };
    if (this.config.status !== "configured") return { ...base, state: "signed_out", message: "湖岸账号 application-login 服务尚未配置；当前不会联网。" };
    if (!this.available) return { ...base, state: "unavailable", message: "系统安全凭据存储不可用；登录与远端操作已安全停止。" };
    if (this.lifecycle) return { ...base, state: this.lifecycle, message: "账户状态已停止新的远端操作；本地项目仍可打开、编辑和导出。" };
    if (!this.state.session) return { ...base, state: "signed_out", message: "尚未登录湖岸账号。" };
    return { ...base, state: "authenticated", loggedIn: true, oakAccountId: this.state.session.oak_account_id, sessionExpiresAt: this.state.session.refresh_expires_at, message: "已登录湖岸账号；登录不等于同意同步。" };
  }
  async beginLogin() {
    if (this.config.status !== "configured") return { state: "configuration_required", opened: false, authMode: "system_browser_application_login_pkce", message: "账号服务尚未配置，未发起网络请求。" };
    if (!this.available) throw new Error("SECURE_STORAGE_REQUIRED"); if (this.listener?.active) throw new Error("登录正在进行");
    const state = b64(this.randomBytes(32)); const verifier = b64(this.randomBytes(32)); const pathNonce = b64(this.randomBytes(32));
    const listener = this.listenerFactory({ pathNonce, expectedState: state, timeoutMs: PENDING_TTL_MS, onCallback: (v) => this._complete(v), onReject: () => { if (this.state.pending?.state === state) this._save({ pending: null }); } });
    const { redirectUri } = await listener.start(); this.listener = listener; const now = this.clock(); const expires = new Date(now.getTime() + PENDING_TTL_MS).toISOString();
    this._save({ pending: { state, code_verifier: verifier, redirect_uri: redirectUri, created_at: now.toISOString(), expires_at: expires } });
    const url = new URL("/application-login/start", this.config.account_center_origin); url.search = new URLSearchParams({ schema_version: "oak-desktop-login-authorization/1.0", application_id: this.config.application_id, redirect_uri: redirectUri, state, code_challenge: b64(crypto.createHash("sha256").update(verifier, "ascii").digest()), code_challenge_method: "S256", request_expires_at: expires }).toString();
    try { await this.openExternal(url.toString()); } catch { listener.close(); this.listener = null; this._save({ pending: null }); throw new Error("无法打开系统浏览器；本次登录已取消"); }
    return { state: "awaiting_callback", opened: true, authMode: "system_browser_application_login_pkce", message: "已在系统浏览器打开湖岸账号页面。" };
  }
  async _complete({ code, state, redirectUri }) {
    const pending = this.state.pending; if (!pending || redirectUri !== pending.redirect_uri || Date.parse(pending.expires_at) <= this.clock().getTime() || state !== pending.state) throw new Error("账号回调已过期、已使用或不匹配");
    this._save({ pending: null }); this.listener = null;
    const response = await this.client.exchangeAuthorizationCode({ code, codeVerifier: pending.code_verifier, redirectUri }); const claims = verifyDesktopAccessToken(response.access_token, response.claims, { config: this.config, clock: this.clock }); const now = this.clock().toISOString();
    this._save({ session: { oak_account_id: claims.oak_account_id, session_id: claims.sid, refresh_token: response.refresh_token, refresh_issued_at: now, refresh_last_used_at: now, refresh_expires_at: response.refresh_expires_at }, pending: null }); this.access = { token: response.access_token, oakAccountId: claims.oak_account_id, expiresAt: claims.exp * 1000 }; this.lifecycle = null; return this.status();
  }
  async accessToken({ oakAccountId } = {}) {
    if (!this.available || !this.state.session || this.lifecycle || this.state.session.oak_account_id !== oakAccountId) throw new Error("湖岸账号会话无效或账号不匹配"); const now = this.clock().getTime();
    if (this.access && this.access.oakAccountId === oakAccountId && this.access.expiresAt - now > REFRESH_WINDOW_MS) return Object.freeze({ oakAccountId, accessToken: this.access.token });
    const s = this.state.session; if (now - Date.parse(s.refresh_last_used_at) > REFRESH_IDLE_MS || now - Date.parse(s.refresh_issued_at) > REFRESH_ABSOLUTE_MS || now >= Date.parse(s.refresh_expires_at)) { this._clear(); throw new Error("刷新凭据已过期，需要重新登录"); }
    let response;
    try {
      response = await this.client.refresh(s.refresh_token);
    } catch (error) {
      if (error?.code === "AUTH_REJECTED") this._clear();
      throw error;
    }
    const claims = verifyDesktopAccessToken(response.access_token, response.claims, { config: this.config, clock: this.clock }); if (claims.oak_account_id !== oakAccountId || response.refresh_token === s.refresh_token) throw new Error("刷新轮换或账号绑定非法");
    this._save({ session: { ...s, session_id: claims.sid, refresh_token: response.refresh_token, refresh_last_used_at: this.clock().toISOString(), refresh_expires_at: response.refresh_expires_at } }); this.access = { token: response.access_token, oakAccountId, expiresAt: claims.exp * 1000 }; return Object.freeze({ oakAccountId, accessToken: response.access_token });
  }
  applyAccountLifecycle(status) { if (!["active", "suspended", "deletion_pending", "deleted"].includes(status)) throw new Error("账户生命周期状态非法"); if (status !== "active") this._clear(status); return this.status(); }
  async logout() { const refresh = this.state.session?.refresh_token || null; this._clear(); if (!refresh) return this.status(); try { await this.client.revoke(refresh); return this.status(); } catch { this.lifecycle = "local_signed_out_remote_revocation_unconfirmed"; return this.status(); } }
}
module.exports = { DesktopAuthProvider, EMPTY_STATE, PENDING_TTL_MS, REFRESH_WINDOW_MS, validateState };
