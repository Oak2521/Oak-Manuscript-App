"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSupabaseServerCredentialHeaders,
  validateSupabaseServerKey,
} = require("../web/supabase-server-key");

test("new Supabase secret keys use apikey only and are never sent as Bearer JWTs", () => {
  const key = ["sb", "secret", "test-only-not-a-real-key"].join("_");
  assert.deepEqual(createSupabaseServerCredentialHeaders(key), {
    apikey: key,
  });
});

test("legacy Supabase service_role JWTs retain apikey and Bearer compatibility", () => {
  const key = "legacy_service_role_jwt_012345678901234567890123456789";
  assert.deepEqual(createSupabaseServerCredentialHeaders(key), {
    apikey: key,
    authorization: `Bearer ${key}`,
  });
});

test("server key validation rejects header injection and undersized credentials", () => {
  const injected = `${["sb", "secret", "test-only"].join("_")}\r\nX-Leak: yes`;
  for (const key of [undefined, "short", injected, "key,other"]) {
    assert.throws(() => validateSupabaseServerKey(key), /Supabase 服务端密钥/);
  }
});
