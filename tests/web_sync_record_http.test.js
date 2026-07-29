"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Readable } = require("node:stream");

const { buildSyncRecordV1 } = require("../electron/providers");
const {
  MemorySyncRecordRepository,
  SyncRecordService,
} = require("../web/sync-record-service");
const {
  SYNC_API_BASE_PATH,
  createSyncRecordHttpHandler,
  validateSyncHttpAuditEvent,
  validateSyncHttpErrorResponse,
} = require("../web/sync-record-http-handler");
const { createFetchHandlerAdapter } = require("../web/fetch-adapter");
const { createSupabaseSessionResolver } = require("../web/supabase-session-adapter");

const ORIGIN = "https://manuscript.test";
const CSRF = "csrf_token_0000000000000000000001";
const ACCOUNT = Object.freeze({ kind: "account", subject_id: "account-0001" });
const OTHER_ACCOUNT = Object.freeze({ kind: "account", subject_id: "account-0002" });
const REQUEST_ID = "20000000-0000-4000-8000-000000000001";

function record(runId = "check-0001") {
  return buildSyncRecordV1({
    projectId: "0123456789abcdef",
    runId,
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

function rawHeaders(headers) {
  return Object.entries(headers).flatMap(([key, value]) => [key, String(value)]);
}

function request({
  method = "GET",
  url = SYNC_API_BASE_PATH,
  headers = {},
  body = Buffer.alloc(0),
  encrypted = true,
  session = { principal: ACCOUNT, auth_mode: "cookie", csrf_token: CSRF },
  raw,
} = {}) {
  const value = Readable.from(body.length ? [body] : []);
  value.method = method;
  value.url = url;
  value.headers = Object.fromEntries(Object.entries(headers).map(([key, item]) => [key.toLowerCase(), item]));
  value.rawHeaders = raw || rawHeaders(headers);
  value.socket = { encrypted };
  value.session = session;
  return value;
}

function response() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = Buffer.alloc(0)) {
      this.body = Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(String(body), "utf8");
    },
    json() { return JSON.parse(this.body.toString("utf8")); },
  };
}

function stateHeaders(extra = {}) {
  return { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "X-Oak-CSRF": CSRF, ...extra };
}

function harness(options = {}) {
  const service = options.service || new SyncRecordService({
    repository: new MemorySyncRecordRepository(),
    clock: () => new Date("2026-07-28T12:05:00.000Z"),
  });
  const events = [];
  const handler = createSyncRecordHttpHandler({
    service,
    expectedOrigin: ORIGIN,
    resolveSession: async (input) => input.session,
    requestIdFactory: () => REQUEST_ID,
    clock: () => new Date("2026-07-28T12:05:00.000Z"),
    securityEventSink: (event) => events.push(event),
    ...options.handler,
  });
  return { service, events, handler };
}

async function invoke(handler, options) {
  const input = request(options);
  const output = response();
  await handler(input, output);
  return output;
}

async function createRecord(context, value = record(), options = {}) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  return invoke(context.handler, {
    method: "POST",
    url: SYNC_API_BASE_PATH,
    headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": body.length }),
    body,
    ...options,
  });
}

test("sync HTTP boundary requires canonical HTTPS origin and complete adapters", () => {
  const service = new SyncRecordService({ repository: new MemorySyncRecordRepository() });
  assert.throws(
    () => createSyncRecordHttpHandler({ service, expectedOrigin: "http://example.test", resolveSession() {} }),
    /HTTPS origin/,
  );
  assert.throws(
    () => createSyncRecordHttpHandler({ service, expectedOrigin: "https://example.test/path", resolveSession() {} }),
    /HTTPS origin/,
  );
  assert.throws(
    () => createSyncRecordHttpHandler({ expectedOrigin: ORIGIN, resolveSession() {} }),
    /service/,
  );
});

