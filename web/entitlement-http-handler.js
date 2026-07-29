// HTTPS/Bearer-only endpoint for desktop signed entitlement refresh.

"use strict";

const { randomUUID } = require("node:crypto");
const { ERROR_MESSAGES: SERVICE_MESSAGES, validateEntitlementRequest } = require("./entitlement-service");
const {
  ACCOUNT_PATTERN,
  AUDIENCE,
  CLAIM_KEYS,
  DEVICE_PATTERN,
  ENTITLEMENT_PATTERN,
} = require("./entitlement-signer");

const ENTITLEMENT_API_PATH = "/manuscript/api/v1/entitlement";
const MAX_JSON_BYTES = 4 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const METHOD_PATTERN = /^[A-Z]{1,16}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
const ERROR_STATUS = Object.freeze({
  AUTH_REQUIRED: 401,
  BODY_LENGTH_MISMATCH: 400,
  CROSS_SITE_REQUEST: 403,
  DEVICE_LIMIT: 429,
  INSECURE_TRANSPORT: 400,
  INVALID_HEADERS: 400,
  INVALID_JSON: 400,
  INVALID_REQUEST: 400,
  LENGTH_REQUIRED: 411,
  METHOD_NOT_ALLOWED: 405,
  NOT_FOUND: 404,
  REQUEST_TOO_LARGE: 413,
  SERVICE_UNAVAILABLE: 503,
  SUBSCRIPTION_REQUIRED: 403,
  TRANSFER_ENCODING_NOT_ALLOWED: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
});
const ERROR_MESSAGES = Object.freeze({
  ...SERVICE_MESSAGES,
  BODY_LENGTH_MISMATCH: "请求体长度不一致",
  CROSS_SITE_REQUEST: "拒绝跨站请求",
  INSECURE_TRANSPORT: "订阅权益只接受 HTTPS",
  INVALID_HEADERS: "请求头非法",
  INVALID_JSON: "JSON 请求体非法",
  LENGTH_REQUIRED: "权益请求必须声明 Content-Length",
  METHOD_NOT_ALLOWED: "该路由只接受 POST",
  NOT_FOUND: "API 路由不存在",
  REQUEST_TOO_LARGE: "权益请求超过上限",
  TRANSFER_ENCODING_NOT_ALLOWED: "不接受流式 Transfer-Encoding",
  UNSUPPORTED_MEDIA_TYPE: "请求媒体类型不受支持",
});

class EntitlementHttpError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.SERVICE_UNAVAILABLE);
    this.name = "EntitlementHttpError";
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : "SERVICE_UNAVAILABLE";
  }
}

function fail(code) { throw new EntitlementHttpError(code); }

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
  return error && typeof error.code === "string" && Object.hasOwn(ERROR_STATUS, error.code)
    ? error.code
    : "SERVICE_UNAVAILABLE";
}

function validateEntitlementHttpErrorResponse(value) {
  if (!exactKeys(value, ["schema_version", "error", "request_id"]) || value.schema_version !== "1.0" ||
      !UUID_PATTERN.test(value.request_id || "") || !exactKeys(value.error, ["code", "message"]) ||
      !Object.hasOwn(ERROR_MESSAGES, value.error.code) || value.error.message !== ERROR_MESSAGES[value.error.code]) {
    throw new TypeError("权益 HTTP error 不符合 exact v1 契约");
  }
  return true;
}

function validateEntitlementHttpAuditEvent(value) {
  if (!exactKeys(value, ["schema_version", "event_type", "request_id", "occurred_at", "method", "route", "http_status", "error_code"]) ||
      value.schema_version !== "1.0" || value.event_type !== "license_http_request_completed" ||
      !UUID_PATTERN.test(value.request_id || "") || !METHOD_PATTERN.test(value.method || "") ||
      ![ENTITLEMENT_API_PATH, "unmatched"].includes(value.route) ||
      !Number.isInteger(value.http_status) || value.http_status < 100 || value.http_status > 599 ||
      !(value.error_code === null || Object.hasOwn(ERROR_MESSAGES, value.error_code)) ||
      typeof value.occurred_at !== "string" || Number.isNaN(Date.parse(value.occurred_at))) {
    throw new TypeError("权益 HTTP audit 不符合 exact v1 契约");
  }
  return true;
}

function canonicalUtcTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function canonicalIssuer(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.origin + "/" === value && parsed.pathname === "/" &&
      !parsed.search && !parsed.hash && !parsed.username && !parsed.password;
  } catch { return false; }
}

