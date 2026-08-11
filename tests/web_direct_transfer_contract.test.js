"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTransferCompletion,
  validateDirectTransferCredential,
} = require("../web/direct-transfer-contract");

const JOB_ID = "webjob-10000000-0000-4000-8000-000000000001";
const TRANSFER_ID = "webtransfer-20000000-0000-4000-8000-000000000002";
const STORAGE_ORIGIN = "https://project-ref.storage.supabase.co";

function credential(overrides = {}) {
  return {
    schema_version: "1.0",
    credential_type: "oak_manuscript_direct_upload",
    transfer_id: TRANSFER_ID,
    job_id: JOB_ID,
    method: "PUT",
    url: `${STORAGE_ORIGIN}/storage/v1/s3/private/jobs/staging?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260810T120000Z&X-Amz-Expires=120&X-Amz-SignedHeaders=cache-control%3Bcontent-type%3Bhost%3Bif-none-match&X-Amz-Signature=abc123`,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": "text/plain",
      "if-none-match": "*",
    },
    media_type: "text/plain",
    size_bytes: 6,
    expires_at: "2026-08-10T12:02:00.000Z",
    complete_path: `/manuscript/api/v2/jobs/${JOB_ID}/input-transfer/${TRANSFER_ID}/complete`,
    claim_policy: "single_issue",
    ...overrides,
  };
}

test("direct transfer credential is exact, origin-bound, short-lived, and frozen", () => {
  const parsed = validateDirectTransferCredential(credential(), {
    expectedStorageOrigin: STORAGE_ORIGIN,
    now: new Date("2026-08-10T12:00:00.000Z"),
    maxLifetimeSeconds: 300,
  });
  assert.equal(parsed.method, "PUT");
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.headers), true);

  const download = validateDirectTransferCredential(credential({
    credential_type: "oak_manuscript_direct_download",
    method: "GET",
    headers: {},
    media_type: "application/pdf",
    size_bytes: 1024,
    complete_path: `/manuscript/api/v2/jobs/${JOB_ID}/result-transfer/${TRANSFER_ID}/complete`,
  }), {
    expectedStorageOrigin: STORAGE_ORIGIN,
    now: new Date("2026-08-10T12:00:00.000Z"),
    maxLifetimeSeconds: 300,
  });
  assert.equal(download.claim_policy, "single_issue");
});

test("direct transfer credential rejects foreign origins, bearer header leakage, and long expiry", () => {
  for (const value of [
    credential({ url: "https://evil.example/storage/v1/s3/x?X-Amz-Signature=secret" }),
    credential({ headers: { authorization: "Bearer secret" } }),
    credential({ expires_at: "2026-08-10T12:06:00.000Z" }),
    credential({ url: `${STORAGE_ORIGIN}/storage/v1/s3/private/jobs/staging?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260810T120000Z&X-Amz-Expires=120&X-Amz-SignedHeaders=host&X-Amz-Signature=abc123` }),
    credential({ token: "secret" }),
    credential({ complete_path: `/manuscript/api/v2/jobs/${JOB_ID}/input-transfer/webtransfer-30000000-0000-4000-8000-000000000003/complete` }),
  ]) {
    assert.throws(() => validateDirectTransferCredential(value, {
      expectedStorageOrigin: STORAGE_ORIGIN,
      now: new Date("2026-08-10T12:00:00.000Z"),
      maxLifetimeSeconds: 300,
    }));
  }
});

test("completion payload contains only the opaque transfer id", () => {
  const value = buildTransferCompletion({
    transferId: TRANSFER_ID,
    filename: "private-title.txt",
    sha256: "f".repeat(64),
    sizeBytes: 6,
  });
  assert.deepEqual(value, {
    schema_version: "1.0",
    request_type: "oak_manuscript_direct_transfer_completion",
    transfer_id: TRANSFER_ID,
  });
  assert.equal(JSON.stringify(value).includes("private"), false);
  assert.equal(Object.isFrozen(value), true);
});
