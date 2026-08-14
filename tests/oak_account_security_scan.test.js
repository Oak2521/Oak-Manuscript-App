"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
function source(relative) { return fs.readFileSync(path.join(ROOT, relative), "utf8"); }

test("desktop package excludes legacy identity modules and custom callback registration", () => {
  const packageJson = JSON.parse(source("package.json"));
  assert.equal(Object.hasOwn(packageJson.build, "protocols"), false);
  assert.equal(packageJson.build.files.includes("!electron/auth-http-client.js"), true);
  assert.equal(packageJson.build.files.includes("!electron/desktop-auth-provider.js"), true);
  const main = source("electron/main.js");
  for (const forbidden of [
    "oak-manuscript-auth://", "authCallbackFromArgs", "handleCallback", "authorization_endpoint",
    "token_endpoint", "public_api_key", "supabase_api_key", "/auth/v1/user",
  ]) assert.equal(main.includes(forbidden), false, forbidden);
});

test("shipped account configuration contains no URL, credential, or legacy OAuth field", () => {
  const config = JSON.parse(source("config/desktop-auth.json"));
  assert.equal(config.status, "pending_configuration");
  assert.equal(config.account_center_origin, null);
  assert.equal(config.issuer, null);
  assert.equal(config.sync_api_origin, null);
  assert.deepEqual(config.trusted_keys, []);
  const serialized = JSON.stringify(config);
  for (const forbidden of ["http://", "https://", "authorization_endpoint", "token_endpoint", "public_api_key", "client_secret", "access_token", "refresh_token"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("Renderer and preload contain no account token, code, verifier, Cookie, or raw account id", () => {
  const client = `${source("electron/preload.js")}\n${source("renderer/app.js")}`;
  for (const forbidden of [
    "access_token", "refresh_token", "code_verifier", "oak_account_id", "Authorization", "Cookie",
  ]) assert.equal(client.includes(forbidden), false, forbidden);
});

test("production Web composition roots no longer import GoTrue identity paths", () => {
  const roots = [
    "web/entitlement-runtime.js", "web/license-account-runtime.js",
    "web/sync-record-runtime.js", "web/web-job-runtime.js",
  ];
  for (const relative of roots) {
    const value = source(relative);
    assert.match(value, /createOakAccountAccessTokenVerifier/);
    assert.match(value, /createOakAccountSessionResolver/);
    for (const forbidden of ["createGoTrueAccessTokenVerifier", "createSupabaseSessionResolver", "supabase_api_key", "supabaseApiKey", "/auth/v1/user"]) {
      assert.equal(value.includes(forbidden), false, `${relative}: ${forbidden}`);
    }
  }
});
