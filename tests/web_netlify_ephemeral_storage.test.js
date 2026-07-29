"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { WebJobService } = require("../web/job-contract");
const {
  NetlifyEphemeralStorage,
  NetlifyEphemeralStorageError,
  createNetlifyEphemeralStorage,
} = require("../web/netlify-ephemeral-storage");

const JOB_ID = "webjob-10000000-0000-4000-8000-000000000001";
const ACCOUNT = Object.freeze({ kind: "account", subject_id: "account-0001" });
const NOW = "2026-07-28T12:00:00.000Z";
const EXPIRES = "2026-07-28T12:15:00.000Z";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class FakeStore {
  constructor() {
    this.entries = new Map();
    this.calls = [];
    this.stickyDeletes = new Set();
    this.failedMetadataReads = new Set();
    this.throwAfterWrite = false;
  }

  async set(key, data, options) {
    this.calls.push({ method: "set", key, options: clone(options) });
    if (options.onlyIfNew && this.entries.has(key)) return { modified: false };
    const bytes = Buffer.from(data);
    this.entries.set(key, { bytes, metadata: clone(options.metadata), etag: `etag-${this.entries.size + 1}` });
    if (this.throwAfterWrite) {
      this.throwAfterWrite = false;
      throw new Error("ambiguous network failure");
    }
    return { modified: true, etag: `etag-${this.entries.size}` };
  }

  async getWithMetadata(key, options) {
    this.calls.push({ method: "getWithMetadata", key, options: clone(options) });
    const entry = this.entries.get(key);
    if (!entry) return null;
    const copy = Uint8Array.from(entry.bytes);
    return { data: copy.buffer, metadata: clone(entry.metadata), etag: entry.etag };
  }

  async getMetadata(key, options) {
    this.calls.push({ method: "getMetadata", key, options: clone(options) });
    if (this.failedMetadataReads.has(key)) throw new Error("metadata service unavailable");
    const entry = this.entries.get(key);
    return entry ? { metadata: clone(entry.metadata), etag: entry.etag } : null;
  }

  async delete(key) {
    this.calls.push({ method: "delete", key });
    if (!this.stickyDeletes.has(key)) this.entries.delete(key);
  }

  list(options) {
    this.calls.push({ method: "list", options: clone(options) });
    const blobs = [...this.entries.keys()]
      .filter((key) => key.startsWith(options.prefix))
      .map((key) => ({ key, etag: this.entries.get(key).etag }));
    return (async function* pages() { yield { blobs, directories: [] }; })();
  }
}

function storageHarness(now = NOW) {
  const store = new FakeStore();
  const storage = new NetlifyEphemeralStorage({ store, clock: () => new Date(now) });
  return { store, storage };
}

function expectStorageCode(code) {
  return (error) => error instanceof NetlifyEphemeralStorageError && error.code === code;
}

test("factory creates one site-scoped strong-consistency store without network", () => {
  const calls = [];
  const store = new FakeStore();
  const storage = createNetlifyEphemeralStorage({
    getStoreImpl: (options) => { calls.push(options); return store; },
  });
  assert.equal(storage instanceof NetlifyEphemeralStorage, true);
  assert.deepEqual(calls, [{ name: "oak-manuscript-ephemeral-v1", consistency: "strong" }]);
  assert.throws(() => createNetlifyEphemeralStorage({ storeName: "../unsafe", getStoreImpl: () => store }));
});

test("input and output use conditional creates, exact metadata, and strong reads", async () => {
  const { store, storage } = storageHarness();
  await storage.putInput(JOB_ID, Buffer.from("secret"), { deleteAt: EXPIRES });
  await storage.putOutput(JOB_ID, Buffer.from("result"), {
    deleteAt: EXPIRES,
    mediaType: "application/json",
  });
  assert.deepEqual(await storage.readOutput(JOB_ID), Buffer.from("result"));
  const input = store.entries.get(`oak-manuscript/jobs/v1/${JOB_ID}/input`);
  assert.deepEqual(input.metadata, {
    schema_version: "1.0",
    record_type: "oak_manuscript_ephemeral_object",
    job_id: JOB_ID,
    object_type: "input",
    delete_at: EXPIRES,
    media_type: null,
    size_bytes: 6,
  });
  assert.equal(store.calls.filter((call) => call.method === "set")
    .every((call) => call.options.onlyIfNew === true), true);
  assert.equal(store.calls.some((call) => call.method === "getWithMetadata" &&
    call.options.type === "arrayBuffer" && call.options.consistency === "strong"), true);
});

test("ambiguous and repeated writes are idempotent only for exact same bytes and metadata", async () => {
  const { store, storage } = storageHarness();
  store.throwAfterWrite = true;
  await storage.putInput(JOB_ID, Buffer.from("secret"), { deleteAt: EXPIRES });
  const key = `oak-manuscript/jobs/v1/${JOB_ID}/input`;
  store.entries.get(key).metadata = Object.fromEntries(
    Object.entries(store.entries.get(key).metadata).reverse(),
  );
  await storage.putInput(JOB_ID, Buffer.from("secret"), { deleteAt: EXPIRES });
  assert.deepEqual(await storage.readInput(JOB_ID), Buffer.from("secret"));
  await assert.rejects(
    storage.putInput(JOB_ID, Buffer.from("other!"), { deleteAt: EXPIRES }),
    expectStorageCode("OBJECT_ALREADY_EXISTS"),
  );
  assert.deepEqual(store.entries.get(key).bytes, Buffer.from("secret"));
});

