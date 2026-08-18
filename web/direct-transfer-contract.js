"use strict";

const JOB_ID_PATTERN = /^webjob-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TRANSFER_ID_PATTERN = /^webtransfer-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MEDIA_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/epub+zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
]);
const CREDENTIAL_KEYS = Object.freeze([
  "schema_version", "credential_type", "transfer_id", "job_id", "method", "url",
  "headers", "media_type", "size_bytes", "expires_at", "complete_path", "claim_policy",
]);
const COMPLETION_KEYS = Object.freeze(["schema_version", "request_type", "transfer_id"]);
const CACHE_CONTROL = "private, no-store, max-age=0";

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}必须是对象`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label}字段集合非法`);
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

function currentDate(value, label) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${label}非法`);
  return date;
}

function amzTime(value) {
  if (typeof value !== "string" || !/^\d{8}T\d{6}Z$/.test(value)) return NaN;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T` +
    `${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) || new Date(parsed).toISOString().replace(/[-:]|\.000/g, "") !== value
    ? NaN : parsed;
}

function validateHeaders(value, kind, mediaType) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 16) {
    throw new TypeError("直传 headers 非法");
  }
  const result = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) ||
        /^(authorization|cookie|proxy-authorization|x-api-key)$/i.test(name) ||
        typeof headerValue !== "string" || headerValue.length > 1024 ||
        /[\u0000-\u001f\u007f\r\n]/.test(headerValue)) {
      throw new TypeError("直传 headers 非法");
    }
    result[name] = headerValue;
  }
  if (kind === "upload") {
    if (result["content-type"] !== mediaType || result["cache-control"] !== CACHE_CONTROL ||
        result["if-none-match"] !== "*") {
      throw new TypeError("上传凭证缺少固定请求头");
    }
  } else if (Object.keys(result).length !== 0) {
    throw new TypeError("下载凭证不得要求浏览器秘密请求头");
  }
  return Object.freeze(result);
}

function validateDirectTransferCredential(input, {
  expectedStorageOrigin,
  now = new Date(),
  maxLifetimeSeconds = 300,
} = {}) {
  const value = exactKeys(input, CREDENTIAL_KEYS, "直传凭证");
  if (value.schema_version !== "1.0" || value.claim_policy !== "single_issue" ||
      !TRANSFER_ID_PATTERN.test(value.transfer_id || "") || !JOB_ID_PATTERN.test(value.job_id || "") ||
      !MEDIA_TYPES.has(value.media_type) || !Number.isSafeInteger(value.size_bytes) ||
      value.size_bytes < 1 || value.size_bytes > 100 * 1024 * 1024) {
    throw new TypeError("直传凭证身份或载荷声明非法");
  }
  const kind = value.credential_type === "oak_manuscript_direct_upload" ? "upload" :
    value.credential_type === "oak_manuscript_direct_download" ? "download" : null;
  if (!kind || value.method !== (kind === "upload" ? "PUT" : "GET")) {
    throw new TypeError("直传凭证类型或方法非法");
  }
  if (typeof expectedStorageOrigin !== "string") throw new TypeError("expectedStorageOrigin 必须显式提供");
  let expected;
  let url;
  try {
    expected = new URL(expectedStorageOrigin);
    url = new URL(value.url);
  } catch {
    throw new TypeError("直传 URL 非法");
  }
  if (expected.protocol !== "https:" || expected.origin !== expectedStorageOrigin || expected.pathname !== "/" ||
      url.protocol !== "https:" || url.origin !== expected.origin || url.username || url.password || url.hash ||
      value.url.length > 8192 || url.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
      !url.searchParams.get("X-Amz-Signature")) {
    throw new TypeError("直传 URL 未绑定受信存储源");
  }
  const signedLifetime = Number(url.searchParams.get("X-Amz-Expires"));
  if (!Number.isSafeInteger(signedLifetime) || signedLifetime < 1 || signedLifetime > maxLifetimeSeconds) {
    throw new TypeError("直传 URL 签名时限非法");
  }
  const current = currentDate(now, "now");
  const expiresAt = Date.parse(canonicalTime(value.expires_at, "expires_at"));
  const signedAt = amzTime(url.searchParams.get("X-Amz-Date"));
  if (!Number.isSafeInteger(maxLifetimeSeconds) || maxLifetimeSeconds < 1 || maxLifetimeSeconds > 300 ||
      expiresAt <= current.getTime() || expiresAt > current.getTime() + maxLifetimeSeconds * 1000) {
    throw new TypeError("直传凭证有效期非法");
  }
  const suffix = kind === "upload" ? "input" : "result";
  const expectedCompletePath = `/manuscript/api/v2/jobs/${value.job_id}/${suffix}-transfer/${value.transfer_id}/complete`;
  if (value.complete_path !== expectedCompletePath) throw new TypeError("直传完成路径未绑定任务与凭证");
  const headers = validateHeaders(value.headers, kind, value.media_type);
  const signedHeaders = new Set((url.searchParams.get("X-Amz-SignedHeaders") || "").split(";"));
  if (Number.isNaN(signedAt) || Math.abs(expiresAt - (signedAt + signedLifetime * 1000)) >= 1000 ||
      !signedHeaders.has("host") || (kind === "upload" &&
        Object.keys(headers).some((name) => !signedHeaders.has(name)))) {
    throw new TypeError("直传 URL 未精确签名声明头或有效期");
  }
  return Object.freeze({ ...value, headers });
}

function buildTransferCompletion({ transferId } = {}) {
  if (typeof transferId !== "string" || !TRANSFER_ID_PATTERN.test(transferId)) {
    throw new TypeError("transferId 非法");
  }
  const value = {
    schema_version: "1.0",
    request_type: "oak_manuscript_direct_transfer_completion",
    transfer_id: transferId,
  };
  exactKeys(value, COMPLETION_KEYS, "直传完成请求");
  return Object.freeze(value);
}

function validateTransferCompletion(input, expectedTransferId) {
  const value = exactKeys(input, COMPLETION_KEYS, "直传完成请求");
  if (value.schema_version !== "1.0" ||
      value.request_type !== "oak_manuscript_direct_transfer_completion" ||
      !TRANSFER_ID_PATTERN.test(value.transfer_id || "") || value.transfer_id !== expectedTransferId) {
    throw new TypeError("直传完成请求未绑定当前凭证");
  }
  return Object.freeze({ ...value });
}

module.exports = {
  CACHE_CONTROL,
  JOB_ID_PATTERN,
  TRANSFER_ID_PATTERN,
  buildTransferCompletion,
  validateDirectTransferCredential,
  validateTransferCompletion,
};
