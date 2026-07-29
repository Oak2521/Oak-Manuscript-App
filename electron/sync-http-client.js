// Main-process-only, bounded transport for explicitly authorized SyncRecord v1 payloads.

"use strict";

const { validateSyncRecordV1 } = require("./providers");

const SYNC_PATH = "/manuscript/api/v1/sync-records";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const TOKEN68_PATTERN = /^[A-Za-z0-9._~+\/-]+={0,2}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const ERROR_MESSAGES = Object.freeze({
  TRANSPORT_TIMEOUT: "结果同步请求超时",
  TRANSPORT_UNAVAILABLE: "结果同步服务暂时不可用",
  AUTH_REQUIRED: "湖岸账号会话无效或已过期",
  RECORD_REJECTED: "服务端拒绝了同步记录",
  IDEMPOTENCY_CONFLICT: "同步记录与服务端既有幂等记录冲突",
  ACCOUNT_RECORD_LIMIT: "当前账号的同步记录数量已达上限",
  INVALID_RESPONSE: "结果同步服务返回了非法响应",
});

class SyncTransportError extends Error {
  constructor(code, retryable = false) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.TRANSPORT_UNAVAILABLE);
    this.name = "SyncTransportError";
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : "TRANSPORT_UNAVAILABLE";
    this.retryable = retryable === true;
  }
}

function fail(code, retryable = false) {
  throw new SyncTransportError(code, retryable);
}

function canonicalOrigin(value) {
  if (typeof value !== "string") throw new TypeError("apiOrigin 必须是 HTTPS origin");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new TypeError("apiOrigin 必须是不含路径、凭据、查询或片段的规范 HTTPS origin");
  }
  return value;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function validAccessToken(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 8192 &&
    TOKEN68_PATTERN.test(value);
}

async function readBoundedJson(response, maximum) {
  const contentType = response.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) fail("INVALID_RESPONSE");
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]{0,15})$/u.test(declared)) fail("INVALID_RESPONSE");
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length > maximum) fail("INVALID_RESPONSE");
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    fail("INVALID_RESPONSE");
  }
  if (bytes.length < 2 || bytes.length > maximum ||
      (declared !== null && bytes.length !== Number(declared))) fail("INVALID_RESPONSE");
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("INVALID_RESPONSE");
  }
}

function validateSuccess(value, expectedRecord, status) {
  if (!exactKeys(value, ["schema_version", "outcome", "item"]) ||
      value.schema_version !== "1.0" || !["created", "replayed"].includes(value.outcome) ||
      (value.outcome === "created" ? status !== 201 : status !== 200) ||
      !exactKeys(value.item, ["idempotency_id", "received_at", "record"]) ||
      value.item.idempotency_id !== expectedRecord.idempotency_id ||
      !canonicalTime(value.item.received_at)) fail("INVALID_RESPONSE");
  try {
    validateSyncRecordV1(value.item.record);
  } catch {
    fail("INVALID_RESPONSE");
  }
  if (value.item.record.authorized_at === null ||
      canonicalJson(value.item.record) !== canonicalJson(expectedRecord)) fail("INVALID_RESPONSE");
  return Object.freeze({
    outcome: value.outcome,
    idempotency_id: value.item.idempotency_id,
    received_at: value.item.received_at,
  });
}

function mapServerError(value, status) {
  if (!exactKeys(value, ["schema_version", "error", "request_id"]) ||
      value.schema_version !== "1.0" || !UUID_PATTERN.test(value.request_id) ||
      !exactKeys(value.error, ["code", "message"]) || typeof value.error.message !== "string") {
    fail("INVALID_RESPONSE");
  }
  const mapping = new Map([
    ["401:AUTH_REQUIRED", ["AUTH_REQUIRED", false]],
    ["400:INVALID_RECORD", ["RECORD_REJECTED", false]],
    ["409:IDEMPOTENCY_CONFLICT", ["IDEMPOTENCY_CONFLICT", false]],
    ["429:ACCOUNT_RECORD_LIMIT", ["ACCOUNT_RECORD_LIMIT", false]],
    ["503:SERVICE_UNAVAILABLE", ["TRANSPORT_UNAVAILABLE", true]],
  ]);
  const target = mapping.get(`${status}:${value.error.code}`);
  if (!target) fail("INVALID_RESPONSE");
  fail(target[0], target[1]);
}

class SyncHttpClient {
  constructor({
    apiOrigin,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  } = {}) {
    this.origin = canonicalOrigin(apiOrigin);
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl 必须是函数");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      throw new TypeError("timeoutMs 必须在 100 到 30000 毫秒之间");
    }
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 ||
        maxResponseBytes > DEFAULT_MAX_RESPONSE_BYTES) {
      throw new TypeError("maxResponseBytes 必须在 1 KiB 到 256 KiB 之间");
    }
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
  }

  async send({ accessToken, record } = {}) {
    if (!validAccessToken(accessToken)) throw new TypeError("accessToken 格式非法");
    validateSyncRecordV1(record);
    if (record.authorized_at === null) throw new TypeError("record 尚未获得同步授权");
    const body = JSON.stringify(record);
    const bodyBytes = Buffer.byteLength(body, "utf8");
    if (bodyBytes < 2 || bodyBytes > MAX_REQUEST_BYTES) throw new TypeError("record 超过同步请求上限");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.origin}${SYNC_PATH}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "content-length": String(bodyBytes),
          "content-type": "application/json",
          origin: this.origin,
          "sec-fetch-site": "same-origin",
        },
        body,
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") fail("TRANSPORT_TIMEOUT", true);
      fail("TRANSPORT_UNAVAILABLE", true);
    } finally {
      clearTimeout(timer);
    }
    if (!response || typeof response.status !== "number" || !response.headers ||
        typeof response.arrayBuffer !== "function") fail("INVALID_RESPONSE");
    const value = await readBoundedJson(response, this.maxResponseBytes);
    if (response.status === 200 || response.status === 201) {
      return validateSuccess(value, record, response.status);
    }
    return mapServerError(value, response.status);
  }
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  SYNC_PATH,
  SyncHttpClient,
  SyncTransportError,
};
