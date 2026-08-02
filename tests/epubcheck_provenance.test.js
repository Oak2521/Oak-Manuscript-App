"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  PROFILE,
  inventoryZipArchive,
  validateEvidence,
  verifyEvidenceAgainstDistribution,
} = require("../scripts/epubcheck_provenance");

const REPO_ROOT = path.resolve(__dirname, "..");

function fixture(t) {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "epubcheck-provenance-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of [PROFILE.distribution, PROFILE.evidence]) {
    const source = path.join(REPO_ROOT, ...relative.split("/"));
    const target = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.statSync(source).isDirectory()) fs.cpSync(source, target, { recursive: true });
    else fs.copyFileSync(source, target);
  }
  return root;
}

function storedZip(name, content) {
  const nameBytes = Buffer.from(name, "utf8");
  const payload = Buffer.from(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const localRecord = Buffer.concat([local, nameBytes, payload]);
  const centralRecord = Buffer.concat([central, nameBytes]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRecord.length, 12);
  eocd.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, eocd]);
}

test("tracked EpubCheck provenance verifies the exact official distribution and remains human-pending", () => {
  const result = verifyEvidenceAgainstDistribution(REPO_ROOT);
  assert.equal(result.evidence.derivation.official_file_count, 49);
  assert.equal(result.evidence.derivation.byte_identical_file_count, 49);
  assert.equal(result.machine_status, "verified");
  assert.equal(result.human_review_status, "pending");
  assert.equal(result.evidence.redistribution.license_signal_consistent, false);
});

test("EpubCheck provenance rejects self-approval, artifact drift, schema drift, and file reordering", () => {
  const original = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...PROFILE.evidence.split("/")), "utf8"));
  for (const mutate of [
    (value) => { value.verification.human_review_status = "verified"; },
    (value) => { value.official_release.artifact.sha256 = "0".repeat(64); },
    (value) => { value.official_release.release_api_sha256 = "0".repeat(64); },
    (value) => { value.unreviewed = true; },
    (value) => { [value.official_files[0], value.official_files[1]] = [value.official_files[1], value.official_files[0]]; },
  ]) {
    const evidence = structuredClone(original);
    mutate(evidence);
    assert.throws(() => validateEvidence(evidence));
  }
});

test("EpubCheck provenance derives file bytes directly from the fixed ZIP and rejects traversal", () => {
  const good = storedZip("epubcheck-5.3.0/example.txt", "official bytes");
  assert.deepEqual(inventoryZipArchive(good, "epubcheck-5.3.0"), [{
    path: "example.txt",
    size_bytes: 14,
    sha256: "62dbe6d8f9a2196315f659ab2e1776b2f1283428daba85f89cdd22a950c6dc5a",
  }]);
  const bad = storedZip("epubcheck-5.3.0/../evil.txt", "x");
  assert.throws(() => inventoryZipArchive(bad, "epubcheck-5.3.0"), /路径不安全/);
});

test("EpubCheck provenance fails closed after local JAR byte drift", (t) => {
  const root = fixture(t);
  const target = path.join(root, ...PROFILE.distribution.split("/"), "epubcheck.jar");
  const bytes = fs.readFileSync(target);
  bytes[0] ^= 0xff;
  fs.writeFileSync(target, bytes);
  assert.throws(() => verifyEvidenceAgainstDistribution(root), /不一致/);
});

test("EpubCheck provenance raw bytes must remain canonical", (t) => {
  const root = fixture(t);
  const target = path.join(root, ...PROFILE.evidence.split("/"));
  fs.appendFileSync(target, "\n");
  assert.throws(() => verifyEvidenceAgainstDistribution(root), /不是 canonical/);
});
