"use strict";

const { randomUUID } = require("node:crypto");
const {
  StandardsUpdateServiceError,
  validateStandardsUpdateRequest,
} = require("./standards-update-service");

const STANDARDS_UPDATE_API_PATH = "/manuscript/standards/v1/check";
const PACKAGE_MEDIA_TYPE = "application/vnd.oak.standard-package+json";
const MAX_JSON_BYTES = 4 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const METHOD_PATTERN = /^[A-Z]{1,16}$/u;
const ERROR_STATUS = Object.freeze({
  BODY_LENGTH_MISMATCH: 400,
  CLIENT_STATE_CONFLICT: 409,
  CREDENTIALS_NOT_ALLOWED: 400,
  INSECURE_TRANSPORT: 400,
  INVALID_HEADERS: 400,
  INVALID_JSON: 400,
  INVALID_REQUEST: 400,
  LENGTH_REQUIRED: 411,
  METHOD_NOT_ALLOWED: 405,
  NOT_FOUND: 404,
  REQUEST_TOO_LARGE: 413,
  SERVICE_UNAVAILABLE: 503,
  TRANSFER_ENCODING_NOT_ALLOWED: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
});
const ERROR_MESSAGES = Object.freeze({
  BODY_LENGTH_MISMATCH: "请求体长度不一致",
  CLIENT_STATE_CONFLICT: "客户端标准版本身份与发布记录冲突",
  CREDENTIALS_NOT_ALLOWED: "标准更新检查不接受账号凭据",
  INSECURE_TRANSPORT: "标准更新只接受 HTTPS",
  INVALID_HEADERS: "请求头非法",
  INVALID_JSON: "JSON 请求体非法",
  INVALID_REQUEST: "标准更新请求不符合 exact v1 契约",
  LENGTH_REQUIRED: "标准更新请求必须声明 Content-Length",
  METHOD_NOT_ALLOWED: "该路由只接受 POST",
  NOT_FOUND: "API 路由不存在",
  REQUEST_TOO_LARGE: "标准更新请求超过上限",
  SERVICE_UNAVAILABLE: "标准更新服务暂时不可用",
  TRANSFER_ENCODING_NOT_ALLOWED: "不接受流式 Transfer-Encoding",
  UNSUPPORTED_MEDIA_TYPE: "请求媒体类型不受支持",
});

class StandardsUpdateHttpError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.SERVICE_UNAVAILABLE);
    this.name = "StandardsUpdateHttpError";
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : "SERVICE_UNAVAILABLE";
  }
}

function fail(code) { throw new StandardsUpdateHttpError(code); }

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function canonicalOrigin(value) {
  if (typeof value !== "string") throw new TypeError("expectedOrigin 必须是 HTTPS origin");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new TypeError("expectedOrigin 必须是规范 HTTPS origin");
  }
  return value;
}

function rawHeaderValues(request, name) {
  const target = name.toLowerCase();
  if (Array.isArray(request.rawHeaders) && request.rawHeaders.length % 2 === 0) {
    const values = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (String(request.rawHeaders[index]).toLowerCase() === target) values.push(String(request.rawHeaders[index + 1]));
    }
    return values;
  }
  const value = request.headers?.[target];
  return value === undefined ? [] : (Array.isArray(value) ? value.map(String) : [String(value)]);
}

function singleHeader(request, name, { required = false } = {}) {
  const values = rawHeaderValues(request, name);
  if (values.length > 1 || (required && values.length !== 1)) fail("INVALID_HEADERS");
  return values[0];
}

function declaredLength(request) {
  if (singleHeader(request, "transfer-encoding") !== undefined) fail("TRANSFER_ENCODING_NOT_ALLOWED");
  const value = singleHeader(request, "content-length", { required: true });
  if (!/^(?:0|[1-9][0-9]{0,15})$/u.test(value)) fail("INVALID_HEADERS");
  const length = Number(value);
  if (!Number.isSafeInteger(length)) fail("INVALID_HEADERS");
  return length;
}

async function readBody(request, expectedLength) {
  if (!request || typeof request[Symbol.asyncIterator] !== "function") fail("INVALID_JSON");
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_JSON_BYTES) fail("REQUEST_TOO_LARGE");
    chunks.push(bytes);
  }
  if (total !== expectedLength) fail("BODY_LENGTH_MISMATCH");
  return Buffer.concat(chunks, total);
}

function commonHeaders() {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function sendJson(response, status, value, extraHeaders = {}) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, {
    ...commonHeaders(),
    "content-type": "application/json; charset=utf-8",
    "content-length": String(bytes.length),
    ...extraHeaders,
  });
  response.end(bytes);
}

function sendCurrent(response) {
  response.writeHead(204, { ...commonHeaders(), "content-length": "0" });
  response.end();
}

function sendPackage(response, bytes) {
  response.writeHead(200, {
    ...commonHeaders(),
    "content-type": PACKAGE_MEDIA_TYPE,
    "content-length": String(bytes.length),
  });
  response.end(bytes);
}

function normalizeError(error) {
  if (error instanceof StandardsUpdateHttpError) return error.code;
  if (error instanceof StandardsUpdateServiceError && Object.hasOwn(ERROR_STATUS, error.code)) return error.code;
  return "SERVICE_UNAVAILABLE";
}

