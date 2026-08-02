"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  CPYTHON_PROFILE,
  buildEvidence,
  validateEvidence,
  verifyEvidenceAgainstRuntime,
  writeEvidence,
} = require("../scripts/runtime_provenance");

const REPO_ROOT = path.resolve(__dirname, "..");

function tempRoot(t, prefix) {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("tracked CPython evidence verifies the exact local runtime and remains human-pending", () => {
  const result = verifyEvidenceAgainstRuntime(REPO_ROOT);
  assert.equal(result.evidence.subject.version, "3.13.14");
  assert.equal(result.evidence.derivation.official_file_count, 34);
  assert.equal(result.evidence.derivation.byte_identical_file_count, 33);
  assert.equal(result.evidence.derivation.controlled_modifications.length, 1);
  assert.equal(result.machine_status, "verified");
  assert.equal(result.human_review_status, "pending");
  assert.equal(result.evidence_sha256, "b198a727a0c12640a8a020758bcfc5dc41e01e577a25576795b1d081e3513176");
});

test("CPython evidence validator rejects schema drift, artifact drift, self-approval and reordering", () => {
  const evidence = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, CPYTHON_PROFILE.evidenceRelative),
    "utf8",
  ));
  const schema = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, "config", "schemas", "runtime-provenance-v1.schema.json"),
    "utf8",
  ));
  assert.equal(schema.$defs.artifact.properties.sha256.const, CPYTHON_PROFILE.artifactSha256);
  assert.equal(schema.$defs.verification.properties.human_review_status.const, "pending");

  const unknown = jsonClone(evidence);
  unknown.unreviewed = true;
  assert.throws(() => validateEvidence(unknown), /字段集合不严格匹配/);

  const artifactDrift = jsonClone(evidence);
  artifactDrift.official_release.artifact.sha256 = "0".repeat(64);
  assert.throws(() => validateEvidence(artifactDrift), /官方发行物身份不匹配/);

  const selfApproved = jsonClone(evidence);
  selfApproved.verification.human_review_status = "approved";
  assert.throws(() => validateEvidence(selfApproved), /再分发或审阅状态非法/);

  const reordered = jsonClone(evidence);
  [reordered.official_files[0], reordered.official_files[1]] =
    [reordered.official_files[1], reordered.official_files[0]];
  assert.throws(() => validateEvidence(reordered), /非法、重复或未排序/);
});

test("CPython runtime verification fails closed after executable byte drift", (t) => {
  const root = tempRoot(t, "runtime-provenance-drift-");
  fs.cpSync(path.join(REPO_ROOT, "python-runtime"), path.join(root, "python-runtime"), { recursive: true });
  const evidenceTarget = path.join(root, ...CPYTHON_PROFILE.evidenceRelative.split("/"));
  fs.mkdirSync(path.dirname(evidenceTarget), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, CPYTHON_PROFILE.evidenceRelative), evidenceTarget);

  assert.equal(verifyEvidenceAgainstRuntime(root).machine_status, "verified");
  fs.appendFileSync(path.join(root, "python-runtime", "python.exe"), "tamper\n");
  assert.throws(
    () => verifyEvidenceAgainstRuntime(root),
    /本地文件不再匹配官方发行物：python\.exe/,
  );
});

test("synthetic provenance build is deterministic and atomically installs a verifiable record", (t) => {
  const root = tempRoot(t, "runtime-provenance-build-");
  const officialRoot = path.join(root, "official");
  const localRoot = path.join(root, "python-runtime");
  const downloads = path.join(root, "downloads");
  fs.mkdirSync(officialRoot, { recursive: true });
  fs.mkdirSync(localRoot, { recursive: true });
  fs.mkdirSync(downloads, { recursive: true });

  const license = Buffer.from("fixture PSF license\n", "utf8");
  const officialPath = Buffer.from("python.zip\r\n.\r\n", "utf8");
  const appended = Buffer.from("..\\python\r\n", "utf8");
  fs.writeFileSync(path.join(officialRoot, "LICENSE.txt"), license);
  fs.writeFileSync(path.join(officialRoot, "python._pth"), officialPath);
  fs.writeFileSync(path.join(localRoot, "LICENSE.txt"), license);
  fs.writeFileSync(path.join(localRoot, "python._pth"), Buffer.concat([officialPath, appended]));

  const archive = Buffer.from("fixture official archive\n", "utf8");
  fs.writeFileSync(path.join(downloads, "runtime.zip"), archive);
  fs.writeFileSync(path.join(downloads, "runtime.zip.sigstore"), "fixture sigstore\n");
  fs.writeFileSync(path.join(downloads, "runtime.zip.spdx.json"), "fixture spdx\n");
  fs.writeFileSync(path.join(downloads, "runtime.zip.asc"), "fixture gpg\n");

  const profile = {
    ...CPYTHON_PROFILE,
    version: "3.13.99",
    runtimeManifestRelative: "config/tool-manifests/fixture.json",
    evidenceRelative: "config/provenance/fixture.json",
    releasePageUrl: "https://www.python.org/downloads/release/python-31399/",
    artifactUrl: "https://www.python.org/ftp/python/3.13.99/runtime.zip",
    artifactFilename: "runtime.zip",
    artifactSizeBytes: archive.length,
    artifactSha256: sha256(archive),
    sigstoreUrl: "https://www.python.org/ftp/python/3.13.99/runtime.zip.sigstore",
    spdxUrl: "https://www.python.org/ftp/python/3.13.99/runtime.zip.spdx.json",
    gpgUrl: "https://www.python.org/ftp/python/3.13.99/runtime.zip.asc",
    officialFileCount: 2,
    controlledPath: "python._pth",
    appendedBytes: appended,
    signerIdentity: "email:fixture@python.org",
  };
  const signatureFacts = {
    media_type: "application/vnd.dev.sigstore.bundle.v0.3+json",
    artifact_digest_matches: true,
    leaf_signature_verified: true,
    certificate_issuer: "fixture sigstore.dev issuer",
    certificate_identity: profile.signerIdentity,
    certificate_valid_from: "2026-07-28T00:00:00.000Z",
    certificate_valid_to: "2026-07-28T00:10:00.000Z",
    transparency_log_kind: "hashedrekord",
    transparency_log_entry_index: "1",
    transparency_log_proof_index: "2",
    transparency_log_index_consistent: false,
    full_sigstore_trust_chain_verified: false,
  };
  const spdxFacts = {
    format: "SPDX-2.3",
    document_name: "fixture",
    artifact_digest_matches: true,
    supplier: `Organization: ${profile.publisher}`,
    license_concluded: profile.licenseId,
  };
  const options = {
    profile,
    officialRootRelative: "official",
    archiveRelative: "downloads/runtime.zip",
    sigstoreRelative: "downloads/runtime.zip.sigstore",
    spdxRelative: "downloads/runtime.zip.spdx.json",
    gpgRelative: "downloads/runtime.zip.asc",
    observedAt: "2026-07-28",
    sigstoreVerifier: () => signatureFacts,
    spdxVerifier: () => spdxFacts,
  };

  assert.deepEqual(buildEvidence(root, options), buildEvidence(root, options));
  const installed = writeEvidence(root, options);
  assert.equal(installed.machine_status, "verified");
  assert.equal(installed.human_review_status, "pending");
  assert.equal(JSON.stringify(installed.evidence), JSON.stringify(buildEvidence(root, options)));
});
