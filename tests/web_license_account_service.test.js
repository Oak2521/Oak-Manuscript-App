"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { LicenseAccountService } = require("../web/license-account-service");

const ACCOUNT = "account-0001";
const DEVICE = "device-10000000-0000-4000-8000-000000000001";
const NOW = "2026-07-29T12:00:00.000Z";

function device(overrides = {}) {
  return {
    account_id: ACCOUNT,
    device_id: DEVICE,
    device_state: "active",
    first_seen_at: "2026-07-20T00:00:00.000Z",
    last_seen_at: "2026-07-29T11:00:00.000Z",
    revoked_at: null,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    schema_version: "1.0",
    result_type: "oak_manuscript_license_account_snapshot",
    account_id: ACCOUNT,
    entitlement: {
      account_id: ACCOUNT,
      entitlement_id: "ent-20000000-0000-4000-8000-000000000002",
      entitlement_state: "active",
      not_before: "2026-07-01T00:00:00.000Z",
      valid_until: "2026-08-01T00:00:00.000Z",
      grace_until: "2026-08-08T00:00:00.000Z",
      revision: 2,
    },
    devices: [device()],
    total_devices: 1,
    ...overrides,
  };
}

test("account owner receives a bounded content-free subscription and device overview", async () => {
  const calls = [];
  const service = new LicenseAccountService({
    repository: {
      async getLicenseAccount(...args) { calls.push(args); return snapshot(); },
      async revokeDevice() { throw new Error("unused"); },
    },
    maxListItems: 20,
  });
  const result = await service.getOverview({ kind: "account", subject_id: ACCOUNT });
  assert.deepEqual(calls, [[ACCOUNT, 20]]);
  assert.deepEqual(result, {
    schema_version: "1.0",
    account_type: "oak_manuscript_license_account",
    entitlement: {
      entitlement_state: "active",
      not_before: "2026-07-01T00:00:00.000Z",
      valid_until: "2026-08-01T00:00:00.000Z",
      grace_until: "2026-08-08T00:00:00.000Z",
    },
    devices: [{
      device_id: DEVICE,
      device_state: "active",
      first_seen_at: "2026-07-20T00:00:00.000Z",
      last_seen_at: "2026-07-29T11:00:00.000Z",
      revoked_at: null,
    }],
    truncated: false,
  });
  assert.equal(JSON.stringify(result).includes(ACCOUNT), false);
  assert.equal(JSON.stringify(result).includes("ent-"), false);
});

test("owner revoke is idempotent, exact, and never accepts a self-reported account", async () => {
  const calls = [];
  const service = new LicenseAccountService({
    repository: {
      async getLicenseAccount() { return snapshot(); },
      async revokeDevice(...args) { calls.push(args); return device({ device_state: "revoked", revoked_at: NOW }); },
    },
    clock: () => new Date(NOW),
  });
  const result = await service.revokeDevice({ kind: "account", subject_id: ACCOUNT }, DEVICE);
  assert.deepEqual(calls, [[ACCOUNT, DEVICE, NOW]]);
  assert.equal(result.outcome, "revoked");
  assert.equal(result.device.device_state, "revoked");
  await assert.rejects(() => service.revokeDevice(
    { kind: "account", subject_id: ACCOUNT, account_id: ACCOUNT }, DEVICE,
  ), (error) => error.code === "AUTH_REQUIRED");
});

test("foreign/missing devices are indistinguishable and repository ownership drift is sanitized", async () => {
  const missing = new LicenseAccountService({
    repository: { async getLicenseAccount() { return snapshot(); }, async revokeDevice() { return null; } },
  });
  await assert.rejects(() => missing.revokeDevice({ kind: "account", subject_id: ACCOUNT }, DEVICE),
    (error) => error.code === "DEVICE_NOT_FOUND");
  const poisoned = new LicenseAccountService({
    repository: {
      async getLicenseAccount() { return snapshot({ account_id: "account-0002" }); },
      async revokeDevice() { return device({ account_id: "account-0002" }); },
    },
  });
  await assert.rejects(() => poisoned.getOverview({ kind: "account", subject_id: ACCOUNT }),
    (error) => error.code === "SERVICE_UNAVAILABLE" && !error.message.includes("account-0002"));
});
