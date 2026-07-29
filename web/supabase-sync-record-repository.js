// Server-only Supabase adapter for authenticated SyncRecord v1 persistence.
// The service-role key and these fixed RPCs must never be exposed to a browser
// or desktop renderer.

"use strict";

const {
  MAX_RECORD_BYTES,
  canonicalSyncRecordV1,
  validateServerSyncRecordV1,
} = require("./sync-record-service");

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const RPC_PREFIX = "/rest/v1/rpc/";
const RPC_NAMES = Object.freeze({
  create: "oak_manuscript_sync_record_create_or_replay",
  list: "oak_manuscript_sync_record_list",
  get: "oak_manuscript_sync_record_get",
  delete: "oak_manuscript_sync_record_delete",
});
const ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ID_PATTERN = /^sync-v1:[0-9a-f]{16}:check-[0-9]{4,}$/;
const ROW_KEYS = Object.freeze(["account_id", "canonical_record", "received_at", "record"]);
const CREATE_RESULT_KEYS = Object.freeze(["schema_version", "result_type", "outcome", "row"]);

const ERROR_MESSAGES = Object.freeze({
  SYNC_DB_TIMEOUT: "同步数据库请求超时",
  SYNC_DB_UNAVAILABLE: "同步数据库暂时不可用",
  SYNC_DB_UNAUTHORIZED: "同步数据库服务端凭据无效",
  SYNC_DB_INVALID_RESPONSE: "同步数据库响应非法",
});

class SupabaseSyncRecordRepositoryError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.SYNC_DB_UNAVAILABLE);
    this.name = "SupabaseSyncRecordRepositoryError";
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : "SYNC_DB_UNAVAILABLE";
  }
}

function fail(code) {
  throw new SupabaseSyncRecordRepositoryError(code);
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

function safeString(value, pattern, label, maximum) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum ||
      (pattern && !pattern.test(value))) throw new TypeError(`${label}非法`);
  return value;
}

function canonicalTime(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) ||
      new Date(value).toISOString() !== value) throw new TypeError(`${label}必须是规范 UTC 时间`);
  return value;
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function validateStoredRow(value, expectedAccount = null) {
  exactObject(value, ROW_KEYS, "同步数据库 row");
  safeString(value.account_id, ACCOUNT_PATTERN, "row.account_id", 128);
  if (expectedAccount !== null && value.account_id !== expectedAccount) {
    throw new TypeError("同步数据库 row 账号归属漂移");
  }
  safeString(value.canonical_record, null, "row.canonical_record", MAX_RECORD_BYTES);
  if (Buffer.byteLength(value.canonical_record, "utf8") > MAX_RECORD_BYTES) {
    throw new TypeError("row.canonical_record 非法");
  }
  canonicalTime(value.received_at, "row.received_at");
  validateServerSyncRecordV1(value.record);
  if (value.record.idempotency_id.length > 192 ||
      canonicalSyncRecordV1(value.record) !== value.canonical_record) {
    throw new TypeError("同步数据库 row canonical_record 不一致");
  }
  return deepFreeze(clone(value));
}

function validateCreateResult(value, expectedAccount = null) {
  exactObject(value, CREATE_RESULT_KEYS, "同步数据库创建结果");
  if (value.schema_version !== "1.0" ||
      value.result_type !== "oak_manuscript_sync_record_create_result" ||
      !["created", "replayed", "conflict", "limit"].includes(value.outcome)) {
    throw new TypeError("同步数据库创建结果非法");
  }
  const needsRow = value.outcome === "created" || value.outcome === "replayed";
  if (needsRow !== (value.row !== null)) throw new TypeError("同步数据库创建结果 row 非法");
  return deepFreeze({
    ...value,
    row: value.row === null ? null : validateStoredRow(value.row, expectedAccount),
  });
}

