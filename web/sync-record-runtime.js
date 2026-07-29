// Deployable composition root for the authenticated SyncRecord API.
// Configuration is injected by the server platform; this module never reads
// browser state or exposes the service-role repository to callers.

"use strict";

const { createFetchHandlerAdapter } = require("./fetch-adapter");
const { createGoTrueAccessTokenVerifier } = require("./gotrue-verifier");
const { createSupabaseSessionResolver } = require("./supabase-session-adapter");
const { createSyncRecordHttpHandler } = require("./sync-record-http-handler");
const { SyncRecordService } = require("./sync-record-service");
const { SupabaseSyncRecordRepository } = require("./supabase-sync-record-repository");

function createSyncRecordFetchHandler({
  apiOrigin,
  supabaseOrigin,
  supabaseApiKey,
  supabaseServiceRoleKey,
  fetchImpl = globalThis.fetch,
  authFetchImpl = fetchImpl,
  databaseFetchImpl = fetchImpl,
  authTimeoutMs,
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
  if (typeof supabaseApiKey === "string" && supabaseApiKey === supabaseServiceRoleKey) {
    throw new TypeError("Supabase 公开 API key 与 service-role key 必须分离");
  }
  const verifyAccessToken = createGoTrueAccessTokenVerifier({
    supabaseOrigin,
    apiKey: supabaseApiKey,
    fetchImpl: authFetchImpl,
    ...(authTimeoutMs === undefined ? {} : { timeoutMs: authTimeoutMs }),
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
    resolveSession: createSupabaseSessionResolver({ verifyAccessToken }),
    securityEventSink,
    ...(requestIdFactory === undefined ? {} : { requestIdFactory }),
    ...(clock === undefined ? {} : { clock }),
  });
  return createFetchHandlerAdapter({ nodeHandler });
}

module.exports = {
  createSyncRecordFetchHandler,
};
