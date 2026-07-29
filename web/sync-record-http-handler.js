// Same-origin HTTPS boundary for authenticated SyncRecord v1 storage.

"use strict";

const { randomUUID, timingSafeEqual } = require("node:crypto");
const { SyncRecordServiceError } = require("./sync-record-service");

const SYNC_API_BASE_PATH = "/manuscript/api/v1/sync-records";
const DEFAULT_MAX_JSON_BYTES = 64 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECORD_ID_PATTERN = /^sync-v1:[0-9a-f]{16}:check-[0-9]{4,}$/u;
const METHOD_PATTERN = /^[A-Z]{1,16}$/u;
const STATE_CHANGING_METHODS = new Set(["POST", "DELETE"]);
const ROUTES = new Set([
  SYNC_API_BASE_PATH,
  `${SYNC_API_BASE_PATH}/:idempotency_id`,
  "unmatched",
]);

const ERROR_STATUS = Object.freeze({
  AUTH_REQUIRED: 401,
  BODY_LENGTH_MISMATCH: 400,
  CROSS_SITE_REQUEST: 403,
  CSRF_REQUIRED: 403,
  IDEMPOTENCY_CONFLICT: 409,
  INSECURE_TRANSPORT: 400,
  INVALID_HEADERS: 400,
  INVALID_JSON: 400,
  INVALID_RECORD: 400,
  LENGTH_REQUIRED: 411,
  METHOD_NOT_ALLOWED: 405,
  NOT_FOUND: 404,
  RECORD_NOT_FOUND: 404,
  REQUEST_TOO_LARGE: 413,
  ACCOUNT_RECORD_LIMIT: 429,
  SERVICE_UNAVAILABLE: 503,
  TRANSFER_ENCODING_NOT_ALLOWED: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
});

const ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "需要有效的湖岸会话",
  BODY_LENGTH_MISMATCH: "请求体长度不一致",
  CROSS_SITE_REQUEST: "拒绝跨站请求",
  CSRF_REQUIRED: "请求缺少有效的防跨站令牌",
  IDEMPOTENCY_CONFLICT: "同步幂等标识与既有记录冲突",
  INSECURE_TRANSPORT: "结果同步只接受 HTTPS",
  INVALID_HEADERS: "请求头非法",
  INVALID_JSON: "JSON 请求体非法",
  INVALID_RECORD: "同步记录不符合 SyncRecord v1 契约",
  LENGTH_REQUIRED: "同步请求必须声明 Content-Length",
  METHOD_NOT_ALLOWED: "该路由不接受此方法",
  NOT_FOUND: "API 路由不存在",
  RECORD_NOT_FOUND: "同步记录不存在或无权访问",
  REQUEST_TOO_LARGE: "请求体超过上限",
  ACCOUNT_RECORD_LIMIT: "当前账号的同步记录数量已达上限",
  SERVICE_UNAVAILABLE: "同步服务暂时不可用",
  TRANSFER_ENCODING_NOT_ALLOWED: "不接受流式 Transfer-Encoding",
  UNSUPPORTED_MEDIA_TYPE: "请求媒体类型不受支持",
});

class SyncHttpError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.SERVICE_UNAVAILABLE);
    this.name = "SyncHttpError";
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : "SERVICE_UNAVAILABLE";
  }
}

function fail(code) {
  throw new SyncHttpError(code);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validateSyncHttpErrorResponse(value) {
  if (!exactKeys(value, ["schema_version", "error", "request_id"]) ||
      value.schema_version !== "1.0" || !UUID_PATTERN.test(value.request_id) ||
      !exactKeys(value.error, ["code", "message"]) ||
      !Object.hasOwn(ERROR_MESSAGES, value.error.code) ||
      value.error.message !== ERROR_MESSAGES[value.error.code]) {
    throw new TypeError("Sync HTTP error response 不符合 exact v1 契约");
  }
  return true;
}

function validateSyncHttpAuditEvent(value) {
  if (!exactKeys(value, [
    "schema_version", "event_type", "request_id", "occurred_at", "method", "route",
    "http_status", "error_code",
  ]) || value.schema_version !== "1.0" || value.event_type !== "sync_http_request_completed" ||
      !UUID_PATTERN.test(value.request_id) || !METHOD_PATTERN.test(value.method) ||
      !ROUTES.has(value.route) || !Number.isInteger(value.http_status) ||
      value.http_status < 100 || value.http_status > 599 ||
      !(value.error_code === null || Object.hasOwn(ERROR_MESSAGES, value.error_code)) ||
      typeof value.occurred_at !== "string" || Number.isNaN(Date.parse(value.occurred_at))) {
    throw new TypeError("Sync HTTP audit event 不符合 exact v1 契约");
  }
  return true;
}

function canonicalOrigin(value) {
  if (typeof value !== "string") throw new TypeError("expectedOrigin 必须是 HTTPS origin");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new TypeError("expectedOrigin 必须是不含路径、凭据、查询或片段的规范 HTTPS origin");
  }
  return value;
}

