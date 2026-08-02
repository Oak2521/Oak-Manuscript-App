"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { verifyEntitlement } = require("../electron/license-entitlement");
const { EntitlementService } = require("../web/entitlement-service");
const { createEd25519EntitlementSigner } = require("../web/entitlement-signer");

const ACCOUNT = "account-0001";
const DEVICE = "device-10000000-0000-4000-8000-000000000001";
const ISSUER = "https://accounts.oakbylake.com/";
const NOW = "2026-07-29T12:00:00.000Z";

function fixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  const config = {
    schema_version: "1.0", config_type: "oak_manuscript_desktop_license", status: "configured",
    entitlement_endpoint: `${ISSUER}manuscript/api/v1/entitlement`, issuer: ISSUER,
    audience: "oak-manuscript-desktop",
    trusted_keys: [{ key_id: "oak-license-2026-01", algorithm: "Ed25519", public_key_jwk: { kty: "OKP", crv: "Ed25519", x: jwk.x } }],
  };
  const signer = createEd25519EntitlementSigner({
    issuer: ISSUER, audience: config.audience, keyId: "oak-license-2026-01", privateKey,
  });
  return { config, signer };
}

function authorization(overrides = {}) {
  return {
    schema_version: "1.0",
    result_type: "oak_manuscript_device_authorization",
    outcome: "authorized",
    authorization: {
      account_id: ACCOUNT,
      entitlement_id: "ent-20000000-0000-4000-8000-000000000002",
      device_id: DEVICE,
      device_state: "active",
      issued_at: "2026-07-01T00:00:00.000Z",
      not_before: "2026-07-01T00:00:00.000Z",
      valid_until: "2026-08-01T00:00:00.000Z",
      grace_until: "2026-08-08T00:00:00.000Z",
      ...overrides,
    },
  };
}

test("trusted account authorization is independently signed and accepted by the desktop verifier", async () => {
  const { config, signer } = fixture();
  const calls = [];
  const service = new EntitlementService({
    repository: { async authorizeDevice(...args) { calls.push(args); return authorization(); } },
    signer,
    clock: () => new Date(NOW),
    maxDevicesPerAccount: 3,
  });
  const envelope = await service.issue(
    { kind: "account", subject_id: ACCOUNT },
    { schema_version: "1.0", request_type: "oak_manuscript_entitlement_request", device_id: DEVICE },
  );
  assert.deepEqual(calls, [[ACCOUNT, DEVICE, NOW, 3]]);
  assert.equal(verifyEntitlement(envelope, { config, accountId: ACCOUNT, deviceId: DEVICE }).tier, "pro");
  assert.equal(envelope.claims.account_id, ACCOUNT);
  assert.equal(JSON.stringify(envelope).includes("access_token"), false);
});

test("anonymous, self-reported account fields, and malformed device requests fail before repository access", async () => {
  const { signer } = fixture();
  let calls = 0;
  const service = new EntitlementService({
    repository: { async authorizeDevice() { calls += 1; return authorization(); } }, signer,
  });
  for (const [principal, body] of [
    [{ kind: "anonymous", subject_id: "anonymous-0001" }, { schema_version: "1.0", request_type: "oak_manuscript_entitlement_request", device_id: DEVICE }],
    [{ kind: "account", subject_id: ACCOUNT }, { schema_version: "1.0", request_type: "oak_manuscript_entitlement_request", device_id: DEVICE, account_id: ACCOUNT }],
    [{ kind: "account", subject_id: ACCOUNT }, { schema_version: "1.0", request_type: "oak_manuscript_entitlement_request", device_id: "device-bad" }],
  ]) await assert.rejects(() => service.issue(principal, body), /账号|请求|设备/);
  assert.equal(calls, 0);
});

test("no subscription and device capacity are stable failures while repository ownership drift is sanitized", async () => {
  const { signer } = fixture();
  for (const [result, code] of [
    [{ schema_version: "1.0", result_type: "oak_manuscript_device_authorization", outcome: "no_entitlement", authorization: null }, "SUBSCRIPTION_REQUIRED"],
    [{ schema_version: "1.0", result_type: "oak_manuscript_device_authorization", outcome: "device_limit", authorization: null }, "DEVICE_LIMIT"],
  ]) {
    const service = new EntitlementService({ repository: { async authorizeDevice() { return result; } }, signer });
    await assert.rejects(service.issue({ kind: "account", subject_id: ACCOUNT }, {
      schema_version: "1.0", request_type: "oak_manuscript_entitlement_request", device_id: DEVICE,
    }), (error) => error.code === code);
  }
  const drift = new EntitlementService({
    repository: { async authorizeDevice() { return authorization({ account_id: "account-0002" }); } }, signer,
  });
  await assert.rejects(drift.issue({ kind: "account", subject_id: ACCOUNT }, {
    schema_version: "1.0", request_type: "oak_manuscript_entitlement_request", device_id: DEVICE,
  }), (error) => error.code === "SERVICE_UNAVAILABLE" && !error.message.includes("account-0002"));
});

test("revoked and expired authorizations remain signed so clients can fail closed without trusting HTTP text", async () => {
  const { config, signer } = fixture();
  for (const auth of [
    authorization({ device_state: "revoked" }),
    authorization({ valid_until: "2026-07-20T00:00:00.000Z", grace_until: "2026-07-25T00:00:00.000Z" }),
  ]) {
    const service = new EntitlementService({ repository: { async authorizeDevice() { return auth; } }, signer });
    const envelope = await service.issue({ kind: "account", subject_id: ACCOUNT }, {
      schema_version: "1.0", request_type: "oak_manuscript_entitlement_request", device_id: DEVICE,
    });
    const claims = verifyEntitlement(envelope, { config, accountId: ACCOUNT, deviceId: DEVICE });
    assert.equal(claims.device_state, auth.authorization.device_state);
    assert.equal(claims.valid_until, auth.authorization.valid_until);
  }
});
