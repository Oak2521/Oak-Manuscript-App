"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  SubscriptionEventService,
  canonicalSubscriptionEvent,
  validateSubscriptionEvent,
} = require("../web/subscription-event-service");

const SOURCE = Object.freeze({ kind: "billing_adapter", provider_id: "test-billing" });
const ACCOUNT = "account-0001";
const EVENT_ID = "event-30000000-0000-4000-8000-000000000003";

function event(overrides = {}) {
  return {
    schema_version: "1.0",
    event_type: "oak_manuscript_subscription_snapshot",
    provider_event_id: EVENT_ID,
    account_id: ACCOUNT,
    entitlement_id: "ent-20000000-0000-4000-8000-000000000002",
    reason: "purchase",
    entitlement_state: "active",
    occurred_at: "2026-07-29T12:00:00.000Z",
    issued_at: "2026-07-01T00:00:00.000Z",
    not_before: "2026-07-01T00:00:00.000Z",
    valid_until: "2026-08-01T00:00:00.000Z",
    grace_until: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function applyResult(outcome = "applied", overrides = {}) {
  return {
    schema_version: "1.0",
    result_type: "oak_manuscript_subscription_event_apply",
    outcome,
    account_id: ACCOUNT,
    provider_id: SOURCE.provider_id,
    provider_event_id: EVENT_ID,
    event_fingerprint: crypto.createHash("sha256").update(canonicalSubscriptionEvent(event())).digest("hex"),
    entitlement_revision: outcome === "applied" || outcome === "replayed" ? 1 : null,
    ...overrides,
  };
}

test("trusted billing adapter applies one canonical content-free subscription snapshot", async () => {
  const calls = [];
  const service = new SubscriptionEventService({
    repository: { async applySubscriptionEvent(...args) { calls.push(args); return applyResult(); } },
    clock: () => new Date("2026-07-29T12:01:00.000Z"),
  });
  const receipt = await service.ingest(SOURCE, event());
  assert.deepEqual(receipt, {
    schema_version: "1.0",
    receipt_type: "oak_manuscript_subscription_event_receipt",
    provider_event_id: EVENT_ID,
    outcome: "applied",
    entitlement_revision: 1,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], SOURCE.provider_id);
  assert.deepEqual(calls[0][1], event());
  assert.equal(calls[0][2], canonicalSubscriptionEvent(event()));
  assert.equal(calls[0][3], applyResult().event_fingerprint);
  assert.equal(JSON.stringify(receipt).includes(ACCOUNT), false);
});

test("untrusted sources, self-reported provider fields, invalid times, and future events stop before repository access", async () => {
  let calls = 0;
  const service = new SubscriptionEventService({
    repository: { async applySubscriptionEvent() { calls += 1; return applyResult(); } },
    clock: () => new Date("2026-07-29T12:01:00.000Z"),
  });
  for (const [source, input] of [
    [{ kind: "account", provider_id: "test-billing" }, event()],
    [SOURCE, event({ provider_id: "self-reported" })],
    [SOURCE, event({ valid_until: "2026-06-01T00:00:00.000Z" })],
    [SOURCE, event({ occurred_at: "2026-07-29T12:10:00.000Z" })],
    [SOURCE, event({ reason: "refund", entitlement_state: "active" })],
  ]) await assert.rejects(() => service.ingest(source, input), /来源|事件|时间|状态/);
  assert.equal(calls, 0);
});

test("replay and stale outcomes are explicit while conflicts and repository poisoning are sanitized", async () => {
  for (const outcome of ["replayed", "stale"]) {
    const service = new SubscriptionEventService({
      repository: { async applySubscriptionEvent() { return applyResult(outcome); } },
      clock: () => new Date("2026-07-29T12:01:00.000Z"),
    });
    assert.equal((await service.ingest(SOURCE, event())).outcome, outcome);
  }
  const conflict = new SubscriptionEventService({
    repository: { async applySubscriptionEvent() { return applyResult("conflict"); } },
    clock: () => new Date("2026-07-29T12:01:00.000Z"),
  });
  await assert.rejects(() => conflict.ingest(SOURCE, event()), (error) => error.code === "EVENT_CONFLICT");
  const poisoned = new SubscriptionEventService({
    repository: { async applySubscriptionEvent() { return applyResult("applied", { account_id: "account-0002" }); } },
    clock: () => new Date("2026-07-29T12:01:00.000Z"),
  });
  await assert.rejects(() => poisoned.ingest(SOURCE, event()), (error) =>
    error.code === "SERVICE_UNAVAILABLE" && !error.message.includes("account-0002"));
});

test("tracked subscription event schema is exact and contains no payment payload or personal data fields", () => {
  assert.equal(validateSubscriptionEvent(event()), true);
  const serialized = canonicalSubscriptionEvent(event());
  assert.equal(serialized, canonicalSubscriptionEvent({ ...event() }));
  for (const forbidden of ["amount", "currency", "email", "name", "payment", "card", "payload", "metadata"]) {
    assert.equal(serialized.includes(`\"${forbidden}\"`), false);
  }
});
