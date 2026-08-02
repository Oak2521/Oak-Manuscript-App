"use strict";

// Signed standards/rule-pack store. This module deliberately contains no
// transport: callers may feed it an offline fixture today and an HTTPS response
// later without changing the trust, rollback, or filesystem boundary.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");

const ENVELOPE_SCHEMA_VERSION = "1.0";
const ENVELOPE_KIND = "oak-standards-envelope";
const MANIFEST_SCHEMA_VERSION = "1.0";
const MANIFEST_KIND = "oak-standard-release";
const BUNDLED_ENVELOPE_KIND = "oak-standards-bundled-envelope";
const TRUST_SCHEMA_VERSION = "1.0";
const TRUST_SCHEMA_VERSION_WITH_REVOCATION = "1.1";
const TRUST_KIND = "oak-standards-trust-store";
const REVOCATION_ENVELOPE_KIND = "oak-standards-revocation-envelope";
const REVOCATION_LIST_KIND = "oak-standards-revocation-list";
const STATE_SCHEMA_VERSION = "1.0";
const TRANSACTION_SCHEMA_VERSION = "1.0";
const TRANSACTION_KIND = "oak-standards-transaction";
const TRANSACTION_DIRECTORY = "pending-transaction";
const TRANSACTION_FILE = "intent.json";

const PACKAGE_FILES = Object.freeze([
  "manifest.json",
  "release.envelope.json",
  "rulepack.json",
  "standards.json",
]);
const PAYLOAD_PATHS = Object.freeze(["standards.json", "rulepack.json"]);

const DEFAULT_LIMITS = Object.freeze({
  envelopeBytes: 24 * 1024 * 1024,
  manifestBytes: 256 * 1024,
  fileBytes: 8 * 1024 * 1024,
  totalPayloadBytes: 12 * 1024 * 1024,
  revocationEnvelopeBytes: 1024 * 1024,
  revocationPayloadBytes: 512 * 1024,
  stateBytes: 128 * 1024,
});
const MAX_SIGNING_KEYS = 16;
const MAX_REVOKED_MANIFESTS = 4096;
const PROCESS_START_TOKEN = crypto.randomBytes(32).toString("hex");
const ROOT_QUEUES = new Map();

const RELEASE_IDENTITY_FIELDS = Object.freeze([
  "name",
  "version",
  "pinned",
  "sha256",
  "bundle_id",
  "release_sequence",
  "manifest_sha256",
]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CHANNEL_RE = /^[a-z][a-z0-9-]{0,31}$/;
const RFC3339_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

class StandardsStoreError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "StandardsStoreError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new StandardsStoreError(code, message, details);
}

function enqueueForRoot(rootDir, operation) {
  const key = path.resolve(rootDir);
  const previous = ROOT_QUEUES.get(key) || Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(() => undefined, () => undefined);
  ROOT_QUEUES.set(key, tail);
  return result.finally(() => {
    if (ROOT_QUEUES.get(key) === tail) ROOT_QUEUES.delete(key);
  });
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

function canonicalJsonValue(value, location = "$", seen = new Set()) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) fail("NON_CANONICAL_JSON", `${location} 含未配对 surrogate`);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail("NON_CANONICAL_JSON", `${location} 只能使用安全整数`);
    }
    return String(value);
  }
  if (typeof value !== "object") {
    fail("NON_CANONICAL_JSON", `${location} 含不支持的 JSON 值`);
  }
  if (seen.has(value)) fail("NON_CANONICAL_JSON", `${location} 含循环引用`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item, index) => canonicalJsonValue(
        item,
        `${location}[${index}]`,
        seen,
      )).join(",")}]`;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      fail("NON_CANONICAL_JSON", `${location} 不是普通 JSON 对象`);
    }
    const keys = Object.keys(value).sort(compareText);
    return `{${keys.map((key) => {
      if (hasLoneSurrogate(key)) fail("NON_CANONICAL_JSON", `${location} 含非法键名`);
      return `${JSON.stringify(key)}:${canonicalJsonValue(value[key], `${location}.${key}`, seen)}`;
    }).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function canonicalJson(value) {
  return `${canonicalJsonValue(value)}\n`;
}

function decodeUtf8(bytes, label) {
  try {
    return UTF8.decode(bytes);
  } catch (error) {
    fail("INVALID_UTF8", `${label} 不是严格 UTF-8`, { cause: error.message });
  }
}

function parseCanonicalJson(bytes, label, maxBytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length === 0 || bytes.length > maxBytes) {
    fail("SIZE_LIMIT", `${label} 大小非法`, { size: bytes.length, maxBytes });
  }
  const text = decodeUtf8(bytes, label);
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail("INVALID_JSON", `${label} 不是有效 JSON`, { cause: error.message });
  }
  const expected = Buffer.from(canonicalJson(value), "utf8");
  if (!crypto.timingSafeEqual(
    crypto.createHash("sha256").update(bytes).digest(),
    crypto.createHash("sha256").update(expected).digest(),
  ) || !bytes.equals(expected)) {
    fail("NON_CANONICAL_JSON", `${label} 原始字节不是规范 JSON`);
  }
  return value;
}

function parseJson(bytes, label) {
  const text = decodeUtf8(bytes, label);
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("INVALID_JSON", `${label} 不是有效 JSON`, { cause: error.message });
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function strictBase64(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) ||
      value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail("INVALID_BASE64", `${label} 不是规范 Base64`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) fail("INVALID_BASE64", `${label} 不是规范 Base64`);
  return decoded;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys, label) {
  if (!isPlainObject(value)) fail("INVALID_SCHEMA", `${label} 必须是对象`);
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_SCHEMA", `${label} 字段集合不合法`, { expected, actual });
  }
}

function assertString(value, label, { min = 1, max = 4096, pattern = null } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max ||
      (pattern && !pattern.test(value))) {
    fail("INVALID_SCHEMA", `${label} 非法`);
  }
  return value;
}

function assertSafeInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail("INVALID_SCHEMA", `${label} 必须是 ${min}..${max} 的安全整数`);
  }
  return value;
}

