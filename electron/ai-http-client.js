"use strict";

const http = require("node:http");
const https = require("node:https");

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_REQUEST_BYTES = 32 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_HEADER_COUNT = 16;
const MAX_HEADER_BYTES = 8 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN_HEADERS = new Set([
  "accept", "accept-encoding", "connection", "content-length", "content-type",
  "cookie", "forwarded", "host", "origin", "proxy-authenticate",
  "proxy-authorization", "referer", "set-cookie", "te", "trailer",
  "transfer-encoding", "upgrade", "via",
]);
const JSON_CONTENT_TYPE_RE = /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;\s*charset=utf-8)?$/iu;

class AIHttpClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AIHttpClientError";
    this.code = code;
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} 必须是对象`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} 字段集合非法`);
  }
  return value;
}

function validateEndpoint(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048 ||
      /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError("AI 请求地址非法");
  }
  let endpoint;
  try { endpoint = new URL(value); } catch { throw new TypeError("AI 请求地址非法"); }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new TypeError("AI 请求地址不得包含凭据、查询或片段");
  }
  if (endpoint.protocol === "https:") return endpoint;
  if (endpoint.protocol === "http:" && LOOPBACK_HOSTS.has(endpoint.hostname)) return endpoint;
  throw new TypeError("AI 请求只允许 HTTPS；本机 HTTP 仅限精确 loopback");
}

function validateHeaders(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype) {
    throw new TypeError("AI 请求头必须是普通对象");
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_HEADER_COUNT) throw new TypeError("AI 请求头数量超限");
  const output = Object.create(null);
  let totalBytes = 0;
  for (const [rawName, value] of entries) {
    if (!HEADER_NAME_RE.test(rawName) || typeof value !== "string" || value.length < 1 ||
        /[\r\n\u0000]/u.test(value)) {
      throw new TypeError("AI 请求头非法");
    }
    const name = rawName.toLowerCase();
    if (FORBIDDEN_HEADERS.has(name) || name.startsWith("x-forwarded-")) {
      throw new TypeError(`AI 请求头 ${name} 不允许由供应商适配器设置`);
    }
    if (Object.hasOwn(output, name)) throw new TypeError("AI 请求头重复");
    totalBytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8") + 4;
    if (totalBytes > MAX_HEADER_BYTES) throw new TypeError("AI 请求头总大小超限");
    output[name] = value;
  }
  return output;
}

function validateJson(value, state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    throw new TypeError("AI JSON 请求结构超限");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("AI JSON 请求包含非法数字");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validateJson(item, state, depth + 1);
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("AI JSON 请求只能包含普通 JSON 值");
  }
  for (const [key, item] of Object.entries(value)) {
    if (key.length < 1 || key.length > 256 ||
        new Set(["__proto__", "constructor", "prototype"]).has(key)) {
      throw new TypeError("AI JSON 请求键非法");
    }
    validateJson(item, state, depth + 1);
  }
}

function singleHeader(response, name) {
  const values = [];
  const raw = Array.isArray(response.rawHeaders) ? response.rawHeaders : [];
  if (raw.length % 2 !== 0) throw new AIHttpClientError("INVALID_RESPONSE", "AI 响应头非法");
  for (let index = 0; index + 1 < raw.length; index += 2) {
    if (String(raw[index]).toLowerCase() === name) values.push(String(raw[index + 1]));
  }
  if (values.length > 1) throw new AIHttpClientError("INVALID_RESPONSE", "AI 响应头非法");
  if (values.length === 1) return values[0];
  const fallback = response.headers && response.headers[name];
  if (Array.isArray(fallback)) {
    if (fallback.length > 1) throw new AIHttpClientError("INVALID_RESPONSE", "AI 响应头非法");
    return fallback[0] === undefined ? null : String(fallback[0]);
  }
  return fallback === undefined ? null : String(fallback);
}

