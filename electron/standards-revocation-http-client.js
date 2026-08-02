"use strict";

const { DEFAULT_LIMITS } = require("./standards-store");

const DEFAULT_TIMEOUT_MS = 10_000;
const REVOCATION_API_PATH = "/manuscript/standards/v1/revocations";
const REVOCATION_MEDIA_TYPE = "application/vnd.oak.standard-revocation+json";
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const REQUEST_KEYS = Object.freeze(["appVersion", "bundleId"]);

class StandardsRevocationHttpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StandardsRevocationHttpError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new StandardsRevocationHttpError(code, message);
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function canonicalHttpsEndpoint(value) {
  if (typeof value !== "string") throw new TypeError("标准撤回端点必须是 HTTPS URL");
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new TypeError("标准撤回端点必须是 HTTPS URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash ||
      parsed.search || parsed.pathname !== REVOCATION_API_PATH || parsed.toString() !== value) {
    throw new TypeError("标准撤回端点必须是规范固定 HTTPS URL");
  }
  return value;
}

function requestBody(value) {
  if (!exactKeys(value, REQUEST_KEYS) || !APP_VERSION_PATTERN.test(value.appVersion || "") ||
      !ID_PATTERN.test(value.bundleId || "")) {
    throw new TypeError("标准撤回获取请求非法");
  }
  return JSON.stringify({
    schema_version: "1.0",
    request_type: "oak_manuscript_standard_revocation_fetch",
    app_version: value.appVersion,
    bundle_id: value.bundleId,
  });
}

async function readBoundedBody(response) {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^(?:0|[1-9][0-9]{0,15})$/u.test(declared) ||
      Number(declared) < 1 || Number(declared) > DEFAULT_LIMITS.revocationEnvelopeBytes)) {
    fail("STANDARDS_REVOCATION_RESPONSE_INVALID", "标准撤回服务返回了非法签名清单");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    fail("STANDARDS_REVOCATION_RESPONSE_INVALID", "标准撤回服务返回了非法签名清单");
  }
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > DEFAULT_LIMITS.revocationEnvelopeBytes) {
        await reader.cancel();
        fail("STANDARDS_REVOCATION_RESPONSE_INVALID", "标准撤回服务返回了非法签名清单");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof StandardsRevocationHttpError) throw error;
    fail("STANDARDS_REVOCATION_RESPONSE_INVALID", "标准撤回服务返回了非法签名清单");
  }
  if (total < 1 || (declared !== null && total !== Number(declared))) {
    fail("STANDARDS_REVOCATION_RESPONSE_INVALID", "标准撤回服务返回了非法签名清单");
  }
  return Buffer.concat(chunks, total);
}

class StandardsRevocationHttpClient {
  constructor({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.endpoint = canonicalHttpsEndpoint(endpoint);
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl 必须是函数");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      throw new TypeError("timeoutMs 非法");
    }
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async fetch(input) {
    const body = requestBody(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          accept: REVOCATION_MEDIA_TYPE,
          "content-length": String(Buffer.byteLength(body)),
          "content-type": "application/json",
        },
        body,
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        fail("STANDARDS_REVOCATION_TIMEOUT", "标准撤回获取超时");
      }
      fail("STANDARDS_REVOCATION_UNAVAILABLE", "标准撤回服务暂时不可用");
    } finally {
      clearTimeout(timer);
    }
    if (!response || response.status !== 200 || !response.headers) {
      fail("STANDARDS_REVOCATION_UNAVAILABLE", "标准撤回服务暂时不可用");
    }
    if ((response.headers.get("content-type") || "").toLowerCase() !== REVOCATION_MEDIA_TYPE ||
        response.headers.get("content-encoding") !== null ||
        response.headers.get("content-range") !== null ||
        response.headers.get("set-cookie") !== null) {
      fail("STANDARDS_REVOCATION_RESPONSE_INVALID", "标准撤回服务返回了非法签名清单");
    }
    return Object.freeze({ envelopeBytes: await readBoundedBody(response) });
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  REVOCATION_API_PATH,
  REVOCATION_MEDIA_TYPE,
  StandardsRevocationHttpClient,
  StandardsRevocationHttpError,
};
