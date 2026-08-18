"use strict";

const fs = require("node:fs");
const path = require("node:path");

const WORKFLOW_RELATIVE_PATH = ".github/workflows/hosted-ci.yml";

function validateHostedCiText(text) {
  if (typeof text !== "string") throw new TypeError("workflow text must be a string");
  const errors = [];
  const add = (code) => {
    if (!errors.includes(code)) errors.push(code);
  };

  if (/\bpull_request_target\s*:/u.test(text) || /\bon:\s*pull_request_target\b/u.test(text)) {
    add("PULL_REQUEST_TARGET_FORBIDDEN");
  }
  if (/^\s*(?:actions|checks|contents|deployments|id-token|packages|pull-requests|statuses):\s*write\s*$/gmu.test(text)) {
    add("WRITE_PERMISSION_FORBIDDEN");
  }
  if (/\$\{\{\s*secrets\./u.test(text)) add("SECRET_REFERENCE_FORBIDDEN");

  const actionReferences = [...text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)\s*(?:#.*)?$/gmu)]
    .map((match) => match[1]);
  if (actionReferences.length === 0 || actionReferences.some((reference) => {
    const at = reference.lastIndexOf("@");
    return at < 1 || !/^[0-9a-f]{40}$/u.test(reference.slice(at + 1));
  })) {
    add("FLOATING_ACTION_REFERENCE_FORBIDDEN");
  }

  if (!/^\s*runs-on:\s*windows-2025\s*$/mu.test(text)) add("WINDOWS_RUNNER_REQUIRED");
  if (!/^\s*runs-on:\s*ubuntu-24\.04\s*$/mu.test(text)) add("PINNED_UBUNTU_RUNNER_REQUIRED");
  if (!/^\s*run:\s*npm ci\s*$/mu.test(text)) add("NPM_CI_REQUIRED");
  if (!/^\s*run:\s*npm test\s*$/mu.test(text)) add("NPM_TEST_REQUIRED");
  if (!/^\s*run:\s*npm run verify:hosted-ci\s*$/mu.test(text)) add("SELF_VERIFICATION_REQUIRED");
  if (!/^\s*persist-credentials:\s*false\s*$/mu.test(text)) {
    add("CHECKOUT_CREDENTIAL_PERSISTENCE_MUST_BE_DISABLED");
  }
  if (/\b(?:netlify\s+deploy|npm\s+publish|gh\s+release|docker\s+push)\b/u.test(text)) {
    add("DEPLOY_OR_PUBLISH_FORBIDDEN");
  }
  if (/\bnpm\s+run\s+verify:electron-runtime\b/u.test(text)) {
    add("LOCAL_ELECTRON_RUNTIME_GATE_FORBIDDEN");
  }

  return { ok: errors.length === 0, errors };
}

function verifyHostedCiWorkflow(root = path.resolve(__dirname, "..")) {
  const workflowPath = path.join(root, WORKFLOW_RELATIVE_PATH);
  if (!fs.existsSync(workflowPath)) {
    return { ok: false, errors: ["WORKFLOW_MISSING"] };
  }
  return validateHostedCiText(fs.readFileSync(workflowPath, "utf8"));
}

if (require.main === module) {
  const result = verifyHostedCiWorkflow();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  validateHostedCiText,
  verifyHostedCiWorkflow,
};
