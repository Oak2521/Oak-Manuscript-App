"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  INPUT_MEDIA_TYPES,
  MemoryEphemeralStorage,
  WebJobError,
  WebJobService,
  validateCreateRequest,
  validateDeletionReceipt,
  validatePublicJob,
} = require("../web/job-contract");

const ACCOUNT = Object.freeze({ kind: "account", subject_id: "account-0001" });
const OTHER_ACCOUNT = Object.freeze({ kind: "account", subject_id: "account-0002" });
const ANONYMOUS = Object.freeze({ kind: "anonymous", subject_id: "session-0001" });
const UUIDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
];

function request(overrides = {}) {
  const base = {
    schema_version: "1.0",
    request_type: "oak_manuscript_web_job",
    idempotency_key: "webjob-request-0001",
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

function harness(options = {}) {
  let now = Date.parse("2026-07-28T12:00:00.000Z");
  let uuidIndex = 0;
  const audit = [];
  const storage = options.storage || new MemoryEphemeralStorage();
  const service = new WebJobService({
    storage,
    clock: () => new Date(now),
    uuidFactory: () => UUIDS[uuidIndex++],
    auditSink: (event) => audit.push(event),
    ...options,
  });
  return {
    service,
    storage,
    audit,
    advance(ms) { now += ms; },
  };
}

function expectCode(code) {
  return (error) => error instanceof WebJobError && error.code === code;
}

test("Web job tracked schemas match the runtime exact public contracts", () => {
  const schemaDir = path.join(__dirname, "..", "config", "schemas");
  const create = JSON.parse(fs.readFileSync(path.join(schemaDir, "web-job-create-v1.schema.json"), "utf8"));
  const status = JSON.parse(fs.readFileSync(path.join(schemaDir, "web-job-status-v1.schema.json"), "utf8"));
  const deletion = JSON.parse(fs.readFileSync(path.join(schemaDir, "web-job-deletion-v1.schema.json"), "utf8"));

  assert.equal(create.additionalProperties, false);
  assert.deepEqual(create.required, [
    "schema_version", "request_type", "idempotency_key", "consent", "document",
  ]);
  assert.deepEqual(create.properties.consent.required, [
    "granted", "scope", "privacy_version", "granted_at",
  ]);
  assert.deepEqual(create.properties.document.required, [
    "format", "manuscript_type", "check_config", "citation_style", "size_bytes",
  ]);
  assert.deepEqual(status.required, [
    "schema_version", "record_type", "job_id", "state", "created_at", "expires_at",
    "input_retained", "result_available", "deletion_due_at",
  ]);
  assert.deepEqual(deletion.required, [
    "schema_version", "receipt_type", "job_id", "reason", "deleted_at",
    "input_deleted", "output_deleted",
  ]);

  assert.equal(validateCreateRequest(request()), true);
});

test("create requires one-job consent and rejects filenames, hashes, content, and unknown fields", async () => {
  const { service } = harness();
  await assert.rejects(
    service.createJob(ACCOUNT, request({ consent: { granted: false } })),
    expectCode("CONSENT_REQUIRED"),
  );
  for (const forbidden of [
    { filename: "private.txt" },
    { path: "C:\\Users\\author\\private.txt" },
    { sha256: "a".repeat(64) },
    { content: "secret manuscript" },
  ]) {
    await assert.rejects(
      service.createJob(ACCOUNT, request({ document: forbidden })),
      expectCode("INVALID_REQUEST"),
    );
  }
  await assert.rejects(
    service.createJob({ ...ACCOUNT, access_token: "secret" }, request()),
    expectCode("INVALID_REQUEST"),
  );
});

test("trusted principal owns the job and public state never exposes the account or manuscript metadata", async () => {
  const { service, audit } = harness();
  const created = await service.createJob(ACCOUNT, request());
  assert.equal(validatePublicJob(created), true);
  assert.equal(created.state, "awaiting_upload");
  assert.deepEqual(service.listJobs(ACCOUNT), [created]);
  assert.deepEqual(service.listJobs(ANONYMOUS), []);
  assert.throws(() => service.getJob(OTHER_ACCOUNT, created.job_id), expectCode("JOB_NOT_FOUND"));
  await assert.rejects(
    service.acceptUpload(OTHER_ACCOUNT, created.job_id, {
      bytes: Buffer.from("secret"),
      media_type: "text/plain",
    }),
    expectCode("JOB_NOT_FOUND"),
  );

  const serialized = JSON.stringify({ created, audit });
  for (const forbidden of ["account-0001", "private.txt", "secret manuscript", "sha256", "filename", "path"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("idempotency replays the same task and rejects a changed request", async () => {
  const { service } = harness();
  const first = await service.createJob(ACCOUNT, request());
  const replay = await service.createJob(ACCOUNT, request());
  assert.deepEqual(replay, first);
  await assert.rejects(
    service.createJob(ACCOUNT, request({ document: { size_bytes: 7 } })),
    expectCode("IDEMPOTENCY_CONFLICT"),
  );
  assert.equal(service.listJobs(ACCOUNT).length, 1);
});

test("terminal idempotency tombstone prevents a deleted job from being recreated", async () => {
  const { service } = harness();
  const first = await service.createJob(ACCOUNT, request());
  await service.cancelJob(ACCOUNT, first.job_id);
  await assert.rejects(service.createJob(ACCOUNT, request()), expectCode("IDEMPOTENCY_TERMINAL"));
  await assert.rejects(
    service.createJob(ACCOUNT, request({ document: { size_bytes: 7 } })),
    expectCode("IDEMPOTENCY_CONFLICT"),
  );
  assert.deepEqual(service.listJobs(ACCOUNT), []);
});

test("consent must be fresh and runtime limits cannot relax the tracked contract", async () => {
  const { service } = harness();
  await assert.rejects(
    service.createJob(ACCOUNT, request({ consent: { granted_at: "2026-07-28T10:59:59.000Z" } })),
    expectCode("CONSENT_STALE"),
  );
  await assert.rejects(
    service.createJob(ACCOUNT, request({ consent: { granted_at: "2026-07-28T12:05:01.000Z" } })),
    expectCode("CONSENT_STALE"),
  );
  assert.throws(() => new WebJobService({ maxUploadBytes: 50 * 1024 * 1024 + 1 }), TypeError);
  assert.throws(() => new WebJobService({ maxResultBytes: 100 * 1024 * 1024 + 1 }), TypeError);
});

test("upload bytes stay in ephemeral storage, carry lifecycle TTL, and cannot smuggle a filename", async () => {
  const { service, storage, audit } = harness();
  const created = await service.createJob(ACCOUNT, request());
  await assert.rejects(
    service.acceptUpload(ACCOUNT, created.job_id, {
      bytes: Buffer.from("secret"),
      media_type: "text/plain",
      filename: "private.txt",
    }),
    expectCode("INVALID_REQUEST"),
  );
  await assert.rejects(
    service.acceptUpload(ACCOUNT, created.job_id, {
      bytes: Buffer.from("short"),
      media_type: "text/plain",
    }),
    expectCode("UPLOAD_SIZE_MISMATCH"),
  );
  await assert.rejects(
    service.acceptUpload(ACCOUNT, created.job_id, {
      bytes: Buffer.from("secret"),
      media_type: INPUT_MEDIA_TYPES.docx,
    }),
    expectCode("UPLOAD_MEDIA_TYPE_MISMATCH"),
  );

  const queued = await service.acceptUpload(ACCOUNT, created.job_id, {
    bytes: Buffer.from("secret"),
    media_type: INPUT_MEDIA_TYPES.txt,
  });
  assert.equal(queued.state, "queued");
  assert.equal(queued.input_retained, true);
  assert.deepEqual(storage.inspect(created.job_id), {
    input_present: true,
    output_present: false,
    input_delete_at: created.expires_at,
    output_delete_at: null,
    output_media_type: null,
  });
  assert.equal(JSON.stringify({ queued, audit }).includes("secret"), false);
});

test("direct upload compatibility keeps non-Buffer input on INVALID_UPLOAD", async () => {
  const { service } = harness();
  const created = await service.createJob(ACCOUNT, request());
  await assert.rejects(
    service.acceptUpload(ACCOUNT, created.job_id, { bytes: "secret", media_type: "text/plain" }),
    expectCode("INVALID_UPLOAD"),
  );
  assert.equal(service.getJob(ACCOUNT, created.job_id).state, "awaiting_upload");
});

test("completion deletes input before exposing a short-lived result", async () => {
  const { service, storage, audit } = harness();
  const created = await service.createJob(ACCOUNT, request());
  await service.acceptUpload(ACCOUNT, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  service.beginProcessing(ACCOUNT, created.job_id);
  const ready = await service.completeJob(ACCOUNT, created.job_id, {
    bytes: Buffer.from("result"), media_type: "application/json",
  });
  assert.equal(ready.state, "result_ready");
  assert.equal(ready.input_retained, false);
  assert.equal(ready.result_available, true);
  assert.deepEqual(await service.downloadResult(ACCOUNT, created.job_id), Buffer.from("result"));
  assert.deepEqual(storage.inspect(created.job_id), {
    input_present: false,
    output_present: true,
    input_delete_at: null,
    output_delete_at: created.expires_at,
    output_media_type: "application/json",
  });
  assert.deepEqual(audit.map((event) => event.event_type), [
    "job_created", "upload_stored", "processing_started", "input_deleted", "result_ready",
  ]);
});

test("cancel and explicit delete purge both content classes and return exact receipts", async () => {
  const { service, storage } = harness();
  const created = await service.createJob(ACCOUNT, request());
  await service.acceptUpload(ACCOUNT, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  const canceled = await service.cancelJob(ACCOUNT, created.job_id);
  assert.equal(validateDeletionReceipt(canceled), true);
  assert.equal(canceled.reason, "canceled");
  assert.deepEqual(storage.inspect(created.job_id), {
    input_present: false,
    output_present: false,
    input_delete_at: null,
    output_delete_at: null,
    output_media_type: null,
  });
  assert.throws(() => service.getJob(ACCOUNT, created.job_id), expectCode("JOB_NOT_FOUND"));

  const second = await service.createJob(ACCOUNT, request({ idempotency_key: "webjob-request-0002" }));
  const deleted = await service.deleteJob(ACCOUNT, second.job_id);
  assert.equal(deleted.reason, "user_deleted");
  assert.equal(validateDeletionReceipt(deleted), true);
});

test("TTL sweep deletes tasks and does not retain result or input", async () => {
  const { service, storage, advance } = harness({ ttlMs: 60_000 });
  const created = await service.createJob(ANONYMOUS, request());
  await service.acceptUpload(ANONYMOUS, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  advance(60_001);
  const swept = await service.sweepExpired();
  assert.equal(swept.pending.length, 0);
  assert.equal(swept.deleted.length, 1);
  assert.equal(swept.deleted[0].reason, "expired");
  assert.equal(validateDeletionReceipt(swept.deleted[0]), true);
  assert.equal(storage.inspect(created.job_id).input_present, false);
  assert.equal(storage.inspect(created.job_id).output_present, false);
});

test("expired access is fail-closed even before the background sweep runs", async () => {
  const { service, advance } = harness({ ttlMs: 60_000 });
  const created = await service.createJob(ACCOUNT, request());
  advance(60_001);
  const pending = service.getJob(ACCOUNT, created.job_id);
  assert.equal(pending.state, "deletion_pending");
  await assert.rejects(
    service.acceptUpload(ACCOUNT, created.job_id, {
      bytes: Buffer.from("secret"), media_type: "text/plain",
    }),
    expectCode("JOB_EXPIRED"),
  );
  const receipt = await service.retryDeletion(ACCOUNT, created.job_id);
  assert.equal(receipt.reason, "expired");
  assert.equal(validateDeletionReceipt(receipt), true);
});

test("delete failure is fail-closed as deletion_pending and can be retried", async () => {
  class FlakyStorage extends MemoryEphemeralStorage {
    constructor() {
      super();
      this.failOnce = true;
    }
    async deleteInput(jobId) {
      if (this.failOnce) {
        this.failOnce = false;
        throw new Error("injected delete failure");
      }
      return super.deleteInput(jobId);
    }
  }
  const storage = new FlakyStorage();
  const { service, audit } = harness({ storage });
  const created = await service.createJob(ACCOUNT, request());
  await service.acceptUpload(ACCOUNT, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  await assert.rejects(service.cancelJob(ACCOUNT, created.job_id), expectCode("ZERO_RETENTION_DELETE_FAILED"));
  assert.equal(service.getJob(ACCOUNT, created.job_id).state, "deletion_pending");
  assert.equal(audit.some((event) => event.event_type === "deletion_completed"), false);

  const receipt = await service.retryDeletion(ACCOUNT, created.job_id);
  assert.equal(receipt.reason, "canceled");
  assert.equal(validateDeletionReceipt(receipt), true);
  assert.equal(audit.at(-1).event_type, "deletion_completed");
});

test("partial purge reports which content class remains instead of overstating retention", async () => {
  class OutputDeleteFailure extends MemoryEphemeralStorage {
    constructor() {
      super();
      this.failOnce = true;
    }
    async deleteOutput(jobId) {
      if (this.failOnce) {
        this.failOnce = false;
        throw new Error("injected output delete failure");
      }
      return super.deleteOutput(jobId);
    }
  }
  const storage = new OutputDeleteFailure();
  const { service } = harness({ storage });
  const created = await service.createJob(ACCOUNT, request());
  await service.acceptUpload(ACCOUNT, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  service.beginProcessing(ACCOUNT, created.job_id);
  await service.completeJob(ACCOUNT, created.job_id, {
    bytes: Buffer.from("result"), media_type: "application/json",
  });
  await assert.rejects(service.deleteJob(ACCOUNT, created.job_id), expectCode("ZERO_RETENTION_DELETE_FAILED"));
  const pending = service.getJob(ACCOUNT, created.job_id);
  assert.equal(pending.state, "deletion_pending");
  assert.equal(pending.input_retained, false);
  assert.equal(pending.result_available, true);
  const receipt = await service.retryDeletion(ACCOUNT, created.job_id);
  assert.equal(validateDeletionReceipt(receipt), true);
});

test("an audit sink failure never interrupts content cleanup", async () => {
  const storage = new MemoryEphemeralStorage();
  const service = new WebJobService({
    storage,
    clock: () => new Date("2026-07-28T12:00:00.000Z"),
    uuidFactory: () => UUIDS[0],
    auditSink: () => { throw new Error("audit unavailable"); },
  });
  const created = await service.createJob(ACCOUNT, request());
  await service.acceptUpload(ACCOUNT, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  const receipt = await service.cancelJob(ACCOUNT, created.job_id);
  assert.equal(validateDeletionReceipt(receipt), true);
  assert.equal(storage.inspect(created.job_id).input_present, false);
});

test("completion cleanup failure never exposes a result and retry records processing_failed", async () => {
  class FlakyStorage extends MemoryEphemeralStorage {
    constructor() {
      super();
      this.failOnce = true;
    }
    async deleteInput(jobId) {
      if (this.failOnce) {
        this.failOnce = false;
        throw new Error("injected input retention failure");
      }
      return super.deleteInput(jobId);
    }
  }
  const storage = new FlakyStorage();
  const { service } = harness({ storage });
  const created = await service.createJob(ACCOUNT, request());
  await service.acceptUpload(ACCOUNT, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  service.beginProcessing(ACCOUNT, created.job_id);
  await assert.rejects(
    service.completeJob(ACCOUNT, created.job_id, {
      bytes: Buffer.from("result"), media_type: "application/json",
    }),
    expectCode("ZERO_RETENTION_DELETE_FAILED"),
  );
  const pending = service.getJob(ACCOUNT, created.job_id);
  assert.equal(pending.state, "deletion_pending");
  assert.equal(pending.result_available, false);
  await assert.rejects(service.downloadResult(ACCOUNT, created.job_id), expectCode("RESULT_NOT_AVAILABLE"));
  const receipt = await service.retryDeletion(ACCOUNT, created.job_id);
  assert.equal(receipt.reason, "processing_failed");
});

test("per-owner and global concurrency limits fail before accepting content", async () => {
  const { service } = harness({ maxActivePerOwner: 1, maxActiveGlobal: 2 });
  await service.createJob(ACCOUNT, request());
  await assert.rejects(
    service.createJob(ACCOUNT, request({ idempotency_key: "webjob-request-0002" })),
    expectCode("OWNER_CONCURRENCY_LIMIT"),
  );
  await service.createJob(OTHER_ACCOUNT, request());
  await assert.rejects(
    service.createJob(ANONYMOUS, request()),
    expectCode("GLOBAL_CONCURRENCY_LIMIT"),
  );
});

test("repeated UUID collisions fail closed without overwriting another owner's job", async () => {
  const service = new WebJobService({
    clock: () => new Date("2026-07-28T12:00:00.000Z"),
    uuidFactory: () => UUIDS[0],
  });
  const first = await service.createJob(ACCOUNT, request());
  await assert.rejects(
    service.createJob(OTHER_ACCOUNT, request()),
    expectCode("JOB_ID_COLLISION"),
  );
  assert.deepEqual(service.getJob(ACCOUNT, first.job_id), first);
  assert.deepEqual(service.listJobs(OTHER_ACCOUNT), []);
});
