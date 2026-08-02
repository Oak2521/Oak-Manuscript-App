"use strict";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const TOKEN_RE = /^[A-Za-z0-9._~+\/-]+={0,2}$/u;

class AuthHttpError extends Error {
  constructor(code) {
    const messages = {
      AUTH_TIMEOUT: "湖岸账号请求超时",
      AUTH_UNAVAILABLE: "湖岸账号服务暂时不可用",
      AUTH_REJECTED: "湖岸账号授权已被拒绝或过期",
      AUTH_RESPONSE_INVALID: "湖岸账号服务返回了非法响应",
    };
    super(messages[code] || messages.AUTH_UNAVAILABLE);
    this.name = "AuthHttpError"; this.code = Object.hasOwn(messages, code) ? code : "AUTH_UNAVAILABLE";
  }
}
function fail(code) { throw new AuthHttpError(code); }
function validToken(value) { return typeof value === "string" && value.length >= 32 && value.length <= 8192 && TOKEN_RE.test(value); }
function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
async function boundedJson(response) {
  if (!response || typeof response.status !== "number" || !response.headers || typeof response.arrayBuffer !== "function") fail("AUTH_RESPONSE_INVALID");
  if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") || "")) fail("AUTH_RESPONSE_INVALID");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^(?:0|[1-9][0-9]{0,15})$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) fail("AUTH_RESPONSE_INVALID");
  let bytes; try { bytes = Buffer.from(await response.arrayBuffer()); } catch { fail("AUTH_RESPONSE_INVALID"); }
  if (bytes.length < 2 || bytes.length > MAX_RESPONSE_BYTES || (declared !== null && bytes.length !== Number(declared))) fail("AUTH_RESPONSE_INVALID");
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail("AUTH_RESPONSE_INVALID"); }
}

class AuthHttpClient {
  constructor({ config, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!config || config.status !== "configured") throw new TypeError("账号客户端需要完整配置");
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl 必须是函数");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new TypeError("timeoutMs 非法");
    this.config = config; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async _request(url, options) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try { response = await this.fetchImpl(url, { ...options, redirect: "error", cache: "no-store", credentials: "omit", signal: controller.signal }); }
    catch (error) { if (controller.signal.aborted || error?.name === "AbortError") fail("AUTH_TIMEOUT"); fail("AUTH_UNAVAILABLE"); }
    finally { clearTimeout(timer); }
    const value = await boundedJson(response);
    if (response.status === 400 || response.status === 401 || response.status === 403) fail("AUTH_REJECTED");
    if (response.status !== 200) fail("AUTH_RESPONSE_INVALID");
    return value;
  }
  async _token(params) {
    const body = new URLSearchParams(params).toString();
    const value = await this._request(this.config.token_endpoint, {
      method: "POST",
      headers: { accept: "application/json", apikey: this.config.public_api_key, "content-type": "application/x-www-form-urlencoded", "content-length": String(Buffer.byteLength(body)) },
      body,
    });
    if (!exactKeys(value, ["access_token", "refresh_token", "token_type", "expires_in"]) ||
        !validToken(value.access_token) || !validToken(value.refresh_token) || value.token_type !== "bearer" ||
        !Number.isSafeInteger(value.expires_in) || value.expires_in < 60 || value.expires_in > 86_400) fail("AUTH_RESPONSE_INVALID");
    return Object.freeze({ ...value });
  }
  exchangeAuthorizationCode({ code, codeVerifier }) {
    if (typeof code !== "string" || code.length < 16 || code.length > 4096 || /[\s\0]/u.test(code) ||
        typeof codeVerifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/u.test(codeVerifier)) throw new TypeError("授权码或 PKCE verifier 非法");
    return this._token({ grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: this.config.redirect_uri, client_id: this.config.client_id });
  }
  refresh(refreshToken) {
    if (!validToken(refreshToken)) throw new TypeError("refresh token 非法");
    return this._token({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: this.config.client_id });
  }
  async identity(accessToken) {
    if (!validToken(accessToken)) throw new TypeError("access token 非法");
    const value = await this._request(this.config.user_endpoint, {
      method: "GET", headers: { accept: "application/json", apikey: this.config.public_api_key, authorization: `Bearer ${accessToken}` },
    });
    if (!exactKeys(value, ["account_id"]) || typeof value.account_id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.account_id)) fail("AUTH_RESPONSE_INVALID");
    return Object.freeze({ accountId: value.account_id });
  }
}

module.exports = { AuthHttpClient, AuthHttpError, DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES, validToken };
