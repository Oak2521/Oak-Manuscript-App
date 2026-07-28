"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  CHECKSUM_FILENAME,
  MANIFEST_FILENAME,
  clearReleaseEvidence,
  generateReleaseEvidence,
  parseArgs,
  verifyReleaseEvidence,
} = require("../scripts/release_artifact_manifest");

const REPO_ROOT = path.resolve(__dirname, "..");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function makeRoot(t) {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "release-evidence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, bytes) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return target;
}

function fakePe() {
  const bytes = Buffer.alloc(256, 0);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80, "binary");
  return bytes;
}

function fakeZip() {
  return Buffer.concat([
    Buffer.from("PK\x03\x04fixture", "binary"),
    Buffer.from("PK\x05\x06", "binary"),
    Buffer.alloc(18, 0),
  ]);
}

function fixture(t, version = "9.8.7-alpha.1") {
  const root = makeRoot(t);
  write(root, "package.json", `${JSON.stringify({
    name: "oak-manuscript",
    productName: "湖岸稿件 Oak Manuscript",
    version,
    build: { appId: "com.oakbylake.manuscript" },
  }, null, 2)}\n`);
  write(root, "package-lock.json", `${JSON.stringify({
    name: "oak-manuscript",
    version,
    lockfileVersion: 3,
    packages: { "": { name: "oak-manuscript", version } },
  }, null, 2)}\n`);
  const prefix = `Oak-Manuscript-${version}-Windows-x64`;
  const installer = write(root, `release/${prefix}.exe`, fakePe());
  const archive = write(root, `release/${prefix}.zip`, fakeZip());
  return { root, version, prefix, installer, archive };
}

test("release evidence CLI requires exactly one explicit action and fixed Windows target", () => {
  assert.deepEqual(
    parseArgs(["--generate", "--platform", "win32", "--arch", "x64"]),
    { action: "generate", platform: "win32", arch: "x64" },
  );
  assert.deepEqual(
    parseArgs(["--clear", "--platform", "win32", "--arch", "x64"]),
    { action: "clear", platform: "win32", arch: "x64" },
  );
  assert.throws(() => parseArgs([]), /必须且只能指定一个操作/);
  assert.throws(() => parseArgs(["--generate", "--verify"]), /必须且只能指定一个操作/);
  assert.throws(
    () => parseArgs(["--generate", "--platform", "darwin", "--arch", "x64"]),
    /目前只接受 win32\/x64/,
  );
  assert.throws(
    () => parseArgs(["--generate", "--platform", "win32", "--arch", "arm64"]),
    /目前只接受 win32\/x64/,
  );
});

test("generation writes deterministic SHA256SUMS and a cross-bound canonical manifest", (t) => {
  const data = fixture(t);
  const first = generateReleaseEvidence({ root: data.root, platform: "win32", arch: "x64" });
  const checksumPath = path.join(data.root, "release", CHECKSUM_FILENAME);
  const manifestPath = path.join(data.root, "release", MANIFEST_FILENAME);
  const firstChecksums = fs.readFileSync(checksumPath);
  const firstManifest = fs.readFileSync(manifestPath);

  assert.equal(first.version, data.version);
  assert.deepEqual(first.artifacts.map((item) => item.filename), [
    `${data.prefix}.exe`,
    `${data.prefix}.zip`,
  ]);
  const expectedLines = [
    `${sha256(fakePe())}  ${data.prefix}.exe`,
    `${sha256(fakeZip())}  ${data.prefix}.zip`,
    "",
  ].join("\n");
  assert.equal(firstChecksums.toString("utf8"), expectedLines);

  const manifest = JSON.parse(firstManifest.toString("utf8"));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.product, "湖岸稿件 Oak Manuscript");
  assert.equal(manifest.app_id, "com.oakbylake.manuscript");
  assert.deepEqual(manifest.target, { platform: "win32", arch: "x64" });
  assert.equal(manifest.sha256sums.filename, CHECKSUM_FILENAME);
  assert.equal(manifest.sha256sums.sha256, sha256(firstChecksums));
  assert.deepEqual(verifyReleaseEvidence({ root: data.root }), manifest);

  generateReleaseEvidence({ root: data.root, platform: "win32", arch: "x64" });
  assert.deepEqual(fs.readFileSync(checksumPath), firstChecksums);
  assert.deepEqual(fs.readFileSync(manifestPath), firstManifest);
  assert.equal(fs.statSync(checksumPath).nlink, 1);
  assert.equal(fs.statSync(manifestPath).nlink, 1);
});

