"use strict";

const crypto = require("crypto");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const semver = require("semver");
const { compareUtf16 } = require("./deterministic_compare");
const {
  macExecutableArches,
  resolveElectronDist,
  windowsExecutableArch,
} = require("./electron_dist");
const {
  MANIFEST_RELATIVE: EPUBCHECK_MANIFEST_RELATIVE,
  verifyDistribution: verifyEpubCheckDistribution,
} = require("./epubcheck_distribution");
const {
  manifestRelative: pythonRuntimeManifestRelative,
  verifyRuntime: verifyPythonRuntimeDistribution,
} = require("./python_runtime_manifest");
const {
  createIsolatedPythonEnvironment,
  isolatedPythonInvocation,
  pythonCoreInvocation,
} = require("../electron/python-invocation");
const {
  ACE_LAUNCHER_SHA256,
  verifyAceStageLock,
} = require("./stage_ace");

const LICENSE_FILE_PATTERN = /^(license|licence|copying|notice)([._-]|$)/i;
const GENERATED_LICENSE_URLS = Object.freeze({
  "MIT": "https://spdx.org/licenses/MIT.html",
  "Apache-2.0": "https://www.apache.org/licenses/LICENSE-2.0",
  "CC-BY-3.0": "https://creativecommons.org/licenses/by/3.0/legalcode",
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/legalcode",
});
const JRE_SCHEMA_VERSION = "1.0";
const JRE_FEATURE_VERSION = 21;
const JRE_JAVA_VERSION = "21.0.11";
const JRE_RUNTIME_VERSION = "21.0.11+10-LTS";
const JRE_IMPLEMENTOR_VERSION = "Temurin-21.0.11+10";
const JRE_DISTRIBUTION = "Temurin";
const JRE_VENDOR = "Eclipse Adoptium";
const JRE_MODULE_POLICY = "fixed-conservative-java-se";
const JRE_REQUESTED_MODULES = Object.freeze(["java.se", "jdk.unsupported", "jdk.xml.dom"]);
const EPUBCHECK_VERSION = "5.3.0";
const JAVA_INJECTION_ENV = new Set([
  "CLASSPATH",
  "JAVA_TOOL_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "_JAVA_OPTIONS",
]);
const EXPECTED_APP_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
).version;

function releaseTierForVersion(version) {
  if (typeof version !== "string" || semver.valid(version) === null) {
    throw new Error(`应用版本不是有效 semver：${String(version)}`);
  }
  return semver.prerelease(version) === null ? "sale" : "alpha";
}

class ResourceGateError extends Error {
  constructor(errors, report) {
    super(`打包资源门禁失败：\n- ${errors.join("\n- ")}`);
    this.name = "ResourceGateError";
    this.errors = errors;
    this.report = report;
  }
}

function statSafe(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function requireFile(root, relative, errors, checks) {
  const target = path.join(root, relative);
  const stat = statSafe(target);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
    errors.push(`缺少非空文件或文件不安全：${relative}`);
    return null;
  }
  checks.push({ type: "file", path: relative, size: stat.size });
  return target;
}

function requireDirectory(root, relative, errors, checks, { nonEmpty = false } = {}) {
  const target = path.join(root, relative);
  const stat = statSafe(target);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    errors.push(`缺少目录或目录不安全：${relative}`);
    return null;
  }
  if (nonEmpty && fs.readdirSync(target).length === 0) {
    errors.push(`目录为空：${relative}`);
    return null;
  }
  checks.push({ type: "directory", path: relative });
  return target;
}

function verifyCore(root, errors, checks) {
  for (const relative of [
    "python/oak_manuscript_core/__init__.py",
    "python/oak_manuscript_core/__main__.py",
    "python/oak_manuscript_core/project.py",
    "python/oak_manuscript_core/external.py",
  ]) {
    requireFile(root, relative, errors, checks);
  }
  requireFile(root, "config/standards.json", errors, checks);

  const packsDir = requireDirectory(root, "config/rule-packs", errors, checks, { nonEmpty: true });
  if (!packsDir) return;
  const packs = fs.readdirSync(packsDir)
    .filter((name) => /^oak-rules-[0-9].*\.json$/i.test(name))
    .sort(compareUtf16);
  if (packs.length === 0) {
    errors.push("config/rule-packs 中没有 oak-rules-*.json 规则包");
    return;
  }
  for (const name of packs) {
    const relative = `config/rule-packs/${name}`;
    const target = requireFile(root, relative, errors, checks);
    if (!target) continue;
    try {
      const pack = JSON.parse(fs.readFileSync(target, "utf8"));
      if (typeof pack.pack_name !== "string" || typeof pack.pack_version !== "string" ||
          !Array.isArray(pack.rules) || pack.rules.length === 0) {
        errors.push(`规则包结构非法：${relative}`);
      }
    } catch (error) {
      errors.push(`规则包 JSON 无法解析：${relative}（${error.message}）`);
    }
  }
}

function verifyEpubCheck(root, errors, checks) {
  try {
    const result = verifyEpubCheckDistribution(root);
    checks.push({
      type: "epubcheck-distribution",
      path: path.relative(root, result.distribution).split(path.sep).join("/"),
      manifest: path.relative(root, result.manifestTarget).split(path.sep).join("/"),
      version: result.manifest.tool.version,
      file_count: result.manifest.file_count,
      total_bytes: result.manifest.total_bytes,
      formal_provenance_audit_required: result.manifest.formal_provenance_audit_required,
    });
  } catch (error) {
    errors.push(`EpubCheck 固定分发门禁失败：${error.message}`);
  }
}

function verifyElectronDistribution(root, platform, arch, errors, checks) {
  const architectures = arch ? [arch] : platform === "darwin" ? ["x64", "arm64"] : ["x64"];
  for (const targetArch of architectures) {
    try {
      const result = resolveElectronDist({
        projectRoot: root,
        platform,
        arch: targetArch,
      });
      checks.push({
        type: "electron-dist",
        path: path.relative(root, result.dist).split(path.sep).join("/"),
        platform,
        arch: targetArch,
        version: result.version,
      });
    } catch (error) {
      errors.push(`Electron dist ${platform}-${targetArch} 不可用：${error.message}`);
    }
  }
}

const PYTHON_IDENTITY_PROBE = [
  "import json,sys",
  "print(json.dumps({'implementation':sys.implementation.name,'version_info':list(sys.version_info[:3]),'releaselevel':sys.version_info.releaselevel,'serial':sys.version_info.serial},sort_keys=True,separators=(',',':')))",
].join(";");

function probePythonRuntime(
  root,
  executable,
  label,
  errors,
  checks,
  { packaged = false, expectedRuntimeVersion = null } = {},
) {
  if (typeof expectedRuntimeVersion !== "string" ||
      !/^3\.[0-9]+\.[0-9]+$/.test(expectedRuntimeVersion)) {
    errors.push(`${label} 解释器身份探针缺少精确 CPython 版本`);
    return;
  }
  const env = createIsolatedPythonEnvironment(process.env, { packaged });
  const identityInvocation = isolatedPythonInvocation({
    executable,
    script: PYTHON_IDENTITY_PROBE,
    cwd: root,
  });
  const identityResult = spawnSync(
    identityInvocation.command,
    identityInvocation.args,
    {
      cwd: identityInvocation.cwd,
      env,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    },
  );
  let identity = null;
  if (!identityResult.error && identityResult.status === 0) {
    try {
      identity = JSON.parse(identityResult.stdout.trim());
    } catch {
      identity = null;
    }
  }
  const expectedVersionInfo = expectedRuntimeVersion.split(".").map(Number);
  if (identity?.implementation !== "cpython" ||
      JSON.stringify(identity?.version_info) !== JSON.stringify(expectedVersionInfo) ||
      identity?.releaselevel !== "final" || identity?.serial !== 0) {
    errors.push(
      `${label} 解释器身份探针失败：期望 CPython ${expectedRuntimeVersion} final；`
      + `status=${String(identityResult.status)}`
      + `；stdout=${identityResult.stdout?.trim() || "<empty>"}`
      + `；stderr=${identityResult.stderr?.trim() || identityResult.error?.message || "<empty>"}`,
    );
    return;
  }
  checks.push({
    type: "python-interpreter-identity-probe",
    path: label,
    implementation: "CPython",
    version: expectedRuntimeVersion,
    releaselevel: "final",
  });

  const invocation = pythonCoreInvocation({
    executable,
    coreDir: path.join(root, "python"),
    args: ["--version"],
  });
  const result = spawnSync(
    invocation.command,
    invocation.args,
    {
      cwd: invocation.cwd,
      env,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    },
  );
  const expected = `oak-manuscript-core ${EXPECTED_APP_VERSION}`;
  if (result.error || result.status !== 0 || result.stdout.trim() !== expected) {
    errors.push(
      `${label} 隔离探针失败：期望 ${expected}；status=${String(result.status)}`
      + `；stdout=${result.stdout?.trim() || "<empty>"}`
      + `；stderr=${result.stderr?.trim() || result.error?.message || "<empty>"}`,
    );
    return;
  }
  checks.push({ type: "python-runtime-probe", path: label, version: EXPECTED_APP_VERSION });
}

