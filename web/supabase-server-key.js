// Supabase server credentials support both the legacy service_role JWT and
// the current sb_secret key. Current secret keys must not be sent as Bearer
// tokens because they are opaque API keys, not JWTs.

"use strict";

function validateSupabaseServerKey(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 8192 ||
      /[\u0000-\u0020\u007f,]/u.test(value)) {
    throw new TypeError("Supabase 服务端密钥不是安全的请求头值");
  }
  return value;
}

function createSupabaseServerCredentialHeaders(value) {
  const key = validateSupabaseServerKey(value);
  if (key.startsWith("sb_secret_")) {
    return Object.freeze({ apikey: key });
  }
  return Object.freeze({
    apikey: key,
    authorization: `Bearer ${key}`,
  });
}

module.exports = {
  createSupabaseServerCredentialHeaders,
  validateSupabaseServerKey,
};
