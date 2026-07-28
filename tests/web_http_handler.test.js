"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const {
  INPUT_MEDIA_TYPES,
  MemoryEphemeralStorage,
  WebJobService,
} = require("../web/job-contract");
const {
  API_BASE_PATH,
  createWebJobHttpHandler,
  validateHttpAuditEvent,
  validateHttpErrorResponse,
} = require("../web/http-handler");

const ORIGIN = "https://manuscript.test";
const CSRF = "csrf_token_0000000000000000000001";
const ACCOUNT = Object.freeze({ kind: "account", subject_id: "account-0001" });
const OTHER_ACCOUNT = Object.freeze({ kind: "account", subject_id: "account-0002" });
const UUIDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
];

function createRequest(overrides = {}) {
  const base = {
    schema_version: "1.0",
    request_type: "oak_manuscript_web_job",
    idempotency_key: "http-job-request-0001",
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
  };
  return {
    ...base,
    ...overrides,
    consent: { ...base.consent, ...(overrides.consent || {}) },
    document: { ...base.document, ...(overrides.document || {}) },
  };
}

function lowerHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function rawHeaders(headers) {
  return Object.entries(headers).flatMap(([key, value]) => [key, String(value)]);
}

function mockRequest({
  method = "GET",
  url = API_BASE_PATH,
  headers = {},
  body = Buffer.alloc(0),
  encrypted = true,
  session = { principal: ACCOUNT, auth_mode: "cookie", csrf_token: CSRF },
  chunks,
  explicitRawHeaders,
} = {}) {
  const input = chunks || (body.length ? [body] : []);
  const request = Readable.from(input);
  request.method = method;
  request.url = url;
  request.headers = lowerHeaders(headers);
  request.rawHeaders = explicitRawHeaders || rawHeaders(headers);
  request.socket = { encrypted };
  request.session = session;
  return request;
}

function mockResponse() {
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
    json() {
      return JSON.parse(this.body.toString("utf8"));
    },
  };
}

function harness(options = {}) {
  let now = Date.parse("2026-07-28T12:00:00.000Z");
  let uuidIndex = 0;
  const storage = options.storage || new MemoryEphemeralStorage();
  const service = new WebJobService({
    storage,
    clock: () => new Date(now),
    uuidFactory: () => UUIDS[uuidIndex++],
  });
  const events = [];
  const handler = createWebJobHttpHandler({
    service,
    expectedOrigin: ORIGIN,
    resolveSession: async (request) => request.session,
    requestIdFactory: () => "20000000-0000-4000-8000-000000000001",
    clock: () => new Date(now),
    securityEventSink: (event) => events.push(event),
    ...options.handler,
  });
  return {
    service,
    storage,
    events,
    handler,
    advance(milliseconds) { now += milliseconds; },
  };
}

async function invoke(handler, requestOptions) {
  const request = mockRequest(requestOptions);
  const response = mockResponse();
  await handler(request, response);
  return { request, response };
}

function stateHeaders(extra = {}) {
  return { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "X-Oak-CSRF": CSRF, ...extra };
}

async function createViaHttp(context, overrides = {}, requestOptions = {}) {
  const body = Buffer.from(JSON.stringify(createRequest(overrides)), "utf8");
  const { response } = await invoke(context.handler, {
    method: "POST",
    url: API_BASE_PATH,
    headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": body.length }),
    body,
    ...requestOptions,
  });
  assert.equal(response.statusCode, 201);
  return response.json();
}

test("HTTP boundary requires a canonical HTTPS origin and complete adapters", () => {
  const service = new WebJobService();
  assert.throws(
    () => createWebJobHttpHandler({ service, expectedOrigin: "http://example.test", resolveSession() {} }),
    /HTTPS origin/,
  );
  assert.throws(
    () => createWebJobHttpHandler({ service, expectedOrigin: "https://example.test/path", resolveSession() {} }),
    /HTTPS origin/,
  );
  assert.throws(
    () => createWebJobHttpHandler({ expectedOrigin: "https://example.test", resolveSession() {} }),
    /service/,
  );
});