function jreLockRelative(platform, arch) {
  if (!/^[a-z0-9]+$/.test(platform || "") || !/^[a-z0-9]+$/.test(arch || "")) {
    throw new Error(`JRE 目标平台或架构非法：${String(platform)}-${String(arch)}`);
  }
  return `config/tool-manifests/jre-${platform}-${arch}.json`;
}

function verifyWindowsRuntime(root, errors, checks, { execute = true } = {}) {
  const startingErrorCount = errors.length;
  let verified = null;
  try {
    verified = verifyPythonRuntimeDistribution(root, {
      platform: "win32",
      arch: "x64",
      runtimeRelative: "python-runtime",
    });
    checks.push({
      type: "python-runtime-manifest",
      path: pythonRuntimeManifestRelative("win32", "x64"),
      runtime: "python-runtime",
      platform: "win32",
      arch: "x64",
      version: verified.manifest.runtime.version,
      file_count: verified.manifest.file_count,
      total_bytes: verified.manifest.total_bytes,
    });
  } catch (error) {
    errors.push(`Python 运行时固定清单门禁失败：${error.message}`);
  }
  const executable = verified?.entry || null;
  if (executable && errors.length === startingErrorCount) {
    try {
      const arch = windowsExecutableArch(executable);
      if (arch !== "x64") errors.push(`python-runtime/python.exe 必须为 x64 PE，实际 ${arch}`);
      else checks.push({ type: "python-runtime-arch", path: "python-runtime/python.exe", arch });
    } catch (error) {
      errors.push(`python-runtime/python.exe PE 校验失败：${error.message}`);
    }
    if (errors.length === startingErrorCount) {
      checks.push({
        type: "python-runtime",
        path: "python-runtime",
        platform: "win32",
        arch: "x64",
        version: verified.manifest.runtime.version,
      });
    }
    if (execute && errors.length === startingErrorCount) {
      probePythonRuntime(root, executable, "python-runtime/python.exe", errors, checks, {
        expectedRuntimeVersion: verified.manifest.runtime.version,
      });
    }
  }
  return errors.length === startingErrorCount && executable
    ? {
      executable,
      label: "python-runtime/python.exe",
      platform: "win32",
      arch: "x64",
      version: verified.manifest.runtime.version,
    }
    : null;
}

function verifyMacRuntimes(root, arch, errors, checks, { execute = true, source = true } = {}) {
  const verifiedRuntimes = [];
  if (execute && process.platform !== "darwin") {
    errors.push(`macOS 资源门禁只能在 darwin 主机执行；当前为 ${process.platform}`);
  }
  if (!source && !arch) {
    errors.push("macOS 打包后资源门禁必须明确指定 --arch x64 或 --arch arm64");
    return verifiedRuntimes;
  }
  const architectures = arch ? [arch] : ["x64", "arm64"];
  for (const targetArch of architectures) {
    const startingErrorCount = errors.length;
    const runtime = source ? `python-runtime-macos-${targetArch}` : "python-runtime";
    let verified = null;
    try {
      verified = verifyPythonRuntimeDistribution(root, {
        platform: "darwin",
        arch: targetArch,
        runtimeRelative: runtime,
      });
      checks.push({
        type: "python-runtime-manifest",
        path: pythonRuntimeManifestRelative("darwin", targetArch),
        runtime,
        platform: "darwin",
        arch: targetArch,
        version: verified.manifest.runtime.version,
        file_count: verified.manifest.file_count,
        total_bytes: verified.manifest.total_bytes,
      });
    } catch (error) {
      errors.push(`Python 运行时固定清单门禁失败：${error.message}`);
    }
    const executable = verified?.entry || null;
    if (executable && errors.length === startingErrorCount) {
      try {
        const arches = macExecutableArches(executable);
        if (!arches.has(targetArch)) {
          errors.push(`${runtime}/bin/python3 不含目标架构 ${targetArch}`);
        } else {
          checks.push({ type: "python-runtime-arch", path: `${runtime}/bin/python3`, arch: targetArch });
        }
      } catch (error) {
        errors.push(`${runtime}/bin/python3 Mach-O 校验失败：${error.message}`);
      }
      if (execute && process.platform === "darwin") {
        probePythonRuntime(root, executable, `${runtime}/bin/python3`, errors, checks, {
          expectedRuntimeVersion: verified.manifest.runtime.version,
        });
      }
    }
    if (errors.length === startingErrorCount && executable) {
      checks.push({
        type: "python-runtime",
        path: runtime,
        platform: "darwin",
        arch: targetArch,
        version: verified.manifest.runtime.version,
      });
      verifiedRuntimes.push({
        executable,
        label: `${runtime}/bin/python3`,
        platform: "darwin",
        arch: targetArch,
        version: verified.manifest.runtime.version,
      });
    }
  }
  return verifiedRuntimes;
}

function sha256File(target) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(target));
  return hash.digest("hex");
}

function cleanJavaEnvironment(source = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (!JAVA_INJECTION_ENV.has(key.toUpperCase())) result[key] = value;
  }
  return result;
}

function listJreFiles(root, errors, label) {
  const result = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf16(left.name, right.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        errors.push(`${label} 不得含符号链接：${relative}`);
      } else if (stat.isDirectory()) {
        visit(target);
      } else if (stat.isFile()) {
        result.push({ path: relative, size_bytes: stat.size, target });
      } else {
        errors.push(`${label} 含不支持的文件类型：${relative}`);
      }
    }
  }
  visit(root);
  return result.sort((left, right) => compareUtf16(left.path, right.path));
}

