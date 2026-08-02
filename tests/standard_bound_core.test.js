"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createStandardBoundCore } = require("../electron/standard-bound-core");

const PROJECT = "C:\\projects\\oak";
const ACTIVE = Object.freeze({
  name: "oak-rules",
  version: "1.0.1",
  pinned: true,
  sha256: "a".repeat(64),
  bundle_id: "oak-standards",
  release_sequence: 2,
  manifest_sha256: "b".repeat(64),
});
const PROJECT_IDENTITY = Object.freeze({
  ...ACTIVE,
  version: "1.0.0",
  sha256: "c".repeat(64),
  release_sequence: 1,
  manifest_sha256: "d".repeat(64),
});

function fixture({ activeError = null, statusResult = null, verifiedIdentity = PROJECT_IDENTITY } = {}) {
  const calls = [];
  const provider = {
    async verifiedActiveIdentity() {
      calls.push(["verify-active"]);
      if (activeError) throw activeError;
      return ACTIVE;
    },
    async verifyReleaseIdentity(identity, options) {
      calls.push(["verify-release", identity, options]);
      return verifiedIdentity;
    },
  };
  const bridge = {
    async runCore(args, timeout, options) {
      calls.push(["core", args, timeout, options]);
      if (args[0] === "project-standard-status") {
        return statusResult || {
          code: 0,
          json: {
            ok: true,
            project: PROJECT,
            standard_identity: PROJECT_IDENTITY,
            stored_identity: PROJECT_IDENTITY,
            legacy_migratable: false,
          },
          stderr: "",
        };
      }
      return { code: 0, json: { ok: true, command: args[0] }, stderr: "" };
    },
  };
  return { bound: createStandardBoundCore({ bridge, provider }), calls };
}

test("new-project core execution is bound to the JS-verified active identity", async () => {
  const { bound, calls } = fixture();
  const result = await bound.runNewProject([
    "create", "--input", "C:\\input.docx", "--project", PROJECT,
  ]);
  assert.equal(result.json.ok, true);
  assert.deepEqual(calls, [
    ["verify-active"],
    ["core", ["create", "--input", "C:\\input.docx", "--project", PROJECT], undefined, {
      expectedStandardIdentity: ACTIVE,
    }],
  ]);
});

test("existing-project execution verifies readiness, preflights the pin, then binds the exact release", async () => {
  const { bound, calls } = fixture();
  const result = await bound.runProject(PROJECT, ["check", "--project", PROJECT]);
  assert.equal(result.json.ok, true);
  assert.deepEqual(calls, [
    ["verify-active"],
    ["core", ["project-standard-status", "--project", PROJECT], undefined, undefined],
    ["verify-release", PROJECT_IDENTITY, { allowMigrationSource: false }],
    ["core", ["check", "--project", PROJECT], undefined, {
      expectedStandardIdentity: PROJECT_IDENTITY,
    }],
  ]);
});

test("only an explicit trusted caller can verify a project pin as a migration source", async () => {
  const { bound, calls } = fixture();
  await bound.runProject(
    PROJECT,
    ["plan-rulepack-upgrade", "--project", PROJECT, "--to-manifest-sha256", ACTIVE.manifest_sha256],
    { allowMigrationSource: true },
  );
  assert.deepEqual(calls.find((call) => call[0] === "verify-release"), [
    "verify-release",
    PROJECT_IDENTITY,
    { allowMigrationSource: true },
  ]);
});

test("a failed JS active verification starts no Python process", async () => {
  const unavailable = Object.assign(new Error("标准库损坏"), { code: "STANDARDS_NOT_READY" });
  const { bound, calls } = fixture({ activeError: unavailable });
  await assert.rejects(
    bound.runProject(PROJECT, ["check", "--project", PROJECT]),
    (error) => error === unavailable,
  );
  assert.deepEqual(calls, [["verify-active"]]);
});

test("project preflight and provider identity must match exactly before the actual command", async () => {
  const changed = { ...PROJECT_IDENTITY, sha256: "e".repeat(64) };
  const { bound, calls } = fixture({ verifiedIdentity: changed });
  await assert.rejects(
    bound.runProject(PROJECT, ["export", "--project", PROJECT]),
    /验签身份与项目身份不一致/,
  );
  assert.equal(calls.filter((call) => call[0] === "core").length, 1);
});

test("project-bound commands reject a mismatched project argument and malformed preflight", async () => {
  const first = fixture();
  await assert.rejects(
    first.bound.runProject(PROJECT, ["check", "--project", "C:\\projects\\other"]),
    /项目参数不一致/,
  );
  assert.equal(first.calls.length, 0);

  const second = fixture({
    statusResult: { code: 0, json: { ok: true, project: PROJECT }, stderr: "" },
  });
  await assert.rejects(
    second.bound.runProject(PROJECT, ["check", "--project", PROJECT]),
    /没有返回完整标准身份/,
  );
  assert.equal(second.calls.filter((call) => call[0] === "core").length, 1);
});
