"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  MANIFEST_NAME,
  verifyWebMigrationBundle,
} = require("../scripts/verify_web_migration_bundle");

const REPO_ROOT = path.resolve(__dirname, "..");

function copyBundle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oak-web-migrations-"));
  const target = path.join(root, "web", "supabase");
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(path.join(REPO_ROOT, "web", "supabase"))) {
    fs.copyFileSync(path.join(REPO_ROOT, "web", "supabase", entry), path.join(target, entry));
  }
  return root;
}

test("tracked Supabase migration bundle has exact order and byte identities", (t) => {
  const result = verifyWebMigrationBundle(REPO_ROOT);
  assert.equal(result.ok, true);
  assert.equal(result.migration_count, 4);
  assert.deepEqual(result.migrations.map((entry) => entry.filename), [
    "001_web_job_state.sql",
    "002_sync_records.sql",
    "003_manuscript_entitlements.sql",
    "004_subscription_events_and_devices.sql",
  ]);
  assert.match(result.manifest_sha256, /^[0-9a-f]{64}$/);

  const copy = copyBundle();
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  const sql = path.join(copy, "web", "supabase", "002_sync_records.sql");
  fs.appendFileSync(sql, "-- tampered\n", "utf8");
  assert.throws(() => verifyWebMigrationBundle(copy), /与 manifest 不一致|完整.*事务/);
});

test("migration bundle rejects untracked SQL and non-canonical manifest", (t) => {
  const extra = copyBundle();
  t.after(() => fs.rmSync(extra, { recursive: true, force: true }));
  fs.writeFileSync(path.join(extra, "web", "supabase", "005_untracked.sql"),
    "begin;\ncommit;\n", "utf8");
  assert.throws(() => verifyWebMigrationBundle(extra), /未锁定|乱序/);

  const nonCanonical = copyBundle();
  t.after(() => fs.rmSync(nonCanonical, { recursive: true, force: true }));
  const manifestPath = path.join(nonCanonical, "web", "supabase", MANIFEST_NAME);
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.writeFileSync(manifestPath, JSON.stringify(parsed), "utf8");
  assert.throws(() => verifyWebMigrationBundle(nonCanonical), /canonical/);
});

test("migration bundle rejects sequence and digest substitution", (t) => {
  const root = copyBundle();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, "web", "supabase", MANIFEST_NAME);
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  parsed.migrations[1].sequence = 3;
  fs.writeFileSync(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  assert.throws(() => verifyWebMigrationBundle(root), /身份非法/);
});
