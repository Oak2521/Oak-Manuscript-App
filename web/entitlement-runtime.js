// Production-shaped composition root for the desktop entitlement endpoint.
// All credentials and the Ed25519 private key are injected by server code.

"use strict";

const { createFetchHandlerAdapter } = require("./fetch-adapter");
const { createGoTrueAccessTokenVerifier } = require("./gotrue-verifier");
const { createSupabaseSessionResolver } = require("./supabase-session-adapter");
const { createEd25519EntitlementSigner } = require("./entitlement-signer");
const { EntitlementService } = require("./entitlement-service");
const { createEntitlementHttpHandler } = require("./entitlement-http-handler");
const { SupabaseEntitlementRepository } = require("./supabase-entitlement-repository");

function createEntitlementFetchHandler({
  apiOrigin,
  issuer,
  audience,
  keyId,
  signingPrivateKey,
  supabaseOrigin,
  supabaseApiKey,
  supabaseServiceRoleKey,
  fetchImpl = globalThis.fetch,
  authFetchImpl = fetchImpl,
  databaseFetchImpl = fetchImpl,
  authTimeoutMs,
  databaseTimeoutMs,
  maxDevicesPerAccount,
  requestIdFactory,
  clock,
  securityEventSink,
} = {}) {
  if (typeof securityEventSink !== "function") throw new TypeError("生产权益运行时需要 securityEventSink");
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
  const signer = createEd25519EntitlementSigner({ issuer, audience, keyId, privateKey: signingPrivateKey });
  const service = new EntitlementService({
    repository,
    signer,
    ...(clock === undefined ? {} : { clock }),
    ...(maxDevicesPerAccount === undefined ? {} : { maxDevicesPerAccount }),
  });
  const nodeHandler = createEntitlementHttpHandler({
    service,
    expectedOrigin: apiOrigin,
    resolveSession: createSupabaseSessionResolver({ verifyAccessToken }),
    securityEventSink,
    ...(requestIdFactory === undefined ? {} : { requestIdFactory }),
    ...(clock === undefined ? {} : { clock }),
  });
  return createFetchHandlerAdapter({ nodeHandler });
}

module.exports = { createEntitlementFetchHandler };
