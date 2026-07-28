"use strict";

const SUBJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const TOKEN68_PATTERN = /^[A-Za-z0-9._~+\/-]+={0,2}$/;

function exactObjectKeys(input, expected) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const actual = Object.keys(input).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function rawHeaderValues(request, name) {
  const target = name.toLowerCase();
  if (Array.isArray(request?.rawHeaders)) {
    if (request.rawHeaders.length % 2 !== 0) return null;
    const values = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (String(request.rawHeaders[index]).toLowerCase() === target) {
        values.push(String(request.rawHeaders[index + 1]));
      }
    }
    return values;
  }
  const value = request?.headers?.[target];
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function extractUniqueBearerToken(request) {
  const values = rawHeaderValues(request, "authorization");
  if (!values || values.length !== 1) return null;
  const match = values[0].match(/^Bearer ([^\s,]+)$/i);
  if (!match || match[1].length < 32 || match[1].length > 8192 ||
      !TOKEN68_PATTERN.test(match[1])) {
    return null;
  }
  return match[1];
}

function validateVerifiedIdentity(identity) {
  if (!exactObjectKeys(identity, ["subject_id"]) ||
      typeof identity.subject_id !== "string" || !SUBJECT_ID_PATTERN.test(identity.subject_id)) {
    throw new TypeError("verifyAccessToken 必须返回 exact 已验证身份");
  }
  return identity;
}

function createSupabaseSessionResolver({ verifyAccessToken } = {}) {
  if (typeof verifyAccessToken !== "function") {
    throw new TypeError("Supabase 会话适配器需要服务端 access token 验证器");
  }

  return async function resolveSupabaseSession(request) {
    const accessToken = extractUniqueBearerToken(request);
    if (!accessToken) return null;

    const rawIdentity = await verifyAccessToken(accessToken);
    if (rawIdentity === null) return null;
    const identity = validateVerifiedIdentity(rawIdentity);

    return Object.freeze({
      principal: Object.freeze({ kind: "account", subject_id: identity.subject_id }),
      auth_mode: "bearer",
    });
  };
}

module.exports = {
  createSupabaseSessionResolver,
  extractUniqueBearerToken,
};
