// Server-only Ed25519 signer for Oak Manuscript desktop entitlement envelopes.
// Private keys are injected by the deployment environment and never read from
// browser input, the repository, or tracked configuration.

"use strict";

const crypto = require("node:crypto");

const AUDIENCE = "oak-manuscript-desktop";
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DEVICE_PATTERN = /^device-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ENTITLEMENT_PATTERN = /^ent-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CLAIM_KEYS = Object.freeze([
  "issuer", "audience", "entitlement_id", "account_id", "device_id", "tier",
  "device_state", "issued_at", "not_before", "valid_until", "grace_until",
]);

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalUnsignedEnvelope(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalHttpsOrigin(value) {
  if (typeof value !== "string") throw new TypeError("权益 issuer 必须是规范 HTTPS origin");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin + "/" !== value || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new TypeError("权益 issuer 必须是规范 HTTPS origin");
  }
  return value;
}

function canonicalTime(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label}必须是规范 UTC 时间`);
  }
  return value;
}

function validateClaims(value, { issuer, audience }) {
  if (!exactKeys(value, CLAIM_KEYS) || value.issuer !== issuer || value.audience !== audience ||
      !ENTITLEMENT_PATTERN.test(value.entitlement_id || "") || !ACCOUNT_PATTERN.test(value.account_id || "") ||
      !DEVICE_PATTERN.test(value.device_id || "") || value.tier !== "pro" ||
      !["active", "revoked"].includes(value.device_state)) {
    throw new TypeError("权益 claims 非法");
  }
  const issued = Date.parse(canonicalTime(value.issued_at, "issued_at"));
  const notBefore = Date.parse(canonicalTime(value.not_before, "not_before"));
  const valid = Date.parse(canonicalTime(value.valid_until, "valid_until"));
  const grace = Date.parse(canonicalTime(value.grace_until, "grace_until"));
  if (issued > notBefore || notBefore > valid || valid > grace) throw new TypeError("权益时间顺序非法");
  return structuredClone(value);
}

function privateEd25519Key(value) {
  let key;
  try { key = value instanceof crypto.KeyObject ? value : crypto.createPrivateKey(value); }
  catch { throw new TypeError("权益签名 private key 非法"); }
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") {
    throw new TypeError("权益签名 private key 必须是 Ed25519 私钥");
  }
  return key;
}

function createEd25519EntitlementSigner({ issuer, audience, keyId, privateKey } = {}) {
  const trustedIssuer = canonicalHttpsOrigin(issuer);
  if (audience !== AUDIENCE) throw new TypeError("权益 audience 非法");
  if (typeof keyId !== "string" || !KEY_ID_PATTERN.test(keyId)) throw new TypeError("权益 keyId 非法");
  const key = privateEd25519Key(privateKey);
  return Object.freeze({
    issuer: trustedIssuer,
    audience,
    keyId,
    sign(input) {
      const claims = validateClaims({ issuer: trustedIssuer, audience, tier: "pro", ...input }, {
        issuer: trustedIssuer, audience,
      });
      const unsigned = {
        schema_version: "1.0",
        record_type: "oak_manuscript_signed_entitlement",
        key_id: keyId,
        algorithm: "Ed25519",
        claims,
      };
      const signature = crypto.sign(null, Buffer.from(canonicalUnsignedEnvelope(unsigned), "utf8"), key).toString("base64url");
      if (signature.length !== 86) throw new Error("权益签名输出非法");
      return Object.freeze({ ...unsigned, claims: Object.freeze(claims), signature });
    },
  });
}

module.exports = {
  ACCOUNT_PATTERN,
  AUDIENCE,
  CLAIM_KEYS,
  DEVICE_PATTERN,
  ENTITLEMENT_PATTERN,
  canonicalUnsignedEnvelope,
  createEd25519EntitlementSigner,
};
