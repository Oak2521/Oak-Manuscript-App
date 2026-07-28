"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createPackage } = require("@electron/asar");

const { validateConfiguration } = require("app-builder-lib/out/util/config/config");
const beforePack = require("../scripts/before_pack");
const electronDistHook = require("../scripts/electron_dist");
const {
  writePinnedManifest: writeElectronRuntimeManifest,
} = require("../scripts/electron_runtime_manifest");
const { writePinnedManifest } = require("../scripts/epubcheck_distribution");
const {
  manifestRelative: pythonRuntimeManifestRelative,
  writePinnedManifest: writePythonRuntimeManifest,
} = require("../scripts/python_runtime_manifest");
const {
  aceLockRelative,
  buildAceLock,
} = require("../scripts/stage_ace");
const {
  ResourceGateError,
  jreLockRelative,
  parseArgs: parseResourceGateArgs,
  probePythonRuntime,
  releaseTierForVersion,
  verifyJreRuntime,
  verifyMacRuntimes,
  verifyPackagedResources: verifyPackagedResourcesRaw,
} = require("../scripts/verify_packaged_resources");
const {
  NETWORK_SIGNING_ENV,
  createBuilderEnvironment,
  ensureBuildDirectory,
  getBuildPaths,
  runElectronBuilder,
} = require("../scripts/run_electron_builder");
const { runNativeMacBuild } = require("../scripts/run_native_mac_build");
const {
  LOCK_RELATIVE: BUILDER_LOCK_RELATIVE,
  SOURCE_ARCHIVES: BUILDER_SOURCE_ARCHIVES,
  TOOLCHAIN_RELATIVE: BUILDER_TOOLCHAIN_RELATIVE,
} = require("../scripts/builder_toolchain_contract");
const { verifyWindowsToolchain } = require("../scripts/verify_builder_toolchain");
const { pythonExecutableFor } = require("../electron/path-policy");
const { createPythonEnvironment } = require("../electron/python-bridge");
const { CORE_BOOTSTRAP, pythonCoreInvocation } = require("../electron/python-invocation");
const { compareUtf16 } = require("../scripts/deterministic_compare");
const {
  MANIFEST_RELATIVE: STANDARD_MANIFEST_RELATIVE,
  RULEPACK_RELATIVE: STANDARD_RULEPACK_RELATIVE,
  verifyStandardAssets,
} = require("../scripts/standard_assets");
const { BUNDLED_STANDARD_RELEASE } = require("../electron/standards-provider");
const {
  ANCHOR_RELATIVE: RESOURCE_TRUST_ANCHOR_RELATIVE,
  writeSourceResourceTrust,
} = require("../scripts/resource_trust_manifest");

const REPO_ROOT = path.resolve(__dirname, "..");
const PATCH_BEFORE = "681b52d047d5f6eebbfc62a925b7dc22b82589ab63b36a9ea602297f8cd86ea6";
const PATCH_AFTER = "6c7da7364d05548355fb1ab90c3d6d77366e2fd01b6f67551b648c5fb8285614";

function verifyPackagedResources(options) {
  if (options?.source === false) {
    const normalized = { ...options };
    if (normalized.electronSourceRoot === undefined) normalized.electronSourceRoot = options.root;
    if (normalized.readPackagedAnchor === undefined) {
      normalized.readPackagedAnchor = () => fs.readFileSync(path.join(
        options.root,
        ...RESOURCE_TRUST_ANCHOR_RELATIVE.split("/"),
      ));
    }
    return verifyPackagedResourcesRaw(normalized);
  }
  return verifyPackagedResourcesRaw(options);
}

function sha256(target) {
  return crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
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

function fakePe(machine = 0x8664) {
  const buffer = Buffer.alloc(512);
  buffer.write("MZ", 0, "ascii");
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write("PE\u0000\u0000", 0x80, "binary");
  buffer.writeUInt16LE(machine, 0x84);
  return buffer;
}

function fakeMachO(arch = "x64") {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4);
  return buffer;
}

function makeTestRoot(t) {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "release-gate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function inventory(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && relative !== "manifest.json") {
        const stat = fs.statSync(target);
        files.push({ path: relative, size_bytes: stat.size, sha256: sha256(target) });
      }
    }
  }
  visit(root);
  return files.sort((left, right) => compareUtf16(left.path, right.path));
}

function patchedRunnerSource() {
  const target = path.join(
    REPO_ROOT,
    "scripts",
    "patches",
    "ace-axe-runner-puppeteer-1.4.6.js",
  );
  const controlled = fs.readFileSync(target, "utf8").replace(/\r\n?/g, "\n");
  assert.equal(
    crypto.createHash("sha256").update(controlled).digest("hex"),
    PATCH_AFTER,
    "controlled Ace runner canonical LF hash must stay pinned",
  );
  return controlled;
}

