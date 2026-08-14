"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AuthHttpClient, AuthHttpError } = require("../electron/auth-http-client");

const config = Object.freeze({ status: "configured", account_center_origin: "https://accounts.example.invalid", application_id: "oak-manuscript-desktop" });
function response(status, value, headers = {}) { const bytes = Buffer.from(JSON.stringify(value)); return { status, headers: { get(name) { const map = { "content-type": "application/json", "content-length": String(bytes.length), ...headers }; return map[name.toLowerCase()] ?? null; } }, async arrayBuffer() { return bytes; } }; }

test("auth client rejects malformed application-login inputs before fetch", async () => {
  let calls = 0;
  const client = new AuthHttpClient({ config, fetchImpl: async () => { calls += 1; } });
  assert.throws(() => client.exchangeAuthorizationCode({ code: "short", codeVerifier: "v".repeat(64), redirectUri: "http://127.0.0.1:49152/application-login/callback/x" }), /授权码|callback|PKCE/);
  assert.throws(() => client.refresh("short"), /refresh token/);
  assert.equal(calls, 0);
});

test("auth client rejects response drift and oversized declared bodies", async () => {
  const drift = new AuthHttpClient({ config, fetchImpl: async () => response(200, { account_id: "account-1" }) });
  await assert.rejects(() => drift.refresh("r".repeat(43)), (error) => error instanceof AuthHttpError && error.code === "AUTH_RESPONSE_INVALID");
  const oversized = new AuthHttpClient({ config, fetchImpl: async () => response(200, {}, { "content-length": String(129 * 1024) }) });
  await assert.rejects(() => oversized.refresh("r".repeat(43)), (error) => error.code === "AUTH_RESPONSE_INVALID");
});

test("auth client rejects malformed credentials before fetch and sanitizes upstream errors", async () => {
  let calls = 0; const client = new AuthHttpClient({ config, fetchImpl: async () => { calls += 1; throw new Error("secret upstream detail"); } });
  assert.throws(() => client.refresh("short"), /refresh token/); assert.equal(calls, 0);
  await assert.rejects(() => client.refresh("r".repeat(43)), (error) => error instanceof AuthHttpError && error.code === "AUTH_UNAVAILABLE" && !error.message.includes("secret"));
});
