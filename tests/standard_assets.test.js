"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  CAPABILITIES_RELATIVE,
  MANIFEST_RELATIVE,
  PREVIOUS_MANIFEST_SHA256,
  RELEASE_SEQUENCE,
  RELEASE_VERSION,
  RULEPACK_RELATIVE,
  STANDARDS_RELATIVE,
  buildManifest,
  canonicalBytes,
  canonicalJson,
  verifyStandardAssets,
  writeStandardManifest,
} = require("../scripts/standard_assets");

const REPO_ROOT = path.resolve(__dirname, "..");

function target(root, relative) {
  return path.join(root, ...relative.split("/"));
}

function copyFixtureFile(root, relative) {
  const destination = target(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(target(REPO_ROOT, relative), destination);
}

function makeFixture(t) {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "standard-assets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of [CAPABILITIES_RELATIVE, RULEPACK_RELATIVE, STANDARDS_RELATIVE]) {
    copyFixtureFile(root, relative);
  }
  writeStandardManifest(root);
  return root;
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(target(root, relative), "utf8"));
}

function writeJson(root, relative, value) {
  fs.writeFileSync(target(root, relative), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("bundled standards assets have a current canonical manifest", () => {
  const result = verifyStandardAssets(REPO_ROOT);
  assert.equal(result.manifest.bundle_id, "oak-standards");
  assert.equal(result.manifest.release_sequence, RELEASE_SEQUENCE);
  assert.equal(result.manifest.release_sequence, 2);
  assert.equal(result.manifest.version, RELEASE_VERSION);
  assert.equal(result.manifest.version, "2.0.0");
  assert.equal(result.manifest.min_app, "0.1.0-alpha.5");
  assert.deepEqual(result.manifest.rollback_target, {
    manifest_sha256: PREVIOUS_MANIFEST_SHA256,
    release_sequence: 1,
  });
  assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.manifest, buildManifest(REPO_ROOT));
});

test("canonical JSON sorts ASCII object keys and rejects non-integer numbers", () => {
  assert.equal(canonicalJson({ z: 2, a: [true, { y: null, b: "值" }] }),
    '{"a":[true,{"b":"值","y":null}],"z":2}');
  assert.equal(canonicalBytes({ b: 1, a: 2 }).toString("utf8"), '{"a":2,"b":1}\n');
  assert.throws(() => canonicalJson({ value: 1.5 }), /safe integers/);
});

test("manifest verification rejects standards bytes changed after manifest creation", (t) => {
  const root = makeFixture(t);
  const standards = readJson(root, STANDARDS_RELATIVE);
  standards.standards[0].summary += " changed";
  writeJson(root, STANDARDS_RELATIVE, standards);
  assert.throws(() => verifyStandardAssets(root), /manifest is stale|does not match current assets/);
});

test("capability set must exactly match the application-supported rule metadata", (t) => {
  const root = makeFixture(t);
  const capabilityPath = target(root, CAPABILITIES_RELATIVE);
  const capabilities = readJson(root, CAPABILITIES_RELATIVE);
  capabilities.capabilities[0].auto_fixable = !capabilities.capabilities[0].auto_fixable;
  fs.writeFileSync(capabilityPath, canonicalBytes(capabilities));
  assert.throws(() => buildManifest(root), /does not exactly match implemented rule metadata/);
});

test("standards reverse rule index cannot drift from rule standard_refs", (t) => {
  const root = makeFixture(t);
  const standards = readJson(root, STANDARDS_RELATIVE);
  standards.standards.find((item) => item.standard_id === "OAK-REF-001").rule_ids.pop();
  writeJson(root, STANDARDS_RELATIVE, standards);
  assert.throws(() => buildManifest(root), /rule_ids does not match reverse rule references/);
});

test("external standards cannot hide an empty source URL behind an active status", (t) => {
  const root = makeFixture(t);
  const standards = readJson(root, STANDARDS_RELATIVE);
  const external = standards.standards.find((item) => item.standard_id === "GBT-7714-2025");
  external.status = "active";
  writeJson(root, STANDARDS_RELATIVE, standards);
  assert.throws(() => buildManifest(root), /Empty official_source_url/);
});

test("standard summaries cannot retain implementation placeholders", (t) => {
  const root = makeFixture(t);
  const standards = readJson(root, STANDARDS_RELATIVE);
  standards.standards[0].summary = "占位：以后补充";
  writeJson(root, STANDARDS_RELATIVE, standards);
  assert.throws(() => buildManifest(root), /contain placeholders/);
});

test("manifest must remain canonical compact JSON", (t) => {
  const root = makeFixture(t);
  const manifest = readJson(root, MANIFEST_RELATIVE);
  writeJson(root, MANIFEST_RELATIVE, manifest);
  assert.throws(() => verifyStandardAssets(root), /non-canonical/);
});

test("manifest writer normalizes every hash-pinned source asset to LF", (t) => {
  const root = makeFixture(t);
  for (const relative of [STANDARDS_RELATIVE, RULEPACK_RELATIVE]) {
    const file = target(root, relative);
    const text = fs.readFileSync(file, "utf8").replace(/\n/g, "\r\n");
    fs.writeFileSync(file, text, "utf8");
  }
  writeStandardManifest(root);
  for (const relative of [STANDARDS_RELATIVE, RULEPACK_RELATIVE]) {
    assert.doesNotMatch(fs.readFileSync(target(root, relative), "utf8"), /\r/);
  }
  assert.doesNotThrow(() => verifyStandardAssets(root));
});