function validateSignedEntitlementResponse(value) {
  if (!exactKeys(value, ["schema_version", "record_type", "key_id", "algorithm", "claims", "signature"]) ||
      value.schema_version !== "1.0" || value.record_type !== "oak_manuscript_signed_entitlement" ||
      !KEY_ID_PATTERN.test(value.key_id || "") || value.algorithm !== "Ed25519" ||
      !SIGNATURE_PATTERN.test(value.signature || "") || !exactKeys(value.claims, CLAIM_KEYS)) {
    throw new TypeError("权益 HTTP response 不符合 exact v1 契约");
  }
  const claims = value.claims;
  if (!canonicalIssuer(claims.issuer) || claims.audience !== AUDIENCE ||
      !ENTITLEMENT_PATTERN.test(claims.entitlement_id || "") || !ACCOUNT_PATTERN.test(claims.account_id || "") ||
      !DEVICE_PATTERN.test(claims.device_id || "") || claims.tier !== "pro" ||
      !["active", "revoked"].includes(claims.device_state) ||
      ![claims.issued_at, claims.not_before, claims.valid_until, claims.grace_until].every(canonicalUtcTime) ||
      Date.parse(claims.issued_at) > Date.parse(claims.not_before) ||
      Date.parse(claims.not_before) > Date.parse(claims.valid_until) ||
      Date.parse(claims.valid_until) > Date.parse(claims.grace_until) ||
      Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_JSON_BYTES) {
    throw new TypeError("权益 HTTP response claims 非法");
  }
  return true;
}

function createEntitlementHttpHandler({
  service,
  expectedOrigin,
  resolveSession,
  isSecureRequest = (request) => request.socket?.encrypted === true,
  requestIdFactory = randomUUID,
  clock = () => new Date(),
  securityEventSink = () => {},
} = {}) {
  if (!service || typeof service.issue !== "function") throw new TypeError("权益 service 未实现 issue");
  const origin = canonicalOrigin(expectedOrigin);
  if ([resolveSession, isSecureRequest, requestIdFactory, clock, securityEventSink].some((item) => typeof item !== "function")) {
    throw new TypeError("权益 HTTP handler 适配器必须是函数");
  }
  return async function handleEntitlementRequest(request, response) {
    const candidateId = requestIdFactory();
    const requestId = typeof candidateId === "string" && UUID_PATTERN.test(candidateId) ? candidateId : randomUUID();
    const method = typeof request.method === "string" ? request.method.toUpperCase() : "";
    let route = "unmatched";
    let status = 500;
    let errorCode = null;
    try {
      if (isSecureRequest(request) !== true) fail("INSECURE_TRANSPORT");
      if (request.url !== ENTITLEMENT_API_PATH) fail("NOT_FOUND");
      route = ENTITLEMENT_API_PATH;
      if (method !== "POST") fail("METHOD_NOT_ALLOWED");
      const requestOrigin = singleHeader(request, "origin");
      const fetchSite = singleHeader(request, "sec-fetch-site");
      if ((requestOrigin !== undefined && requestOrigin !== origin) ||
          (fetchSite !== undefined && fetchSite !== "same-origin")) fail("CROSS_SITE_REQUEST");
      const session = validateBearerSession(await resolveSession(request));
      if (singleHeader(request, "content-type", { required: true }) !== "application/json") fail("UNSUPPORTED_MEDIA_TYPE");
      const length = declaredLength(request);
      if (length > MAX_JSON_BYTES) fail("REQUEST_TOO_LARGE");
      const bytes = await readBody(request, length);
      let input;
      try { input = JSON.parse(bytes.toString("utf8")); }
      catch { fail("INVALID_JSON"); }
      validateEntitlementRequest(input);
      const envelope = await service.issue(session.principal, input);
      validateSignedEntitlementResponse(envelope);
      status = 200;
      sendJson(response, status, envelope);
      return;
    } catch (error) {
      errorCode = normalizeError(error);
      status = ERROR_STATUS[errorCode] || 503;
      const body = { schema_version: "1.0", error: { code: errorCode, message: ERROR_MESSAGES[errorCode] }, request_id: requestId };
      validateEntitlementHttpErrorResponse(body);
      sendJson(response, status, body, errorCode === "METHOD_NOT_ALLOWED" ? { allow: "POST" } : {});
    } finally {
      try {
        const now = clock();
        const event = {
          schema_version: "1.0",
          event_type: "license_http_request_completed",
          request_id: requestId,
          occurred_at: (now instanceof Date ? now : new Date(now)).toISOString(),
          method,
          route,
          http_status: status,
          error_code: errorCode,
        };
        validateEntitlementHttpAuditEvent(event);
        const observed = securityEventSink(event);
        if (observed && typeof observed.catch === "function") observed.catch(() => {});
      } catch { /* Audit failures cannot alter the selected HTTP response. */ }
    }
  };
}

module.exports = {
  ENTITLEMENT_API_PATH,
  ERROR_MESSAGES,
  EntitlementHttpError,
  MAX_JSON_BYTES,
  createEntitlementHttpHandler,
  validateSignedEntitlementResponse,
  validateEntitlementHttpAuditEvent,
  validateEntitlementHttpErrorResponse,
};