function createAceStage(root) {
  const aceRoot = path.join(root, "tools", "ace");
  const licenseUrl = "https://spdx.org/licenses/MIT.html";
  const generatedLicense = "licenses/daisy__ace-axe-runner-puppeteer@1.4.6.txt";
  write(aceRoot, "ace.js", [
    "#!/usr/bin/env node",
    '"use strict";',
    'require("./node_modules/@daisy/ace-cli/bin/ace.js");',
    "",
  ].join("\n"));
  writeJson(aceRoot, "node_modules/@daisy/ace-cli/package.json", {
    name: "@daisy/ace-cli",
    version: "1.4.6",
    license: "MIT",
    dependencies: { "@daisy/ace-axe-runner-puppeteer": "1.4.6" },
  });
  write(aceRoot, "node_modules/@daisy/ace-cli/LICENSE", "MIT fixture license\n");
  writeJson(aceRoot, "node_modules/@daisy/ace-axe-runner-puppeteer/package.json", {
    name: "@daisy/ace-axe-runner-puppeteer",
    version: "1.4.6",
    license: "MIT",
    dependencies: { "@xmldom/xmldom": "0.9.10" },
  });
  writeJson(aceRoot, "node_modules/@xmldom/xmldom/package.json", {
    name: "@xmldom/xmldom",
    version: "0.9.10",
    license: "MIT",
    dependencies: {},
  });
  write(aceRoot, "node_modules/@xmldom/xmldom/LICENSE", "MIT fixture license\n");
  write(
    aceRoot,
    "node_modules/@daisy/ace-axe-runner-puppeteer/lib/index.js",
    patchedRunnerSource(),
  );
  write(aceRoot, generatedLicense, [
    "Oak Manuscript staged dependency license metadata notice",
    "It is not an original license file and does not assert any copyright holder.",
    "Package: @daisy/ace-axe-runner-puppeteer",
    "Version: 1.4.6",
    "Declared license expression: MIT",
    `Canonical license reference: ${licenseUrl}`,
    "Formal license audit required: true",
    "",
  ].join("\n"));

  const auditRecords = [{
    name: "@daisy/ace-axe-runner-puppeteer",
    version: "1.4.6",
    license: "MIT",
    path: "node_modules/@daisy/ace-axe-runner-puppeteer",
    license_notice: generatedLicense,
  }];
  const packages = [
    {
      name: "@daisy/ace-cli",
      version: "1.4.6",
      license: "MIT",
      license_url: licenseUrl,
      license_source: "package-file",
      path: "node_modules/@daisy/ace-cli",
      license_files: ["LICENSE"],
      license_notice_files: [],
      dependencies: {
        "@daisy/ace-axe-runner-puppeteer": {
          name: "@daisy/ace-axe-runner-puppeteer",
          version: "1.4.6",
          source_path: "@daisy/ace-axe-runner-puppeteer",
        },
      },
      missing_optional_dependencies: [],
    },
    {
      name: "@daisy/ace-axe-runner-puppeteer",
      version: "1.4.6",
      license: "MIT",
      license_url: licenseUrl,
      license_source: "generated-metadata-notice",
      path: "node_modules/@daisy/ace-axe-runner-puppeteer",
      license_files: [],
      license_notice_files: [generatedLicense],
      dependencies: {
        "@xmldom/xmldom": {
          name: "@xmldom/xmldom",
          version: "0.9.10",
          source_path: "@xmldom/xmldom",
        },
      },
      missing_optional_dependencies: [],
    },
    {
      name: "@xmldom/xmldom",
      version: "0.9.10",
      license: "MIT",
      license_url: licenseUrl,
      license_source: "package-file",
      path: "node_modules/@xmldom/xmldom",
      license_files: ["LICENSE"],
      license_notice_files: [],
      dependencies: {},
      missing_optional_dependencies: [],
    },
  ];
  write(aceRoot, "THIRD_PARTY_NOTICES.md", [
    "# Third-party dependency notices",
    "## Formal-sale blocker",
    "@daisy/ace-cli 1.4.6",
    "@daisy/ace-axe-runner-puppeteer 1.4.6",
    "@xmldom/xmldom 0.9.10",
    "",
  ].join("\n"));
  writeJson(aceRoot, "THIRD_PARTY_NOTICES.json", {
    schema_version: "1.0",
    formal_license_audit_required: true,
    packages_requiring_formal_license_audit: auditRecords,
    packages: packages.map((item) => ({
      name: item.name,
      version: item.version,
      license: item.license,
      license_url: item.license_url,
      license_source: item.license_source,
      license_files: item.license_files,
      license_notice_files: item.license_notice_files,
      path: item.path,
    })),
  });

  const files = inventory(aceRoot);
  const manifest = {
    schema_version: "1.0",
    root_package: { name: "@daisy/ace-cli", version: "1.4.6" },
    entry: "ace.js",
    package_count: 3,
    file_count: files.length,
    total_bytes: files.reduce((sum, file) => sum + file.size_bytes, 0),
    formal_license_audit_required: true,
    packages_requiring_formal_license_audit: auditRecords,
    third_party_notices: {
      markdown: "THIRD_PARTY_NOTICES.md",
      json: "THIRD_PARTY_NOTICES.json",
    },
    packages,
    patches: [{
      patch_id: "OAK-ACE-ISOLATION-002",
      target_package: "@daisy/ace-axe-runner-puppeteer",
      target_version: "1.4.6",
      target_file: "node_modules/@daisy/ace-axe-runner-puppeteer/lib/index.js",
      before_sha256: PATCH_BEFORE,
      after_sha256: PATCH_AFTER,
      controlled_replacement: "scripts/patches/ace-axe-runner-puppeteer-1.4.6.js",
      sanitizer: {
        package_name: "@xmldom/xmldom",
        package_version: "0.9.10",
      },
      effect: [
        "作者 XHTML 在 JavaScript 禁用状态下清洗；",
        "仅放行 EPUB basedir 内 file:；",
        "OS 级网络隔离仍是正式发布阻断项",
      ].join(""),
    }],
    files,
    excluded: [],
  };
  writeJson(aceRoot, "manifest.json", manifest);
  writeJson(root, aceLockRelative(manifest.root_package.version), buildAceLock(manifest));
  return aceRoot;
}

function createJreStage(root, relative = "tools/jre") {
  const runtimeRoot = path.join(root, ...relative.split("/"));
  write(runtimeRoot, "bin/java.exe", fakePe());
  write(runtimeRoot, "NOTICE", "Temurin fixture notice\n");
  write(runtimeRoot, "SOURCE_JDK_RELEASE.txt", [
    'IMPLEMENTOR="Eclipse Adoptium"',
    'IMPLEMENTOR_VERSION="Temurin-21.0.11+10"',
    'JAVA_VERSION="21.0.11"',
    'JAVA_RUNTIME_VERSION="21.0.11+10-LTS"',
    'OS_ARCH="x86_64"',
    'OS_NAME="Windows"',
    'IMAGE_TYPE="JDK"',
    "",
  ].join("\n"));
  write(runtimeRoot, "THIRD_PARTY_NOTICES.md", "# Temurin fixture notices\n");
  const runtimeModules = ["java.base", "java.se", "java.xml", "jdk.unsupported", "jdk.xml.dom"];
  for (const moduleName of runtimeModules) {
    write(runtimeRoot, `legal/${moduleName}/LICENSE`, "GPL-2.0-with-classpath-exception fixture\n");
  }
  const files = inventory(runtimeRoot);
  const jar = path.join(root, "tools", "epubcheck-5.3.0", "epubcheck.jar");
  const sample = path.join(root, "samples", "epub_good.epub");
  const defectSample = path.join(root, "samples", "epub_needs_review.epub");
  const distributionManifest = path.join(
    root,
    "config",
    "tool-manifests",
    "epubcheck-5.3.0.json",
  );
  const runtimeManifest = writeJson(runtimeRoot, "manifest.json", {
    schema_version: "1.0",
    runtime: {
      distribution: "Temurin",
      vendor: "Eclipse Adoptium",
      implementor_version: "Temurin-21.0.11+10",
      java_version: "21.0.11",
      java_runtime_version: "21.0.11+10-LTS",
      feature_version: 21,
    },
    target: { platform: "win32", arch: "x64" },
    entry: "bin/java.exe",
    module_policy: "fixed-conservative-java-se",
    requested_modules: ["java.se", "jdk.unsupported", "jdk.xml.dom"],
    modules: runtimeModules,
    jdeps_modules: ["java.base", "java.xml"],
    source_jdk: {
      release_file: "SOURCE_JDK_RELEASE.txt",
      release_sha256: sha256(path.join(runtimeRoot, "SOURCE_JDK_RELEASE.txt")),
      notice_file: "NOTICE",
      notice_sha256: sha256(path.join(runtimeRoot, "NOTICE")),
    },
    epubcheck_probe: {
      version: "5.3.0",
      jar_sha256: sha256(jar),
      distribution_manifest: "config/tool-manifests/epubcheck-5.3.0.json",
      distribution_manifest_sha256: sha256(distributionManifest),
      sample: "samples/epub_good.epub",
      sample_sha256: sha256(sample),
      checker_version: "5.3.0",
      n_fatal: 0,
      n_error: 0,
      n_warning: 0,
      defect_sample: "samples/epub_needs_review.epub",
      defect_sample_sha256: sha256(defectSample),
      defect: {
        status: 1,
        checker_version: "5.3.0",
        n_fatal: 0,
        n_error: 1,
        n_warning: 0,
      },
    },
    license_materials: [
      "NOTICE",
      "SOURCE_JDK_RELEASE.txt",
      "THIRD_PARTY_NOTICES.md",
      ...runtimeModules.map((moduleName) => `legal/${moduleName}/LICENSE`),
    ].sort(compareUtf16),
    file_count: files.length,
    total_bytes: files.reduce((sum, item) => sum + item.size_bytes, 0),
    files,
  });
  writeJson(root, "config/tool-manifests/jre-win32-x64.json", {
    schema_version: "1.0",
    lock_type: "oak-jre-runtime",
    target: { platform: "win32", arch: "x64" },
    runtime: {
      distribution: "Temurin",
      vendor: "Eclipse Adoptium",
      implementor_version: "Temurin-21.0.11+10",
      java_version: "21.0.11",
      java_runtime_version: "21.0.11+10-LTS",
      feature_version: 21,
    },
    source_jdk: {
      release_sha256: sha256(path.join(runtimeRoot, "SOURCE_JDK_RELEASE.txt")),
      java_sha256: "1".repeat(64),
      jdeps_sha256: "2".repeat(64),
      jlink_sha256: "3".repeat(64),
      tree_file_count: 10,
      tree_total_bytes: 1000,
      tree_sha256: "4".repeat(64),
    },
    epubcheck_distribution_manifest_sha256: sha256(distributionManifest),
    formal_source_provenance_audit_required: true,
    runtime_manifest_sha256: sha256(runtimeManifest),
  });
  return runtimeRoot;
}

