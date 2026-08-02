"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SyncProvider, buildSyncRecordV1 } = require("../electron/providers");
const {
  EncryptedSyncStore,
  STATE_FILE,
  canonicalJson,
  frameCiphertext,
} = require("../electron/sync-store");

const KEY = crypto.createHash("sha256").update("oak-sync-store-test-key").digest();
const ACCOUNT_A = Object.freeze({ state: "authenticated", loggedIn: true, accountId: "account-a" });
const ACCOUNT_B = Object.freeze({ state: "authenticated", loggedIn: true, accountId: "account-b" });

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oak-sync-store-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function protect(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function unprotect(ciphertext) {
  const iv = ciphertext.subarray(0, 12);
  const tag = ciphertext.subarray(12, 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext.subarray(28)), decipher.final()]).toString("utf8");
}

function store(root, overrides = {}) {
  return new EncryptedSyncStore({ rootDir: root, protect, unprotect, ...overrides });
}

function source({ projectId = "0123456789abcdef", runId = "check-0001" } = {}) {
  return {
    projectId,
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
    appVersion: "0.1.0-alpha.21",
    platform: "win32",
    createdAt: "2026-07-28T12:00:00.000Z",
    authorizedAt: null,
    issues: [{
      rule_id: "OAK-CN-PUNCT-001",
      severity: "warning",
      dimension: "punctuation",
      status: "open",
      fixable: true,
    }],
    externalValidation: { epubcheck: "not_applicable", ace: "not_applicable" },
    exportState: "completed",
  };
}

function provider(options = {}) {
  let sequence = 0;
  return new SyncProvider({
    requirePersistence: true,
    clock: () => new Date("2026-07-28T12:02:00.000Z"),
    idFactory: () => `queue-${++sequence}`,
    ...options,
  });
}

test("encrypted sync store round-trips canonical state without plaintext leakage", (t) => {
  const root = makeRoot(t);
  const target = store(root);
  const state = {
    schema_version: "1.0",
    store_type: "oak_manuscript_sync_queue",
    revision: 1,
    preference: "never_asked",
    project_blocks: [],
    queue: [],
  };
  assert.deepEqual(target.save(state, { expectedRevision: 0 }), state);
  assert.deepEqual(target.load(), state);
  const bytes = fs.readFileSync(path.join(root, STATE_FILE));
  assert.equal(bytes.includes(Buffer.from("oak_manuscript_sync_queue")), false);
  assert.equal(bytes.includes(Buffer.from("never_asked")), false);
});

test("persistent queue survives provider restart and remains account-scoped", (t) => {
  const root = makeRoot(t);
  const first = provider();
  first.configurePersistence(store(root));
  const record = buildSyncRecordV1(source());
  const queued = first.confirm(record, "ask_each_time", ACCOUNT_A);
  assert.equal(queued.persistence.persistent, true);
  assert.equal(first.listQueue(ACCOUNT_A).length, 1);
  assert.equal(first.listQueue(ACCOUNT_B).length, 0);
  assert.throws(() => first.cancel(queued.item.queue_id, ACCOUNT_B), /不属于当前账号/u);

  const restarted = provider();
  restarted.configurePersistence(store(root));
  assert.equal(restarted.getPreference(), "ask_each_time");
  assert.deepEqual(restarted.listQueue(ACCOUNT_A), first.listQueue(ACCOUNT_A));
  assert.equal(restarted.listQueue(ACCOUNT_B).length, 0);
  assert.equal(restarted.cancel(queued.item.queue_id, ACCOUNT_A).state, "canceled");

  const third = provider();
  third.configurePersistence(store(root));
  assert.equal(third.listQueue(ACCOUNT_A)[0].state, "canceled");
  assert.equal(third.retry(queued.item.queue_id, ACCOUNT_A).state, "pending_transport");
  assert.equal(third.delete(queued.item.queue_id, ACCOUNT_A), true);
  const fourth = provider();
  fourth.configurePersistence(store(root));
  assert.deepEqual(fourth.listQueue(ACCOUNT_A), []);
});

test("tracked encrypted queue schema matches the exact persisted runtime shape", (t) => {
  const root = makeRoot(t);
  const target = store(root);
  const current = provider();
  current.configurePersistence(target);
  current.confirm(buildSyncRecordV1(source()), "sync_once", ACCOUNT_A);
  const state = target.load();
  const schema = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "../config/schemas/sync-queue-store-v1.schema.json"),
    "utf8",
  ));

  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), Object.keys(state).sort());
  assert.deepEqual(
    [...schema.$defs.project_block.required].sort(),
    Object.keys({ account_id: "account-a", project_id: "0123456789abcdef" }).sort(),
  );
  assert.deepEqual([...schema.$defs.queue_item.required].sort(), Object.keys(state.queue[0]).sort());
  assert.equal(schema.$defs.queue_item.additionalProperties, false);
  assert.equal(schema.$defs.queue_item.properties.payload.$ref, "sync-record-v1.schema.json");
});

