// Deployable composition root for the authenticated SyncRecord API.
// Configuration is injected by the server platform; this module never reads
// browser state or exposes the service-role repository to callers.

"use strict";

const { createFetchHandlerAdapter } = require("./fetch-adapter");
const { createOakAccountAccessTokenVerifier } = require("./oak-account-token-verifier");
const { createOakAccountSessionResolver } = require("./oak-account-session-adapter");
const { createSyncRecordHttpHandler } = require("./sync-record-http-handler");
const { SyncRecordService } = require("./sync-record-service");
const { SupabaseSyncRecordRepository } = require("./supabase-sync-record-repository");

function createSyncRecordFetchHandler({
  apiOrigin,
  accountIssuer,
  accountAudience,
  accountTrustedKeys,
  supabaseOrigin,
  supabaseServiceRoleKey,
  fetchImpl = globalThis.fetch,
  databaseFetchImpl = fetchImpl,
  databaseTimeoutMs,
  maxRecordsPerAccount,
  maxListItems,
  requestIdFactory,
  clock,
  securityEventSink,
} = {}) {
  if (typeof securityEventSink !== "function") {
    throw new TypeError("生产同步运行时需要 securityEventSink");
  }
  const verifyAccessToken = createOakAccountAccessTokenVerifier({
    issuer: accountIssuer,
    audience: accountAudience,
    trustedKeys: accountTrustedKeys,
    ...(clock === undefined ? {} : { clock }),
  });
  const repository = new SupabaseSyncRecordRepository({
    supabaseOrigin,
    serviceRoleKey: supabaseServiceRoleKey,
    fetchImpl: databaseFetchImpl,
    ...(databaseTimeoutMs === undefined ? {} : { timeoutMs: databaseTimeoutMs }),
  });
  const service = new SyncRecordService({
    repository,
    ...(clock === undefined ? {} : { clock }),
    ...(maxRecordsPerAccount === undefined ? {} : { maxRecordsPerAccount }),
    ...(maxListItems === undefined ? {} : { maxListItems }),
  });
  const nodeHandler = createSyncRecordHttpHandler({
    service,
    expectedOrigin: apiOrigin,
    resolveSession: createOakAccountSessionResolver({ verifyAccessToken }),
    securityEventSink,
    ...(requestIdFactory === undefined ? {} : { requestIdFactory }),
    ...(clock === undefined ? {} : { clock }),
  });
  return createFetchHandlerAdapter({ nodeHandler });
}

module.exports = {
  createSyncRecordFetchHandler,
};
