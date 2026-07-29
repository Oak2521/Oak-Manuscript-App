// Trusted billing-adapter snapshot ingestion for subscription truth.
// Raw provider webhooks, payment details, customer PII, and secrets are
// deliberately outside this contract and must be verified upstream.

"use strict";

const crypto = require("node:crypto");
const { ACCOUNT_PATTERN, ENTITLEMENT_PATTERN } = require("./entitlement-signer");

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const EVENT_KEYS = Object.freeze([
  "schema_version", "event_type", "provider_event_id", "account_id", "entitlement_id",
  "reason", "entitlement_state", "occurred_at", "issued_at", "not_before", "valid_until", "grace_until",
]);
const RESULT_KEYS = Object.freeze([
  "schema_version", "result_type", "outcome", "account_id", "provider_id",
  "provider_event_id", "event_fingerprint", "entitlement_revision",
]);
const REASONS = Object.freeze(["purchase", "renewal", "cancellation", "refund", "chargeback", "manual"]);
const OUTCOMES = Object.freeze(["applied", "replayed", "stale", "conflict"]);
const ERROR_MESSAGES = Object.freeze({
  EVENT_CONFLICT: "订阅事件幂等标识与既有事件冲突",
  INVALID_EVENT: "订阅事件不符合 v1 契约",
  SERVICE_UNAVAILABLE: "订阅事件服务暂时不可用",
  SOURCE_REQUIRED: "需要可信的订阅事件来源",
});

class SubscriptionEventServiceError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.SERVICE_UNAVAILABLE);
    this.name = "SubscriptionEventServiceError";
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : "SERVICE_UNAVAILABLE";
  }
}

function fail(code) { throw new SubscriptionEventServiceError(code); }

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function canonicalTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function validateSubscriptionEvent(value) {
  if (!exactKeys(value, EVENT_KEYS) || value.schema_version !== "1.0" ||
      value.event_type !== "oak_manuscript_subscription_snapshot" ||
      !EVENT_ID_PATTERN.test(value.provider_event_id || "") || !ACCOUNT_PATTERN.test(value.account_id || "") ||
      !ENTITLEMENT_PATTERN.test(value.entitlement_id || "") || !REASONS.includes(value.reason) ||
      !["active", "revoked"].includes(value.entitlement_state) ||
      ![value.occurred_at, value.issued_at, value.not_before, value.valid_until, value.grace_until].every(canonicalTime)) {
    fail("INVALID_EVENT");
  }
  if (Date.parse(value.issued_at) > Date.parse(value.occurred_at) ||
      Date.parse(value.issued_at) > Date.parse(value.not_before) ||
      Date.parse(value.not_before) > Date.parse(value.valid_until) ||
      Date.parse(value.valid_until) > Date.parse(value.grace_until) ||
      (["purchase", "renewal"].includes(value.reason) && value.entitlement_state !== "active") ||
      (["refund", "chargeback"].includes(value.reason) && value.entitlement_state !== "revoked")) {
    fail("INVALID_EVENT");
  }
  return true;
}

function canonicalSubscriptionEvent(value) {
  validateSubscriptionEvent(value);
  return JSON.stringify(canonicalValue(value));
}

function trustedSource(value) {
  if (!exactKeys(value, ["kind", "provider_id"]) || value.kind !== "billing_adapter" ||
      !PROVIDER_PATTERN.test(value.provider_id || "")) fail("SOURCE_REQUIRED");
  return value.provider_id;
}

function validateApplyResult(value, { accountId, providerId, eventId, fingerprint }) {
  if (!exactKeys(value, RESULT_KEYS) || value.schema_version !== "1.0" ||
      value.result_type !== "oak_manuscript_subscription_event_apply" || !OUTCOMES.includes(value.outcome) ||
      value.account_id !== accountId || value.provider_id !== providerId || value.provider_event_id !== eventId ||
      value.event_fingerprint !== fingerprint || !SHA256_PATTERN.test(value.event_fingerprint || "") ||
      (["applied", "replayed"].includes(value.outcome)
        ? (!Number.isSafeInteger(value.entitlement_revision) || value.entitlement_revision < 1)
        : value.entitlement_revision !== null)) {
    throw new TypeError("订阅事件 repository 响应非法");
  }
  return Object.freeze({ ...value });
}

class SubscriptionEventService {
  constructor({ repository, clock = () => new Date() } = {}) {
    if (!repository || typeof repository.applySubscriptionEvent !== "function" || typeof clock !== "function") {
      throw new TypeError("订阅事件服务依赖不完整");
    }
    this.repository = repository;
    this.clock = clock;
  }

  async ingest(source, input) {
    const providerId = trustedSource(source);
    validateSubscriptionEvent(input);
    let now;
    try {
      const current = this.clock();
      now = current instanceof Date ? current : new Date(current);
      if (Number.isNaN(now.getTime())) throw new TypeError("clock");
    } catch { fail("SERVICE_UNAVAILABLE"); }
    if (Date.parse(input.occurred_at) > now.getTime() + MAX_FUTURE_SKEW_MS) fail("INVALID_EVENT");
    const event = structuredClone(input);
    const canonical = canonicalSubscriptionEvent(event);
    const fingerprint = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
    let result;
    try {
      result = validateApplyResult(
        await this.repository.applySubscriptionEvent(providerId, event, canonical, fingerprint),
        { accountId: event.account_id, providerId, eventId: event.provider_event_id, fingerprint },
      );
    } catch (error) {
      if (error instanceof SubscriptionEventServiceError) throw error;
      fail("SERVICE_UNAVAILABLE");
    }
    if (result.outcome === "conflict") fail("EVENT_CONFLICT");
    return Object.freeze({
      schema_version: "1.0",
      receipt_type: "oak_manuscript_subscription_event_receipt",
      provider_event_id: event.provider_event_id,
      outcome: result.outcome,
      entitlement_revision: result.entitlement_revision,
    });
  }
}

module.exports = {
  ERROR_MESSAGES,
  EVENT_KEYS,
  EVENT_ID_PATTERN,
  MAX_FUTURE_SKEW_MS,
  OUTCOMES,
  PROVIDER_PATTERN,
  REASONS,
  RESULT_KEYS,
  SubscriptionEventService,
  SubscriptionEventServiceError,
  canonicalSubscriptionEvent,
  validateApplyResult,
  validateSubscriptionEvent,
};