function validateStandardsUpdateHttpErrorResponse(value) {
  if (!exactKeys(value, ["schema_version", "error", "request_id"]) || value.schema_version !== "1.0" ||
      !UUID_PATTERN.test(value.request_id || "") || !exactKeys(value.error, ["code", "message"]) ||
      !Object.hasOwn(ERROR_MESSAGES, value.error.code) || value.error.message !== ERROR_MESSAGES[value.error.code]) {
    throw new TypeError("标准更新 HTTP error 不符合 exact v1 契约");
  }
  return true;
}

function validateStandardsUpdateHttpAuditEvent(value) {
  if (!exactKeys(value, [
    "schema_version", "event_type", "request_id", "occurred_at", "method", "route",
    "http_status", "error_code",
  ]) || value.schema_version !== "1.0" || value.event_type !== "standards_update_http_request_completed" ||
      !UUID_PATTERN.test(value.request_id || "") || !METHOD_PATTERN.test(value.method || "") ||
      ![STANDARDS_UPDATE_API_PATH, "unmatched"].includes(value.route) ||
      !Number.isInteger(value.http_status) || value.http_status < 100 || value.http_status > 599 ||
      !(value.error_code === null || Object.hasOwn(ERROR_MESSAGES, value.error_code)) ||
      typeof value.occurred_at !== "string" || Number.isNaN(Date.parse(value.occurred_at))) {
    throw new TypeError("标准更新 HTTP audit 不符合 exact v1 契约");
  }
  return true;
}

function createStandardsUpdateHttpHandler({
  service,
  expectedOrigin,
  isSecureRequest = (request) => request.socket?.encrypted === true,
  requestIdFactory = randomUUID,
  clock = () => new Date(),
  securityEventSink = () => {},
} = {}) {
  if (!service || typeof service.check !== "function") throw new TypeError("标准更新 service 未实现 check");
  canonicalOrigin(expectedOrigin);
  if ([isSecureRequest, requestIdFactory, clock, securityEventSink].some((item) => typeof item !== "function")) {
    throw new TypeError("标准更新 HTTP handler 适配器必须是函数");
  }
  return async function handleStandardsUpdateRequest(request, response) {
    const candidateId = requestIdFactory();
    const requestId = typeof candidateId === "string" && UUID_PATTERN.test(candidateId) ? candidateId : randomUUID();
    const method = typeof request.method === "string" ? request.method.toUpperCase() : "";
    let route = "unmatched";
    let status = 500;
    let errorCode = null;
    try {
      if (isSecureRequest(request) !== true) fail("INSECURE_TRANSPORT");
      if (request.url !== STANDARDS_UPDATE_API_PATH) fail("NOT_FOUND");
      route = STANDARDS_UPDATE_API_PATH;
      if (method !== "POST") fail("METHOD_NOT_ALLOWED");
      if (singleHeader(request, "authorization") !== undefined || singleHeader(request, "cookie") !== undefined) {
        fail("CREDENTIALS_NOT_ALLOWED");
      }
      if (singleHeader(request, "accept", { required: true }) !== PACKAGE_MEDIA_TYPE ||
          singleHeader(request, "content-type", { required: true }) !== "application/json") {
        fail("UNSUPPORTED_MEDIA_TYPE");
      }
      const length = declaredLength(request);
      if (length < 2 || length > MAX_JSON_BYTES) fail("REQUEST_TOO_LARGE");
      const bytes = await readBody(request, length);
      let input;
      try { input = JSON.parse(bytes.toString("utf8")); }
      catch { fail("INVALID_JSON"); }
      validateStandardsUpdateRequest(input);
      const result = await service.check(input);
      if (result && result.outcome === "current" && Object.keys(result).length === 1) {
        status = 204;
        sendCurrent(response);
        return;
      }
      if (!result || result.outcome !== "update" || !Buffer.isBuffer(result.envelopeBytes) ||
          Object.keys(result).sort().join("\0") !== ["envelopeBytes", "outcome"].sort().join("\0")) {
        fail("SERVICE_UNAVAILABLE");
      }
      status = 200;
      sendPackage(response, result.envelopeBytes);
    } catch (error) {
      errorCode = normalizeError(error);
      status = ERROR_STATUS[errorCode] || 503;
      const body = {
        schema_version: "1.0",
        error: { code: errorCode, message: ERROR_MESSAGES[errorCode] },
        request_id: requestId,
      };
      validateStandardsUpdateHttpErrorResponse(body);
      sendJson(response, status, body, errorCode === "METHOD_NOT_ALLOWED" ? { allow: "POST" } : {});
    } finally {
      try {
        const now = clock();
        const event = {
          schema_version: "1.0",
          event_type: "standards_update_http_request_completed",
          request_id: requestId,
          occurred_at: (now instanceof Date ? now : new Date(now)).toISOString(),
          method,
          route,
          http_status: status,
          error_code: errorCode,
        };
        validateStandardsUpdateHttpAuditEvent(event);
        const observed = securityEventSink(event);
        if (observed && typeof observed.catch === "function") observed.catch(() => {});
      } catch { /* Audit failures cannot alter the selected response. */ }
    }
  };
}

module.exports = {
  ERROR_MESSAGES,
  MAX_JSON_BYTES,
  PACKAGE_MEDIA_TYPE,
  STANDARDS_UPDATE_API_PATH,
  StandardsUpdateHttpError,
  createStandardsUpdateHttpHandler,
  validateStandardsUpdateHttpAuditEvent,
  validateStandardsUpdateHttpErrorResponse,
};
