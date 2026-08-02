"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadDesktopAuthConfig, validateDesktopAuthConfig } = require("../electron/desktop-auth-config");

const ROOT = path.resolve(__dirname, "..");
const configured = Object.freeze({
  schema_version: "1.0", config_type: "oak_manuscript_desktop_auth", status: "configured",
  authorization_endpoint: "https://accounts.oakbylake.com/oauth/authorize",
  token_endpoint: "https://accounts.oakbylake.com/oauth/token",
  user_endpoint: "https://accounts.oakbylake.com/oauth/user",
  client_id: "oak-manuscript-desktop", public_api_key: "public-key-000000000000000000000000",
  api_origin: "https://oakbylake.com", redirect_uri: "oak-manuscript-auth://callback",
  scopes: ["openid", "profile"],
});

test("bundled desktop auth config is exact pending configuration and therefore has no network target", () => {
  const value = loadDesktopAuthConfig(path.join(ROOT, "config"));
  assert.equal(value.status, "pending_configuration");
  for (const key of ["authorization_endpoint", "token_endpoint", "user_endpoint", "client_id", "public_api_key", "api_origin"]) assert.equal(value[key], null);
  assert.equal(value.redirect_uri, "oak-manuscript-auth://callback");
});

test("configured desktop auth accepts only canonical HTTPS endpoints and complete exact fields", () => {
  assert.equal(validateDesktopAuthConfig(configured).status, "configured");
  assert.throws(() => validateDesktopAuthConfig({ ...configured, token_endpoint: "http://accounts.oakbylake.com/token" }), /HTTPS/);
  assert.throws(() => validateDesktopAuthConfig({ ...configured, extra: true }), /结构/);
  assert.throws(() => validateDesktopAuthConfig({ ...configured, status: "pending_configuration" }), /半成品/);
});

test("config schema and runtime config are shipped as trusted resources", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "config/tool-manifests/app-resources-v1.json"), "utf8"));
  const paths = new Set(manifest.files.map((item) => item.path));
  assert.equal(paths.has("config/desktop-auth.json"), true);
  assert.equal(paths.has("config/schemas/desktop-auth-v1.schema.json"), true);
  assert.equal(paths.has("config/schemas/auth-session-store-v1.schema.json"), true);
});

module.exports = { configured };