function parseSemver(value, label) {
  assertString(value, label, { max: 128 });
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) fail("INVALID_SEMVER", `${label} 不是严格 SemVer：${value}`);
  const prerelease = match[4] ? match[4].split(".") : [];
  for (const identifier of prerelease) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
      fail("INVALID_SEMVER", `${label} 的 prerelease 数字段有前导零`);
    }
  }
  for (let index = 1; index <= 3; index += 1) {
    const numeric = Number(match[index]);
    if (!Number.isSafeInteger(numeric)) {
      fail("INVALID_SEMVER", `${label} 的 major/minor/patch 超出安全整数范围`);
    }
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

function compareSemver(leftRaw, rightRaw) {
  const left = parseSemver(leftRaw, "SemVer");
  const right = parseSemver(rightRaw, "SemVer");
  for (const field of ["major", "minor", "patch"]) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const leftId = left.prerelease[index];
    const rightId = right.prerelease[index];
    if (leftId === rightId) continue;
    const leftNumeric = /^\d+$/.test(leftId);
    const rightNumeric = /^\d+$/.test(rightId);
    if (leftNumeric && rightNumeric) {
      if (leftId.length !== rightId.length) return leftId.length < rightId.length ? -1 : 1;
      return compareText(leftId, rightId);
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return compareText(leftId, rightId);
  }
  return 0;
}

function parseUtc(value, label) {
  assertString(value, label, { pattern: RFC3339_UTC_RE, max: 24 });
  const timestamp = Date.parse(value);
  const normalized = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
  const expected = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (!Number.isFinite(timestamp) || normalized !== expected) {
    fail("INVALID_TIME", `${label} 不是规范 UTC 时间`);
  }
  return timestamp;
}

function validateFileDescriptor(value, expectedPath, limits, label) {
  exactKeys(value, ["path", "size_bytes", "sha256", "media_type"], label);
  if (value.path !== expectedPath) fail("UNSAFE_PATH", `${label}.path 必须是 ${expectedPath}`);
  assertSafeInteger(value.size_bytes, `${label}.size_bytes`, { min: 1, max: limits.fileBytes });
  assertString(value.sha256, `${label}.sha256`, { pattern: SHA256_RE, max: 64 });
  if (value.media_type !== "application/json") {
    fail("INVALID_SCHEMA", `${label}.media_type 必须是 application/json`);
  }
}

function validateRollbackTarget(value, manifest) {
  if (value === null) return;
  exactKeys(value, ["manifest_sha256", "release_sequence"], "manifest.rollback_target");
  assertString(value.manifest_sha256, "manifest.rollback_target.manifest_sha256", {
    pattern: SHA256_RE,
    max: 64,
  });
  assertSafeInteger(value.release_sequence, "manifest.rollback_target.release_sequence", {
    min: 1,
  });
  if (value.release_sequence >= manifest.release_sequence) {
    fail("INVALID_SCHEMA", "rollback_target 必须指向更早的 release_sequence");
  }
}

function validateManifest(manifest, {
  appVersion,
  nowMs,
  enforceCompatibility,
  enforceExpiry,
  signingRole,
  limits,
}) {
  exactKeys(manifest, [
    "schema_version",
    "kind",
    "bundle_id",
    "release_sequence",
    "version",
    "channel",
    "released_at",
    "expires_at",
    "min_app",
    "max_app_exclusive",
    "signing_role",
    "files",
    "rulepack",
    "rollback_target",
    "change_summary",
  ], "manifest");
  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION || manifest.kind !== MANIFEST_KIND) {
    fail("INVALID_SCHEMA", "manifest schema/kind 不受支持");
  }
  if (manifest.signing_role !== signingRole) {
    fail("INVALID_SCHEMA", `manifest.signing_role 必须是 ${signingRole}`);
  }
  assertString(manifest.bundle_id, "manifest.bundle_id", { pattern: SAFE_ID_RE, max: 128 });
  assertSafeInteger(manifest.release_sequence, "manifest.release_sequence", { min: 1 });
  parseSemver(manifest.version, "manifest.version");
  assertString(manifest.channel, "manifest.channel", { pattern: CHANNEL_RE, max: 32 });
  if (manifest.channel !== "stable") {
    fail("INVALID_SCHEMA", "首版标准更新只接受 stable channel");
  }
  const releasedAt = parseUtc(manifest.released_at, "manifest.released_at");
  let expiresAt = null;
  if (manifest.expires_at !== null) {
    expiresAt = parseUtc(manifest.expires_at, "manifest.expires_at");
    if (expiresAt <= releasedAt) fail("INVALID_TIME", "manifest.expires_at 必须晚于 released_at");
  }
  parseSemver(manifest.min_app, "manifest.min_app");
  parseSemver(manifest.max_app_exclusive, "manifest.max_app_exclusive");
  if (compareSemver(manifest.min_app, manifest.max_app_exclusive) >= 0) {
    fail("INVALID_SEMVER", "manifest APP 兼容范围为空或反向");
  }
  if (enforceCompatibility &&
      (compareSemver(appVersion, manifest.min_app) < 0 ||
       compareSemver(appVersion, manifest.max_app_exclusive) >= 0)) {
    fail("INCOMPATIBLE_APP", `标准包 ${manifest.version} 与 APP ${appVersion} 不兼容`);
  }
  if (enforceExpiry && releasedAt > nowMs) {
    fail("NOT_YET_VALID", `标准包 manifest 尚未到发布时间 ${manifest.released_at}`);
  }
  if (enforceExpiry && expiresAt !== null && expiresAt <= nowMs) {
    fail("EXPIRED_MANIFEST", `标准包 manifest 已于 ${manifest.expires_at} 过期`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== PAYLOAD_PATHS.length) {
    fail("INVALID_SCHEMA", "manifest.files 必须精确包含两个文件");
  }
  PAYLOAD_PATHS.forEach((expectedPath, index) => {
    validateFileDescriptor(manifest.files[index], expectedPath, limits, `manifest.files[${index}]`);
  });
  const total = manifest.files.reduce((sum, item) => sum + item.size_bytes, 0);
  if (total > limits.totalPayloadBytes) fail("SIZE_LIMIT", "manifest payload 总大小超限");
  exactKeys(manifest.rulepack, [
    "name",
    "version",
    "sha256",
    "capability_set_sha256",
  ], "manifest.rulepack");
  assertString(manifest.rulepack.name, "manifest.rulepack.name", { pattern: SAFE_ID_RE, max: 128 });
  parseSemver(manifest.rulepack.version, "manifest.rulepack.version");
  if (manifest.rulepack.version !== manifest.version) {
    fail("INVALID_SCHEMA", "manifest.rulepack.version 必须与 release version 一致");
  }
  assertString(manifest.rulepack.sha256, "manifest.rulepack.sha256", {
    pattern: SHA256_RE,
    max: 64,
  });
  assertString(manifest.rulepack.capability_set_sha256,
    "manifest.rulepack.capability_set_sha256", { pattern: SHA256_RE, max: 64 });
  if (manifest.rulepack.sha256 !== manifest.files[1].sha256) {
    fail("HASH_MISMATCH", "manifest.rulepack.sha256 与 rulepack.json 文件哈希不一致");
  }
  validateRollbackTarget(manifest.rollback_target, manifest);
  if (!Array.isArray(manifest.change_summary) || manifest.change_summary.length === 0 ||
      manifest.change_summary.length > 128) {
    fail("INVALID_SCHEMA", "manifest.change_summary 必须是非空字符串数组");
  }
  manifest.change_summary.forEach((item, index) => {
    assertString(item, `manifest.change_summary[${index}]`, { min: 1, max: 4096 });
  });
}

function validateTrustRole(trustStore, roleName) {
  const role = trustStore.roles[roleName];
  exactKeys(role, ["threshold", "keyids"], `trustStore.roles.${roleName}`);
  if (!Array.isArray(role.keyids) || role.keyids.length === 0) {
    fail("INVALID_TRUST_STORE", `${roleName} role 至少需要一个 keyid`);
  }
  if (role.keyids.length > MAX_SIGNING_KEYS) {
    fail("INVALID_TRUST_STORE", `${roleName} role 最多允许 ${MAX_SIGNING_KEYS} 个 keyid`);
  }
  const uniqueRoleKeys = new Set(role.keyids);
  if (uniqueRoleKeys.size !== role.keyids.length ||
      [...uniqueRoleKeys].some((keyid) => !SHA256_RE.test(keyid))) {
    fail("INVALID_TRUST_STORE", `${roleName} role keyids 非法或重复`);
  }
  assertSafeInteger(role.threshold, `trustStore.roles.${roleName}.threshold`, {
    min: 1,
    max: role.keyids.length,
  });
  return { role, uniqueRoleKeys };
}

function validateTrustStore(trustStore) {
  exactKeys(trustStore, ["schema_version", "kind", "keys", "roles"], "trustStore");
  if (!new Set([TRUST_SCHEMA_VERSION, TRUST_SCHEMA_VERSION_WITH_REVOCATION])
    .has(trustStore.schema_version) || trustStore.kind !== TRUST_KIND) {
    fail("INVALID_TRUST_STORE", "trust store schema/kind 不受支持");
  }
  if (!isPlainObject(trustStore.keys)) fail("INVALID_TRUST_STORE", "trustStore.keys 必须是对象");
  const roleNames = Object.keys(trustStore.roles).sort(compareText);
  const expectedRoleNames = trustStore.schema_version === TRUST_SCHEMA_VERSION
    ? ["release"]
    : ["release", "revocation"];
  if (canonicalJson(roleNames) !== canonicalJson(expectedRoleNames)) {
    fail("INVALID_TRUST_STORE", `trust store ${trustStore.schema_version} 角色集合不精确`);
  }
  const release = validateTrustRole(trustStore, "release");
  const revocation = trustStore.schema_version === TRUST_SCHEMA_VERSION_WITH_REVOCATION
    ? validateTrustRole(trustStore, "revocation")
    : null;
  const referencedKeys = new Set([
    ...release.uniqueRoleKeys,
    ...(revocation === null ? [] : revocation.uniqueRoleKeys),
  ]);

  const keys = new Map();
  if (Object.keys(trustStore.keys).length > MAX_SIGNING_KEYS) {
    fail("INVALID_TRUST_STORE", `trust store 最多允许 ${MAX_SIGNING_KEYS} 个公钥`);
  }
  for (const [keyid, record] of Object.entries(trustStore.keys)) {
    if (!SHA256_RE.test(keyid)) fail("INVALID_TRUST_STORE", `非法 keyid：${keyid}`);
    exactKeys(record, ["alg", "spki_der_b64"], `trustStore.keys.${keyid}`);
    if (record.alg !== "ed25519") fail("INVALID_TRUST_STORE", `${keyid} 算法必须是 ed25519`);
    const der = strictBase64(record.spki_der_b64, `trustStore.keys.${keyid}.spki_der_b64`);
    if (sha256(der) !== keyid) fail("INVALID_TRUST_STORE", `${keyid} 与 SPKI DER 哈希不一致`);
    let publicKey;
    try {
      publicKey = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    } catch (error) {
      fail("INVALID_TRUST_STORE", `${keyid} 不是有效 SPKI DER`, { cause: error.message });
    }
    if (publicKey.asymmetricKeyType !== "ed25519") {
      fail("INVALID_TRUST_STORE", `${keyid} 不是 Ed25519 公钥`);
    }
    keys.set(keyid, publicKey);
  }
  for (const keyid of referencedKeys) {
    if (!keys.has(keyid)) fail("INVALID_TRUST_STORE", `签名角色引用了未知 keyid：${keyid}`);
  }
  for (const keyid of keys.keys()) {
    if (!referencedKeys.has(keyid)) {
      fail("INVALID_TRUST_STORE", `trust store 含未被任何角色引用的公钥：${keyid}`);
    }
  }
  return {
    roles: {
      release: release.role,
      revocation: revocation?.role || null,
    },
    keys,
  };
}

function validateEnvelopeShape(envelope) {
  exactKeys(envelope, [
    "schema_version",
    "kind",
    "manifest_b64",
    "signatures",
    "files",
  ], "envelope");
  if (envelope.schema_version !== ENVELOPE_SCHEMA_VERSION || envelope.kind !== ENVELOPE_KIND) {
    fail("INVALID_SCHEMA", "envelope schema/kind 不受支持");
  }
  if (!Array.isArray(envelope.signatures) || envelope.signatures.length === 0) {
    fail("INVALID_SIGNATURE", "envelope.signatures 不能为空");
  }
  if (envelope.signatures.length > MAX_SIGNING_KEYS) {
    fail("INVALID_SIGNATURE", `envelope.signatures 最多允许 ${MAX_SIGNING_KEYS} 项`);
  }
  if (!Array.isArray(envelope.files) || envelope.files.length !== PAYLOAD_PATHS.length) {
    fail("INVALID_SCHEMA", "envelope.files 必须精确包含两个 payload");
  }
}

function validateBundledEnvelopeShape(envelope) {
  exactKeys(envelope, [
    "schema_version",
    "kind",
    "manifest_b64",
    "files",
  ], "bundled envelope");
  if (envelope.schema_version !== ENVELOPE_SCHEMA_VERSION ||
      envelope.kind !== BUNDLED_ENVELOPE_KIND) {
    fail("INVALID_SCHEMA", "bundled envelope schema/kind 不受支持");
  }
  if (!Array.isArray(envelope.files) || envelope.files.length !== PAYLOAD_PATHS.length) {
    fail("INVALID_SCHEMA", "bundled envelope.files 必须精确包含两个 payload");
  }
}

function validateRevocationEnvelopeShape(envelope) {
  exactKeys(envelope, [
    "schema_version",
    "kind",
    "payload_b64",
    "signatures",
  ], "revocation envelope");
  if (envelope.schema_version !== ENVELOPE_SCHEMA_VERSION ||
      envelope.kind !== REVOCATION_ENVELOPE_KIND) {
    fail("INVALID_REVOCATION_LIST", "revocation envelope schema/kind 不受支持");
  }
  if (!Array.isArray(envelope.signatures) || envelope.signatures.length === 0 ||
      envelope.signatures.length > MAX_SIGNING_KEYS) {
    fail("INVALID_SIGNATURE", "revocation envelope 签名数量非法");
  }
}

function validateRevocationList(payload, { expectedBundleId, nowMs }) {
  exactKeys(payload, [
    "schema_version",
    "kind",
    "bundle_id",
    "issued_at",
    "expires_at",
    "revoked_manifest_sha256s",
  ], "revocation list");
  if (payload.schema_version !== ENVELOPE_SCHEMA_VERSION ||
      payload.kind !== REVOCATION_LIST_KIND) {
    fail("INVALID_REVOCATION_LIST", "revocation list schema/kind 不受支持");
  }
  assertString(payload.bundle_id, "revocation list.bundle_id", {
    pattern: SAFE_ID_RE,
    max: 128,
  });
  if (payload.bundle_id !== expectedBundleId) {
    fail("BUNDLE_ID_MISMATCH", "revocation list bundle_id 与当前标准库不一致");
  }
  const issuedAt = parseUtc(payload.issued_at, "revocation list.issued_at");
  const expiresAt = parseUtc(payload.expires_at, "revocation list.expires_at");
  if (issuedAt > nowMs) fail("NOT_YET_VALID", "revocation list 尚未生效");
  if (expiresAt <= nowMs || expiresAt <= issuedAt) {
    fail("EXPIRED_REVOCATION_LIST", "revocation list 已过期或时间窗非法");
  }
  if (!Array.isArray(payload.revoked_manifest_sha256s) ||
      payload.revoked_manifest_sha256s.length > MAX_REVOKED_MANIFESTS) {
    fail("INVALID_REVOCATION_LIST", "revoked_manifest_sha256s 数量非法");
  }
  const sorted = [...payload.revoked_manifest_sha256s].sort(compareText);
  if (new Set(sorted).size !== sorted.length ||
      sorted.some((digest, index) => !SHA256_RE.test(digest) ||
        digest !== payload.revoked_manifest_sha256s[index])) {
    fail("INVALID_REVOCATION_LIST", "revoked_manifest_sha256s 必须是去重、排序的小写 SHA-256 数组");
  }
  return payload;
}

function descriptorFor(manifest, manifestSha256, source) {
  return {
    bundle_id: manifest.bundle_id,
    release_sequence: manifest.release_sequence,
    version: manifest.version,
    manifest_sha256: manifestSha256,
    source,
  };
}

function descriptorIdentity(value) {
  return value && `${value.bundle_id}\0${value.release_sequence}\0${value.version}\0${value.manifest_sha256}\0${value.source}`;
}

function releaseIdentityFor(verified) {
  return {
    name: verified.manifest.rulepack.name,
    version: verified.manifest.rulepack.version,
    pinned: true,
    sha256: verified.manifest.rulepack.sha256,
    bundle_id: verified.manifest.bundle_id,
    release_sequence: verified.manifest.release_sequence,
    manifest_sha256: verified.manifestSha256,
  };
}

function validateReleaseIdentity(value) {
  exactKeys(value, RELEASE_IDENTITY_FIELDS, "release identity");
  assertString(value.name, "release identity.name", { pattern: SAFE_ID_RE, max: 128 });
  parseSemver(value.version, "release identity.version");
  if (value.pinned !== true) fail("INVALID_RELEASE_IDENTITY", "release identity.pinned 必须为 true");
  assertString(value.sha256, "release identity.sha256", { pattern: SHA256_RE, max: 64 });
  assertString(value.bundle_id, "release identity.bundle_id", { pattern: SAFE_ID_RE, max: 128 });
  assertSafeInteger(value.release_sequence, "release identity.release_sequence", { min: 1 });
  assertString(value.manifest_sha256, "release identity.manifest_sha256", {
    pattern: SHA256_RE,
    max: 64,
  });
  return value;
}

function validateDescriptor(value, label) {
  exactKeys(value, [
    "bundle_id",
    "release_sequence",
    "version",
    "manifest_sha256",
    "source",
  ], label);
  assertString(value.bundle_id, `${label}.bundle_id`, { pattern: SAFE_ID_RE, max: 128 });
  assertSafeInteger(value.release_sequence, `${label}.release_sequence`, { min: 1 });
  parseSemver(value.version, `${label}.version`);
  assertString(value.manifest_sha256, `${label}.manifest_sha256`, {
    pattern: SHA256_RE,
    max: 64,
  });
  if (!new Set(["bundled", "installed"]).has(value.source)) {
    fail("INVALID_STATE", `${label}.source 非法`);
  }
}

function validateState(state) {
  exactKeys(state, [
    "schema_version",
    "active",
    "previous",
    "highest_seen_sequence",
    "revoked_manifest_sha256s",
  ], "active state");
  if (state.schema_version !== STATE_SCHEMA_VERSION) {
    fail("INVALID_STATE", "active state schema 不受支持");
  }
  validateDescriptor(state.active, "active state.active");
  if (state.previous !== null) validateDescriptor(state.previous, "active state.previous");
  if (!Number.isSafeInteger(state.highest_seen_sequence) ||
      state.highest_seen_sequence < state.active.release_sequence) {
    fail("INVALID_STATE", "active state.highest_seen_sequence 非法或低于 active sequence");
  }
  if (state.previous && state.highest_seen_sequence < state.previous.release_sequence) {
    fail("INVALID_STATE", "highest_seen_sequence 低于 previous release_sequence");
  }
  if (!Array.isArray(state.revoked_manifest_sha256s)) {
    fail("INVALID_STATE", "revoked_manifest_sha256s 必须是数组");
  }
  const sorted = [...state.revoked_manifest_sha256s].sort(compareText);
  if (new Set(sorted).size !== sorted.length ||
      sorted.some((digest, index) => !SHA256_RE.test(digest) || digest !== state.revoked_manifest_sha256s[index])) {
    fail("INVALID_STATE", "revoked_manifest_sha256s 必须是去重、排序的小写 SHA-256 数组");
  }
  return state;
}

function stateDigest(state) {
  return state === null ? null : sha256(Buffer.from(canonicalJson(state), "utf8"));
}

function validateTransactionIntent(intent) {
  exactKeys(intent, [
    "schema_version",
    "kind",
    "transaction_id",
    "operation",
    "owner",
    "expected_state",
    "expected_state_sha256",
    "next_state",
    "next_state_sha256",
    "target",
  ], "transaction intent");
  if (intent.schema_version !== TRANSACTION_SCHEMA_VERSION || intent.kind !== TRANSACTION_KIND) {
    fail("INVALID_TRANSACTION", "pending transaction schema/kind 不受支持");
  }
  assertString(intent.transaction_id, "transaction_id", { pattern: SHA256_RE, max: 64 });
  if (!new Set([
    "bootstrap",
    "install",
    "activate",
    "rollback",
    "reconcile-bundled",
    "apply-revocations",
  ])
    .has(intent.operation)) {
    fail("INVALID_TRANSACTION", "pending transaction operation 非法");
  }
  exactKeys(intent.owner, ["pid", "process_start_token"], "transaction owner");
  assertSafeInteger(intent.owner.pid, "transaction owner.pid", { min: 1 });
  assertString(intent.owner.process_start_token, "transaction owner.process_start_token", {
    pattern: SHA256_RE,
    max: 64,
  });
  if (intent.expected_state !== null) validateState(intent.expected_state);
  if (intent.expected_state_sha256 !== stateDigest(intent.expected_state)) {
    fail("INVALID_TRANSACTION", "pending transaction expected_state 摘要不一致");
  }
  validateState(intent.next_state);
  if (intent.next_state_sha256 !== stateDigest(intent.next_state)) {
    fail("INVALID_TRANSACTION", "pending transaction next_state 摘要不一致");
  }
  exactKeys(intent.target, [
    "manifest_sha256",
    "envelope_sha256",
    "package_was_present",
    "files",
  ], "transaction target");
  assertString(intent.target.manifest_sha256, "transaction target.manifest_sha256", {
    pattern: SHA256_RE,
    max: 64,
  });
  assertString(intent.target.envelope_sha256, "transaction target.envelope_sha256", {
    pattern: SHA256_RE,
    max: 64,
  });
  if (typeof intent.target.package_was_present !== "boolean") {
    fail("INVALID_TRANSACTION", "transaction target.package_was_present 非法");
  }
  if (!Array.isArray(intent.target.files) || intent.target.files.length !== PACKAGE_FILES.length) {
    fail("INVALID_TRANSACTION", "transaction target.files 集合不精确");
  }
  intent.target.files.forEach((entry, index) => {
    exactKeys(entry, ["path", "size_bytes", "sha256"], `transaction target.files[${index}]`);
    if (entry.path !== PACKAGE_FILES[index]) {
      fail("INVALID_TRANSACTION", "transaction target.files 顺序或路径非法");
    }
    assertSafeInteger(entry.size_bytes, `transaction target.files[${index}].size_bytes`, { min: 1 });
    assertString(entry.sha256, `transaction target.files[${index}].sha256`, {
      pattern: SHA256_RE,
      max: 64,
    });
  });
  if (intent.target.manifest_sha256 !== intent.next_state.active.manifest_sha256 ||
      intent.target.manifest_sha256 !== intent.target.files[0].sha256 ||
      intent.target.envelope_sha256 !== intent.target.files[1].sha256) {
    fail("INVALID_TRANSACTION", "transaction target 与 next_state/package 摘要未绑定");
  }
  const expected = intent.expected_state;
  const next = intent.next_state;
  if (intent.operation === "bootstrap") {
    if (expected !== null || intent.target.package_was_present || next.previous !== null ||
        next.active.source !== "bundled" ||
        next.highest_seen_sequence !== next.active.release_sequence) {
      fail("INVALID_TRANSACTION", "bootstrap transaction 状态转换非法");
    }
  } else {
    if (expected === null || next.active.bundle_id !== expected.active.bundle_id) {
      fail("INVALID_TRANSACTION", "transaction 前后状态基础约束不一致");
    }
    if (intent.operation === "apply-revocations") {
      const preservedDescriptors = descriptorIdentity(next.active) === descriptorIdentity(expected.active) &&
        descriptorIdentity(next.previous) === descriptorIdentity(expected.previous);
      const appendOnly = next.revoked_manifest_sha256s.length > expected.revoked_manifest_sha256s.length &&
        expected.revoked_manifest_sha256s.every((digest) =>
          next.revoked_manifest_sha256s.includes(digest));
      if (!intent.target.package_was_present || !preservedDescriptors ||
          next.highest_seen_sequence !== expected.highest_seen_sequence || !appendOnly) {
        fail("INVALID_TRANSACTION", "apply-revocations transaction 状态转换非法");
      }
    } else if (canonicalJson(expected.revoked_manifest_sha256s) !==
        canonicalJson(next.revoked_manifest_sha256s)) {
      fail("INVALID_TRANSACTION", "非撤回事务不得修改撤回集合");
    } else if (intent.operation === "install" || intent.operation === "reconcile-bundled") {
      const expectedSource = intent.operation === "install" ? "installed" : "bundled";
      if (intent.target.package_was_present || next.active.source !== expectedSource ||
          next.active.release_sequence <= expected.highest_seen_sequence ||
          next.highest_seen_sequence !== next.active.release_sequence || next.previous === null) {
        fail("INVALID_TRANSACTION", `${intent.operation} transaction 状态转换非法`);
      }
    } else if (intent.operation === "activate") {
      if (!intent.target.package_was_present || next.previous === null ||
          next.active.release_sequence <= expected.active.release_sequence ||
          next.highest_seen_sequence !==
            Math.max(expected.highest_seen_sequence, next.active.release_sequence)) {
        fail("INVALID_TRANSACTION", "activate transaction 状态转换非法");
      }
    } else if (intent.operation === "rollback") {
      if (!intent.target.package_was_present || expected.previous === null ||
          descriptorIdentity(next.active) !== descriptorIdentity(expected.previous) ||
          next.highest_seen_sequence !== expected.highest_seen_sequence) {
        fail("INVALID_TRANSACTION", "rollback transaction 状态转换非法");
      }
    }
  }
  return intent;
}

function statIdentity(info) {
  return {
    dev: String(info.dev),
    ino: String(info.ino),
    mode: String(info.mode),
    size: String(info.size),
    mtime: String(info.mtimeNs ?? info.mtimeMs ?? ""),
    birthtime: String(info.birthtimeNs ?? info.birthtimeMs ?? ""),
  };
}

function sameObject(left, right, { includeSize = true } = {}) {
  if (!left || !right) return left === right;
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    (!includeSize || (left.size === right.size && left.mtime === right.mtime)) &&
    (left.ino !== "0" || left.birthtime === right.birthtime);
}

function lstatOrNull(fsImpl, target) {
  try {
    return fsImpl.lstatSync(target, { bigint: true });
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
    throw error;
  }
}

function samePath(left, right) {
  const leftToRight = path.relative(path.resolve(left), path.resolve(right));
  const rightToLeft = path.relative(path.resolve(right), path.resolve(left));
  return leftToRight === "" && rightToLeft === "";
}

function assertSafeDirectory(fsImpl, target, label) {
  const info = lstatOrNull(fsImpl, target);
  if (!info || info.isSymbolicLink() || !info.isDirectory()) {
    fail("UNSAFE_PATH", `${label} 缺失、不是普通目录或是链接/reparse：${target}`);
  }
  const real = fsImpl.realpathSync.native
    ? fsImpl.realpathSync.native(target)
    : fsImpl.realpathSync(target);
  if (!samePath(target, real)) fail("UNSAFE_PATH", `${label} 经 realpath 改变：${target}`);
  return { info, identity: statIdentity(info), real };
}

function ensureDirectoryChain(fsImpl, target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    let info = lstatOrNull(fsImpl, current);
    if (!info) {
      try {
        fsImpl.mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if (!error || error.code !== "EEXIST") throw error;
      }
      info = lstatOrNull(fsImpl, current);
    }
    if (!info || info.isSymbolicLink() || !info.isDirectory()) {
      fail("UNSAFE_PATH", `目录链包含链接/reparse 或非目录：${current}`);
    }
  }
  return assertSafeDirectory(fsImpl, absolute, "受控目录");
}