function createResourceFixture(t, { builderToolchain = false } = {}) {
  const root = makeTestRoot(t);
  for (const relative of [
    "python/oak_manuscript_core/__init__.py",
    "python/oak_manuscript_core/__main__.py",
    "python/oak_manuscript_core/project.py",
    "python/oak_manuscript_core/external.py",
  ]) write(root, relative, "# fixture\n");
  for (const relative of [
    "config/standards.json",
    "config/rule-capabilities.json",
    STANDARD_RULEPACK_RELATIVE,
    STANDARD_MANIFEST_RELATIVE,
  ]) {
    const source = path.join(REPO_ROOT, ...relative.split("/"));
    const destination = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  write(root, "tools/epubcheck-5.3.0/epubcheck.jar");
  write(root, "tools/epubcheck-5.3.0/LICENSE.txt");
  write(root, "tools/epubcheck-5.3.0/lib/dependency.jar");
  for (const relative of [
    "CHANGELOG.txt",
    "README.txt",
    "THIRD-PARTY.txt",
    "licenses/Apache-2.0.txt",
    "licenses/BSD-3-Clause.txt",
    "licenses/MIT.txt",
    "licenses/MPL-2.0.txt",
    "licenses/W3C.txt",
  ]) write(root, `tools/epubcheck-5.3.0/${relative}`);
  write(root, "samples/epub_good.epub", "fixture epub\n");
  write(root, "samples/epub_needs_review.epub", "fixture invalid epub\n");
  write(root, "python-runtime/python.exe", fakePe());
  for (const relative of [
    "python-runtime/python3.dll",
    "python-runtime/python313.dll",
    "python-runtime/python313.zip",
    "python-runtime/python313._pth",
    "python-runtime/LICENSE.txt",
  ]) write(root, relative);
  write(
    root,
    "python-runtime/python313._pth",
    "python313.zip\n.\n\n#import site\n..\\python\n",
  );
  writePinnedManifest(root);
  writePythonRuntimeManifest(root, { platform: "win32", arch: "x64" });
  writeJson(root, "package-lock.json", {
    name: "fixture",
    lockfileVersion: 3,
    packages: {
      "": { devDependencies: { electron: "^43.1.0" } },
      "node_modules/electron": {
        version: "43.1.0",
        resolved: "https://registry.npmjs.org/electron/-/electron-43.1.0.tgz",
        integrity: `sha512-${Buffer.alloc(64, 9).toString("base64")}`,
      },
    },
  });
  writeJson(root, "node_modules/electron/package.json", { version: "43.1.0" });
  for (const relative of [
    "LICENSE",
    "LICENSES.chromium.html",
    "icudtl.dat",
    "resources.pak",
    "resources/default_app.asar",
    "locales/en-US.pak",
  ]) write(root, `node_modules/electron/dist/${relative}`);
  write(root, "node_modules/electron/dist/electron.exe", fakePe());
  write(root, "node_modules/electron/dist/version", "43.1.0\n");
  writeElectronRuntimeManifest(root, { platform: "win32", arch: "x64" });
  createJreStage(root);
  createAceStage(root);
  if (builderToolchain) createToolchainFixture(t, root);
  writeSourceResourceTrust(root);
  return root;
}

function createToolchainFixture(t, existingRoot = null) {
  const root = existingRoot || makeTestRoot(t);
  const toolchain = path.join(root, "tools", "electron-builder", "win32-x64");
  for (const relative of [
    "nsis/Bin/makensis.exe",
    "nsis/elevate.exe",
    "rcedit/rcedit-x64.exe",
    "signtool.exe",
  ]) write(toolchain, relative, fakePe());
  write(toolchain, "rcedit/rcedit-x86.exe", fakePe(0x014c));
  write(toolchain, "nsis/Include/fixture.nsh");
  write(toolchain, "nsis/Stubs/fixture.bin");
  write(toolchain, "nsis/Contrib/fixture.txt");
  write(toolchain, "nsis-resources/plugins/x86-unicode/fixture.dll");
  const files = inventory(toolchain);
  const sourceArchives = BUILDER_SOURCE_ARCHIVES.map((item, index) => ({
    name: item.name,
    size_bytes: 1000 + index,
    sha256: item.sha256,
  }));
  const manifest = {
    schema_version: "1.0",
    host_platform: "win32",
    host_arch: "x64",
    electron_builder_version: require("electron-builder/package.json").version,
    source_archives: sourceArchives,
    file_count: files.length,
    total_bytes: files.reduce((sum, item) => sum + item.size_bytes, 0),
    files,
  };
  const manifestTarget = writeJson(toolchain, "manifest.json", manifest);
  const manifestStat = fs.statSync(manifestTarget);
  writeJson(root, BUILDER_LOCK_RELATIVE, {
    schema_version: "1.0",
    host_platform: "win32",
    host_arch: "x64",
    electron_builder_version: require("electron-builder/package.json").version,
    source_archives: sourceArchives,
    tool_manifest: {
      path: `${BUILDER_TOOLCHAIN_RELATIVE}/manifest.json`,
      size_bytes: manifestStat.size,
      sha256: sha256(manifestTarget),
    },
    file_count: files.length,
    total_bytes: files.reduce((sum, item) => sum + item.size_bytes, 0),
    files,
  });
  return { root, toolchain };
}

test("electron-builder config is valid and pins alpha.15 Windows installer policy", async () => {
  const packageJson = require("../package.json");
  const packageLock = require("../package-lock.json");
  await validateConfiguration(packageJson.build, { isEnabled: false, add() {} });

  assert.equal(packageJson.version, "0.1.0-alpha.15");
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  const pythonInit = fs.readFileSync(
    path.join(REPO_ROOT, "python", "oak_manuscript_core", "__init__.py"),
    "utf8",
  );
  const pythonVersion = pythonInit.match(/^__version__\s*=\s*"([^"]+)"/m)?.[1];
  assert.equal(pythonVersion, packageJson.version, "package/lock/Python core versions must match");
  assert.equal(packageJson.devDependencies["@daisy/ace-cli"], "^1.4.6");
  assert.equal(Object.hasOwn(packageJson.devDependencies, "@daisy/ace"), false);
  assert.equal(Object.hasOwn(packageLock.packages, "node_modules/@daisy/ace"), false);
  assert.equal(
    Object.hasOwn(packageLock.packages, "node_modules/@daisy/ace/node_modules/electron"),
    false,
  );

  assert.equal(packageJson.build.beforePack, "scripts/before_pack.js");
  assert.equal(packageJson.build.afterPack, "scripts/after_pack.js");
  assert.equal(Object.hasOwn(packageJson.build, "electronDist"), false);
  assert.deepEqual(packageJson.build.win.target, [
    { target: "nsis", arch: ["x64"] },
    { target: "zip", arch: ["x64"] },
  ]);
  const standardsGate = verifyStandardAssets(REPO_ROOT);
  assert.equal(BUNDLED_STANDARD_RELEASE.manifestSha256, standardsGate.manifestSha256);
  assert.equal(BUNDLED_STANDARD_RELEASE.version, standardsGate.manifest.version);
  assert.equal(BUNDLED_STANDARD_RELEASE.releaseSequence,
    standardsGate.manifest.release_sequence);
  assert.equal(packageJson.build.win.artifactName, "Oak-Manuscript-${version}-Windows-${arch}.${ext}");
  assert.equal(packageJson.build.nsis.oneClick, false);
  assert.equal(packageJson.build.nsis.perMachine, false);
  assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
  assert.deepEqual(packageJson.build.win.extraResources, [
    { from: "python-runtime", to: "python-runtime" },
    { from: "tools/jre-win32-x64", to: "tools/jre" },
    { from: "tools/ace", to: "tools/ace" },
    { from: "tools/ace/node_modules", to: "tools/ace/node_modules" },
    {
      from: "tools/ace/node_modules/resolve/test/resolver/symlinked/_/symlink_target/.gitkeep",
      to: "tools/ace/node_modules/resolve/test/resolver/symlinked/_/symlink_target/.gitkeep",
    },
  ]);
  assert.deepEqual(packageJson.build.mac.extraResources, [
    { from: "python-runtime-macos-${arch}", to: "python-runtime" },
    { from: "tools/jre-darwin-${arch}", to: "tools/jre" },
    { from: "tools/ace", to: "tools/ace" },
    { from: "tools/ace/node_modules", to: "tools/ace/node_modules" },
    {
      from: "tools/ace/node_modules/resolve/test/resolver/symlinked/_/symlink_target/.gitkeep",
      to: "tools/ace/node_modules/resolve/test/resolver/symlinked/_/symlink_target/.gitkeep",
    },
  ]);
  assert.equal(
    packageJson.build.extraResources.some((item) => item.from === "python-runtime"),
    false,
  );
  assert.match(packageJson.scripts["build:win"], /^npm run release:evidence:clear:win .*stage:jre:win .*stage:ace .*verify:resources:win/);
  assert.match(packageJson.scripts["build:win"], /verify:packaged:win .*smoke:packaged:win .*release:evidence:win$/);
  assert.equal(packageJson.scripts["smoke:packaged:win"], "node scripts/run_packaged_smoke.js");
  assert.equal(
    packageJson.scripts["release:evidence:win"],
    "node scripts/release_artifact_manifest.js --generate --platform win32 --arch x64",
  );
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /^python-runtime-macos-\*\/$/m);
  for (const scriptName of [
    "verify:resources:win",
    "verify:resources:mac:static",
    "verify:resources:mac:x64",
    "verify:resources:mac:arm64",
    "verify:packaged:win",
    "verify:packaged:mac:x64",
    "verify:packaged:mac:arm64",
  ]) {
    assert.match(packageJson.scripts[scriptName], /--release-tier auto(?:\s|$)/);
    assert.doesNotMatch(packageJson.scripts[scriptName], /--release-tier alpha(?:\s|$)/);
  }
  assert.equal(packageJson.scripts["verify:resources:mac"], "npm run verify:resources:mac:static");
  assert.match(packageJson.scripts["verify:resources:mac:static"], /--no-runtime-probe/);
  assert.equal(packageJson.scripts["build:mac"], "node scripts/run_native_mac_build.js");
  assert.match(packageJson.scripts["build:mac:x64"], /verify:resources:mac:x64/);
  assert.match(packageJson.scripts["build:mac:x64"], /--mac --x64/);
  assert.match(packageJson.scripts["build:mac:x64"], /verify:packaged:mac:x64$/);
  assert.match(packageJson.scripts["build:mac:arm64"], /verify:resources:mac:arm64/);
  assert.match(packageJson.scripts["build:mac:arm64"], /--mac --arm64/);
  assert.match(packageJson.scripts["build:mac:arm64"], /verify:packaged:mac:arm64$/);
});

