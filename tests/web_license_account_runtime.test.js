"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createLicenseAccountFetchHandler } = require("../web/license-account-runtime");

const API_ORIGIN = "https://accounts.oakbylake.com";
const SUPABASE_ORIGIN = "https://project-ref.supabase.co";
const API_KEY = `sb_publishable_${"a".repeat(40)}`;
const SERVICE_KEY = `service_role_${"b".repeat(48)}`;
const TOKEN = `${"c".repeat(36)}.${"d".repeat(36)}.${"e".repeat(36)}`;
const ACCOUNT = "8f3b65e1-0e6e-42b4-81c0-61e5cf9a1020";
const DEVICE = "device-10000000-0000-4000-8000-000000000001";

function dbDevice(state = "active") {
  return {
    account_id: ACCOUNT, device_id: DEVICE, device_state: state,
    first_seen_at: "2026-07-20T00:00:00.000Z", last_seen_at: "2026-07-29T11:00:00.000Z",
    revoked_at: state === "revoked" ? "2026-07-29T12:00:00.000Z" : null,
  };
}

test("production-shaped license account runtime verifies identity, lists, and revokes owner device", async () => {
  const calls = [];
  const events = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === `${SUPABASE_ORIGIN}/auth/v1/user`) {
      return new Response(JSON.stringify({ id: ACCOUNT, email: "private@example.test" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("oak_manuscript_license_account_overview")) {
      return new Response(JSON.stringify({
        schema_version: "1.0", result_type: "oak_manuscript_license_account_snapshot", account_id: ACCOUNT,
        entitlement: {
          account_id: ACCOUNT, entitlement_id: "ent-20000000-0000-4000-8000-000000000002",
          entitlement_state: "active", not_before: "2026-07-01T00:00:00.000Z",
          valid_until: "2026-08-01T00:00:00.000Z", grace_until: "2026-08-08T00:00:00.000Z", revision: 2,
        }, devices: [dbDevice()], total_devices: 1,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(dbDevice("revoked")), { status: 200, headers: { "content-type": "application/json" } });
  };
  const handler = createLicenseAccountFetchHandler({
    apiOrigin: API_ORIGIN, supabaseOrigin: SUPABASE_ORIGIN,
    supabaseApiKey: API_KEY, supabaseServiceRoleKey: SERVICE_KEY,
    fetchImpl, clock: () => new Date("2026-07-29T12:00:00.000Z"),
    requestIdFactory: () => "30000000-0000-4000-8000-000000000003",
    securityEventSink: (event) => events.push(event),
  });
  const listed = await handler(new Request(`${API_ORIGIN}/manuscript/api/v1/account/license`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  }));
  const listedBody = await listed.json();
  assert.equal(listed.status, 200, JSON.stringify(listedBody));
  assert.equal(listedBody.devices[0].device_id, DEVICE);
  const revokeBody = JSON.stringify({ schema_version: "1.0", action: "revoke_device" });
  const revoked = await handler(new Request(`${API_ORIGIN}/manuscript/api/v1/account/license/devices/${DEVICE}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, Origin: API_ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(revokeBody)) },
    body: revokeBody,
  }));
  const revokedBody = await revoked.json();
  assert.equal(revoked.status, 200, JSON.stringify(revokedBody));
  assert.equal(revokedBody.device.device_state, "revoked");
  assert.equal(calls.filter((call) => call.url.endsWith("/auth/v1/user")).length, 2);
  assert.equal(events.length, 2);
  for (const secret of [TOKEN, API_KEY, SERVICE_KEY, ACCOUNT, DEVICE]) {
    assert.equal(JSON.stringify(events).includes(secret), false);
  }
});

test("license account runtime requires separate public/service credentials and an audit sink", () => {
  const base = {
    apiOrigin: API_ORIGIN, supabaseOrigin: SUPABASE_ORIGIN,
    supabaseApiKey: API_KEY, supabaseServiceRoleKey: SERVICE_KEY,
    fetchImpl: async () => null, securityEventSink() {},
  };
  assert.throws(() => createLicenseAccountFetchHandler({ ...base, securityEventSink: undefined }), /securityEventSink/);
  assert.throws(() => createLicenseAccountFetchHandler({ ...base, supabaseApiKey: SERVICE_KEY }), /必须分离/);
});