test("generation rejects missing, malformed, stale-family, and version-drift artifacts", (t) => {
  const missing = fixture(t);
  fs.rmSync(missing.archive);
  assert.throws(() => generateReleaseEvidence({ root: missing.root }), /发布 ZIP 缺失/);

  const malformed = fixture(t);
  fs.writeFileSync(malformed.archive, "not a zip");
  assert.throws(() => generateReleaseEvidence({ root: malformed.root }), /ZIP.*结构/);

  const stale = fixture(t);
  write(stale.root, "release/Oak-Manuscript-0.0.1-Windows-x64.exe", fakePe());
  assert.throws(() => generateReleaseEvidence({ root: stale.root }), /同系列旧版本或未知制品/);

  const drift = fixture(t);
  const lock = JSON.parse(fs.readFileSync(path.join(drift.root, "package-lock.json"), "utf8"));
  lock.packages[""].version = "9.8.6";
  fs.writeFileSync(path.join(drift.root, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  assert.throws(() => generateReleaseEvidence({ root: drift.root }), /版本不一致/);
});

test("generation rejects linked artifacts and unsafe pre-existing evidence", (t) => {
  const hardlinked = fixture(t);
  const peer = path.join(hardlinked.root, "release", "installer-peer.exe");
  fs.linkSync(hardlinked.installer, peer);
  assert.throws(() => generateReleaseEvidence({ root: hardlinked.root }), /单链接/);

  const unsafeEvidence = fixture(t);
  const outside = write(unsafeEvidence.root, "outside-checksums.txt", "do not overwrite\n");
  const target = path.join(unsafeEvidence.root, "release", CHECKSUM_FILENAME);
  try {
    fs.symlinkSync(outside, target, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`当前主机不能创建文件链接：${error.code}`);
      return;
    }
    throw error;
  }
  assert.throws(() => generateReleaseEvidence({ root: unsafeEvidence.root }), /链接|普通文件/);
  assert.equal(fs.readFileSync(outside, "utf8"), "do not overwrite\n");
});

test("two-file commit rolls back the first replacement when the second rename fails", (t) => {
  const data = fixture(t);
  const checksumPath = write(data.root, `release/${CHECKSUM_FILENAME}`, "old checksums\n");
  const manifestPath = write(data.root, `release/${MANIFEST_FILENAME}`, "{\"old\":true}\n");
  const oldChecksums = fs.readFileSync(checksumPath);
  const oldManifest = fs.readFileSync(manifestPath);
  let candidateMoves = 0;

  assert.throws(
    () => generateReleaseEvidence({
      root: data.root,
      rename(source, target) {
        if (path.basename(source).startsWith("candidate-")) {
          candidateMoves += 1;
          if (candidateMoves === 2) throw new Error("injected second evidence rename failure");
        }
        fs.renameSync(source, target);
      },
    }),
    /injected second evidence rename failure/,
  );
  assert.deepEqual(fs.readFileSync(checksumPath), oldChecksums);
  assert.deepEqual(fs.readFileSync(manifestPath), oldManifest);

  const cleared = clearReleaseEvidence({ root: data.root });
  assert.deepEqual(cleared.removed, [CHECKSUM_FILENAME, MANIFEST_FILENAME]);
  assert.equal(fs.existsSync(checksumPath), false);
  assert.equal(fs.existsSync(manifestPath), false);
  assert.deepEqual(clearReleaseEvidence({ root: data.root }).removed, []);
});

test("verification detects artifact tampering and clear preflights both evidence files", (t) => {
  const tampered = fixture(t);
  generateReleaseEvidence({ root: tampered.root });
  fs.appendFileSync(tampered.archive, "tampered");
  assert.throws(() => verifyReleaseEvidence({ root: tampered.root }), /ZIP.*结构|SHA256SUMS/);

  const unsafeClear = fixture(t);
  generateReleaseEvidence({ root: unsafeClear.root });
  const checksumPath = path.join(unsafeClear.root, "release", CHECKSUM_FILENAME);
  const manifestPath = path.join(unsafeClear.root, "release", MANIFEST_FILENAME);
  const peer = path.join(unsafeClear.root, "release", "manifest-peer.json");
  fs.renameSync(manifestPath, peer);
  fs.linkSync(peer, manifestPath);
  assert.throws(() => clearReleaseEvidence({ root: unsafeClear.root }), /单链接/);
  assert.equal(fs.existsSync(checksumPath), true, "clear must not delete the first file before full preflight");
  assert.equal(fs.existsSync(manifestPath), true);
});