function readSafeFile(fsImpl, target, maxBytes, label) {
  const before = lstatOrNull(fsImpl, target);
  if (!before || before.isSymbolicLink() || !before.isFile() || BigInt(before.nlink) !== 1n) {
    fail("UNSAFE_PATH", `${label} 不是单链接普通文件：${target}`);
  }
  if (before.size <= 0n || before.size > BigInt(maxBytes)) {
    fail("SIZE_LIMIT", `${label} 大小非法`, { size: String(before.size), maxBytes });
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fsImpl.openSync(target, flags);
    const opened = fsImpl.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || BigInt(opened.nlink) !== 1n ||
        !sameObject(statIdentity(before), statIdentity(opened))) {
      fail("PATH_CHANGED", `${label} 打开时身份发生变化`);
    }
    const bytes = fsImpl.readFileSync(descriptor);
    const afterRead = fsImpl.fstatSync(descriptor, { bigint: true });
    if (!sameObject(statIdentity(opened), statIdentity(afterRead)) ||
        bytes.length !== Number(afterRead.size)) {
      fail("PATH_CHANGED", `${label} 读取期间发生变化`);
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor);
    const after = lstatOrNull(fsImpl, target);
    if (!after || !sameObject(statIdentity(before), statIdentity(after))) {
      fail("PATH_CHANGED", `${label} 目录项在读取期间发生变化`);
    }
  }
}