test("macOS aggregate build dispatches only the native architecture runner", () => {
  const calls = [];
  const npmCli = path.join(REPO_ROOT, "out", "fixture-npm-cli.js");
  const result = runNativeMacBuild({
    root: REPO_ROOT,
    hostPlatform: "darwin",
    hostArch: "arm64",
    env: { npm_execpath: npmCli, SAFE: "yes" },
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, signal: null };
    },
  });
  assert.deepEqual(result, { arch: "arm64", script: "build:mac:arm64" });
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].args.slice(-3),
    [npmCli, "run", "build:mac:arm64"],
  );
  assert.equal(calls[0].options.windowsHide, true);
  assert.throws(
    () => runNativeMacBuild({ hostPlatform: "win32", hostArch: "x64" }),
    /只能在 darwin runner/,
  );
});

test("builder wrapper keeps cache/temp local, blocks publish, and never starts without offline tools", (t) => {
  const paths = getBuildPaths(REPO_ROOT);
  const injectedSigning = Object.fromEntries(
    [...NETWORK_SIGNING_ENV].map((key) => [key, `secret-${key}`]),
  );
  const env = createBuilderEnvironment({
    root: REPO_ROOT,
    env: { FIXTURE: "yes", ...injectedSigning, CSC_IDENTITY_AUTO_DISCOVERY: "true" },
  });
  for (const target of [
    env.ELECTRON_CACHE,
    env.ELECTRON_BUILDER_CACHE,
    env.XDG_CACHE_HOME,
    env.TEMP,
    env.TMP,
    env.TMPDIR,
  ]) {
    const relative = path.relative(REPO_ROOT, target);
    assert.equal(relative.startsWith("..") || path.isAbsolute(relative), false);
  }
  assert.equal(env.ELECTRON_CACHE, paths.electronCache);
  assert.equal(env.ELECTRON_BUILDER_CACHE, paths.builderCache);
  assert.equal(env.FIXTURE, "yes");
  for (const key of NETWORK_SIGNING_ENV) assert.equal(Object.hasOwn(env, key), false);
  assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY, "false");
  assert.equal(env.npm_config_offline, "true");
  assert.equal(
    createBuilderEnvironment({
      root: REPO_ROOT,
      env: { ELECTRON_BUILDER_OFFLINE: "false" },
      toolchainEnv: { ELECTRON_BUILDER_OFFLINE: "false" },
    }).ELECTRON_BUILDER_OFFLINE,
    "true",
  );
  assert.throws(
    () => runElectronBuilder(["--win", "--publish", "always"], { root: REPO_ROOT }),
    /不接受发布参数/,
  );
  let spawned = false;
  assert.throws(
    () => runElectronBuilder(["--win", "--x64"], {
      root: makeTestRoot(t),
      hostPlatform: "win32",
      spawn() { spawned = true; return { status: 0 }; },
    }),
    /离线 Windows 构建工具链缺失/,
  );
  assert.equal(spawned, false, "builder must not start before offline toolchain preflight passes");

  const wrapperRoot = makeTestRoot(t, "builder-wrapper-");
  const pinnedDist = path.join(wrapperRoot, "pinned-electron-dist");
  const pinnedSevenZip = path.join(wrapperRoot, "pinned-7zip", "7z.exe");
  const calls = [];
  const status = runElectronBuilder(["--win", "--x64"], {
    root: wrapperRoot,
    hostPlatform: "win32",
    hostArch: "x64",
    preflight({ root, platform, arch }) {
      assert.equal(root, wrapperRoot);
      assert.equal(platform, "win32");
      assert.equal(arch, "x64");
      return { env: { PINNED_TOOLCHAIN: "yes" } };
    },
    resolveDist(options) {
      assert.deepEqual(options, {
        projectRoot: wrapperRoot,
        platform: "win32",
        arch: "x64",
        hostPlatform: "win32",
        hostArch: "x64",
      });
      return { dist: pinnedDist };
    },
    resolveSevenZip(root) {
      assert.equal(root, wrapperRoot);
      return pinnedSevenZip;
    },
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, signal: null };
    },
  });
  assert.equal(status, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(-3), [
    `--config.electronDist=${pinnedDist}`,
    "--publish",
    "never",
  ]);
  assert.equal(calls[0].options.env.PINNED_TOOLCHAIN, "yes");
  assert.equal(calls[0].options.env.ELECTRON_BUILDER_7ZIP_PATH, pinnedSevenZip);

  let fallbackSpawned = false;
  assert.throws(
    () => runElectronBuilder(["--win", "--x64"], {
      root: wrapperRoot,
      hostPlatform: "win32",
      hostArch: "x64",
      preflight() { return { env: {} }; },
      resolveSevenZip() { return pinnedSevenZip; },
      resolveDist() { throw new Error("pinned dist rejected"); },
      spawn() { fallbackSpawned = true; return { status: 0 }; },
    }),
    /pinned dist rejected/,
  );
  assert.equal(fallbackSpawned, false, "builder must not start or download after dist rejection");

  assert.throws(
    () => runElectronBuilder(["--win", "--x64"], {
      root: wrapperRoot,
      hostPlatform: "win32",
      hostArch: "x64",
      preflight() { return { env: {} }; },
      resolveSevenZip() { throw new Error("pinned 7zip rejected"); },
      resolveDist() { return { dist: pinnedDist }; },
      spawn() { fallbackSpawned = true; return { status: 0 }; },
    }),
    /pinned 7zip rejected/,
  );
  assert.throws(
    () => runElectronBuilder(["--win", "--x64", "--config", "evil.json"], {
      root: REPO_ROOT,
      hostPlatform: "win32",
    }),
    /拒绝配置绕过参数/,
  );
  assert.throws(
    () => runElectronBuilder(["--mac", "--arm64"], {
      root: REPO_ROOT,
      hostPlatform: "win32",
    }),
    /macOS 正式构建必须在 darwin 主机执行/,
  );
  assert.throws(
    () => runElectronBuilder(["--mac", "--x64", "--arm64"], {
      root: REPO_ROOT,
      hostPlatform: "darwin",
      hostArch: "x64",
    }),
    /必须且只能指定一个目标架构/,
  );
  assert.throws(
    () => runElectronBuilder(["--mac", "--arm64"], {
      root: REPO_ROOT,
      hostPlatform: "darwin",
      hostArch: "x64",
    }),
    /必须使用原生 arm64 runner.*x64/,
  );
});

