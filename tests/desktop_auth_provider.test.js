"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { DesktopAuthProvider, EMPTY_STATE, callbackUrl } = require("../electron/desktop-auth-provider");

const config = Object.freeze({ status: "configured", authorization_endpoint: "https://accounts.oakbylake.com/oauth/authorize", token_endpoint: "https://accounts.oakbylake.com/oauth/token", user_endpoint: "https://accounts.oakbylake.com/oauth/user", client_id: "oak-manuscript-desktop", public_api_key: "public-key-000000000000000000000000", api_origin: "https://oakbylake.com", redirect_uri: "oak-manuscript-auth://callback", scopes: ["openid", "profile"] });
const pending = Object.freeze({ ...config, status: "pending_configuration", authorization_endpoint: null, token_endpoint: null, user_endpoint: null, client_id: null, public_api_key: null, api_origin: null });
const access = "a".repeat(64); const refresh = "r".repeat(64);
function memoryStore(initial = null) { let value = initial; return { load: () => value, save(next, { expectedRevision }) { assert.equal(value === null ? 0 : value.revision, expectedRevision); value = structuredClone(next); return structuredClone(value); }, value: () => value }; }

test("pending configuration never opens a browser or requires token storage", async () => {
  const provider = new DesktopAuthProvider({ config: pending });
  assert.equal(provider.status().productionConfigured, false);
  assert.deepEqual(await provider.beginLogin(), { state: "configuration_required", opened: false, authMode: "system_browser_pkce", message: "生产账号服务尚未配置，未发起网络请求。" });
});

test("PKCE persists verifier before browser open and callback binds independently verified account", async () => {
  const store = memoryStore(); const events = []; let exchange = null;
  const provider = new DesktopAuthProvider({ config, store, clock: () => new Date("2026-07-29T00:00:00.000Z"), randomBytes: (n) => Buffer.alloc(n, n), openExternal: async (url) => events.push(["open", url, store.value()]), client: { async exchangeAuthorizationCode(value) { exchange = value; return { access_token: access, refresh_token: refresh, token_type: "bearer", expires_in: 3600 }; }, async identity(token) { assert.equal(token, access); return { accountId: "account-1" }; }, async refresh() { throw new Error("unused"); } } });
  const started = await provider.beginLogin(); assert.equal(started.opened, true);
  const opened = new URL(events[0][1]); const saved = events[0][2];
  assert.equal(saved.pending.code_verifier.length >= 43, true);
  assert.equal(opened.searchParams.get("code_challenge"), crypto.createHash("sha256").update(saved.pending.code_verifier, "ascii").digest("base64url"));
  assert.equal(opened.searchParams.get("code_challenge_method"), "S256");
  const status = await provider.handleCallback(`oak-manuscript-auth://callback?code=${"c".repeat(32)}&state=${saved.pending.state}`);
  assert.equal(exchange.codeVerifier, saved.pending.code_verifier); assert.equal(status.accountId, "account-1");
  assert.equal(store.value().pending, null); assert.equal(store.value().session.access_token, access);
  await assert.rejects(() => provider.handleCallback(`oak-manuscript-auth://callback?code=${"d".repeat(32)}&state=${saved.pending.state}`), /已使用|state/);
});

test("callback parser rejects tokens, extra parameters and wrong schemes", () => {
  assert.throws(() => callbackUrl(`oak-manuscript-auth://callback?access_token=${access}&state=${"s".repeat(43)}`), /非法/);
  assert.throws(() => callbackUrl(`oak-manuscript-auth://callback?code=${"c".repeat(32)}&state=${"s".repeat(43)}&extra=1`), /非法/);
  assert.throws(() => callbackUrl(`https://oakbylake.com/callback?code=${"c".repeat(32)}&state=${"s".repeat(43)}`), /非法/);
});

test("access token refresh re-verifies account binding and clears mismatched sessions", async () => {
  const store = memoryStore({ ...EMPTY_STATE, revision: 1, session: { account_id: "account-1", access_token: access, refresh_token: refresh, token_type: "bearer", issued_at: "2026-07-28T23:00:00.000Z", expires_at: "2026-07-29T00:00:30.000Z", refresh_expires_at: null } });
  const provider = new DesktopAuthProvider({ config, store, clock: () => new Date("2026-07-29T00:00:00.000Z"), openExternal: async () => {}, client: { async exchangeAuthorizationCode() { throw new Error("unused"); }, async refresh(token) { assert.equal(token, refresh); return { access_token: "b".repeat(64), refresh_token: "q".repeat(64), token_type: "bearer", expires_in: 3600 }; }, async identity() { return { accountId: "account-2" }; } } });
  await assert.rejects(() => provider.accessToken({ accountId: "account-1" }), /身份不匹配/);
  assert.equal(store.value().session, null);
});
