"use strict";

const { createHash } = require("node:crypto");

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const RPC_PREFIX = "/rest/v1/rpc/";
const RPC_NAMES = Object.freeze({
  create: "oak_manuscript_web_job_create_or_replay",
  get: "oak_manuscript_web_job_get",
  list: "oak_manuscript_web_job_list",
  compareAndSwap: "oak_manuscript_web_job_compare_and_swap",
  claimNext: "oak_manuscript_web_job_claim_next",
  finalizeDeletion: "oak_manuscript_web_job_finalize_deletion",
  listExpired: "oak_manuscript_web_job_list_expired",
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JOB_ID_PATTERN = new RegExp(`^webjob-${UUID_PATTERN.source.slice(1, -1)}$`);
const OWNER_KEY_PATTERN = /^(?:account|anonymous):[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const JOB_STATES = new Set([
  "awaiting_upload", "queued", "processing", "result_ready", "deletion_pending",
]);
const RESULT_MEDIA_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/epub+zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
]);
const DELETION_REASONS = new Set([
  "canceled", "expired", "user_deleted", "processing_failed", "downloaded",
]);
const RECORD_KEYS = Object.freeze([
  "schema_version", "record_type", "job_id", "owner_key", "state", "created_at",
  "updated_at", "expires_at", "input_retained", "result_available", "result_media_type",
  "pending_deletion_reason", "request_fingerprint", "request_canonical", "idempotency_key",
  "document", "upload_reservation_id", "upload_reservation_expires_at", "lease_id",
  "lease_expires_at", "revision",
]);
const CREATE_RESULT_KEYS = Object.freeze(["schema_version", "result_type", "outcome", "record"]);
const CREATE_INPUT_KEYS = Object.freeze([
  "owner_key", "job_id", "idempotency_key", "request_fingerprint", "request_canonical",
  "document", "ttl_seconds", "max_active_per_owner", "max_active_global",
]);
const CAS_INPUT_KEYS = Object.freeze([
  "owner_key", "job_id", "expected_revision", "expected_states", "next",
]);
const NEXT_KEYS = Object.freeze([
  "state", "input_retained", "result_available", "result_media_type",
  "pending_deletion_reason", "upload_reservation_id", "upload_reservation_expires_at",
  "lease_id", "lease_expires_at",
]);
const DOCUMENT_KEYS = Object.freeze([
  "format", "manuscript_type", "check_config", "citation_style", "size_bytes",
]);

class SupabaseJobRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SupabaseJobRepositoryError";
    this.code = code;
  }
}

function fail(code) {
  const messages = {
    JOB_DB_TIMEOUT: "Web 任务数据库请求超时",
    JOB_DB_UNAVAILABLE: "Web 任务数据库暂时不可用",
    JOB_DB_UNAUTHORIZED: "Web 任务数据库服务端凭据无效",
    JOB_DB_INVALID_RESPONSE: "Web 任务数据库响应非法",
  };
  throw new SupabaseJobRepositoryError(code, messages[code]);
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}必须是对象`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label}字段集合非法`);
  }
  return value;
}

function safeString(value, pattern, label, maximum = 8192) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum ||
      (pattern && !pattern.test(value))) {
    throw new TypeError(`${label}非法`);
  }
  return value;
}

function canonicalTime(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) ||
      new Date(value).toISOString() !== value) {
    throw new TypeError(`${label}必须是规范 UTC 时间`);
  }
  return value;
}

function nullableTime(value, label) {
  return value === null ? null : canonicalTime(value, label);
}

function nullableUuid(value, label) {
  if (value === null) return null;
  return safeString(value, UUID_PATTERN, label, 36);
}