test("builder writable directories reject a junction before writing through it", (t) => {
  const root = makeTestRoot(t);
  const outside = makeTestRoot(t);
  const link = path.join(root, "out");
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`当前主机不能创建测试 junction/symlink：${error.code}`);
      return;
    }
    throw error;
  }
  assert.throws(
    () => ensureBuildDirectory(root, path.join(link, "cache"), "builder-cache"),
    /链接|逃逸/,
  );
  assert.equal(fs.existsSync(path.join(outside, "cache")), false);
});

test("Puppeteer install config disables all browser downloads", () => {
  const config = require("../.puppeteerrc.cjs");
  assert.deepEqual(config, { skipDownload: true });
});

test("hash-pinned manifests and controlled patches always checkout with LF bytes", () => {
  const attributes = fs.readFileSync(path.join(REPO_ROOT, ".gitattributes"), "utf8");
  assert.match(attributes, /^config\/tool-manifests\/\*\.json text eol=lf$/m);
  assert.match(attributes, /^config\/standards\.json text eol=lf$/m);
  assert.match(attributes, /^config\/rule-capabilities\.json text eol=lf$/m);
  assert.match(attributes, /^config\/rule-packs\/\*\.json text eol=lf$/m);
  assert.match(attributes, /^config\/standard-packs\/\*\.json text eol=lf$/m);
  assert.match(attributes, /^electron\/resource-trust-anchor\.json text eol=lf$/m);
  assert.match(attributes, /^scripts\/patches\/\*\.js text eol=lf$/m);
});

test("trust inventories use locale-independent UTF-16 ordering", () => {
  const values = ["a/file", "中/file", "_/file", "A/file", "é/file", "Z/file"];
  assert.deepEqual(values.sort(compareUtf16), [
    "A/file",
    "Z/file",
    "_/file",
    "a/file",
    "é/file",
    "中/file",
  ]);
  assert.equal(compareUtf16("same", "same"), 0);
  assert.throws(() => compareUtf16("safe", null), /只接受字符串/);
});

test("runtime lock paths are target-specific and never reuse Windows locks on macOS", () => {
  assert.equal(jreLockRelative("win32", "x64"), "config/tool-manifests/jre-win32-x64.json");
  assert.equal(jreLockRelative("darwin", "x64"), "config/tool-manifests/jre-darwin-x64.json");
  assert.equal(jreLockRelative("darwin", "arm64"), "config/tool-manifests/jre-darwin-arm64.json");
  assert.equal(
    pythonRuntimeManifestRelative("win32", "x64"),
    "config/tool-manifests/python-runtime-win32-x64.json",
  );
  assert.equal(
    pythonRuntimeManifestRelative("darwin", "arm64"),
    "config/tool-manifests/python-runtime-darwin-arm64.json",
  );
});

test("explicit macOS static runtime verification is host-independent", (t) => {
  const root = makeTestRoot(t);
  write(root, "python-runtime/LICENSE.txt", "CPython fixture license\n");
  write(root, "python-runtime/bin/python3", fakeMachO("x64"));
  writePythonRuntimeManifest(root, {
    platform: "darwin",
    arch: "x64",
    runtimeRelative: "python-runtime",
  });
  const errors = [];
  const checks = [];
  const states = verifyMacRuntimes(root, "x64", errors, checks, {
    execute: false,
    source: false,
  });
  assert.deepEqual(errors, []);
  assert.equal(states.length, 1);
  assert.equal(states[0].platform, "darwin");
  assert.equal(states[0].arch, "x64");
  assert.equal(states[0].version, "3.13.14");
  assert.equal(checks.some((item) => item.type === "python-runtime-manifest"), true);
});

