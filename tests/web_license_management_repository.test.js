"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { canonicalSubscriptionEvent } = require("../web/subscription-event-service");
const { SupabaseEntitlementRepository } = require("../web/supabase-entitlement-repository");

const ORIGIN = "https://project-ref.supabase.co";
const KEY = `service_role_${"s".repeat(48)}`;
const ACCOUNT = "account-0001";
const DEVICE = "device-10000000-0000-4000-8000-000000000001";
const NOW = "2026-07-29T12:00:00.000Z";

function subscriptionEvent() {
  return {
    schema_version: "1.0", event_type: "oak_manuscript_subscription_snapshot",
    provider_event_id: "event-30000000-0000-4000-8000-000000000003",
    account_id: ACCOUNT,
    entitlement_id: "ent-20000000-0000-4000-8000-000000000002",
    reason: "renewal", entitlement_state: "active",
    occurred_at: NOW, issued_at: "2026-07-01T00:00:00.000Z",
    not_before: "2026-07-01T00:00:00.000Z", valid_until: "2026-08-01T00:00:00.000Z",
    grace_until: "2026-08-08T00:00:00.000Z",
  };
}

function applyResult() {
  const input = subscriptionEvent();
  return {
    schema_version: "1.0", result_type: "oak_manuscript_subscription_event_apply", outcome: "applied",
    account_id: ACCOUNT, provider_id: "test-billing", provider_event_id: input.provider_event_id,
    event_fingerprint: crypto.createHash("sha256").update(canonicalSubscriptionEvent(input)).digest("hex"),
    entitlement_revision: 2,
  };
}

function device(overrides = {}) {
  return {
    account_id: ACCOUNT, device_id: DEVICE, device_state: "active",
    first_seen_at: "2026-07-20T00:00:00.000Z", last_seen_at: "2026-07-29T11:00:00.000Z",
    revoked_at: null, ...overrides,
  };
}

function accountSnapshot() {
  return {
    schema_version: "1.0", result_type: "oak_manuscript_license_account_snapshot", account_id: ACCOUNT,
    entitlement: {
      account_id: ACCOUNT, entitlement_id: "ent-20000000-0000-4000-8000-000000000002",
      entitlement_state: "active", not_before: "2026-07-01T00:00:00.000Z",
      valid_until: "2026-08-01T00:00:00.000Z", grace_until: "2026-08-08T00:00:00.000Z", revision: 2,
    },
    devices: [device()], total_devices: 1,
  };
}

function response(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

test("repository uses three fixed service-role RPCs for event apply, account overview, and revoke", async () => {
  const calls = [];
  const values = [applyResult(), accountSnapshot(), device({ device_state: "revoked", revoked_at: NOW })];
  const repository = new SupabaseEntitlementRepository({
    supabaseOrigin: ORIGIN, serviceRoleKey: KEY,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(values.shift()); },
  });
  const input = subscriptionEvent();
  const canonical = canonicalSubscriptionEvent(input);
  const fingerprint = crypto.createHash("sha256").update(canonical).digest("hex");
  assert.deepEqual(await repository.applySubscriptionEvent("test-billing", input, canonical, fingerprint), applyResult());
  assert.deepEqual(await repository.getLicenseAccount(ACCOUNT, 20), accountSnapshot());
  assert.deepEqual(await repository.revokeDevice(ACCOUNT, DEVICE, NOW), device({ device_state: "revoked", revoked_at: NOW }));
  assert.deepEqual(calls.map((call) => call.url), [
    `${ORIGIN}/rest/v1/rpc/oak_manuscript_license_apply_subscription_event`,
    `${ORIGIN}/rest/v1/rpc/oak_manuscript_license_account_overview`,
    `${ORIGIN}/rest/v1/rpc/oak_manuscript_license_revoke_device`,
  ]);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    p_provider_id: "test-billing", p_event: input, p_canonical_event: canonical, p_event_fingerprint: fingerprint,
  });
  assert.deepEqual(JSON.parse(calls[1].options.body), { p_account_id: ACCOUNT, p_limit: 20 });
  assert.deepEqual(JSON.parse(calls[2].options.body), { p_account_id: ACCOUNT, p_device_id: DEVICE, p_now: NOW });
  assert.equal(calls.every((call) => call.options.headers.authorization === `Bearer ${KEY}`), true);
});

test("repository rejects event, account, device, and ownership response poisoning", async () => {
  const input = subscriptionEvent();
  const canonical = canonicalSubscriptionEvent(input);
  const fingerprint = crypto.createHash("sha256").update(canonical).digest("hex");
  const poisonedValues = [
    { ...applyResult(), account_id: "account-0002" },
    { ...accountSnapshot(), devices: [device({ account_id: "account-0002" })] },
    device({ device_id: "device-20000000-0000-4000-8000-000000000002" }),
  ];
  for (const [method, args] of [
    ["applySubscriptionEvent", ["test-billing", input, canonical, fingerprint]],
    ["getLicenseAccount", [ACCOUNT, 20]],
    ["revokeDevice", [ACCOUNT, DEVICE, NOW]],
  ]) {
    const value = poisonedValues.shift();
    const repository = new SupabaseEntitlementRepository({
      supabaseOrigin: ORIGIN, serviceRoleKey: KEY, fetchImpl: async () => response(value),
    });
    await assert.rejects(() => repository[method](...args), /响应|归属|非法/);
  }
  const repository = new SupabaseEntitlementRepository({
    supabaseOrigin: ORIGIN, serviceRoleKey: KEY, fetchImpl: async () => response(applyResult()),
  });
  await assert.rejects(() => repository.applySubscriptionEvent(
    "test-billing", input, `${canonical} `, fingerprint,
  ), /canonical/);
});

test("migration 004 keeps normalized events and account device management server-only and atomic", () => {
  const schemaRoot = path.join(__dirname, "..", "web", "schemas");
  for (const file of [
    "subscription-event-v1.schema.json", "subscription-event-apply-result-v1.schema.json",
    "license-account-snapshot-v1.schema.json",
  ]) {
    const schema = JSON.parse(fs.readFileSync(path.join(schemaRoot, file), "utf8"));
    assert.equal(schema.additionalProperties, false, file);
  }
  const sql = fs.readFileSync(path.join(__dirname, "..", "web", "supabase", "004_subscription_events_and_devices.sql"), "utf8").toLowerCase();
  const executable = sql.replace(/^--.*$/gmu, "");
  for (const fragment of [
    "create table if not exists public.oak_manuscript_subscription_events",
    "oak_manuscript_license_apply_subscription_event",
    "oak_manuscript_license_account_overview",
    "oak_manuscript_license_revoke_device",
    "pg_advisory_xact_lock",
    "force row level security",
    "grant execute on function",
    "to service_role",
  ]) assert.equal(sql.includes(fragment), true, fragment);
  for (const forbidden of ["raw_payload", "payment_secret", "card_number", "customer_email", "manuscript_text", "filename", "file_path"]) {
    assert.equal(executable.includes(forbidden), false, forbidden);
  }
  assert.equal(/grant\s+(?:select|insert|update|delete).*\s+to\s+(?:anon|authenticated)/u.test(executable), false);
});
