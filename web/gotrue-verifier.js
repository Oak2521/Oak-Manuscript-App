"use strict";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const SUBJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const TOKEN68_PATTERN = /^[A-Za-z0-9._~+\/-]+={0,2}$/;

class GoTrueVerifierError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GoTrueVerifierError";
    this.code = code;
  }
}

function canonicalHttpsOrigin(value) {
  if (typeof value !== "string") throw new TypeError("supabaseOrigin 必须是 HTTPS origin");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new TypeError("supabaseOrigin 必须是不含路径、凭据、查询或片段的规范 HTTPS origin");
  }
  return value;
}

function validHeaderSecret(value) {
  return typeof value === "string" && value.length >= 20 && value.length <= 8192 &&
    !/[\u0000-\u0020\u007f,]/u.test(value);
}

function validAccessToken(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 8192 &&
    TOKEN68_PATTERN.test(value);
}

function fail(code) {
  const messages = {
    AUTH_UPSTREAM_TIMEOUT: "湖岸账号验证超时",
    AUTH_UPSTREAM_UNAVAILABLE: "湖岸账号验证服务暂时不可用",
    AUTH_UPSTREAM_INVALID_RESPONSE: "湖岸账号验证响应非法",
  };
  throw new GoTrueVerifierError(code, messages[code]);
}

async function readBoundedJson(response, maximum) {
  const contentType = response.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    fail("AUTH_UPSTREAM_INVALID_RESPONSE");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]{0,15})$/u.test(declared)) fail("AUTH_UPSTREAM_INVALID_RESPONSE");
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length > maximum) fail("AUTH_UPSTREAM_INVALID_RESPONSE");
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    fail("AUTH_UPSTREAM_INVALID_RESPONSE");
  }
  if (bytes.length === 0 || bytes.length > maximum ||
      (declared !== null && bytes.length !== Number(declared))) {
    fail("AUTH_UPSTREAM_INVALID_RESPONSE");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("AUTH_UPSTREAM_INVALID_RESPONSE");
  }
}

function createGoTrueAccessTokenVerifier({
  supabaseOrigin,
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
} = {}) {
  const origin = canonicalHttpsOrigin(supabaseOrigin);
  if (!validHeaderSecret(apiKey)) throw new TypeError("apiKey 不是安全的服务端 Supabase API key");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl 必须是函数");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new TypeError("timeoutMs 必须在 100 到 30000 毫秒之间");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 ||
      maxResponseBytes > DEFAULT_MAX_RESPONSE_BYTES) {
    throw new TypeError("maxResponseBytes 必须在 1 KiB 到 64 KiB 之间");
  }

  return async function verifyAccessToken(accessToken) {
    if (!validAccessToken(accessToken)) throw new TypeError("access token 格式非法");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${origin}/auth/v1/user`, {
        method: "GET",
        headers: {
          accept: "application/json",
          apikey: apiKey,
          authorization: `Bearer ${accessToken}`,
        },
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") fail("AUTH_UPSTREAM_TIMEOUT");
      fail("AUTH_UPSTREAM_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }

    if (!response || typeof response.status !== "number" || !response.headers ||
        typeof response.arrayBuffer !== "function") {
      fail("AUTH_UPSTREAM_INVALID_RESPONSE");
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) return null;
    if (response.status === 429 || response.status >= 500) fail("AUTH_UPSTREAM_UNAVAILABLE");
    if (response.status !== 200) fail("AUTH_UPSTREAM_INVALID_RESPONSE");

    const payload = await readBoundedJson(response, maxResponseBytes);
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        typeof payload.id !== "string" || !SUBJECT_ID_PATTERN.test(payload.id)) {
      fail("AUTH_UPSTREAM_INVALID_RESPONSE");
    }
    return Object.freeze({ subject_id: payload.id });
  };
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  GoTrueVerifierError,
  createGoTrueAccessTokenVerifier,
};
