"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const RUNNER = path.join(ROOT, "scripts", "run_hosted_source_tests.js");

test("Hosted source runner freezes a portable OAK-10 test surface", () => {
  assert.equal(fs.existsSync(RUNNER), true, "Hosted source test runner must exist");
  const { HOSTED_NODE_TESTS } = require(RUNNER);

  assert.equal(Array.isArray(HOSTED_NODE_TESTS), true);
  assert.equal(HOSTED_NODE_TESTS.length >= 30, true);
  assert.deepEqual(HOSTED_NODE_TESTS, [...new Set(HOSTED_NODE_TESTS)].sort());
  for (const relativePath of HOSTED_NODE_TESTS) {
    assert.equal(relativePath.startsWith("tests/"), true);
    assert.equal(relativePath.endsWith(".test.js"), true);
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), true, relativePath);
  }

  for (const required of [
    "tests/hosted_ci_workflow.test.js",
    "tests/hosted_source_test_runner.test.js",
    "tests/oak_account_auth.test.js",
    "tests/oak_account_contract.test.js",
    "tests/oak_account_security_scan.test.js",
    "tests/subscription_revoke_desktop_refresh_e2e.test.js",
    "tests/web_entitlement_runtime.test.js",
    "tests/web_sync_record_runtime.test.js",
  ]) {
    assert.equal(HOSTED_NODE_TESTS.includes(required), true, required);
  }

  for (const localOnly of [
    "tests/builder_provenance.test.js",
    "tests/electron_provenance.test.js",
    "tests/electron_runtime_manifest.test.js",
    "tests/epubcheck_provenance.test.js",
    "tests/jre_provenance.test.js",
    "tests/python_runtime_manifest.test.js",
    "tests/release_packaging.test.js",
    "tests/runtime_provenance.test.js",
  ]) {
    assert.equal(HOSTED_NODE_TESTS.includes(localOnly), false, localOnly);
  }
});