function writeExclusiveFile(fsImpl, target, bytes, { expectedParent = null } = {}) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fsImpl.openSync(target, flags, 0o600);
    if (expectedParent) {
      const parent = assertSafeDirectory(fsImpl, expectedParent.path, "候选文件父目录");
      if (!sameObject(expectedParent.identity, parent.identity, { includeSize: false })) {
        fail("PATH_CHANGED", `候选文件父目录在 open 时发生变化：${expectedParent.path}`);
      }
      const entry = lstatOrNull(fsImpl, target);
      const opened = fsImpl.fstatSync(descriptor, { bigint: true });
      if (!entry || entry.isSymbolicLink() || !entry.isFile() || BigInt(entry.nlink) !== 1n ||
          !sameObject(statIdentity(entry), statIdentity(opened))) {
        fail("PATH_CHANGED", `候选文件描述符与目录项身份不一致：${target}`);
      }
    }
    fsImpl.writeFileSync(descriptor, bytes);
    fsImpl.fsyncSync(descriptor);
    const info = fsImpl.fstatSync(descriptor, { bigint: true });
    if (!info.isFile() || BigInt(info.nlink) !== 1n || info.size !== BigInt(bytes.length)) {
      fail("UNSAFE_PATH", `候选文件写入后身份非法：${target}`);
    }
    if (expectedParent) {
      const parent = assertSafeDirectory(fsImpl, expectedParent.path, "候选文件父目录");
      if (!sameObject(expectedParent.identity, parent.identity, { includeSize: false })) {
        fail("PATH_CHANGED", `候选文件父目录在写入期间发生变化：${expectedParent.path}`);
      }
    }
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor);
  }
}

function fsyncDirectoryBestEffort(fsImpl, directory) {
  let descriptor;
  try {
    descriptor = fsImpl.openSync(directory, fs.constants.O_RDONLY);
    fsImpl.fsyncSync(descriptor);
  } catch (error) {
    if (!error || !new Set(["EINVAL", "EISDIR", "EPERM", "EACCES", "ENOTSUP"]).has(error.code)) {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor);
  }
}

function safeCleanupCandidate(fsImpl, candidate, expectedIdentity) {
  try {
    const info = lstatOrNull(fsImpl, candidate);
    if (!info || info.isSymbolicLink() || !info.isDirectory() ||
        !sameObject(expectedIdentity, statIdentity(info), { includeSize: false })) return;
    const names = fsImpl.readdirSync(candidate).sort(compareText);
    if (names.some((name) => !PACKAGE_FILES.includes(name))) return;
    for (const name of names) {
      const target = path.join(candidate, name);
      const fileInfo = lstatOrNull(fsImpl, target);
      if (!fileInfo || fileInfo.isSymbolicLink() || !fileInfo.isFile() ||
          BigInt(fileInfo.nlink) !== 1n) return;
    }
    for (const name of names) fsImpl.unlinkSync(path.join(candidate, name));
    fsImpl.rmdirSync(candidate);
  } catch {
    // Identity uncertainty means "leave for quarantine", never recursive-delete.
  }
}

function safeCleanupTransactionDirectory(fsImpl, directory, expectedIdentity = null) {
  try {
    const info = lstatOrNull(fsImpl, directory);
    if (!info || info.isSymbolicLink() || !info.isDirectory()) return !info;
    if (expectedIdentity !== null &&
        !sameObject(expectedIdentity, statIdentity(info), { includeSize: false })) return false;
    const names = fsImpl.readdirSync(directory).sort(compareText);
    if (names.some((name) => name !== TRANSACTION_FILE) || names.length > 1) return false;
    if (names.length === 1) {
      const target = path.join(directory, TRANSACTION_FILE);
      const targetInfo = lstatOrNull(fsImpl, target);
      if (!targetInfo || targetInfo.isSymbolicLink() || !targetInfo.isFile() ||
          BigInt(targetInfo.nlink) !== 1n) return false;
      fsImpl.unlinkSync(target);
    }
    fsImpl.rmdirSync(directory);
    return true;
  } catch {
    return false;
  }
}