function validateDocument(value) {
  exactObject(value, DOCUMENT_KEYS, "document");
  const formats = new Set(["docx", "md", "txt", "epub"]);
  const manuscriptTypes = new Set(["paper", "print_book", "ebook"]);
  const checkConfigs = new Set(["quick", "full"]);
  const citationStyles = new Set([
    "default", "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none",
  ]);
  if (!formats.has(value.format) || !manuscriptTypes.has(value.manuscript_type) ||
      !checkConfigs.has(value.check_config) || !citationStyles.has(value.citation_style) ||
      !Number.isSafeInteger(value.size_bytes) || value.size_bytes < 1 ||
      value.size_bytes > 50 * 1024 * 1024) {
    throw new TypeError("document 值非法");
  }
  return value;
}

function validateCanonicalRequest(value, document, expectedIdempotencyKey, expectedFingerprint) {
  safeString(value, null, "request_canonical", 8192);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("request_canonical 不是 JSON");
  }
  exactObject(parsed, ["schema_version", "request_type", "idempotency_key", "consent", "document"],
    "request_canonical");
  exactObject(parsed.consent, ["granted", "scope", "privacy_version", "granted_at"],
    "request_canonical.consent");
  validateDocument(parsed.document);
  if (parsed.schema_version !== "1.0" || parsed.request_type !== "oak_manuscript_web_job" ||
      parsed.idempotency_key !== expectedIdempotencyKey || parsed.consent.granted !== true ||
      parsed.consent.scope !== "single_job_processing" ||
      typeof parsed.consent.privacy_version !== "string" ||
      !/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(parsed.consent.privacy_version)) {
    throw new TypeError("request_canonical 固定字段非法");
  }
  canonicalTime(parsed.consent.granted_at, "request_canonical.consent.granted_at");
  if (DOCUMENT_KEYS.some((key) => parsed.document[key] !== document[key])) {
    throw new TypeError("request_canonical 与 document 不一致");
  }
  if (expectedFingerprint !== undefined &&
      createHash("sha256").update(value, "utf8").digest("hex") !== expectedFingerprint) {
    throw new TypeError("request_canonical 与 request_fingerprint 不一致");
  }
  return value;
}

function validateInternalRecord(value) {
  exactObject(value, RECORD_KEYS, "内部任务记录");
  if (value.schema_version !== "1.0" || value.record_type !== "oak_manuscript_web_job_internal" ||
      !JOB_ID_PATTERN.test(value.job_id) || !OWNER_KEY_PATTERN.test(value.owner_key) ||
      !JOB_STATES.has(value.state) || !FINGERPRINT_PATTERN.test(value.request_fingerprint) ||
      !IDEMPOTENCY_KEY_PATTERN.test(value.idempotency_key) ||
      typeof value.input_retained !== "boolean" || typeof value.result_available !== "boolean" ||
      !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError("内部任务记录字段非法");
  }
  canonicalTime(value.created_at, "created_at");
  canonicalTime(value.updated_at, "updated_at");
  canonicalTime(value.expires_at, "expires_at");
  validateDocument(value.document);
  validateCanonicalRequest(
    value.request_canonical,
    value.document,
    value.idempotency_key,
    value.request_fingerprint,
  );
  if (value.result_media_type !== null && !RESULT_MEDIA_TYPES.has(value.result_media_type)) {
    throw new TypeError("result_media_type 非法");
  }
  if (value.pending_deletion_reason !== null && !DELETION_REASONS.has(value.pending_deletion_reason)) {
    throw new TypeError("pending_deletion_reason 非法");
  }
  nullableUuid(value.upload_reservation_id, "upload_reservation_id");
  nullableTime(value.upload_reservation_expires_at, "upload_reservation_expires_at");
  nullableUuid(value.lease_id, "lease_id");
  nullableTime(value.lease_expires_at, "lease_expires_at");
  if ((value.upload_reservation_id === null) !== (value.upload_reservation_expires_at === null) ||
      (value.lease_id === null) !== (value.lease_expires_at === null) ||
      value.result_available !== (value.result_media_type !== null) ||
      (value.state === "deletion_pending") !== (value.pending_deletion_reason !== null)) {
    throw new TypeError("内部任务记录跨字段状态非法");
  }
  const statePayloadValid = value.state === "deletion_pending" ||
    (value.state === "awaiting_upload" && !value.input_retained && !value.result_available) ||
    (value.state === "queued" && value.input_retained && !value.result_available) ||
    (value.state === "processing" && value.input_retained && !value.result_available) ||
    (value.state === "result_ready" && !value.input_retained && value.result_available);
  if (!statePayloadValid || (value.upload_reservation_id !== null && value.state !== "awaiting_upload") ||
      ((value.lease_id !== null) !== (value.state === "processing"))) {
    throw new TypeError("内部任务记录状态载荷非法");
  }
  return Object.freeze({ ...value, document: Object.freeze({ ...value.document }) });
}

