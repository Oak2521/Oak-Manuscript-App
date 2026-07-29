"use strict";

const crypto = require("node:crypto");

const MAX_REVOCATION_ENVELOPE_BYTES = 1024 * 1024;
const MAX_REVOCATION_PAYLOAD_BYTES = 512 * 1024;

const REQUEST_KEYS = Object.freeze([
  "schema_version", "request_type", "app_version", "bundle_id",
]);
const RECORD_KEYS = Object.freeze([
  "schema_version", "record_type", "bundle_id", "payload_sha256",
  "envelope_sha256", "envelope_bytes",
]);
const ENVELOPE_KEYS = Object.freeze([
  "schema_version", "kind", "payload_b64", "signatures",
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

class StandardsRevocationServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StandardsRevocationServiceError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new StandardsRevocationServiceError(code, message);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function strictBase64(value) {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    fail("SERVICE_UNAVAILABLE", "标准撤回发布源返回非法记录");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    fail("SERVICE_UNAVAILABLE", "标准撤回发布源返回非法记录");
  }
  return bytes;
}

function validateStandardsRevocationRequest(value) {
  if (!exactKeys(value, REQUEST_KEYS) || value.schema_version !== "1.0" ||
      value.request_type !== "oak_manuscript_standard_revocation_fetch" ||
      !APP_VERSION_PATTERN.test(value.app_version || "") ||
      !ID_PATTERN.test(value.bundle_id || "")) {
    fail("INVALID_REQUEST", "标准撤回请求不符合 exact v1 契约");
  }
  return true;
}

function validatePublishedRevocation(value, expectedBundleId) {
  if (!exactKeys(value, RECORD_KEYS) || value.schema_version !== "1.0" ||
      value.record_type !== "oak_standards_published_revocation_list" ||
      value.bundle_id !== expectedBundleId || !ID_PATTERN.test(value.bundle_id || "") ||
      !SHA256_PATTERN.test(value.payload_sha256 || "") ||
      !SHA256_PATTERN.test(value.envelope_sha256 || "") ||
      !Buffer.isBuffer(value.envelope_bytes) || value.envelope_bytes.length < 1 ||
      value.envelope_bytes.length > MAX_REVOCATION_ENVELOPE_BYTES) {
    fail("SERVICE_UNAVAILABLE", "标准撤回发布源返回非法记录");
  }
  if (digest(value.envelope_bytes) !== value.envelope_sha256) {
    fail("SERVICE_UNAVAILABLE", "标准撤回发布源记录与 envelope 字节不一致");
  }
  let envelope;
  try { envelope = JSON.parse(value.envelope_bytes.toString("utf8")); }
  catch { fail("SERVICE_UNAVAILABLE", "标准撤回发布源返回非法记录"); }
  if (!exactKeys(envelope, ENVELOPE_KEYS) || envelope.schema_version !== "1.0" ||
      envelope.kind !== "oak-standards-revocation-envelope") {
    fail("SERVICE_UNAVAILABLE", "标准撤回发布源返回非法记录");
  }
  const payloadBytes = strictBase64(envelope.payload_b64);
  if (payloadBytes.length > MAX_REVOCATION_PAYLOAD_BYTES ||
      digest(payloadBytes) !== value.payload_sha256) {
    fail("SERVICE_UNAVAILABLE", "标准撤回发布源记录与 payload 字节不一致");
  }
  return true;
}

class StandardsRevocationService {
  constructor({ revocationSource } = {}) {
    if (!revocationSource || typeof revocationSource.latest !== "function") {
      throw new TypeError("标准撤回发布源必须实现 latest(bundleId)");
    }
    this.revocationSource = revocationSource;
  }

  async fetch(input) {
    validateStandardsRevocationRequest(input);
    let published;
    try { published = await this.revocationSource.latest(input.bundle_id); }
    catch { fail("SERVICE_UNAVAILABLE", "标准撤回发布源暂时不可用"); }
    if (published === null) {
      fail("SERVICE_UNAVAILABLE", "标准撤回发布源尚无受信清单");
    }
    validatePublishedRevocation(published, input.bundle_id);
    return Object.freeze({ envelopeBytes: Buffer.from(published.envelope_bytes) });
  }
}

module.exports = {
  MAX_REVOCATION_ENVELOPE_BYTES,
  MAX_REVOCATION_PAYLOAD_BYTES,
  StandardsRevocationService,
  StandardsRevocationServiceError,
  validatePublishedRevocation,
  validateStandardsRevocationRequest,
};
