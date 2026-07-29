// Authenticated account view of subscription state and registered devices.

"use strict";

const { ACCOUNT_PATTERN, DEVICE_PATTERN, ENTITLEMENT_PATTERN } = require("./entitlement-signer");

const DEFAULT_MAX_LIST_ITEMS = 20;
const SNAPSHOT_KEYS = Object.freeze([
  "schema_version", "result_type", "account_id", "entitlement", "devices", "total_devices",
]);
const ENTITLEMENT_KEYS = Object.freeze([
  "account_id", "entitlement_id", "entitlement_state", "not_before", "valid_until", "grace_until", "revision",
]);
const DEVICE_KEYS = Object.freeze([
  "account_id", "device_id", "device_state", "first_seen_at", "last_seen_at", "revoked_at",
]);
const ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "需要有效的湖岸账号",
  DEVICE_NOT_FOUND: "设备不存在或无权访问",
  INVALID_DEVICE: "设备标识非法",
  SERVICE_UNAVAILABLE: "账号订阅服务暂时不可用",
});

class LicenseAccountServiceError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.SERVICE_UNAVAILABLE);
    this.name = "LicenseAccountServiceError";
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : "SERVICE_UNAVAILABLE";
  }
}

function fail(code) { throw new LicenseAccountServiceError(code); }

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function canonicalTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function accountPrincipal(value) {
  if (!exactKeys(value, ["kind", "subject_id"]) || value.kind !== "account" ||
      !ACCOUNT_PATTERN.test(value.subject_id || "")) fail("AUTH_REQUIRED");
  return value.subject_id;
}

function validateDeviceRow(value, expectedAccount, expectedDevice = null) {
  if (!exactKeys(value, DEVICE_KEYS) || value.account_id !== expectedAccount ||
      !ACCOUNT_PATTERN.test(value.account_id || "") || !DEVICE_PATTERN.test(value.device_id || "") ||
      (expectedDevice !== null && value.device_id !== expectedDevice) ||
      !["active", "revoked"].includes(value.device_state) ||
      !canonicalTime(value.first_seen_at) || !canonicalTime(value.last_seen_at) ||
      Date.parse(value.first_seen_at) > Date.parse(value.last_seen_at) ||
      (value.device_state === "active" ? value.revoked_at !== null :
        (!canonicalTime(value.revoked_at) || Date.parse(value.revoked_at) < Date.parse(value.first_seen_at)))) {
    throw new TypeError("设备 repository row 归属或字段非法");
  }
  return Object.freeze({ ...value });
}

function validateEntitlementRow(value, expectedAccount) {
  if (!exactKeys(value, ENTITLEMENT_KEYS) || value.account_id !== expectedAccount ||
      !ENTITLEMENT_PATTERN.test(value.entitlement_id || "") ||
      !["active", "revoked"].includes(value.entitlement_state) ||
      ![value.not_before, value.valid_until, value.grace_until].every(canonicalTime) ||
      Date.parse(value.not_before) > Date.parse(value.valid_until) ||
      Date.parse(value.valid_until) > Date.parse(value.grace_until) ||
      !Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new TypeError("权益 repository row 归属或字段非法");
  }
  return Object.freeze({ ...value });
}

function validateLicenseAccountSnapshot(value, expectedAccount, limit) {
  if (!exactKeys(value, SNAPSHOT_KEYS) || value.schema_version !== "1.0" ||
      value.result_type !== "oak_manuscript_license_account_snapshot" || value.account_id !== expectedAccount ||
      !Array.isArray(value.devices) || value.devices.length > limit ||
      !Number.isSafeInteger(value.total_devices) || value.total_devices < value.devices.length || value.total_devices > 20) {
    throw new TypeError("账号权益 repository snapshot 非法");
  }
  const entitlement = value.entitlement === null ? null : validateEntitlementRow(value.entitlement, expectedAccount);
  const devices = value.devices.map((item) => validateDeviceRow(item, expectedAccount));
  if (new Set(devices.map((item) => item.device_id)).size !== devices.length) {
    throw new TypeError("账号权益 repository device 重复");
  }
  return Object.freeze({ ...value, entitlement, devices: Object.freeze(devices) });
}

function publicDevice(value) {
  return Object.freeze({
    device_id: value.device_id,
    device_state: value.device_state,
    first_seen_at: value.first_seen_at,
    last_seen_at: value.last_seen_at,
    revoked_at: value.revoked_at,
  });
}

function publicEntitlement(value) {
  if (value === null) return null;
  return Object.freeze({
    entitlement_state: value.entitlement_state,
    not_before: value.not_before,
    valid_until: value.valid_until,
    grace_until: value.grace_until,
  });
}

class LicenseAccountService {
  constructor({ repository, clock = () => new Date(), maxListItems = DEFAULT_MAX_LIST_ITEMS } = {}) {
    if (!repository || typeof repository.getLicenseAccount !== "function" ||
        typeof repository.revokeDevice !== "function" || typeof clock !== "function") {
      throw new TypeError("账号权益服务依赖不完整");
    }
    if (!Number.isSafeInteger(maxListItems) || maxListItems < 1 || maxListItems > 20) {
      throw new TypeError("maxListItems 非法");
    }
    this.repository = repository;
    this.clock = clock;
    this.maxListItems = maxListItems;
  }

  async getOverview(principal) {
    const account = accountPrincipal(principal);
    let snapshot;
    try {
      snapshot = validateLicenseAccountSnapshot(
        await this.repository.getLicenseAccount(account, this.maxListItems), account, this.maxListItems,
      );
    } catch (error) {
      if (error instanceof LicenseAccountServiceError) throw error;
      fail("SERVICE_UNAVAILABLE");
    }
    return Object.freeze({
      schema_version: "1.0",
      account_type: "oak_manuscript_license_account",
      entitlement: publicEntitlement(snapshot.entitlement),
      devices: Object.freeze(snapshot.devices.map(publicDevice)),
      truncated: snapshot.total_devices > snapshot.devices.length,
    });
  }

  async revokeDevice(principal, deviceId) {
    const account = accountPrincipal(principal);
    if (!DEVICE_PATTERN.test(deviceId || "")) fail("INVALID_DEVICE");
    let now;
    try {
      const current = this.clock();
      now = (current instanceof Date ? current : new Date(current)).toISOString();
    } catch { fail("SERVICE_UNAVAILABLE"); }
    let row;
    try {
      const value = await this.repository.revokeDevice(account, deviceId, now);
      if (value === null) fail("DEVICE_NOT_FOUND");
      row = validateDeviceRow(value, account, deviceId);
      if (row.device_state !== "revoked") throw new TypeError("设备撤销结果未撤销");
    } catch (error) {
      if (error instanceof LicenseAccountServiceError) throw error;
      fail("SERVICE_UNAVAILABLE");
    }
    return Object.freeze({ schema_version: "1.0", outcome: "revoked", device: publicDevice(row) });
  }
}

module.exports = {
  DEFAULT_MAX_LIST_ITEMS,
  DEVICE_KEYS,
  ENTITLEMENT_KEYS,
  ERROR_MESSAGES,
  LicenseAccountService,
  LicenseAccountServiceError,
  SNAPSHOT_KEYS,
  validateDeviceRow,
  validateEntitlementRow,
  validateLicenseAccountSnapshot,
};
