"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  PROFILE,
  treeDigest,
  validateEvidence,
  verifyEvidenceAgainstRuntime,
} = require("../scripts/electron_provenance");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE = path.join(ROOT, ...PROFILE.evidence.split("/"));

function trackedEvidence() {
  return JSON.parse(fs.readFileSync(EVIDENCE, "utf8"));
}

test("tracked Electron provenance binds all 75 official runtime files", () => {
  const result = verifyEvidenceAgainstRuntime(ROOT);
  assert.equal(result.machine_status, "verified");
  assert.equal(result.human_review_status, "pending");
  assert.equal(result.evidence.derivation.official_file_count, 75);
  assert.equal(result.evidence.derivation.byte_identical_file_count, 75);
  assert.equal(result.evidence.derivation.official_tree_sha256, PROFILE.treeSha256);
  assert.equal(treeDigest(result.evidence.official_files).total_bytes, PROFILE.totalBytes);
});

test("Electron provenance rejects self-approval and official evidence drift", () => {
  const approved = trackedEvidence();
  approved.verification.human_review_status = "verified";
  assert.throws(() => validateEvidence(approved), /审阅状态|官方发行身份/u);

  const digestDrift = trackedEvidence();
  digestDrift.official_release.artifact.sha256 = "0".repeat(64);
  assert.throws(() => validateEvidence(digestDrift), /官方发行身份/u);

  const reordered = trackedEvidence();
  reordered.official_files = [...reordered.official_files].reverse();
  assert.throws(() => validateEvidence(reordered), /严格排序/u);

  const extra = trackedEvidence();
  extra.untrusted = true;
  assert.throws(() => validateEvidence(extra), /字段集合/u);
});

test("Electron runtime lock reference is canonical and matches the tracked evidence hash", () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, ...PROFILE.runtimeLock.split("/")), "utf8"));
  assert.equal(lock.provenance_evidence.path, PROFILE.evidence);
  assert.equal(lock.provenance_evidence.machine_status, "verified");
  assert.equal(lock.provenance_evidence.human_review_status, "pending");
  assert.match(lock.provenance_evidence.sha256, /^[0-9a-f]{64}$/u);
});
