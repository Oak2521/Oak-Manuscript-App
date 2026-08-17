// Fixed Oak Account application-login JWT verification for server-side consumers.

"use strict";

const crypto = require("node:crypto");

const CLAIM_KEYS = Object.freeze([
  "iss", "sub", "aud", "sid", "iat", "exp", "aal", "oak_account_id",
  "oak_account_status", "oak_profile_version", "oak_claims_version",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function decode(segment) {
  if (!/^[A-Za-z0-9_-]+$/u.test(segment)) throw new Error("invalid token encoding");
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.toString("base64url") !== segment) throw new Error("noncanonical token encoding");
  const value = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid token JSON");
  return value;
}

function trustedKey(value) {
  return exact(value, ["key_id", "algorithm", "public_key_jwk"]) &&
    typeof value.key_id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value.key_id) &&
    value.algorithm === "ES256" &&
    exact(value.public_key_jwk, ["alg", "crv", "ext", "key_ops", "kid", "kty", "use", "x", "y"]) &&
    value.public_key_jwk.alg === "ES256" && value.public_key_jwk.crv === "P-256" &&
    value.public_key_jwk.ext === true && Array.isArray(value.public_key_jwk.key_ops) &&
    value.public_key_jwk.key_ops.length === 1 && value.public_key_jwk.key_ops[0] === "verify" &&
    value.public_key_jwk.kid === value.key_id && value.public_key_jwk.kty === "EC" &&
    value.public_key_jwk.use === "sig" &&
    typeof value.public_key_jwk.x === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value.public_key_jwk.x) &&
    typeof value.public_key_jwk.y === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value.public_key_jwk.y);
}

function createOakAccountAccessTokenVerifier({ issuer, audience, trustedKeys, clock = () => new Date() } = {}) {
  if (typeof issuer !== "string" || !issuer.startsWith("https://") ||
      audience !== "oak-manuscript-desktop" || !Array.isArray(trustedKeys) ||
      trustedKeys.length < 1 || trustedKeys.length > 8 || !trustedKeys.every(trustedKey) ||
      new Set(trustedKeys.map((item) => item.key_id)).size !== trustedKeys.length ||
      typeof clock !== "function") {
    throw new TypeError("Oak Account access-token verifier configuration is invalid");
  }
  let keys;
  try {
    keys = new Map(trustedKeys.map((item) => {
      const { kty, crv, x, y } = item.public_key_jwk;
      return [item.key_id, crypto.createPublicKey({ key: { kty, crv, x, y }, format: "jwk" })];
    }));
  } catch {
    throw new TypeError("Oak Account access-token verifier configuration is invalid");
  }

  return async function verifyAccessToken(token) {
    try {
      if (typeof token !== "string" || token.length < 64 || token.length > 8192) return null;
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const header = decode(parts[0]);
      const claims = decode(parts[1]);
      if (!exact(header, ["alg", "kid", "typ"]) || header.alg !== "ES256" || header.typ !== "JWT" ||
          !exact(claims, CLAIM_KEYS) || claims.iss !== issuer || claims.aud !== audience ||
          !UUID.test(claims.sub || "") || !UUID.test(claims.sid || "") ||
          !UUID.test(claims.oak_account_id || "") || claims.oak_account_status !== "active" ||
          !["aal1", "aal2"].includes(claims.aal) || claims.oak_claims_version !== "1.0" ||
          !Number.isSafeInteger(claims.oak_profile_version) || claims.oak_profile_version < 1 ||
          !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
          claims.exp <= claims.iat || claims.exp - claims.iat > 300) return null;
      const now = Math.floor(clock().getTime() / 1000);
      if (claims.iat > now + 30 || claims.exp <= now) return null;
      const publicKey = keys.get(header.kid);
      if (!publicKey) return null;
      const signature = Buffer.from(parts[2], "base64url");
      if (signature.length !== 64 || signature.toString("base64url") !== parts[2] ||
          !crypto.verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`, "ascii"), {
            key: publicKey,
            dsaEncoding: "ieee-p1363",
          }, signature)) return null;
      return Object.freeze({ oak_account_id: claims.oak_account_id });
    } catch {
      return null;
    }
  };
}

module.exports = { CLAIM_KEYS, UUID, createOakAccountAccessTokenVerifier };
