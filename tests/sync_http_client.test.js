"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildSyncRecordV1 } = require("../electron/providers");
const {
  SyncHttpClient,
  SyncTransportError,
} = require("../electron/sync-http-client");

const ORIGIN = "https://manuscript.test";
const TOKEN = `${"a".repeat(36)}.${"b".repeat(36)}.${"c".repeat(36)}`;

function record() {
  return buildSyncRecordV1({
    projectId: "0123456789abcdef",
    runId: "check-0001",
    event: "export",
    format: "docx",
    manuscriptType: "paper",
    checkConfig: "full",
    languageBucket: "zh",
    lengthBucket: "5千—2万字",
    citation: {
      requestedStyle: "default",
      resolvedStyle: "gbt7714-2025",
      mode: "style_specific",
      confidence: "high",
      reasonCode: "paper_zh_numeric_reference_structure",
      resolverVersion: "1.0.0",
    },
    rulepackVersion: "2.0.0",
    appVersion: "0.1.0-alpha.38",
    platform: "win32",
    createdAt: "2026-07-28T12:00:00.000Z",
    authorizedAt: "2026-07-28T12:01:00.000Z",
    issues: [],
    externalValidation: { epubcheck: "not_applicable", ace: "not_applicable" },
    exportState: "completed",
  });
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function success(value = record(), outcome = "created") {
  return {
    schema_version: "1.0",
    outcome,
    item: {
      idempotency_id: value.idempotency_id,
      received_at: "2026-07-28T12:05:00.000Z",
      record: value,
    },
  };
}

function expectCode(code, retryable) {
  return (error) => error instanceof SyncTransportError && error.code === code &&
    error.retryable === retryable && !error.message.includes(TOKEN);
}

test("desktop sync client requires one canonical HTTPS API origin and bounded configuration", () => {
  for (const apiOrigin of [undefined, "http://manuscript.test", `${ORIGIN}/path`, `${ORIGIN}?x=1`]) {
    assert.throws(() => new SyncHttpClient({ apiOrigin, fetchImpl: async () => null }), /HTTPS origin/);
  }
  assert.throws(() => new SyncHttpClient({ apiOrigin: ORIGIN, fetchImpl: null }), /fetchImpl/);
  assert.throws(() => new SyncHttpClient({ apiOrigin: ORIGIN, timeoutMs: 99 }), /timeoutMs/);
  assert.throws(() => new SyncHttpClient({ apiOrigin: ORIGIN, maxResponseBytes: 257 * 1024 }),
    /maxResponseBytes/);
});

test("desktop sync sends the exact authorized record once with bearer-only bounded headers", async () => {
  const value = record();
  const seen = [];
  const client = new SyncHttpClient({
    apiOrigin: ORIGIN,
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return json(success(value), 201);
    },
  });
  const result = await client.send({ accessToken: TOKEN, record: value });
  assert.deepEqual(result, {
    outcome: "created",
    idempotency_id: value.idempotency_id,
    received_at: "2026-07-28T12:05:00.000Z",
  });
  assert.equal(seen[0].url, `${ORIGIN}/manuscript/api/v1/sync-records`);
  assert.equal(seen[0].options.method, "POST");
  assert.equal(seen[0].options.redirect, "error");
  assert.equal(seen[0].options.cache, "no-store");
  assert.equal(seen[0].options.credentials, "omit");
  const body = Buffer.from(seen[0].options.body, "utf8");
  assert.deepEqual(JSON.parse(body), value);
  assert.deepEqual(seen[0].options.headers, {
    accept: "application/json",
    authorization: `Bearer ${TOKEN}`,
    "content-length": String(body.length),
    "content-type": "application/json",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
  });
});

test("success must echo the exact record and status/outcome pair", async () => {
  for (const response of [
    json(success(record(), "created"), 200),
    json(success(record(), "replayed"), 201),
    json({ ...success(), account_id: "private-account" }, 201),
    (() => { const payload = success(); payload.item.record.export_state = "not_exported"; return json(payload, 201); })(),
    new Response("not json", { status: 201, headers: { "content-type": "text/plain" } }),
  ]) {
    const client = new SyncHttpClient({ apiOrigin: ORIGIN, fetchImpl: async () => response });
    await assert.rejects(client.send({ accessToken: TOKEN, record: record() }),
      expectCode("INVALID_RESPONSE", false));
  }
});

test("server failures map to stable retry decisions without reflecting bodies", async () => {
  const cases = [
    [401, "AUTH_REQUIRED", "AUTH_REQUIRED", false],
    [400, "INVALID_RECORD", "RECORD_REJECTED", false],
    [409, "IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT", false],
    [429, "ACCOUNT_RECORD_LIMIT", "ACCOUNT_RECORD_LIMIT", false],
    [503, "SERVICE_UNAVAILABLE", "TRANSPORT_UNAVAILABLE", true],
  ];
  for (const [status, serverCode, clientCode, retryable] of cases) {
    const response = json({
      schema_version: "1.0",
      error: { code: serverCode, message: `secret ${TOKEN}` },
      request_id: "20000000-0000-4000-8000-000000000001",
    }, status);
    const client = new SyncHttpClient({ apiOrigin: ORIGIN, fetchImpl: async () => response });
    await assert.rejects(client.send({ accessToken: TOKEN, record: record() }),
      expectCode(clientCode, retryable));
  }
});

test("malformed credentials fail before fetch and network/timeout failures are retryable", async () => {
  let calls = 0;
  let client = new SyncHttpClient({
    apiOrigin: ORIGIN,
    fetchImpl: async () => { calls += 1; throw new Error(`network ${TOKEN}`); },
  });
  await assert.rejects(client.send({ accessToken: "short", record: record() }), /accessToken/);
  assert.equal(calls, 0);
  await assert.rejects(client.send({ accessToken: TOKEN, record: record() }),
    expectCode("TRANSPORT_UNAVAILABLE", true));

  client = new SyncHttpClient({
    apiOrigin: ORIGIN,
    timeoutMs: 100,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error(`timeout ${TOKEN}`);
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });
  await assert.rejects(client.send({ accessToken: TOKEN, record: record() }),
    expectCode("TRANSPORT_TIMEOUT", true));
});
