"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFetchHandlerAdapter } = require("../web/fetch-adapter");
const { createGoTrueAccessTokenVerifier } = require("../web/gotrue-verifier");
const { createSupabaseSessionResolver } = require("../web/supabase-session-adapter");
const { createWebJobHttpHandler } = require("../web/http-handler");
const { WebJobService } = require("../web/job-contract");

const API_ORIGIN = "https://manuscript.test";
const SUPABASE_ORIGIN = "https://project-ref.supabase.co";
const API_KEY = `sb_publishable_${"k".repeat(40)}`;
const TOKEN = `${"a".repeat(36)}.${"b".repeat(36)}.${"c".repeat(36)}`;
const SUBJECT = "8f3b65e1-0e6e-42b4-81c0-61e5cf9a1020";

function buildFetchHandler() {
  const service = new WebJobService({
    clock: () => new Date("2026-07-28T12:00:00.000Z"),
    uuidFactory: () => "10000000-0000-4000-8000-000000000001",
  });
  const verifyAccessToken = createGoTrueAccessTokenVerifier({
    supabaseOrigin: SUPABASE_ORIGIN,
    apiKey: API_KEY,
    fetchImpl: async () => new Response(JSON.stringify({ id: SUBJECT }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const nodeHandler = createWebJobHttpHandler({
    service,
    expectedOrigin: API_ORIGIN,
    resolveSession: createSupabaseSessionResolver({ verifyAccessToken }),
    requestIdFactory: () => "20000000-0000-4000-8000-000000000001",
    clock: () => new Date("2026-07-28T12:00:00.000Z"),
  });
  return { service, handler: createFetchHandlerAdapter({ nodeHandler }) };
}

function createBody() {
  return JSON.stringify({
    schema_version: "1.0",
    request_type: "oak_manuscript_web_job",
    idempotency_key: "fetch-adapter-request-0001",
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
  });
}

function authHeaders(extra = {}) {
  return {
    authorization: `Bearer ${TOKEN}`,
    origin: API_ORIGIN,
    "sec-fetch-site": "same-origin",
    ...extra,
  };
}

test("Fetch adapter requires a complete Node handler and an unused standard Request", async () => {
  assert.throws(() => createFetchHandlerAdapter(), /nodeHandler/);
  const handler = createFetchHandlerAdapter({ nodeHandler: async (_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  } });
  await assert.rejects(handler({}), /标准 Request/);
  const request = new Request(`${API_ORIGIN}/test`, { method: "POST", body: "used" });
  await request.text();
  await assert.rejects(handler(request), /未消费/);
});

test("Netlify-style Fetch request reaches GoTrue, session resolver, and job handler", async () => {
  const context = buildFetchHandler();
  const body = createBody();
  const response = await context.handler(new Request(`${API_ORIGIN}/manuscript/api/v1/jobs`, {
    method: "POST",
    headers: authHeaders({
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    }),
    body,
  }));
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.state, "awaiting_upload");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const serialized = JSON.stringify(payload);
  for (const secret of [TOKEN, SUBJECT, API_KEY]) assert.equal(serialized.includes(secret), false);
});

test("Fetch adapter streams upload bytes through the existing pre-read gates", async () => {
  const context = buildFetchHandler();
  const create = createBody();
  let response = await context.handler(new Request(`${API_ORIGIN}/manuscript/api/v1/jobs`, {
    method: "POST",
    headers: authHeaders({
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(create)),
    }),
    body: create,
  }));
  const status = await response.json();
  response = await context.handler(new Request(
    `${API_ORIGIN}/manuscript/api/v1/jobs/${status.job_id}/input`,
    {
      method: "PUT",
      headers: authHeaders({ "content-type": "text/plain", "content-length": "6" }),
      body: "secret",
    },
  ));
  assert.equal(response.status, 202);
  assert.equal((await response.json()).state, "queued");
  assert.deepEqual(context.service.storage.inspect(status.job_id), {
    input_present: true,
    output_present: false,
    input_delete_at: "2026-07-28T12:15:00.000Z",
    output_delete_at: null,
    output_media_type: null,
  });
});

test("plain HTTP and cross-site Fetch requests retain the handler's bounded failures", async () => {
  const context = buildFetchHandler();
  const body = createBody();
  let response = await context.handler(new Request(`http://manuscript.test/manuscript/api/v1/jobs`, {
    method: "POST",
    headers: authHeaders({
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    }),
    body,
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INSECURE_TRANSPORT");

  response = await context.handler(new Request(`${API_ORIGIN}/manuscript/api/v1/jobs`, {
    method: "POST",
    headers: authHeaders({
      origin: "https://evil.test",
      "sec-fetch-site": "cross-site",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    }),
    body,
  }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "CROSS_SITE_REQUEST");
});

test("adapter refuses a Node handler that never completes its response", async () => {
  const handler = createFetchHandlerAdapter({ nodeHandler: async () => {} });
  await assert.rejects(handler(new Request(`${API_ORIGIN}/test`)), /未完整结束/);
});