test("metadata tampering and content length drift fail closed", async () => {
  const { store, storage } = storageHarness();
  await storage.putOutput(JOB_ID, Buffer.from("result"), {
    deleteAt: EXPIRES,
    mediaType: "application/json",
  });
  const key = `oak-manuscript/jobs/v1/${JOB_ID}/output`;
  store.entries.get(key).metadata.token = "smuggled";
  await assert.rejects(storage.readOutput(JOB_ID), expectStorageCode("OBJECT_METADATA_INVALID"));
  delete store.entries.get(key).metadata.token;
  store.entries.get(key).metadata.size_bytes = 99;
  await assert.rejects(storage.readOutput(JOB_ID), expectStorageCode("OBJECT_CONTENT_INVALID"));
});

test("delete is idempotent but succeeds only after a strong absence confirmation", async () => {
  const { store, storage } = storageHarness();
  await storage.putInput(JOB_ID, Buffer.from("secret"), { deleteAt: EXPIRES });
  const key = `oak-manuscript/jobs/v1/${JOB_ID}/input`;
  store.stickyDeletes.add(key);
  await assert.rejects(storage.deleteInput(JOB_ID), expectStorageCode("OBJECT_DELETE_UNCONFIRMED"));
  store.stickyDeletes.delete(key);
  await storage.deleteInput(JOB_ID);
  await storage.deleteInput(JOB_ID);
  assert.equal(store.entries.has(key), false);
});

test("lifecycle sweep deletes expired and corrupt known objects while reporting failures", async () => {
  const { store, storage } = storageHarness("2026-07-28T12:20:00.000Z");
  const second = "webjob-10000000-0000-4000-8000-000000000002";
  const third = "webjob-10000000-0000-4000-8000-000000000003";
  const fourth = "webjob-10000000-0000-4000-8000-000000000004";
  await storage.putInput(JOB_ID, Buffer.from("expired"), { deleteAt: EXPIRES });
  await storage.putOutput(second, Buffer.from("future"), {
    deleteAt: "2026-07-28T13:00:00.000Z",
    mediaType: "application/json",
  });
  await storage.putInput(third, Buffer.from("corrupt"), { deleteAt: EXPIRES });
  await storage.putInput(fourth, Buffer.from("pending"), { deleteAt: EXPIRES });
  const corruptKey = `oak-manuscript/jobs/v1/${third}/input`;
  store.entries.get(corruptKey).metadata.delete_at = "not-a-time";
  store.stickyDeletes.add(corruptKey);
  const unavailableKey = `oak-manuscript/jobs/v1/${fourth}/input`;
  store.failedMetadataReads.add(unavailableKey);
  store.entries.set("oak-manuscript/jobs/v1/unsafe/object", {
    bytes: Buffer.from("unknown"), metadata: {}, etag: "bad",
  });

  const result = await storage.sweepExpiredObjects();
  assert.equal(result.scanned, 5);
  assert.deepEqual(result.deleted, [{ job_id: JOB_ID, object_type: "input", reason: "expired" }]);
  assert.deepEqual(result.pending, [
    { job_id: third, object_type: "input", reason: "invalid_metadata" },
    { job_id: fourth, object_type: "input", reason: "metadata_unavailable" },
  ]);
  assert.equal(result.invalid_keys, 1);
  assert.equal(store.entries.has(`oak-manuscript/jobs/v1/${second}/output`), true);
  assert.equal(store.entries.has(unavailableKey), true);
});

test("WebJobService completes and purges through the Netlify adapter", async () => {
  const { store, storage } = storageHarness();
  const service = new WebJobService({
    storage,
    clock: () => new Date(NOW),
    uuidFactory: () => JOB_ID.slice("webjob-".length),
  });
  const created = await service.createJob(ACCOUNT, {
    schema_version: "1.0",
    request_type: "oak_manuscript_web_job",
    idempotency_key: "netlify-storage-request-0001",
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
  });
  await service.acceptUpload(ACCOUNT, created.job_id, {
    bytes: Buffer.from("secret"), media_type: "text/plain",
  });
  service.beginProcessing(ACCOUNT, created.job_id);
  const ready = await service.completeJob(ACCOUNT, created.job_id, {
    bytes: Buffer.from("result"), media_type: "application/json",
  });
  assert.equal(ready.input_retained, false);
  assert.equal(ready.result_available, true);
  assert.deepEqual(await service.downloadResult(ACCOUNT, created.job_id), Buffer.from("result"));
  assert.equal(store.entries.has(`oak-manuscript/jobs/v1/${JOB_ID}/input`), false);
  assert.equal(store.entries.has(`oak-manuscript/jobs/v1/${JOB_ID}/output`), false);
  await assert.rejects(
    service.downloadResult(ACCOUNT, created.job_id),
    (error) => error && error.code === "JOB_NOT_FOUND",
  );
  assert.equal(store.entries.size, 0);
});

test("unsafe identifiers, bounds, media, and times fail before touching the store", async () => {
  const { store, storage } = storageHarness();
  await assert.rejects(storage.putInput("../escape", Buffer.from("x"), { deleteAt: EXPIRES }), /jobId/);
  await assert.rejects(storage.putInput(JOB_ID, Buffer.alloc(0), { deleteAt: EXPIRES }), /Buffer/);
  await assert.rejects(storage.putInput(JOB_ID, Buffer.from("x"), { deleteAt: "tomorrow" }), /deleteAt/);
  await assert.rejects(storage.putOutput(JOB_ID, Buffer.from("x"), {
    deleteAt: EXPIRES, mediaType: "application/octet-stream",
  }), /媒体类型/);
  assert.equal(store.calls.length, 0);
  store.list = () => ({});
  await assert.rejects(storage.sweepExpiredObjects(), expectStorageCode("OBJECT_LIST_INVALID"));
});