function probeJreEpubCheck(root, executable, manifest, label, errors, checks) {
  const probe = manifest.epubcheck_probe;
  const jar = path.join(root, "tools", `epubcheck-${EPUBCHECK_VERSION}`, "epubcheck.jar");
  const sampleRelative = manifestPath(probe?.sample, `${label} epubcheck_probe.sample`, errors);
  const defectRelative = manifestPath(
    probe?.defect_sample,
    `${label} epubcheck_probe.defect_sample`,
    errors,
  );
  if (!sampleRelative || !defectRelative) return;
  const sample = path.join(root, ...sampleRelative.split("/"));
  const defectSample = path.join(root, ...defectRelative.split("/"));
  if (!fs.statSync(jar, { throwIfNoEntry: false })?.isFile() ||
      !fs.statSync(sample, { throwIfNoEntry: false })?.isFile() ||
      !fs.statSync(defectSample, { throwIfNoEntry: false })?.isFile()) {
    errors.push(`${label} 实际探针缺少 EpubCheck JAR、通过样本或缺陷样本`);
    return;
  }

  const probeRoot = path.join(__dirname, "..", "out", "resource-probes");
  fs.mkdirSync(probeRoot, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join(probeRoot, "jre-"));
  try {
    const cases = [
      {
        name: "good",
        sample,
        expectedStatus: 0,
        expectedFatal: probe.n_fatal,
        expectedError: probe.n_error,
        expectedWarning: probe.n_warning,
        expectErrors: false,
      },
      {
        name: "defect",
        sample: defectSample,
        expectedStatus: probe.defect?.status,
        expectedFatal: probe.defect?.n_fatal,
        expectedError: probe.defect?.n_error,
        expectedWarning: probe.defect?.n_warning,
        expectErrors: true,
      },
    ];
    for (const item of cases) {
      const report = path.join(runRoot, `${item.name}.json`);
      const result = spawnSync(
        executable,
        ["-jar", jar, "--json", report, item.sample],
        {
          cwd: root,
          env: cleanJavaEnvironment(),
          encoding: "utf8",
          timeout: 120000,
          windowsHide: true,
          shell: false,
        },
      );
      let checker = null;
      try {
        checker = JSON.parse(fs.readFileSync(report, "utf8"))?.checker || null;
      } catch {
        checker = null;
      }
      const hasErrors = checker && Number.isInteger(checker.nFatal) &&
        Number.isInteger(checker.nError) && checker.nFatal + checker.nError > 0;
      if (result.error || result.status !== item.expectedStatus || !checker ||
          checker.checkerVersion !== EPUBCHECK_VERSION ||
          checker.nFatal !== item.expectedFatal || checker.nError !== item.expectedError ||
          checker.nWarning !== item.expectedWarning || hasErrors !== item.expectErrors) {
        errors.push(
          `${label} EpubCheck ${item.name} 实际探针失败：status=${String(result.status)}`
          + `；checker=${JSON.stringify(checker)}`
          + `；stderr=${result.stderr?.trim() || result.error?.message || "<empty>"}`,
        );
        return;
      }
    }
    checks.push({
      type: "jre-epubcheck-probe-matrix",
      path: label,
      java_feature: JRE_FEATURE_VERSION,
      epubcheck_version: EPUBCHECK_VERSION,
      good_status: 0,
      defect_status: probe.defect.status,
      defect_errors: probe.defect.n_fatal + probe.defect.n_error,
    });
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
}

function verifyJreRuntime(
  root,
  relative,
  expectedPlatform,
  expectedArch,
  errors,
  checks,
  { execute = true } = {},
) {
  const startingErrorCount = errors.length;
  const label = relative.split(path.sep).join("/");
  const runtimeRoot = requireDirectory(root, label, errors, checks, { nonEmpty: true });
  if (!runtimeRoot) return;
  const manifestTarget = requireFile(root, `${label}/manifest.json`, errors, checks);
  const expectedEntry = expectedPlatform === "win32" ? "bin/java.exe" : "bin/java";
  const executable = requireFile(root, `${label}/${expectedEntry}`, errors, checks);
  if (!manifestTarget || !executable) return;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestTarget, "utf8"));
  } catch (error) {
    errors.push(`${label}/manifest.json 无法解析：${error.message}`);
    return;
  }
  const runtimeManifestHash = sha256File(manifestTarget);
  const lockRelative = jreLockRelative(expectedPlatform, expectedArch);
  const lockTarget = requireFile(root, lockRelative, errors, checks);
  let runtimeLock = null;
  if (lockTarget) {
    try {
      runtimeLock = JSON.parse(fs.readFileSync(lockTarget, "utf8"));
    } catch (error) {
      errors.push(`${lockRelative} 无法解析：${error.message}`);
    }
  }
  const runtime = manifest.runtime || {};
  const target = manifest.target || {};
  if (manifest.schema_version !== JRE_SCHEMA_VERSION || manifest.entry !== expectedEntry ||
      runtime.distribution !== JRE_DISTRIBUTION || runtime.vendor !== JRE_VENDOR ||
      runtime.implementor_version !== JRE_IMPLEMENTOR_VERSION ||
      runtime.java_version !== JRE_JAVA_VERSION ||
      runtime.java_runtime_version !== JRE_RUNTIME_VERSION ||
      runtime.feature_version !== JRE_FEATURE_VERSION || target.platform !== expectedPlatform ||
      target.arch !== expectedArch) {
    errors.push(`${label} manifest 的 schema、运行时、入口或目标平台不匹配`);
  }
  if (runtimeLock) {
    const lockedRuntime = runtimeLock.runtime || {};
    const lockedSource = runtimeLock.source_jdk || {};
    const hashFields = [
      "release_sha256",
      "java_sha256",
      "jdeps_sha256",
      "jlink_sha256",
      "tree_sha256",
    ];
    if (runtimeLock.schema_version !== "1.0" || runtimeLock.lock_type !== "oak-jre-runtime" ||
        runtimeLock.target?.platform !== expectedPlatform ||
        runtimeLock.target?.arch !== expectedArch ||
        runtimeLock.runtime_manifest_sha256 !== runtimeManifestHash ||
        runtimeLock.formal_source_provenance_audit_required !== true ||
        lockedRuntime.distribution !== JRE_DISTRIBUTION || lockedRuntime.vendor !== JRE_VENDOR ||
        lockedRuntime.implementor_version !== JRE_IMPLEMENTOR_VERSION ||
        lockedRuntime.java_version !== JRE_JAVA_VERSION ||
        lockedRuntime.java_runtime_version !== JRE_RUNTIME_VERSION ||
        lockedRuntime.feature_version !== JRE_FEATURE_VERSION ||
        hashFields.some((field) => typeof lockedSource[field] !== "string" ||
          !/^[a-f0-9]{64}$/.test(lockedSource[field])) ||
        !Number.isSafeInteger(lockedSource.tree_file_count) || lockedSource.tree_file_count <= 0 ||
        !Number.isSafeInteger(lockedSource.tree_total_bytes) || lockedSource.tree_total_bytes <= 0) {
      errors.push(`${lockRelative} 与 JRE manifest、平台或固定源 JDK 不一致`);
    }
  }
  for (const [field, value] of [["modules", manifest.modules], ["jdeps_modules", manifest.jdeps_modules]]) {
    if (!Array.isArray(value) || value.length === 0 ||
        value.some((item) => typeof item !== "string" ||
          !/^(?:java|jdk)\.[a-zA-Z0-9_.]+$/.test(item)) ||
        JSON.stringify(value) !== JSON.stringify([...new Set(value)].sort(compareUtf16))) {
      errors.push(`${label} manifest.${field} 必须是排序、去重的 JDK 模块数组`);
    }
  }
  if (manifest.module_policy !== JRE_MODULE_POLICY ||
      JSON.stringify(manifest.requested_modules) !== JSON.stringify(JRE_REQUESTED_MODULES) ||
      !Array.isArray(manifest.modules) ||
      JRE_REQUESTED_MODULES.some((item) => !manifest.modules.includes(item))) {
    errors.push(`${label} 未采用固定保守 Java SE 模块策略`);
  }
  if (Array.isArray(manifest.jdeps_modules) && Array.isArray(manifest.modules) &&
      manifest.jdeps_modules.some((item) => !manifest.modules.includes(item))) {
    errors.push(`${label} manifest.modules 未覆盖全部 jdeps_modules`);
  }

  const actualFiles = listJreFiles(runtimeRoot, errors, label)
    .filter((item) => item.path !== "manifest.json");
  const actualByPath = new Map(actualFiles.map((item) => [item.path, item]));
  const listedByPath = new Map();
  if (!Array.isArray(manifest.files)) {
    errors.push(`${label} manifest.files 必须是数组`);
  } else {
    for (const [index, item] of manifest.files.entries()) {
      const itemPath = manifestPath(item?.path, `${label} manifest.files[${index}].path`, errors);
      if (!itemPath) continue;
      if (listedByPath.has(itemPath) || !Number.isSafeInteger(item.size_bytes) ||
          item.size_bytes < 0 || typeof item.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/i.test(item.sha256)) {
        errors.push(`${label} manifest 文件记录非法或重复：${itemPath}`);
        continue;
      }
      listedByPath.set(itemPath, item);
    }
  }
  for (const item of actualFiles) {
    const listed = listedByPath.get(item.path);
    if (!listed) errors.push(`${label} manifest 漏列实际文件：${item.path}`);
    else if (listed.size_bytes !== item.size_bytes ||
        listed.sha256.toLowerCase() !== sha256File(item.target)) {
      errors.push(`${label} 文件 SHA-256 或大小与 manifest 不一致：${item.path}`);
    }
  }
  for (const itemPath of listedByPath.keys()) {
    if (!actualByPath.has(itemPath)) errors.push(`${label} manifest 列出不存在文件：${itemPath}`);
  }
  const totalBytes = actualFiles.reduce((sum, item) => sum + item.size_bytes, 0);
  if (manifest.file_count !== actualFiles.length || manifest.file_count !== listedByPath.size ||
      manifest.total_bytes !== totalBytes) {
    errors.push(`${label} manifest 的文件数或总字节数不一致`);
  }

  const expectedLicenses = [
    "NOTICE",
    "SOURCE_JDK_RELEASE.txt",
    "THIRD_PARTY_NOTICES.md",
    ...actualFiles.map((item) => item.path).filter((item) => item.startsWith("legal/")),
  ].sort(compareUtf16);
  if (!Array.isArray(manifest.license_materials) ||
      JSON.stringify(manifest.license_materials) !== JSON.stringify(expectedLicenses) ||
      manifest.license_materials.some((item) => !listedByPath.has(item)) ||
      !manifest.license_materials.includes("legal/java.base/LICENSE")) {
    errors.push(`${label} 缺少完整且已哈希的 Temurin 许可证材料清单`);
  }
  if (Array.isArray(manifest.modules)) {
    for (const moduleName of manifest.modules) {
      if (!actualFiles.some((item) => item.path.startsWith(`legal/${moduleName}/`))) {
        errors.push(`${label} 模块 ${moduleName} 缺少 jlink legal/ 材料`);
      }
    }
  }
  const source = manifest.source_jdk || {};
  for (const [fileField, hashField] of [
    ["release_file", "release_sha256"],
    ["notice_file", "notice_sha256"],
  ]) {
    const itemPath = manifestPath(source[fileField], `${label} source_jdk.${fileField}`, errors);
    const actual = itemPath ? actualByPath.get(itemPath) : null;
    if (!actual || source[hashField] !== sha256File(actual.target)) {
      errors.push(`${label} source_jdk.${hashField} 与材料不一致`);
    }
  }
  if (runtimeLock && runtimeLock.source_jdk?.release_sha256 !== source.release_sha256) {
    errors.push(`${lockRelative} 的源 JDK release 哈希与 JRE manifest 不一致`);
  }

  const probe = manifest.epubcheck_probe || {};
  const jar = path.join(root, "tools", `epubcheck-${EPUBCHECK_VERSION}`, "epubcheck.jar");
  const jarStat = fs.statSync(jar, { throwIfNoEntry: false });
  const actualJarHash = jarStat?.isFile() ? sha256File(jar) : null;
  const distributionManifest = path.join(root, ...EPUBCHECK_MANIFEST_RELATIVE.split("/"));
  const distributionManifestStat = fs.statSync(distributionManifest, { throwIfNoEntry: false });
  const actualDistributionManifestHash = distributionManifestStat?.isFile()
    ? sha256File(distributionManifest)
    : null;
  const samplePath = manifestPath(probe.sample, `${label} epubcheck_probe.sample`, errors);
  const sample = samplePath ? path.join(root, ...samplePath.split("/")) : null;
  const defectSamplePath = manifestPath(
    probe.defect_sample,
    `${label} epubcheck_probe.defect_sample`,
    errors,
  );
  const defectSample = defectSamplePath
    ? path.join(root, ...defectSamplePath.split("/"))
    : null;
  const defect = probe.defect || {};
  if (probe.version !== EPUBCHECK_VERSION || probe.checker_version !== EPUBCHECK_VERSION ||
      probe.n_fatal !== 0 || probe.n_error !== 0 ||
      probe.jar_sha256 !== actualJarHash ||
      probe.distribution_manifest !== EPUBCHECK_MANIFEST_RELATIVE ||
      probe.distribution_manifest_sha256 !== actualDistributionManifestHash ||
      !sample || !fs.statSync(sample, { throwIfNoEntry: false })?.isFile() ||
      probe.sample_sha256 !== (sample ? sha256File(sample) : null) ||
      !defectSample || !fs.statSync(defectSample, { throwIfNoEntry: false })?.isFile() ||
      probe.defect_sample_sha256 !== (defectSample ? sha256File(defectSample) : null) ||
      defect.status !== 1 || defect.checker_version !== EPUBCHECK_VERSION ||
      !Number.isInteger(defect.n_fatal) || defect.n_fatal < 0 ||
      !Number.isInteger(defect.n_error) || defect.n_error < 0 ||
      defect.n_fatal + defect.n_error < 1 ||
      !Number.isInteger(defect.n_warning) || defect.n_warning < 0) {
    errors.push(`${label} EpubCheck 阶段探针矩阵、JAR 或样本哈希不匹配`);
  }
  if (runtimeLock &&
      runtimeLock.epubcheck_distribution_manifest_sha256 !== actualDistributionManifestHash) {
    errors.push(`${lockRelative} 未锁定当前 EpubCheck 全分发清单`);
  }

  try {
    if (expectedPlatform === "win32") {
      const actualArch = windowsExecutableArch(executable);
      if (actualArch !== expectedArch) errors.push(`${label}/${expectedEntry} 架构应为 ${expectedArch}，实际 ${actualArch}`);
    } else {
      const arches = macExecutableArches(executable);
      if (!arches.has(expectedArch)) errors.push(`${label}/${expectedEntry} 不含 ${expectedArch} Mach-O 架构`);
    }
  } catch (error) {
    errors.push(`${label}/${expectedEntry} 可执行文件架构校验失败：${error.message}`);
  }
  if (errors.length === startingErrorCount) {
    checks.push({
      type: "jre-runtime",
      path: label,
      platform: expectedPlatform,
      arch: expectedArch,
      java_version: runtime.java_version || null,
      module_count: Array.isArray(manifest.modules) ? manifest.modules.length : 0,
      file_count: actualFiles.length,
      total_bytes: totalBytes,
    });
  }
  if (execute && process.platform === expectedPlatform && errors.length === startingErrorCount) {
    probeJreEpubCheck(root, executable, manifest, label, errors, checks);
  }
  return errors.length === startingErrorCount
    ? { executable, manifest, label, platform: expectedPlatform, arch: expectedArch }
    : null;
}