function rawHeaderValues(request, name) {
  const target = name.toLowerCase();
  if (Array.isArray(request.rawHeaders) && request.rawHeaders.length % 2 === 0) {
    const values = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (String(request.rawHeaders[index]).toLowerCase() === target) {
        values.push(String(request.rawHeaders[index + 1]));
      }
    }
    return values;
  }
  const value = request.headers?.[target];
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function singleHeader(request, name, { required = false } = {}) {
  const values = rawHeaderValues(request, name);
  if (values.length > 1 || (required && values.length !== 1)) fail("INVALID_HEADERS");
  return values[0];
}

function declaredLength(request, { required = false } = {}) {
  if (singleHeader(request, "transfer-encoding") !== undefined) {
    fail("TRANSFER_ENCODING_NOT_ALLOWED");
  }
  const value = singleHeader(request, "content-length");
  if (value === undefined) {
    if (required) fail("LENGTH_REQUIRED");
    return null;
  }
  if (!/^(?:0|[1-9][0-9]{0,15})$/u.test(value)) fail("INVALID_HEADERS");
  const length = Number(value);
  if (!Number.isSafeInteger(length)) fail("INVALID_HEADERS");
  return length;
}

async function readBody(request, maximum, expectedLength) {
  if (!request || typeof request[Symbol.asyncIterator] !== "function") fail("INVALID_JSON");
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maximum) fail("REQUEST_TOO_LARGE");
    chunks.push(bytes);
  }
  if (total !== expectedLength) fail("BODY_LENGTH_MISMATCH");
  return Buffer.concat(chunks, total);
}

async function requireEmptyBody(request) {
  if (singleHeader(request, "content-type") !== undefined) fail("INVALID_HEADERS");
  const length = declaredLength(request);
  if (length !== null && length !== 0) fail("INVALID_HEADERS");
  const bytes = await readBody(request, 0, length === null ? 0 : length);
  if (bytes.length !== 0) fail("INVALID_HEADERS");
}

function parseRoute(requestUrl) {
  if (typeof requestUrl !== "string" || !requestUrl.startsWith("/") || requestUrl.startsWith("//")) {
    fail("NOT_FOUND");
  }
  const parsed = new URL(requestUrl, "https://route.invalid");
  if (parsed.search || parsed.hash || parsed.pathname.includes("%")) fail("NOT_FOUND");
  if (parsed.pathname === SYNC_API_BASE_PATH) {
    return { kind: "collection", template: SYNC_API_BASE_PATH };
  }
  const escaped = SYNC_API_BASE_PATH.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = parsed.pathname.match(new RegExp(`^${escaped}/(.+)$`, "u"));
  if (!match || !RECORD_ID_PATTERN.test(match[1])) fail("NOT_FOUND");
  return {
    kind: "record",
    idempotencyId: match[1],
    template: `${SYNC_API_BASE_PATH}/:idempotency_id`,
  };
}

function validateSession(value) {
  const bearer = exactKeys(value, ["principal", "auth_mode"]) && value.auth_mode === "bearer";
  const cookie = exactKeys(value, ["principal", "auth_mode", "csrf_token"]) && value.auth_mode === "cookie";
  if (!bearer && !cookie) fail("AUTH_REQUIRED");
  if (!exactKeys(value.principal, ["kind", "subject_id"]) ||
      !["account", "anonymous"].includes(value.principal.kind) ||
      typeof value.principal.subject_id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value.principal.subject_id)) {
    fail("AUTH_REQUIRED");
  }
  if (cookie && (typeof value.csrf_token !== "string" ||
      !/^[A-Za-z0-9_-]{32,128}$/u.test(value.csrf_token))) fail("AUTH_REQUIRED");
  return value;
}

function validateCsrf(request, expected) {
  const supplied = singleHeader(request, "x-oak-csrf");
  if (typeof supplied !== "string" || !/^[A-Za-z0-9_-]{32,128}$/u.test(supplied)) {
    fail("CSRF_REQUIRED");
  }
  const actualBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)) fail("CSRF_REQUIRED");
}

function sendJson(response, status, value, extraHeaders = {}) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "content-type": "application/json; charset=utf-8",
    "content-length": String(bytes.length),
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(bytes);
}

function normalizeError(error) {
  if (error instanceof SyncHttpError) return error.code;
  if (error instanceof SyncRecordServiceError && Object.hasOwn(ERROR_STATUS, error.code)) {
    return error.code;
  }
  return "SERVICE_UNAVAILABLE";
}

function serviceContract(service) {
  if (!service || ["create", "list", "get", "delete"].some((name) => typeof service[name] !== "function")) {
    throw new TypeError("sync service 未实现完整 HTTP 接口");
  }
  return service;
}

