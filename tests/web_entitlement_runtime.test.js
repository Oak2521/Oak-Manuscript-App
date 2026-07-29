"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { verifyEntitlement } = require("../electron/license-entitlement");
const { LicenseHttpClient } = require("../electron/license-http-client");
const { createEntitlementFetchHandler } = require("../web/entitlement-runtime");

const API_ORIGIN = "https://accounts.oakbylake.com";
const SUPABASE_ORIGIN = "https://project-ref.supabase.co";
const API_KEY = `sb_publishable_${"a".repeat(40)}`;
const SERVICE_KEY = `service_role_${"b".repeat(48)}`;
const TOKEN = `${"c".repeat(36)}.${"d".repeat(36)}.${"e".repeat(36)}`;
const ACCOUNT = "8f3b65e1-0e6e-42b4-81c0-61e5cf9a1020";
const DEVICE = "device-10000000-0000-4000-8000-000000000001";

test("production-shaped runtime verifies GoTrue, authorizes one device atomically, and signs for the desktop", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  const calls = [];
  const events = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === `${SUPABASE_ORIGIN}/auth/v1/user`) {
      assert.equal(options.headers.authorization, `Bearer ${TOKEN}`);
      return new Response(JSON.stringify({ id: ACCOUNT, email: "private@example.test" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(url, `${SUPABASE_ORIGIN}/rest/v1/rpc/oak_manuscript_license_authorize_device`);
    const input = JSON.parse(options.body);
    assert.equal(input.p_account_id, ACCOUNT);
    assert.equal(input.p_device_id, DEVICE);
    return new Response(JSON.stringify({
      schema_version: "1.0", result_type: "oak_manuscript_device_authorization", outcome: "authorized",
      authorization: {
        account_id: ACCOUNT,
        entitlement_id: "ent-20000000-0000-4000-8000-000000000002",
        device_id: DEVICE,
        device_state: "active",
        issued_at: "2026-07-01T00:00:00.000Z",
        not_before: "2026-07-01T00:00:00.000Z",
        valid_until: "2026-08-01T00:00:00.000Z",
        grace_until: "2026-08-08T00:00:00.000Z",
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const handler = createEntitlementFetchHandler({
    apiOrigin: API_ORIGIN,
    issuer: `${API_ORIGIN}/`,
    audience: "oak-manuscript-desktop",
    keyId: "oak-license-2026-01",
    signingPrivateKey: privateKey,
    supabaseOrigin: SUPABASE_ORIGIN,
    supabaseApiKey: API_KEY,
    supabaseServiceRoleKey: SERVICE_KEY,
    fetchImpl,
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
    requestIdFactory: () => "30000000-0000-4000-8000-000000000003",
    securityEventSink: (event) => events.push(event),
  });
  const client = new LicenseHttpClient({
    endpoint: `${API_ORIGIN}/manuscript/api/v1/entitlement`,
    fetchImpl: (url, options) => handler(new Request(url, options)),
  });
  const envelope = await client.fetchEntitlement({ accessToken: TOKEN, deviceId: DEVICE });
  const config = {
    schema_version: "1.0", config_type: "oak_manuscript_desktop_license", status: "configured",
    entitlement_endpoint: `${API_ORIGIN}/manuscript/api/v1/entitlement`, issuer: `${API_ORIGIN}/`,
    audience: "oak-manuscript-desktop",
    trusted_keys: [{ key_id: "oak-license-2026-01", algorithm: "Ed25519", public_key_jwk: { kty: "OKP", crv: "Ed25519", x: publicJwk.x } }],
  };
  assert.equal(verifyEntitlement(envelope, { config, accountId: ACCOUNT, deviceId: DEVICE }).tier, "pro");
  assert.equal(calls.length, 2);
  assert.equal(events.length, 1);
  for (const secret of [TOKEN, API_KEY, SERVICE_KEY, ACCOUNT, DEVICE]) {
    assert.equal(JSON.stringify(events).includes(secret), false);
  }
});

test("runtime requires separate public/service credentials, a server signing key, and an audit sink", () => {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const base = {
    apiOrigin: API_ORIGIN, issuer: `${API_ORIGIN}/`, audience: "oak-manuscript-desktop",
    keyId: "oak-license-2026-01", signingPrivateKey: privateKey,
    supabaseOrigin: SUPABASE_ORIGIN, supabaseApiKey: API_KEY, supabaseServiceRoleKey: SERVICE_KEY,
    fetchImpl: async () => null, securityEventSink() {},
  };
  assert.throws(() => createEntitlementFetchHandler({ ...base, securityEventSink: undefined }), /securityEventSink/);
  assert.throws(() => createEntitlementFetchHandler({ ...base, supabaseApiKey: SERVICE_KEY }), /必须分离/);
  assert.throws(() => createEntitlementFetchHandler({ ...base, signingPrivateKey: undefined }), /签名|private/i);
});
