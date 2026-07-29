// Same-origin account subscription/device management HTTP boundary.

"use strict";

const { randomUUID } = require("node:crypto");
const { ACCOUNT_PATTERN, DEVICE_PATTERN } = require("./entitlement-signer");
const { ERROR_MESSAGES: SERVICE_MESSAGES } = require("./license-account-service");

const LICENSE_ACCOUNT_API_PATH = "/manuscript/api/v1/account/license";
const REVOKE_ROUTE = `${LICENSE_ACCOUNT_API_PATH}/devices/:device_id/revoke`;
const REVOKE_PATTERN = new RegExp(`^${LICENSE_ACCOUNT_API_PATH}/devices/(device-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/revoke$`, "u");
const MAX_JSON_BYTES = 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const METHOD_PATTERN = /^[A-Z]{1,16}$/u;
const ERROR_STATUS = Object.freeze({
  AUTH_REQUIRED: 401,
  BODY_LENGTH_MISMATCH: 400,
  CROSS_SITE_REQUEST: 403,
  DEVICE_NOT_FOUND: 404,
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
  ...SERVICE_MESSAGES,
  BODY_LENGTH_MISMATCH: "请求体长度不一致",
  CROSS_SITE_REQUEST: "拒绝跨站请求",
  INSECURE_TRANSPORT: "账号订阅管理只接受 HTTPS",
  INVALID_HEADERS: "请求头非法",
  INVALID_JSON: "JSON 请求体非法",
  INVALID_REQUEST: "设备管理请求不符合 v1 契约",
  LENGTH_REQUIRED: "设备管理请求必须声明 Content-Length",
  METHOD_NOT_ALLOWED: "该路由不接受此方法",
  NOT_FOUND: "API 路由不存在",
  REQUEST_TOO_LARGE: "设备管理请求超过上限",
  TRANSFER_ENCODING_NOT_ALLOWED: "不接受流式 Transfer-Encoding",
  UNSUPPORTED_MEDIA_TYPE: "请求媒体类型不受支持",
});

class LicenseAccountHttpError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.SERVICE_UNAVAILABLE);
    this.name = "LicenseAccountHttpError";
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : "SERVICE_UNAVAILABLE";
  }
}

function fail(code) { throw new LicenseAccountHttpError(code); }

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
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

function validateBearerSession(value) {
  if (!exactKeys(value, ["principal", "auth_mode"]) || value.auth_mode !== "bearer" ||
      !exactKeys(value.principal, ["kind", "subject_id"]) || value.principal.kind !== "account" ||
      !ACCOUNT_PATTERN.test(value.principal.subject_id || "")) fail("AUTH_REQUIRED");
  return value;
}

function validateRevokeRequest(value) {
  if (!exactKeys(value, ["schema_version", "action"]) || value.schema_version !== "1.0" ||
      value.action !== "revoke_device") fail("INVALID_REQUEST");
  return true;
}

function canonicalTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validatePublicDevice(value, revokedOnly = false) {
  if (!exactKeys(value, ["device_id", "device_state", "first_seen_at", "last_seen_at", "revoked_at"]) ||
      !DEVICE_PATTERN.test(value.device_id || "") || !["active", "revoked"].includes(value.device_state) ||
      (revokedOnly && value.device_state !== "revoked") || !canonicalTime(value.first_seen_at) ||
      !canonicalTime(value.last_seen_at) || Date.parse(value.first_seen_at) > Date.parse(value.last_seen_at) ||
      (value.device_state === "active" ? value.revoked_at !== null : !canonicalTime(value.revoked_at))) {
    throw new TypeError("设备管理 HTTP device 响应非法");
  }
  return true;
}