function manifestPath(value, label, errors) {
  if (typeof value !== "string" || value === "" || value.includes("\\") ||
      path.posix.isAbsolute(value)) {
    errors.push(`${label} 不是安全的相对 POSIX 路径：${String(value)}`);
    return null;
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized.startsWith("../")) {
    errors.push(`${label} 包含路径逃逸或非规范片段：${value}`);
    return null;
  }
  return normalized;
}

function listStageFiles(root, errors) {
  const result = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf16(left.name, right.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        errors.push(`Ace 阶段包不得含符号链接：tools/ace/${relative}`);
      } else if (stat.isDirectory()) {
        visit(target);
      } else if (stat.isFile()) {
        result.push({ path: relative, size_bytes: stat.size, target });
      } else {
        errors.push(`Ace 阶段包含不支持的文件类型：tools/ace/${relative}`);
      }
    }
  }
  visit(root);
  return result.sort((left, right) => compareUtf16(left.path, right.path));
}

function isForbiddenAcePath(relative) {
  const value = relative.toLowerCase();
  const forbiddenPackage = [
    /(^|\/)node_modules\/@daisy\/ace(\/|$)/,
    /(^|\/)node_modules\/@daisy\/ace-axe-runner-electron(\/|$)/,
    /(^|\/)node_modules\/electron(\/|$)/,
  ].some((pattern) => pattern.test(value));
  const browserPayload =
    /(^|\/)(\.local-chromium|chrome-(win|linux|mac)[^/]*|chromium)(\/|$)/.test(value) ||
    /(^|\/)(chrome|chromium|electron|chrome-headless-shell)(\.exe)?$/.test(value);
  return forbiddenPackage || browserPayload;
}