test("offline Windows toolchain preflight validates structure, hashes, and supported overrides", (t) => {
  const { root, toolchain } = createToolchainFixture(t);
  const result = verifyWindowsToolchain(root, "x64");
  assert.equal(result.toolchain, toolchain);
  assert.deepEqual(result.env, {
    ELECTRON_BUILDER_NSIS_DIR: path.join(toolchain, "nsis"),
    ELECTRON_BUILDER_NSIS_RESOURCES_DIR: path.join(toolchain, "nsis-resources"),
    ELECTRON_BUILDER_RCEDIT_PATH: path.join(toolchain, "rcedit"),
    SIGNTOOL_PATH: path.join(toolchain, "signtool.exe"),
  });
  fs.appendFileSync(path.join(toolchain, "nsis", "Contrib", "fixture.txt"), "tamper\n");
  assert.throws(
    () => verifyWindowsToolchain(root, "x64"),
    /哈希或大小不匹配/,
  );
});

test("beforePack forwards the builder project root and target platform", () => {
  const calls = [];
  beforePack(
    {
      packager: { projectDir: REPO_ROOT, appInfo: { version: "0.1.0-alpha.15" } },
      electronPlatformName: "darwin",
      arch: 1,
    },
    { verify(options) { calls.push(options); return { checks: [] }; } },
  );
  assert.deepEqual(calls, [{
    root: REPO_ROOT,
    platform: "darwin",
    arch: "x64",
    source: true,
    releaseTier: "alpha",
  }]);
  assert.equal(releaseTierForVersion("0.1.0-alpha.10"), "alpha");
  assert.equal(releaseTierForVersion("1.0.0"), "sale");
  assert.equal(parseResourceGateArgs(["--release-tier", "auto"]).releaseTier, "alpha");
  assert.equal(parseResourceGateArgs(["--no-runtime-probe"]).executeRuntimes, false);
  assert.throws(
    () => parseResourceGateArgs(["--electron-source-root", "untrusted"]),
    /未知参数/,
  );
});

test("electronDist hook uses native installed Electron and returns a missing sentinel for cross targets", () => {
  const native = electronDistHook({
    packager: { projectDir: REPO_ROOT },
    platformName: process.platform,
    arch: process.arch,
  });
  assert.equal(native, path.join(REPO_ROOT, "node_modules", "electron", "dist"));

  const crossPlatform = process.platform === "win32" ? "darwin" : "win32";
  const crossArch = process.arch === "x64" ? "arm64" : "x64";
  const sentinel = electronDistHook({
    packager: { projectDir: REPO_ROOT },
    platformName: crossPlatform,
    arch: crossArch,
  });
  assert.equal(fs.existsSync(sentinel), false);
  assert.equal(
    path.relative(REPO_ROOT, sentinel).split(path.sep).slice(0, 3).join("/"),
    "out/electron-dist/.missing",
  );
});

test("path policy selects bundled and fallback Python per target OS", () => {
  const root = path.join(REPO_ROOT, "out", "fixture-resources");
  const winBundled = path.join(root, "python-runtime", "python.exe");
  const macBundled = path.join(root, "python-runtime", "bin", "python3");
  assert.equal(
    pythonExecutableFor({ platform: "win32", root, exists: (target) => target === winBundled }),
    winBundled,
  );
  assert.equal(
    pythonExecutableFor({ platform: "win32", root, exists: () => false }),
    "python",
  );
  assert.equal(
    pythonExecutableFor({ platform: "darwin", root, exists: (target) => target === macBundled }),
    macBundled,
  );
  assert.equal(
    pythonExecutableFor({ platform: "darwin", root, exists: () => false }),
    "python3",
  );
  assert.throws(
    () => pythonExecutableFor({ platform: "win32", root, exists: () => false, packaged: true }),
    /打包资源完整性错误.*python\.exe/,
  );
  assert.throws(
    () => pythonExecutableFor({ platform: "darwin", root, exists: () => false, packaged: true }),
    /打包资源完整性错误.*python3/,
  );
});

test("Python bridge removes inherited Python and Oak injection before setting fixed values", () => {
  const env = createPythonEnvironment({
    Path: "C:/Windows",
    PYTHONHOME: "C:/evil",
    pythonpath: "C:/evil-modules",
    PYTHONSTARTUP: "C:/evil.py",
    OAK_APP_PACKAGED: "attacker",
    OAK_ELECTRON_EXEC_PATH: "C:/evil.exe",
    OAK_STANDARDS_STORE: "C:/evil-standards",
    SAFE_VALUE: "kept",
  }, {
    packaged: true,
    standardsStoreRoot: path.join(REPO_ROOT, "out", "trusted-standards"),
  });
  assert.equal(env.Path, "C:/Windows");
  assert.equal(env.SAFE_VALUE, "kept");
  assert.equal(env.PYTHONHOME, undefined);
  assert.equal(env.pythonpath, undefined);
  assert.equal(env.PYTHONSTARTUP, undefined);
  assert.equal(env.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(env.PYTHONNOUSERSITE, "1");
  assert.equal(env.OAK_APP_PACKAGED, "1");
  assert.equal(env.OAK_ELECTRON_EXEC_PATH, undefined);
  assert.equal(env.OAK_STANDARDS_STORE, path.join(REPO_ROOT, "out", "trusted-standards"));
  const invocation = pythonCoreInvocation({
    executable: "python3",
    coreDir: path.join(REPO_ROOT, "python"),
    args: ["--version"],
  });
  assert.equal(invocation.command, "python3");
  assert.deepEqual(invocation.args, [
    "-I", "-B", "-S", "-X", "utf8", "-c", CORE_BOOTSTRAP,
    path.join(REPO_ROOT, "python"), "--version",
  ]);
  assert.equal(invocation.cwd, path.join(REPO_ROOT, "python"));
});

test("isolated Python bootstrap emits non-ASCII JSON as UTF-8 bytes", (t) => {
  const root = makeTestRoot(t);
  const coreDir = path.join(root, "python");
  write(coreDir, "oak_manuscript_core/__init__.py", "");
  write(
    coreDir,
    "oak_manuscript_core/__main__.py",
    'print(\'{"message":"湖岸稿件"}\')\n',
  );
  const invocation = pythonCoreInvocation({
    executable: process.platform === "win32" ? "python" : "python3",
    coreDir,
  });
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: { ...process.env, PYTHONUTF8: "0", PYTHONIOENCODING: "cp1252" },
    windowsHide: true,
  });
  if (result.error?.code === "EPERM") {
    t.skip("当前沙箱禁止 Node 启动子 Python；完整发布回归需在受控原生 runner 执行");
    return;
  }
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr?.toString("utf8"));
  assert.equal(result.stdout.includes(Buffer.from("湖岸稿件", "utf8")), true);
  assert.equal(result.stdout.toString("utf8").includes("�"), false);
  assert.equal(
    fs.existsSync(path.join(coreDir, "oak_manuscript_core", "__pycache__")),
    false,
    "隔离 Python 调用不得在受信资源目录写入字节码缓存",
  );
});

test("Python runtime probe rejects a runnable interpreter with the wrong exact version", () => {
  const errors = [];
  const checks = [];
  probePythonRuntime(
    REPO_ROOT,
    process.platform === "win32" ? "python" : "python3",
    "host-python-version-mismatch",
    errors,
    checks,
    { expectedRuntimeVersion: "3.99.99" },
  );
  assert.equal(
    errors.some((item) => item.includes("期望 CPython 3.99.99 final")),
    true,
    errors.join("\n"),
  );
  assert.equal(
    checks.some((item) => item.type === "python-interpreter-identity-probe" ||
      item.type === "python-runtime-probe"),
    false,
  );
});

