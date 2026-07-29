"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AuthHttpClient, AuthHttpError } = require("../electron/auth-http-client");

const config = Object.freeze({ status: "configured", token_endpoint: "https://accounts.oakbylake.com/oauth/token", user_endpoint: "https://accounts.oakbylake.com/oauth/user", redirect_uri: "oak-manuscript-auth://callback", client_id: "oak-manuscript-desktop", public_api_key: "public-key-000000000000000000000000" });
function response(status, value, headers = {}) { const bytes = Buffer.from(JSON.stringify(value)); return { status, headers: { get(name) { const map = { "content-type": "application/json", "content-length": String(bytes.length), ...headers }; return map[name.toLowerCase()] ?? null; } }, async arrayBuffer() { return bytes; } }; }

test("auth client exchanges a PKCE code through one fixed bounded form request", async () => {
  const calls = []; const client = new AuthHttpClient({ config, fetchImpl: async (url, options) => { calls.push([url, options]); return response(200, { access_token: "a".repeat(64), refresh_token: "r".repeat(64), token_type: "bearer", expires_in: 3600 }); } });
  const tokens = await client.exchangeAuthorizationCode({ code: "c".repeat(32), codeVerifier: "v".repeat(64) });
  assert.equal(tokens.expires_in, 3600); assert.equal(calls.length, 1); assert.equal(calls[0][0], config.token_endpoint);
  const options = calls[0][1]; assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
  const body = new URLSearchParams(options.body); assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code_verifier"), "v".repeat(64)); assert.equal(body.get("redirect_uri"), config.redirect_uri);
  assert.equal(JSON.stringify(calls).includes("access_token"), false);
});

test("auth client independently verifies the bearer subject and rejects response drift", async () => {
  const client = new AuthHttpClient({ config, fetchImpl: async (_url, options) => {
    assert.equal(options.headers.authorization, `Bearer ${"a".repeat(64)}`);
    return response(200, { account_id: "account-1" });
  } });
  assert.deepEqual(await client.identity("a".repeat(64)), { accountId: "account-1" });
  const drift = new AuthHttpClient({ config, fetchImpl: async () => response(200, { account_id: "account-1", email: "private@example.com" }) });
  await assert.rejects(() => drift.identity("a".repeat(64)), (error) => error instanceof AuthHttpError && error.code === "AUTH_RESPONSE_INVALID");
});

test("auth client rejects malformed credentials before fetch and sanitizes upstream errors", async () => {
  let calls = 0; const client = new AuthHttpClient({ config, fetchImpl: async () => { calls += 1; throw new Error("secret upstream detail"); } });
  await assert.rejects(() => client.identity("short"), /access token/); assert.equal(calls, 0);
  await assert.rejects(() => client.identity("a".repeat(64)), (error) => error instanceof AuthHttpError && error.message === "湖岸账号服务暂时不可用" && !error.message.includes("secret"));
});
