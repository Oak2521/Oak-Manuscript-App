"use strict";
const crypto = require("node:crypto");
const CLAIM_KEYS = ["iss", "sub", "aud", "sid", "iat", "exp", "aal", "oak_account_id", "oak_account_status", "oak_profile_version", "oak_claims_version"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function exact(value, keys) { return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function decode(segment) { if (!/^[A-Za-z0-9_-]+$/u.test(segment)) throw new Error("access token 编码非法"); const bytes = Buffer.from(segment, "base64url"); if (bytes.toString("base64url") !== segment) throw new Error("access token 编码非规范"); return JSON.parse(bytes.toString("utf8")); }
function verifyDesktopAccessToken(token, responseClaims, { config, clock = () => new Date() } = {}) {
  if (typeof token !== "string" || token.length < 64 || token.length > 8192) throw new Error("access token 非法");
  const parts = token.split("."); if (parts.length !== 3) throw new Error("access token 非法");
  const header = decode(parts[0]); const claims = decode(parts[1]);
  if (!exact(header, ["alg", "kid", "typ"]) || header.alg !== "EdDSA" || header.typ !== "JWT") throw new Error("access token header 非法");
  if (!exact(claims, CLAIM_KEYS) || !same(claims, responseClaims) || claims.iss !== config.issuer || claims.aud !== config.application_id ||
      !UUID.test(claims.sub || "") || !UUID.test(claims.sid || "") || !UUID.test(claims.oak_account_id || "") || claims.oak_account_status !== "active" ||
      !["aal1", "aal2"].includes(claims.aal) || claims.oak_claims_version !== "1.0" || !Number.isSafeInteger(claims.oak_profile_version) || claims.oak_profile_version < 1 ||
      !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.exp <= claims.iat || claims.exp - claims.iat > 300) throw new Error("access token claims 非法");
  const now = Math.floor(clock().getTime() / 1000); if (claims.iat > now + 30 || claims.exp <= now) throw new Error("access token 时间非法");
  const trusted = config.trusted_keys.find((item) => item.key_id === header.kid); if (!trusted) throw new Error("access token 签名密钥未知");
  let key; try { key = crypto.createPublicKey({ key: trusted.public_key_jwk, format: "jwk" }); } catch { throw new Error("access token 公钥非法"); }
  const signature = Buffer.from(parts[2], "base64url"); if (signature.length !== 64 || signature.toString("base64url") !== parts[2] || !crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, "ascii"), key, signature)) throw new Error("access token 签名无效");
  return Object.freeze({ ...claims });
}
module.exports = { CLAIM_KEYS, UUID, verifyDesktopAccessToken };
