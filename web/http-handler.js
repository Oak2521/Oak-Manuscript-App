"use strict";

const { randomUUID, timingSafeEqual } = require("node:crypto");
const { WebJobError } = require("./job-contract");

const API_BASE_PATH = "/manuscript/api/v1/jobs";
const DEFAULT_MAX_JSON_BYTES = 64 * 1024;
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE"]);
const FORBIDDEN_UPLOAD_HEADERS = Object.freeze([
  "content-disposition",
  "content-md5",
  "digest",
  "x-content-sha256",
  "x-file-name",
  "x-filename",
]);
const PRINCIPAL_KINDS = new Set(["account", "anonymous"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JOB_ID_PATTERN = /^webjob-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ERROR_STATUS = Object.freeze({
  AUTH_REQUIRED: 401,
  BODY_LENGTH_MISMATCH: 400,
  CONSENT_REQUIRED: 400,
  CONSENT_STALE: 400,
  CROSS_SITE_REQUEST: 403,
  CSRF_REQUIRED: 403,
  FORBIDDEN_METADATA: 400,
  GLOBAL_CONCURRENCY_LIMIT: 429,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_TERMINAL: 409,
  INSECURE_TRANSPORT: 400,
  INVALID_HEADERS: 400,
  INVALID_JSON: 400,
  INVALID_REQUEST: 400,
  INVALID_RESULT: 400,
  INVALID_TRANSITION: 409,
  INVALID_UPLOAD: 400,
  JOB_EXPIRED: 410,
  JOB_ID_COLLISION: 503,
  JOB_NOT_FOUND: 404,
  LENGTH_REQUIRED: 411,
  METHOD_NOT_ALLOWED: 405,
  NOT_FOUND: 404,
  OWNER_CONCURRENCY_LIMIT: 429,
  REQUEST_TOO_LARGE: 413,
  RESULT_NOT_AVAILABLE: 409,
  TRANSFER_ENCODING_NOT_ALLOWED: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UPLOAD_MEDIA_TYPE_MISMATCH: 415,
  UPLOAD_SIZE_MISMATCH: 400,
  ZERO_RETENTION_DELETE_FAILED: 503,
});

const ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "需要有效的湖岸会话",
  BODY_LENGTH_MISMATCH: "请求体长度不一致",
  CONSENT_REQUIRED: "必须明确同意本次稿件处理",
  CONSENT_STALE: "本次处理同意已经失效",
  CROSS_SITE_REQUEST: "拒绝跨站请求",
  CSRF_REQUIRED: "请求缺少有效的防跨站令牌",
  FORBIDDEN_METADATA: "请求不得携带文件名或内容摘要元数据",
  GLOBAL_CONCURRENCY_LIMIT: "服务并发已满",
  IDEMPOTENCY_CONFLICT: "幂等键与既有请求冲突",
  IDEMPOTENCY_TERMINAL: "该幂等任务已经结束",
  INSECURE_TRANSPORT: "Web 作业只接受 HTTPS",
  INVALID_HEADERS: "请求头非法",
  INVALID_JSON: "JSON 请求体非法",
  INVALID_REQUEST: "请求不符合 Web 作业契约",
  INVALID_RESULT: "结果不可用",
  INVALID_TRANSITION: "任务当前不允许该操作",
  INVALID_UPLOAD: "上传内容非法",
  JOB_EXPIRED: "任务已经到期并等待删除",
  JOB_ID_COLLISION: "任务标识生成失败",
  JOB_NOT_FOUND: "任务不存在或无权访问",
  LENGTH_REQUIRED: "上传必须声明 Content-Length",
  METHOD_NOT_ALLOWED: "该路由不接受此方法",
  NOT_FOUND: "API 路由不存在",
  OWNER_CONCURRENCY_LIMIT: "当前会话的并发任务已满",
  REQUEST_TOO_LARGE: "请求体超过上限",
  RESULT_NOT_AVAILABLE: "任务结果尚不可下载",
  TRANSFER_ENCODING_NOT_ALLOWED: "不接受流式 Transfer-Encoding",
  UNSUPPORTED_MEDIA_TYPE: "请求媒体类型不受支持",
  UPLOAD_MEDIA_TYPE_MISMATCH: "上传媒体类型与任务不一致",
  UPLOAD_SIZE_MISMATCH: "上传大小与任务不一致",
  ZERO_RETENTION_DELETE_FAILED: "临时内容删除失败，服务正在等待重试",
  INTERNAL_ERROR: "服务暂时不可用",
});
const ERROR_CODES = new Set([...Object.keys(ERROR_STATUS), "INTERNAL_ERROR"]);
const HTTP_METHOD_PATTERN = /^[A-Z]{1,16}$/;
const AUDIT_ROUTES = new Set([
  API_BASE_PATH,
  `${API_BASE_PATH}/:job_id`,
  `${API_BASE_PATH}/:job_id/input`,
  `${API_BASE_PATH}/:job_id/result`,
  `${API_BASE_PATH}/:job_id/cancel`,
  "unmatched",
]);

