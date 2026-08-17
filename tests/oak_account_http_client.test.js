"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { AuthHttpClient } = require("../electron/auth-http-client");

const config = Object.freeze({ status: "configured", application_id: "oak-manuscript-desktop", account_center_origin: "https://identity.example.invalid" });
function response(status, value) {
  const bytes = value === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value));
  return { status, headers: new Headers(value === null ? { "content-length": "0" } : { "content-type": "application/json", "content-length": String(bytes.length) }), arrayBuffer: async () => bytes };
}
function tokenResponse() {
  return {
    schema_version: "oak-desktop-token-response/1.0", token_type: "Bearer",
    access_token: `${"a".repeat(32)}.${"b".repeat(32)}.${"c".repeat(86)}`, expires_in: 300,
    refresh_token: "r".repeat(43), refresh_expires_at: "2026-09-13T12:00:00.000Z",
    claims: { iss: "https://identity.example.invalid/application-login", sub: "61000000-0000-4000-8000-000000000001", aud: "oak-manuscript-desktop", sid: "62000000-0000-4000-8000-000000000002", iat: 1786708800, exp: 1786709100, aal: "aal1", oak_account_id: "63000000-0000-4000-8000-000000000003", oak_account_status: "active", oak_profile_version: 3, oak_claims_version: "1.0" },
  };
}

test("application-login HTTP client uses fixed JSON routes without legacy keys or cookies", async () => {
  const calls = [];
  const client = new AuthHttpClient({ config, fetchImpl: async (url, options) => { calls.push({ url, options }); return response(200, tokenResponse()); } });
  await client.exchangeAuthorizationCode({ code: "c".repeat(43), codeVerifier: "v".repeat(43), redirectUri: `http://127.0.0.1:49152/application-login/callback/${"n".repeat(43)}` });
  await client.refresh("r".repeat(43));
  assert.deepEqual(calls.map((call) => call.url), ["https://identity.example.invalid/api/application-login/exchange", "https://identity.example.invalid/api/application-login/refresh"]);
  assert.deepEqual(JSON.parse(calls[0].options.body), { schema_version: "oak-desktop-login-exchange/1.0", application_id: "oak-manuscript-desktop", code: "c".repeat(43), code_verifier: "v".repeat(43), redirect_uri: `http://127.0.0.1:49152/application-login/callback/${"n".repeat(43)}` });
  assert.deepEqual(JSON.parse(calls[1].options.body), { schema_version: "oak-desktop-refresh/1.0", application_id: "oak-manuscript-desktop", refresh_token: "r".repeat(43) });
  for (const call of calls) { assert.equal(call.options.headers.authorization, undefined); assert.equal(call.options.headers.apikey, undefined); assert.equal(call.options.headers.cookie, undefined); assert.equal(call.options.credentials, "omit"); }
});

test("revoke uses the fixed current-family request and accepts the exact runtime result", async () => {
  let call;
  const client = new AuthHttpClient({ config, fetchImpl: async (url, options) => { call = { url, options }; return response(200, { revoked: true }); } });
  assert.deepEqual(await client.revoke("r".repeat(43)), { revoked: true });
  assert.equal(call.url, "https://identity.example.invalid/api/application-login/revoke");
  assert.deepEqual(JSON.parse(call.options.body), { schema_version: "oak-desktop-revoke/1.0", application_id: "oak-manuscript-desktop", refresh_token: "r".repeat(43), mode: "current_token_family" });
});

test("revoke fails closed on legacy or widened response shapes", async () => {
  for (const invalidResponse of [response(204, null), response(200, { revoked: false }), response(200, { revoked: true, detail: "extra" })]) {
    const client = new AuthHttpClient({ config, fetchImpl: async () => invalidResponse });
    await assert.rejects(() => client.revoke("r".repeat(43)), { code: "AUTH_RESPONSE_INVALID" });
  }
});
