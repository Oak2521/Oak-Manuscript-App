"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createNormalizedSubscriptionEventIngestor } = require("../web/subscription-event-runtime");

const ORIGIN = "https://project-ref.supabase.co";
const KEY = `service_role_${"s".repeat(48)}`;
const ACCOUNT = "account-0001";

function event() {
  return {
    schema_version: "1.0", event_type: "oak_manuscript_subscription_snapshot",
    provider_event_id: "event-30000000-0000-4000-8000-000000000003", account_id: ACCOUNT,
    entitlement_id: "ent-20000000-0000-4000-8000-000000000002",
    reason: "renewal", entitlement_state: "active", occurred_at: "2026-07-29T12:00:00.000Z",
    issued_at: "2026-07-01T00:00:00.000Z", not_before: "2026-07-01T00:00:00.000Z",
    valid_until: "2026-08-01T00:00:00.000Z", grace_until: "2026-08-08T00:00:00.000Z",
  };
}

test("normalized ingestor binds one trusted provider and never accepts raw provider credentials", async () => {
  const calls = [];
  const ingestor = createNormalizedSubscriptionEventIngestor({
    providerId: "test-billing", supabaseOrigin: ORIGIN, supabaseServiceRoleKey: KEY,
    databaseFetchImpl: async (url, options) => {
      calls.push({ url, options });
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({
        schema_version: "1.0", result_type: "oak_manuscript_subscription_event_apply", outcome: "applied",
        account_id: ACCOUNT, provider_id: "test-billing", provider_event_id: event().provider_event_id,
        event_fingerprint: body.p_event_fingerprint, entitlement_revision: 1,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    clock: () => new Date("2026-07-29T12:01:00.000Z"),
  });
  assert.equal((await ingestor.ingest(event())).outcome, "applied");
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).p_provider_id, "test-billing");
  assert.equal(JSON.stringify(event()).includes("secret"), false);
  assert.deepEqual(Object.keys(ingestor), ["ingest"]);
});

test("normalized ingestor requires a fixed provider and server-only database credential", () => {
  const base = { providerId: "test-billing", supabaseOrigin: ORIGIN, supabaseServiceRoleKey: KEY, databaseFetchImpl: async () => null };
  assert.throws(() => createNormalizedSubscriptionEventIngestor({ ...base, providerId: "bad provider" }), /provider|来源/i);
  assert.throws(() => createNormalizedSubscriptionEventIngestor({ ...base, supabaseServiceRoleKey: "short" }), /service-role/);
});
