// Production-shaped composition root for the account license/device API.

"use strict";

const { createFetchHandlerAdapter } = require("./fetch-adapter");
const { createOakAccountAccessTokenVerifier } = require("./oak-account-token-verifier");
const { createOakAccountSessionResolver } = require("./oak-account-session-adapter");
const { createLicenseAccountHttpHandler } = require("./license-account-http-handler");
const { LicenseAccountService } = require("./license-account-service");
const { SupabaseEntitlementRepository } = require("./supabase-entitlement-repository");

function createLicenseAccountFetchHandler({
  apiOrigin,
  accountIssuer,
  accountAudience,
  accountTrustedKeys,
  supabaseOrigin,
  supabaseServiceRoleKey,
  fetchImpl = globalThis.fetch,
  databaseFetchImpl = fetchImpl,
  databaseTimeoutMs,
  maxListItems,
  requestIdFactory,
  clock,
  securityEventSink,
} = {}) {
  if (typeof securityEventSink !== "function") throw new TypeError("生产账号订阅运行时需要 securityEventSink");
  const verifyAccessToken = createOakAccountAccessTokenVerifier({
    issuer: accountIssuer,
    audience: accountAudience,
    trustedKeys: accountTrustedKeys,
    ...(clock === undefined ? {} : { clock }),
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
    resolveSession: createOakAccountSessionResolver({ verifyAccessToken }),
    securityEventSink,
    ...(requestIdFactory === undefined ? {} : { requestIdFactory }),
    ...(clock === undefined ? {} : { clock }),
  });
  return createFetchHandlerAdapter({ nodeHandler });
}

module.exports = { createLicenseAccountFetchHandler };