function validateCreateResult(value) {
  exactObject(value, CREATE_RESULT_KEYS, "创建结果");
  if (value.schema_version !== "1.0" || value.result_type !== "oak_manuscript_web_job_create_result" ||
      !new Set(["created", "replayed", "conflict", "terminal", "job_id_collision", "owner_limit", "global_limit"])
        .has(value.outcome)) {
    throw new TypeError("创建结果非法");
  }
  const needsRecord = value.outcome === "created" || value.outcome === "replayed";
  if (needsRecord !== (value.record !== null)) throw new TypeError("创建结果 record 非法");
  return Object.freeze({
    ...value,
    record: value.record === null ? null : validateInternalRecord(value.record),
  });
}

function canonicalHttpsOrigin(value) {
  if (typeof value !== "string") throw new TypeError("supabaseOrigin 必须是 HTTPS origin");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new TypeError("supabaseOrigin 必须是不含路径、凭据、查询或片段的规范 HTTPS origin");
  }
  return value;
}

function validHeaderSecret(value) {
  return typeof value === "string" && value.length >= 20 && value.length <= 8192 &&
    !/[\u0000-\u0020\u007f,]/u.test(value);
}

async function readBoundedJson(response, maximum) {
  const contentType = response.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) fail("JOB_DB_INVALID_RESPONSE");
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]{0,15})$/u.test(declared)) fail("JOB_DB_INVALID_RESPONSE");
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length > maximum) fail("JOB_DB_INVALID_RESPONSE");
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    fail("JOB_DB_INVALID_RESPONSE");
  }
  if (bytes.length > maximum || (declared !== null && bytes.length !== Number(declared))) {
    fail("JOB_DB_INVALID_RESPONSE");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("JOB_DB_INVALID_RESPONSE");
  }
}

