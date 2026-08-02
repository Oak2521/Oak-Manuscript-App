"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const {
  GoTrueVerifierError,
  createGoTrueAccessTokenVerifier,
} = require("../web/gotrue-verifier");
const { createSupabaseSessionResolver } = require("../web/supabase-session-adapter");
const { createWebJobHttpHandler } = require("../web/http-handler");
const { WebJobService } = require("../web/job-contract");

const ORIGIN = "https://project-ref.supabase.co";
const API_KEY = `sb_publishable_${"k".repeat(40)}`;
const TOKEN = `${"a".repeat(36)}.${"b".repeat(36)}.${"c".repeat(36)}`;
const SUBJECT = "8f3b65e1-0e6e-42b4-81c0-61e5cf9a1020";

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

test("GoTrue verifier configuration is HTTPS, bounded, and injection-safe", () => {
  const valid = { supabaseOrigin: ORIGIN, apiKey: API_KEY, fetchImpl: async () => jsonResponse({ id: SUBJECT }) };
  for (const supabaseOrigin of [undefined, "http://project.supabase.co", `${ORIGIN}/auth`, `${ORIGIN}?x=1`]) {
    assert.throws(() => createGoTrueAccessTokenVerifier({ ...valid, supabaseOrigin }), /HTTPS origin/);
  }
  for (const apiKey of [undefined, "short", `${API_KEY}\r\nInjected: yes`, `${API_KEY},other`]) {
    assert.throws(() => createGoTrueAccessTokenVerifier({ ...valid, apiKey }), /apiKey/);
  }
  assert.throws(() => createGoTrueAccessTokenVerifier({ ...valid, timeoutMs: 99 }), /timeoutMs/);
  assert.throws(() => createGoTrueAccessTokenVerifier({ ...valid, maxResponseBytes: 65 * 1024 }), /maxResponseBytes/);
});

test("verified GoTrue user is reduced to one frozen subject and request sends no cookies", async () => {
  const seen = [];
  const verify = createGoTrueAccessTokenVerifier({
    supabaseOrigin: ORIGIN,
    apiKey: API_KEY,
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return jsonResponse({ id: SUBJECT, email: "private@example.test", role: "authenticated" });
    },
  });
  const identity = await verify(TOKEN);
  assert.deepEqual(identity, { subject_id: SUBJECT });
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `${ORIGIN}/auth/v1/user`);
  assert.deepEqual({ ...seen[0].options.headers }, {
    accept: "application/json",
    apikey: API_KEY,
    authorization: `Bearer ${TOKEN}`,
  });
  assert.equal(seen[0].options.method, "GET");
  assert.equal(seen[0].options.redirect, "error");
  assert.equal(seen[0].options.cache, "no-store");
  assert.equal(seen[0].options.credentials, "omit");
  assert.equal("body" in seen[0].options, false);
});

test("invalid and expired GoTrue tokens become an unauthenticated result without parsing bodies", async () => {
  for (const status of [400, 401, 403]) {
    let bodyRead = false;
    const verify = createGoTrueAccessTokenVerifier({
      supabaseOrigin: ORIGIN,
      apiKey: API_KEY,
      fetchImpl: async () => ({
        status,
        headers: new Headers({ "content-type": "text/plain" }),
        async arrayBuffer() { bodyRead = true; throw new Error("must not read"); },
      }),
    });
    assert.equal(await verify(TOKEN), null);
    assert.equal(bodyRead, false);
  }
});

