// Production-shaped composition root for the account license/device API.

"use strict";

const { createFetchHandlerAdapter } = require("./fetch-adapter");
const { createGoTrueAccessTokenVerifier } = require("./gotrue-verifier");
const { createSupabaseSessionResolver } = require("./supabase-session-adapter");
const { createLicenseAccountHttpHandler } = require("./license-account-http-handler");
const { LicenseAccountService } = require("./license-account-service");
const { SupabaseEntitlementRepository } = require("./supabase-entitlement-repository");

function createLicenseAccountFetchHandler({
  apiOrigin,
  supabaseOrigin,
  supabaseApiKey,
  supabaseServiceRoleKey,
  fetchImpl = globalThis.fetch,
  authFetchImpl = fetchImpl,
  databaseFetchImpl = fetchImpl,
  authTimeoutMs,
  databaseTimeoutMs,
  maxListItems,
  requestIdFactory,
  clock,
  securityEventSink,
} = {}) {
  if (typeof securityEventSink !== "function") throw new TypeError("生产账号订阅运行时需要 securityEventSink");
  if (typeof supabaseApiKey === "string" && supabaseApiKey === supabaseServiceRoleKey) {
    throw new TypeError("Supabase 公开 API key 与 service-role key 必须分离");
  }
  const verifyAccessToken = createGoTrueAccessTokenVerifier({
    supabaseOrigin,
    apiKey: supabaseApiKey,
    fetchImpl: authFetchImpl,
    ...(authTimeoutMs === undefined ? {} : { timeoutMs: authTimeoutMs }),
  });
  const repository = new SupabaseEntitlementRepository({
    supabaseOrigin,
    serviceRoleKey: supabaseServiceRoleKey,
    fetchImpl: databaseFetchImpl,
    ...(databaseTimeoutMs === undefined ? {} : { timeoutMs: databaseTimeoutMs }),
  });
  const service = new LicenseAccountService({
    repository,
    ...(clock === undefined ? {} : { clock }),
    ...(maxListItems === undefined ? {} : { maxListItems }),
  });
  const nodeHandler = createLicenseAccountHttpHandler({
    service,
    expectedOrigin: apiOrigin,
    resolveSession: createSupabaseSessionResolver({ verifyAccessToken }),
    securityEventSink,
    ...(requestIdFactory === undefined ? {} : { requestIdFactory }),
    ...(clock === undefined ? {} : { clock }),
  });
  return createFetchHandlerAdapter({ nodeHandler });
}

module.exports = { createLicenseAccountFetchHandler };