test("tracked HTTP error and audit schemas match the runtime exact contracts", () => {
  const schemaRoot = path.join(__dirname, "..", "config", "schemas");
  const errorSchema = JSON.parse(fs.readFileSync(path.join(schemaRoot, "web-http-error-v1.schema.json"), "utf8"));
  const auditSchema = JSON.parse(fs.readFileSync(path.join(schemaRoot, "web-http-audit-v1.schema.json"), "utf8"));
  assert.equal(errorSchema.additionalProperties, false);
  assert.deepEqual(errorSchema.required, ["schema_version", "error", "request_id"]);
  assert.equal(errorSchema.properties.error.additionalProperties, false);
  assert.deepEqual(errorSchema.properties.error.required, ["code", "message"]);
  assert.equal(auditSchema.additionalProperties, false);
  assert.deepEqual(auditSchema.required, [
    "schema_version", "event_type", "request_id", "occurred_at", "method", "route",
    "http_status", "error_code",
  ]);
  assert.equal(validateHttpErrorResponse({
    schema_version: "1.0",
    error: { code: "AUTH_REQUIRED", message: "需要有效的湖岸会话" },
    request_id: "20000000-0000-4000-8000-000000000001",
  }), true);
  assert.equal(validateHttpAuditEvent({
    schema_version: "1.0",
    event_type: "web_http_request_completed",
    request_id: "20000000-0000-4000-8000-000000000001",
    occurred_at: "2026-07-28T12:00:00.000Z",
    method: "POST",
    route: API_BASE_PATH,
    http_status: 201,
    error_code: null,
  }), true);
  assert.throws(() => validateHttpErrorResponse({
    schema_version: "1.0",
    error: { code: "AUTH_REQUIRED", message: "session for account-0001" },
    request_id: "20000000-0000-4000-8000-000000000001",
  }), /exact v1/);
});

test("insecure and cross-site requests are rejected before session resolution or body consumption", async () => {
  const context = harness();
  let resolved = 0;
  let consumed = 0;
  context.handler = createWebJobHttpHandler({
    service: context.service,
    expectedOrigin: ORIGIN,
    resolveSession: async () => {
      resolved += 1;
      return { principal: ACCOUNT, auth_mode: "cookie", csrf_token: CSRF };
    },
  });
  async function* privateBody() {
    consumed += 1;
    yield Buffer.from("private manuscript", "utf8");
  }

  let result = await invoke(context.handler, {
    method: "POST",
    encrypted: false,
    headers: stateHeaders({ "Content-Type": "application/json" }),
    chunks: privateBody(),
  });
  assert.equal(result.response.statusCode, 400);
  assert.equal(result.response.json().error.code, "INSECURE_TRANSPORT");
  assert.equal(resolved, 0);
  assert.equal(consumed, 0);

  result = await invoke(context.handler, {
    method: "POST",
    headers: { ...stateHeaders({ "Content-Type": "application/json" }), Origin: "https://evil.test" },
    chunks: privateBody(),
  });
  assert.equal(result.response.statusCode, 403);
  assert.equal(result.response.json().error.code, "CROSS_SITE_REQUEST");
  assert.equal(resolved, 0);
  assert.equal(consumed, 0);
});

test("cookie state changes require exact session and CSRF while bearer state changes do not", async () => {
  const context = harness();
  const body = Buffer.from(JSON.stringify(createRequest()), "utf8");
  let result = await invoke(context.handler, {
    method: "POST",
    headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": body.length }),
    body,
    session: null,
  });
  assert.equal(result.response.statusCode, 401);
  assert.equal(result.response.json().error.code, "AUTH_REQUIRED");

  result = await invoke(context.handler, {
    method: "POST",
    headers: { ...stateHeaders({ "Content-Type": "application/json", "Content-Length": body.length }),
      "X-Oak-CSRF": "wrong_token_000000000000000000000" },
    body,
  });
  assert.equal(result.response.statusCode, 403);
  assert.equal(result.response.json().error.code, "CSRF_REQUIRED");

  result = await invoke(context.handler, {
    method: "POST",
    headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": body.length }),
    body,
    session: {
      principal: ACCOUNT,
      auth_mode: "cookie",
      csrf_token: CSRF,
      token: "must-not-enter-handler",
    },
  });
  assert.equal(result.response.statusCode, 401);
  assert.equal(result.response.json().error.code, "AUTH_REQUIRED");

  result = await invoke(context.handler, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      "Content-Length": body.length,
    },
    body,
    session: { principal: ACCOUNT, auth_mode: "bearer" },
  });
  assert.equal(result.response.statusCode, 201);
});

