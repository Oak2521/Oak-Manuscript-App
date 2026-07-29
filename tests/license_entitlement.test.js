"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  ProductionLicenseProvider,
  canonicalEntitlementPayload,
  verifyEntitlement,
} = require("../electron/license-entitlement");
const { LicenseProvider } = require("../electron/providers");

const NOW = "2026-07-29T12:00:00.000Z";
const ACCOUNT = "account-0001";
const DEVICE = "device-10000000-0000-4000-8000-000000000001";

function fixture(overrides = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  const config = {
    schema_version: "1.0", config_type: "oak_manuscript_desktop_license", status: "configured",
    entitlement_endpoint: "https://accounts.oakbylake.com/manuscript/api/v1/entitlement",
    issuer: "https://accounts.oakbylake.com/", audience: "oak-manuscript-desktop",
    trusted_keys: [{ key_id: "oak-license-2026-01", algorithm: "Ed25519", public_key_jwk: { kty: "OKP", crv: "Ed25519", x: jwk.x } }],
  };
  const claims = {
    issuer: config.issuer,
    audience: config.audience,
    entitlement_id: "ent-10000000-0000-4000-8000-000000000001",
    account_id: ACCOUNT,
    device_id: DEVICE,
    tier: "pro",
    device_state: "active",
    issued_at: "2026-07-29T10:00:00.000Z",
    not_before: "2026-07-29T10:00:00.000Z",
    valid_until: "2026-08-29T10:00:00.000Z",
    grace_until: "2026-09-05T10:00:00.000Z",
    ...overrides,
  };
  const unsigned = {
    schema_version: "1.0", record_type: "oak_manuscript_signed_entitlement",
    key_id: "oak-license-2026-01", algorithm: "Ed25519", claims,
  };
  const signature = crypto.sign(null, Buffer.from(canonicalEntitlementPayload(unsigned), "utf8"), privateKey).toString("base64url");
  return { config, envelope: { ...unsigned, signature } };
}

function auth(accountId = ACCOUNT) {
  return { state: "authenticated", loggedIn: true, accountId };
}

function memoryStore(deviceId = DEVICE, envelope = null) {
  let state = { schema_version: "1.0", store_type: "oak_manuscript_license_cache", revision: 1, device_id: deviceId, entitlement: envelope };
  return {
    encrypted: true,
    load: () => structuredClone(state),
    save(value, { expectedRevision }) {
      assert.equal(expectedRevision, state.revision);
      state = structuredClone(value);
      return structuredClone(state);
    },
    inspect: () => structuredClone(state),
  };
}

test("tracked signed-entitlement schema matches the runtime exact-key contract", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "schemas", "signed-entitlement-v1.schema.json"), "utf8"));
  const cacheSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "schemas", "license-cache-v1.schema.json"), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["schema_version", "record_type", "key_id", "algorithm", "claims", "signature"]);
  assert.equal(schema.properties.schema_version.const, "1.0");
  assert.equal(schema.properties.record_type.const, "oak_manuscript_signed_entitlement");
  assert.equal(schema.properties.algorithm.const, "Ed25519");
  assert.equal(schema.properties.signature.pattern, "^[A-Za-z0-9_-]{86}$");
  assert.equal(schema.properties.claims.additionalProperties, false);
  assert.deepEqual(schema.properties.claims.required, [
    "issuer", "audience", "entitlement_id", "account_id", "device_id", "tier",
    "device_state", "issued_at", "not_before", "valid_until", "grace_until",
  ]);
  assert.equal(schema.properties.claims.properties.audience.const, "oak-manuscript-desktop");
  assert.equal(schema.properties.claims.properties.tier.const, "pro");
  assert.deepEqual(schema.properties.claims.properties.device_state.enum, ["active", "revoked"]);
  assert.equal(cacheSchema.properties.entitlement.anyOf[1].$ref, "signed-entitlement-v1.schema.json");
});

test("signed entitlement verifies issuer, audience, account, device, exact schema, and signature", () => {
  const { config, envelope } = fixture();
  assert.equal(verifyEntitlement(envelope, { config, accountId: ACCOUNT, deviceId: DEVICE }).tier, "pro");
  for (const poisoned of [
    { ...envelope, extra: true },
    { ...envelope, key_id: "unknown-key" },
    { ...envelope, claims: { ...envelope.claims, audience: "another-app" } },
    { ...envelope, claims: { ...envelope.claims, account_id: "account-0002" } },
    { ...envelope, claims: { ...envelope.claims, device_id: "device-20000000-0000-4000-8000-000000000002" } },
    { ...envelope, claims: { ...envelope.claims, tier: "free" } },
  ]) assert.throws(() => verifyEntitlement(poisoned, { config, accountId: ACCOUNT, deviceId: DEVICE }));
});