class WebHttpError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR);
    this.name = "WebHttpError";
    this.code = code;
  }
}

function fail(code) {
  throw new WebHttpError(code);
}

function exactObjectKeys(input, expected) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const actual = Object.keys(input).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validateHttpErrorResponse(input) {
  if (!exactObjectKeys(input, ["schema_version", "error", "request_id"]) ||
      input.schema_version !== "1.0" || !UUID_PATTERN.test(input.request_id) ||
      !exactObjectKeys(input.error, ["code", "message"]) ||
      !ERROR_CODES.has(input.error.code) || input.error.message !== ERROR_MESSAGES[input.error.code]) {
    throw new TypeError("HTTP error response 不符合 exact v1 契约");
  }
  return true;
}

function validateHttpAuditEvent(input) {
  if (!exactObjectKeys(input, [
    "schema_version", "event_type", "request_id", "occurred_at", "method", "route",
    "http_status", "error_code",
  ]) || input.schema_version !== "1.0" || input.event_type !== "web_http_request_completed" ||
      !UUID_PATTERN.test(input.request_id) || !HTTP_METHOD_PATTERN.test(input.method) ||
      !AUDIT_ROUTES.has(input.route) || !Number.isInteger(input.http_status) ||
      input.http_status < 100 || input.http_status > 599 ||
      !(input.error_code === null || ERROR_CODES.has(input.error_code)) ||
      typeof input.occurred_at !== "string" || Number.isNaN(Date.parse(input.occurred_at))) {
    throw new TypeError("HTTP audit event 不符合 exact v1 契约");
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
  if (values.length > 1) fail("INVALID_HEADERS");
  if (required && values.length !== 1) fail("INVALID_HEADERS");
  return values[0];
}

function declaredLength(request, { required = false } = {}) {
  const transferEncoding = singleHeader(request, "transfer-encoding");
  if (transferEncoding !== undefined) fail("TRANSFER_ENCODING_NOT_ALLOWED");
  const value = singleHeader(request, "content-length");
  if (value === undefined) {
    if (required) fail("LENGTH_REQUIRED");
    return null;
  }
  if (!/^(?:0|[1-9][0-9]{0,15})$/.test(value)) fail("INVALID_HEADERS");
  const length = Number(value);
  if (!Number.isSafeInteger(length)) fail("INVALID_HEADERS");
  return length;
}

async function readBoundedBody(request, maximum, expectedLength = null) {
  if (!request || typeof request[Symbol.asyncIterator] !== "function") fail("INVALID_REQUEST");
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maximum) fail("REQUEST_TOO_LARGE");
    chunks.push(bytes);
  }
  if (expectedLength !== null && total !== expectedLength) fail("BODY_LENGTH_MISMATCH");
  return Buffer.concat(chunks, total);
}

