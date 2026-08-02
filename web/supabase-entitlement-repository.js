// Server-only adapter for the atomic subscription/device authorization RPC.

"use strict";

const { ACCOUNT_PATTERN, DEVICE_PATTERN } = require("./entitlement-signer");
const { validateDeviceAuthorizationResult } = require("./entitlement-service");
const {
  EVENT_ID_PATTERN,
  PROVIDER_PATTERN,
  canonicalSubscriptionEvent,
  validateApplyResult,
  validateSubscriptionEvent,
} = require("./subscription-event-service");
const {
  validateDeviceRow,
  validateLicenseAccountSnapshot,
} = require("./license-account-service");

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const RPC_NAME = "oak_manuscript_license_authorize_device";
const RPC_NAMES = Object.freeze({
  authorize: RPC_NAME,
  applyEvent: "oak_manuscript_license_apply_subscription_event",
  overview: "oak_manuscript_license_account_overview",
  revoke: "oak_manuscript_license_revoke_device",
});
const RPC_PATH = `/rest/v1/rpc/${RPC_NAME}`;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ERROR_MESSAGES = Object.freeze({
  LICENSE_DB_INVALID_RESPONSE: "权益数据库响应非法",
  LICENSE_DB_TIMEOUT: "权益数据库请求超时",
  LICENSE_DB_UNAUTHORIZED: "权益数据库服务端凭据无效",
  LICENSE_DB_UNAVAILABLE: "权益数据库暂时不可用",
});

class SupabaseEntitlementRepositoryError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.LICENSE_DB_UNAVAILABLE);
    this.name = "SupabaseEntitlementRepositoryError";
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : "LICENSE_DB_UNAVAILABLE";
  }
}

function fail(code) { throw new SupabaseEntitlementRepositoryError(code); }

function canonicalHttpsOrigin(value) {
  if (typeof value !== "string") throw new TypeError("supabaseOrigin 必须是 HTTPS origin");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new TypeError("supabaseOrigin 必须是规范 HTTPS origin");
  }
  return value;
}

function validSecret(value) {
  return typeof value === "string" && value.length >= 20 && value.length <= 8192 &&
    !/[\u0000-\u0020\u007f,]/u.test(value);
}

function canonicalTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

async function readBoundedJson(response) {
  if (!response || typeof response.status !== "number" || !response.headers ||
      typeof response.arrayBuffer !== "function" ||
      !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") || "")) {
    fail("LICENSE_DB_INVALID_RESPONSE");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^(?:0|[1-9][0-9]{0,15})$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    fail("LICENSE_DB_INVALID_RESPONSE");
  }
  let bytes;
  try { bytes = Buffer.from(await response.arrayBuffer()); }
  catch { fail("LICENSE_DB_INVALID_RESPONSE"); }
  if (bytes.length < 2 || bytes.length > MAX_RESPONSE_BYTES ||
      (declared !== null && bytes.length !== Number(declared))) fail("LICENSE_DB_INVALID_RESPONSE");
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { fail("LICENSE_DB_INVALID_RESPONSE"); }
}

