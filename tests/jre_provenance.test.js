"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { PROFILE, validateEvidence, verifyEvidenceAgainstRuntime } = require("../scripts/jre_provenance");
const { provenanceReference } = require("../scripts/stage_epubcheck_jre");

const REPO_ROOT = path.resolve(__dirname, "..");

function evidence() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...PROFILE.evidence.split("/")), "utf8"));
}

test("tracked Temurin provenance binds all 490 official JDK files to the generated runtime", () => {
  const result = verifyEvidenceAgainstRuntime(REPO_ROOT);
  assert.equal(result.evidence.derivation.official_jdk_file_count, 490);
  assert.equal(result.evidence.derivation.byte_identical_jdk_file_count, 490);
  assert.equal(result.evidence.derivation.runtime_file_count, 207);
  assert.equal(result.machine_status, "verified");
  assert.equal(result.human_review_status, "pending");
  assert.equal(result.evidence.official_release.gpg.verification_status, "not_verified_no_openpgp_tool");
});

test("Temurin provenance rejects self-approval and official evidence drift", () => {
  for (const mutate of [
    (value) => { value.verification.human_review_status = "verified"; },
    (value) => { value.official_release.artifact.sha256 = "0".repeat(64); },
    (value) => { value.official_release.gpg.verification_status = "verified"; },
    (value) => { value.derivation.byte_identical_jdk_file_count = 489; },
    (value) => { value.official_jdk_files[0].sha256 = "0".repeat(64); },
    (value) => { [value.official_jdk_files[0], value.official_jdk_files[1]] = [value.official_jdk_files[1], value.official_jdk_files[0]]; },
    (value) => { value.unreviewed = true; },
  ]) {
    const changed = evidence();
    mutate(changed);
    assert.throws(() => validateEvidence(changed));
  }
});

test("JRE staging lock reference is canonical and matches the tracked evidence hash", () => {
  const reference = provenanceReference(REPO_ROOT, { required: true });
  assert.equal(reference.path, PROFILE.evidence);
  assert.match(reference.sha256, /^[0-9a-f]{64}$/);
  assert.equal(reference.machine_status, "verified");
  assert.equal(reference.human_review_status, "pending");
});

test("JRE staging rejects non-canonical provenance bytes", (t) => {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "jre-provenance-canonical-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, ...PROFILE.evidence.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, ...PROFILE.evidence.split("/")), target);
  fs.appendFileSync(target, "\n");
  assert.throws(() => provenanceReference(root, { required: true }), /不是 canonical/);
});