async function readBoundedJson(response, maximum) {
  const contentType = response.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) fail("SYNC_DB_INVALID_RESPONSE");
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]{0,15})$/u.test(declared)) fail("SYNC_DB_INVALID_RESPONSE");
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length > maximum) fail("SYNC_DB_INVALID_RESPONSE");
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    fail("SYNC_DB_INVALID_RESPONSE");
  }
  if (bytes.length > maximum || (declared !== null && bytes.length !== Number(declared))) {
    fail("SYNC_DB_INVALID_RESPONSE");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("SYNC_DB_INVALID_RESPONSE");
  }
}

class SupabaseSyncRecordRepository {
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
      throw new TypeError("maxResponseBytes 必须在 1 KiB 到 8 MiB 之间");
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
      if (controller.signal.aborted || error?.name === "AbortError") fail("SYNC_DB_TIMEOUT");
      fail("SYNC_DB_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
    if (!response || typeof response.status !== "number" || !response.headers ||
        typeof response.arrayBuffer !== "function") fail("SYNC_DB_INVALID_RESPONSE");
    if (response.status === 401 || response.status === 403) fail("SYNC_DB_UNAUTHORIZED");
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      fail("SYNC_DB_UNAVAILABLE");
    }
    if (response.status !== 200) fail("SYNC_DB_INVALID_RESPONSE");
    return readBoundedJson(response, this.maxResponseBytes);
  }

  async createOrReplay(account, canonical, candidate, maximum) {
    safeString(account, ACCOUNT_PATTERN, "account", 128);
    const normalized = validateStoredRow(candidate, account);
    safeString(canonical, null, "canonical", MAX_RECORD_BYTES);
    if (Buffer.byteLength(canonical, "utf8") > MAX_RECORD_BYTES ||
        canonical !== normalized.canonical_record) throw new TypeError("canonical 与 candidate 不一致");
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 500) {
      throw new TypeError("maximum 非法");
    }
    const value = await this._rpc(RPC_NAMES.create, {
      p_account_id: account,
      p_idempotency_id: normalized.record.idempotency_id,
      p_canonical_record: canonical,
      p_record: normalized.record,
      p_max_records: maximum,
    });
    return validateCreateResult(value, account);
  }

  async listOwned(account, limit) {
    safeString(account, ACCOUNT_PATTERN, "account", 128);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("limit 非法");
    const value = await this._rpc(RPC_NAMES.list, { p_account_id: account, p_limit: limit });
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).sort().join("\0") !== ["rows", "total"].sort().join("\0") ||
        !Array.isArray(value.rows) || value.rows.length > limit ||
        !Number.isSafeInteger(value.total) || value.total < value.rows.length || value.total > 500) {
      fail("SYNC_DB_INVALID_RESPONSE");
    }
    try {
      return deepFreeze({
        rows: value.rows.map((item) => validateStoredRow(item, account)),
        total: value.total,
      });
    } catch {
      fail("SYNC_DB_INVALID_RESPONSE");
    }
  }

  async getOwned(account, id) {
    safeString(account, ACCOUNT_PATTERN, "account", 128);
    safeString(id, ID_PATTERN, "idempotency_id", 192);
    const value = await this._rpc(RPC_NAMES.get, {
      p_account_id: account,
      p_idempotency_id: id,
    });
    if (value === null) return null;
    try {
      return validateStoredRow(value, account);
    } catch {
      fail("SYNC_DB_INVALID_RESPONSE");
    }
  }

  async deleteOwned(account, id) {
    safeString(account, ACCOUNT_PATTERN, "account", 128);
    safeString(id, ID_PATTERN, "idempotency_id", 192);
    const value = await this._rpc(RPC_NAMES.delete, {
      p_account_id: account,
      p_idempotency_id: id,
    });
    if (typeof value !== "boolean") fail("SYNC_DB_INVALID_RESPONSE");
    return value;
  }
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  RPC_NAMES,
  SupabaseSyncRecordRepository,
  SupabaseSyncRecordRepositoryError,
  validateCreateResult,
  validateStoredRow,
};