function createSyncRecordHttpHandler({
  service,
  expectedOrigin,
  resolveSession,
  isSecureRequest = (request) => request.socket?.encrypted === true,
  maxJsonBytes = DEFAULT_MAX_JSON_BYTES,
  requestIdFactory = randomUUID,
  clock = () => new Date(),
  securityEventSink = () => {},
} = {}) {
  const syncService = serviceContract(service);
  const origin = canonicalOrigin(expectedOrigin);
  if ([resolveSession, isSecureRequest, requestIdFactory, clock, securityEventSink]
    .some((adapter) => typeof adapter !== "function")) {
    throw new TypeError("Sync HTTP handler 适配器必须是函数");
  }
  if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes < 1024 ||
      maxJsonBytes > DEFAULT_MAX_JSON_BYTES) throw new TypeError("maxJsonBytes 非法");

  return async function handleSyncRecordRequest(request, response) {
    const candidateId = requestIdFactory();
    const requestId = typeof candidateId === "string" && UUID_PATTERN.test(candidateId)
      ? candidateId
      : randomUUID();
    const method = typeof request.method === "string" ? request.method.toUpperCase() : "";
    let route = { template: "unmatched" };
    let status = 500;
    let errorCode = null;
    try {
      if (isSecureRequest(request) !== true) fail("INSECURE_TRANSPORT");
      route = parseRoute(request.url);
      const requestOrigin = singleHeader(request, "origin");
      const fetchSite = singleHeader(request, "sec-fetch-site");
      if ((requestOrigin !== undefined && requestOrigin !== origin) ||
          (fetchSite !== undefined && fetchSite !== "same-origin")) fail("CROSS_SITE_REQUEST");
      if (STATE_CHANGING_METHODS.has(method) && requestOrigin !== origin) fail("CROSS_SITE_REQUEST");

      const session = validateSession(await resolveSession(request));
      if (STATE_CHANGING_METHODS.has(method) && session.auth_mode === "cookie") {
        validateCsrf(request, session.csrf_token);
      }

      if (route.kind === "collection" && method === "POST") {
        if (singleHeader(request, "content-type", { required: true }) !== "application/json") {
          fail("UNSUPPORTED_MEDIA_TYPE");
        }
        const length = declaredLength(request, { required: true });
        if (length > maxJsonBytes) fail("REQUEST_TOO_LARGE");
        const bytes = await readBody(request, maxJsonBytes, length);
        let body;
        try { body = JSON.parse(bytes.toString("utf8")); }
        catch { fail("INVALID_JSON"); }
        const result = await syncService.create(session.principal, body);
        status = result.outcome === "created" ? 201 : 200;
        sendJson(response, status, result);
        return;
      }

      if (route.kind === "collection" && method === "GET") {
        await requireEmptyBody(request);
        const result = await syncService.list(session.principal);
        status = 200;
        sendJson(response, status, result);
        return;
      }

      if (route.kind === "record" && method === "GET") {
        await requireEmptyBody(request);
        const result = await syncService.get(session.principal, route.idempotencyId);
        status = 200;
        sendJson(response, status, result);
        return;
      }

      if (route.kind === "record" && method === "DELETE") {
        await requireEmptyBody(request);
        const result = await syncService.delete(session.principal, route.idempotencyId);
        status = 200;
        sendJson(response, status, result);
        return;
      }

      fail(["collection", "record"].includes(route.kind) ? "METHOD_NOT_ALLOWED" : "NOT_FOUND");
    } catch (error) {
      errorCode = normalizeError(error);
      status = ERROR_STATUS[errorCode] || 503;
      const body = {
        schema_version: "1.0",
        error: { code: errorCode, message: ERROR_MESSAGES[errorCode] },
        request_id: requestId,
      };
      validateSyncHttpErrorResponse(body);
      sendJson(response, status, body, errorCode === "METHOD_NOT_ALLOWED"
        ? { allow: "GET, POST, DELETE" }
        : {});
    } finally {
      try {
        const now = clock();
        const event = {
          schema_version: "1.0",
          event_type: "sync_http_request_completed",
          request_id: requestId,
          occurred_at: (now instanceof Date ? now : new Date(now)).toISOString(),
          method,
          route: route.template,
          http_status: status,
          error_code: errorCode,
        };
        validateSyncHttpAuditEvent(event);
        const observation = securityEventSink(event);
        if (observation && typeof observation.catch === "function") {
          observation.catch(() => {});
        }
      } catch {
        // Observation failures cannot change the already selected HTTP result.
      }
    }
  };
}

module.exports = {
  DEFAULT_MAX_JSON_BYTES,
  SYNC_API_BASE_PATH,
  SyncHttpError,
  createSyncRecordHttpHandler,
  validateSyncHttpAuditEvent,
  validateSyncHttpErrorResponse,
};
