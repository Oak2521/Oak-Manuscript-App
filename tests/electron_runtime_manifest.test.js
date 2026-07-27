"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildManifest,
  parseArgs,
  readLockedElectron,
  verifyRuntime,
  writePinnedManifest,
} = require("../scripts/electron_runtime_manifest");
const electronDistHook = require("../scripts/electron_dist");
const { validateElectronDist } = electronDistHook;
const { addCurrentReleaseBlockers } = require("../scripts/verify_packaged_resources");

const REPO_ROOT = path.resolve(__dirname, "..");
const VERSION = "43.1.0";

function write(root, relative, content = "fixture\n") {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function writeJson(root, relative, value) {
  return write(root, relative, `${JSON.stringify(value, null, 2)}\n`);
}

function transactionArtifacts(manifestTarget) {
  const parent = path.dirname(manifestTarget);
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent)
    .filter((name) => name.startsWith(`.${path.basename(manifestTarget)}.txn-`));
}

function fakePe(machine = 0x8664) {
  const buffer = Buffer.alloc(512);
  buffer.write("MZ", 0, "ascii");
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write("PE\u0000\u0000", 0x80, "binary");
  buffer.writeUInt16LE(machine, 0x84);
  return buffer;
}

function makeFixture(t) {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "electron-runtime-lock-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeJson(root, "package-lock.json", {
    name: "fixture",
    lockfileVersion: 3,
    packages: {
      "": { devDependencies: { electron: `^${VERSION}` } },
      "node_modules/electron": {
        version: VERSION,
        resolved: `https://registry.npmjs.org/electron/-/electron-${VERSION}.tgz`,
        integrity: `sha512-${Buffer.alloc(64, 7).toString("base64")}`,
      },
    },
  });
  writeJson(root, "node_modules/electron/package.json", { name: "electron", version: VERSION });
  for (const relative of [
    "LICENSE",
    "LICENSES.chromium.html",
    "icudtl.dat",
    "resources.pak",
    "resources/default_app.asar",
    "locales/en-US.pak",
  ]) write(root, `node_modules/electron/dist/${relative}`, `${relative}\n`);
  write(root, "node_modules/electron/dist/electron.exe", fakePe());
  write(root, "node_modules/electron/dist/version", `${VERSION}\n`);
  const result = writePinnedManifest(root, { platform: "win32", arch: "x64" });
  return {
    root,
    dist: path.join(root, "node_modules", "electron", "dist"),
    manifest: result.target,
  };
}

test("Electron runtime lock derives 43.1.0 from package-lock and verification is read-only", (t) => {
  const fixture = makeFixture(t);
  assert.equal(readLockedElectron(fixture.root).version, VERSION);
  const beforeBytes = fs.readFileSync(fixture.manifest);
  const beforeMtime = fs.statSync(fixture.manifest, { bigint: true }).mtimeNs;
  const result = verifyRuntime(fixture.root);
  assert.equal(result.manifest.runtime.version, VERSION);
  assert.equal(result.manifest.file_count, 8);
  assert.deepEqual(result.manifest.directories, ["locales", "resources"]);
  assert.deepEqual(fs.readFileSync(fixture.manifest), beforeBytes);
  assert.equal(fs.statSync(fixture.manifest, { bigint: true }).mtimeNs, beforeMtime);
  assert.equal(parseArgs([]).updateLock, false);
  assert.equal(parseArgs(["--update-lock"]).updateLock, true);
});

test("Electron runtime manifest generation is byte-canonical and tracked lock pins the full actual tree", (t) => {
  const fixture = makeFixture(t);
  const firstBuild = `${JSON.stringify(buildManifest(fixture.root), null, 2)}\n`;
  const secondBuild = `${JSON.stringify(buildManifest(fixture.root), null, 2)}\n`;
  assert.equal(secondBuild, firstBuild);
  const firstWritten = fs.readFileSync(fixture.manifest);
  writePinnedManifest(fixture.root, { platform: "win32", arch: "x64" });
  assert.deepEqual(fs.readFileSync(fixture.manifest), firstWritten);
  assert.deepEqual(transactionArtifacts(fixture.manifest), []);

  const tracked = verifyRuntime(REPO_ROOT);
  assert.equal(tracked.manifest.runtime.version, VERSION);
  assert.equal(tracked.manifest.directory_count, 2);
  assert.equal(tracked.manifest.file_count, 75);
  assert.equal(tracked.manifest.total_bytes, 364083658);
});

