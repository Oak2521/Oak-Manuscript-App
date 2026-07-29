"use strict";

const { DEFAULT_LIMITS } = require("./standards-store");

const DEFAULT_TIMEOUT_MS = 10_000;
const PACKAGE_MEDIA_TYPE = "application/vnd.oak.standard-package+json";
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const REQUEST_KEYS = Object.freeze([
  "appVersion", "bundleId", "currentReleaseSequence", "currentManifestSha256",
]);

class StandardsUpdateHttpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StandardsUpdateHttpError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new StandardsUpdateHttpError(code, message);
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function canonicalHttpsEndpoint(value) {
  if (typeof value !== "string") throw new TypeError("标准更新端点必须是 HTTPS URL");
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new TypeError("标准更新端点必须是 HTTPS URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash ||
      parsed.search || parsed.toString() !== value) {
    throw new TypeError("标准更新端点必须是规范 HTTPS URL");
  }
  return value;
}

function requestBody(value) {
  if (!exactKeys(value, REQUEST_KEYS) || !APP_VERSION_PATTERN.test(value.appVersion || "") ||
      !ID_PATTERN.test(value.bundleId || "") || !Number.isSafeInteger(value.currentReleaseSequence) ||
      value.currentReleaseSequence < 1 || !SHA256_PATTERN.test(value.currentManifestSha256 || "")) {
    throw new TypeError("标准更新检查请求非法");
  }
  return JSON.stringify({
    schema_version: "1.0",
    request_type: "oak_manuscript_standard_update_check",
    app_version: value.appVersion,
    bundle_id: value.bundleId,
    current_release_sequence: value.currentReleaseSequence,
    current_manifest_sha256: value.currentManifestSha256,
  });
}

async function readBoundedBody(response) {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^(?:0|[1-9][0-9]{0,15})$/u.test(declared) ||
      Number(declared) < 1 || Number(declared) > DEFAULT_LIMITS.envelopeBytes)) {
    fail("STANDARDS_UPDATE_RESPONSE_INVALID", "标准更新服务返回了非法候选包");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    fail("STANDARDS_UPDATE_RESPONSE_INVALID", "标准更新服务返回了非法候选包");
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
      if (total > DEFAULT_LIMITS.envelopeBytes) {
        await reader.cancel();
        fail("STANDARDS_UPDATE_RESPONSE_INVALID", "标准更新服务返回了非法候选包");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof StandardsUpdateHttpError) throw error;
    fail("STANDARDS_UPDATE_RESPONSE_INVALID", "标准更新服务返回了非法候选包");
  }
  if (total < 1 || (declared !== null && total !== Number(declared))) {
    fail("STANDARDS_UPDATE_RESPONSE_INVALID", "标准更新服务返回了非法候选包");
  }
  return Buffer.concat(chunks, total);
}

class StandardsUpdateHttpClient {
  constructor({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.endpoint = canonicalHttpsEndpoint(endpoint);
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl 必须是函数");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      throw new TypeError("timeoutMs 非法");
    }
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async check(input) {
    const body = requestBody(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          accept: PACKAGE_MEDIA_TYPE,
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
        fail("STANDARDS_UPDATE_TIMEOUT", "标准更新检查超时");
      }
      fail("STANDARDS_UPDATE_UNAVAILABLE", "标准更新服务暂时不可用");
    } finally {
      clearTimeout(timer);
    }
    if (!response || typeof response.status !== "number" || !response.headers) {
      fail("STANDARDS_UPDATE_RESPONSE_INVALID", "标准更新服务返回了非法响应");
    }
    if (response.status === 204) {
      if (response.body !== null || ![null, "0"].includes(response.headers.get("content-length")) ||
          response.headers.get("content-type") !== null) {
        fail("STANDARDS_UPDATE_RESPONSE_INVALID", "标准更新服务返回了非法当前状态");
      }
      return Object.freeze({ outcome: "current" });
    }
    if (response.status !== 200) {
      fail("STANDARDS_UPDATE_UNAVAILABLE", "标准更新服务暂时不可用");
    }
    if ((response.headers.get("content-type") || "").toLowerCase() !== PACKAGE_MEDIA_TYPE ||
        response.headers.get("content-encoding") !== null ||
        response.headers.get("content-range") !== null) {
      fail("STANDARDS_UPDATE_RESPONSE_INVALID", "标准更新服务返回了非法候选包");
    }
    return Object.freeze({ outcome: "update", envelopeBytes: await readBoundedBody(response) });
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  PACKAGE_MEDIA_TYPE,
  StandardsUpdateHttpClient,
  StandardsUpdateHttpError,
};