function validateLicenseAccountResponse(value) {
  if (!exactKeys(value, ["schema_version", "account_type", "entitlement", "devices", "truncated"]) ||
      value.schema_version !== "1.0" || value.account_type !== "oak_manuscript_license_account" ||
      !Array.isArray(value.devices) || value.devices.length > 20 || typeof value.truncated !== "boolean") {
    throw new TypeError("账号订阅 HTTP overview 响应非法");
  }
  value.devices.forEach((item) => validatePublicDevice(item));
  if (new Set(value.devices.map((item) => item.device_id)).size !== value.devices.length) {
    throw new TypeError("账号订阅 HTTP device 重复");
  }
  if (value.entitlement !== null) {
    const item = value.entitlement;
    if (!exactKeys(item, ["entitlement_state", "not_before", "valid_until", "grace_until"]) ||
        !["active", "revoked"].includes(item.entitlement_state) ||
        ![item.not_before, item.valid_until, item.grace_until].every(canonicalTime) ||
        Date.parse(item.not_before) > Date.parse(item.valid_until) ||
        Date.parse(item.valid_until) > Date.parse(item.grace_until)) {
      throw new TypeError("账号订阅 HTTP entitlement 响应非法");
    }
  }
  return true;
}

function validateRevokeResponse(value) {
  if (!exactKeys(value, ["schema_version", "outcome", "device"]) || value.schema_version !== "1.0" ||
      value.outcome !== "revoked") throw new TypeError("设备撤销 HTTP 响应非法");
  validatePublicDevice(value.device, true);
  return true;
}

function sendJson(response, status, value, extraHeaders = {}) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  if (bytes.length > 64 * 1024) throw new TypeError("账号订阅 HTTP 响应超过上限");
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
  return error && typeof error.code === "string" && Object.hasOwn(ERROR_STATUS, error.code)
    ? error.code : "SERVICE_UNAVAILABLE";
}

function validateLicenseAccountHttpErrorResponse(value) {
  if (!exactKeys(value, ["schema_version", "error", "request_id"]) || value.schema_version !== "1.0" ||
      !UUID_PATTERN.test(value.request_id || "") || !exactKeys(value.error, ["code", "message"]) ||
      !Object.hasOwn(ERROR_MESSAGES, value.error.code) || value.error.message !== ERROR_MESSAGES[value.error.code]) {
    throw new TypeError("账号订阅 HTTP error 不符合 exact v1 契约");
  }
  return true;
}

function validateLicenseAccountAuditEvent(value) {
  if (!exactKeys(value, ["schema_version", "event_type", "request_id", "occurred_at", "method", "route", "http_status", "error_code"]) ||
      value.schema_version !== "1.0" || value.event_type !== "license_account_http_request_completed" ||
      !UUID_PATTERN.test(value.request_id || "") || !METHOD_PATTERN.test(value.method || "") ||
      ![LICENSE_ACCOUNT_API_PATH, REVOKE_ROUTE, "unmatched"].includes(value.route) ||
      !Number.isInteger(value.http_status) || value.http_status < 100 || value.http_status > 599 ||
      !(value.error_code === null || Object.hasOwn(ERROR_MESSAGES, value.error_code)) || !canonicalTime(value.occurred_at)) {
    throw new TypeError("账号订阅 HTTP audit 不符合 exact v1 契约");
  }
  return true;
}