test("tracked sync HTTP schemas match the runtime exact contracts", () => {
  const schemaRoot = path.join(__dirname, "..", "config", "schemas");
  const errorSchema = JSON.parse(fs.readFileSync(path.join(schemaRoot, "sync-http-error-v1.schema.json"), "utf8"));
  const auditSchema = JSON.parse(fs.readFileSync(path.join(schemaRoot, "sync-http-audit-v1.schema.json"), "utf8"));
  assert.equal(errorSchema.additionalProperties, false);
  assert.deepEqual(errorSchema.required, ["schema_version", "error", "request_id"]);
  assert.equal(errorSchema.properties.error.additionalProperties, false);
  assert.equal(errorSchema.properties.error.properties.code.enum.includes("INVALID_RECORD"), true);
  assert.equal(errorSchema.properties.error.properties.code.enum.includes("SERVICE_UNAVAILABLE"), true);
  assert.equal(auditSchema.additionalProperties, false);
  assert.equal(auditSchema.properties.event_type.const, "sync_http_request_completed");
  assert.deepEqual(auditSchema.properties.route.enum, [
    SYNC_API_BASE_PATH,
    `${SYNC_API_BASE_PATH}/:idempotency_id`,
    "unmatched",
  ]);
});

test("authenticated create, replay, list, get, and delete form one owner-bound HTTP lifecycle", async () => {
  const context = harness();
  const created = await createRecord(context);
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().outcome, "created");

  const replayed = await createRecord(context);
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.json().outcome, "replayed");

  const listed = await invoke(context.handler, {
    method: "GET",
    headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin" },
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().items.length, 1);
  assert.equal(JSON.stringify(listed.json()).includes("account-0001"), false);

  const id = record().idempotency_id;
  const fetched = await invoke(context.handler, {
    method: "GET",
    url: `${SYNC_API_BASE_PATH}/${id}`,
    headers: { Origin: ORIGIN },
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().item.idempotency_id, id);

  const deleted = await invoke(context.handler, {
    method: "DELETE",
    url: `${SYNC_API_BASE_PATH}/${id}`,
    headers: stateHeaders(),
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().deleted, true);
  const missing = await invoke(context.handler, {
    method: "GET",
    url: `${SYNC_API_BASE_PATH}/${id}`,
    headers: { Origin: ORIGIN },
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "RECORD_NOT_FOUND");
});

test("Netlify-style Fetch request reaches the sync service through verified Bearer identity", async () => {
  const service = new SyncRecordService({
    repository: new MemorySyncRecordRepository(),
    clock: () => new Date("2026-07-28T12:05:00.000Z"),
  });
  const resolveSession = createSupabaseSessionResolver({
    verifyAccessToken: async (token) => {
      assert.equal(token, "trusted_access_token_0000000000000001");
      return { subject_id: "account-0001" };
    },
  });
  const nodeHandler = createSyncRecordHttpHandler({
    service,
    expectedOrigin: ORIGIN,
    resolveSession,
    requestIdFactory: () => REQUEST_ID,
  });
  const handler = createFetchHandlerAdapter({ nodeHandler });
  const body = JSON.stringify(record());
  const created = await handler(new Request(`${ORIGIN}${SYNC_API_BASE_PATH}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer trusted_access_token_0000000000000001",
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body, "utf8")),
    },
    body,
  }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).outcome, "created");
});

test("foreign and missing records are indistinguishable over HTTP", async () => {
  const context = harness();
  await createRecord(context);
  const id = record().idempotency_id;
  for (const target of [
    id,
    "sync-v1:ffffffffffffffff:check-0001",
  ]) {
    const result = await invoke(context.handler, {
      method: "GET",
      url: `${SYNC_API_BASE_PATH}/${target}`,
      headers: { Origin: ORIGIN },
      session: { principal: OTHER_ACCOUNT, auth_mode: "bearer" },
    });
    assert.equal(result.statusCode, 404);
    assert.equal(result.json().error.code, "RECORD_NOT_FOUND");
  }
});

test("state-changing sync routes enforce same-origin and cookie CSRF but bearer needs no CSRF", async () => {
  const context = harness();
  const body = Buffer.from(JSON.stringify(record()), "utf8");
  const crossSite = await invoke(context.handler, {
    method: "POST",
    headers: { Origin: "https://evil.test", "Content-Type": "application/json", "Content-Length": body.length },
    body,
  });
  assert.equal(crossSite.statusCode, 403);
  assert.equal(crossSite.json().error.code, "CROSS_SITE_REQUEST");

  const noCsrf = await invoke(context.handler, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "Content-Length": body.length },
    body,
  });
  assert.equal(noCsrf.statusCode, 403);
  assert.equal(noCsrf.json().error.code, "CSRF_REQUIRED");

  const bearer = await invoke(context.handler, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "Content-Length": body.length },
    body,
    session: { principal: ACCOUNT, auth_mode: "bearer" },
  });
  assert.equal(bearer.statusCode, 201);
});

test("JSON framing, media, route, and method failures occur before service mutation", async () => {
  let creates = 0;
  const base = new SyncRecordService({ repository: new MemorySyncRecordRepository() });
  const service = {
    create: async (...args) => { creates += 1; return base.create(...args); },
    list: (...args) => base.list(...args),
    get: (...args) => base.get(...args),
    delete: (...args) => base.delete(...args),
  };
  const context = harness({ service });
  const body = Buffer.from(JSON.stringify(record()), "utf8");
  const cases = [
    { method: "POST", headers: stateHeaders({ "Content-Type": "text/plain", "Content-Length": body.length }), body, code: "UNSUPPORTED_MEDIA_TYPE" },
    { method: "POST", headers: stateHeaders({ "Content-Type": "application/json" }), body, code: "LENGTH_REQUIRED" },
    { method: "POST", headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": body.length + 1 }), body, code: "BODY_LENGTH_MISMATCH" },
    { method: "POST", headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": body.length, "Transfer-Encoding": "chunked" }), body, code: "TRANSFER_ENCODING_NOT_ALLOWED" },
    { method: "PUT", headers: stateHeaders(), code: "METHOD_NOT_ALLOWED" },
    { method: "GET", url: `${SYNC_API_BASE_PATH}?owner=secret`, headers: { Origin: ORIGIN }, code: "NOT_FOUND" },
    { method: "GET", url: `${SYNC_API_BASE_PATH}/sync-v1%3A0123456789abcdef%3Acheck-0001`, headers: { Origin: ORIGIN }, code: "NOT_FOUND" },
  ];
  for (const item of cases) {
    const result = await invoke(context.handler, item);
    assert.equal(result.json().error.code, item.code);
  }
  assert.equal(creates, 0);
});

test("invalid records and service faults map to bounded non-reflective errors", async () => {
  const context = harness();
  const poisoned = record();
  poisoned.filename = "private.docx";
  const invalid = await createRecord(context, poisoned);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, "INVALID_RECORD");
  assert.equal(JSON.stringify(invalid.json()).includes("private.docx"), false);

  const broken = harness({
    service: {
      async create() { throw new Error("database secret"); },
      async list() { throw new Error("database secret"); },
      async get() { throw new Error("database secret"); },
      async delete() { throw new Error("database secret"); },
    },
  });
  const failed = await createRecord(broken);
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.json().error.code, "SERVICE_UNAVAILABLE");
  assert.equal(failed.body.includes("secret"), false);
});

test("sync HTTP error and audit contracts are exact and content-free", async () => {
  const context = harness();
  const missing = await invoke(context.handler, {
    method: "GET",
    url: `${SYNC_API_BASE_PATH}/sync-v1:ffffffffffffffff:check-0001`,
    headers: { Origin: ORIGIN },
  });
  assert.equal(validateSyncHttpErrorResponse(missing.json()), true);
  assert.equal(context.events.length, 1);
  assert.equal(validateSyncHttpAuditEvent(context.events[0]), true);
  assert.deepEqual(Object.keys(context.events[0]).sort(), [
    "error_code", "event_type", "http_status", "method", "occurred_at", "request_id",
    "route", "schema_version",
  ].sort());
  const serialized = JSON.stringify(context.events[0]);
  assert.equal(serialized.includes("account-0001"), false);
  assert.equal(serialized.includes("ffffffff"), false);

  assert.throws(
    () => validateSyncHttpAuditEvent({ ...context.events[0], account_id: "account-0001" }),
    /exact/,
  );
});

test("asynchronous audit sink failures cannot alter or reject the HTTP result", async () => {
  const context = harness({
    handler: {
      securityEventSink: async () => {
        throw new Error("audit backend unavailable");
      },
    },
  });
  const result = await invoke(context.handler, {
    method: "GET",
    url: `${SYNC_API_BASE_PATH}/sync-v1:ffffffffffffffff:check-0001`,
    headers: { Origin: ORIGIN },
  });
  assert.equal(result.statusCode, 404);
  assert.equal(result.json().error.code, "RECORD_NOT_FOUND");
  await new Promise((resolve) => setImmediate(resolve));
});
