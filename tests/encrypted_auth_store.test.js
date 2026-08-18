"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EncryptedAuthStore, MAGIC, STATE_FILE, LEGACY_STATE_FILE } = require("../electron/encrypted-auth-store");

function temp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "oak-auth-store-")); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function state(revision = 1) { return { schema_version: "1.0", store_type: "oak_manuscript_auth_session", revision, session: null, pending: { state: "s".repeat(43), code_verifier: "v".repeat(64), redirect_uri: "oak-manuscript-auth://callback", created_at: "2026-07-29T00:00:00.000Z", expires_at: "2026-07-29T00:10:00.000Z" } }; }

test("auth store persists only protected bytes with a distinct domain header", (t) => {
  const root = temp(t); const authDir = path.join(root, "auth");
  const store = new EncryptedAuthStore({ rootDir: authDir, protect: (text) => Buffer.from(text, "utf8").map((b) => b ^ 0x5a), unprotect: (bytes) => Buffer.from(bytes).map((b) => b ^ 0x5a).toString("utf8") });
  store.save(state(), { expectedRevision: 0 });
  const bytes = fs.readFileSync(path.join(authDir, STATE_FILE));
  assert.equal(bytes.subarray(0, MAGIC.length).equals(MAGIC), true);
  assert.equal(bytes.includes(Buffer.from("code_verifier")), false);
  assert.deepEqual(store.load(), state());
});

test("auth store rejects stale revisions and tampered frames", (t) => {
  const root = temp(t); const authDir = path.join(root, "auth");
  const store = new EncryptedAuthStore({ rootDir: authDir, protect: (text) => Buffer.from(text), unprotect: (bytes) => bytes.toString("utf8") });
  store.save(state(), { expectedRevision: 0 });
  assert.throws(() => store.save(state(2), { expectedRevision: 0 }), /revision/);
  const target = path.join(authDir, STATE_FILE); const bytes = fs.readFileSync(target); bytes[0] ^= 1; fs.writeFileSync(target, bytes);
  assert.throws(() => store.load(), /文件头|无法用系统安全存储解密/);
});

function v2State(revision = 1) {
  return {
    schema_version: "2.0",
    store_type: "oak_manuscript_application_login",
    revision,
    session: {
      oak_account_id: "63000000-0000-4000-8000-000000000003",
      session_id: "62000000-0000-4000-8000-000000000002",
      refresh_token: "r".repeat(43),
      refresh_issued_at: "2026-08-14T12:00:00.000Z",
      refresh_last_used_at: "2026-08-14T12:00:00.000Z",
      refresh_expires_at: "2026-09-13T12:00:00.000Z",
    },
    pending: null,
  };
}

test("v2 auth store uses a new frame and never writes access tokens", (t) => {
  const root = temp(t); const authDir = path.join(root, "auth");
  const store = new EncryptedAuthStore({ rootDir: authDir, protect: (text) => Buffer.from(text, "utf8").map((b) => b ^ 0x5a), unprotect: (bytes) => Buffer.from(bytes).map((b) => b ^ 0x5a).toString("utf8") });
  store.save(v2State(), { expectedRevision: 0 });
  const bytes = fs.readFileSync(path.join(authDir, STATE_FILE));
  assert.equal(MAGIC.toString("ascii"), "OAKAUTH2");
  assert.equal(STATE_FILE, "session-v2.enc");
  assert.equal(bytes.includes(Buffer.from("refresh_token")), false);
  assert.equal(bytes.includes(Buffer.from("access_token")), false);
  assert.deepEqual(store.load(), v2State());
  assert.throws(() => store.save({ ...v2State(2), access_token: "a".repeat(43) }, { expectedRevision: 1 }), /access token/);
});

test("legacy session-v1 is purged without migration", (t) => {
  const root = temp(t); const authDir = path.join(root, "auth");
  fs.mkdirSync(authDir);
  fs.writeFileSync(path.join(authDir, "session-v1.enc"), Buffer.from("legacy-secret"));
  const store = new EncryptedAuthStore({ rootDir: authDir, protect: Buffer.from, unprotect: (bytes) => bytes.toString("utf8") });
  assert.equal(LEGACY_STATE_FILE, "session-v1.enc");
  assert.equal(fs.existsSync(path.join(authDir, LEGACY_STATE_FILE)), false);
  assert.equal(store.load(), null);
});

test("unsafe legacy hard links fail closed", (t) => {
  const root = temp(t); const authDir = path.join(root, "auth");
  fs.mkdirSync(authDir);
  const outside = path.join(root, "outside.enc");
  fs.writeFileSync(outside, Buffer.from("legacy-secret"));
  fs.linkSync(outside, path.join(authDir, "session-v1.enc"));
  assert.throws(() => new EncryptedAuthStore({ rootDir: authDir, protect: Buffer.from, unprotect: (bytes) => bytes.toString("utf8") }), /legacy session file is unsafe/);
  assert.equal(fs.existsSync(outside), true);
});
