"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const {
  DIRECT_API_BASE_PATH,
  createWebJobHttpHandler,
} = require("../web/http-handler");
const { buildTransferCompletion } = require("../web/direct-transfer-contract");

const ORIGIN = "https://manuscript.test";
const CSRF = "csrf_token_0000000000000000000001";
const PRINCIPAL = Object.freeze({ kind: "account", subject_id: "account-0001" });
const JOB_ID = "webjob-10000000-0000-4000-8000-000000000001";
const UPLOAD_ID = "webtransfer-20000000-0000-4000-8000-000000000002";
const DOWNLOAD_ID = "webtransfer-30000000-0000-4000-8000-000000000003";

function request({ method, url, body = Buffer.alloc(0), headers = {} }) {
  const value = Readable.from(body.length ? [body] : []);
  value.method = method;
  value.url = url;
  value.headers = Object.fromEntries(Object.entries(headers).map(([key, item]) => [key.toLowerCase(), String(item)]));
  value.rawHeaders = Object.entries(headers).flatMap(([key, item]) => [key, String(item)]);
  value.socket = { encrypted: true };
  value.session = { principal: PRINCIPAL, auth_mode: "cookie", csrf_token: CSRF };
  return value;
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
    end(body = Buffer.alloc(0)) { this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); },
    json() { return JSON.parse(this.body.toString("utf8")); },
  };
}

async function invoke(handler, options) {
  const output = response();
  await handler(request(options), output);
  return output;
}

function stateHeaders(extra = {}) {
  return { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "X-Oak-CSRF": CSRF, ...extra };
}

function directService() {
  const calls = [];
  const status = Object.freeze({
    schema_version: "1.0", record_type: "oak_manuscript_web_job_status", job_id: JOB_ID,
    state: "queued", created_at: "2026-08-10T12:00:00.000Z",
    expires_at: "2026-08-10T12:15:00.000Z", input_retained: true,
    result_available: false, deletion_due_at: "2026-08-10T12:15:00.000Z",
  });
  const credential = (kind, transferId) => Object.freeze({
    schema_version: "1.0",
    credential_type: `oak_manuscript_direct_${kind}`,
    transfer_id: transferId,
    job_id: JOB_ID,
    method: kind === "upload" ? "PUT" : "GET",
    url: `https://project-ref.storage.supabase.co/storage/v1/s3/private/object?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260810T120000Z&X-Amz-Expires=120&X-Amz-SignedHeaders=${kind === "upload" ? "cache-control%3Bcontent-type%3Bhost%3Bif-none-match" : "host"}&X-Amz-Signature=${kind}`,
    headers: kind === "upload" ? {
      "cache-control": "private, no-store, max-age=0", "content-type": "text/plain", "if-none-match": "*",
    } : {},
    media_type: "text/plain",
    size_bytes: 6,
    expires_at: "2026-08-10T12:02:00.000Z",
    complete_path: `${DIRECT_API_BASE_PATH}/${JOB_ID}/${kind === "upload" ? "input" : "result"}-transfer/${transferId}/complete`,
    claim_policy: "single_issue",
  });
  return {
    calls,
    createJob: async () => status,
    getJob: async () => status,
    cancelJob: async () => ({ ok: true }),
    deleteJob: async () => ({ ok: true }),
    async beginDirectUpload(principal, jobId) {
      calls.push(["begin_upload", principal, jobId]);
      return credential("upload", UPLOAD_ID);
    },
    async completeDirectUpload(principal, jobId, transferId) {
      calls.push(["complete_upload", principal, jobId, transferId]);
      return status;
    },
    async beginDirectDownload(principal, jobId) {
      calls.push(["begin_download", principal, jobId]);
      return credential("download", DOWNLOAD_ID);
    },
    async completeDirectDownload(principal, jobId, transferId) {
      calls.push(["complete_download", principal, jobId, transferId]);
      return { schema_version: "1.0", receipt_type: "oak_manuscript_web_job_deletion", job_id: jobId,
        reason: "downloaded", deleted_at: "2026-08-10T12:01:00.000Z",
        input_deleted: true, output_deleted: true };
    },
  };
}

test("direct HTTP mode exposes only credential and content-free completion routes", async () => {
  const service = directService();
  const handler = createWebJobHttpHandler({
    service,
    dataPlane: "direct_object",
    expectedOrigin: ORIGIN,
    resolveSession: async (input) => input.session,
    requestIdFactory: () => "40000000-0000-4000-8000-000000000004",
    clock: () => new Date("2026-08-10T12:00:00.000Z"),
  });

  let output = await invoke(handler, {
    method: "POST", url: `${DIRECT_API_BASE_PATH}/${JOB_ID}/input-transfer`,
    headers: stateHeaders({ "Content-Length": 0 }),
  });
  assert.equal(output.statusCode, 201);
  assert.equal(output.json().transfer_id, UPLOAD_ID);

  let body = Buffer.from(JSON.stringify(buildTransferCompletion({ transferId: UPLOAD_ID })), "utf8");
  output = await invoke(handler, {
    method: "POST", url: `${DIRECT_API_BASE_PATH}/${JOB_ID}/input-transfer/${UPLOAD_ID}/complete`,
    headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": body.length }), body,
  });
  assert.equal(output.statusCode, 202);

  output = await invoke(handler, {
    method: "POST", url: `${DIRECT_API_BASE_PATH}/${JOB_ID}/result-transfer`,
    headers: stateHeaders({ "Content-Length": 0 }),
  });
  assert.equal(output.statusCode, 200);
  assert.equal(output.json().transfer_id, DOWNLOAD_ID);

  body = Buffer.from(JSON.stringify(buildTransferCompletion({ transferId: DOWNLOAD_ID })), "utf8");
  output = await invoke(handler, {
    method: "POST", url: `${DIRECT_API_BASE_PATH}/${JOB_ID}/result-transfer/${DOWNLOAD_ID}/complete`,
    headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": body.length }), body,
  });
  assert.equal(output.statusCode, 200);
  assert.equal(output.json().reason, "downloaded");
  assert.deepEqual(service.calls.map((item) => item[0]), [
    "begin_upload", "complete_upload", "begin_download", "complete_download",
  ]);

  output = await invoke(handler, {
    method: "PUT", url: `${DIRECT_API_BASE_PATH}/${JOB_ID}/input`,
    headers: stateHeaders({ "Content-Type": "text/plain", "Content-Length": 6 }),
    body: Buffer.from("secret", "utf8"),
  });
  assert.equal(output.statusCode, 404);
  assert.equal(output.json().error.code, "NOT_FOUND");
});

test("direct completion rejects mismatched transfer ids and extra content metadata", async () => {
  const service = directService();
  const handler = createWebJobHttpHandler({
    service, dataPlane: "direct_object", expectedOrigin: ORIGIN,
    resolveSession: async (input) => input.session,
    requestIdFactory: () => "40000000-0000-4000-8000-000000000004",
  });
  const bad = Buffer.from(JSON.stringify({
    ...buildTransferCompletion({ transferId: DOWNLOAD_ID }),
    filename: "private.txt",
  }), "utf8");
  const output = await invoke(handler, {
    method: "POST", url: `${DIRECT_API_BASE_PATH}/${JOB_ID}/result-transfer/${UPLOAD_ID}/complete`,
    headers: stateHeaders({ "Content-Type": "application/json", "Content-Length": bad.length }), body: bad,
  });
  assert.equal(output.statusCode, 400);
  assert.equal(output.json().error.code, "INVALID_JSON");
  assert.equal(service.calls.length, 0);
});
