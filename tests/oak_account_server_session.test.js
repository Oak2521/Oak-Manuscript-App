"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { createOakAccountAccessTokenVerifier } = require("../web/oak-account-token-verifier");
const { createOakAccountSessionResolver } = require("../web/oak-account-session-adapter");

const OAK_ACCOUNT_ID = "63000000-0000-4000-8000-000000000003";
const SUBJECT_ID = "61000000-0000-4000-8000-000000000001";
const SESSION_ID = "62000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-08-14T12:00:00.000Z");

function signedToken(privateKey, claims, header = { alg: "EdDSA", kid: "server-test-1", typ: "JWT" }) {
  const first = Buffer.from(JSON.stringify(header)).toString("base64url");
  const second = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign(null, Buffer.from(`${first}.${second}`, "ascii"), privateKey).toString("base64url");
  return `${first}.${second}.${signature}`;
}

function claims(overrides = {}) {
  return {
    iss: "https://identity.example.invalid/application-login",
    sub: SUBJECT_ID,
    aud: "oak-manuscript-desktop",
    sid: SESSION_ID,
    iat: 1786708800,
    exp: 1786709100,
    aal: "aal1",
    oak_account_id: OAK_ACCOUNT_ID,
    oak_account_status: "active",
    oak_profile_version: 3,
    oak_claims_version: "1.0",
    ...overrides,
  };
}

function fixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const verifyAccessToken = createOakAccountAccessTokenVerifier({
    issuer: "https://identity.example.invalid/application-login",
    audience: "oak-manuscript-desktop",
    trustedKeys: [{ key_id: "server-test-1", algorithm: "Ed25519", public_key_jwk: publicKey.export({ format: "jwk" }) }],
    clock: () => NOW,
  });
  return { privateKey, verifyAccessToken };
}

test("server verifies exact Oak claims and returns only oak_account_id", async () => {
  const { privateKey, verifyAccessToken } = fixture();
  const identity = await verifyAccessToken(signedToken(privateKey, claims()));
  assert.deepEqual(identity, { oak_account_id: OAK_ACCOUNT_ID });
  for (const poisoned of [
    claims({ oak_account_status: "suspended" }),
    claims({ oak_claims_version: "2.0" }),
    claims({ aud: "wrong-audience" }),
    { ...claims(), roles: ["pro"] },
  ]) {
    assert.equal(await verifyAccessToken(signedToken(privateKey, poisoned)), null);
  }
});

test("session ownership uses oak_account_id rather than JWT sub or session id", async () => {
  const { privateKey, verifyAccessToken } = fixture();
  const resolve = createOakAccountSessionResolver({ verifyAccessToken });
  const token = signedToken(privateKey, claims());
  const session = await resolve({ rawHeaders: ["Authorization", `Bearer ${token}`], headers: {} });
  assert.deepEqual(session, {
    principal: { kind: "account", subject_id: OAK_ACCOUNT_ID },
    auth_mode: "bearer",
  });
  assert.notEqual(session.principal.subject_id, SUBJECT_ID);
  assert.notEqual(session.principal.subject_id, SESSION_ID);
});

test("session adapter rejects ambiguous bearer headers and identity shape drift", async () => {
  const resolve = createOakAccountSessionResolver({ verifyAccessToken: async () => ({ oak_account_id: OAK_ACCOUNT_ID, email: "private@example.invalid" }) });
  await assert.rejects(() => resolve({ rawHeaders: ["Authorization", `Bearer ${"a".repeat(64)}`], headers: {} }), /exact Oak identity/);
  const safe = createOakAccountSessionResolver({ verifyAccessToken: async () => ({ oak_account_id: OAK_ACCOUNT_ID }) });
  assert.equal(await safe({ rawHeaders: ["Authorization", `Bearer ${"a".repeat(64)}`, "Authorization", `Bearer ${"b".repeat(64)}`], headers: {} }), null);
});
