"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { SupabaseEntitlementRepository } = require("../web/supabase-entitlement-repository");

const ORIGIN = "https://project-ref.supabase.co";
const KEY = `service_role_${"s".repeat(48)}`;
const ACCOUNT = "account-0001";
const DEVICE = "device-10000000-0000-4000-8000-000000000001";
const NOW = "2026-07-29T12:00:00.000Z";

function result(outcome = "authorized") {
  return {
    schema_version: "1.0", result_type: "oak_manuscript_device_authorization", outcome,
    authorization: outcome === "authorized" ? {
      account_id: ACCOUNT,
      entitlement_id: "ent-20000000-0000-4000-8000-000000000002",
      device_id: DEVICE,
      device_state: "active",
      issued_at: "2026-07-01T00:00:00.000Z",
      not_before: "2026-07-01T00:00:00.000Z",
      valid_until: "2026-08-01T00:00:00.000Z",
      grace_until: "2026-08-08T00:00:00.000Z",
    } : null,
  };
}

test("repository calls one fixed service-role RPC with trusted account and device inputs", async () => {
  const calls = [];
  const repository = new SupabaseEntitlementRepository({
    supabaseOrigin: ORIGIN, serviceRoleKey: KEY,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(result()), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(await repository.authorizeDevice(ACCOUNT, DEVICE, NOW, 3), result());
  assert.equal(calls[0].url, `${ORIGIN}/rest/v1/rpc/oak_manuscript_license_authorize_device`);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_account_id: ACCOUNT, p_device_id: DEVICE, p_now: NOW, p_max_devices: 3 });
});

test("repository rejects configuration, ownership drift, unknown fields, and malformed outcomes", async () => {
  assert.throws(() => new SupabaseEntitlementRepository({ supabaseOrigin: "http://bad", serviceRoleKey: KEY }), /HTTPS/);
  assert.throws(() => new SupabaseEntitlementRepository({ supabaseOrigin: ORIGIN, serviceRoleKey: "short" }), /service-role/);
  for (const poisoned of [
    { ...result(), extra: true },
    { ...result(), authorization: { ...result().authorization, account_id: "account-0002" } },
    { ...result(), authorization: { ...result().authorization, device_id: "device-20000000-0000-4000-8000-000000000002" } },
    { ...result(), outcome: "authorized", authorization: null },
    { ...result("device_limit"), authorization: result().authorization },
  ]) {
    const repository = new SupabaseEntitlementRepository({
      supabaseOrigin: ORIGIN, serviceRoleKey: KEY,
      fetchImpl: async () => new Response(JSON.stringify(poisoned), { status: 200, headers: { "content-type": "application/json" } }),
    });
    await assert.rejects(() => repository.authorizeDevice(ACCOUNT, DEVICE, NOW, 3), /响应|归属|非法/);
  }
});

test("tracked SQL keeps subscription/device state server-only and authorizes under an account lock", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "schemas", "device-authorization-v1.schema.json"), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["schema_version", "result_type", "outcome", "authorization"]);
  assert.deepEqual(schema.properties.outcome.enum, ["authorized", "no_entitlement", "device_limit"]);
  assert.equal(schema.properties.authorization.anyOf[1].additionalProperties, false);
  assert.deepEqual(schema.properties.authorization.anyOf[1].required, [
    "account_id", "entitlement_id", "device_id", "device_state",
    "issued_at", "not_before", "valid_until", "grace_until",
  ]);
  const sql = fs.readFileSync(path.join(__dirname, "..", "web", "supabase", "003_manuscript_entitlements.sql"), "utf8").toLowerCase();
  const executable = sql.replace(/^--.*$/gmu, "");
  for (const fragment of [
    "create table if not exists public.oak_manuscript_entitlements",
    "create table if not exists public.oak_manuscript_devices",
    "enable row level security",
    "force row level security",
    "pg_advisory_xact_lock",
    "oak_manuscript_license_authorize_device",
    "revoke all",
    "grant execute on function public.oak_manuscript_license_authorize_device",
    "to service_role",
  ]) assert.equal(sql.includes(fragment), true, fragment);
  for (const forbidden of ["manuscript_text", "filename", "file_path", "content_hash", "service_role_key"]) {
    assert.equal(executable.includes(forbidden), false, forbidden);
  }
  assert.equal(/grant\s+(?:select|insert|update|delete).*\s+to\s+(?:anon|authenticated)/u.test(executable), false);
});
