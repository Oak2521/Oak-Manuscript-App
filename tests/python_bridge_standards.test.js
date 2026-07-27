"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  configureStandardsStoreRoot,
  createPythonEnvironment,
} = require("../electron/python-bridge");

const ROOT = path.resolve(__dirname, "..");

test("Python bridge injects only the main-process-fixed standards store root", () => {
  const trusted = path.join(ROOT, "out", "python-bridge-standards");
  assert.equal(configureStandardsStoreRoot(trusted), trusted);
  assert.equal(configureStandardsStoreRoot(trusted), trusted);
  const env = createPythonEnvironment({
    PATH: process.env.PATH || "",
    OAK_STANDARDS_STORE: path.join(ROOT, "out", "attacker"),
  }, { electronExec: process.execPath, packaged: false });
  assert.equal(env.OAK_STANDARDS_STORE, trusted);
  assert.throws(
    () => configureStandardsStoreRoot(path.join(ROOT, "out", "different")),
    /已固定/,
  );
});

test("isolated Python environment rejects a relative standards store root", () => {
  assert.throws(
    () => createPythonEnvironment({}, {
      electronExec: process.execPath,
      packaged: false,
      standardsStoreRoot: "relative/store",
    }),
    /必须是绝对路径/,
  );
});

test("Python bridge strips inherited standard bindings and injects only an exact trusted identity", () => {
  const identity = {
    name: "oak-rules",
    version: "1.0.0",
    pinned: true,
    sha256: "a".repeat(64),
    bundle_id: "oak-standards",
    release_sequence: 1,
    manifest_sha256: "b".repeat(64),
  };
  const env = createPythonEnvironment({
    PATH: process.env.PATH || "",
    OAK_EXPECTED_STANDARD_IDENTITY: JSON.stringify({ manifest_sha256: "c".repeat(64) }),
  }, {
    electronExec: process.execPath,
    packaged: false,
    expectedStandardIdentity: identity,
  });
  assert.deepEqual(JSON.parse(env.OAK_EXPECTED_STANDARD_IDENTITY), identity);

  const unbound = createPythonEnvironment({
    OAK_EXPECTED_STANDARD_IDENTITY: "attacker-controlled",
  }, { electronExec: process.execPath, packaged: false });
  assert.equal(Object.hasOwn(unbound, "OAK_EXPECTED_STANDARD_IDENTITY"), false);

  assert.throws(
    () => createPythonEnvironment({}, {
      electronExec: process.execPath,
      packaged: false,
      expectedStandardIdentity: { ...identity, pinned: false },
    }),
    /标准包绑定身份非法/,
  );
  assert.throws(
    () => createPythonEnvironment({}, {
      electronExec: process.execPath,
      packaged: false,
      expectedStandardIdentity: { ...identity, version: "9007199254740992.0.0" },
    }),
    /标准包绑定身份非法/,
  );
});
