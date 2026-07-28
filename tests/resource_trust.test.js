"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createStablePackage } = require("./asar_test_helper");

const {
  APP_MANIFEST_RELATIVE,
  ANCHOR_RELATIVE,
  buildSourceResourceTrust,
  verifySourceResourceTrust,
} = require("../scripts/resource_trust_manifest");
const {
  readAnchorFromAsar,
  readFileBytesFromAsar,
  verifyPackagedResourceTrust,
} = require("../electron/resource-trust");

const REPO_ROOT = path.resolve(__dirname, "..");

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function write(root, relative, content = "fixture\n") {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function writeJson(root, relative, value) {
  return write(root, relative, `${JSON.stringify(value, null, 2)}\n`);
}

function fileRecord(root, relative) {
  const target = path.join(root, ...relative.split("/"));
  const bytes = fs.readFileSync(target);
  return { path: relative, size_bytes: bytes.length, sha256: sha256Bytes(bytes) };
}

function makeRoot(t) {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "resource-trust-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createPackagedFixture(t) {
  const root = makeRoot(t);
  const appFiles = [
    "python/oak_manuscript_core/__init__.py",
    "config/standards.json",
    "samples/sample.epub",
  ];
  for (const relative of appFiles) write(root, relative);

  const directRuntimes = [
    ["python-runtime", "python.exe", "config/tool-manifests/python-runtime-win32-x64.json"],
    ["tools/epubcheck-5.3.0", "epubcheck.jar", "config/tool-manifests/epubcheck-5.3.0.json"],
  ];
  for (const [runtimeRoot, entry, lockPath] of directRuntimes) {
    write(root, `${runtimeRoot}/${entry}`);
    writeJson(root, lockPath, {
      schema_version: "1.0",
      files: [fileRecord(root, `${runtimeRoot}/${entry}`).path === `${runtimeRoot}/${entry}`
        ? { ...fileRecord(root, `${runtimeRoot}/${entry}`), path: entry }
        : null],
    });
  }

  write(root, "tools/jre/bin/java.exe");
  const jreFile = fileRecord(root, "tools/jre/bin/java.exe");
  const jreManifest = writeJson(root, "tools/jre/manifest.json", {
    schema_version: "1.0",
    files: [{ ...jreFile, path: "bin/java.exe" }],
  });
  writeJson(root, "config/tool-manifests/jre-win32-x64.json", {
    schema_version: "1.0",
    runtime_manifest_sha256: sha256Bytes(fs.readFileSync(jreManifest)),
  });

  write(root, "tools/ace/ace.js");
  const aceFile = fileRecord(root, "tools/ace/ace.js");
  const aceManifest = writeJson(root, "tools/ace/manifest.json", {
    schema_version: "1.0",
    files: [{ ...aceFile, path: "ace.js" }],
  });
  writeJson(root, "config/tool-manifests/ace-1.4.6.json", {
    schema_version: "1.0",
    stage_manifest_sha256: sha256Bytes(fs.readFileSync(aceManifest)),
  });

  const appRecords = [
    ...appFiles,
    "config/tool-manifests/python-runtime-win32-x64.json",
    "config/tool-manifests/epubcheck-5.3.0.json",
    "config/tool-manifests/jre-win32-x64.json",
    "config/tool-manifests/ace-1.4.6.json",
  ].map((relative) => fileRecord(root, relative)).sort((a, b) => a.path.localeCompare(b.path));
  const appManifest = writeJson(root, APP_MANIFEST_RELATIVE, {
    schema_version: "1.0",
    lock_type: "oak-app-loose-resources",
    roots: ["python/oak_manuscript_core", "config", "samples"],
    excluded_paths: [APP_MANIFEST_RELATIVE],
    file_count: appRecords.length,
    total_bytes: appRecords.reduce((sum, item) => sum + item.size_bytes, 0),
    files: appRecords,
  });

  const lock = (relative) => ({
    manifest: relative,
    sha256: sha256Bytes(fs.readFileSync(path.join(root, ...relative.split("/")))),
  });
  const anchor = {
    schema_version: "1.0",
    anchor_type: "oak-packaged-resource-trust-root",
    app_resources: {
      ...lock(APP_MANIFEST_RELATIVE),
      file_count: appRecords.length,
      total_bytes: appRecords.reduce((sum, item) => sum + item.size_bytes, 0),
    },
    targets: [{
      platform: "win32",
      arch: "x64",
      locks: {
        python_runtime: lock("config/tool-manifests/python-runtime-win32-x64.json"),
        epubcheck: lock("config/tool-manifests/epubcheck-5.3.0.json"),
        jre: lock("config/tool-manifests/jre-win32-x64.json"),
        ace: lock("config/tool-manifests/ace-1.4.6.json"),
      },
    }],
  };
  writeJson(root, ANCHOR_RELATIVE, anchor);
  return { root, anchor, appManifest };
}

test("repository resource trust manifest and ASAR anchor are current", () => {
  const built = buildSourceResourceTrust(REPO_ROOT);
  const verified = verifySourceResourceTrust(REPO_ROOT);
  assert.equal(verified.packaged, false);
  assert.equal(verified.anchor_sha256, built.anchorSha256);
  assert.equal(verified.app_manifest_sha256, built.appManifestSha256);
  assert.equal(verified.targets.some((item) => item.platform === "win32" && item.arch === "x64"), true);
});

test("packaged resource trust rejects loose app, runtime and lock tampering", () => {
  const { root, anchor } = createPackagedFixture({ after() {} });
  try {
    assert.equal(verifyPackagedResourceTrust({ root, platform: "win32", arch: "x64", anchor }).ok, true);

    fs.appendFileSync(path.join(root, "config", "standards.json"), "tamper");
    assert.throws(
      () => verifyPackagedResourceTrust({ root, platform: "win32", arch: "x64", anchor }),
      /app loose resources.*(size|SHA-256)/,
    );
    fs.writeFileSync(path.join(root, "config", "standards.json"), "fixture\n");

    fs.appendFileSync(path.join(root, "python-runtime", "python.exe"), "tamper");
    assert.throws(
      () => verifyPackagedResourceTrust({ root, platform: "win32", arch: "x64", anchor }),
      /python runtime.*(size|SHA-256)/,
    );
    fs.writeFileSync(path.join(root, "python-runtime", "python.exe"), "fixture\n");

    fs.appendFileSync(path.join(root, "config", "tool-manifests", "ace-1.4.6.json"), "tamper");
    assert.throws(
      () => verifyPackagedResourceTrust({ root, platform: "win32", arch: "x64", anchor }),
      /(app loose resources|anchor lock.*ace).*(size|SHA-256)/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged resource trust rejects unlisted files and target substitution", () => {
  const { root, anchor } = createPackagedFixture({ after() {} });
  try {
    write(root, "python/oak_manuscript_core/injected.py");
    assert.throws(
      () => verifyPackagedResourceTrust({ root, platform: "win32", arch: "x64", anchor }),
      /app loose resources.*unlisted/,
    );
    fs.rmSync(path.join(root, "python", "oak_manuscript_core", "injected.py"));
    assert.throws(
      () => verifyPackagedResourceTrust({ root, platform: "darwin", arch: "arm64", anchor }),
      /trust target.*darwin-arm64/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged anchor is read from the real app.asar rather than loose resources", async (t) => {
  const root = makeRoot(t);
  const source = path.join(root, "asar-source");
  const anchor = { schema_version: "1.0", anchor_type: "fixture", value: "inside-asar" };
  writeJson(source, ANCHOR_RELATIVE, anchor);
  writeJson(source, "package.json", { name: "asar-package" });
  const asar = path.join(root, "app.asar");
  await createStablePackage(source, asar);
  writeJson(root, ANCHOR_RELATIVE, { ...anchor, value: "loose-tamper" });
  assert.deepEqual(readAnchorFromAsar(asar), anchor);
  assert.deepEqual(
    JSON.parse(readFileBytesFromAsar(asar, "package.json", "package.json").toString("utf8")),
    { name: "asar-package" },
  );
  assert.throws(() => readFileBytesFromAsar(asar, "../package.json", "package.json"), /路径非法/u);
});

test("packaged ASAR reads invalidate cached headers when an archive path is rebuilt", async (t) => {
  const root = makeRoot(t);
  const firstSource = path.join(root, "first-source");
  const secondSource = path.join(root, "second-source");
  const asar = path.join(root, "app.asar");
  const replacement = path.join(root, "replacement.asar");
  writeJson(firstSource, "package.json", { name: "first", padding: "short" });
  writeJson(secondSource, "package.json", {
    name: "second",
    padding: "a deliberately different header and payload size",
  });

  await createStablePackage(firstSource, asar);
  assert.equal(
    JSON.parse(readFileBytesFromAsar(asar, "package.json", "package.json").toString("utf8")).name,
    "first",
  );

  await createStablePackage(secondSource, replacement);
  fs.rmSync(asar, { force: true });
  fs.renameSync(replacement, asar);
  assert.equal(
    JSON.parse(readFileBytesFromAsar(asar, "package.json", "package.json").toString("utf8")).name,
    "second",
  );
});

test("packaged startup verifies the ASAR anchor before standards or window creation", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, "electron", "main.js"), "utf8");
  const trust = source.indexOf("verifyPackagedResourceTrust({");
  const standards = source.indexOf("const standardsStoreRoot =");
  const window = source.indexOf("createWindow();", standards);
  assert.ok(trust > 0);
  assert.ok(standards > trust);
  assert.ok(window > standards);
  assert.match(source.slice(trust, standards), /app\.exit\(1\);[\s\S]*return;/);
});
