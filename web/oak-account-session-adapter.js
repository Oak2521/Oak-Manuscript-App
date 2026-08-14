// Converts one verified Oak Account bearer into the existing account principal shape.

"use strict";

const { extractUniqueBearerToken } = require("./supabase-session-adapter");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function exactIdentity(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 1 && Object.hasOwn(value, "oak_account_id") &&
    UUID.test(value.oak_account_id || "");
}

function createOakAccountSessionResolver({ verifyAccessToken } = {}) {
  if (typeof verifyAccessToken !== "function") {
    throw new TypeError("Oak Account session adapter requires an access-token verifier");
  }
  return async function resolveOakAccountSession(request) {
    const accessToken = extractUniqueBearerToken(request);
    if (!accessToken) return null;
    const identity = await verifyAccessToken(accessToken);
    if (identity === null) return null;
    if (!exactIdentity(identity)) throw new TypeError("verifyAccessToken must return exact Oak identity");
    return Object.freeze({
      principal: Object.freeze({ kind: "account", subject_id: identity.oak_account_id }),
      auth_mode: "bearer",
    });
  };
}

module.exports = { createOakAccountSessionResolver };