function productionRequirements(packageJson) {
  const requests = new Map();
  const add = (record, optional) => {
    for (const name of Object.keys(record || {})) {
      const current = requests.get(name);
      requests.set(name, Boolean(optional && (current === undefined || current)));
    }
  };
  add(packageJson.dependencies, false);
  add(packageJson.optionalDependencies, true);
  for (const name of packageJson.bundleDependencies || packageJson.bundledDependencies || []) {
    requests.set(name, false);
  }
  for (const [name] of Object.entries(packageJson.peerDependencies || {})) {
    add({ [name]: true }, Boolean(packageJson.peerDependenciesMeta?.[name]?.optional));
  }
  return requests;
}

function verifyAceStage(root, errors, checks, { releaseTier, blockers }) {
  const aceRoot = requireDirectory(root, "tools/ace", errors, checks, { nonEmpty: true });
  if (!aceRoot) return;

  const entryTarget = requireFile(root, "tools/ace/ace.js", errors, checks);
  const manifestTarget = requireFile(root, "tools/ace/manifest.json", errors, checks);
  const noticesMarkdownTarget = requireFile(
    root,
    "tools/ace/THIRD_PARTY_NOTICES.md",
    errors,
    checks,
  );
  const noticesJsonTarget = requireFile(
    root,
    "tools/ace/THIRD_PARTY_NOTICES.json",
    errors,
    checks,
  );
  const packageTarget = requireFile(
    root,
    "tools/ace/node_modules/@daisy/ace-cli/package.json",
    errors,
    checks,
  );
  if (!entryTarget || !manifestTarget || !noticesMarkdownTarget ||
      !noticesJsonTarget || !packageTarget) return;
  if (sha256File(entryTarget) !== ACE_LAUNCHER_SHA256) {
    errors.push("tools/ace/ace.js 不是已审核的固定启动器");
  }

  let manifest;
  let rootPackage;
  let thirdPartyNotice;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestTarget, "utf8"));
  } catch (error) {
    errors.push(`Ace manifest.json 无法解析（${error.message}）`);
    return;
  }
  try {
    rootPackage = JSON.parse(fs.readFileSync(packageTarget, "utf8"));
  } catch (error) {
    errors.push(`@daisy/ace-cli package.json 无法解析（${error.message}）`);
    return;
  }
  try {
    thirdPartyNotice = JSON.parse(fs.readFileSync(noticesJsonTarget, "utf8"));
  } catch (error) {
    errors.push(`THIRD_PARTY_NOTICES.json 无法解析（${error.message}）`);
    return;
  }

  try {
    const lock = verifyAceStageLock(root, manifest, manifestTarget);
    checks.push({
      type: "ace-stage-lock",
      path: lock.lockRelative,
      sha256: lock.lockSha256,
      stage_manifest_sha256: lock.lock.stage_manifest_sha256,
      package_count: lock.lock.package_count,
      file_count: lock.lock.file_count,
      total_bytes: lock.lock.total_bytes,
      version: lock.lock.tool.version,
    });
  } catch (error) {
    errors.push(`Ace 受版本控制固定 lock 门禁失败：${error.message}`);
  }

  if (manifest.schema_version !== "1.0") {
    errors.push(`Ace manifest schema_version 必须为 1.0：${String(manifest.schema_version)}`);
  }
  if (manifest.entry !== "ace.js") {
    errors.push(`Ace manifest entry 必须为 ace.js：${String(manifest.entry)}`);
  }
  if (manifest.root_package?.name !== "@daisy/ace-cli" ||
      typeof manifest.root_package?.version !== "string" ||
      manifest.root_package.version === "") {
    errors.push("Ace manifest root_package 必须是带版本的 @daisy/ace-cli");
  }
  if (rootPackage.name !== "@daisy/ace-cli" || rootPackage.version !== manifest.root_package?.version) {
    errors.push("Ace 根包 package.json 与 manifest.root_package 不一致");
  }
  if (manifest.third_party_notices?.markdown !== "THIRD_PARTY_NOTICES.md" ||
      manifest.third_party_notices?.json !== "THIRD_PARTY_NOTICES.json") {
    errors.push("Ace manifest 未固定 THIRD_PARTY_NOTICES.md/json 路径");
  }

  const actualFiles = listStageFiles(aceRoot, errors)
    .filter((file) => file.path !== "manifest.json");
  const actualByPath = new Map(actualFiles.map((file) => [file.path, file]));
  const listedByPath = new Map();
  if (!Array.isArray(manifest.files)) {
    errors.push("Ace manifest files 必须是数组");
  } else {
    for (const [index, file] of manifest.files.entries()) {
      const relative = manifestPath(file?.path, `manifest.files[${index}].path`, errors);
      if (!relative) continue;
      if (listedByPath.has(relative)) {
        errors.push(`Ace manifest 重复列出文件：${relative}`);
        continue;
      }
      if (!Number.isSafeInteger(file.size_bytes) || file.size_bytes < 0 ||
          typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
        errors.push(`Ace manifest 文件元数据非法：${relative}`);
        continue;
      }
      listedByPath.set(relative, file);
    }
  }

  for (const file of actualFiles) {
    if (isForbiddenAcePath(file.path)) {
      errors.push(`Ace 阶段包包含禁止的聚合包、Electron 或浏览器载荷：${file.path}`);
    }
    const listed = listedByPath.get(file.path);
    if (!listed) {
      errors.push(`Ace manifest 漏列实际文件：${file.path}`);
      continue;
    }
    if (listed.size_bytes !== file.size_bytes) {
      errors.push(`Ace 文件大小与 manifest 不一致：${file.path}`);
    }
    if (listed.sha256.toLowerCase() !== sha256File(file.target)) {
      errors.push(`Ace 文件 SHA-256 与 manifest 不一致：${file.path}`);
    }
  }
  for (const relative of listedByPath.keys()) {
    if (!actualByPath.has(relative)) errors.push(`Ace manifest 列出不存在的文件：${relative}`);
  }

  if (manifest.file_count !== actualFiles.length || manifest.file_count !== listedByPath.size) {
    errors.push("Ace manifest file_count 与全量文件数不一致");
  }
  const totalBytes = actualFiles.reduce((sum, file) => sum + file.size_bytes, 0);
  if (manifest.total_bytes !== totalBytes) {
    errors.push("Ace manifest total_bytes 与实际总字节数不一致");
  }

  const forbiddenPackages = new Set([
    "@daisy/ace",
    "@daisy/ace-axe-runner-electron",
    "electron",
  ]);
  const packageRecords = new Map();
  const expectedAuditRecords = [];
  if (!Array.isArray(manifest.packages)) {
    errors.push("Ace manifest packages 必须是数组");
  } else {
    if (manifest.package_count !== manifest.packages.length) {
      errors.push("Ace manifest package_count 与 packages 数量不一致");
    }
    for (const [index, item] of manifest.packages.entries()) {
      const label = `manifest.packages[${index}]`;
      const packagePath = manifestPath(item?.path, `${label}.path`, errors);
      if (forbiddenPackages.has(item?.name)) {
        errors.push(`Ace 阶段包包含禁止依赖：${String(item.name)}`);
      }
      if (typeof item?.name !== "string" || typeof item?.version !== "string" ||
          item.version === "") {
        errors.push(`${label} 缺少有效 name/version`);
      }
      if (typeof item?.license !== "string" || item.license.trim() === "" ||
          item.license.toUpperCase() === "UNKNOWN") {
        errors.push(`${label} 缺少可识别许可证：${String(item?.name)}`);
      }
      if (!packagePath || !packagePath.startsWith("node_modules/")) {
        errors.push(`${label} 包路径必须位于 node_modules`);
        continue;
      }
      if (packageRecords.has(packagePath)) {
        errors.push(`Ace manifest 重复列出包路径：${packagePath}`);
        continue;
      }

      const packageJsonPath = `${packagePath}/package.json`;
      let packageJson = null;
      if (!actualByPath.has(packageJsonPath) || !listedByPath.has(packageJsonPath)) {
        errors.push(`${label} 缺少已校验的 package.json：${packageJsonPath}`);
      } else {
        try {
          packageJson = JSON.parse(
            fs.readFileSync(path.join(aceRoot, ...packageJsonPath.split("/")), "utf8"),
          );
          if (packageJson.name !== item.name || packageJson.version !== item.version) {
            errors.push(`${label} 与实际 package.json 的 name/version 不一致`);
          }
        } catch (error) {
          errors.push(`${label} package.json 无法解析（${error.message}）`);
        }
      }
      packageRecords.set(packagePath, { item, label, packageJson });

      const licenseFiles = Array.isArray(item.license_files) ? item.license_files : null;
      const noticeFiles = Array.isArray(item.license_notice_files)
        ? item.license_notice_files
        : null;
      if (!licenseFiles || !noticeFiles) {
        errors.push(`${label} 必须同时声明 license_files 与 license_notice_files 数组`);
        continue;
      }
      const canonicalUrl = GENERATED_LICENSE_URLS[item.license] || null;
      if (item.license_url !== canonicalUrl) {
        errors.push(`${label}.license_url 与声明许可证不一致`);
      }
      if (item.license_source === "package-file") {
        if (licenseFiles.length === 0 || noticeFiles.length !== 0) {
          errors.push(`${label} 的原始许可证材料与生成通知必须互斥`);
        }
        for (const [licenseIndex, license] of licenseFiles.entries()) {
          const relativeLicense = manifestPath(
            license,
            `${label}.license_files[${licenseIndex}]`,
            errors,
          );
          if (!relativeLicense) continue;
          if (!LICENSE_FILE_PATTERN.test(path.posix.basename(relativeLicense))) {
            errors.push(`${label} 的 license_files 含非许可证材料：${relativeLicense}`);
          }
          const fullLicensePath = `${packagePath}/${relativeLicense}`;
          if (!actualByPath.has(fullLicensePath) || !listedByPath.has(fullLicensePath)) {
            errors.push(`${label} 的原始许可证文件缺失或未纳入哈希：${fullLicensePath}`);
          } else if (actualByPath.get(fullLicensePath).size_bytes <= 0 ||
              listedByPath.get(fullLicensePath).size_bytes <= 0) {
            errors.push(`${label} 的原始许可证文件为空：${fullLicensePath}`);
          }
        }
      } else if (item.license_source === "generated-metadata-notice") {
        if (licenseFiles.length !== 0 || noticeFiles.length !== 1) {
          errors.push(`${label} 的原始许可证材料与生成通知必须互斥且通知唯一`);
        }
        if (!canonicalUrl) {
          errors.push(`${label} 的声明许可证不允许生成元数据通知：${item.license}`);
        }
        for (const [noticeIndex, notice] of noticeFiles.entries()) {
          const relativeNotice = manifestPath(
            notice,
            `${label}.license_notice_files[${noticeIndex}]`,
            errors,
          );
          if (!relativeNotice) continue;
          if (!relativeNotice.startsWith("licenses/") ||
              !relativeNotice.toLowerCase().endsWith(".txt")) {
            errors.push(`${label} 的生成许可证通知路径非法：${relativeNotice}`);
          }
          if (!actualByPath.has(relativeNotice) || !listedByPath.has(relativeNotice)) {
            errors.push(`${label} 的许可证通知缺失或未纳入哈希：${relativeNotice}`);
            continue;
          }
          const content = fs.readFileSync(
            path.join(aceRoot, ...relativeNotice.split("/")),
            "utf8",
          );
          for (const marker of [
            "It is not an original license file and does not assert any copyright holder.",
            `Package: ${item.name}`,
            `Version: ${item.version}`,
            `Declared license expression: ${item.license}`,
            `Canonical license reference: ${canonicalUrl}`,
            "Formal license audit required: true",
          ]) {
            if (!content.includes(marker)) {
              errors.push(`${label} 的生成许可证通知缺少审计字段：${marker}`);
            }
          }
          if (content.split(/\r?\n/).some((line) => /^\s*copyright\b/i.test(line))) {
            errors.push(`${label} 的生成许可证通知不得伪造 Copyright 声明`);
          }
        }
        expectedAuditRecords.push({
          name: item.name,
          version: item.version,
          license: item.license,
          path: packagePath,
          license_notice: noticeFiles[0],
        });
      } else {
        errors.push(`${label}.license_source 非法：${String(item.license_source)}`);
      }
    }

    for (const [packagePath, record] of packageRecords) {
      const { item, label, packageJson } = record;
      if (!packageJson) continue;
      const mappedDependencies = item.dependencies;
      if (!mappedDependencies || typeof mappedDependencies !== "object" ||
          Array.isArray(mappedDependencies)) {
        errors.push(`${label}.dependencies 必须是对象`);
        continue;
      }
      const missingOptional = new Set(
        Array.isArray(item.missing_optional_dependencies)
          ? item.missing_optional_dependencies
          : [],
      );
      const requirements = productionRequirements(packageJson);
      for (const [name, optional] of requirements) {
        if (Object.hasOwn(mappedDependencies, name)) continue;
        if (!optional || !missingOptional.has(name)) {
          errors.push(`${label} 的生产依赖闭包缺少：${name}`);
        }
      }
      for (const name of Object.keys(mappedDependencies)) {
        if (!requirements.has(name)) {
          errors.push(`${label}.dependencies 含未声明生产依赖：${name}`);
        }
        const dependency = mappedDependencies[name];
        const sourcePath = manifestPath(
          dependency?.source_path,
          `${label}.dependencies[${name}].source_path`,
          errors,
        );
        if (!sourcePath) continue;
        const targetPath = `node_modules/${sourcePath}`;
        const target = packageRecords.get(targetPath);
        if (!target || target.item.name !== dependency.name ||
            target.item.version !== dependency.version) {
          errors.push(`${label} 的依赖解析记录无对应包：${name} -> ${targetPath}`);
        }
        if (forbiddenPackages.has(dependency?.name)) {
          errors.push(`${label} 的依赖闭包含禁止包：${dependency.name}`);
        }
      }
      for (const name of missingOptional) {
        if (requirements.get(name) !== true) {
          errors.push(`${label}.missing_optional_dependencies 含非可选依赖：${name}`);
        }
      }
      record.packagePath = packagePath;
    }

    const rootPath = "node_modules/@daisy/ace-cli";
    if (!packageRecords.has(rootPath)) {
      errors.push(`Ace 生产依赖闭包缺少根包：${rootPath}`);
    } else {
      const reached = new Set();
      const queue = [rootPath];
      while (queue.length > 0) {
        const currentPath = queue.shift();
        if (reached.has(currentPath)) continue;
        reached.add(currentPath);
        const current = packageRecords.get(currentPath);
        if (!current) continue;
        for (const dependency of Object.values(current.item.dependencies || {})) {
          if (typeof dependency?.source_path === "string") {
            queue.push(`node_modules/${dependency.source_path}`);
          }
        }
      }
      for (const packagePath of packageRecords.keys()) {
        if (!reached.has(packagePath)) {
          errors.push(`Ace manifest 含根包不可达的多余依赖：${packagePath}`);
        }
      }
    }
  }

  const auditRequired = expectedAuditRecords.length > 0;
  if (auditRequired) {
    blockers.push({
      code: "FORMAL_LICENSE_AUDIT_REQUIRED",
      message: "生成的许可证元数据通知不能替代正式售卖所需的原始许可证审计",
      package_count: expectedAuditRecords.length,
      packages: expectedAuditRecords.map((item) => `${item.name}@${item.version}`),
    });
    if (releaseTier === "sale") {
      errors.push("sale 门禁失败：Ace 依赖仍有 formal_license_audit_required 阻断项");
    }
  }
  if (manifest.formal_license_audit_required !== auditRequired) {
    errors.push("Ace manifest formal_license_audit_required 与生成通知事实不一致");
  }
  const manifestAudit = Array.isArray(manifest.packages_requiring_formal_license_audit)
    ? manifest.packages_requiring_formal_license_audit
    : null;
  if (!manifestAudit) {
    errors.push("Ace manifest 缺少 packages_requiring_formal_license_audit 数组");
  } else {
    const expectedByPath = new Map(expectedAuditRecords.map((item) => [item.path, item]));
    const seen = new Set();
    for (const item of manifestAudit) {
      const packagePath = manifestPath(item?.path, "formal license audit path", errors);
      if (!packagePath) continue;
      if (seen.has(packagePath)) errors.push(`正式许可证审计清单重复：${packagePath}`);
      seen.add(packagePath);
      const expected = expectedByPath.get(packagePath);
      if (!expected || ["name", "version", "license", "license_notice"]
        .some((field) => item?.[field] !== expected[field])) {
        errors.push(`正式许可证审计清单与包记录不一致：${packagePath}`);
      }
    }
    for (const packagePath of expectedByPath.keys()) {
      if (!seen.has(packagePath)) errors.push(`正式许可证审计清单漏包：${packagePath}`);
    }
  }

  if (thirdPartyNotice.schema_version !== "1.0" ||
      thirdPartyNotice.formal_license_audit_required !== auditRequired) {
    errors.push("THIRD_PARTY_NOTICES.json 版本或正式审计标志不一致");
  }
  if (JSON.stringify(thirdPartyNotice.packages_requiring_formal_license_audit) !==
      JSON.stringify(manifest.packages_requiring_formal_license_audit)) {
    errors.push("THIRD_PARTY_NOTICES.json 与 manifest 的正式审计清单不一致");
  }
  if (!Array.isArray(thirdPartyNotice.packages) ||
      thirdPartyNotice.packages.length !== packageRecords.size) {
    errors.push("THIRD_PARTY_NOTICES.json 的 packages 数量不一致");
  } else {
    const noticePackages = new Map(thirdPartyNotice.packages.map((item) => [item.path, item]));
    for (const [packagePath, record] of packageRecords) {
      const notice = noticePackages.get(packagePath);
      if (!notice || ["name", "version", "license", "license_url", "license_source"]
        .some((field) => notice?.[field] !== record.item[field]) ||
        JSON.stringify(notice?.license_files) !== JSON.stringify(record.item.license_files) ||
        JSON.stringify(notice?.license_notice_files) !==
          JSON.stringify(record.item.license_notice_files)) {
        errors.push(`THIRD_PARTY_NOTICES.json 的包记录不一致：${packagePath}`);
      }
    }
  }
  const noticesMarkdown = fs.readFileSync(noticesMarkdownTarget, "utf8");
  if (!noticesMarkdown.includes("# Third-party dependency notices")) {
    errors.push("THIRD_PARTY_NOTICES.md 缺少固定标题");
  }
  if (auditRequired && !noticesMarkdown.includes("## Formal-sale blocker")) {
    errors.push("THIRD_PARTY_NOTICES.md 未标注正式售卖阻断项");
  }
  for (const record of packageRecords.values()) {
    if (!noticesMarkdown.includes(record.item.name) ||
        !noticesMarkdown.includes(record.item.version)) {
      errors.push(`THIRD_PARTY_NOTICES.md 漏包：${record.item.name}@${record.item.version}`);
    }
  }

  const expectedPatch = {
    patch_id: "OAK-ACE-ISOLATION-002",
    target_package: "@daisy/ace-axe-runner-puppeteer",
    target_version: "1.4.6",
    target_file: "node_modules/@daisy/ace-axe-runner-puppeteer/lib/index.js",
    before_sha256: "681b52d047d5f6eebbfc62a925b7dc22b82589ab63b36a9ea602297f8cd86ea6",
    after_sha256: "025a0766beaa48e8eb48f640d2bacf72029a61486aec276a393450d406ac67cc",
    controlled_replacement: "scripts/patches/ace-axe-runner-puppeteer-1.4.6.js",
  };
  if (!Array.isArray(manifest.patches) || manifest.patches.length !== 1) {
    errors.push("Ace manifest 必须且只能记录一个已审核安全补丁");
  } else {
    const patch = manifest.patches[0];
    for (const [field, expected] of Object.entries(expectedPatch)) {
      if (patch?.[field] !== expected) {
        errors.push(`Ace 安全补丁 ${field} 未匹配已审核值`);
      }
    }
    if (patch?.sanitizer?.package_name !== "@xmldom/xmldom" ||
        patch?.sanitizer?.package_version !== "0.9.10") {
      errors.push("Ace 安全补丁未固定 XHTML 清洗器 @xmldom/xmldom@0.9.10");
    }
    const sanitizerRecord = [...packageRecords.values()].find(
      (record) => record.item.name === "@xmldom/xmldom" && record.item.version === "0.9.10",
    );
    if (!sanitizerRecord) {
      errors.push("Ace 阶段包缺少已纳入全量哈希的 XHTML 清洗器 @xmldom/xmldom@0.9.10");
    }
    if (typeof patch?.effect !== "string" ||
        !patch.effect.includes("作者 XHTML 在 JavaScript 禁用状态下") ||
        !patch.effect.includes("basedir 内 file:") ||
        !patch.effect.includes("OS 级网络隔离仍是正式发布阻断项")) {
      errors.push("Ace 安全补丁缺少完整的作者脚本、协议与正式阻断边界说明");
    }
    const patchPath = manifestPath(patch?.target_file, "manifest.patches[0].target_file", errors);
    if (patchPath) {
      const target = actualByPath.get(patchPath);
      if (!target || !listedByPath.has(patchPath)) {
        errors.push(`Ace 安全补丁目标缺失或未纳入哈希：${patchPath}`);
      } else if (sha256File(target.target) !== expectedPatch.after_sha256) {
        errors.push(`Ace 安全补丁目标内容不是已审核版本：${patchPath}`);
      }
    }
  }

  checks.push({
    type: "ace-stage",
    path: "tools/ace/manifest.json",
    package_count: manifest.packages?.length ?? 0,
    file_count: actualFiles.length,
    total_bytes: totalBytes,
    version: manifest.root_package?.version ?? null,
  });
}

