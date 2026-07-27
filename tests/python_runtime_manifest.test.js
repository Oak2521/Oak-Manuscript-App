"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildManifest,
  manifestRelative,
  verifyRuntime,
  writePinnedManifest,
} = require("../scripts/python_runtime_manifest");

const REPO_ROOT = path.resolve(__dirname, "..");

function makeFixture(t) {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "python-runtime-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = path.join(root, "python-runtime");
  fs.mkdirSync(runtime, { recursive: true });
  for (const relative of [
    "LICENSE.txt",
    "python.exe",
    "python3.dll",
    "python313.dll",
    "python313.zip",
    "python313._pth",
  ]) {
    fs.writeFileSync(path.join(runtime, relative), `fixture ${relative}\n`);
  }
  fs.writeFileSync(
    path.join(runtime, "python313._pth"),
    "python313.zip\n.\n\n#import site\n..\\python\n",
  );
  writePinnedManifest(root, { platform: "win32", arch: "x64" });
  return root;
}

test("Python runtime manifest pins the complete Windows x64 distribution", (t) => {
  const root = makeFixture(t);
  const result = verifyRuntime(root, { platform: "win32", arch: "x64" });
  assert.equal(result.manifest.runtime.version, "3.13.14");
  assert.equal(result.manifest.file_count, 6);
  assert.equal(
    path.relative(root, result.manifestTarget).split(path.sep).join("/"),
    manifestRelative("win32", "x64"),
  );
});

test("Python runtime manifest rejects changed executable bytes", (t) => {
  const root = makeFixture(t);
  fs.appendFileSync(path.join(root, "python-runtime", "python.exe"), "tamper\n");
  assert.throws(
    () => verifyRuntime(root, { platform: "win32", arch: "x64" }),
    /SHA-256 或大小与固定清单不一致：python\.exe/,
  );
});

test("Python runtime manifest rejects unlisted extra files", (t) => {
  const root = makeFixture(t);
  fs.writeFileSync(path.join(root, "python-runtime", "extra.dll"), "extra\n");
  assert.throws(
    () => verifyRuntime(root, { platform: "win32", arch: "x64" }),
    /固定清单漏列实际文件：extra\.dll/,
  );
});

test("Python runtime manifest rejects a deleted required file", (t) => {
  const root = makeFixture(t);
  fs.rmSync(path.join(root, "python-runtime", "python313.zip"));
  assert.throws(
    () => verifyRuntime(root, { platform: "win32", arch: "x64" }),
    /固定清单列出不存在文件：python313\.zip/,
  );
});

test("Python runtime lock creation rejects site import or arbitrary search paths", (t) => {
  const root = makeFixture(t);
  fs.writeFileSync(
    path.join(root, "python-runtime", "python313._pth"),
    "python313.zip\n.\nC:\\attacker\nimport site\n..\\python\n",
  );
  assert.throws(
    () => writePinnedManifest(root, { platform: "win32", arch: "x64" }),
    /不得导入 site/,
  );
});

test("macOS x64 and arm64 Python runtime locks require the exact pinned version", (t) => {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "python-runtime-macos-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const arch of ["x64", "arm64"]) {
    const runtime = path.join(root, `python-runtime-macos-${arch}`);
    fs.mkdirSync(path.join(runtime, "bin"), { recursive: true });
    fs.writeFileSync(path.join(runtime, "LICENSE.txt"), "fixture license\n");
    fs.writeFileSync(path.join(runtime, "bin", "python3"), "fixture executable\n");
    const manifest = buildManifest(root, { platform: "darwin", arch });
    assert.equal(manifest.runtime.version, "3.13.14");
    assert.throws(
      () => buildManifest(root, { platform: "darwin", arch, version: "3.12.9" }),
      /版本未固定或不匹配/,
    );
  }
});