class StandardsStore {
  constructor({
    rootDir,
    trustStore,
    appVersion,
    validatePayload,
    bundledManifestSha256 = null,
    bundledManifestSha256s = [],
    now = () => new Date(),
    fsImpl = fs,
    limits = {},
  }) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) {
      fail("INVALID_ARGUMENT", "standards store rootDir 必须是绝对路径");
    }
    parseSemver(appVersion, "appVersion");
    if (typeof validatePayload !== "function") {
      fail("INVALID_ARGUMENT", "必须注入 async validatePayload 回调");
    }
    if (typeof now !== "function") fail("INVALID_ARGUMENT", "now 必须是函数");
    this.rootDir = path.resolve(rootDir);
    this.packagesDir = path.join(this.rootDir, "packages");
    this.incomingDir = path.join(this.rootDir, "incoming");
    this.statePath = path.join(this.rootDir, "active.json");
    this.pendingTransactionDir = path.join(this.rootDir, TRANSACTION_DIRECTORY);
    this.pendingTransactionPath = path.join(this.pendingTransactionDir, TRANSACTION_FILE);
    this.trust = trustStore === null ? null : validateTrustStore(trustStore);
    this.appVersion = appVersion;
    this.validatePayload = validatePayload;
    if (bundledManifestSha256 !== null && !SHA256_RE.test(bundledManifestSha256)) {
      fail("INVALID_ARGUMENT", "bundledManifestSha256 必须是小写 SHA-256 或 null");
    }
    if (!Array.isArray(bundledManifestSha256s) ||
        bundledManifestSha256s.some((digest) => typeof digest !== "string" || !SHA256_RE.test(digest))) {
      fail("INVALID_ARGUMENT", "bundledManifestSha256s 必须是小写 SHA-256 数组");
    }
    this.bundledManifestSha256 = bundledManifestSha256;
    this.bundledManifestSha256s = new Set([
      ...bundledManifestSha256s,
      ...(bundledManifestSha256 === null ? [] : [bundledManifestSha256]),
    ]);
    this.now = now;
    this.fs = fsImpl;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    for (const [name, value] of Object.entries(this.limits)) {
      assertSafeInteger(value, `limits.${name}`, { min: 1 });
    }
  }

  _nowMs() {
    const value = this.now();
    const milliseconds = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(milliseconds)) fail("INVALID_TIME", "now() 返回值非法");
    return milliseconds;
  }

  _ensureStore() {
    ensureDirectoryChain(this.fs, this.rootDir);
    ensureDirectoryChain(this.fs, this.packagesDir);
    ensureDirectoryChain(this.fs, this.incomingDir);
    const root = assertSafeDirectory(this.fs, this.rootDir, "standards store 根目录");
    for (const [target, label] of [
      [this.packagesDir, "packages 目录"],
      [this.incomingDir, "incoming 目录"],
    ]) {
      const child = assertSafeDirectory(this.fs, target, label);
      if (path.dirname(child.real) !== root.real) fail("UNSAFE_PATH", `${label} 不在 store 根目录内`);
    }
  }

  _runSerialized(operation) {
    return enqueueForRoot(this.rootDir, async () => {
      await this._recoverPendingTransaction();
      return operation();
    });
  }

  _transactionTarget(verified, packageWasPresent) {
    const outputs = new Map([
      ["manifest.json", verified.manifestBytes],
      ["release.envelope.json", verified.envelopeBytes],
      ["rulepack.json", verified.rulepackBytes],
      ["standards.json", verified.standardsBytes],
    ]);
    return {
      manifest_sha256: verified.manifestSha256,
      envelope_sha256: sha256(verified.envelopeBytes),
      package_was_present: packageWasPresent,
      files: PACKAGE_FILES.map((name) => ({
        path: name,
        size_bytes: outputs.get(name).length,
        sha256: sha256(outputs.get(name)),
      })),
    };
  }

  _readPendingTransaction() {
    this._ensureStore();
    const directoryInfo = lstatOrNull(this.fs, this.pendingTransactionDir);
    if (!directoryInfo) return null;
    const directory = assertSafeDirectory(
      this.fs,
      this.pendingTransactionDir,
      "pending transaction 目录",
    );
    const root = assertSafeDirectory(this.fs, this.rootDir, "standards store 根目录");
    if (path.dirname(directory.real) !== root.real) {
      fail("INVALID_TRANSACTION", "pending transaction 目录逃逸 store 根目录");
    }
    const names = this.fs.readdirSync(this.pendingTransactionDir).sort(compareText);
    if (names.length !== 1 || names[0] !== TRANSACTION_FILE) {
      fail("INVALID_TRANSACTION", "pending transaction 文件集合不精确");
    }
    const bytes = readSafeFile(
      this.fs,
      this.pendingTransactionPath,
      this.limits.stateBytes,
      "pending transaction intent",
    );
    const intent = validateTransactionIntent(parseCanonicalJson(
      bytes,
      "pending transaction intent",
      this.limits.stateBytes,
    ));
    const after = assertSafeDirectory(
      this.fs,
      this.pendingTransactionDir,
      "pending transaction 目录",
    );
    if (!sameObject(directory.identity, after.identity, { includeSize: false })) {
      fail("PATH_CHANGED", "pending transaction 目录在读取期间发生变化");
    }
    return { intent, identity: directory.identity };
  }

  _beginTransaction({ operation, expectedState, nextState, verified, packageWasPresent }) {
    this._ensureStore();
    if (lstatOrNull(this.fs, this.pendingTransactionDir)) {
      fail("STORE_BUSY", "standards store 已有进行中的事务");
    }
    const intent = validateTransactionIntent({
      schema_version: TRANSACTION_SCHEMA_VERSION,
      kind: TRANSACTION_KIND,
      transaction_id: crypto.randomBytes(32).toString("hex"),
      operation,
      owner: {
        pid: process.pid,
        process_start_token: PROCESS_START_TOKEN,
      },
      expected_state: expectedState,
      expected_state_sha256: stateDigest(expectedState),
      next_state: nextState,
      next_state_sha256: stateDigest(nextState),
      target: this._transactionTarget(verified, packageWasPresent),
    });
    const candidate = this.fs.mkdtempSync(path.join(this.rootDir, ".pending-transaction-"));
    const candidateInfo = assertSafeDirectory(this.fs, candidate, "pending transaction 候选目录");
    let committed = false;
    try {
      writeExclusiveFile(
        this.fs,
        path.join(candidate, TRANSACTION_FILE),
        Buffer.from(canonicalJson(intent), "utf8"),
        { expectedParent: { path: candidate, identity: candidateInfo.identity } },
      );
      fsyncDirectoryBestEffort(this.fs, candidate);
      if (lstatOrNull(this.fs, this.pendingTransactionDir)) {
        fail("STORE_BUSY", "standards store 已有进行中的事务");
      }
      try {
        this.fs.renameSync(candidate, this.pendingTransactionDir);
      } catch (error) {
        if (lstatOrNull(this.fs, this.pendingTransactionDir)) {
          fail("STORE_BUSY", "standards store 被另一进程锁定", { cause: error.message });
        }
        throw error;
      }
      committed = true;
      fsyncDirectoryBestEffort(this.fs, this.rootDir);
      const persisted = this._readPendingTransaction();
      if (persisted.intent.transaction_id !== intent.transaction_id ||
          canonicalJson(persisted.intent) !== canonicalJson(intent)) {
        fail("INVALID_TRANSACTION", "pending transaction 提交后内容不一致");
      }
      return intent;
    } finally {
      if (!committed) safeCleanupTransactionDirectory(this.fs, candidate, candidateInfo.identity);
    }
  }

  _completeTransaction(intent) {
    const pending = this._readPendingTransaction();
    if (pending === null || pending.intent.transaction_id !== intent.transaction_id) {
      fail("INVALID_TRANSACTION", "pending transaction 身份在完成前发生变化");
    }
    const completed = path.join(this.rootDir, `.completed-transaction-${intent.transaction_id}`);
    if (lstatOrNull(this.fs, completed)) {
      fail("INVALID_TRANSACTION", "transaction 完成隔离目录已存在");
    }
    this.fs.renameSync(this.pendingTransactionDir, completed);
    fsyncDirectoryBestEffort(this.fs, this.rootDir);
    safeCleanupTransactionDirectory(this.fs, completed, pending.identity);
  }

  _assertTransactionOwnerRecoverable(intent) {
    const owner = intent.owner;
    if (owner.pid === process.pid) {
      if (owner.process_start_token !== PROCESS_START_TOKEN) {
        fail("STORE_BUSY", "pending transaction PID 已复用，无法安全判断原 owner 状态");
      }
      return;
    }
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      fail("STORE_BUSY", "无法证明 pending transaction owner 已退出", {
        owner_pid: owner.pid,
        cause: error?.code || error?.message,
      });
    }
    fail("STORE_BUSY", "standards store 正由另一进程更新", { owner_pid: owner.pid });
  }

  _cleanupTransactionTarget(intent) {
    if (intent.target.package_was_present) return;
    const target = this._packagePath(intent.target.manifest_sha256);
    const info = lstatOrNull(this.fs, target);
    if (!info) return;
    const directory = assertSafeDirectory(this.fs, target, "pending transaction CAS target");
    const names = this.fs.readdirSync(target).sort(compareText);
    if (names.some((name) => !PACKAGE_FILES.includes(name))) {
      fail("TRANSACTION_RECOVERY_FAILED", "pending transaction CAS target 含未知文件");
    }
    const expected = new Map(intent.target.files.map((entry) => [entry.path, entry]));
    const fileIdentities = new Map();
    for (const name of names) {
      const descriptor = expected.get(name);
      const before = lstatOrNull(this.fs, path.join(target, name));
      if (!before || before.isSymbolicLink() || !before.isFile() || BigInt(before.nlink) !== 1n) {
        fail("TRANSACTION_RECOVERY_FAILED", `pending transaction CAS ${name} 不是安全普通文件`);
      }
      const maximum = name === "release.envelope.json"
        ? this.limits.envelopeBytes
        : (name === "manifest.json" ? this.limits.manifestBytes : this.limits.fileBytes);
      const bytes = readSafeFile(this.fs, path.join(target, name), maximum, `transaction ${name}`);
      if (bytes.length !== descriptor.size_bytes || sha256(bytes) !== descriptor.sha256) {
        fail("TRANSACTION_RECOVERY_FAILED", `pending transaction CAS ${name} 与 intent 不一致`);
      }
      const afterFile = lstatOrNull(this.fs, path.join(target, name));
      if (!afterFile || !sameObject(statIdentity(before), statIdentity(afterFile))) {
        fail("TRANSACTION_RECOVERY_FAILED", `pending transaction CAS ${name} 身份发生变化`);
      }
      fileIdentities.set(name, statIdentity(afterFile));
    }
    const after = assertSafeDirectory(this.fs, target, "pending transaction CAS target");
    if (!sameObject(directory.identity, after.identity, { includeSize: false })) {
      fail("TRANSACTION_RECOVERY_FAILED", "pending transaction CAS target 身份发生变化");
    }
    for (const name of names) {
      const currentDirectory = assertSafeDirectory(this.fs, target, "pending transaction CAS target");
      const currentFile = lstatOrNull(this.fs, path.join(target, name));
      if (!sameObject(directory.identity, currentDirectory.identity, { includeSize: false }) ||
          !currentFile || currentFile.isSymbolicLink() || !currentFile.isFile() ||
          BigInt(currentFile.nlink) !== 1n ||
          !sameObject(fileIdentities.get(name), statIdentity(currentFile))) {
        fail("TRANSACTION_RECOVERY_FAILED", `pending transaction CAS ${name} 在清理前发生变化`);
      }
      this.fs.unlinkSync(path.join(target, name));
    }
    this.fs.rmdirSync(target);
    fsyncDirectoryBestEffort(this.fs, this.packagesDir);
  }

  async _recoverPendingTransaction() {
    const pending = this._readPendingTransaction();
    if (pending === null) return;
    const { intent } = pending;
    this._assertTransactionOwnerRecoverable(intent);
    const current = this._readState({ required: false });
    const currentDigest = stateDigest(current);
    if (currentDigest === intent.next_state_sha256) {
      if (canonicalJson(current) !== canonicalJson(intent.next_state)) {
        fail("TRANSACTION_RECOVERY_FAILED", "active state 摘要碰撞或 transaction 状态不一致");
      }
      this._completeTransaction(intent);
      return;
    }
    if (currentDigest === intent.expected_state_sha256) {
      if (canonicalJson(current) !== canonicalJson(intent.expected_state)) {
        fail("TRANSACTION_RECOVERY_FAILED", "expected active state 与 transaction 不一致");
      }
      this._cleanupTransactionTarget(intent);
      this._completeTransaction(intent);
      return;
    }
    fail("TRANSACTION_RECOVERY_FAILED", "active state 不匹配 pending transaction 的前态或后态");
  }

  _decodePayloads(envelope, manifest, label = "envelope") {
    const payloads = new Map();
    let totalPayloadBytes = 0;
    for (let index = 0; index < envelope.files.length; index += 1) {
      const item = envelope.files[index];
      exactKeys(item, ["path", "payload_b64"], `${label}.files[${index}]`);
      const expectedPath = PAYLOAD_PATHS[index];
      if (item.path !== expectedPath) {
        fail("UNSAFE_PATH", `${label}.files[${index}].path 必须是 ${expectedPath}`);
      }
      const bytes = strictBase64(item.payload_b64, `${label}.files[${index}].payload_b64`);
      const descriptor = manifest.files[index];
      totalPayloadBytes += bytes.length;
      if (bytes.length !== descriptor.size_bytes) {
        fail("SIZE_MISMATCH", `${expectedPath} 大小与 manifest 不一致`);
      }
      if (sha256(bytes) !== descriptor.sha256) {
        fail("HASH_MISMATCH", `${expectedPath} SHA-256 与 manifest 不一致`);
      }
      payloads.set(expectedPath, bytes);
    }
    if (totalPayloadBytes > this.limits.totalPayloadBytes) {
      fail("SIZE_LIMIT", `${label} payload 总大小超限`);
    }
    return payloads;
  }

  async _validateVerifiedPayload(result, runPayloadValidation) {
    if (!runPayloadValidation) return;
    const validation = await this.validatePayload({
      manifest: result.manifest,
      manifestBytes: Buffer.from(result.manifestBytes),
      manifestSha256: result.manifestSha256,
      standardsBytes: Buffer.from(result.standardsBytes),
      rulepackBytes: Buffer.from(result.rulepackBytes),
      capabilitySetSha256: result.manifest.rulepack.capability_set_sha256,
    });
    if (validation === false || (isPlainObject(validation) && validation.ok === false)) {
      fail("PAYLOAD_VALIDATION_FAILED", "validatePayload 拒绝标准包 payload");
    }
  }

  async verifyEnvelope(envelopeBytes, {
    enforceCompatibility = true,
    enforceExpiry = true,
    runPayloadValidation = true,
  } = {}) {
    if (this.trust === null) {
      fail("TRUST_ROOT_UNCONFIGURED", "尚未配置标准更新 release 签名信任根");
    }
    const raw = Buffer.isBuffer(envelopeBytes) ? envelopeBytes : Buffer.from(envelopeBytes);
    if (raw.length === 0 || raw.length > this.limits.envelopeBytes) {
      fail("SIZE_LIMIT", "release envelope 大小非法", {
        size: raw.length,
        maxBytes: this.limits.envelopeBytes,
      });
    }
    const envelope = parseJson(raw, "release envelope");
    validateEnvelopeShape(envelope);
    const manifestBytes = strictBase64(envelope.manifest_b64, "envelope.manifest_b64");
    const manifest = parseCanonicalJson(
      manifestBytes,
      "signed manifest",
      this.limits.manifestBytes,
    );
    validateManifest(manifest, {
      appVersion: this.appVersion,
      nowMs: this._nowMs(),
      enforceCompatibility,
      enforceExpiry,
      signingRole: "release",
      limits: this.limits,
    });

    const seenSignatures = new Set();
    let validSignatures = 0;
    for (let index = 0; index < envelope.signatures.length; index += 1) {
      const signature = envelope.signatures[index];
      exactKeys(signature, ["keyid", "alg", "sig_b64"], `envelope.signatures[${index}]`);
      assertString(signature.keyid, `envelope.signatures[${index}].keyid`, {
        pattern: SHA256_RE,
        max: 64,
      });
      if (signature.alg !== "ed25519") fail("INVALID_SIGNATURE", "签名算法必须是 ed25519");
      if (seenSignatures.has(signature.keyid)) fail("INVALID_SIGNATURE", "同一 keyid 重复签名");
      seenSignatures.add(signature.keyid);
      if (!this.trust.roles.release.keyids.includes(signature.keyid) ||
          !this.trust.keys.has(signature.keyid)) {
        fail("UNKNOWN_SIGNING_KEY", `release envelope 使用未知 keyid：${signature.keyid}`);
      }
      const bytes = strictBase64(signature.sig_b64, `envelope.signatures[${index}].sig_b64`);
      if (bytes.length !== 64 ||
          !crypto.verify(null, manifestBytes, this.trust.keys.get(signature.keyid), bytes)) {
        fail("INVALID_SIGNATURE", `keyid ${signature.keyid} 的签名无效`);
      }
      validSignatures += 1;
    }
    if (validSignatures < this.trust.roles.release.threshold) {
      fail("SIGNATURE_THRESHOLD", "release envelope 未达到 release role 签名阈值", {
        valid: validSignatures,
        threshold: this.trust.roles.release.threshold,
      });
    }

    const payloads = this._decodePayloads(envelope, manifest);
    const manifestSha256 = sha256(manifestBytes);
    const result = {
      envelope,
      envelopeBytes: raw,
      manifest,
      manifestBytes,
      manifestSha256,
      standardsBytes: payloads.get("standards.json"),
      rulepackBytes: payloads.get("rulepack.json"),
    };
    await this._validateVerifiedPayload(result, runPayloadValidation);
    return result;
  }

  async verifyRevocationEnvelope(envelopeBytes, { bundleId } = {}) {
    if (this.trust === null || this.trust.roles.revocation === null) {
      fail("REVOCATION_TRUST_UNCONFIGURED", "尚未配置标准撤回签名信任角色");
    }
    assertString(bundleId, "revocation expected bundleId", { pattern: SAFE_ID_RE, max: 128 });
    const raw = Buffer.isBuffer(envelopeBytes) ? envelopeBytes : Buffer.from(envelopeBytes);
    if (raw.length === 0 || raw.length > this.limits.revocationEnvelopeBytes) {
      fail("SIZE_LIMIT", "revocation envelope 大小非法", {
        size: raw.length,
        maxBytes: this.limits.revocationEnvelopeBytes,
      });
    }
    const envelope = parseCanonicalJson(
      raw,
      "revocation envelope",
      this.limits.revocationEnvelopeBytes,
    );
    validateRevocationEnvelopeShape(envelope);
    const payloadBytes = strictBase64(envelope.payload_b64, "revocation envelope.payload_b64");
    const payload = validateRevocationList(parseCanonicalJson(
      payloadBytes,
      "signed revocation list",
      this.limits.revocationPayloadBytes,
    ), {
      expectedBundleId: bundleId,
      nowMs: this._nowMs(),
    });
    const role = this.trust.roles.revocation;
    const seenSignatures = new Set();
    let validSignatures = 0;
    for (let index = 0; index < envelope.signatures.length; index += 1) {
      const signature = envelope.signatures[index];
      exactKeys(signature, ["keyid", "alg", "sig_b64"],
        `revocation envelope.signatures[${index}]`);
      assertString(signature.keyid, `revocation envelope.signatures[${index}].keyid`, {
        pattern: SHA256_RE,
        max: 64,
      });
      if (signature.alg !== "ed25519") fail("INVALID_SIGNATURE", "撤回签名算法必须是 ed25519");
      if (seenSignatures.has(signature.keyid)) fail("INVALID_SIGNATURE", "撤回清单含重复 keyid");
      seenSignatures.add(signature.keyid);
      if (!role.keyids.includes(signature.keyid) || !this.trust.keys.has(signature.keyid)) {
        fail("UNKNOWN_SIGNING_KEY", `revocation envelope 使用未知 keyid：${signature.keyid}`);
      }
      const bytes = strictBase64(
        signature.sig_b64,
        `revocation envelope.signatures[${index}].sig_b64`,
      );
      if (bytes.length !== 64 ||
          !crypto.verify(null, payloadBytes, this.trust.keys.get(signature.keyid), bytes)) {
        fail("INVALID_SIGNATURE", `revocation keyid ${signature.keyid} 的签名无效`);
      }
      validSignatures += 1;
    }
    if (validSignatures < role.threshold) {
      fail("SIGNATURE_THRESHOLD", "revocation envelope 未达到 revocation role 签名阈值", {
        valid: validSignatures,
        threshold: role.threshold,
      });
    }
    return {
      envelope,
      envelopeBytes: raw,
      payload,
      payloadBytes,
      payloadSha256: sha256(payloadBytes),
    };
  }

  async verifyBundledEnvelope(envelopeBytes, {
    enforceCompatibility = true,
    runPayloadValidation = true,
  } = {}) {
    if (this.bundledManifestSha256s.size === 0) {
      fail("BUNDLED_TRUST_MISSING", "未注入 APP 内置 bundled manifest SHA-256 信任锚");
    }
    const raw = Buffer.isBuffer(envelopeBytes) ? envelopeBytes : Buffer.from(envelopeBytes);
    if (raw.length === 0 || raw.length > this.limits.envelopeBytes) {
      fail("SIZE_LIMIT", "bundled envelope 大小非法");
    }
    const envelope = parseCanonicalJson(raw, "bundled envelope", this.limits.envelopeBytes);
    validateBundledEnvelopeShape(envelope);
    const manifestBytes = strictBase64(envelope.manifest_b64, "bundled envelope.manifest_b64");
    const manifest = parseCanonicalJson(
      manifestBytes,
      "bundled manifest",
      this.limits.manifestBytes,
    );
    const manifestSha256 = sha256(manifestBytes);
    if (!this.bundledManifestSha256s.has(manifestSha256)) {
      fail("BUNDLED_TRUST_MISMATCH", "bundled manifest 与 APP 内置信任锚不一致");
    }
    validateManifest(manifest, {
      appVersion: this.appVersion,
      nowMs: this._nowMs(),
      enforceCompatibility,
      enforceExpiry: false,
      signingRole: "bundled",
      limits: this.limits,
    });
    const payloads = this._decodePayloads(envelope, manifest, "bundled envelope");
    const result = {
      envelope,
      envelopeBytes: raw,
      manifest,
      manifestBytes,
      manifestSha256,
      standardsBytes: payloads.get("standards.json"),
      rulepackBytes: payloads.get("rulepack.json"),
    };
    await this._validateVerifiedPayload(result, runPayloadValidation);
    return result;
  }

  async _verifyStoredEnvelope(envelopeBytes, options = {}) {
    const raw = Buffer.isBuffer(envelopeBytes) ? envelopeBytes : Buffer.from(envelopeBytes);
    if (raw.length === 0 || raw.length > this.limits.envelopeBytes) {
      fail("SIZE_LIMIT", "stored envelope 大小非法");
    }
    const envelope = parseJson(raw, "stored envelope");
    if (envelope.kind === BUNDLED_ENVELOPE_KIND) {
      return this.verifyBundledEnvelope(raw, {
        enforceCompatibility: options.enforceCompatibility,
        runPayloadValidation: options.runPayloadValidation,
      });
    }
    return this.verifyEnvelope(raw, options);
  }

  _packagePath(digest) {
    if (!SHA256_RE.test(digest)) fail("INVALID_ARGUMENT", "manifest digest 非法");
    const target = path.join(this.packagesDir, digest);
    if (path.dirname(target) !== this.packagesDir) fail("UNSAFE_PATH", "package path 逃逸");
    return target;
  }

  _readState({ required = true } = {}) {
    this._ensureStore();
    const info = lstatOrNull(this.fs, this.statePath);
    if (!info) {
      if (required) fail("STATE_MISSING", "active.json 尚未初始化");
      return null;
    }
    const bytes = readSafeFile(this.fs, this.statePath, this.limits.stateBytes, "active.json");
    return validateState(parseCanonicalJson(bytes, "active.json", this.limits.stateBytes));
  }

  getState() {
    return this._readState({ required: false });
  }

  _atomicWriteState(state, { expectedState = undefined } = {}) {
    validateState(state);
    this._ensureStore();
    const rootBefore = assertSafeDirectory(this.fs, this.rootDir, "standards store 根目录");
    const previous = lstatOrNull(this.fs, this.statePath);
    if (previous && (previous.isSymbolicLink() || !previous.isFile() || BigInt(previous.nlink) !== 1n)) {
      fail("UNSAFE_PATH", "active.json 目标不是单链接普通文件");
    }
    if (expectedState !== undefined) {
      const currentState = previous
        ? validateState(parseCanonicalJson(
          readSafeFile(this.fs, this.statePath, this.limits.stateBytes, "active.json"),
          "active.json",
          this.limits.stateBytes,
        ))
        : null;
      const expectedText = expectedState === null ? null : canonicalJson(expectedState);
      const currentText = currentState === null ? null : canonicalJson(currentState);
      if (currentText !== expectedText) {
        fail("STATE_CHANGED", "active.json 在本次操作期间被另一事务更新");
      }
    }
    const token = crypto.randomBytes(16).toString("hex");
    const staged = path.join(this.rootDir, `.active.json.${process.pid}.${token}.tmp`);
    const bytes = Buffer.from(canonicalJson(state), "utf8");
    let stagedIdentity = null;
    try {
      writeExclusiveFile(this.fs, staged, bytes, {
        expectedParent: { path: this.rootDir, identity: rootBefore.identity },
      });
      const stagedInfo = lstatOrNull(this.fs, staged);
      if (!stagedInfo) fail("ATOMIC_WRITE_FAILED", "active state 候选写入后缺失");
      stagedIdentity = statIdentity(stagedInfo);
      const rootAfterWrite = assertSafeDirectory(this.fs, this.rootDir, "standards store 根目录");
      if (!sameObject(rootBefore.identity, rootAfterWrite.identity, { includeSize: false })) {
        fail("PATH_CHANGED", "standards store 根目录在写入期间发生变化");
      }
      const current = lstatOrNull(this.fs, this.statePath);
      if ((previous === null) !== (current === null) ||
          (previous && !sameObject(statIdentity(previous), statIdentity(current)))) {
        fail("PATH_CHANGED", "active.json 在提交前发生变化");
      }
      this.fs.renameSync(staged, this.statePath);
      stagedIdentity = null;
      fsyncDirectoryBestEffort(this.fs, this.rootDir);
      const committed = this._readState({ required: true });
      if (canonicalJson(committed) !== canonicalJson(state)) {
        fail("ATOMIC_WRITE_FAILED", "active.json 提交后内容不一致");
      }
    } finally {
      if (stagedIdentity !== null) {
        try {
          const current = lstatOrNull(this.fs, staged);
          if (current && !current.isSymbolicLink() && current.isFile() &&
              BigInt(current.nlink) === 1n &&
              sameObject(stagedIdentity, statIdentity(current))) this.fs.unlinkSync(staged);
        } catch {
          // Identity uncertainty: leave the candidate, never unlink another file.
        }
      }
    }
  }

  async _verifyPackageDirectory(digest, {
    enforceCompatibility = true,
    enforceExpiry = false,
    runPayloadValidation = true,
  } = {}) {
    const directory = this._packagePath(digest);
    const before = assertSafeDirectory(this.fs, directory, `CAS package ${digest}`);
    const names = this.fs.readdirSync(directory).sort(compareText);
    if (names.length !== PACKAGE_FILES.length ||
        names.some((name, index) => name !== PACKAGE_FILES[index])) {
      fail("PACKAGE_INVENTORY", `CAS package ${digest} 文件集合不精确`, {
        expected: PACKAGE_FILES,
        actual: names,
      });
    }
    const envelopeBytes = readSafeFile(
      this.fs,
      path.join(directory, "release.envelope.json"),
      this.limits.envelopeBytes,
      "release.envelope.json",
    );
    const verified = await this._verifyStoredEnvelope(envelopeBytes, {
      enforceCompatibility,
      enforceExpiry,
      runPayloadValidation,
    });
    if (verified.manifestSha256 !== digest) {
      fail("HASH_MISMATCH", "CAS 目录名与 manifest SHA-256 不一致");
    }
    const manifestBytes = readSafeFile(
      this.fs,
      path.join(directory, "manifest.json"),
      this.limits.manifestBytes,
      "manifest.json",
    );
    const standardsBytes = readSafeFile(
      this.fs,
      path.join(directory, "standards.json"),
      this.limits.fileBytes,
      "standards.json",
    );
    const rulepackBytes = readSafeFile(
      this.fs,
      path.join(directory, "rulepack.json"),
      this.limits.fileBytes,
      "rulepack.json",
    );
    if (!manifestBytes.equals(verified.manifestBytes) ||
        !standardsBytes.equals(verified.standardsBytes) ||
        !rulepackBytes.equals(verified.rulepackBytes)) {
      fail("HASH_MISMATCH", "CAS package 文件与已验签 envelope 不一致");
    }
    const after = assertSafeDirectory(this.fs, directory, `CAS package ${digest}`);
    if (!sameObject(before.identity, after.identity, { includeSize: false })) {
      fail("PATH_CHANGED", `CAS package ${digest} 在验证期间发生变化`);
    }
    return verified;
  }

  async verifyInstalled(digest, options = {}) {
    return this._runSerialized(async () => {
      this._ensureStore();
      return this._verifyPackageDirectory(digest, options);
    });
  }

  async _verifyDescriptor(descriptor, {
    enforceExpiry = false,
    enforceCompatibility = true,
  } = {}) {
    validateDescriptor(descriptor, "package descriptor");
    const verified = await this._verifyPackageDirectory(descriptor.manifest_sha256, {
      enforceCompatibility,
      enforceExpiry,
      runPayloadValidation: true,
    });
    const actualSource = verified.envelope.kind === BUNDLED_ENVELOPE_KIND
      ? "bundled"
      : "installed";
    const actual = descriptorFor(verified.manifest, verified.manifestSha256, actualSource);
    if (descriptorIdentity(actual) !== descriptorIdentity(descriptor)) {
      fail("INVALID_STATE", "package descriptor 与 CAS 中的签名 manifest 不一致");
    }
    return verified;
  }

  _descriptorForVerified(verified) {
    const source = verified.envelope.kind === BUNDLED_ENVELOPE_KIND ? "bundled" : "installed";
    return descriptorFor(verified.manifest, verified.manifestSha256, source);
  }

  async _resolveRollbackTarget(manifest, state, {
    required = true,
    allowUnavailable = false,
    allowRevoked = false,
  } = {}) {
    const target = manifest.rollback_target;
    if (target === null) {
      if (required) fail("ROLLBACK_TARGET_REQUIRED", "非初始标准包必须签署 rollback_target");
      return null;
    }
    if (!lstatOrNull(this.fs, this._packagePath(target.manifest_sha256))) {
      fail("ROLLBACK_TARGET_MISSING", "rollback_target 尚未安装到已验证 CAS", {
        manifest_sha256: target.manifest_sha256,
        release_sequence: target.release_sequence,
      });
    }
    const verified = await this._verifyPackageDirectory(target.manifest_sha256, {
      enforceCompatibility: !allowUnavailable,
      enforceExpiry: false,
      runPayloadValidation: true,
    });
    if (allowUnavailable &&
        parseUtc(verified.manifest.released_at, "manifest.released_at") > this._nowMs()) {
      fail("NOT_YET_VALID", `rollback_target 尚未到发布时间 ${verified.manifest.released_at}`);
    }
    if (verified.manifestSha256 !== target.manifest_sha256 ||
        verified.manifest.release_sequence !== target.release_sequence) {
      fail("ROLLBACK_TARGET_MISMATCH", "rollback_target digest/sequence 与 CAS manifest 不一致");
    }
    if (verified.manifest.bundle_id !== manifest.bundle_id) {
      fail("BUNDLE_ID_MISMATCH", "rollback_target bundle_id 与更新包不一致");
    }
    if (state.revoked_manifest_sha256s.includes(target.manifest_sha256) &&
        !(allowRevoked && target.manifest_sha256 === state.active.manifest_sha256)) {
      fail("REVOKED_PACKAGE", "rollback_target 已撤回");
    }
    return { verified, descriptor: this._descriptorForVerified(verified) };
  }

  async _verifyGlobalState({ allowMigrationSource = false } = {}) {
    const state = this._readState({ required: true });
    if (!allowMigrationSource &&
        state.revoked_manifest_sha256s.includes(state.active.manifest_sha256)) {
      fail("REVOKED_PACKAGE", "当前 active package 已撤回");
    }
    const activeVerified = await this._verifyDescriptor(state.active, {
      enforceExpiry: !allowMigrationSource,
      enforceCompatibility: !allowMigrationSource,
    });
    if (allowMigrationSource &&
        parseUtc(activeVerified.manifest.released_at, "manifest.released_at") > this._nowMs()) {
      fail("NOT_YET_VALID", `当前 active manifest 尚未到发布时间 ${activeVerified.manifest.released_at}`);
    }
    const target = activeVerified.manifest.rollback_target;
    if (target === null) {
      if (state.previous !== null) {
        fail("ROLLBACK_TARGET_MISMATCH", "active manifest 禁止回滚但 state.previous 非空");
      }
    } else if (state.previous === null) {
      const targetPresent = lstatOrNull(this.fs, this._packagePath(target.manifest_sha256)) !== null;
      const initialBundledWithoutHistory = state.active.source === "bundled" && !targetPresent;
      if (!initialBundledWithoutHistory) {
        fail("ROLLBACK_TARGET_MISMATCH", "active manifest rollback_target 未绑定 state.previous");
      }
    } else {
      if (state.previous.manifest_sha256 !== target.manifest_sha256 ||
          state.previous.release_sequence !== target.release_sequence) {
        fail("ROLLBACK_TARGET_MISMATCH", "state.previous 与 active manifest rollback_target 不一致");
      }
      const previousVerified = await this._verifyDescriptor(state.previous, {
        enforceExpiry: false,
        enforceCompatibility: false,
      });
      if (previousVerified.manifest.bundle_id !== activeVerified.manifest.bundle_id) {
        fail("BUNDLE_ID_MISMATCH", "previous package bundle_id 与 active 不一致");
      }
    }
    await this._assertHighWaterCoversStore(state);
    return { state, verified: activeVerified };
  }

  async _allInstalledPackages() {
    this._ensureStore();
    const entries = this.fs.readdirSync(this.packagesDir, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    const results = [];
    for (const entry of entries) {
      if (!SHA256_RE.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) {
        fail("PACKAGE_INVENTORY", `packages/ 含非法目录项：${entry.name}`);
      }
      const verified = await this._verifyPackageDirectory(entry.name, {
        enforceCompatibility: false,
        enforceExpiry: false,
        runPayloadValidation: true,
      });
      results.push(verified);
    }
    return results;
  }

  async _rejectDuplicateIdentity(incoming) {
    for (const installed of await this._allInstalledPackages()) {
      if (installed.manifestSha256 === incoming.manifestSha256) continue;
      if (installed.manifest.bundle_id !== incoming.manifest.bundle_id) continue;
      if (installed.manifest.version === incoming.manifest.version) {
        fail("DUPLICATE_VERSION", "相同 bundle/version 已安装为不同签名字节", {
          version: incoming.manifest.version,
          existing: installed.manifestSha256,
          incoming: incoming.manifestSha256,
        });
      }
      if (installed.manifest.release_sequence === incoming.manifest.release_sequence) {
        fail("DUPLICATE_SEQUENCE", "相同 release_sequence 已安装为不同签名字节", {
          release_sequence: incoming.manifest.release_sequence,
        });
      }
    }
  }

  async _assertHighWaterCoversStore(state) {
    let maximum = state.active.release_sequence;
    const sequences = new Map();
    const versions = new Map();
    for (const installed of await this._allInstalledPackages()) {
      if (installed.manifest.bundle_id !== state.active.bundle_id) {
        fail("INVALID_STATE", "packages/ 含不同 bundle_id 的未知 CAS package", {
          expected_bundle_id: state.active.bundle_id,
          actual_bundle_id: installed.manifest.bundle_id,
          manifest_sha256: installed.manifestSha256,
        });
      }
      const sequenceDigest = sequences.get(installed.manifest.release_sequence);
      const versionDigest = versions.get(installed.manifest.version);
      if ((sequenceDigest && sequenceDigest !== installed.manifestSha256) ||
          (versionDigest && versionDigest !== installed.manifestSha256)) {
        fail("INVALID_STATE", "packages/ 含重复 sequence 或 version 的不同 CAS package");
      }
      sequences.set(installed.manifest.release_sequence, installed.manifestSha256);
      versions.set(installed.manifest.version, installed.manifestSha256);
      maximum = Math.max(maximum, installed.manifest.release_sequence);
    }
    if (state.highest_seen_sequence !== maximum) {
      fail("INVALID_STATE", "active.json high-water 与已验证 CAS 的最高 release_sequence 不一致", {
        highest_seen_sequence: state.highest_seen_sequence,
        installed_maximum: maximum,
      });
    }
  }

  async _materialize(verified) {
    this._ensureStore();
    const destination = this._packagePath(verified.manifestSha256);
    if (lstatOrNull(this.fs, destination)) {
      const existing = await this._verifyPackageDirectory(verified.manifestSha256, {
        enforceCompatibility: true,
        enforceExpiry: false,
        runPayloadValidation: true,
      });
      if (!existing.envelopeBytes.equals(verified.envelopeBytes)) {
        fail("CAS_COLLISION", "同一 manifest digest 的 envelope 字节不同");
      }
      return destination;
    }

    const candidate = this.fs.mkdtempSync(path.join(this.incomingDir, ".package-"));
    const candidateInfo = assertSafeDirectory(this.fs, candidate, "标准包候选目录");
    const packagesInfo = assertSafeDirectory(this.fs, this.packagesDir, "packages 目录");
    if (String(candidateInfo.info.dev) !== String(packagesInfo.info.dev)) {
      fail("CROSS_DEVICE_INSTALL", "标准包候选与 CAS packages 不在同一文件系统");
    }
    let committed = false;
    try {
      const outputs = new Map([
        ["manifest.json", verified.manifestBytes],
        ["standards.json", verified.standardsBytes],
        ["rulepack.json", verified.rulepackBytes],
        ["release.envelope.json", verified.envelopeBytes],
      ]);
      for (const name of PACKAGE_FILES) {
        writeExclusiveFile(this.fs, path.join(candidate, name), outputs.get(name), {
          expectedParent: { path: candidate, identity: candidateInfo.identity },
        });
      }
      fsyncDirectoryBestEffort(this.fs, candidate);

      // Re-verify the staged bytes and the injected schema/capability policy
      // before the only rename that can make them addressable from packages/.
      const stagedEnvelope = readSafeFile(
        this.fs,
        path.join(candidate, "release.envelope.json"),
        this.limits.envelopeBytes,
        "候选 release.envelope.json",
      );
      const stagedVerified = await this._verifyStoredEnvelope(stagedEnvelope, {
        enforceCompatibility: true,
        enforceExpiry: true,
        runPayloadValidation: true,
      });
      const candidateNames = this.fs.readdirSync(candidate).sort(compareText);
      if (candidateNames.some((name, index) => name !== PACKAGE_FILES[index]) ||
          candidateNames.length !== PACKAGE_FILES.length ||
          stagedVerified.manifestSha256 !== verified.manifestSha256 ||
          !readSafeFile(this.fs, path.join(candidate, "manifest.json"),
            this.limits.manifestBytes, "候选 manifest.json").equals(stagedVerified.manifestBytes) ||
          !readSafeFile(this.fs, path.join(candidate, "standards.json"),
            this.limits.fileBytes, "候选 standards.json").equals(stagedVerified.standardsBytes) ||
          !readSafeFile(this.fs, path.join(candidate, "rulepack.json"),
            this.limits.fileBytes, "候选 rulepack.json").equals(stagedVerified.rulepackBytes)) {
        fail("PACKAGE_INVENTORY", "标准包候选目录在提交前不一致");
      }
      if (lstatOrNull(this.fs, destination)) fail("INSTALL_RACE", "CAS 目标在提交前被占用");
      const candidateBeforeRename = assertSafeDirectory(this.fs, candidate, "标准包候选目录");
      const packagesBeforeRename = assertSafeDirectory(this.fs, this.packagesDir, "packages 目录");
      if (!sameObject(candidateInfo.identity, candidateBeforeRename.identity, { includeSize: false }) ||
          !sameObject(packagesInfo.identity, packagesBeforeRename.identity, { includeSize: false })) {
        fail("PATH_CHANGED", "候选或 packages 目录在提交前发生变化");
      }
      this.fs.renameSync(candidate, destination);
      committed = true;
      fsyncDirectoryBestEffort(this.fs, this.packagesDir);

      // Post-install verification is intentionally independent of the staged
      // result. active.json is still untouched if this check fails.
      try {
        await this._verifyPackageDirectory(verified.manifestSha256, {
          enforceCompatibility: true,
          enforceExpiry: true,
          runPayloadValidation: true,
        });
      } catch (error) {
        safeCleanupCandidate(this.fs, destination, candidateInfo.identity);
        fsyncDirectoryBestEffort(this.fs, this.packagesDir);
        throw error;
      }
      return destination;
    } finally {
      if (!committed) safeCleanupCandidate(this.fs, candidate, candidateInfo.identity);
    }
  }

  async _readBundledFiles({ manifestPath, standardsPath, rulepackPath }) {
    this._ensureStore();
    const paths = { manifestPath, standardsPath, rulepackPath };
    for (const [name, target] of Object.entries(paths)) {
      if (typeof target !== "string" || !path.isAbsolute(target)) {
        fail("INVALID_ARGUMENT", `${name} 必须是绝对路径`);
      }
      assertSafeDirectory(this.fs, path.dirname(target), `${name} 父目录`);
    }
    const manifestBytes = readSafeFile(
      this.fs,
      manifestPath,
      this.limits.manifestBytes,
      "APP 内置 standards manifest",
    );
    const standardsBytes = readSafeFile(
      this.fs,
      standardsPath,
      this.limits.fileBytes,
      "APP 内置 standards.json",
    );
    const rulepackBytes = readSafeFile(
      this.fs,
      rulepackPath,
      this.limits.fileBytes,
      "APP 内置 rulepack.json",
    );
    const bundledEnvelope = {
      schema_version: ENVELOPE_SCHEMA_VERSION,
      kind: BUNDLED_ENVELOPE_KIND,
      manifest_b64: manifestBytes.toString("base64"),
      files: [
        { path: "standards.json", payload_b64: standardsBytes.toString("base64") },
        { path: "rulepack.json", payload_b64: rulepackBytes.toString("base64") },
      ],
    };
    const envelopeBytes = Buffer.from(canonicalJson(bundledEnvelope), "utf8");
    const verified = await this.verifyBundledEnvelope(envelopeBytes, {
      enforceCompatibility: true,
      runPayloadValidation: true,
    });
    return verified;
  }

  async bootstrapBundledFiles(paths) {
    return this._runSerialized(() => this._bootstrapBundledFiles(paths));
  }

  async _bootstrapBundledFiles(paths) {
    this._ensureStore();
    if (this._readState({ required: false }) !== null) {
      fail("STATE_EXISTS", "active.json 已初始化，不能重复 bootstrap bundled package");
    }
    const verified = await this._readBundledFiles(paths);
    if ((await this._allInstalledPackages()).length !== 0) {
      fail("INVALID_STATE", "无 active state 时 packages/ 必须为空，拒绝采信无事务绑定的 CAS");
    }
    await this._rejectDuplicateIdentity(verified);
    const state = {
      schema_version: STATE_SCHEMA_VERSION,
      active: descriptorFor(verified.manifest, verified.manifestSha256, "bundled"),
      previous: null,
      highest_seen_sequence: verified.manifest.release_sequence,
      revoked_manifest_sha256s: [],
    };
    const transaction = this._beginTransaction({
      operation: "bootstrap",
      expectedState: null,
      nextState: state,
      verified,
      packageWasPresent: false,
    });
    await this._materialize(verified);
    this._atomicWriteState(state, { expectedState: null });
    this._completeTransaction(transaction);
    return state;
  }

  async install(envelopeBytes) {
    return this._runSerialized(() => this._install(envelopeBytes));
  }

  async applyRevocationEnvelope(envelopeBytes) {
    return this._runSerialized(() => this._applyRevocationEnvelope(envelopeBytes));
  }

  async _applyRevocationEnvelope(envelopeBytes) {
    const { state, verified: activeVerified } = await this._verifyGlobalState({
      allowMigrationSource: true,
    });
    const verifiedList = await this.verifyRevocationEnvelope(envelopeBytes, {
      bundleId: state.active.bundle_id,
    });
    const incoming = verifiedList.payload.revoked_manifest_sha256s;
    if (state.revoked_manifest_sha256s.some((digest) => !incoming.includes(digest))) {
      fail("REVOCATION_ROLLBACK", "撤回清单不得移除已经持久化的 manifest");
    }
    if (canonicalJson(incoming) === canonicalJson(state.revoked_manifest_sha256s)) {
      return state;
    }
    const nextState = {
      schema_version: STATE_SCHEMA_VERSION,
      active: state.active,
      previous: state.previous,
      highest_seen_sequence: state.highest_seen_sequence,
      revoked_manifest_sha256s: [...incoming],
    };
    const transaction = this._beginTransaction({
      operation: "apply-revocations",
      expectedState: state,
      nextState,
      verified: activeVerified,
      packageWasPresent: true,
    });
    this._atomicWriteState(nextState, { expectedState: state });
    this._completeTransaction(transaction);
    return nextState;
  }

  async _install(envelopeBytes) {
    const { state } = await this._verifyGlobalState({ allowMigrationSource: true });
    const verified = await this.verifyEnvelope(envelopeBytes, {
      enforceCompatibility: true,
      enforceExpiry: true,
      runPayloadValidation: true,
    });
    if (verified.manifest.bundle_id !== state.active.bundle_id) {
      fail("BUNDLE_ID_MISMATCH", "更新包 bundle_id 与当前标准库不一致");
    }
    if (state.revoked_manifest_sha256s.includes(verified.manifestSha256)) {
      fail("REVOKED_PACKAGE", "更新包 manifest 已撤回");
    }
    if (verified.manifest.release_sequence <= state.highest_seen_sequence) {
      fail("ROLLBACK_BLOCKED", "普通更新必须严格提高 release_sequence", {
        incoming: verified.manifest.release_sequence,
        highest_seen_sequence: state.highest_seen_sequence,
      });
    }
    const rollback = await this._resolveRollbackTarget(verified.manifest, state, {
      required: true,
      allowUnavailable: true,
      allowRevoked: true,
    });
    await this._rejectDuplicateIdentity(verified);
    const nextState = {
      schema_version: STATE_SCHEMA_VERSION,
      active: descriptorFor(verified.manifest, verified.manifestSha256, "installed"),
      previous: rollback.descriptor,
      highest_seen_sequence: verified.manifest.release_sequence,
      revoked_manifest_sha256s: [...state.revoked_manifest_sha256s],
    };
    const packageWasPresent = lstatOrNull(this.fs, this._packagePath(verified.manifestSha256)) !== null;
    const transaction = this._beginTransaction({
      operation: "install",
      expectedState: state,
      nextState,
      verified,
      packageWasPresent,
    });
    await this._materialize(verified);
    this._atomicWriteState(nextState, { expectedState: state });
    this._completeTransaction(transaction);
    return nextState;
  }

  async reconcileBundledFiles(paths) {
    return this._runSerialized(() => this._reconcileBundledFiles(paths));
  }

  async _reconcileBundledFiles(paths) {
    const current = this._readState({ required: false });
    if (current === null) return this._bootstrapBundledFiles(paths);
    const { state } = await this._verifyGlobalState({ allowMigrationSource: true });
    const verified = await this._readBundledFiles(paths);
    if (verified.manifest.bundle_id !== state.active.bundle_id) {
      fail("BUNDLE_ID_MISMATCH", "APP bundled package bundle_id 与当前标准库不一致");
    }
    await this._rejectDuplicateIdentity(verified);
    if (verified.manifestSha256 === state.active.manifest_sha256) return state;
    if (verified.manifest.release_sequence <= state.highest_seen_sequence) return state;
    if (state.revoked_manifest_sha256s.includes(verified.manifestSha256)) {
      fail("REVOKED_PACKAGE", "APP bundled package manifest 已撤回");
    }
    const rollback = await this._resolveRollbackTarget(verified.manifest, state, {
      required: true,
      allowUnavailable: true,
      allowRevoked: true,
    });
    const nextState = {
      schema_version: STATE_SCHEMA_VERSION,
      active: descriptorFor(verified.manifest, verified.manifestSha256, "bundled"),
      previous: rollback.descriptor,
      highest_seen_sequence: verified.manifest.release_sequence,
      revoked_manifest_sha256s: [...state.revoked_manifest_sha256s],
    };
    const packageWasPresent = lstatOrNull(this.fs, this._packagePath(verified.manifestSha256)) !== null;
    const transaction = this._beginTransaction({
      operation: "reconcile-bundled",
      expectedState: state,
      nextState,
      verified,
      packageWasPresent,
    });
    await this._materialize(verified);
    this._atomicWriteState(nextState, { expectedState: state });
    this._completeTransaction(transaction);
    return nextState;
  }

  async activate(manifestSha256) {
    return this._runSerialized(() => this._activate(manifestSha256));
  }

  async _activate(manifestSha256) {
    const { state } = await this._verifyGlobalState({ allowMigrationSource: true });
    if (state.revoked_manifest_sha256s.includes(manifestSha256)) {
      fail("REVOKED_PACKAGE", "目标标准包 manifest 已撤回");
    }
    const verified = await this._verifyPackageDirectory(manifestSha256, {
      enforceCompatibility: true,
      enforceExpiry: true,
      runPayloadValidation: true,
    });
    if (verified.manifest.bundle_id !== state.active.bundle_id) {
      fail("BUNDLE_ID_MISMATCH", "目标 package bundle_id 与当前标准库不一致");
    }
    if (verified.manifestSha256 === state.active.manifest_sha256) return state;
    if (verified.manifest.release_sequence <= state.active.release_sequence) {
      fail("ROLLBACK_BLOCKED", "activate 只能前向激活；降级必须使用 rollback");
    }
    const rollback = await this._resolveRollbackTarget(verified.manifest, state, {
      required: true,
      allowUnavailable: true,
      allowRevoked: true,
    });
    await this._rejectDuplicateIdentity(verified);
    const nextState = {
      schema_version: STATE_SCHEMA_VERSION,
      active: this._descriptorForVerified(verified),
      previous: rollback.descriptor,
      highest_seen_sequence: Math.max(state.highest_seen_sequence, verified.manifest.release_sequence),
      revoked_manifest_sha256s: [...state.revoked_manifest_sha256s],
    };
    const transaction = this._beginTransaction({
      operation: "activate",
      expectedState: state,
      nextState,
      verified,
      packageWasPresent: true,
    });
    this._atomicWriteState(nextState, { expectedState: state });
    this._completeTransaction(transaction);
    return nextState;
  }

  async rollback() {
    return this._runSerialized(() => this._rollback());
  }

  async _rollback() {
    const { state, verified: activeVerified } = await this._verifyGlobalState();
    if (state.previous === null) fail("NO_ROLLBACK_TARGET", "没有可回滚的 previous package");
    const signedTarget = activeVerified.manifest.rollback_target;
    if (signedTarget === null) fail("NO_ROLLBACK_TARGET", "active manifest 明确禁止回滚");
    if (signedTarget.manifest_sha256 !== state.previous.manifest_sha256 ||
        signedTarget.release_sequence !== state.previous.release_sequence) {
      fail("ROLLBACK_TARGET_MISMATCH", "active manifest rollback_target 与 previous 不一致");
    }
    const targetVerified = await this._verifyDescriptor(state.previous, {
      enforceExpiry: true,
      enforceCompatibility: true,
    });
    if (state.previous.bundle_id !== state.active.bundle_id) {
      fail("BUNDLE_ID_MISMATCH", "previous package bundle_id 与当前标准库不一致");
    }
    if (state.revoked_manifest_sha256s.includes(state.previous.manifest_sha256)) {
      fail("REVOKED_PACKAGE", "previous package 已撤回，拒绝回滚");
    }
    const priorTarget = await this._resolveRollbackTarget(targetVerified.manifest, state, {
      required: false,
      allowUnavailable: false,
      allowRevoked: false,
    });
    const nextState = {
      schema_version: STATE_SCHEMA_VERSION,
      active: state.previous,
      previous: priorTarget?.descriptor || null,
      highest_seen_sequence: state.highest_seen_sequence,
      revoked_manifest_sha256s: [...state.revoked_manifest_sha256s],
    };
    const transaction = this._beginTransaction({
      operation: "rollback",
      expectedState: state,
      nextState,
      verified: targetVerified,
      packageWasPresent: true,
    });
    this._atomicWriteState(nextState, { expectedState: state });
    this._completeTransaction(transaction);
    return nextState;
  }

  async verifyActive({ allowMigrationSource = false } = {}) {
    if (typeof allowMigrationSource !== "boolean") {
      fail("INVALID_ARGUMENT", "allowMigrationSource 必须是 boolean");
    }
    return this._runSerialized(() => this._verifyGlobalState({ allowMigrationSource }));
  }

  async verifiedActiveIdentity() {
    return this._runSerialized(async () => {
      const { verified } = await this._verifyGlobalState();
      return releaseIdentityFor(verified);
    });
  }

  async verifyReleaseIdentity(identity, { allowMigrationSource = false } = {}) {
    if (typeof allowMigrationSource !== "boolean") {
      fail("INVALID_ARGUMENT", "allowMigrationSource 必须是 boolean");
    }
    validateReleaseIdentity(identity);
    return this._runSerialized(async () => {
      const { state } = await this._verifyGlobalState({ allowMigrationSource });
      if (!allowMigrationSource &&
          state.revoked_manifest_sha256s.includes(identity.manifest_sha256)) {
        fail("REVOKED_PACKAGE", "指定标准 release 已撤回");
      }
      if (!lstatOrNull(this.fs, this._packagePath(identity.manifest_sha256))) {
        fail("RELEASE_NOT_FOUND", "指定标准 release 不在 CAS 中");
      }
      const verified = await this._verifyPackageDirectory(identity.manifest_sha256, {
        enforceCompatibility: !allowMigrationSource,
        enforceExpiry: !allowMigrationSource,
        runPayloadValidation: true,
      });
      if (allowMigrationSource &&
          parseUtc(verified.manifest.released_at, "manifest.released_at") > this._nowMs()) {
        fail("NOT_YET_VALID", `指定标准 release 尚未到发布时间 ${verified.manifest.released_at}`);
      }
      const actual = releaseIdentityFor(verified);
      if (canonicalJson(actual) !== canonicalJson(identity)) {
        fail("RELEASE_IDENTITY_MISMATCH", "指定标准 release 与完整 pin 身份不一致", {
          expected: identity,
          actual,
        });
      }
      return actual;
    });
  }
}

module.exports = {
  BUNDLED_ENVELOPE_KIND,
  DEFAULT_LIMITS,
  ENVELOPE_KIND,
  ENVELOPE_SCHEMA_VERSION,
  MANIFEST_KIND,
  MANIFEST_SCHEMA_VERSION,
  PACKAGE_FILES,
  PAYLOAD_PATHS,
  REVOCATION_ENVELOPE_KIND,
  REVOCATION_LIST_KIND,
  STATE_SCHEMA_VERSION,
  StandardsStore,
  StandardsStoreError,
  TRUST_KIND,
  TRUST_SCHEMA_VERSION,
  TRUST_SCHEMA_VERSION_WITH_REVOCATION,
  canonicalJson,
  compareSemver,
  sha256,
};