test("upstream failures use bounded errors and never reflect token or response content", async () => {
  for (const response of [
    jsonResponse({ secret: "private upstream detail" }, 429),
    jsonResponse({ secret: "private upstream detail" }, 503),
  ]) {
    const verify = createGoTrueAccessTokenVerifier({
      supabaseOrigin: ORIGIN,
      apiKey: API_KEY,
      fetchImpl: async () => response,
    });
    await assert.rejects(verify(TOKEN), (error) => {
      assert.equal(error instanceof GoTrueVerifierError, true);
      assert.equal(error.code, "AUTH_UPSTREAM_UNAVAILABLE");
      assert.equal(error.message.includes(TOKEN), false);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
  }
});

test("network exceptions are sanitized and timeout aborts the exact request", async () => {
  let verify = createGoTrueAccessTokenVerifier({
    supabaseOrigin: ORIGIN,
    apiKey: API_KEY,
    fetchImpl: async () => { throw new Error(`network failure ${TOKEN}`); },
  });
  await assert.rejects(verify(TOKEN), (error) =>
    error.code === "AUTH_UPSTREAM_UNAVAILABLE" && !error.message.includes(TOKEN));

  verify = createGoTrueAccessTokenVerifier({
    supabaseOrigin: ORIGIN,
    apiKey: API_KEY,
    timeoutMs: 100,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });
  await assert.rejects(verify(TOKEN), (error) => error.code === "AUTH_UPSTREAM_TIMEOUT");
});

test("successful responses are media, size, JSON, and subject bounded", async () => {
  const cases = [
    new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    new Response("{}", { status: 200, headers: { "content-type": "application/json", "content-length": "999999" } }),
    new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
    jsonResponse({}),
    jsonResponse({ id: "short" }),
    jsonResponse({ id: SUBJECT }, 201),
  ];
  for (const response of cases) {
    const verify = createGoTrueAccessTokenVerifier({
      supabaseOrigin: ORIGIN,
      apiKey: API_KEY,
      fetchImpl: async () => response,
    });
    await assert.rejects(verify(TOKEN), (error) => error.code === "AUTH_UPSTREAM_INVALID_RESPONSE");
  }
});

test("direct verifier calls reject malformed tokens before network", async () => {
  let calls = 0;
  const verify = createGoTrueAccessTokenVerifier({
    supabaseOrigin: ORIGIN,
    apiKey: API_KEY,
    fetchImpl: async () => { calls += 1; return jsonResponse({ id: SUBJECT }); },
  });
  for (const token of [undefined, "short", `${TOKEN} extra`, `${TOKEN},other`]) {
    await assert.rejects(verify(token), /access token 格式非法/);
  }
  assert.equal(calls, 0);
});

test("GoTrue verifier and Supabase resolver drive a bearer HTTP job without leaking identity", async () => {
  const verifyAccessToken = createGoTrueAccessTokenVerifier({
    supabaseOrigin: ORIGIN,
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse({ id: SUBJECT, email: "private@example.test" }),
  });
  const resolveSession = createSupabaseSessionResolver({ verifyAccessToken });
  const service = new WebJobService({
    clock: () => new Date("2026-07-28T12:00:00.000Z"),
    uuidFactory: () => "10000000-0000-4000-8000-000000000001",
  });
  const events = [];
  const handler = createWebJobHttpHandler({
    service,
    expectedOrigin: "https://manuscript.test",
    resolveSession,
    requestIdFactory: () => "20000000-0000-4000-8000-000000000001",
    clock: () => new Date("2026-07-28T12:00:00.000Z"),
    securityEventSink: (event) => events.push(event),
  });
  const body = Buffer.from(JSON.stringify({
    schema_version: "1.0",
    request_type: "oak_manuscript_web_job",
    idempotency_key: "gotrue-integration-request-0001",
    consent: {
      granted: true,
      scope: "single_job_processing",
      privacy_version: "web-privacy-v1",
      granted_at: "2026-07-28T12:00:00.000Z",
    },
    document: {
      format: "txt",
      manuscript_type: "paper",
      check_config: "full",
      citation_style: "default",
      size_bytes: 6,
    },
  }), "utf8");
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    Origin: "https://manuscript.test",
    "Sec-Fetch-Site": "same-origin",
    "Content-Type": "application/json",
    "Content-Length": String(body.length),
  };
  const request = Readable.from([body]);
  request.method = "POST";
  request.url = "/manuscript/api/v1/jobs";
  request.headers = Object.fromEntries(Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value]));
  request.rawHeaders = Object.entries(headers).flatMap(([key, value]) => [key, value]);
  request.socket = { encrypted: true };
  const response = {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, responseHeaders) {
      this.statusCode = statusCode;
      this.headers = responseHeaders;
    },
    end(value = Buffer.alloc(0)) { this.body = Buffer.from(value); },
  };

  await handler(request, response);
  assert.equal(response.statusCode, 201);
  const payload = JSON.parse(response.body.toString("utf8"));
  assert.equal(payload.state, "awaiting_upload");
  const publicBytes = JSON.stringify({ payload, events });
  for (const secret of [TOKEN, SUBJECT, "private@example.test", API_KEY]) {
    assert.equal(publicBytes.includes(secret), false);
  }
});
