"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadDesktopAuthConfig, validateDesktopAuthConfig } = require("../electron/desktop-auth-config");

const ROOT = path.resolve(__dirname, "..");
const configured = Object.freeze({
  schema_version: "2.0", config_type: "oak_manuscript_desktop_application_login", status: "configured",
  application_id: "oak-manuscript-desktop",
  account_center_origin: "https://accounts.example.invalid",
  issuer: "https://accounts.example.invalid/application-login",
  trusted_keys: [{
    key_id: "test-key-1", algorithm: "ES256",
    public_key_jwk: {
      alg: "ES256", crv: "P-256", ext: true, key_ops: ["verify"],
      kid: "test-key-1", kty: "EC", use: "sig", x: "x".repeat(43), y: "y".repeat(43),
    },
  }],
  sync_api_origin: "https://manuscript-api.example.invalid",
});

test("bundled desktop auth config is exact pending configuration and therefore has no network target", () => {
  const value = loadDesktopAuthConfig(path.join(ROOT, "config"));
  assert.equal(value.status, "pending_configuration");
  assert.equal(value.application_id, "oak-manuscript-desktop");
  for (const key of ["account_center_origin", "issuer", "sync_api_origin"]) assert.equal(value[key], null);
  assert.deepEqual(value.trusted_keys, []);
});

test("configured desktop auth accepts only canonical HTTPS endpoints and complete exact fields", () => {
  assert.equal(validateDesktopAuthConfig(configured).status, "configured");
  assert.throws(() => validateDesktopAuthConfig({ ...configured, account_center_origin: "http://accounts.example.invalid" }), /HTTPS/);
  assert.throws(() => validateDesktopAuthConfig({ ...configured, extra: true }), /结构/);
  assert.throws(() => validateDesktopAuthConfig({ ...configured, status: "pending_configuration" }), /待配置/);
});

test("config schema and runtime config are shipped as trusted resources", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "config/tool-manifests/app-resources-v1.json"), "utf8"));
  const paths = new Set(manifest.files.map((item) => item.path));
  assert.equal(paths.has("config/desktop-auth.json"), true);
  assert.equal(paths.has("config/schemas/desktop-auth-v2.schema.json"), true);
  assert.equal(paths.has("config/schemas/auth-session-store-v2.schema.json"), true);
});

module.exports = { configured };