function addCurrentReleaseBlockers(platform, releaseTier, blockers, errors) {
  const pending = [
    {
      code: "PYTHON_RUNTIME_PROVENANCE_AUDIT_REQUIRED",
      message: "CPython 运行时已由受版本控制的全量哈希清单固定，但官方来源与再分发证据仍需正式人工审计",
    },
    {
      code: "EPUBCHECK_PROVENANCE_AUDIT_REQUIRED",
      message: "EpubCheck 5.3.0 本地分发已固定全量哈希，但来源与再分发证据仍需正式人工审计",
    },
    {
      code: "JRE_SOURCE_PROVENANCE_AUDIT_REQUIRED",
      message: "Temurin JDK 输入和生成 JRE 已由受版本控制锁固定，但官方来源与再分发证据仍需正式人工审计",
    },
    {
      code: "EPUBCHECK_TRUST_ROOT_NOT_HARDENED",
      message: "EpubCheck 分发清单仍与工具文件同处可写资源目录，正式版需锚定到受签名与 asar integrity/fuses 保护的可信根",
    },
    {
      code: "JRE_TRUST_ROOT_NOT_HARDENED",
      message: "JRE 运行时清单仍与可执行文件同处可写资源目录，正式版需锚定到受签名与 asar integrity/fuses 保护的可信根",
    },
    {
      code: "PYTHON_RUNTIME_TRUST_ROOT_NOT_HARDENED",
      message: "Python 运行时清单尚未锚定到代码签名、asar integrity 与 Electron fuses 保护的可信根",
    },
    {
      code: "APP_RESOURCES_TRUST_ROOT_NOT_HARDENED",
      message: "Python 核心、规则/标准与样本等 loose extraResources 尚未由受签名的 asar integrity/fuses 可信根固定",
    },
    {
      code: "ELECTRON_RUNTIME_PROVENANCE_AUDIT_REQUIRED",
      message: "Electron 原生分发的官方来源、校验和与再分发证据尚未完成正式审计",
    },
    {
      code: "ELECTRON_RUNTIME_TRUST_ROOT_NOT_HARDENED",
      message: "Electron 原生分发尚无受版本控制的全树哈希锁，少量文件和架构检查不能替代构建输入可信根",
    },
    {
      code: "BUILDER_TOOLCHAIN_PROVENANCE_AUDIT_REQUIRED",
      message: platform === "darwin"
        ? "macOS 构建主机、DMG、签名与公证工具链的版本和来源尚未完成正式审计"
        : "NSIS、rcedit 与 signtool 等构建工具的官方来源和校验依据尚未完成正式审计",
    },
    {
      code: "BUILDER_TOOLCHAIN_TRUST_ROOT_NOT_HARDENED",
      message: platform === "darwin"
        ? "macOS builder、签名和公证构建输入尚未形成受版本控制的独立版本与校验锁"
        : "离线 Windows builder 工具链当前仅自带可写 manifest，尚无受版本控制的独立来源/哈希锁",
    },
    {
      code: "ACE_FULL_LICENSE_AUDIT_REQUIRED",
      message: "Ace 完整生产依赖闭包尚未逐包完成来源、许可证文本、版权声明与再分发义务的正式人工审计",
    },
    {
      code: "ACE_TRUST_ROOT_NOT_HARDENED",
      message: "Ace 全量哈希清单尚未锚定到代码签名、asar integrity 与 Electron fuses 保护的可信根",
    },
    {
      code: "ACE_CONTROLLED_HELPER_PENDING",
      message: "Ace 仍通过通用 ELECTRON_RUN_AS_NODE 宿主执行，正式版需改为最小权限受控 helper",
    },
    {
      code: "ACE_BROWSER_RUNTIME_PENDING",
      message: "Ace 仍依赖用户系统 Chrome，尚未形成可安装包自带并受校验的浏览器运行时",
    },
    {
      code: "ACE_OS_NETWORK_ISOLATION_PENDING",
      message: "Ace 已在 Chromium 层拒绝作者网络请求，但正式版仍缺经验证的 OS 级默认拒绝网络隔离",
    },
    {
      code: platform === "darwin" ? "MAC_SIGNING_NOTARIZATION_PENDING" : "WINDOWS_CODE_SIGNING_PENDING",
      message: platform === "darwin"
        ? "macOS 代码签名、公证、staple 与 Gatekeeper 验证尚未完成"
        : "Windows Authenticode 代码签名与安装包签名验证尚未完成",
    },
  ];
  const existing = new Set(blockers.map((item) => item.code));
  for (const blocker of pending) {
    if (!existing.has(blocker.code)) blockers.push(blocker);
    if (releaseTier === "sale") {
      errors.push(`sale 门禁失败：${blocker.code} — ${blocker.message}`);
    }
  }
}