function createLicenseAccountHttpHandler({
  service,
  expectedOrigin,
  resolveSession,
  isSecureRequest = (request) => request.socket?.encrypted === true,
  requestIdFactory = randomUUID,
  clock = () => new Date(),
  securityEventSink = () => {},
} = {}) {
  if (!service || typeof service.getOverview !== "function" || typeof service.revokeDevice !== "function") {
    throw new TypeError("账号订阅 service 接口不完整");
  }
  const origin = canonicalOrigin(expectedOrigin);
  if ([resolveSession, isSecureRequest, requestIdFactory, clock, securityEventSink].some((item) => typeof item !== "function")) {
    throw new TypeError("账号订阅 HTTP handler 适配器必须是函数");
  }
  return async function handleLicenseAccountRequest(request, response) {
    const candidateId = requestIdFactory();
    const requestId = typeof candidateId === "string" && UUID_PATTERN.test(candidateId) ? candidateId : randomUUID();
    const method = typeof request.method === "string" ? request.method.toUpperCase() : "";
    let route = "unmatched";
    let status = 500;
    let errorCode = null;
    try {
      if (isSecureRequest(request) !== true) fail("INSECURE_TRANSPORT");
      const revokeMatch = typeof request.url === "string" ? request.url.match(REVOKE_PATTERN) : null;
      if (request.url === LICENSE_ACCOUNT_API_PATH) route = LICENSE_ACCOUNT_API_PATH;
      else if (revokeMatch) route = REVOKE_ROUTE;
      else fail("NOT_FOUND");
      if ((route === LICENSE_ACCOUNT_API_PATH && method !== "GET") || (route === REVOKE_ROUTE && method !== "POST")) {
        fail("METHOD_NOT_ALLOWED");
      }
      const requestOrigin = singleHeader(request, "origin");
      const fetchSite = singleHeader(request, "sec-fetch-site");
      if ((requestOrigin !== undefined && requestOrigin !== origin) ||
          (fetchSite !== undefined && fetchSite !== "same-origin") ||
          (method === "POST" && requestOrigin !== origin)) fail("CROSS_SITE_REQUEST");
      const session = validateBearerSession(await resolveSession(request));
      let result;
      if (route === LICENSE_ACCOUNT_API_PATH) {
        if (singleHeader(request, "transfer-encoding") !== undefined) fail("TRANSFER_ENCODING_NOT_ALLOWED");
        const length = singleHeader(request, "content-length");
        if (length !== undefined && length !== "0") fail("INVALID_HEADERS");
        result = await service.getOverview(session.principal);
        validateLicenseAccountResponse(result);
      } else {
        if (singleHeader(request, "content-type", { required: true }) !== "application/json") fail("UNSUPPORTED_MEDIA_TYPE");
        const length = declaredLength(request);
        if (length > MAX_JSON_BYTES) fail("REQUEST_TOO_LARGE");
        const bytes = await readBody(request, length);
        let input;
        try { input = JSON.parse(bytes.toString("utf8")); } catch { fail("INVALID_JSON"); }
        validateRevokeRequest(input);
        result = await service.revokeDevice(session.principal, revokeMatch[1]);
        validateRevokeResponse(result);
      }
      status = 200;
      sendJson(response, status, result);
      return;
    } catch (error) {
      errorCode = normalizeError(error);
      status = ERROR_STATUS[errorCode] || 503;
      const body = { schema_version: "1.0", error: { code: errorCode, message: ERROR_MESSAGES[errorCode] }, request_id: requestId };
      validateLicenseAccountHttpErrorResponse(body);
      sendJson(response, status, body, errorCode === "METHOD_NOT_ALLOWED" ? { allow: route === REVOKE_ROUTE ? "POST" : "GET" } : {});
    } finally {
      try {
        const current = clock();
        const event = {
          schema_version: "1.0", event_type: "license_account_http_request_completed", request_id: requestId,
          occurred_at: (current instanceof Date ? current : new Date(current)).toISOString(),
          method, route, http_status: status, error_code: errorCode,
        };
        validateLicenseAccountAuditEvent(event);
        const observed = securityEventSink(event);
        if (observed && typeof observed.catch === "function") observed.catch(() => {});
      } catch { /* Audit failure cannot change the selected response. */ }
    }
  };
}

module.exports = {
  ERROR_MESSAGES,
  LICENSE_ACCOUNT_API_PATH,
  LicenseAccountHttpError,
  MAX_JSON_BYTES,
  REVOKE_ROUTE,
  createLicenseAccountHttpHandler,
  validateLicenseAccountAuditEvent,
  validateLicenseAccountHttpErrorResponse,
  validateLicenseAccountResponse,
  validateRevokeRequest,
  validateRevokeResponse,
};
