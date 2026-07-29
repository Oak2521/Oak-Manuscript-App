// Server-only composition for an upstream-verified billing adapter.
// Provider-specific signature verification stays outside this normalized core.

"use strict";

const { PROVIDER_PATTERN, SubscriptionEventService } = require("./subscription-event-service");
const { SupabaseEntitlementRepository } = require("./supabase-entitlement-repository");

function createNormalizedSubscriptionEventIngestor({
  providerId,
  supabaseOrigin,
  supabaseServiceRoleKey,
  databaseFetchImpl = globalThis.fetch,
  databaseTimeoutMs,
  clock,
} = {}) {
  if (typeof providerId !== "string" || !PROVIDER_PATTERN.test(providerId)) {
    throw new TypeError("providerId 不是可信订阅来源标识");
  }
  const repository = new SupabaseEntitlementRepository({
    supabaseOrigin,
    serviceRoleKey: supabaseServiceRoleKey,
    fetchImpl: databaseFetchImpl,
    ...(databaseTimeoutMs === undefined ? {} : { timeoutMs: databaseTimeoutMs }),
  });
  const service = new SubscriptionEventService({
    repository,
    ...(clock === undefined ? {} : { clock }),
  });
  const source = Object.freeze({ kind: "billing_adapter", provider_id: providerId });
  return Object.freeze({ ingest: (input) => service.ingest(source, input) });
}

module.exports = { createNormalizedSubscriptionEventIngestor };