test("Electron runtime trust inputs reject duplicate keys, unknown schema, and noncanonical bytes", async (t) => {
  await t.test("duplicate tracked-manifest key", (inner) => {
    const fixture = makeFixture(inner);
    const source = fs.readFileSync(fixture.manifest, "utf8");
    fs.writeFileSync(
      fixture.manifest,
      source.replace(
        '  "schema_version": "1.0",',
        '  "schema_version": "0.0",\n  "schema_version": "1.0",',
      ),
    );
    assert.throws(() => verifyRuntime(fixture.root), /重复字段 schema_version/);
  });
  await t.test("unknown fields at every repository-owned schema level", (inner) => {
    for (const mutate of [
      (manifest) => { manifest.unexpected = true; },
      (manifest) => { manifest.runtime.unexpected = true; },
      (manifest) => { manifest.target.unexpected = true; },
      (manifest) => { manifest.package_lock.unexpected = true; },
      (manifest) => { manifest.files[0].unexpected = true; },
    ]) {
      const fixture = makeFixture(inner);
      const manifest = JSON.parse(fs.readFileSync(fixture.manifest, "utf8"));
      mutate(manifest);
      fs.writeFileSync(fixture.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
      assert.throws(() => verifyRuntime(fixture.root), /字段集合不严格匹配/);
    }
  });
  await t.test("semantic-equivalent CRLF bytes", (inner) => {
    const fixture = makeFixture(inner);
    const source = fs.readFileSync(fixture.manifest, "utf8");
    fs.writeFileSync(fixture.manifest, source.replace(/\n/gu, "\r\n"));
    assert.throws(() => verifyRuntime(fixture.root), /唯一规范 UTF-8\/LF 字节序列/);
  });
  await t.test("provenance note drift", (inner) => {
    const fixture = makeFixture(inner);
    const manifest = JSON.parse(fs.readFileSync(fixture.manifest, "utf8"));
    manifest.provenance_note = "self-asserted provenance";
    fs.writeFileSync(fixture.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => verifyRuntime(fixture.root), /审计状态不匹配/);
  });
  await t.test("duplicate package-lock Electron version", (inner) => {
    const fixture = makeFixture(inner);
    const target = path.join(fixture.root, "package-lock.json");
    const source = fs.readFileSync(target, "utf8");
    fs.writeFileSync(
      target,
      source.replace(
        `"version": "${VERSION}"`,
        `"version": "0.0.0",\n      "version": "${VERSION}"`,
      ),
    );
    assert.throws(() => verifyRuntime(fixture.root), /重复字段 version/);
  });
  await t.test("duplicate installed Electron package version", (inner) => {
    const fixture = makeFixture(inner);
    const target = path.join(fixture.root, "node_modules", "electron", "package.json");
    const source = fs.readFileSync(target, "utf8");
    fs.writeFileSync(
      target,
      source.replace(
        `"version": "${VERSION}"`,
        `"version": "0.0.0",\n  "version": "${VERSION}"`,
      ),
    );
    assert.throws(() => verifyRuntime(fixture.root), /重复字段 version/);
  });
  await t.test("future npm metadata remains allowed", (inner) => {
    const fixture = makeFixture(inner);
    const target = path.join(fixture.root, "package-lock.json");
    const lock = JSON.parse(fs.readFileSync(target, "utf8"));
    lock.future_top_level_metadata = { allowed: true };
    lock.packages["node_modules/electron"].future_package_metadata = "allowed";
    fs.writeFileSync(target, `${JSON.stringify(lock, null, 2)}\n`);
    assert.equal(verifyRuntime(fixture.root).manifest.runtime.version, VERSION);
  });
  await t.test("lookalike package request is not accepted", (inner) => {
    const fixture = makeFixture(inner);
    const target = path.join(fixture.root, "package-lock.json");
    const lock = JSON.parse(fs.readFileSync(target, "utf8"));
    lock.packages[""].devDependencies.electron = `not-a-range-${VERSION}`;
    fs.writeFileSync(target, `${JSON.stringify(lock, null, 2)}\n`);
    assert.throws(() => verifyRuntime(fixture.root), /精确锁定.*43\.1\.0/);
  });
});

test("Electron runtime lock update rejects linked destinations before writing", async (t) => {
  await t.test("hard-linked destination", (inner) => {
    const fixture = makeFixture(inner);
    const original = fs.readFileSync(fixture.manifest);
    const peer = path.join(path.dirname(fixture.manifest), "peer-lock.json");
    fs.renameSync(fixture.manifest, peer);
    fs.linkSync(peer, fixture.manifest);
    assert.throws(() => writePinnedManifest(fixture.root), /单链接普通文件/);
    assert.deepEqual(fs.readFileSync(peer), original);
    assert.deepEqual(fs.readFileSync(fixture.manifest), original);
    assert.deepEqual(transactionArtifacts(fixture.manifest), []);
  });
  await t.test("symlink destination", (inner) => {
    const fixture = makeFixture(inner);
    const original = fs.readFileSync(fixture.manifest);
    const external = path.join(fixture.root, "external-lock.json");
    fs.writeFileSync(external, original);
    fs.unlinkSync(fixture.manifest);
    try {
      fs.symlinkSync(external, fixture.manifest, "file");
    } catch (error) {
      inner.skip(`当前 runner 不允许创建文件 symlink：${error.code || error.message}`);
      return;
    }
    assert.throws(() => writePinnedManifest(fixture.root), /单链接普通文件|链接\/reparse/);
    assert.deepEqual(fs.readFileSync(external), original);
  });
  await t.test("junction parent", (inner) => {
    const fixture = makeFixture(inner);
    const parent = path.dirname(fixture.manifest);
    const external = path.join(fixture.root, "external-manifests");
    fs.mkdirSync(external);
    const sentinel = path.join(external, "sentinel.txt");
    fs.writeFileSync(sentinel, "outside\n");
    fs.rmSync(parent, { recursive: true });
    try {
      fs.symlinkSync(external, parent, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      inner.skip(`当前 runner 不允许创建目录 reparse：${error.code || error.message}`);
      return;
    }
    assert.throws(() => writePinnedManifest(fixture.root), /链接|reparse/);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "outside\n");
    assert.equal(fs.existsSync(path.join(external, path.basename(fixture.manifest))), false);
  });
});

test("Electron runtime lock update preserves the previous bytes across transaction failures", async (t) => {
  await t.test("candidate fsync failure", (inner) => {
    const fixture = makeFixture(inner);
    fs.appendFileSync(fixture.manifest, " ");
    const previous = fs.readFileSync(fixture.manifest);
    assert.throws(
      () => writePinnedManifest(fixture.root, {
        fsync: () => { throw new Error("injected fsync failure"); },
      }),
      /injected fsync failure/,
    );
    assert.deepEqual(fs.readFileSync(fixture.manifest), previous);
  });
  await t.test("forward rename failure", (inner) => {
    const fixture = makeFixture(inner);
    fs.appendFileSync(fixture.manifest, " ");
    const previous = fs.readFileSync(fixture.manifest);
    assert.throws(
      () => writePinnedManifest(fixture.root, {
        rename: () => { throw new Error("injected forward rename failure"); },
      }),
      /injected forward rename failure/,
    );
    assert.deepEqual(fs.readFileSync(fixture.manifest), previous);
    assert.deepEqual(transactionArtifacts(fixture.manifest), []);
  });
  await t.test("post-write verification failure rolls back", (inner) => {
    const fixture = makeFixture(inner);
    fs.appendFileSync(fixture.manifest, " ");
    const previous = fs.readFileSync(fixture.manifest);
    assert.throws(
      () => writePinnedManifest(fixture.root, {
        verifyAfterWrite: () => { throw new Error("injected post-verify failure"); },
      }),
      /injected post-verify failure/,
    );
    assert.deepEqual(fs.readFileSync(fixture.manifest), previous);
    assert.deepEqual(transactionArtifacts(fixture.manifest), []);
  });
  await t.test("real runtime drift after planning triggers rollback", (inner) => {
    const fixture = makeFixture(inner);
    fs.appendFileSync(fixture.manifest, " ");
    const previous = fs.readFileSync(fixture.manifest);
    assert.throws(
      () => writePinnedManifest(fixture.root, {
        beforeCommit: () => {
          fs.appendFileSync(path.join(fixture.dist, "resources.pak"), "late drift\n");
        },
      }),
      /SHA-256 或大小/,
    );
    assert.deepEqual(fs.readFileSync(fixture.manifest), previous);
    assert.deepEqual(transactionArtifacts(fixture.manifest), []);
  });
  await t.test("an initially absent lock is absent again after rollback", (inner) => {
    const fixture = makeFixture(inner);
    fs.unlinkSync(fixture.manifest);
    assert.throws(
      () => writePinnedManifest(fixture.root, {
        verifyAfterWrite: () => { throw new Error("injected absent-target failure"); },
      }),
      /injected absent-target failure/,
    );
    assert.equal(fs.existsSync(fixture.manifest), false);
    assert.deepEqual(transactionArtifacts(fixture.manifest), []);
  });
  await t.test("rollback rename failure is explicit and preserves evidence", (inner) => {
    const fixture = makeFixture(inner);
    fs.appendFileSync(fixture.manifest, " ");
    let calls = 0;
    let message = "";
    assert.throws(
      () => writePinnedManifest(fixture.root, {
        rename: (source, destination) => {
          calls += 1;
          if (calls === 2) throw new Error("injected rollback rename failure");
          return fs.renameSync(source, destination);
        },
        verifyAfterWrite: () => { throw new Error("injected verification failure"); },
      }),
      (error) => {
        message = error.message;
        return /事务回滚也失败.*injected rollback rename failure/.test(error.message);
      },
    );
    const match = message.match(/证据保留于 (.+)$/u);
    assert.ok(match);
    assert.equal(fs.existsSync(match[1]), true);
    assert.equal(fs.existsSync(path.join(match[1], "previous.json")), true);
  });
});

test("Electron runtime lock rejects hash drift, missing files, and unlisted files or directories", async (t) => {
  await t.test("hash or size drift", (inner) => {
    const fixture = makeFixture(inner);
    fs.appendFileSync(path.join(fixture.dist, "icudtl.dat"), "tamper\n");
    assert.throws(() => verifyRuntime(fixture.root), /SHA-256 或大小/);
  });
  await t.test("missing listed file", (inner) => {
    const fixture = makeFixture(inner);
    fs.rmSync(path.join(fixture.dist, "locales", "en-US.pak"));
    assert.throws(() => verifyRuntime(fixture.root), /多列或列出不存在文件/);
  });
  await t.test("unlisted file", (inner) => {
    const fixture = makeFixture(inner);
    write(fixture.dist, "unlisted.dll", "extra\n");
    assert.throws(() => verifyRuntime(fixture.root), /漏列实际文件/);
  });
  await t.test("unlisted directory", (inner) => {
    const fixture = makeFixture(inner);
    fs.mkdirSync(path.join(fixture.dist, "empty-extra"));
    assert.throws(() => verifyRuntime(fixture.root), /目录树漏列、多列/);
  });
});

test("Electron runtime lock rejects manifest over-listing and package-lock version drift", async (t) => {
  await t.test("duplicate manifest path", (inner) => {
    const fixture = makeFixture(inner);
    const manifest = JSON.parse(fs.readFileSync(fixture.manifest, "utf8"));
    manifest.files.splice(1, 0, { ...manifest.files[0] });
    fs.writeFileSync(fixture.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => verifyRuntime(fixture.root), /非法或重复/);
  });
  await t.test("manifest over-listing", (inner) => {
    const fixture = makeFixture(inner);
    const manifest = JSON.parse(fs.readFileSync(fixture.manifest, "utf8"));
    manifest.files.push({ path: "ghost.dll", size_bytes: 1, sha256: "0".repeat(64) });
    manifest.file_count += 1;
    manifest.total_bytes += 1;
    fs.writeFileSync(fixture.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => verifyRuntime(fixture.root), /多列或列出不存在文件/);
  });
  await t.test("package-lock drift", (inner) => {
    const fixture = makeFixture(inner);
    const lockTarget = path.join(fixture.root, "package-lock.json");
    const packageLock = JSON.parse(fs.readFileSync(lockTarget, "utf8"));
    packageLock.packages["node_modules/electron"].version = "43.1.1";
    fs.writeFileSync(lockTarget, `${JSON.stringify(packageLock, null, 2)}\n`);
    assert.throws(() => verifyRuntime(fixture.root), /精确锁定.*43\.1\.0/);
  });
});

test("self-refreshing cross-dist marker cannot conceal runtime tampering", (t) => {
  const fixture = makeFixture(t);
  const executable = path.join(fixture.dist, "electron.exe");
  const marker = path.join(fixture.dist, "OAK_ELECTRON_DIST.json");
  writeJson(fixture.dist, "OAK_ELECTRON_DIST.json", {
    schema_version: "1.0",
    platform: "win32",
    arch: "x64",
    electron_version: VERSION,
    executable_sha256: require("../scripts/electron_runtime_manifest").sha256File(executable),
  });
  assert.equal(validateElectronDist({
    projectRoot: fixture.root,
    platform: "win32",
    arch: "x64",
    dist: fixture.dist,
    requireMarker: true,
  }).runtimeLock.manifest.file_count, 8);

  fs.appendFileSync(executable, "tamper\n");
  const refreshed = JSON.parse(fs.readFileSync(marker, "utf8"));
  refreshed.executable_sha256 = require("../scripts/electron_runtime_manifest").sha256File(executable);
  fs.writeFileSync(marker, `${JSON.stringify(refreshed, null, 2)}\n`);
  assert.throws(
    () => validateElectronDist({
      projectRoot: fixture.root,
      platform: "win32",
      arch: "x64",
      dist: fixture.dist,
      requireMarker: true,
    }),
    /SHA-256 或大小/,
  );
});

test("electronDist hook returns a missing sentinel when the runtime lock fails", (t) => {
  const fixture = makeFixture(t);
  fs.appendFileSync(path.join(fixture.dist, "resources.pak"), "tamper\n");
  const sentinel = electronDistHook({
    packager: { projectDir: fixture.root },
    platformName: "win32",
    arch: "x64",
  });
  assert.equal(fs.existsSync(sentinel), false);
  assert.equal(
    path.relative(fixture.root, sentinel).split(path.sep).slice(0, 3).join("/"),
    "out/electron-dist/.missing",
  );
});

test("Electron runtime inventory rejects hard links and reparse links", async (t) => {
  await t.test("hard link", (inner) => {
    const fixture = makeFixture(inner);
    fs.linkSync(
      path.join(fixture.dist, "electron.exe"),
      path.join(fixture.dist, "electron-copy.exe"),
    );
    assert.throws(() => verifyRuntime(fixture.root), /硬链接或不安全文件/);
  });
  await t.test("junction or directory symlink", (inner) => {
    const fixture = makeFixture(inner);
    const external = write(fixture.root, "external/payload.bin", "outside runtime\n");
    const link = path.join(fixture.dist, "linked-directory");
    try {
      fs.symlinkSync(path.dirname(external), link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      inner.skip(`当前 runner 不允许创建测试 reparse link：${error.code || error.message}`);
      return;
    }
    assert.throws(() => verifyRuntime(fixture.root), /链接或 reparse/);
  });
});

test("release blockers close only Electron trust-root when lock evidence is present", () => {
  const blockers = [];
  const errors = [];
  addCurrentReleaseBlockers("win32", "x64", "alpha", blockers, errors, [{
    type: "electron-runtime-lock",
    platform: "win32",
    arch: "x64",
    manifest_sha256: "a".repeat(64),
  }]);
  const codes = new Set(blockers.map((item) => item.code));
  assert.equal(codes.has("ELECTRON_RUNTIME_TRUST_ROOT_NOT_HARDENED"), false);
  assert.equal(codes.has("ELECTRON_RUNTIME_PROVENANCE_AUDIT_REQUIRED"), true);
  assert.equal(codes.has("WINDOWS_CODE_SIGNING_PENDING"), true);
  assert.deepEqual(errors, []);

  const withoutEvidence = [];
  addCurrentReleaseBlockers("win32", "x64", "alpha", withoutEvidence, [], []);
  assert.equal(
    withoutEvidence.some((item) => item.code === "ELECTRON_RUNTIME_TRUST_ROOT_NOT_HARDENED"),
    true,
  );
});
