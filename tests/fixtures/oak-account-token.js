"use strict";

const crypto = require("node:crypto");

const SUBJECT = "61000000-0000-4000-8000-000000000001";
const SESSION = "62000000-0000-4000-8000-000000000002";

function createOakAccountTokenFixture({ oakAccountId, now }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const exported = publicKey.export({ format: "jwk" });
  const issuer = "https://identity.example.invalid/application-login";
  const audience = "oak-manuscript-desktop";
  const issued = Math.floor(now.getTime() / 1000);
  const claims = {
    iss: issuer, sub: SUBJECT, aud: audience, sid: SESSION, iat: issued, exp: issued + 300,
    aal: "aal1", oak_account_id: oakAccountId, oak_account_status: "active",
    oak_profile_version: 1, oak_claims_version: "1.0",
  };
  const first = Buffer.from(JSON.stringify({ alg: "ES256", kid: "runtime-test-1", typ: "JWT" })).toString("base64url");
  const second = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign("sha256", Buffer.from(`${first}.${second}`, "ascii"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return Object.freeze({
    issuer,
    audience,
    trustedKeys: Object.freeze([Object.freeze({
      key_id: "runtime-test-1", algorithm: "ES256",
      public_key_jwk: Object.freeze({
        alg: "ES256", crv: "P-256", ext: true, key_ops: Object.freeze(["verify"]),
        kid: "runtime-test-1", kty: "EC", use: "sig", x: exported.x, y: exported.y,
      }),
    })]),
    token: `${first}.${second}.${signature}`,
  });
}

module.exports = { createOakAccountTokenFixture };
