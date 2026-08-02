// Trusted account -> atomic device authorization -> signed desktop entitlement.

"use strict";

const {
  ACCOUNT_PATTERN,
  DEVICE_PATTERN,
  ENTITLEMENT_PATTERN,
} = require("./entitlement-signer");

const REQUEST_KEYS = Object.freeze(["schema_version", "request_type", "device_id"]);
const RESULT_KEYS = Object.freeze(["schema_version", "result_type", "outcome", "authorization"]);
const AUTHORIZATION_KEYS = Object.freeze([
  "account_id", "entitlement_id", "device_id", "device_state",
  "issued_at", "not_before", "valid_until", "grace_until",
]);
const OUTCOMES = Object.freeze(["authorized", "no_entitlement", "device_limit"]);
const ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "需要有效的湖岸账号才能取得订阅权益",
  DEVICE_LIMIT: "当前订阅的设备数量已达上限",
  INVALID_REQUEST: "订阅权益请求不符合 v1 契约",
  SERVICE_UNAVAILABLE: "订阅权益服务暂时不可用",
  SUBSCRIPTION_REQUIRED: "当前账号没有可签发的 Pro 订阅权益",
});

class EntitlementServiceError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.SERVICE_UNAVAILABLE);
    this.name = "EntitlementServiceError";
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : "SERVICE_UNAVAILABLE";
  }
}

function fail(code) { throw new EntitlementServiceError(code); }

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function canonicalTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validateEntitlementRequest(value) {
  if (!exactKeys(value, REQUEST_KEYS) || value.schema_version !== "1.0" ||
      value.request_type !== "oak_manuscript_entitlement_request" || !DEVICE_PATTERN.test(value.device_id || "")) {
    fail("INVALID_REQUEST");
  }
  return Object.freeze({ ...value });
}

function validateDeviceAuthorizationResult(value, expectedAccount, expectedDevice) {
  if (!exactKeys(value, RESULT_KEYS) || value.schema_version !== "1.0" ||
      value.result_type !== "oak_manuscript_device_authorization" || !OUTCOMES.includes(value.outcome)) {
    throw new TypeError("设备授权数据库响应非法");
  }
  if (value.outcome !== "authorized") {
    if (value.authorization !== null) throw new TypeError("设备授权数据库响应非法");
    return Object.freeze({ ...value });
  }
  const item = value.authorization;
  if (!exactKeys(item, AUTHORIZATION_KEYS) || item.account_id !== expectedAccount ||
      item.device_id !== expectedDevice || !ACCOUNT_PATTERN.test(item.account_id || "") ||
      !DEVICE_PATTERN.test(item.device_id || "") || !ENTITLEMENT_PATTERN.test(item.entitlement_id || "") ||
      !["active", "revoked"].includes(item.device_state) ||
      ![item.issued_at, item.not_before, item.valid_until, item.grace_until].every(canonicalTime) ||
      Date.parse(item.issued_at) > Date.parse(item.not_before) ||
      Date.parse(item.not_before) > Date.parse(item.valid_until) ||
      Date.parse(item.valid_until) > Date.parse(item.grace_until)) {
    throw new TypeError("设备授权数据库归属或字段非法");
  }
  return Object.freeze({ ...value, authorization: Object.freeze({ ...item }) });
}

class EntitlementService {
  constructor({ repository, signer, clock = () => new Date(), maxDevicesPerAccount = 3 } = {}) {
    if (!repository || typeof repository.authorizeDevice !== "function" ||
        !signer || typeof signer.sign !== "function" || typeof clock !== "function") {
      throw new TypeError("权益服务依赖不完整");
    }
    if (!Number.isSafeInteger(maxDevicesPerAccount) || maxDevicesPerAccount < 1 || maxDevicesPerAccount > 20) {
      throw new TypeError("maxDevicesPerAccount 非法");
    }
    this.repository = repository;
    this.signer = signer;
    this.clock = clock;
    this.maxDevicesPerAccount = maxDevicesPerAccount;
  }

  async issue(principal, request) {
    if (!exactKeys(principal, ["kind", "subject_id"]) || principal.kind !== "account" ||
        !ACCOUNT_PATTERN.test(principal.subject_id || "")) fail("AUTH_REQUIRED");
    const input = validateEntitlementRequest(request);
    let now;
    try {
      const current = this.clock();
      now = (current instanceof Date ? current : new Date(current)).toISOString();
    } catch { fail("SERVICE_UNAVAILABLE"); }
    let result;
    try {
      result = validateDeviceAuthorizationResult(
        await this.repository.authorizeDevice(principal.subject_id, input.device_id, now, this.maxDevicesPerAccount),
        principal.subject_id,
        input.device_id,
      );
    } catch (error) {
      if (error instanceof EntitlementServiceError) throw error;
      fail("SERVICE_UNAVAILABLE");
    }
    if (result.outcome === "no_entitlement") fail("SUBSCRIPTION_REQUIRED");
    if (result.outcome === "device_limit") fail("DEVICE_LIMIT");
    try { return this.signer.sign(result.authorization); }
    catch { fail("SERVICE_UNAVAILABLE"); }
  }
}

module.exports = {
  AUTHORIZATION_KEYS,
  ERROR_MESSAGES,
  EntitlementService,
  EntitlementServiceError,
  OUTCOMES,
  REQUEST_KEYS,
  validateDeviceAuthorizationResult,
  validateEntitlementRequest,
};
