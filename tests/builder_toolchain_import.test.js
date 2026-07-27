"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  EXTRACTOR_FILES,
  SOURCE_ARCHIVES,
  assembleWindowsToolchain,
  inspectAndExtractArchive,
  parse7zTechnicalListing,
  transactionalInstall,
  validateArchiveEntries,
  validateArchiveRelativePath,
  validateSourceArchives,
  verifyExtractedTree,
  verifyPinnedExtractor,
  writeTrackedLock,
} = require("../scripts/import_windows_builder_toolchain");
const {
  parseJsonStrict,
  verifyWindowsToolchain,
} = require("../scripts/verify_builder_toolchain");

const REPO_ROOT = path.resolve(__dirname, "..");

function makeTestRoot(t, prefix = "builder-import-") {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, content = "fixture\n") {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function fakePe(machine = 0x8664) {
  const buffer = Buffer.alloc(512);
  buffer.write("MZ", 0, "ascii");
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write("PE\u0000\u0000", 0x80, "binary");
  buffer.writeUInt16LE(machine, 0x84);
  return buffer;
}

function technicalListing(records) {
  const lines = [
    "7-Zip fixture",
    "Path = fixture.7z",
    "Type = 7z",
    "----------",
  ];
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) lines.push(`${key} = ${value}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function fixedSourceMetadata() {
  return SOURCE_ARCHIVES.map((item, index) => ({
    ...item,
    size_bytes: 1000 + index,
  }));
}

function createExtractedPayloads(root, { omit = null } = {}) {
  const nsis = path.join(root, "nsis-source");
  const resources = path.join(root, "resources-source");
  const winCodeSign = path.join(root, "wincodesign-source");
  const payload = [
    [nsis, "Bin/makensis.exe", fakePe()],
    [nsis, "elevate.exe", fakePe(0x014c)],
    [nsis, "Include/MUI2.nsh", "include\n"],
    [nsis, "Stubs/zlib-x86-unicode", "stub\n"],
    [nsis, "Contrib/Graphics/fixture.bmp", "bitmap\n"],
    [resources, "plugins/x86-unicode/fixture.dll", "plugin\n"],
    [winCodeSign, "rcedit-x64.exe", fakePe()],
    [winCodeSign, "rcedit-ia32.exe", fakePe(0x014c)],
    [winCodeSign, "windows-10/x64/signtool.exe", fakePe()],
    [winCodeSign, "windows-10/x64/signtool-adjacent.dll", "dependency\n"],
  ];
  for (const [base, relative, content] of payload) {
    if (relative !== omit) write(base, relative, content);
  }
  return { nsis, resources, winCodeSign };
}

function createTransactionFixture(t, suffix) {
  const root = makeTestRoot(t, `builder-rename-${suffix}-`);
  const destination = path.join(root, "tools", "electron-builder", "win32-x64");
  const lockDestination = path.join(
    root,
    "config",
    "tool-manifests",
    "electron-builder-win32-x64.json",
  );
  write(destination, "old-marker.txt", "old tool\n");
  write(root, "config/tool-manifests/electron-builder-win32-x64.json", "old lock\n");
  const transactionRoot = path.join(root, "out", "tmp", "transaction");
  const candidateProjectRoot = path.join(transactionRoot, "candidate-project");
  const candidate = path.join(candidateProjectRoot, "tools", "electron-builder", "win32-x64");
  const candidateLock = path.join(
    candidateProjectRoot,
    "config",
    "tool-manifests",
    "electron-builder-win32-x64.json",
  );
  write(candidate, "new-marker.txt", "new tool\n");
  write(candidateProjectRoot,
    "config/tool-manifests/electron-builder-win32-x64.json", "new lock\n");
  return {
    root,
    destination,
    lockDestination,
    transactionRoot,
    candidateProjectRoot,
    candidate,
    candidateLock,
    backup: path.join(transactionRoot, "previous-toolchain"),
    lockBackup: path.join(transactionRoot, "previous-lock.json"),
  };
}

test("importer independently pins exact legacy archive names and SHA256 values", () => {
  assert.deepEqual(SOURCE_ARCHIVES.map(({ id, name, sha256 }) => ({ id, name, sha256 })), [
    {
      id: "nsis",
      name: "nsis-3.0.4.1.7z",
      sha256: "9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa",
    },
    {
      id: "nsisResources",
      name: "nsis-resources-3.4.1.7z",
      sha256: "593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103",
    },
    {
      id: "winCodeSign",
      name: "winCodeSign-2.6.0.7z",
      sha256: "cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4",
    },
  ]);
  const source = fs.readFileSync(
    path.join(REPO_ROOT, "node_modules", "app-builder-lib", "out", "toolsets", "windows.js"),
    "utf8",
  );
  for (const archive of SOURCE_ARCHIVES) {
    assert.match(source, new RegExp(archive.name.replaceAll(".", "\\.")));
    assert.match(source, new RegExp(archive.sha256));
  }
});

test("source archive validation rejects missing, extra, and wrong-hash archives", (t) => {
  const root = makeTestRoot(t);
  if (process.platform === "win32") {
    assert.throws(
      () => validateSourceArchives("\\\\fixture.invalid\\unapproved-share\\archives"),
      /不得使用 UNC 或设备路径/,
    );
  }
  assert.throws(() => validateSourceArchives(root), /缺少固定原始归档/);
  for (const item of SOURCE_ARCHIVES) write(root, item.name, item.id);
  assert.throws(() => validateSourceArchives(root), /SHA256 不匹配/);
  const accepted = validateSourceArchives(root, {
    hashFile(target) {
      return SOURCE_ARCHIVES.find((item) => item.name === path.basename(target)).sha256;
    },
  });
  assert.deepEqual(accepted.map((item) => item.name), SOURCE_ARCHIVES.map((item) => item.name));
  write(root, "unapproved.7z", "not trusted\n");
  assert.throws(
    () => validateSourceArchives(root, { hashFile() { return "0".repeat(64); } }),
    /未授权的 \.7z 文件/,
  );
});

test("archive path and technical-list validation reject traversal and links before extraction", (t) => {
  assert.equal(validateArchiveRelativePath("Include/MUI2.nsh"), "Include/MUI2.nsh");
  for (const unsafe of ["../escape.exe", "C:\\evil.exe", "/absolute", "safe/CON.txt"])
    assert.throws(() => validateArchiveRelativePath(unsafe), /路径逃逸|绝对路径|保留名称/);

  const destination = path.join(makeTestRoot(t), "must-not-exist");
  let calls = 0;
  assert.throws(
    () => inspectAndExtractArchive({
      archive: path.join(REPO_ROOT, "fixture.7z"),
      destination,
      expectedSha256: "0".repeat(64),
      extractor: "fixture-7z.exe",
      execute7z() {
        calls += 1;
        return technicalListing([{ Path: "../escape.exe", Size: "1", Folder: "-" }]);
      },
    }),
    /路径逃逸/,
  );
  assert.equal(calls, 1, "malicious listing must be rejected before extraction is invoked");
  assert.equal(fs.existsSync(destination), false);

  const linked = parse7zTechnicalListing(technicalListing([{
    Path: "safe-link",
    Size: "0",
    Folder: "-",
    "Symbolic Link": "../../outside",
  }]));
  assert.throws(() => validateArchiveEntries(linked), /不得为链接/);
  const hardLinked = parse7zTechnicalListing(technicalListing([{
    Path: "safe-hard-link",
    Size: "0",
    Folder: "-",
    "Hard Link": "other",
  }]));
  assert.throws(() => validateArchiveEntries(hardLinked), /不得为链接/);
});

test("post-extraction verification rejects unlisted files and filesystem links", (t) => {
  const root = makeTestRoot(t);
  write(root, "listed.txt", "abc");
  assert.deepEqual(
    verifyExtractedTree(root, [{ path: "listed.txt", directory: false, size_bytes: 3 }])
      .map((item) => item.path),
    ["listed.txt"],
  );
  write(root, "unlisted.txt", "x");
  assert.throws(
    () => verifyExtractedTree(root, [{ path: "listed.txt", directory: false, size_bytes: 3 }]),
    /清单外文件/,
  );

  const linkRoot = makeTestRoot(t, "builder-link-");
  const target = write(linkRoot, "target.txt", "target");
  const link = path.join(linkRoot, "link.txt");
  try {
    fs.symlinkSync(target, link, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return;
    throw error;
  }
  assert.throws(() => verifyExtractedTree(linkRoot, []), /符号链接|junction/);
});

test("assembly fails closed when a critical raw-archive payload is missing", (t) => {
  const root = makeTestRoot(t);
  const payloads = createExtractedPayloads(root, {
    omit: "windows-10/x64/signtool.exe",
  });
  assert.throws(
    () => assembleWindowsToolchain({
      candidateProjectRoot: path.join(root, "candidate"),
      nsisRoot: payloads.nsis,
      nsisResourcesRoot: payloads.resources,
      winCodeSignRoot: payloads.winCodeSign,
      sourceArchives: fixedSourceMetadata(),
    }),
    /signtool\.exe.*非空普通文件|归档载荷.*signtool\.exe/,
  );
  assert.equal(fs.existsSync(path.join(root, "candidate")), false);
});

test("assembly produces a deterministic full-tree manifest accepted by the existing gate", (t) => {
  const root = makeTestRoot(t);
  const payloads = createExtractedPayloads(root);
  const manifests = [];
  for (const name of ["candidate-a", "candidate-b"]) {
    const candidateProjectRoot = path.join(root, name);
    const result = assembleWindowsToolchain({
      candidateProjectRoot,
      nsisRoot: payloads.nsis,
      nsisResourcesRoot: payloads.resources,
      winCodeSignRoot: payloads.winCodeSign,
      sourceArchives: fixedSourceMetadata(),
    });
    writeTrackedLock(candidateProjectRoot, result.toolchain, result.manifest);
    verifyWindowsToolchain(candidateProjectRoot, "x64");
    const bytes = fs.readFileSync(path.join(result.toolchain, "manifest.json"));
    manifests.push(bytes);
    const parsed = JSON.parse(bytes);
    assert.equal(parsed.file_count, parsed.files.length);
    assert.equal(parsed.total_bytes,
      parsed.files.reduce((sum, item) => sum + item.size_bytes, 0));
    assert.deepEqual(
      parsed.files.map((item) => item.path),
      [...parsed.files.map((item) => item.path)].sort((left, right) =>
        left === right ? 0 : left < right ? -1 : 1),
    );
    assert.equal(parsed.files.some((item) => item.path === "signtool-adjacent.dll"), true);
  }
  assert.deepEqual(manifests[0], manifests[1]);
});

test("transactional install restores the previous toolchain after post-swap verification fails", (t) => {
  const root = makeTestRoot(t);
  const destination = path.join(root, "tools", "electron-builder", "win32-x64");
  write(destination, "old-marker.txt", "old\n");
  const transactionRoot = path.join(root, "out", "tmp", "transaction");
  const candidateProjectRoot = path.join(transactionRoot, "candidate-project");
  const candidate = path.join(candidateProjectRoot, "tools", "electron-builder", "win32-x64");
  write(candidate, "new-marker.txt", "new\n");
  write(root, "config/tool-manifests/electron-builder-win32-x64.json", "old lock\n");
  write(candidateProjectRoot,
    "config/tool-manifests/electron-builder-win32-x64.json", "candidate lock\n");
  let calls = 0;
  assert.throws(
    () => transactionalInstall({
      root,
      candidateProjectRoot,
      transactionRoot,
      verify() {
        calls += 1;
        if (calls === 2) throw new Error("post-swap rejection");
      },
    }),
    /post-swap rejection/,
  );
  assert.equal(calls, 2);
  assert.equal(fs.readFileSync(path.join(destination, "old-marker.txt"), "utf8"), "old\n");
  assert.equal(fs.existsSync(path.join(destination, "new-marker.txt")), false);
  assert.equal(fs.readFileSync(path.join(candidate, "new-marker.txt"), "utf8"), "new\n");
  assert.equal(
    fs.readFileSync(
      path.join(root, "config", "tool-manifests", "electron-builder-win32-x64.json"),
      "utf8",
    ),
    "old lock\n",
    "without --update-lock the tracked lock must remain byte-for-byte unchanged",
  );
  assert.equal(fs.existsSync(path.join(transactionRoot, "previous-toolchain")), false);
});

test("joint toolchain and tracked-lock transaction rolls both assets back", (t) => {
  const root = makeTestRoot(t);
  const destination = path.join(root, "tools", "electron-builder", "win32-x64");
  const lockDestination = path.join(
    root,
    "config",
    "tool-manifests",
    "electron-builder-win32-x64.json",
  );
  write(destination, "old-marker.txt", "old tool\n");
  write(root, "config/tool-manifests/electron-builder-win32-x64.json", "old lock\n");
  const transactionRoot = path.join(root, "out", "tmp", "transaction");
  const candidateProjectRoot = path.join(transactionRoot, "candidate-project");
  const candidate = path.join(candidateProjectRoot, "tools", "electron-builder", "win32-x64");
  const candidateLock = path.join(
    candidateProjectRoot,
    "config",
    "tool-manifests",
    "electron-builder-win32-x64.json",
  );
  write(candidate, "new-marker.txt", "new tool\n");
  write(candidateProjectRoot,
    "config/tool-manifests/electron-builder-win32-x64.json", "new lock\n");
  let calls = 0;
  assert.throws(
    () => transactionalInstall({
      root,
      candidateProjectRoot,
      transactionRoot,
      updateLock: true,
      verify() {
        calls += 1;
        if (calls === 2) throw new Error("joint post-swap rejection");
      },
    }),
    /joint post-swap rejection/,
  );
  assert.equal(fs.readFileSync(path.join(destination, "old-marker.txt"), "utf8"), "old tool\n");
  assert.equal(fs.readFileSync(lockDestination, "utf8"), "old lock\n");
  assert.equal(fs.readFileSync(path.join(candidate, "new-marker.txt"), "utf8"), "new tool\n");
  assert.equal(fs.readFileSync(candidateLock, "utf8"), "new lock\n");
  assert.equal(fs.existsSync(path.join(transactionRoot, "previous-toolchain")), false);
  assert.equal(fs.existsSync(path.join(transactionRoot, "previous-lock.json")), false);
});

test("transaction refuses hard-linked previous assets before moving either one", (t) => {
  const root = makeTestRoot(t);
  const destination = path.join(root, "tools", "electron-builder", "win32-x64");
  const oldTool = write(destination, "old-marker.txt", "old tool\n");
  const oldLock = write(
    root,
    "config/tool-manifests/electron-builder-win32-x64.json",
    "old lock\n",
  );
  const transactionRoot = path.join(root, "out", "tmp", "transaction");
  const candidateProjectRoot = path.join(transactionRoot, "candidate-project");
  write(candidateProjectRoot, "tools/electron-builder/win32-x64/new-marker.txt", "new tool\n");
  write(candidateProjectRoot,
    "config/tool-manifests/electron-builder-win32-x64.json", "new lock\n");

  const outsideToolLink = path.join(root, "outside-tool-link.txt");
  fs.linkSync(oldTool, outsideToolLink);
  assert.throws(
    () => transactionalInstall({
      root,
      candidateProjectRoot,
      transactionRoot,
      updateLock: true,
      verify() {},
    }),
    /现有 Windows 工具链|硬链接/,
  );
  assert.equal(fs.readFileSync(oldTool, "utf8"), "old tool\n");
  assert.equal(fs.readFileSync(oldLock, "utf8"), "old lock\n");
  fs.unlinkSync(outsideToolLink);

  const outsideLockLink = path.join(root, "outside-lock-link.json");
  fs.linkSync(oldLock, outsideLockLink);
  assert.throws(
    () => transactionalInstall({
      root,
      candidateProjectRoot,
      transactionRoot,
      updateLock: true,
      verify() {},
    }),
    /tracked lock 不是安全普通文件/,
  );
  assert.equal(fs.readFileSync(oldTool, "utf8"), "old tool\n");
  assert.equal(fs.readFileSync(oldLock, "utf8"), "old lock\n");
});

test("every forward rename failure restores the old tree and lock", (t) => {
  const routes = [
    ["old-tree", (f) => [f.destination, f.backup]],
    ["old-lock", (f) => [f.lockDestination, f.lockBackup]],
    ["candidate-tree", (f) => [f.candidate, f.destination]],
    ["candidate-lock", (f) => [f.candidateLock, f.lockDestination]],
  ];
  for (const [label, route] of routes) {
    const fixture = createTransactionFixture(t, label);
    const [failFrom, failTo] = route(fixture);
    let injected = false;
    assert.throws(
      () => transactionalInstall({
        root: fixture.root,
        candidateProjectRoot: fixture.candidateProjectRoot,
        transactionRoot: fixture.transactionRoot,
        updateLock: true,
        verify() {},
        rename(from, to) {
          if (!injected && from === failFrom && to === failTo) {
            injected = true;
            throw new Error(`injected forward rename failure: ${label}`);
          }
          fs.renameSync(from, to);
        },
      }),
      new RegExp(`injected forward rename failure: ${label}`),
    );
    assert.equal(injected, true);
    assert.equal(
      fs.readFileSync(path.join(fixture.destination, "old-marker.txt"), "utf8"),
      "old tool\n",
    );
    assert.equal(fs.readFileSync(fixture.lockDestination, "utf8"), "old lock\n");
    assert.equal(
      fs.readFileSync(path.join(fixture.candidate, "new-marker.txt"), "utf8"),
      "new tool\n",
    );
    assert.equal(fs.readFileSync(fixture.candidateLock, "utf8"), "new lock\n");
    assert.equal(fs.existsSync(fixture.backup), false);
    assert.equal(fs.existsSync(fixture.lockBackup), false);
  }
});

test("every rollback rename failure is explicit and preserves recovery evidence", (t) => {
  const routes = [
    ["candidate-lock", (f) => [f.lockDestination, f.candidateLock]],
    ["candidate-tree", (f) => [f.destination, f.candidate]],
    ["old-lock", (f) => [f.lockBackup, f.lockDestination]],
    ["old-tree", (f) => [f.backup, f.destination]],
  ];
  for (const [label, route] of routes) {
    const fixture = createTransactionFixture(t, `rollback-${label}`);
    const [failFrom, failTo] = route(fixture);
    let injected = false;
    let verifies = 0;
    assert.throws(
      () => transactionalInstall({
        root: fixture.root,
        candidateProjectRoot: fixture.candidateProjectRoot,
        transactionRoot: fixture.transactionRoot,
        updateLock: true,
        verify() {
          verifies += 1;
          if (verifies === 2) throw new Error("injected post-swap rejection");
        },
        rename(from, to) {
          if (!injected && from === failFrom && to === failTo) {
            injected = true;
            throw new Error(`injected rollback rename failure: ${label}`);
          }
          fs.renameSync(from, to);
        },
      }),
      /事务回滚也失败.*injected rollback rename failure/,
    );
    assert.equal(injected, true);
    assert.equal(verifies, 2);
    assert.equal(fs.existsSync(fixture.transactionRoot), true);
    assert.equal(
      fs.existsSync(fixture.backup) || fs.existsSync(fixture.lockBackup),
      true,
      "rollback failure must keep at least one prior-asset backup for manual recovery",
    );
  }
});

test("tracked lock is mandatory and binds the raw manifest bytes", (t) => {
  const root = makeTestRoot(t);
  const payloads = createExtractedPayloads(root);
  const candidateProjectRoot = path.join(root, "candidate");
  const result = assembleWindowsToolchain({
    candidateProjectRoot,
    nsisRoot: payloads.nsis,
    nsisResourcesRoot: payloads.resources,
    winCodeSignRoot: payloads.winCodeSign,
    sourceArchives: fixedSourceMetadata(),
  });
  assert.throws(() => verifyWindowsToolchain(candidateProjectRoot, "x64"), /tracked lock|缺少非空文件/);
  writeTrackedLock(candidateProjectRoot, result.toolchain, result.manifest);
  verifyWindowsToolchain(candidateProjectRoot, "x64");
  fs.appendFileSync(path.join(result.toolchain, "manifest.json"), "\n");
  assert.throws(
    () => verifyWindowsToolchain(candidateProjectRoot, "x64"),
    /tracked lock 与 manifest\.json 原始字节不匹配/,
  );
});

test("builder verification stops at an unsafe ancestor junction before traversing it", (t) => {
  if (process.platform !== "win32") return;
  const root = makeTestRoot(t, "builder-ancestor-root-");
  const outside = makeTestRoot(t, "builder-ancestor-outside-");
  write(outside, "electron-builder/win32-x64/manifest.json", "must not be trusted\n");
  try {
    fs.symlinkSync(outside, path.join(root, "tools"), "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`当前主机不能创建测试 junction：${error.code}`);
      return;
    }
    throw error;
  }
  assert.throws(
    () => verifyWindowsToolchain(root, "x64"),
    /路径父链含符号链接、junction 或重解析点/,
  );
});

test("strict JSON and manifest schemas reject duplicate and extra fields", (t) => {
  assert.throws(
    () => parseJsonStrict('{"schema_version":"1.0","schema_version":"1.0"}', "fixture"),
    /重复字段 schema_version/,
  );
  assert.throws(
    () => parseJsonStrict('{\u00a0"safe":true}', "fixture"),
    /JSON 非法/,
  );

  const root = makeTestRoot(t);
  const payloads = createExtractedPayloads(root);
  const candidateProjectRoot = path.join(root, "candidate");
  const result = assembleWindowsToolchain({
    candidateProjectRoot,
    nsisRoot: payloads.nsis,
    nsisResourcesRoot: payloads.resources,
    winCodeSignRoot: payloads.winCodeSign,
    sourceArchives: fixedSourceMetadata(),
  });
  const manifestPath = path.join(result.toolchain, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.untrusted_extra = true;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeTrackedLock(candidateProjectRoot, result.toolchain, manifest);
  assert.throws(
    () => verifyWindowsToolchain(candidateProjectRoot, "x64"),
    /manifest 字段集合不严格匹配/,
  );
});

test("pinned local extractor components are byte-verified and importer is not wired into normal build", () => {
  const executable = verifyPinnedExtractor(REPO_ROOT);
  assert.equal(executable,
    path.join(REPO_ROOT, ...EXTRACTOR_FILES[0].relative.split("/")));
  const packageJson = require("../package.json");
  assert.doesNotMatch(packageJson.scripts["build:win"], /import_windows_builder_toolchain/);
  assert.equal(
    Object.values(packageJson.scripts).some((command) =>
      command.includes("import_windows_builder_toolchain")),
    false,
  );
});