test("project-level never choice is persisted per account", (t) => {
  const root = makeRoot(t);
  const record = buildSyncRecordV1(source());
  const first = provider();
  first.configurePersistence(store(root));
  assert.equal(first.confirm(record, "never_for_project", ACCOUNT_A).queued, false);
  assert.equal(first.shouldOffer(record.project_id, ACCOUNT_A), false);
  assert.equal(first.shouldOffer(record.project_id, ACCOUNT_B), true);

  const restarted = provider();
  restarted.configurePersistence(store(root));
  assert.equal(restarted.shouldOffer(record.project_id, ACCOUNT_A), false);
  assert.equal(restarted.shouldOffer(record.project_id, ACCOUNT_B), true);
});

test("revision conflict rejects stale writer instead of overwriting a newer queue", (t) => {
  const root = makeRoot(t);
  const left = store(root);
  const right = store(root);
  const initial = {
    schema_version: "1.0", store_type: "oak_manuscript_sync_queue", revision: 1,
    preference: "never_asked", project_blocks: [], queue: [],
  };
  left.save(initial, { expectedRevision: 0 });
  const stale = right.load();
  left.save({ ...initial, revision: 2, preference: "off" }, { expectedRevision: 1 });
  assert.throws(
    () => right.save({ ...stale, revision: 2, preference: "always" }, { expectedRevision: 1 }),
    /revision 已变化/u,
  );
  assert.equal(left.load().preference, "off");
});

test("tampering, noncanonical plaintext and hard links fail closed", (t) => {
  const root = makeRoot(t);
  const target = store(root);
  const state = {
    schema_version: "1.0", store_type: "oak_manuscript_sync_queue", revision: 1,
    preference: "never_asked", project_blocks: [], queue: [],
  };
  target.save(state, { expectedRevision: 0 });
  const file = path.join(root, STATE_FILE);
  const bytes = fs.readFileSync(file);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(file, bytes);
  assert.throws(() => target.load(), /解密/u);

  fs.rmSync(file);
  const noncanonical = JSON.stringify(state);
  fs.writeFileSync(file, frameCiphertext(protect(noncanonical)), { mode: 0o600 });
  assert.throws(() => target.load(), /canonical/u);

  const hardlink = path.join(root, "queue-copy.enc");
  try { fs.linkSync(file, hardlink); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error && error.code)) {
      t.skip(`当前文件系统不允许创建硬链接：${error.code}`);
      return;
    }
    throw error;
  }
  assert.throws(() => target.load(), /单链接/u);
});

test("failed atomic replacement leaves provider memory and committed state unchanged", (t) => {
  const root = makeRoot(t);
  const stable = store(root);
  const first = provider();
  first.configurePersistence(stable);
  first.setPreference("ask_each_time");
  const proxy = new Proxy(fs, {
    get(target, key) {
      if (key === "renameSync") return () => { throw new Error("injected rename failure"); };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  first.store = store(root, { fsImpl: proxy });
  assert.throws(
    () => first.confirm(buildSyncRecordV1(source()), "sync_once", ACCOUNT_A),
    /injected rename failure/u,
  );
  assert.equal(first.listQueue(ACCOUNT_A).length, 0);
  assert.equal(first.getPreference(), "ask_each_time");
  assert.equal(stable.load().revision, 1);
  assert.equal(stable.load().queue.length, 0);
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.endsWith(".tmp")), []);
});

test("required persistence refuses previews and mutations when OS encryption is unavailable", () => {
  const required = provider();
  const record = buildSyncRecordV1(source());
  required.disablePersistence(new Error("safeStorage unavailable"));
  assert.equal(required.persistenceStatus().state, "unavailable");
  assert.throws(() => required.preview(record, ACCOUNT_A), /加密同步队列不可用/u);
  assert.throws(() => required.setPreference("off"), /没有发送或保存/u);
  assert.deepEqual(required.listQueue(ACCOUNT_A), []);
});

test("canonical serializer is stable for encrypted store evidence", () => {
  assert.equal(canonicalJson({ schema_version: "1.0", revision: 1 }),
    '{\n  "schema_version": "1.0",\n  "revision": 1\n}\n');
});
