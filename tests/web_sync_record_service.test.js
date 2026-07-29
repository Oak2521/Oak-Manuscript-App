"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildSyncRecordV1 } = require("../electron/providers");
const {
  MemorySyncRecordRepository,
  SyncRecordService,
  SyncRecordServiceError,
  validateServerSyncRecordV1,
} = require("../web/sync-record-service");

const ACCOUNT_A = Object.freeze({ kind: "account", subject_id: "account-0001" });
const ACCOUNT_B = Object.freeze({ kind: "account", subject_id: "account-0002" });
const NOW = "2026-07-28T12:05:00.000Z";

function source(overrides = {}) {
  return {
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
    issues: [{
      rule_id: "OAK-CITE-001",
      severity: "warning",
      dimension: "citation",
      status: "open",
      fixable: false,
    }],
    externalValidation: { epubcheck: "not_applicable", ace: "not_applicable" },
    exportState: "completed",
    ...overrides,
  };
}

function record(overrides = {}) {
  const value = buildSyncRecordV1(source(), { includeIssues: true });
  return { ...value, ...overrides };
}

function service(options = {}) {
  return new SyncRecordService({
    repository: options.repository || new MemorySyncRecordRepository(),
    clock: options.clock || (() => new Date(NOW)),
    maxRecordsPerAccount: options.maxRecordsPerAccount,
    maxListItems: options.maxListItems,
  });
}

test("server independently accepts the tracked SyncRecord v1 shape and rejects content or drift", () => {
  const valid = record();
  assert.equal(validateServerSyncRecordV1(valid), true);

  for (const poisoned of [
    { ...valid, filename: "private.docx" },
    { ...valid, counts: { ...valid.counts, total: 2 } },
    { ...valid, idempotency_id: "sync-v1:0123456789abcdef:check-9999" },
    { ...valid, authorized_at: null },
  ]) {
    assert.throws(() => validateServerSyncRecordV1(poisoned), /SyncRecord|同步|授权|字段|计数|幂等/);
  }

  const contentBearing = structuredClone(valid);
  contentBearing.issues[0].preview = "不得上传的正文";
  assert.throws(() => validateServerSyncRecordV1(contentBearing), /禁止|字段/);
});

test("create binds the trusted account and exact record with idempotent replay", async () => {
  const target = service();
  const input = record();
  const created = await target.create(ACCOUNT_A, input);
  assert.equal(created.outcome, "created");
  assert.equal(created.item.idempotency_id, input.idempotency_id);
  assert.equal(created.item.received_at, NOW);
  assert.deepEqual(created.item.record, input);
  assert.equal(JSON.stringify(created).includes("account-0001"), false);

  input.counts.total = 999;
  const replay = await target.create(ACCOUNT_A, record());
  assert.equal(replay.outcome, "replayed");
  assert.deepEqual(replay.item, created.item);

  const changed = record();
  changed.export_state = "not_exported";
  await assert.rejects(
    target.create(ACCOUNT_A, changed),
    (error) => error instanceof SyncRecordServiceError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("the same idempotency id is isolated per trusted account", async () => {
  const target = service();
  const first = await target.create(ACCOUNT_A, record());
  const second = await target.create(ACCOUNT_B, record());
  assert.equal(first.outcome, "created");
  assert.equal(second.outcome, "created");
  assert.equal((await target.list(ACCOUNT_A)).items.length, 1);
  assert.equal((await target.list(ACCOUNT_B)).items.length, 1);
});

test("list and get are bounded, newest-first, cloned, and owner-isolated", async () => {
  let tick = Date.parse(NOW);
  const target = service({
    clock: () => new Date(tick++),
    maxListItems: 2,
  });
  for (let index = 1; index <= 3; index += 1) {
    await target.create(ACCOUNT_A, buildSyncRecordV1(source({ runId: `check-000${index}` })));
  }
  const listed = await target.list(ACCOUNT_A);
  assert.equal(listed.schema_version, "1.0");
  assert.equal(listed.items.length, 2);
  assert.deepEqual(listed.items.map((item) => item.record.run_id), ["check-0003", "check-0002"]);
  assert.equal(listed.truncated, true);

  listed.items[0].record.counts.total = 999;
  const fetched = await target.get(ACCOUNT_A, "sync-v1:0123456789abcdef:check-0003");
  assert.equal(fetched.item.record.counts.total, 1);
  await assert.rejects(
    target.get(ACCOUNT_B, "sync-v1:0123456789abcdef:check-0003"),
    (error) => error instanceof SyncRecordServiceError && error.code === "RECORD_NOT_FOUND",
  );
});

test("delete removes only the current account record and missing equals foreign", async () => {
  const target = service();
  const id = record().idempotency_id;
  await target.create(ACCOUNT_A, record());
  await target.create(ACCOUNT_B, record());

  await assert.rejects(
    target.delete(ACCOUNT_A, "sync-v1:ffffffffffffffff:check-0001"),
    (error) => error instanceof SyncRecordServiceError && error.code === "RECORD_NOT_FOUND",
  );
  const deleted = await target.delete(ACCOUNT_A, id);
  assert.deepEqual(deleted, { schema_version: "1.0", deleted: true, idempotency_id: id });
  await assert.rejects(target.get(ACCOUNT_A, id), /记录不存在或无权访问/);
  assert.equal((await target.get(ACCOUNT_B, id)).item.idempotency_id, id);
});

test("service rejects anonymous principals, future authorization, and account capacity overflow", async () => {
  const target = service({ maxRecordsPerAccount: 1 });
  await assert.rejects(
    target.create({ kind: "anonymous", subject_id: "anonymous-0001" }, record()),
    (error) => error instanceof SyncRecordServiceError && error.code === "AUTH_REQUIRED",
  );
  const future = record({ authorized_at: "2026-07-28T12:11:00.000Z" });
  await assert.rejects(
    target.create(ACCOUNT_A, future),
    (error) => error instanceof SyncRecordServiceError && error.code === "INVALID_RECORD",
  );
  await target.create(ACCOUNT_A, record());
  await assert.rejects(
    target.create(ACCOUNT_A, buildSyncRecordV1(source({ runId: "check-0002" }))),
    (error) => error instanceof SyncRecordServiceError && error.code === "ACCOUNT_RECORD_LIMIT",
  );
});

test("repository faults are sanitized while contract errors retain stable codes", async () => {
  const repository = {
    async createOrReplay() { throw new Error("secret database detail"); },
    async listOwned() { throw new Error("unused"); },
    async getOwned() { throw new Error("unused"); },
    async deleteOwned() { throw new Error("unused"); },
  };
  const target = service({ repository });
  await assert.rejects(
    target.create(ACCOUNT_A, record()),
    (error) => error instanceof SyncRecordServiceError &&
      error.code === "SERVICE_UNAVAILABLE" && !error.message.includes("secret"),
  );
});
