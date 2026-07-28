"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  EXPECTED_FUSE_CONFIG,
  FusePolicyError,
  verifyBuilderFuseConfiguration,
  verifyFuseWire,
  verifyPackagedFuseBinary,
} = require("../scripts/electron_fuse_policy");

const REPO_ROOT = path.resolve(__dirname, "..");
const ENABLE = "1".charCodeAt(0);
const DISABLE = "0".charCodeAt(0);

function expectedWire(extra = {}) {
  return {
    0: DISABLE,
    1: ENABLE,
    2: DISABLE,
    3: DISABLE,
    4: ENABLE,
    5: ENABLE,
    6: DISABLE,
    7: DISABLE,
    version: "1",
    ...extra,
  };
}

test("packaging fixes an explicit ASAR and known Electron fuse policy", () => {
  const build = require("../package.json").build;
  assert.equal(build.asar, true);
  assert.equal(build.disableAsarIntegrity, false);
  assert.deepEqual(build.electronFuses, EXPECTED_FUSE_CONFIG);
  const report = verifyBuilderFuseConfiguration(build);
  assert.equal(report.ok, true);
  assert.equal(report.run_as_node_disabled, true);
  assert.equal(report.embedded_asar_integrity, true);
  assert.equal(report.only_load_app_from_asar, true);
});

test("builder fuse policy rejects omissions, drift and integrity bypass", () => {
  const base = {
    asar: true,
    disableAsarIntegrity: false,
    electronFuses: { ...EXPECTED_FUSE_CONFIG },
  };
  assert.throws(
    () => verifyBuilderFuseConfiguration({ ...base, asar: false }),
    /ASAR/,
  );
  assert.throws(
    () => verifyBuilderFuseConfiguration({ ...base, disableAsarIntegrity: true }),
    /完整性/,
  );
  const omitted = structuredClone(base);
  delete omitted.electronFuses.onlyLoadAppFromAsar;
  assert.throws(() => verifyBuilderFuseConfiguration(omitted), /字段集合/);
  const drifted = structuredClone(base);
  drifted.electronFuses.enableNodeOptionsEnvironmentVariable = true;
  assert.throws(() => verifyBuilderFuseConfiguration(drifted), /不符合固定策略/);
});

test("known fuse bytes must match exactly and cannot inherit or be removed", () => {
  const report = verifyFuseWire(expectedWire(), { releaseTier: "sale" });
  assert.equal(report.ok, true);
  assert.equal(report.fully_known, true);
  assert.deepEqual(report.unknown_fuses, []);

  for (const [index, value] of [[2, ENABLE], [4, DISABLE], [7, 0x90], [5, 0x72]]) {
    assert.throws(
      () => verifyFuseWire(expectedWire({ [index]: value }), { releaseTier: "alpha" }),
      FusePolicyError,
    );
  }
  assert.throws(
    () => verifyFuseWire({ ...expectedWire(), version: "2" }, { releaseTier: "alpha" }),
    /版本/,
  );
});

test("unknown Electron 43 fuse remains an alpha blocker and fails the sale gate", () => {
  const wire = expectedWire({ 8: ENABLE });
  const alpha = verifyFuseWire(wire, { releaseTier: "alpha" });
  assert.equal(alpha.ok, true);
  assert.equal(alpha.fully_known, false);
  assert.deepEqual(alpha.blockers.map((item) => item.code), [
    "ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING",
  ]);
  assert.deepEqual(alpha.unknown_fuses, [{ index: 8, state: ENABLE }]);
  assert.throws(
    () => verifyFuseWire(wire, { releaseTier: "sale" }),
    (error) => error instanceof FusePolicyError &&
      error.report.blockers[0].code === "ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING",
  );
});

test("packaged fuse verification rejects unsafe files before reading the wire", async (t) => {
  const root = fs.mkdtempSync(path.join(REPO_ROOT, "out", "test-tmp", "fuse-policy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, "app.exe");
  fs.writeFileSync(executable, "fixture");
  let calls = 0;
  const report = await verifyPackagedFuseBinary(executable, {
    releaseTier: "alpha",
    readWire: async () => { calls += 1; return expectedWire({ 8: ENABLE }); },
  });
  assert.equal(report.ok, true);
  assert.equal(calls, 1);

  const missing = path.join(root, "missing.exe");
  await assert.rejects(
    verifyPackagedFuseBinary(missing, {
      releaseTier: "alpha",
      readWire: async () => { calls += 1; return expectedWire(); },
    }),
    /常规文件/,
  );
  assert.equal(calls, 1);

  const outside = path.join(root, "outside.exe");
  fs.linkSync(executable, outside);
  await assert.rejects(
    verifyPackagedFuseBinary(executable, {
      releaseTier: "alpha",
      readWire: async () => expectedWire(),
    }),
    /硬链接|单链接/,
  );
});

test("build chains verify packaged fuses before resource and smoke claims", () => {
  const scripts = require("../package.json").scripts;
  assert.equal(
    scripts["verify:packaged:fuses:win"],
    "node scripts/electron_fuse_policy.js --binary \"release/win-unpacked/湖岸稿件 Oak Manuscript.exe\" --release-tier auto",
  );
  assert.match(
    scripts["build:win"],
    /run_electron_builder\.js --win --x64 .*verify:packaged:fuses:win .*verify:packaged:win .*smoke:packaged:win/,
  );
  assert.match(scripts["build:mac:x64"], /verify:packaged:fuses:mac:x64 .*verify:packaged:mac:x64$/);
  assert.match(scripts["build:mac:arm64"], /verify:packaged:fuses:mac:arm64 .*verify:packaged:mac:arm64$/);
});