class SupabaseJobRepository {
  constructor({
    supabaseOrigin,
    serviceRoleKey,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  } = {}) {
    this.origin = canonicalHttpsOrigin(supabaseOrigin);
    if (!validHeaderSecret(serviceRoleKey)) {
      throw new TypeError("serviceRoleKey 不是安全的服务端 Supabase service-role key");
    }
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl 必须是函数");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      throw new TypeError("timeoutMs 必须在 100 到 30000 毫秒之间");
    }
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 ||
        maxResponseBytes > DEFAULT_MAX_RESPONSE_BYTES) {
      throw new TypeError("maxResponseBytes 必须在 1 KiB 到 256 KiB 之间");
    }
    this.serviceRoleKey = serviceRoleKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
  }

  async _rpc(name, body) {
    if (!Object.values(RPC_NAMES).includes(name)) throw new TypeError("RPC 名称不在固定白名单");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.origin}${RPC_PREFIX}${name}`, {
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
      if (controller.signal.aborted || error?.name === "AbortError") fail("JOB_DB_TIMEOUT");
      fail("JOB_DB_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
    if (!response || typeof response.status !== "number" || !response.headers ||
        typeof response.arrayBuffer !== "function") {
      fail("JOB_DB_INVALID_RESPONSE");
    }
    if (response.status === 401 || response.status === 403) fail("JOB_DB_UNAUTHORIZED");
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      fail("JOB_DB_UNAVAILABLE");
    }
    if (response.status !== 200) fail("JOB_DB_INVALID_RESPONSE");
    return readBoundedJson(response, this.maxResponseBytes);
  }

  async createOrReplay(input) {
    exactObject(input, CREATE_INPUT_KEYS, "createOrReplay 输入");
    safeString(input.owner_key, OWNER_KEY_PATTERN, "owner_key", 138);
    safeString(input.job_id, JOB_ID_PATTERN, "job_id", 43);
    safeString(input.idempotency_key, IDEMPOTENCY_KEY_PATTERN, "idempotency_key", 128);
    safeString(input.request_fingerprint, FINGERPRINT_PATTERN, "request_fingerprint", 64);
    validateDocument(input.document);
    validateCanonicalRequest(
      input.request_canonical,
      input.document,
      input.idempotency_key,
      input.request_fingerprint,
    );
    for (const [label, value, maximum] of [
      ["ttl_seconds", input.ttl_seconds, 3600],
      ["max_active_per_owner", input.max_active_per_owner, 100],
      ["max_active_global", input.max_active_global, 100_000],
    ]) {
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new TypeError(`${label} 非法`);
      }
    }
    if (input.ttl_seconds < 60) throw new TypeError("ttl_seconds 非法");
    return validateCreateResult(await this._rpc(RPC_NAMES.create, {
      p_owner_key: input.owner_key,
      p_job_id: input.job_id,
      p_idempotency_key: input.idempotency_key,
      p_request_fingerprint: input.request_fingerprint,
      p_request_canonical: input.request_canonical,
      p_document: input.document,
      p_ttl_seconds: input.ttl_seconds,
      p_max_active_per_owner: input.max_active_per_owner,
      p_max_active_global: input.max_active_global,
    }));
  }

  async getOwned({ owner_key, job_id } = {}) {
    safeString(owner_key, OWNER_KEY_PATTERN, "owner_key", 138);
    safeString(job_id, JOB_ID_PATTERN, "job_id", 43);
    const value = await this._rpc(RPC_NAMES.get, { p_owner_key: owner_key, p_job_id: job_id });
    return value === null ? null : validateInternalRecord(value);
  }

  async listOwned({ owner_key } = {}) {
    safeString(owner_key, OWNER_KEY_PATTERN, "owner_key", 138);
    const value = await this._rpc(RPC_NAMES.list, { p_owner_key: owner_key });
    if (!Array.isArray(value) || value.length > 1000) fail("JOB_DB_INVALID_RESPONSE");
    return Object.freeze(value.map(validateInternalRecord));
  }

  async compareAndSwap(input) {
    exactObject(input, CAS_INPUT_KEYS, "compareAndSwap 输入");
    safeString(input.owner_key, OWNER_KEY_PATTERN, "owner_key", 138);
    safeString(input.job_id, JOB_ID_PATTERN, "job_id", 43);
    if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0 ||
        !Array.isArray(input.expected_states) || input.expected_states.length < 1 ||
        input.expected_states.length > JOB_STATES.size ||
        new Set(input.expected_states).size !== input.expected_states.length ||
        input.expected_states.some((state) => !JOB_STATES.has(state))) {
      throw new TypeError("CAS 期望版本或状态非法");
    }
    exactObject(input.next, NEXT_KEYS, "CAS next");
    if (!JOB_STATES.has(input.next.state) || typeof input.next.input_retained !== "boolean" ||
        typeof input.next.result_available !== "boolean" ||
        (input.next.result_media_type !== null && !RESULT_MEDIA_TYPES.has(input.next.result_media_type)) ||
        (input.next.pending_deletion_reason !== null &&
          !DELETION_REASONS.has(input.next.pending_deletion_reason))) {
      throw new TypeError("CAS next 状态非法");
    }
    nullableUuid(input.next.upload_reservation_id, "upload_reservation_id");
    nullableTime(input.next.upload_reservation_expires_at, "upload_reservation_expires_at");
    nullableUuid(input.next.lease_id, "lease_id");
    nullableTime(input.next.lease_expires_at, "lease_expires_at");
    if ((input.next.upload_reservation_id === null) !==
        (input.next.upload_reservation_expires_at === null) ||
        (input.next.lease_id === null) !== (input.next.lease_expires_at === null) ||
        input.next.result_available !== (input.next.result_media_type !== null) ||
        (input.next.state === "deletion_pending") !==
          (input.next.pending_deletion_reason !== null)) {
      throw new TypeError("CAS next 跨字段状态非法");
    }
    const statePayloadValid = input.next.state === "deletion_pending" ||
      (input.next.state === "awaiting_upload" && !input.next.input_retained &&
        !input.next.result_available) ||
      (input.next.state === "queued" && input.next.input_retained &&
        !input.next.result_available) ||
      (input.next.state === "processing" && input.next.input_retained &&
        !input.next.result_available) ||
      (input.next.state === "result_ready" && !input.next.input_retained &&
        input.next.result_available);
    if (!statePayloadValid ||
        (input.next.upload_reservation_id !== null && input.next.state !== "awaiting_upload") ||
        ((input.next.lease_id !== null) !== (input.next.state === "processing"))) {
      throw new TypeError("CAS next 状态载荷非法");
    }
    const value = await this._rpc(RPC_NAMES.compareAndSwap, {
      p_owner_key: input.owner_key,
      p_job_id: input.job_id,
      p_expected_revision: input.expected_revision,
      p_expected_states: input.expected_states,
      p_next_state: input.next.state,
      p_input_retained: input.next.input_retained,
      p_result_available: input.next.result_available,
      p_result_media_type: input.next.result_media_type,
      p_pending_deletion_reason: input.next.pending_deletion_reason,
      p_upload_reservation_id: input.next.upload_reservation_id,
      p_upload_reservation_expires_at: input.next.upload_reservation_expires_at,
      p_lease_id: input.next.lease_id,
      p_lease_expires_at: input.next.lease_expires_at,
    });
    return value === null ? null : validateInternalRecord(value);
  }

  async claimNext({ lease_id, lease_seconds } = {}) {
    safeString(lease_id, UUID_PATTERN, "lease_id", 36);
    if (!Number.isSafeInteger(lease_seconds) || lease_seconds < 30 || lease_seconds > 900) {
      throw new TypeError("lease_seconds 非法");
    }
    const value = await this._rpc(RPC_NAMES.claimNext, {
      p_lease_id: lease_id,
      p_lease_seconds: lease_seconds,
    });
    if (value === null) return null;
    const record = validateInternalRecord(value);
    if (record.state !== "processing" || record.lease_id !== lease_id) {
      fail("JOB_DB_INVALID_RESPONSE");
    }
    return record;
  }

  async finalizeDeletion({ owner_key, job_id, expected_revision } = {}) {
    safeString(owner_key, OWNER_KEY_PATTERN, "owner_key", 138);
    safeString(job_id, JOB_ID_PATTERN, "job_id", 43);
    if (!Number.isSafeInteger(expected_revision) || expected_revision < 0) {
      throw new TypeError("expected_revision 非法");
    }
    const value = await this._rpc(RPC_NAMES.finalizeDeletion, {
      p_owner_key: owner_key,
      p_job_id: job_id,
      p_expected_revision: expected_revision,
    });
    if (typeof value !== "boolean") fail("JOB_DB_INVALID_RESPONSE");
    return value;
  }

  async listExpired({ before, limit = 100 } = {}) {
    canonicalTime(before, "before");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("limit 非法");
    const value = await this._rpc(RPC_NAMES.listExpired, { p_before: before, p_limit: limit });
    if (!Array.isArray(value) || value.length > limit) fail("JOB_DB_INVALID_RESPONSE");
    return Object.freeze(value.map(validateInternalRecord));
  }
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  RPC_NAMES,
  SupabaseJobRepository,
  SupabaseJobRepositoryError,
  validateCreateResult,
  validateInternalRecord,
};
