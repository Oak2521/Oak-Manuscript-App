"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  PROFILE,
  validateEvidence,
  verifyEvidenceAgainstToolchain,
} = require("../scripts/builder_provenance");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE = path.join(ROOT, ...PROFILE.evidence.split("/"));

function trackedEvidence() {
  return JSON.parse(fs.readFileSync(EVIDENCE, "utf8"));
}

test("tracked Windows builder provenance binds three archives and the 385-file toolchain", () => {
  const result = verifyEvidenceAgainstToolchain(ROOT);
  assert.equal(result.machine_status, "verified");
  assert.equal(result.human_review_status, "pending");
  assert.equal(result.evidence.derivation.source_archive_count, 3);
  assert.equal(result.evidence.derivation.toolchain_file_count, 385);
  assert.deepEqual(result.evidence.redistribution.missing_named_license_materials,
    ["nsis-resources", "selected-winCodeSign"]);
});

test("builder provenance rejects self-approval, archive drift and hidden license claims", () => {
  const approved = trackedEvidence();
  approved.verification.human_review_status = "verified";
  assert.throws(() => validateEvidence(approved), /审阅状态/u);

  const archiveDrift = trackedEvidence();
  archiveDrift.official_releases[0].asset.sha256 = "0".repeat(64);
  assert.throws(() => validateEvidence(archiveDrift), /身份不匹配/u);

  const licenseClaim = trackedEvidence();
  licenseClaim.redistribution.missing_named_license_materials = [];
  assert.throws(() => validateEvidence(licenseClaim), /许可边界/u);

  const extra = trackedEvidence();
  extra.untrusted = true;
  assert.throws(() => validateEvidence(extra), /字段集合/u);
});

test("builder tracked lock binds the canonical provenance evidence", () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, ...PROFILE.runtimeLock.split("/")), "utf8"));
  assert.equal(lock.provenance_evidence.path, PROFILE.evidence);
  assert.equal(lock.provenance_evidence.machine_status, "verified");
  assert.equal(lock.provenance_evidence.human_review_status, "pending");
  assert.match(lock.provenance_evidence.sha256, /^[0-9a-f]{64}$/u);
});
