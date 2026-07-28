"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSupabaseSessionResolver,
  extractUniqueBearerToken,
} = require("../web/supabase-session-adapter");

const TOKEN = `${"a".repeat(36)}.${"b".repeat(36)}.${"c".repeat(36)}`;

function requestWithAuthorization(value, explicitRawHeaders) {
  return {
    headers: value === undefined ? {} : { authorization: value },
    rawHeaders: explicitRawHeaders === undefined
      ? (value === undefined ? [] : ["Authorization", value])
      : explicitRawHeaders,
  };
}

test("Supabase resolver requires a server-side access token verifier", () => {
  assert.throws(() => createSupabaseSessionResolver(), /token 验证器/);
  assert.throws(() => createSupabaseSessionResolver({ verifyAccessToken: true }), /token 验证器/);
});

test("unique Bearer token becomes an exact account bearer session after trusted verification", async () => {
  const seen = [];
  const resolver = createSupabaseSessionResolver({
    verifyAccessToken: async (token) => {
      seen.push(token);
      return { subject_id: "8f3b65e1-0e6e-42b4-81c0-61e5cf9a1020" };
    },
  });
  const session = await resolver(requestWithAuthorization(`Bearer ${TOKEN}`));
  assert.deepEqual(session, {
    principal: { kind: "account", subject_id: "8f3b65e1-0e6e-42b4-81c0-61e5cf9a1020" },
    auth_mode: "bearer",
  });
  assert.deepEqual(seen, [TOKEN]);
  assert.equal(JSON.stringify(session).includes(TOKEN), false);
  assert.equal(Object.isFrozen(session), true);
  assert.equal(Object.isFrozen(session.principal), true);
});

test("missing, malformed, merged, and duplicate authorization headers fail before verification", async () => {
  let calls = 0;
  const resolver = createSupabaseSessionResolver({
    verifyAccessToken: async () => { calls += 1; return { subject_id: "account-0001" }; },
  });
  const requests = [
    requestWithAuthorization(undefined),
    requestWithAuthorization(`Basic ${TOKEN}`),
    requestWithAuthorization("Bearer short"),
    requestWithAuthorization(`Bearer ${TOKEN} extra`),
    requestWithAuthorization(`Bearer ${TOKEN},Bearer ${TOKEN}`),
    requestWithAuthorization(`Bearer ${TOKEN}`, ["Authorization", `Bearer ${TOKEN}`, "authorization", `Bearer ${TOKEN}`]),
    requestWithAuthorization(`Bearer ${TOKEN}`, ["Authorization"]),
  ];
  for (const request of requests) assert.equal(await resolver(request), null);
  assert.equal(calls, 0);
});

test("authorization scheme is case-insensitive but surrounding whitespace is rejected", () => {
  assert.equal(extractUniqueBearerToken(requestWithAuthorization(`bearer ${TOKEN}`)), TOKEN);
  assert.equal(extractUniqueBearerToken(requestWithAuthorization(` Bearer ${TOKEN}`)), null);
  assert.equal(extractUniqueBearerToken(requestWithAuthorization(`Bearer ${TOKEN} `)), null);
});

test("an invalid or expired access token maps to no session", async () => {
  const resolver = createSupabaseSessionResolver({ verifyAccessToken: async () => null });
  assert.equal(await resolver(requestWithAuthorization(`Bearer ${TOKEN}`)), null);
});

test("trusted verifier output is exact and cannot smuggle token or role fields", async () => {
  for (const identity of [
    {},
    { subject_id: "short" },
    { subject_id: "account-0001", role: "admin" },
    { subject_id: "account-0001", access_token: TOKEN },
  ]) {
    const resolver = createSupabaseSessionResolver({ verifyAccessToken: async () => identity });
    await assert.rejects(resolver(requestWithAuthorization(`Bearer ${TOKEN}`)), /exact 已验证身份/);
  }
});

test("verifier infrastructure failures propagate instead of becoming false authentication results", async () => {
  const resolver = createSupabaseSessionResolver({
    verifyAccessToken: async () => { throw new Error("upstream unavailable with secret detail"); },
  });
  await assert.rejects(resolver(requestWithAuthorization(`Bearer ${TOKEN}`)), /upstream unavailable/);
});
