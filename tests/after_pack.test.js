"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  afterPack,
  createFuseWriteConfiguration,
} = require("../scripts/after_pack");

const REPO_ROOT = path.resolve(__dirname, "..");

const FUSE_API = Object.freeze({
  FuseVersion: { V1: "1" },
  FuseV1Options: {
    RunAsNode: 0,
    EnableCookieEncryption: 1,
    EnableNodeOptionsEnvironmentVariable: 2,
    EnableNodeCliInspectArguments: 3,
    EnableEmbeddedAsarIntegrityValidation: 4,
    OnlyLoadAppFromAsar: 5,
    LoadBrowserProcessSpecificV8Snapshot: 6,
    GrantFileProtocolExtraPrivileges: 7,
    WasmTrapHandlers: 8,
  },
});

test("afterPack writes all nine fuses strictly and verifies the resulting binary", async (t) => {
  const root = fs.mkdtempSync(path.join(REPO_ROOT, "out", "test-tmp", "after-pack-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appOutDir = path.join(root, "release", "win-unpacked");
  fs.mkdirSync(appOutDir, { recursive: true });
  const executable = path.join(appOutDir, "Oak.exe");
  fs.writeFileSync(executable, "fixture");
  const calls = [];

  const report = await afterPack({
    appOutDir,
    electronPlatformName: "win32",
    arch: "x64",
    packager: {
      projectDir: root,
      appInfo: { productFilename: "Oak", version: "0.1.0-alpha.14" },
    },
  }, {
    loadFuses: async () => ({
      ...FUSE_API,
      pathToFuseFile: (target) => target,
      async flipFuses(target, config) { calls.push(["flip", target, config]); return 1; },
    }),
    async verify(target, options) {
      calls.push(["verify", target, options]);
      return { ok: true, fully_known: true };
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.sentinels, 1);
  assert.equal(calls[0][0], "flip");
  assert.equal(calls[0][1], executable);
  assert.deepEqual(calls[0][2], {
    0: false,
    1: true,
    2: false,
    3: false,
    4: true,
    5: true,
    6: false,
    7: false,
    8: true,
    version: "1",
    strictlyRequireAllFuses: true,
    resetAdHocDarwinSignature: false,
  });
  assert.deepEqual(calls[1], ["verify", executable, {
    root,
    releaseTier: "alpha",
  }]);
});

test("macOS arm64 requests ad-hoc signature reset and API drift fails closed", () => {
  const arm64 = createFuseWriteConfiguration(FUSE_API, {
    platform: "darwin",
    arch: "arm64",
  });
  assert.equal(arm64.resetAdHocDarwinSignature, true);
  assert.throws(
    () => createFuseWriteConfiguration({
      ...FUSE_API,
      FuseV1Options: { ...FUSE_API.FuseV1Options, WasmTrapHandlers: 9 },
    }, { platform: "win32", arch: "x64" }),
    /WasmTrapHandlers/,
  );
});

test("afterPack rejects multiple wires for architecture-specific builds", async (t) => {
  const root = fs.mkdtempSync(path.join(REPO_ROOT, "out", "test-tmp", "after-pack-wire-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appOutDir = path.join(root, "release", "win-unpacked");
  fs.mkdirSync(appOutDir, { recursive: true });
  fs.writeFileSync(path.join(appOutDir, "Oak.exe"), "fixture");
  await assert.rejects(afterPack({
    appOutDir,
    electronPlatformName: "win32",
    arch: "x64",
    packager: {
      projectDir: root,
      appInfo: { productFilename: "Oak", version: "0.1.0-alpha.14" },
    },
  }, {
    loadFuses: async () => ({
      ...FUSE_API,
      pathToFuseFile: (target) => target,
      flipFuses: async () => 2,
    }),
  }), /恰好写入 1 个/);
});

test("afterPack rejects an output path outside the project before mutation", async () => {
  let loaded = false;
  await assert.rejects(
    afterPack({
      appOutDir: path.resolve(REPO_ROOT, ".."),
      electronPlatformName: "win32",
      arch: "x64",
      packager: {
        projectDir: REPO_ROOT,
        appInfo: { productFilename: "Oak", version: "0.1.0-alpha.14" },
      },
    }, {
      loadFuses: async () => { loaded = true; return FUSE_API; },
    }),
    /路径逃逸|项目目录/,
  );
  assert.equal(loaded, false);
});