function verifyPackagedResources({
  root,
  platform = "win32",
  arch = null,
  source = true,
  releaseTier = "sale",
  executeRuntimes = true,
  hostPlatform = process.platform,
  hostArch = process.arch,
} = {}) {
  const projectRoot = path.resolve(root || path.join(__dirname, ".."));
  const errors = [];
  const checks = [];
  const blockers = [];
  const pythonRuntimeStates = [];
  const jreRuntimeStates = [];
  if (releaseTier !== "alpha" && releaseTier !== "sale") {
    errors.push(`不支持的发布门禁层级：${String(releaseTier)}`);
  }
  verifyCore(projectRoot, errors, checks);
  verifyEpubCheck(projectRoot, errors, checks);
  if (source) verifyElectronDistribution(projectRoot, platform, arch, errors, checks);

  if (platform === "win32") {
    const pythonState = verifyWindowsRuntime(projectRoot, errors, checks, { execute: false });
    if (pythonState) pythonRuntimeStates.push(pythonState);
    const jreState = verifyJreRuntime(
      projectRoot,
      source ? "tools/jre-win32-x64" : "tools/jre",
      "win32",
      arch || "x64",
      errors,
      checks,
      { execute: false },
    );
    if (jreState) jreRuntimeStates.push(jreState);
    verifyAceStage(projectRoot, errors, checks, { releaseTier, blockers });
  } else if (platform === "darwin") {
    pythonRuntimeStates.push(...verifyMacRuntimes(projectRoot, arch, errors, checks, {
      execute: false,
      source,
    }));
    const architectures = !source && !arch ? [] : arch ? [arch] : ["x64", "arm64"];
    for (const targetArch of architectures) {
      const jreState = verifyJreRuntime(
        projectRoot,
        source ? `tools/jre-darwin-${targetArch}` : "tools/jre",
        "darwin",
        targetArch,
        errors,
        checks,
        { execute: false },
      );
      if (jreState) jreRuntimeStates.push(jreState);
    }
    verifyAceStage(projectRoot, errors, checks, { releaseTier, blockers });
  } else {
    errors.push(`不支持的打包平台：${platform}`);
  }
  addCurrentReleaseBlockers(platform, releaseTier, blockers, errors);

  let runtimeProbeExecuted = false;
  if (executeRuntimes && errors.length === 0) {
    const allRuntimeStates = [...pythonRuntimeStates, ...jreRuntimeStates];
    for (const state of allRuntimeStates) {
      if (hostPlatform !== state.platform || hostArch !== state.arch) {
        errors.push(
          `${state.label} 必须在原生 ${state.platform}-${state.arch} runner 执行探针；`
          + `当前为 ${hostPlatform}-${hostArch}。纯静态跨主机验证必须显式设置 executeRuntimes=false`,
        );
      }
    }
    if (errors.length === 0) {
      for (const state of pythonRuntimeStates) {
        runtimeProbeExecuted = true;
        probePythonRuntime(projectRoot, state.executable, state.label, errors, checks, {
          packaged: !source,
          expectedRuntimeVersion: state.version,
        });
      }
      for (const state of jreRuntimeStates) {
        if (errors.length > 0) break;
        runtimeProbeExecuted = true;
        probeJreEpubCheck(
          projectRoot,
          state.executable,
          state.manifest,
          state.label,
          errors,
          checks,
        );
      }
    }
  }

  const report = {
    ok: errors.length === 0,
    platform,
    arch,
    source,
    release_tier: releaseTier,
    runtime_probe_requested: executeRuntimes,
    runtime_probe_executed: runtimeProbeExecuted,
    root: projectRoot,
    checks,
    blockers,
    errors,
  };
  if (errors.length > 0) throw new ResourceGateError(errors, report);
  return report;
}

function parseArgs(argv) {
  const options = {
    platform: process.platform,
    root: path.join(__dirname, ".."),
    arch: null,
    source: true,
    releaseTier: "sale",
    executeRuntimes: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--platform") options.platform = argv[++index];
    else if (arg === "--root") options.root = argv[++index];
    else if (arg === "--arch") options.arch = argv[++index];
    else if (arg === "--packaged") options.source = false;
    else if (arg === "--release-tier") options.releaseTier = argv[++index];
    else if (arg === "--no-runtime-probe") options.executeRuntimes = false;
    else throw new Error(`未知参数：${arg}`);
  }
  if (options.releaseTier === "auto") {
    options.releaseTier = releaseTierForVersion(EXPECTED_APP_VERSION);
  }
  return options;
}

if (require.main === module) {
  try {
    const report = verifyPackagedResources(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  PYTHON_IDENTITY_PROBE,
  ResourceGateError,
  jreLockRelative,
  parseArgs,
  probePythonRuntime,
  releaseTierForVersion,
  verifyJreRuntime,
  verifyMacRuntimes,
  verifyPackagedResources,
};