function parseRoute(requestUrl) {
  if (typeof requestUrl !== "string" || !requestUrl.startsWith("/") || requestUrl.startsWith("//")) {
    fail("NOT_FOUND");
  }
  const parsed = new URL(requestUrl, "https://route.invalid");
  if (parsed.search || parsed.hash || parsed.pathname.includes("%")) fail("NOT_FOUND");
  if (parsed.pathname === API_BASE_PATH) return { kind: "collection", template: API_BASE_PATH };
  const escaped = API_BASE_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = parsed.pathname.match(new RegExp(`^${escaped}/(webjob-[0-9a-f-]+)(?:/(input|result|cancel))?$`));
  if (!match || !JOB_ID_PATTERN.test(match[1])) fail("NOT_FOUND");
  const suffix = match[2] || null;
  return {
    kind: suffix || "job",
    jobId: match[1],
    template: `${API_BASE_PATH}/:job_id${suffix ? `/${suffix}` : ""}`,
  };
}

function validateSession(session) {
  if (!exactObjectKeys(session, ["principal", "csrf_token"])) fail("AUTH_REQUIRED");
  if (!exactObjectKeys(session.principal, ["kind", "subject_id"])) fail("AUTH_REQUIRED");
  if (!PRINCIPAL_KINDS.has(session.principal.kind) ||
      typeof session.principal.subject_id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(session.principal.subject_id)) {
    fail("AUTH_REQUIRED");
  }
  if (typeof session.csrf_token !== "string" ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(session.csrf_token)) fail("AUTH_REQUIRED");
  return session;
}

function validateCsrf(request, expected) {
  const supplied = singleHeader(request, "x-oak-csrf", { required: true });
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(supplied)) fail("CSRF_REQUIRED");
  const left = Buffer.from(supplied, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) fail("CSRF_REQUIRED");
}

function commonHeaders(contentType) {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function sendJson(response, status, value, extraHeaders = {}) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, {
    ...commonHeaders("application/json; charset=utf-8"),
    "content-length": String(bytes.length),
    ...extraHeaders,
  });
  response.end(bytes);
}

function sendBytes(response, value) {
  response.writeHead(200, {
    ...commonHeaders(value.media_type),
    "content-disposition": "attachment",
    "content-length": String(value.bytes.length),
  });
  response.end(value.bytes);
}

function normalizeError(error) {
  if (error instanceof WebHttpError) return error.code;
  if (error instanceof WebJobError && ERROR_STATUS[error.code]) return error.code;
  return "INTERNAL_ERROR";
}