test("a malformed trusted principal is rejected before the manuscript request body is read", async () => {
  const context = harness();
  let consumed = 0;
  async function* privateBody() { consumed += 1; yield Buffer.from("private manuscript", "utf8"); }
  const { response } = await invoke(context.handler, {
    method: "POST",
    headers: stateHeaders({ "Content-Type": "application/json" }),
    chunks: privateBody(),
    session: {
      principal: { kind: "account", subject_id: "short" },
      auth_mode: "cookie",
      csrf_token: CSRF,
    },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "AUTH_REQUIRED");
  assert.equal(consumed, 0);
});

test("create route returns the tracked status without CORS or sensitive audit fields", async () => {
  const context = harness();
  const status = await createViaHttp(context);
  assert.equal(status.state, "awaiting_upload");
  assert.deepEqual(Object.keys(status).sort(), [
    "created_at", "deletion_due_at", "expires_at", "input_retained", "job_id",
    "record_type", "result_available", "schema_version", "state",
  ].sort());
  assert.equal(context.events.length, 1);
  assert.deepEqual(context.events[0], {
    schema_version: "1.0",
    event_type: "web_http_request_completed",
    request_id: "20000000-0000-4000-8000-000000000001",
    occurred_at: "2026-07-28T12:00:00.000Z",
    method: "POST",
    route: API_BASE_PATH,
    http_status: 201,
    error_code: null,
  });
  const serialized = JSON.stringify(context.events);
  assert.doesNotMatch(serialized, /account-0001|private|filename|content|csrf/i);
});

test("JSON route rejects media mismatch, malformed JSON, duplicate headers, queries, and oversized declarations", async () => {
  const context = harness();
  const valid = Buffer.from(JSON.stringify(createRequest()), "utf8");
  let result = await invoke(context.handler, {
    method: "POST",
    headers: stateHeaders({ "Content-Type": "text/plain", "Content-Length": valid.length }),
    body: valid,
  });
  assert.equal(result.response.json().error.code, "UNSUPPORTED_MEDIA_TYPE");

  result = await invoke(context.handler, {
    method: "POST",
    headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": 1 }),
    body: Buffer.from("{", "utf8"),
  });
  assert.equal(result.response.json().error.code, "INVALID_JSON");

  result = await invoke(context.handler, {
    method: "POST",
    headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": valid.length }),
    body: valid,
    explicitRawHeaders: [
      "Origin", ORIGIN, "Origin", ORIGIN, "X-Oak-CSRF", CSRF,
      "Content-Type", "application/json", "Content-Length", String(valid.length),
    ],
  });
  assert.equal(result.response.json().error.code, "INVALID_HEADERS");

  result = await invoke(context.handler, {
    method: "POST",
    url: `${API_BASE_PATH}?filename=private.txt`,
    headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": valid.length }),
    body: valid,
  });
  assert.equal(result.response.json().error.code, "NOT_FOUND");

  result = await invoke(context.handler, {
    method: "POST",
    headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": 65537 }),
    chunks: [],
  });
  assert.equal(result.response.statusCode, 413);
  assert.equal(result.response.json().error.code, "REQUEST_TOO_LARGE");
});

test("upload headers are validated and reserved before any manuscript bytes are consumed", async () => {
  const context = harness();
  const status = await createViaHttp(context);
  let consumed = 0;
  async function* privateBody() {
    consumed += 1;
    yield Buffer.from("secret", "utf8");
  }
  let result = await invoke(context.handler, {
    method: "PUT",
    url: `${API_BASE_PATH}/${status.job_id}/input`,
    headers: stateHeaders({ "Content-Type": "text/plain" }),
    chunks: privateBody(),
  });
  assert.equal(result.response.json().error.code, "LENGTH_REQUIRED");
  assert.equal(consumed, 0);

  result = await invoke(context.handler, {
    method: "PUT",
    url: `${API_BASE_PATH}/${status.job_id}/input`,
    headers: stateHeaders({ "Content-Type": "text/plain", "Content-Length": 7 }),
    chunks: privateBody(),
  });
  assert.equal(result.response.json().error.code, "UPLOAD_SIZE_MISMATCH");
  assert.equal(consumed, 0);

  result = await invoke(context.handler, {
    method: "PUT",
    url: `${API_BASE_PATH}/${status.job_id}/input`,
    headers: stateHeaders({
      "Content-Type": "text/plain", "Content-Length": 6, "X-File-Name": "private.txt",
    }),
    chunks: privateBody(),
  });
  assert.equal(result.response.json().error.code, "FORBIDDEN_METADATA");
  assert.equal(consumed, 0);
  assert.equal(context.service.getJob(ACCOUNT, status.job_id).state, "awaiting_upload");
});

test("body length failures release the upload reservation so a clean retry can succeed", async () => {
  const context = harness();
  const status = await createViaHttp(context);
  let result = await invoke(context.handler, {
    method: "PUT",
    url: `${API_BASE_PATH}/${status.job_id}/input`,
    headers: stateHeaders({ "Content-Type": "text/plain", "Content-Length": 6 }),
    body: Buffer.from("short", "utf8"),
  });
  assert.equal(result.response.json().error.code, "BODY_LENGTH_MISMATCH");

  result = await invoke(context.handler, {
    method: "PUT",
    url: `${API_BASE_PATH}/${status.job_id}/input`,
    headers: stateHeaders({ "Content-Type": "text/plain", "Content-Length": 6 }),
    body: Buffer.from("secret", "utf8"),
  });
  assert.equal(result.response.statusCode, 202);
  assert.equal(result.response.json().state, "queued");
});

test("a live upload reservation prevents a second receiver from accepting the same task", async () => {
  const context = harness();
  const status = await context.service.createJob(ACCOUNT, createRequest());
  const reservation = context.service.reserveUpload(ACCOUNT, status.job_id, {
    size_bytes: 6,
    media_type: INPUT_MEDIA_TYPES.txt,
  });
  assert.throws(
    () => context.service.reserveUpload(ACCOUNT, status.job_id, {
      size_bytes: 6,
      media_type: INPUT_MEDIA_TYPES.txt,
    }),
    (error) => error.code === "INVALID_TRANSITION",
  );
  assert.equal(context.service.releaseUploadReservation(ACCOUNT, status.job_id, reservation), true);
});

test("complete HTTP lifecycle preserves media type and purges both content classes on delete", async () => {
  const context = harness();
  const status = await createViaHttp(context);
  let result = await invoke(context.handler, {
    method: "PUT",
    url: `${API_BASE_PATH}/${status.job_id}/input`,
    headers: stateHeaders({ "Content-Type": "text/plain", "Content-Length": 6 }),
    body: Buffer.from("secret", "utf8"),
  });
  assert.equal(result.response.statusCode, 202);
  context.service.beginProcessing(ACCOUNT, status.job_id);
  await context.service.completeJob(ACCOUNT, status.job_id, {
    bytes: Buffer.from("result", "utf8"),
    media_type: "text/plain",
  });

  result = await invoke(context.handler, {
    method: "GET",
    url: `${API_BASE_PATH}/${status.job_id}/result`,
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.response.headers["content-type"], "text/plain");
  assert.equal(result.response.headers["content-disposition"], "attachment");
  assert.equal(result.response.headers["access-control-allow-origin"], undefined);
  assert.equal(result.response.body.toString("utf8"), "result");

  result = await invoke(context.handler, {
    method: "DELETE",
    url: `${API_BASE_PATH}/${status.job_id}`,
    headers: stateHeaders(),
  });
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.response.json().input_deleted, true);
  assert.equal(result.response.json().output_deleted, true);
  assert.deepEqual(context.storage.inspect(status.job_id), {
    input_present: false,
    output_present: false,
    input_delete_at: null,
    output_delete_at: null,
    output_media_type: null,
  });
});

test("explicit cancel route returns a canceled deletion receipt and consumes no request body", async () => {
  const context = harness();
  const status = await createViaHttp(context);
  const { response } = await invoke(context.handler, {
    method: "POST",
    url: `${API_BASE_PATH}/${status.job_id}/cancel`,
    headers: stateHeaders(),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().reason, "canceled");
  assert.equal(response.json().input_deleted, true);
  assert.equal(response.json().output_deleted, true);
});

test("another trusted principal receives the same 404 for missing and foreign jobs", async () => {
  const context = harness();
  const status = await createViaHttp(context);
  for (const jobId of [status.job_id, "webjob-10000000-0000-4000-8000-000000000099"]) {
    const { response } = await invoke(context.handler, {
      method: "GET",
      url: `${API_BASE_PATH}/${jobId}`,
      headers: { "Sec-Fetch-Site": "same-origin" },
      session: { principal: OTHER_ACCOUNT, auth_mode: "cookie", csrf_token: CSRF },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "JOB_NOT_FOUND");
  }
});

test("expired status is visible as deletion_pending while upload and download fail with 410", async () => {
  const context = harness();
  const status = await createViaHttp(context);
  context.advance(15 * 60 * 1000);

  let result = await invoke(context.handler, {
    method: "GET",
    url: `${API_BASE_PATH}/${status.job_id}`,
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.response.json().state, "deletion_pending");

  result = await invoke(context.handler, {
    method: "PUT",
    url: `${API_BASE_PATH}/${status.job_id}/input`,
    headers: stateHeaders({ "Content-Type": "text/plain", "Content-Length": 6 }),
    body: Buffer.from("secret", "utf8"),
  });
  assert.equal(result.response.statusCode, 410);
  assert.equal(result.response.json().error.code, "JOB_EXPIRED");

  result = await invoke(context.handler, {
    method: "DELETE",
    url: `${API_BASE_PATH}/${status.job_id}`,
    headers: stateHeaders(),
  });
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.response.json().reason, "expired");
});

test("transfer encoding and privacy metadata are rejected without reading upload content", async () => {
  const context = harness();
  const status = await createViaHttp(context);
  let consumed = 0;
  async function* body() { consumed += 1; yield Buffer.from("secret", "utf8"); }
  for (const extra of [
    { "Transfer-Encoding": "chunked" },
    { Digest: "sha-256=private" },
    { "Content-Disposition": "attachment; filename=private.txt" },
  ]) {
    const { response } = await invoke(context.handler, {
      method: "PUT",
      url: `${API_BASE_PATH}/${status.job_id}/input`,
      headers: stateHeaders({ "Content-Type": "text/plain", "Content-Length": 6, ...extra }),
      chunks: body(),
    });
    assert.ok(["TRANSFER_ENCODING_NOT_ALLOWED", "FORBIDDEN_METADATA"].includes(response.json().error.code));
    assert.equal(consumed, 0);
  }
});

test("unmatched and encoded routes fail without reflecting private URL input", async () => {
  const context = harness();
  for (const url of [
    "/private/author.txt",
    `${API_BASE_PATH}/webjob-10000000-0000-4000-8000-000000000001%2fresult`,
  ]) {
    const { response } = await invoke(context.handler, {
      method: "GET",
      url,
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "NOT_FOUND");
    assert.doesNotMatch(response.body.toString("utf8"), /author|private|%2f/i);
  }
});

test("unsupported methods and session resolver faults use bounded non-reflective errors", async () => {
  const context = harness();
  let result = await invoke(context.handler, {
    method: "PATCH",
    url: API_BASE_PATH,
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
  assert.equal(result.response.statusCode, 405);
  assert.equal(result.response.headers.allow, "GET, POST, PUT, DELETE");
  assert.equal(result.response.json().error.code, "METHOD_NOT_ALLOWED");

  const broken = createWebJobHttpHandler({
    service: context.service,
    expectedOrigin: ORIGIN,
    resolveSession: async () => { throw new Error("account-0001 private cookie secret"); },
  });
  result = await invoke(broken, {
    method: "GET",
    url: `${API_BASE_PATH}/webjob-10000000-0000-4000-8000-000000000099`,
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
  assert.equal(result.response.statusCode, 500);
  assert.equal(result.response.json().error.code, "INTERNAL_ERROR");
  assert.doesNotMatch(result.response.body.toString("utf8"), /account|private|cookie|secret/i);
});

test("security event sink failure never changes the HTTP result", async () => {
  const context = harness({ handler: { securityEventSink() { throw new Error("offline"); } } });
  const status = await createViaHttp(context);
  assert.equal(status.state, "awaiting_upload");
});