function readJsonResponse(response, maxResponseBytes) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    try {
      if (!response || typeof response !== "object" ||
          typeof response.on !== "function" || typeof response.destroy !== "function") {
        throw new AIHttpClientError("INVALID_RESPONSE", "AI 响应对象非法");
      }
      const statusCode = response.statusCode;
      if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode > 299) {
        if (typeof response.destroy === "function") response.destroy();
        finish(reject, new AIHttpClientError(
          statusCode >= 300 && statusCode <= 399 ? "REDIRECT_REJECTED" : "UPSTREAM_STATUS",
          "AI 服务未返回可接受的成功响应",
        ));
        return;
      }
      const contentType = singleHeader(response, "content-type");
      if (!contentType || !JSON_CONTENT_TYPE_RE.test(contentType.trim())) {
        if (typeof response.destroy === "function") response.destroy();
        finish(reject, new AIHttpClientError("INVALID_RESPONSE", "AI 响应不是受支持的 JSON"));
        return;
      }
      const contentEncoding = singleHeader(response, "content-encoding");
      if (contentEncoding && contentEncoding.trim().toLowerCase() !== "identity") {
        if (typeof response.destroy === "function") response.destroy();
        finish(reject, new AIHttpClientError("INVALID_RESPONSE", "AI 响应压缩格式不受支持"));
        return;
      }
      const declared = singleHeader(response, "content-length");
      if (declared !== null && (!/^(0|[1-9][0-9]*)$/u.test(declared) ||
          Number(declared) > maxResponseBytes)) {
        if (typeof response.destroy === "function") response.destroy();
        finish(reject, new AIHttpClientError("RESPONSE_TOO_LARGE", "AI 响应超过安全上限"));
        return;
      }
    } catch (error) {
      if (typeof response.destroy === "function") response.destroy();
      finish(reject, error instanceof AIHttpClientError
        ? error : new AIHttpClientError("INVALID_RESPONSE", "AI 响应头非法"));
      return;
    }

    const chunks = [];
    let total = 0;
    response.on("data", (chunk) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > maxResponseBytes) {
        if (typeof response.destroy === "function") response.destroy();
        finish(reject, new AIHttpClientError("RESPONSE_TOO_LARGE", "AI 响应超过安全上限"));
        return;
      }
      chunks.push(bytes);
    });
    response.on("end", () => {
      if (settled) return;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
        finish(resolve, parsed);
      } catch {
        finish(reject, new AIHttpClientError("INVALID_RESPONSE", "AI 响应 JSON 无法解析"));
      }
    });
    response.on("error", () => finish(
      reject, new AIHttpClientError("NETWORK_FAILED", "AI 网络响应失败"),
    ));
    response.on("aborted", () => finish(
      reject, new AIHttpClientError("NETWORK_FAILED", "AI 网络响应中断"),
    ));
  });
}

class BoundedAIHttpClient {
  constructor({
    httpsRequest = https.request,
    httpRequest = http.request,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  } = {}) {
    if (typeof httpsRequest !== "function" || typeof httpRequest !== "function") {
      throw new TypeError("AI HTTP 请求实现非法");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new TypeError("AI HTTP timeout 非法");
    }
    for (const [label, value, max] of [
      ["maxRequestBytes", maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES],
      ["maxResponseBytes", maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES],
    ]) {
      if (!Number.isSafeInteger(value) || value < 1 || value > max) {
        throw new TypeError(`AI HTTP ${label} 非法`);
      }
    }
    this.httpsRequest = httpsRequest;
    this.httpRequest = httpRequest;
    this.timeoutMs = timeoutMs;
    this.maxRequestBytes = maxRequestBytes;
    this.maxResponseBytes = maxResponseBytes;
  }

  requestJson(input) {
    const descriptor = exactKeys(input, ["url", "headers", "json"], "AI HTTP 请求");
    const endpoint = validateEndpoint(descriptor.url);
    const providerHeaders = validateHeaders(descriptor.headers);
    validateJson(descriptor.json);
    let body;
    try { body = Buffer.from(JSON.stringify(descriptor.json), "utf8"); }
    catch { throw new TypeError("AI JSON 请求无法序列化"); }
    if (body.length < 2 || body.length > this.maxRequestBytes) {
      throw new AIHttpClientError("REQUEST_TOO_LARGE", "AI 请求超过安全上限");
    }
    const headers = {
      ...providerHeaders,
      accept: "application/json",
      "accept-encoding": "identity",
      "content-type": "application/json; charset=utf-8",
      "content-length": String(body.length),
    };
    const requestImpl = endpoint.protocol === "https:" ? this.httpsRequest : this.httpRequest;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      let request;
      try {
        request = requestImpl(endpoint, {
          method: "POST",
          headers,
          agent: false,
          timeout: this.timeoutMs,
          setHost: true,
        }, (response) => {
          readJsonResponse(response, this.maxResponseBytes).then(
            (json) => finish(resolve, json),
            (error) => finish(reject, error),
          );
        });
      } catch {
        finish(reject, new AIHttpClientError("NETWORK_FAILED", "AI 网络请求无法启动"));
        return;
      }
      if (!request || typeof request.on !== "function" ||
          typeof request.setTimeout !== "function" || typeof request.end !== "function" ||
          typeof request.destroy !== "function") {
        if (request && typeof request.destroy === "function") request.destroy();
        finish(reject, new AIHttpClientError("NETWORK_FAILED", "AI 网络请求对象非法"));
        return;
      }
      try {
        request.on("error", () => finish(
          reject, new AIHttpClientError("NETWORK_FAILED", "AI 网络请求失败"),
        ));
        request.setTimeout(this.timeoutMs, () => {
          request.destroy();
          finish(reject, new AIHttpClientError("NETWORK_TIMEOUT", "AI 网络请求超时"));
        });
        request.end(body);
      } catch {
        request.destroy();
        finish(reject, new AIHttpClientError("NETWORK_FAILED", "AI 网络请求无法发送"));
      }
    });
  }
}

module.exports = {
  AIHttpClientError,
  BoundedAIHttpClient,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  MAX_HEADER_BYTES,
  MAX_HEADER_COUNT,
  MAX_TIMEOUT_MS,
  readJsonResponse,
  validateEndpoint,
  validateHeaders,
  validateJson,
};