class SupabaseEntitlementRepository {
  constructor({ supabaseOrigin, serviceRoleKey, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.origin = canonicalHttpsOrigin(supabaseOrigin);
    if (!validSecret(serviceRoleKey)) throw new TypeError("serviceRoleKey 不是安全的服务端 Supabase service-role key");
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl 必须是函数");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new TypeError("timeoutMs 非法");
    this.serviceRoleKey = serviceRoleKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async _rpc(name, body) {
    if (!Object.values(RPC_NAMES).includes(name)) throw new TypeError("权益 RPC 不在固定白名单");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.origin}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          apikey: this.serviceRoleKey,
          authorization: `Bearer ${this.serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") fail("LICENSE_DB_TIMEOUT");
      fail("LICENSE_DB_UNAVAILABLE");
    } finally { clearTimeout(timer); }
    if (!response || typeof response.status !== "number") fail("LICENSE_DB_INVALID_RESPONSE");
    if (response.status === 401 || response.status === 403) fail("LICENSE_DB_UNAUTHORIZED");
    if (response.status === 408 || response.status === 429 || response.status >= 500) fail("LICENSE_DB_UNAVAILABLE");
    if (response.status !== 200) fail("LICENSE_DB_INVALID_RESPONSE");
    return readBoundedJson(response);
  }

  async authorizeDevice(accountId, deviceId, now, maxDevices) {
    if (!ACCOUNT_PATTERN.test(accountId || "")) throw new TypeError("accountId 非法");
    if (!DEVICE_PATTERN.test(deviceId || "")) throw new TypeError("deviceId 非法");
    if (!canonicalTime(now)) throw new TypeError("now 非法");
    if (!Number.isSafeInteger(maxDevices) || maxDevices < 1 || maxDevices > 20) throw new TypeError("maxDevices 非法");
    let value;
    try {
      value = validateDeviceAuthorizationResult(await this._rpc(RPC_NAMES.authorize, {
        p_account_id: accountId,
        p_device_id: deviceId,
        p_now: now,
        p_max_devices: maxDevices,
      }), accountId, deviceId);
    } catch (error) {
      if (error instanceof SupabaseEntitlementRepositoryError) throw error;
      fail("LICENSE_DB_INVALID_RESPONSE");
    }
    return structuredClone(value);
  }

  async applySubscriptionEvent(providerId, event, canonicalEvent, eventFingerprint) {
    if (!PROVIDER_PATTERN.test(providerId || "")) throw new TypeError("providerId 非法");
    validateSubscriptionEvent(event);
    if (!EVENT_ID_PATTERN.test(event.provider_event_id || "") || canonicalSubscriptionEvent(event) !== canonicalEvent ||
        typeof canonicalEvent !== "string" || Buffer.byteLength(canonicalEvent, "utf8") > 4096 ||
        !SHA256_PATTERN.test(eventFingerprint || "")) throw new TypeError("订阅事件 canonical/fingerprint 非法");
    let value;
    try {
      value = validateApplyResult(await this._rpc(RPC_NAMES.applyEvent, {
        p_provider_id: providerId,
        p_event: event,
        p_canonical_event: canonicalEvent,
        p_event_fingerprint: eventFingerprint,
      }), {
        accountId: event.account_id,
        providerId,
        eventId: event.provider_event_id,
        fingerprint: eventFingerprint,
      });
    } catch (error) {
      if (error instanceof SupabaseEntitlementRepositoryError) throw error;
      fail("LICENSE_DB_INVALID_RESPONSE");
    }
    return structuredClone(value);
  }

  async getLicenseAccount(accountId, limit) {
    if (!ACCOUNT_PATTERN.test(accountId || "")) throw new TypeError("accountId 非法");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new TypeError("limit 非法");
    try {
      return structuredClone(validateLicenseAccountSnapshot(
        await this._rpc(RPC_NAMES.overview, { p_account_id: accountId, p_limit: limit }), accountId, limit,
      ));
    } catch (error) {
      if (error instanceof SupabaseEntitlementRepositoryError) throw error;
      fail("LICENSE_DB_INVALID_RESPONSE");
    }
  }

  async revokeDevice(accountId, deviceId, now) {
    if (!ACCOUNT_PATTERN.test(accountId || "")) throw new TypeError("accountId 非法");
    if (!DEVICE_PATTERN.test(deviceId || "")) throw new TypeError("deviceId 非法");
    if (!canonicalTime(now)) throw new TypeError("now 非法");
    try {
      const value = await this._rpc(RPC_NAMES.revoke, {
        p_account_id: accountId, p_device_id: deviceId, p_now: now,
      });
      return value === null ? null : structuredClone(validateDeviceRow(value, accountId, deviceId));
    } catch (error) {
      if (error instanceof SupabaseEntitlementRepositoryError) throw error;
      fail("LICENSE_DB_INVALID_RESPONSE");
    }
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  RPC_NAME,
  RPC_NAMES,
  RPC_PATH,
  SupabaseEntitlementRepository,
  SupabaseEntitlementRepositoryError,
};