test("runtime probes fail closed on a non-native host unless static-only is explicit", (t) => {
  const root = createResourceFixture(t);
  assert.throws(
    () => verifyPackagedResources({
      root,
      platform: "win32",
      arch: "x64",
      source: false,
      releaseTier: "alpha",
      executeRuntimes: true,
      hostPlatform: "linux",
      hostArch: "x64",
    }),
    (error) => error instanceof ResourceGateError &&
      error.report.runtime_probe_requested === true &&
      error.report.runtime_probe_executed === false &&
      error.errors.some((item) => item.includes("原生 win32-x64 runner")),
  );
  assert.equal(verifyPackagedResources({
    root,
    platform: "win32",
    arch: "x64",
    source: false,
    releaseTier: "alpha",
    executeRuntimes: false,
    hostPlatform: "linux",
    hostArch: "x64",
  }).ok, true);
});

test("Windows resource gate accepts a complete offline fixture", (t) => {
  const root = createResourceFixture(t, { builderToolchain: true });
  const report = verifyPackagedResources({
    root,
    platform: "win32",
    arch: "x64",
    source: false,
    releaseTier: "alpha",
    executeRuntimes: false,
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks.some((item) => item.type === "jre-runtime"), true);
  assert.equal(report.checks.some((item) => item.type === "ace-stage"), true);
  assert.deepEqual(new Set(report.blockers.map((item) => item.code)), new Set([
    "PYTHON_RUNTIME_PROVENANCE_AUDIT_REQUIRED",
    "FORMAL_LICENSE_AUDIT_REQUIRED",
    "EPUBCHECK_PROVENANCE_AUDIT_REQUIRED",
    "JRE_SOURCE_PROVENANCE_AUDIT_REQUIRED",
    "ELECTRON_RUNTIME_PROVENANCE_AUDIT_REQUIRED",
    "BUILDER_TOOLCHAIN_PROVENANCE_AUDIT_REQUIRED",
    "ACE_FULL_LICENSE_AUDIT_REQUIRED",
    "ACE_CONTROLLED_HELPER_PENDING",
    "ACE_BROWSER_RUNTIME_PENDING",
    "ACE_OS_NETWORK_ISOLATION_PENDING",
    "WINDOWS_CODE_SIGNING_PENDING",
  ]));
  assert.equal(report.blockers.length, 11);
  const trustEvidence = report.checks.find((item) => item.type === "resource-trust-anchor");
  assert.equal(trustEvidence?.evidence_scope, "packaged-app-asar");
  assert.equal(trustEvidence?.protected_by_app_asar, true);
  assert.deepEqual(Object.keys(trustEvidence?.lock_sha256s || {}).sort(), [
    "ace", "epubcheck", "jre", "python_runtime",
  ]);
  const electronEvidence = report.checks.find((item) => item.type === "electron-runtime-lock");
  assert.equal(electronEvidence?.evidence_scope, "source-build-input");
  assert.equal(electronEvidence?.evidence_root, root);
  assert.equal(electronEvidence?.path,
    "config/tool-manifests/electron-43.1.0-win32-x64.json");
  const builderEvidence = report.checks.find((item) => item.type === "builder-toolchain-lock");
  assert.equal(builderEvidence?.evidence_scope, "source-build-input");
  assert.equal(builderEvidence?.platform, "win32");
  assert.equal(builderEvidence?.arch, "x64");
  assert.match(builderEvidence?.lock_sha256, /^[a-f0-9]{64}$/);
});

test("packaged resource gate reads the trust anchor from the real app.asar", async (t) => {
  const root = createResourceFixture(t);
  const asarSource = path.join(root, "asar-source");
  const anchorSource = path.join(root, ...RESOURCE_TRUST_ANCHOR_RELATIVE.split("/"));
  const anchorTarget = path.join(asarSource, ...RESOURCE_TRUST_ANCHOR_RELATIVE.split("/"));
  fs.mkdirSync(path.dirname(anchorTarget), { recursive: true });
  fs.copyFileSync(anchorSource, anchorTarget);
  await createPackage(asarSource, path.join(root, "app.asar"));

  const report = verifyPackagedResourcesRaw({
    root,
    electronSourceRoot: root,
    platform: "win32",
    arch: "x64",
    source: false,
    releaseTier: "alpha",
    executeRuntimes: false,
  });
  const evidence = report.checks.find((item) => item.type === "resource-trust-anchor");
  assert.equal(evidence?.evidence_scope, "packaged-app-asar");
  assert.equal(evidence?.protected_by_app_asar, true);
  assert.equal(report.blockers.length, 12);

  fs.rmSync(path.join(root, "app.asar"));
  assert.throws(
    () => verifyPackagedResourcesRaw({
      root,
      electronSourceRoot: root,
      platform: "win32",
      arch: "x64",
      source: false,
      releaseTier: "alpha",
      executeRuntimes: false,
    }),
    (error) => error instanceof ResourceGateError &&
      error.errors.some((item) => item.includes("真实 app.asar 资源信任锚读取失败")),
  );
});

test("packaged resource gate keeps Electron trust-root blocker when source evidence is missing", (t) => {
  const root = createResourceFixture(t);
  const missingSourceRoot = path.join(root, "missing-source-build-input");
  assert.throws(
    () => verifyPackagedResources({
      root,
      electronSourceRoot: missingSourceRoot,
      platform: "win32",
      arch: "x64",
      source: false,
      releaseTier: "alpha",
      executeRuntimes: false,
    }),
    (error) => error instanceof ResourceGateError &&
      error.report.electron_source_root === missingSourceRoot &&
      error.report.checks.every((item) => item.type !== "electron-runtime-lock") &&
      error.report.blockers.some((item) =>
        item.code === "ELECTRON_RUNTIME_TRUST_ROOT_NOT_HARDENED") &&
      error.report.blockers.some((item) =>
        item.code === "ELECTRON_RUNTIME_PROVENANCE_AUDIT_REQUIRED") &&
      error.report.blockers.some((item) => item.code === "WINDOWS_CODE_SIGNING_PENDING"),
  );
});

test("sale resource tier rejects generated license notices that alpha reports as blockers", (t) => {
  const root = createResourceFixture(t);
  assert.throws(
    () => verifyPackagedResources({
      root,
      platform: "win32",
      source: false,
      releaseTier: "sale",
      executeRuntimes: false,
    }),
    (error) => error instanceof ResourceGateError &&
      error.errors.some((item) => item.includes("sale 门禁失败")) &&
      [
        "PYTHON_RUNTIME_PROVENANCE_AUDIT_REQUIRED",
        "FORMAL_LICENSE_AUDIT_REQUIRED",
        "EPUBCHECK_PROVENANCE_AUDIT_REQUIRED",
        "JRE_SOURCE_PROVENANCE_AUDIT_REQUIRED",
        "ELECTRON_RUNTIME_PROVENANCE_AUDIT_REQUIRED",
        "BUILDER_TOOLCHAIN_PROVENANCE_AUDIT_REQUIRED",
        "BUILDER_TOOLCHAIN_TRUST_ROOT_NOT_HARDENED",
        "ACE_FULL_LICENSE_AUDIT_REQUIRED",
        "ACE_CONTROLLED_HELPER_PENDING",
        "ACE_BROWSER_RUNTIME_PENDING",
        "ACE_OS_NETWORK_ISOLATION_PENDING",
        "WINDOWS_CODE_SIGNING_PENDING",
      ].every((code) => error.report.blockers.some((item) => item.code === code)),
  );
});

test("JRE gate rejects a changed runtime file even when the entry still looks executable", (t) => {
  const root = createResourceFixture(t);
  fs.appendFileSync(path.join(root, "tools", "jre", "bin", "java.exe"), "tamper\n");
  assert.throws(
    () => verifyPackagedResources({
      root,
      platform: "win32",
      arch: "x64",
      source: false,
      releaseTier: "alpha",
      executeRuntimes: false,
    }),
    (error) => error instanceof ResourceGateError &&
      error.errors.some((item) => item.includes("tools/jre 文件 SHA-256 或大小")),
  );
});

test("JRE gate never executes a runtime after its manifest or hash gate fails", (t) => {
  const root = createResourceFixture(t);
  fs.appendFileSync(path.join(root, "tools", "jre", "bin", "java.exe"), "tamper\n");
  const errors = [];
  const checks = [];
  verifyJreRuntime(
    root,
    "tools/jre",
    "win32",
    "x64",
    errors,
    checks,
    { execute: true },
  );
  assert.equal(errors.some((item) => item.includes("SHA-256 或大小")), true);
  assert.equal(errors.some((item) => item.includes("EpubCheck 实际探针失败")), false);
  assert.equal(checks.some((item) => item.type === "jre-epubcheck-probe-matrix"), false);
});

test("Python runtime gate rejects tampering and unlisted files before any probe", (t) => {
  const root = createResourceFixture(t);
  fs.appendFileSync(path.join(root, "python-runtime", "python.exe"), "tamper\n");
  write(root, "python-runtime/unlisted.dll", "extra\n");
  assert.throws(
    () => verifyPackagedResources({
      root,
      platform: "win32",
      arch: "x64",
      source: false,
      releaseTier: "alpha",
      executeRuntimes: true,
    }),
    (error) => error instanceof ResourceGateError &&
      error.errors.some((item) => item.includes("Python 运行时文件 SHA-256")) &&
      error.report.checks.every((item) => item.type !== "python-runtime-probe") &&
      error.report.checks.every((item) => item.type !== "jre-epubcheck-probe-matrix"),
  );
});

test("macOS resource gate fails closed while both architecture runtimes are missing", (t) => {
  const root = createResourceFixture(t);
  assert.throws(
    () => verifyPackagedResources({
      root,
      platform: "darwin",
      source: true,
      releaseTier: "alpha",
      executeRuntimes: false,
    }),
    (error) => error instanceof ResourceGateError &&
      error.errors.some((item) => item.includes("python-runtime-darwin-x64.json")) &&
      error.errors.some((item) => item.includes("python-runtime-darwin-arm64.json")),
  );
});

test("Ace gate rejects hash tampering and unlisted extra files", (t) => {
  const root = createResourceFixture(t);
  write(root, "tools/ace/ace.js", "tampered\n");
  write(root, "tools/ace/unlisted.bin", "extra\n");
  assert.throws(
    () => verifyPackagedResources({
      root,
      platform: "win32",
      source: false,
      releaseTier: "alpha",
      executeRuntimes: false,
    }),
    (error) => error instanceof ResourceGateError &&
      error.errors.some((item) => item.includes("SHA-256")) &&
      error.errors.some((item) => item.includes("漏列实际文件")),
  );
});

test("Ace gate rejects a self-refreshed stage manifest that no longer matches the tracked lock", (t) => {
  const root = createResourceFixture(t);
  const manifestPath = path.join(root, "tools", "ace", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.excluded = ["self-blessed stage metadata"];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.throws(
    () => verifyPackagedResources({
      root,
      platform: "win32",
      source: false,
      releaseTier: "alpha",
      executeRuntimes: false,
    }),
    (error) => error instanceof ResourceGateError &&
      error.errors.some((item) => item.includes("受版本控制固定 lock") &&
        item.includes("完整依赖闭包不一致")),
  );
});

test("Ace gate rejects a changed launcher even when the manifest hash is refreshed", (t) => {
  const root = createResourceFixture(t);
  const aceRoot = path.join(root, "tools", "ace");
  const target = path.join(aceRoot, "ace.js");
  fs.writeFileSync(target, 'require("./node_modules/@daisy/ace-cli/bin/ace.js");\n// changed\n');
  const manifestPath = path.join(aceRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const record = manifest.files.find((item) => item.path === "ace.js");
  record.size_bytes = fs.statSync(target).size;
  record.sha256 = sha256(target);
  manifest.total_bytes = manifest.files.reduce((sum, item) => sum + item.size_bytes, 0);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(
    () => verifyPackagedResources({
      root,
      platform: "win32",
      source: false,
      releaseTier: "alpha",
      executeRuntimes: false,
    }),
    (error) => error instanceof ResourceGateError &&
      error.errors.some((item) => item.includes("不是已审核的固定启动器")),
  );
});

test("Ace gate rejects a missing audited patch record", (t) => {
  const root = createResourceFixture(t);
  const manifestPath = path.join(root, "tools", "ace", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.patches = [];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(
    () => verifyPackagedResources({
      root,
      platform: "win32",
      source: false,
      releaseTier: "alpha",
      executeRuntimes: false,
    }),
    (error) => error instanceof ResourceGateError &&
      error.errors.some((item) => item.includes("必须且只能记录一个已审核安全补丁")),
  );
});

test("Ace gate rejects a missing package license file", (t) => {
  const root = createResourceFixture(t);
  fs.rmSync(
    path.join(root, "tools", "ace", "node_modules", "@daisy", "ace-cli", "LICENSE"),
  );
  assert.throws(
    () => verifyPackagedResources({
      root,
      platform: "win32",
      source: false,
      releaseTier: "alpha",
      executeRuntimes: false,
    }),
    (error) => error instanceof ResourceGateError &&
      error.errors.some((item) => item.includes("许可证文件缺失")),
  );
});

test("Ace gate rejects an empty package license file", (t) => {
  const root = createResourceFixture(t);
  fs.writeFileSync(
    path.join(root, "tools", "ace", "node_modules", "@daisy", "ace-cli", "LICENSE"),
    "",
  );
  assert.throws(
    () => verifyPackagedResources({
      root,
      platform: "win32",
      source: false,
      releaseTier: "alpha",
      executeRuntimes: false,
    }),
    (error) => error instanceof ResourceGateError &&
      error.errors.some((item) => item.includes("原始许可证文件为空")),
  );
});

test("Ace gate rejects a tampered generated license notice even if its manifest hash is refreshed", (t) => {
  const root = createResourceFixture(t);
  const aceRoot = path.join(root, "tools", "ace");
  const relative = "licenses/daisy__ace-axe-runner-puppeteer@1.4.6.txt";
  const target = path.join(aceRoot, ...relative.split("/"));
  fs.writeFileSync(target, "tampered metadata notice\n");
  const manifestPath = path.join(aceRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const record = manifest.files.find((item) => item.path === relative);
  record.size_bytes = fs.statSync(target).size;
  record.sha256 = sha256(target);
  manifest.total_bytes = manifest.files.reduce((sum, item) => sum + item.size_bytes, 0);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.throws(
    () => verifyPackagedResources({
      root,
      platform: "win32",
      source: false,
      releaseTier: "alpha",
      executeRuntimes: false,
    }),
    (error) => error instanceof ResourceGateError &&
      error.errors.some((item) => item.includes("生成许可证通知缺少审计字段")),
  );
});