test("production provider derives active, grace, expired, and revoked without locking local files", () => {
  for (const [overrides, state, tier] of [
    [{}, "active", "pro"],
    [{ valid_until: "2026-07-29T11:00:00.000Z", grace_until: "2026-07-30T12:00:00.000Z" }, "grace", "pro"],
    [{ issued_at: "2026-07-01T10:00:00.000Z", not_before: "2026-07-01T10:00:00.000Z", valid_until: "2026-07-28T11:00:00.000Z", grace_until: "2026-07-29T11:00:00.000Z" }, "expired", "free"],
    [{ device_state: "revoked" }, "revoked", "free"],
  ]) {
    const { config, envelope } = fixture(overrides);
    const provider = new ProductionLicenseProvider({
      config, store: memoryStore(DEVICE, envelope), client: { fetchEntitlement() { throw new Error("must not fetch during status"); } },
      accessTokenProvider: async () => { throw new Error("must not fetch during status"); },
      authStatusProvider: () => auth(), clock: () => new Date(NOW),
    });
    const status = provider.status();
    assert.equal(status.entitlementState, state);
    assert.equal(status.effectiveTier, tier);
    assert.equal(status.localProjectsLocked, false);
    assert.equal(status.signatureVerified, true);
  }
});

test("signed-out, wrong-account, tampered, and not-yet-valid caches fail closed to Free", () => {
  const valid = fixture();
  const future = fixture({ not_before: "2026-07-30T00:00:00.000Z", valid_until: "2026-08-30T00:00:00.000Z", grace_until: "2026-09-05T00:00:00.000Z" });
  const cases = [
    [valid.config, () => ({ state: "signed_out", loggedIn: false, accountId: null }), valid.envelope, "signed_out"],
    [valid.config, () => auth("account-0002"), valid.envelope, "invalid"],
    [valid.config, () => auth(), { ...valid.envelope, signature: "A".repeat(86) }, "invalid"],
    [future.config, () => auth(), future.envelope, "not_yet_valid"],
  ];
  for (const [config, authStatusProvider, envelope, expected] of cases) {
    const provider = new ProductionLicenseProvider({
      config, store: memoryStore(DEVICE, envelope), client: { fetchEntitlement() {} },
      accessTokenProvider: async () => ({}), authStatusProvider, clock: () => new Date(NOW),
    });
    const status = provider.status();
    assert.equal(status.entitlementState, expected);
    assert.equal(status.effectiveTier, "free");
    assert.equal(status.localProjectsLocked, false);
  }
});

test("explicit refresh verifies before atomic cache replacement and never fetches during status", async () => {
  const initial = fixture({ valid_until: "2026-07-29T11:00:00.000Z", grace_until: "2026-07-30T12:00:00.000Z" });
  const renewed = fixture();
  renewed.config.trusted_keys = initial.config.trusted_keys;
  renewed.envelope.key_id = initial.envelope.key_id;
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  // Re-signing with an unrelated key must be rejected and must not replace the valid cache.
  renewed.envelope.signature = crypto.sign(null, Buffer.from(canonicalEntitlementPayload({ ...renewed.envelope, signature: undefined }), "utf8"), privateKey).toString("base64url");
  const store = memoryStore(DEVICE, initial.envelope);
  let calls = 0;
  const provider = new ProductionLicenseProvider({
    config: initial.config, store,
    client: { async fetchEntitlement() { calls += 1; return renewed.envelope; } },
    accessTokenProvider: async ({ accountId }) => ({ accountId, accessToken: "a".repeat(48) }),
    authStatusProvider: () => auth(), clock: () => new Date(NOW),
  });
  assert.equal(provider.status().entitlementState, "grace");
  assert.equal(calls, 0);
  await assert.rejects(() => provider.refresh(auth()), /签名|权益/);
  assert.equal(calls, 1);
  assert.deepEqual(store.inspect().entitlement, initial.envelope);
});

test("refresh rechecks the authenticated account after transport before committing the cache", async () => {
  const signed = fixture();
  const store = memoryStore(DEVICE, null);
  let current = auth();
  const provider = new ProductionLicenseProvider({
    config: signed.config, store,
    client: { async fetchEntitlement() { current = auth("account-0002"); return signed.envelope; } },
    accessTokenProvider: async ({ accountId }) => ({ accountId, accessToken: "a".repeat(48) }),
    authStatusProvider: () => current, clock: () => new Date(NOW),
  });
  await assert.rejects(() => provider.refresh(auth()), /账号.*变化|稳定/);
  assert.equal(store.inspect().entitlement, null);
});

test("LicenseProvider production composition exposes refresh without changing local fallback", async () => {
  const local = new LicenseProvider();
  assert.equal(local.status().productionConfigured, false);
  const production = { status: () => ({ productionConfigured: true, effectiveTier: "free" }), refresh: async () => ({ productionConfigured: true, effectiveTier: "pro" }) };
  local.configureProduction(production);
  assert.equal(local.status().productionConfigured, true);
  assert.equal((await local.refresh(auth())).effectiveTier, "pro");
});
