"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const VERIFIER = path.join(ROOT, "scripts", "verify_hosted_ci_workflow.js");

function loadVerifier() {
  assert.equal(
    fs.existsSync(VERIFIER),
    true,
    "Hosted CI verifier must exist before the workflow can be accepted",
  );
  return require(VERIFIER);
}

test("repository Hosted CI provides safe Windows and Linux source gates", () => {
  const { verifyHostedCiWorkflow } = loadVerifier();
  assert.deepEqual(verifyHostedCiWorkflow(ROOT), { ok: true, errors: [] });
});

test("Hosted CI verifier rejects privileged, secret-bearing, and floating workflows", () => {
  const { validateHostedCiText } = loadVerifier();
  const result = validateHostedCiText(`
name: unsafe
on: pull_request_target
permissions:
  contents: write
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "\${{ secrets.RELEASE_KEY }}"
`);

  assert.equal(result.ok, false);
  assert.deepEqual(
    new Set(result.errors),
    new Set([
      "PULL_REQUEST_TARGET_FORBIDDEN",
      "WRITE_PERMISSION_FORBIDDEN",
      "SECRET_REFERENCE_FORBIDDEN",
      "FLOATING_ACTION_REFERENCE_FORBIDDEN",
      "WINDOWS_RUNNER_REQUIRED",
      "PINNED_UBUNTU_RUNNER_REQUIRED",
      "NPM_CI_REQUIRED",
      "NPM_TEST_REQUIRED",
      "SELF_VERIFICATION_REQUIRED",
      "CHECKOUT_CREDENTIAL_PERSISTENCE_MUST_BE_DISABLED",
    ]),
  );
});
