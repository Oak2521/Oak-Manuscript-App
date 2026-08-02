"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { MemoryEphemeralStorage, WebJobError } = require("../web/job-contract");
const { PersistentWebJobService } = require("../web/persistent-job-service");
const { PrivateLeaseWorker } = require("../web/private-lease-worker");
const { validateInternalRecord } = require("../web/supabase-job-repository");
const { createWebJobHttpHandler } = require("../web/http-handler");
const { Readable } = require("node:stream");

const NOW = "2026-07-28T12:00:00.000Z";
const OWNER = Object.freeze({ kind: "account", subject_id: "8f3b65e1-0e6e-42b4-81c0-61e5cf9a1020" });
const OTHER = Object.freeze({ kind: "account", subject_id: "8f3b65e1-0e6e-42b4-81c0-61e5cf9a1021" });
const UUIDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
  "10000000-0000-4000-8000-000000000005",
];

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createRequest(overrides = {}) {
  const base = {
    schema_version: "1.0",
    request_type: "oak_manuscript_web_job",
    idempotency_key: "persistent-service-request-0001",
    consent: {
      granted: true,
      scope: "single_job_processing",
      privacy_version: "web-privacy-v1",
      granted_at: NOW,
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

class FakePersistentRepository {
  constructor({ now = NOW } = {}) {
    this.now = now;
    this.jobs = new Map();
    this.idempotency = new Map();
    this.casCalls = 0;
    this.failNextCas = false;
  }

  _copy(record) {
    return validateInternalRecord(clone(record));
  }

  async createOrReplay(input) {
    const idemKey = `${input.owner_key}\0${input.idempotency_key}`;
    const previous = this.idempotency.get(idemKey);
    if (previous) {
      if (previous.request_fingerprint !== input.request_fingerprint) {
        return { schema_version: "1.0", result_type: "oak_manuscript_web_job_create_result",
          outcome: "conflict", record: null };
      }
      if (previous.terminal || !previous.job_id || !this.jobs.has(previous.job_id)) {
        return { schema_version: "1.0", result_type: "oak_manuscript_web_job_create_result",
          outcome: "terminal", record: null };
      }
      return { schema_version: "1.0", result_type: "oak_manuscript_web_job_create_result",
        outcome: "replayed", record: this._copy(this.jobs.get(previous.job_id)) };
    }
    if (this.jobs.has(input.job_id)) {
      return { schema_version: "1.0", result_type: "oak_manuscript_web_job_create_result",
        outcome: "job_id_collision", record: null };
    }
    if (this.jobs.size >= input.max_active_global) {
      return { schema_version: "1.0", result_type: "oak_manuscript_web_job_create_result",
        outcome: "global_limit", record: null };
    }
    if ([...this.jobs.values()].filter((item) => item.owner_key === input.owner_key).length >=
        input.max_active_per_owner) {
      return { schema_version: "1.0", result_type: "oak_manuscript_web_job_create_result",
        outcome: "owner_limit", record: null };
    }
    const created = new Date(this.now);
    const record = {
      schema_version: "1.0",
      record_type: "oak_manuscript_web_job_internal",
      job_id: input.job_id,
      owner_key: input.owner_key,
      state: "awaiting_upload",
      created_at: created.toISOString(),
      updated_at: created.toISOString(),
      expires_at: new Date(created.getTime() + input.ttl_seconds * 1000).toISOString(),
      input_retained: false,
      result_available: false,
      result_media_type: null,
      pending_deletion_reason: null,
      request_fingerprint: input.request_fingerprint,
      request_canonical: input.request_canonical,
      idempotency_key: input.idempotency_key,
      document: clone(input.document),
      upload_reservation_id: null,
      upload_reservation_expires_at: null,
      lease_id: null,
      lease_expires_at: null,
      revision: 0,
    };
    this.jobs.set(record.job_id, clone(record));
    this.idempotency.set(idemKey, {
      request_fingerprint: input.request_fingerprint,
      job_id: record.job_id,
      terminal: false,
    });
    return { schema_version: "1.0", result_type: "oak_manuscript_web_job_create_result",
      outcome: "created", record: this._copy(record) };
  }

  async getOwned({ owner_key, job_id }) {
    const record = this.jobs.get(job_id);
    return record && record.owner_key === owner_key ? this._copy(record) : null;
  }

  async listOwned({ owner_key }) {
    return [...this.jobs.values()].filter((record) => record.owner_key === owner_key)
      .map((record) => this._copy(record));
  }

  async compareAndSwap(input) {
    this.casCalls += 1;
    if (this.failNextCas) {
      this.failNextCas = false;
      return null;
    }
    const current = this.jobs.get(input.job_id);
    if (!current || current.owner_key !== input.owner_key ||
        current.revision !== input.expected_revision ||
        !input.expected_states.includes(current.state)) return null;
    const updated = {
      ...current,
      ...clone(input.next),
      updated_at: new Date(new Date(current.updated_at).getTime() + 1).toISOString(),
      revision: current.revision + 1,
    };
    validateInternalRecord(updated);
    this.jobs.set(updated.job_id, clone(updated));
    return this._copy(updated);
  }

  async claimNext({ lease_id, lease_seconds }) {
    const now = new Date(this.now);
    const current = [...this.jobs.values()]
      .filter((record) => Date.parse(record.expires_at) > now.getTime() + lease_seconds * 1000 &&
        record.input_retained && !record.result_available &&
        (record.state === "queued" ||
          (record.state === "processing" && Date.parse(record.lease_expires_at) <= now.getTime())))
      .sort((left, right) => {
        const leftTime = left.state === "processing" ? left.lease_expires_at : left.created_at;
        const rightTime = right.state === "processing" ? right.lease_expires_at : right.created_at;
        return leftTime.localeCompare(rightTime) || left.created_at.localeCompare(right.created_at) ||
          left.job_id.localeCompare(right.job_id);
      })[0];
    if (!current) return null;
    const updated = {
      ...current,
      state: "processing",
      updated_at: now.toISOString(),
      upload_reservation_id: null,
      upload_reservation_expires_at: null,
      lease_id,
      lease_expires_at: new Date(Math.min(
        Date.parse(current.expires_at),
        now.getTime() + lease_seconds * 1000,
      )).toISOString(),
      revision: current.revision + 1,
    };
    validateInternalRecord(updated);
    this.jobs.set(updated.job_id, clone(updated));
    return this._copy(updated);
  }

  async finalizeDeletion({ owner_key, job_id, expected_revision }) {
    const record = this.jobs.get(job_id);
    if (!record || record.owner_key !== owner_key || record.revision !== expected_revision ||
        record.state !== "deletion_pending") return false;
    const idemKey = `${record.owner_key}\0${record.idempotency_key}`;
    const idem = this.idempotency.get(idemKey);
    if (!idem || idem.job_id !== record.job_id) throw new Error("missing tombstone");
    this.idempotency.set(idemKey, { ...idem, job_id: null, terminal: true });
    this.jobs.delete(job_id);
    return true;
  }

  async listExpired({ before, limit }) {
    return [...this.jobs.values()]
      .filter((record) => Date.parse(record.expires_at) <= Date.parse(before))
      .sort((a, b) => a.expires_at.localeCompare(b.expires_at))
      .slice(0, limit)
      .map((record) => this._copy(record));
  }

  async listCleanupDue({ before, limit }) {
    return [...this.jobs.values()]
      .filter((record) => record.state === "deletion_pending" ||
        Date.parse(record.expires_at) <= Date.parse(before))
      .sort((a, b) => {
        const stateOrder = Number(a.state !== "deletion_pending") -
          Number(b.state !== "deletion_pending");
        return stateOrder || a.updated_at.localeCompare(b.updated_at) ||
          a.expires_at.localeCompare(b.expires_at) || a.job_id.localeCompare(b.job_id);
      })
      .slice(0, limit)
      .map((record) => this._copy(record));
  }
}

class FailingDeleteStorage extends MemoryEphemeralStorage {
  constructor() {
    super();
    this.failDeletes = true;
  }

  async deleteInput(jobId) {
    if (this.failDeletes) throw new Error("input delete failed");
    return super.deleteInput(jobId);
  }
}

function acceptingInspector(inspect = async () => Object.freeze({ ok: true })) {
  return Object.freeze({
    execution_boundary: "isolated_process",
    max_inspection_ms: 1_000,
    inspect,
  });
}

function serviceHarness({ repository = new FakePersistentRepository(), storage = new MemoryEphemeralStorage(),
  contentInspector = acceptingInspector(), now = NOW } = {}) {
  let uuidIndex = 0;
  const service = new PersistentWebJobService({
    repository,
    storage,
    contentInspector,
    clock: () => new Date(now),
    uuidFactory: () => UUIDS[uuidIndex++],
  });
  return { service, repository, storage };
}

function expectCode(code) {
  return (error) => error instanceof WebJobError && error.code === code;
}

test("task and idempotency state survive a service restart without retaining manuscript bytes", async () => {
  const repository = new FakePersistentRepository();
  const first = serviceHarness({ repository }).service;
  const created = await first.createJob(OWNER, createRequest());
  const second = serviceHarness({ repository }).service;
  assert.deepEqual(await second.getJob(OWNER, created.job_id), created);
  assert.deepEqual(await second.createJob(OWNER, createRequest()), created);
  const persisted = JSON.stringify([...repository.jobs.values()]);
  for (const forbidden of ["secret manuscript", "filename", "file_path", "manuscript_bytes"]) {
    assert.equal(persisted.includes(forbidden), false, forbidden);
  }
  await assert.rejects(second.getJob(OTHER, created.job_id), expectCode("JOB_NOT_FOUND"));
});

test("persistent upload reservation, processing lease, and result survive service replacement", async () => {
  const repository = new FakePersistentRepository();
  const storage = new MemoryEphemeralStorage();
  const first = serviceHarness({ repository, storage }).service;
  const created = await first.createJob(OWNER, createRequest());
  const reservation = await first.reserveUpload(OWNER, created.job_id, {
    size_bytes: 6,
    media_type: "text/plain",
  });

  const second = serviceHarness({ repository, storage }).service;
  await assert.rejects(second.reserveUpload(OWNER, created.job_id, {
    size_bytes: 6,
    media_type: "text/plain",
  }), expectCode("INVALID_TRANSITION"));
  const queued = await first.acceptReservedUpload(OWNER, created.job_id, reservation, {
    bytes: Buffer.from("secret"),
    media_type: "text/plain",
  });
  assert.equal(queued.state, "queued");
  const lease = await second.beginProcessing(OWNER, created.job_id);
  assert.equal(lease.lease_type, "oak_manuscript_web_job_processing_lease");
  const ready = await second.completeJob(OWNER, created.job_id, lease, {
    bytes: Buffer.from("result"),
    media_type: "application/json",
  });
  assert.equal(ready.state, "result_ready");
  assert.deepEqual(await second.downloadResult(OWNER, created.job_id), Buffer.from("result"));
  assert.equal(storage.inspect(created.job_id).input_present, false);
  assert.equal(storage.inspect(created.job_id).output_present, false);
  await assert.rejects(second.downloadResult(OWNER, created.job_id), expectCode("JOB_NOT_FOUND"));
  assert.equal(repository.jobs.size, 0);
});

test("concurrent persistent downloads have exactly one winner and consume the result", async () => {
  const { service, repository, storage } = serviceHarness();
  const created = await service.createJob(OWNER, createRequest());
  await service.acceptUpload(OWNER, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  const lease = await service.beginProcessing(OWNER, created.job_id);
  await service.completeJob(OWNER, created.job_id, lease, {
    bytes: Buffer.from("result"), media_type: "application/json",
  });
  const outcomes = await Promise.allSettled([
    service.downloadResult(OWNER, created.job_id),
    service.downloadResult(OWNER, created.job_id),
  ]);
  assert.equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((entry) => entry.status === "rejected").length, 1);
  assert.equal(storage.inspect(created.job_id).output_present, false);
  assert.equal(repository.jobs.size, 0);
});

test("persistent download returns no bytes when pre-response purge fails", async () => {
  class DownloadDeleteFailure extends MemoryEphemeralStorage {
    constructor() {
      super();
      this.failOnce = true;
    }
    async deleteOutput(jobId) {
      if (this.failOnce) {
        this.failOnce = false;
        throw new Error("output delete failed");
      }
      return super.deleteOutput(jobId);
    }
  }
  const repository = new FakePersistentRepository();
  const storage = new DownloadDeleteFailure();
  const { service } = serviceHarness({ repository, storage });
  const created = await service.createJob(OWNER, createRequest());
  await service.acceptUpload(OWNER, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  const lease = await service.beginProcessing(OWNER, created.job_id);
  await service.completeJob(OWNER, created.job_id, lease, {
    bytes: Buffer.from("result"), media_type: "application/json",
  });

  await assert.rejects(
    service.downloadResult(OWNER, created.job_id),
    expectCode("ZERO_RETENTION_DELETE_FAILED"),
  );
  assert.equal((await service.getJob(OWNER, created.job_id)).state, "deletion_pending");
  const receipt = await service.retryDeletion(OWNER, created.job_id);
  assert.equal(receipt.reason, "downloaded");
  assert.equal(repository.jobs.size, 0);
});

test("private queue atomically claims work without exposing account or job identity to the processor", async () => {
  const { service, storage } = serviceHarness();
  const created = await service.createJob(OWNER, createRequest());
  await service.acceptUpload(OWNER, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  let processorRequest = null;
  const worker = new PrivateLeaseWorker({
    service,
    processor: {
      execution_boundary: "isolated_process",
      max_execution_ms: 60_000,
      async execute(request) {
        processorRequest = request;
        return { bytes: Buffer.from('{"ok":true}'), media_type: "application/json" };
      },
    },
  });

  assert.deepEqual(await worker.runOnce(), {
    schema_version: "1.0",
    outcome_type: "oak_manuscript_private_worker_outcome",
    claimed: true,
    outcome: "completed",
  });
  assert.deepEqual(Object.keys(processorRequest).sort(),
    ["bytes", "document", "request_type", "schema_version"].sort());
  assert.equal(JSON.stringify(processorRequest).includes(OWNER.subject_id), false);
  assert.equal(JSON.stringify(processorRequest).includes(created.job_id), false);
  assert.equal(JSON.stringify(processorRequest).includes("lease"), false);
  assert.deepEqual(processorRequest.bytes, Buffer.from("secret"));
  assert.equal((await service.getJob(OWNER, created.job_id)).state, "result_ready");
  assert.equal(storage.inspect(created.job_id).input_present, false);
  assert.equal((await worker.runOnce()).outcome, "idle");
});

test("processor failure releases only the in-process claim handle and waits for lease expiry", async () => {
  const repository = new FakePersistentRepository();
  const storage = new MemoryEphemeralStorage();
  const first = serviceHarness({ repository, storage }).service;
  const created = await first.createJob(OWNER, createRequest());
  await first.acceptUpload(OWNER, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  const worker = new PrivateLeaseWorker({
    service: first,
    processor: {
      execution_boundary: "isolated_process",
      max_execution_ms: 60_000,
      async execute() { throw new Error("must not be reflected"); },
    },
  });
  assert.equal((await worker.runOnce()).outcome, "retry_after_lease");
  assert.equal((await first.getJob(OWNER, created.job_id)).state, "processing");
  assert.equal(storage.inspect(created.job_id).input_present, true);

  const active = serviceHarness({ repository, storage }).service;
  assert.equal(await active.claimNextProcessing(), null);
  repository.now = "2026-07-28T12:06:00.000Z";
  const later = serviceHarness({
    repository, storage, now: "2026-07-28T12:06:00.000Z",
  }).service;
  const reclaimed = await later.claimNextProcessing();
  assert.notEqual(reclaimed, null);
  assert.equal(JSON.stringify(reclaimed).includes(OWNER.subject_id), false);
});

test("private queue does not claim a job that lacks one full processing lease before expiry", async () => {
  const repository = new FakePersistentRepository();
  const storage = new MemoryEphemeralStorage();
  const first = serviceHarness({ repository, storage }).service;
  const created = await first.createJob(OWNER, createRequest());
  await first.acceptUpload(OWNER, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  repository.now = "2026-07-28T12:11:00.000Z";
  const nearExpiry = serviceHarness({
    repository, storage, now: "2026-07-28T12:11:00.000Z",
  }).service;
  assert.equal(await nearExpiry.claimNextProcessing(), null);
  assert.equal((await nearExpiry.getJob(OWNER, created.job_id)).state, "queued");
});

test("private work handles cannot be copied or forged to complete another service lease", async () => {
  const { service } = serviceHarness();
  const created = await service.createJob(OWNER, createRequest());
  await service.acceptUpload(OWNER, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  const work = await service.claimNextProcessing();
  await assert.rejects(service.completeClaim({ ...work }, {
    bytes: Buffer.from("result"), media_type: "application/json",
  }), expectCode("INVALID_REQUEST"));
});

test("processing completion is bound to the exact lease and an expired lease can be reclaimed", async () => {
  const repository = new FakePersistentRepository();
  const storage = new MemoryEphemeralStorage();
  const first = serviceHarness({ repository, storage, now: NOW }).service;
  const created = await first.createJob(OWNER, createRequest());
  await first.acceptUpload(OWNER, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  const firstLease = await first.beginProcessing(OWNER, created.job_id);
  await assert.rejects(first.completeJob(OWNER, created.job_id, {
    ...firstLease,
    lease_id: UUIDS[4],
  }, { bytes: Buffer.from("result"), media_type: "application/json" }),
  expectCode("INVALID_TRANSITION"));

  const later = serviceHarness({
    repository,
    storage,
    now: "2026-07-28T12:06:00.000Z",
  }).service;
  const replacement = await later.beginProcessing(OWNER, created.job_id);
  assert.notEqual(replacement.lease_id, firstLease.lease_id);
  await assert.rejects(later.completeJob(OWNER, created.job_id, firstLease, {
    bytes: Buffer.from("result"), media_type: "application/json",
  }), expectCode("INVALID_TRANSITION"));
  assert.equal((await later.completeJob(OWNER, created.job_id, replacement, {
    bytes: Buffer.from("result"), media_type: "application/json",
  })).state, "result_ready");
});

test("delete writes a durable terminal tombstone and prevents replay or duplicate billing", async () => {
  const { service, repository } = serviceHarness();
  const created = await service.createJob(OWNER, createRequest());
  const receipt = await service.cancelJob(OWNER, created.job_id);
  assert.equal(receipt.reason, "canceled");
  assert.equal(repository.jobs.size, 0);
  await assert.rejects(service.createJob(OWNER, createRequest()), expectCode("IDEMPOTENCY_TERMINAL"));
  await assert.rejects(service.createJob(OWNER, createRequest({ document: { size_bytes: 7 } })),
    expectCode("IDEMPOTENCY_CONFLICT"));
});

test("content deletion failure remains deletion_pending across restart and can be retried", async () => {
  const repository = new FakePersistentRepository();
  const storage = new FailingDeleteStorage();
  const first = serviceHarness({ repository, storage }).service;
  const created = await first.createJob(OWNER, createRequest());
  await first.acceptUpload(OWNER, created.job_id, { bytes: Buffer.from("secret"), media_type: "text/plain" });
  await assert.rejects(first.cancelJob(OWNER, created.job_id), expectCode("ZERO_RETENTION_DELETE_FAILED"));
  assert.equal((await first.getJob(OWNER, created.job_id)).state, "deletion_pending");

  storage.failDeletes = false;
  const second = serviceHarness({ repository, storage }).service;
  const receipt = await second.retryDeletion(OWNER, created.job_id);
  assert.equal(receipt.input_deleted, true);
  assert.equal(repository.jobs.size, 0);
});

test("scheduled deletion sweep retries deletion_pending before ordinary expiry", async () => {
  const repository = new FakePersistentRepository();
  const storage = new FailingDeleteStorage();
  const first = serviceHarness({ repository, storage }).service;
  const created = await first.createJob(OWNER, createRequest());
  await first.acceptUpload(OWNER, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  await assert.rejects(first.cancelJob(OWNER, created.job_id),
    expectCode("ZERO_RETENTION_DELETE_FAILED"));
  assert.equal(Date.parse((await first.getJob(OWNER, created.job_id)).expires_at) > Date.parse(NOW), true);

  storage.failDeletes = false;
  const restarted = serviceHarness({ repository, storage }).service;
  const swept = await restarted.sweepDeletionDue();
  assert.equal(swept.deleted.length, 1);
  assert.equal(swept.pending.length, 0);
  assert.equal(swept.deleted[0].reason, "canceled");
  assert.equal(repository.jobs.size, 0);
});

test("CAS loss after input storage removes the orphan and never reports queued", async () => {
  const { service, repository, storage } = serviceHarness();
  const created = await service.createJob(OWNER, createRequest());
  const reservation = await service.reserveUpload(OWNER, created.job_id, {
    size_bytes: 6, media_type: "text/plain",
  });
  repository.failNextCas = true;
  await assert.rejects(service.acceptReservedUpload(OWNER, created.job_id, reservation, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  }), expectCode("INVALID_TRANSITION"));
  assert.equal(storage.inspect(created.job_id).input_present, false);
  assert.equal((await service.getJob(OWNER, created.job_id)).state, "awaiting_upload");
});

test("isolated upload inspection sees no owner or job identity and rejection stores no bytes", async () => {
  let request = null;
  const accepted = serviceHarness({
    contentInspector: acceptingInspector(async (value) => { request = value; return { ok: true }; }),
  });
  const created = await accepted.service.createJob(OWNER, createRequest());
  const reservation = await accepted.service.reserveUpload(OWNER, created.job_id, {
    size_bytes: 6, media_type: "text/plain",
  });
  await accepted.service.acceptReservedUpload(OWNER, created.job_id, reservation, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  assert.deepEqual(Object.keys(request).sort(), ["bytes", "document", "request_type", "schema_version"]);
  assert.equal(JSON.stringify(Object.keys(request)).includes("owner"), false);
  assert.equal(JSON.stringify(Object.keys(request)).includes("job"), false);

  const rejected = serviceHarness({
    contentInspector: acceptingInspector(async () => { throw new Error("unsafe details"); }),
  });
  const bad = await rejected.service.createJob(OWNER, createRequest());
  const badReservation = await rejected.service.reserveUpload(OWNER, bad.job_id, {
    size_bytes: 6, media_type: "text/plain",
  });
  await assert.rejects(rejected.service.acceptReservedUpload(OWNER, bad.job_id, badReservation, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  }), expectCode("UNSAFE_DOCUMENT"));
  assert.equal(rejected.storage.inspect(bad.job_id).input_present, false);
  assert.equal((await rejected.service.getJob(OWNER, bad.job_id)).state, "awaiting_upload");
  const retry = await rejected.service.reserveUpload(OWNER, bad.job_id, {
    size_bytes: 6, media_type: "text/plain",
  });
  assert.notEqual(retry.reservation_id, badReservation.reservation_id);

  const mutating = serviceHarness({
    contentInspector: acceptingInspector(async (value) => { value.bytes.fill(0x78); return { ok: true }; }),
  });
  const changed = await mutating.service.createJob(OWNER, createRequest());
  const changedReservation = await mutating.service.reserveUpload(OWNER, changed.job_id, {
    size_bytes: 6, media_type: "text/plain",
  });
  await assert.rejects(mutating.service.acceptReservedUpload(OWNER, changed.job_id, changedReservation, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  }), expectCode("UNSAFE_DOCUMENT"));
  assert.equal(mutating.storage.inspect(changed.job_id).input_present, false);
});

test("expiry is persisted as deletion_pending and scheduled sweep finalizes content and tombstone", async () => {
  const repository = new FakePersistentRepository({ now: "2026-07-28T10:00:00.000Z" });
  const first = serviceHarness({ repository, now: "2026-07-28T10:00:00.000Z" }).service;
  const created = await first.createJob(OWNER, createRequest({
    consent: { granted_at: "2026-07-28T10:00:00.000Z" },
  }));
  const later = serviceHarness({ repository, now: "2026-07-28T10:16:00.000Z" }).service;
  const status = await later.getJob(OWNER, created.job_id);
  assert.equal(status.state, "deletion_pending");
  const swept = await later.sweepExpired();
  assert.equal(swept.deleted.length, 1);
  assert.equal(repository.jobs.size, 0);
});

test("HTTP handler awaits the persistent service's asynchronous read and reservation gates", async () => {
  const { service } = serviceHarness();
  const created = await service.createJob(OWNER, createRequest());
  const handler = createWebJobHttpHandler({
    service,
    expectedOrigin: "https://manuscript.test",
    resolveSession: async () => ({ principal: OWNER, auth_mode: "bearer" }),
    isSecureRequest: () => true,
    requestIdFactory: () => UUIDS[4],
    clock: () => new Date(NOW),
  });
  const request = Readable.from([]);
  request.method = "GET";
  request.url = `/manuscript/api/v1/jobs/${created.job_id}`;
  request.headers = {};
  request.rawHeaders = [];
  const response = {
    statusCode: null,
    body: Buffer.alloc(0),
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(value = Buffer.alloc(0)) { this.body = Buffer.from(value); },
  };
  await handler(request, response);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body.toString("utf8")).job_id, created.job_id);
});
