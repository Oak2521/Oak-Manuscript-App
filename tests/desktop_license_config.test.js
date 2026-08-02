"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  loadDesktopLicenseConfig,
  validateDesktopLicenseConfig,
} = require("../electron/desktop-license-config");

const ROOT = path.resolve(__dirname, "..");

function configured() {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  return {
    schema_version: "1.0",
    config_type: "oak_manuscript_desktop_license",
    status: "configured",
    entitlement_endpoint: "https://accounts.oakbylake.com/manuscript/api/v1/entitlement",
    issuer: "https://accounts.oakbylake.com/",
    audience: "oak-manuscript-desktop",
    trusted_keys: [{
      key_id: "oak-license-2026-01",
      algorithm: "Ed25519",
      public_key_jwk: { kty: "OKP", crv: "Ed25519", x: jwk.x },
    }],
  };
}

test("bundled desktop license config is exact pending configuration with no network target or key", () => {
  const value = loadDesktopLicenseConfig(path.join(ROOT, "config"));
  assert.deepEqual(value, {
    schema_version: "1.0",
    config_type: "oak_manuscript_desktop_license",
    status: "pending_configuration",
    entitlement_endpoint: null,
    issuer: null,
    audience: "oak-manuscript-desktop",
    trusted_keys: [],
  });
});

test("configured desktop license requires canonical HTTPS, exact Ed25519 keys, and no partial state", () => {
  const value = configured();
  assert.equal(validateDesktopLicenseConfig(value).status, "configured");
  assert.throws(() => validateDesktopLicenseConfig({ ...value, entitlement_endpoint: "http://accounts.oakbylake.com/e" }), /HTTPS/);
  assert.throws(() => validateDesktopLicenseConfig({ ...value, extra: true }), /结构/);
  assert.throws(() => validateDesktopLicenseConfig({ ...value, status: "pending_configuration" }), /待配置/);
  assert.throws(() => validateDesktopLicenseConfig({ ...value, trusted_keys: [value.trusted_keys[0], value.trusted_keys[0]] }), /重复/);
  assert.throws(() => validateDesktopLicenseConfig({
    ...value,
    trusted_keys: [{ ...value.trusted_keys[0], public_key_jwk: { ...value.trusted_keys[0].public_key_jwk, x: "bad" } }],
  }), /公钥/);
});

test("desktop license config and cache schemas are shipped in the trusted resource inventory", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "config/tool-manifests/app-resources-v1.json"), "utf8"));
  const paths = new Set(manifest.files.map((item) => item.path));
  for (const required of [
    "config/desktop-license.json",
    "config/schemas/desktop-license-v1.schema.json",
    "config/schemas/license-cache-v1.schema.json",
  ]) assert.equal(paths.has(required), true, required);
});