function createWebJobHttpHandler({
  service,
  expectedOrigin,
  resolveSession,
  isSecureRequest = (request) => request.socket?.encrypted === true,
  maxJsonBytes = DEFAULT_MAX_JSON_BYTES,
  requestIdFactory = randomUUID,
  clock = () => new Date(),
  securityEventSink = () => {},
} = {}) {
  if (!service || ["createJob", "getJob", "reserveUpload", "acceptReservedUpload",
    "releaseUploadReservation", "downloadResultWithMetadata", "cancelJob", "deleteJob"]
    .some((name) => typeof service[name] !== "function")) {
    throw new TypeError("service 未实现完整 Web 作业 HTTP 接口");
  }
  const origin = canonicalOrigin(expectedOrigin);
  if (typeof resolveSession !== "function" || typeof isSecureRequest !== "function" ||
      typeof requestIdFactory !== "function" || typeof clock !== "function" ||
      typeof securityEventSink !== "function") {
    throw new TypeError("HTTP handler 适配器必须是函数");
  }
  if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes < 1024 || maxJsonBytes > DEFAULT_MAX_JSON_BYTES) {
    throw new TypeError("maxJsonBytes 必须在 1 KiB 到 64 KiB 之间");
  }

  return async function handleWebJobRequest(request, response) {
    const rawRequestId = requestIdFactory();
    const requestId = typeof rawRequestId === "string" && UUID_PATTERN.test(rawRequestId)
      ? rawRequestId
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
          (fetchSite !== undefined && fetchSite !== "same-origin")) {
        fail("CROSS_SITE_REQUEST");
      }
      if (STATE_CHANGING_METHODS.has(method) && requestOrigin !== origin) fail("CROSS_SITE_REQUEST");

      const session = validateSession(await resolveSession(request));
      if (STATE_CHANGING_METHODS.has(method)) validateCsrf(request, session.csrf_token);

      if (route.kind === "collection" && method === "POST") {
        const contentType = singleHeader(request, "content-type", { required: true });
        if (contentType !== "application/json") fail("UNSUPPORTED_MEDIA_TYPE");
        const length = declaredLength(request);
        if (length !== null && length > maxJsonBytes) fail("REQUEST_TOO_LARGE");
        const bytes = await readBoundedBody(request, maxJsonBytes, length);
        let body;
        try {
          body = JSON.parse(bytes.toString("utf8"));
        } catch {
          fail("INVALID_JSON");
        }
        const result = await service.createJob(session.principal, body);
        status = 201;
        sendJson(response, status, result);
        return;
      }

      if (route.kind === "job" && method === "GET") {
        if (declaredLength(request) !== null) fail("INVALID_HEADERS");
        const result = service.getJob(session.principal, route.jobId);
        status = 200;
        sendJson(response, status, result);
        return;
      }

      if (route.kind === "input" && method === "PUT") {
        for (const name of FORBIDDEN_UPLOAD_HEADERS) {
          if (singleHeader(request, name) !== undefined) fail("FORBIDDEN_METADATA");
        }
        const contentType = singleHeader(request, "content-type", { required: true });
        const length = declaredLength(request, { required: true });
        const reservation = service.reserveUpload(session.principal, route.jobId, {
          size_bytes: length,
          media_type: contentType,
        });
        let body;
        try {
          body = await readBoundedBody(request, service.maxUploadBytes, length);
          const result = await service.acceptReservedUpload(
            session.principal,
            route.jobId,
            reservation,
            { bytes: body, media_type: contentType },
          );
          status = 202;
          sendJson(response, status, result);
          return;
        } catch (error) {
          try { service.releaseUploadReservation(session.principal, route.jobId, reservation); } catch {}
          throw error;
        }
      }

      if (route.kind === "result" && method === "GET") {
        if (declaredLength(request) !== null) fail("INVALID_HEADERS");
        const result = await service.downloadResultWithMetadata(session.principal, route.jobId);
        status = 200;
        sendBytes(response, result);
        return;
      }

      if (route.kind === "job" && method === "DELETE") {
        if (declaredLength(request) !== null) fail("INVALID_HEADERS");
        const result = await service.deleteJob(session.principal, route.jobId);
        status = 200;
        sendJson(response, status, result);
        return;
      }

      if (route.kind === "cancel" && method === "POST") {
        if (declaredLength(request) !== null) fail("INVALID_HEADERS");
        const result = await service.cancelJob(session.principal, route.jobId);
        status = 200;
        sendJson(response, status, result);
        return;
      }

      const knownRoute = route.kind === "collection" || route.kind === "job" ||
        route.kind === "input" || route.kind === "result" || route.kind === "cancel";
      fail(knownRoute ? "METHOD_NOT_ALLOWED" : "NOT_FOUND");
    } catch (error) {
      errorCode = normalizeError(error);
      status = ERROR_STATUS[errorCode] || 500;
      const headers = errorCode === "METHOD_NOT_ALLOWED" ? { allow: "GET, POST, PUT, DELETE" } : {};
      const errorResponse = {
        schema_version: "1.0",
        error: { code: errorCode, message: ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.INTERNAL_ERROR },
        request_id: requestId,
      };
      validateHttpErrorResponse(errorResponse);
      sendJson(response, status, errorResponse, headers);
    } finally {
      try {
        const now = clock();
        const occurredAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
        const event = {
          schema_version: "1.0",
          event_type: "web_http_request_completed",
          request_id: requestId,
          occurred_at: occurredAt,
          method,
          route: route.template,
          http_status: status,
          error_code: errorCode,
        };
        validateHttpAuditEvent(event);
        securityEventSink(event);
      } catch {
        // 观察事件或观察时钟失败不得改变已经确定的 HTTP 结果。
      }
    }
  };
}

module.exports = {
  API_BASE_PATH,
  DEFAULT_MAX_JSON_BYTES,
  WebHttpError,
  createWebJobHttpHandler,
  validateHttpAuditEvent,
  validateHttpErrorResponse,
};
