"use strict";

const crypto = require("node:crypto");

const MAX_PACKAGE_BYTES = 24 * 1024 * 1024;
const REQUEST_KEYS = Object.freeze([
  "schema_version", "request_type", "app_version", "bundle_id",
  "current_release_sequence", "current_manifest_sha256",
]);
const RELEASE_KEYS = Object.freeze([
  "schema_version", "record_type", "bundle_id", "release_sequence",
  "manifest_sha256", "envelope_sha256", "envelope_bytes",
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

class StandardsUpdateServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StandardsUpdateServiceError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new StandardsUpdateServiceError(code, message);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validateStandardsUpdateRequest(value) {
  if (!exactKeys(value, REQUEST_KEYS) || value.schema_version !== "1.0" ||
      value.request_type !== "oak_manuscript_standard_update_check" ||
      !APP_VERSION_PATTERN.test(value.app_version || "") ||
      !ID_PATTERN.test(value.bundle_id || "") ||
      !Number.isSafeInteger(value.current_release_sequence) || value.current_release_sequence < 1 ||
      !SHA256_PATTERN.test(value.current_manifest_sha256 || "")) {
    fail("INVALID_REQUEST", "标准更新请求不符合 exact v1 契约");
  }
  return true;
}

function validatePublishedRelease(value, expectedBundleId) {
  if (!exactKeys(value, RELEASE_KEYS) || value.schema_version !== "1.0" ||
      value.record_type !== "oak_standards_published_release" ||
      value.bundle_id !== expectedBundleId || !ID_PATTERN.test(value.bundle_id || "") ||
      !Number.isSafeInteger(value.release_sequence) || value.release_sequence < 1 ||
      !SHA256_PATTERN.test(value.manifest_sha256 || "") ||
      !SHA256_PATTERN.test(value.envelope_sha256 || "") ||
      !Buffer.isBuffer(value.envelope_bytes) || value.envelope_bytes.length < 1 ||
      value.envelope_bytes.length > MAX_PACKAGE_BYTES) {
    fail("SERVICE_UNAVAILABLE", "标准发布源返回非法记录");
  }
  const actual = crypto.createHash("sha256").update(value.envelope_bytes).digest("hex");
  if (actual !== value.envelope_sha256) {
    fail("SERVICE_UNAVAILABLE", "标准发布源记录与候选字节不一致");
  }
  return true;
}

class StandardsUpdateService {
  constructor({ releaseSource } = {}) {
    if (!releaseSource || typeof releaseSource.latest !== "function") {
      throw new TypeError("标准发布源必须实现 latest(bundleId)");
    }
    this.releaseSource = releaseSource;
  }

  async check(input) {
    validateStandardsUpdateRequest(input);
    let published;
    try {
      published = await this.releaseSource.latest(input.bundle_id);
    } catch {
      fail("SERVICE_UNAVAILABLE", "标准发布源暂时不可用");
    }
    if (published === null) return Object.freeze({ outcome: "current" });
    validatePublishedRelease(published, input.bundle_id);
    if (published.release_sequence < input.current_release_sequence) {
      return Object.freeze({ outcome: "current" });
    }
    if (published.release_sequence === input.current_release_sequence) {
      if (published.manifest_sha256 !== input.current_manifest_sha256) {
        fail("CLIENT_STATE_CONFLICT", "客户端标准版本身份与发布记录冲突");
      }
      return Object.freeze({ outcome: "current" });
    }
    return Object.freeze({ outcome: "update", envelopeBytes: Buffer.from(published.envelope_bytes) });
  }
}

module.exports = {
  MAX_PACKAGE_BYTES,
  StandardsUpdateService,
  StandardsUpdateServiceError,
  validatePublishedRelease,
  validateStandardsUpdateRequest,
};
