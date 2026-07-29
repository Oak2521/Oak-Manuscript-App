"use strict";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9._~+\/-]+={0,2}$/u;
const DEVICE_PATTERN = /^device-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function failure(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function canonicalHttpsEndpoint(value) {
  if (typeof value !== "string") throw new TypeError("权益端点必须是 HTTPS URL");
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError("权益端点必须是 HTTPS URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search || parsed.toString() !== value) {
    throw new TypeError("权益端点必须是规范 HTTPS URL");
  }
  return value;
}

async function boundedJson(response) {
  if (!response || typeof response.status !== "number" || !response.headers || typeof response.arrayBuffer !== "function") {
    failure("订阅权益服务返回了非法响应", "LICENSE_RESPONSE_INVALID");
  }
  if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") || "")) {
    failure("订阅权益服务返回了非法响应", "LICENSE_RESPONSE_INVALID");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^(?:0|[1-9][0-9]{0,15})$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    failure("订阅权益服务返回了非法响应", "LICENSE_RESPONSE_INVALID");
  }
  let bytes;
  try { bytes = Buffer.from(await response.arrayBuffer()); } catch { failure("订阅权益服务返回了非法响应", "LICENSE_RESPONSE_INVALID"); }
  if (bytes.length < 2 || bytes.length > MAX_RESPONSE_BYTES || (declared !== null && bytes.length !== Number(declared))) {
    failure("订阅权益服务返回了非法响应", "LICENSE_RESPONSE_INVALID");
  }
  try { return JSON.parse(bytes.toString("utf8")); } catch { failure("订阅权益服务返回了非法响应", "LICENSE_RESPONSE_INVALID"); }
}

class LicenseHttpClient {
  constructor({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.endpoint = canonicalHttpsEndpoint(endpoint);
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl 必须是函数");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new TypeError("timeoutMs 非法");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async fetchEntitlement({ accessToken, deviceId } = {}) {
    if (typeof accessToken !== "string" || accessToken.length < 32 || accessToken.length > 8192 || !TOKEN_PATTERN.test(accessToken)) {
      throw new TypeError("湖岸账号授权令牌非法");
    }
    if (typeof deviceId !== "string" || !DEVICE_PATTERN.test(deviceId)) throw new TypeError("设备标识非法");
    const body = JSON.stringify({
      schema_version: "1.0",
      request_type: "oak_manuscript_entitlement_request",
      device_id: deviceId,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
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
      if (controller.signal.aborted || error?.name === "AbortError") failure("订阅权益请求超时", "LICENSE_TIMEOUT");
      failure("订阅权益服务暂时不可用", "LICENSE_UNAVAILABLE");
    } finally { clearTimeout(timer); }
    const value = await boundedJson(response);
    if (response.status === 401 || response.status === 403) failure("湖岸账号登录或订阅授权已过期", "LICENSE_AUTH_REQUIRED");
    if (response.status !== 200) failure("订阅权益服务返回了非法响应", "LICENSE_RESPONSE_INVALID");
    return value;
  }
}

module.exports = { DEFAULT_TIMEOUT_MS, DEVICE_PATTERN, LicenseHttpClient, MAX_RESPONSE_BYTES };
