"use strict";

// The bundled Python interpreter executes before the manuscript core can
// protect itself.  Pin the complete distribution in a repository-tracked
// manifest and never execute it until this non-executing gate succeeds.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { compareUtf16 } = require("./deterministic_compare");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_VERSION = "1.0";
const LOCK_TYPE = "oak-python-runtime";
const DISTRIBUTION = "CPython";
const WINDOWS_X64_VERSION = "3.13.14";
const DARWIN_X64_VERSION = "3.13.14";
const DARWIN_ARM64_VERSION = "3.13.14";
const PINNED_VERSIONS = Object.freeze({
  "win32-x64": WINDOWS_X64_VERSION,
  "darwin-x64": DARWIN_X64_VERSION,
  "darwin-arm64": DARWIN_ARM64_VERSION,
});

function manifestRelative(platform, arch) {
  if (!/^[a-z0-9]+$/.test(platform || "") || !/^[a-z0-9]+$/.test(arch || "")) {
    throw new Error(`Python 运行时目标平台或架构非法：${String(platform)}-${String(arch)}`);
  }
  return `config/tool-manifests/python-runtime-${platform}-${arch}.json`;
}

function defaultRuntimeRelative(platform, arch) {
  if (platform === "win32" && arch === "x64") return "python-runtime";
  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) {
    return `python-runtime-macos-${arch}`;
  }
  throw new Error(`尚未定义 Python 运行时目录：${platform}-${arch}`);
}

function entryFor(platform) {
  if (platform === "win32") return "python.exe";
  if (platform === "darwin") return "bin/python3";
  throw new Error(`不支持的 Python 运行时平台：${platform}`);
}

function requiredFilesFor(platform) {
  if (platform === "win32") {
    return Object.freeze([
      "LICENSE.txt",
      "python.exe",
      "python3.dll",
      "python313.dll",
      "python313.zip",
      "python313._pth",
    ]);
  }
  if (platform === "darwin") return Object.freeze(["LICENSE.txt", "bin/python3"]);
  throw new Error(`不支持的 Python 运行时平台：${platform}`);
}

function expectedVersionFor(platform, arch) {
  return PINNED_VERSIONS[`${platform}-${arch}`] || null;
}

function verifyWindowsIsolationFile(runtimeRoot) {
  const target = path.join(runtimeRoot, "python313._pth");
  let text;
  try {
    text = fs.readFileSync(target, "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  } catch (error) {
    throw new Error(`无法读取 Windows Python 隔离路径文件：${error.message}`);
  }
  const activeLines = text.split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const expected = ["python313.zip", ".", "..\\python"];
  if (JSON.stringify(activeLines) !== JSON.stringify(expected) ||
      text.split("\n").some((line) => /^\s*import\s+site\s*$/i.test(line))) {
    throw new Error(
      "python313._pth 必须只启用 python313.zip、当前目录与受控 ../python 核心，且不得导入 site",
    );
  }
}

function sha256File(target) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(target, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function safeRelative(value, label) {
  if (typeof value !== "string" || value === "" || value.includes("\\") ||
      path.posix.isAbsolute(value) || path.posix.normalize(value) !== value ||
      value === "." || value.startsWith("../")) {
    throw new Error(`${label} 不是安全的相对 POSIX 路径：${String(value)}`);
  }
  return value;
}

function resolveProjectPath(root, relative, label) {
  const projectRoot = path.resolve(root);
  const safe = safeRelative(relative, label);
  const target = path.resolve(projectRoot, ...safe.split("/"));
  const rel = path.relative(projectRoot, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`${label} 逃逸项目目录：${target}`);
  }
  return target;
}

function inventory(runtimeRoot, label = "Python 运行时") {
  const result = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf16(left.name, right.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(runtimeRoot, target).split(path.sep).join("/");
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error(`${label} 不得含符号链接或 junction：${relative}`);
      if (stat.isDirectory()) visit(target);
      else if (stat.isFile()) {
        if (stat.size <= 0) throw new Error(`${label} 含空文件：${relative}`);
        result.push({ path: relative, size_bytes: stat.size, sha256: sha256File(target) });
      } else {
        throw new Error(`${label} 含不支持的文件类型：${relative}`);
      }
    }
  }
  visit(runtimeRoot);
  return result.sort((left, right) => compareUtf16(left.path, right.path));
}

function validateTarget(platform, arch) {
  if (platform === "win32" && arch === "x64") return;
  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) return;
  throw new Error(`不支持的 Python 运行时目标：${platform}-${arch}`);
}

function buildManifest(root = REPO_ROOT, {
  platform = process.platform,
  arch = process.arch,
  runtimeRelative = null,
  version = null,
} = {}) {
  validateTarget(platform, arch);
  const projectRoot = path.resolve(root);
  const relative = runtimeRelative || defaultRuntimeRelative(platform, arch);
  const runtimeRoot = resolveProjectPath(projectRoot, relative, "Python runtime");
  const stat = fs.lstatSync(runtimeRoot, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Python 运行时目录缺失或不安全：${runtimeRoot}`);
  }
  const files = inventory(runtimeRoot);
  const byPath = new Set(files.map((item) => item.path));
  const requiredFiles = [...requiredFilesFor(platform)];
  for (const required of requiredFiles) {
    if (!byPath.has(required)) throw new Error(`Python 运行时缺少必需文件：${required}`);
  }
  if (platform === "win32") verifyWindowsIsolationFile(runtimeRoot);
  const expectedVersion = expectedVersionFor(platform, arch);
  const runtimeVersion = version || expectedVersion;
  if (typeof runtimeVersion !== "string" || !/^3\.[0-9]+\.[0-9]+$/.test(runtimeVersion) ||
      (expectedVersion && runtimeVersion !== expectedVersion)) {
    throw new Error(`Python 运行时版本未固定或不匹配：${String(runtimeVersion)}`);
  }
  return {
    schema_version: SCHEMA_VERSION,
    lock_type: LOCK_TYPE,
    runtime: { distribution: DISTRIBUTION, version: runtimeVersion },
    target: { platform, arch },
    entry: entryFor(platform),
    required_files: requiredFiles,
    formal_source_provenance_audit_required: true,
    provenance_note: "Locally supplied CPython distribution; origin and redistribution evidence require formal audit before sale.",
    file_count: files.length,
    total_bytes: files.reduce((sum, item) => sum + item.size_bytes, 0),
    files,
  };
}

function verifyRuntime(root = REPO_ROOT, {
  platform = process.platform,
  arch = process.arch,
  runtimeRelative = null,
} = {}) {
  validateTarget(platform, arch);
  const projectRoot = path.resolve(root);
  const relative = runtimeRelative || defaultRuntimeRelative(platform, arch);
  const lockRelative = manifestRelative(platform, arch);
  const lockTarget = resolveProjectPath(projectRoot, lockRelative, "Python runtime manifest");
  const lockStat = fs.lstatSync(lockTarget, { throwIfNoEntry: false });
  if (!lockStat || !lockStat.isFile() || lockStat.isSymbolicLink() || lockStat.size <= 0) {
    throw new Error(`Python 运行时固定清单缺失或不安全：${lockRelative}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(lockTarget, "utf8"));
  } catch (error) {
    throw new Error(`Python 运行时固定清单无法解析：${error.message}`);
  }
  const expectedEntry = entryFor(platform);
  const expectedRequired = [...requiredFilesFor(platform)];
  const expectedVersion = expectedVersionFor(platform, arch);
  if (manifest.schema_version !== SCHEMA_VERSION || manifest.lock_type !== LOCK_TYPE ||
      manifest.runtime?.distribution !== DISTRIBUTION ||
      typeof manifest.runtime?.version !== "string" ||
      !/^3\.[0-9]+\.[0-9]+$/.test(manifest.runtime.version) ||
      (expectedVersion && manifest.runtime.version !== expectedVersion) ||
      manifest.target?.platform !== platform || manifest.target?.arch !== arch ||
      manifest.entry !== expectedEntry ||
      manifest.formal_source_provenance_audit_required !== true ||
      JSON.stringify(manifest.required_files) !== JSON.stringify(expectedRequired)) {
    throw new Error("Python 运行时固定清单的 schema、版本、平台、入口或审计状态不匹配");
  }

  const runtimeRoot = resolveProjectPath(projectRoot, relative, "Python runtime");
  const runtimeStat = fs.lstatSync(runtimeRoot, { throwIfNoEntry: false });
  if (!runtimeStat || !runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()) {
    throw new Error(`Python 运行时目录缺失或不安全：${relative}`);
  }
  const actual = inventory(runtimeRoot);
  const actualByPath = new Map(actual.map((item) => [item.path, item]));
  const listedByPath = new Map();
  if (!Array.isArray(manifest.files)) throw new Error("Python 运行时固定清单 files 必须是数组");
  for (const [index, item] of manifest.files.entries()) {
    const itemPath = safeRelative(item?.path, `manifest.files[${index}].path`);
    if (listedByPath.has(itemPath) || !Number.isSafeInteger(item.size_bytes) ||
        item.size_bytes <= 0 || typeof item.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(item.sha256)) {
      throw new Error(`Python 运行时固定清单文件记录非法或重复：${itemPath}`);
    }
    listedByPath.set(itemPath, item);
  }
  for (const item of actual) {
    const listed = listedByPath.get(item.path);
    if (!listed) throw new Error(`Python 运行时固定清单漏列实际文件：${item.path}`);
    if (listed.size_bytes !== item.size_bytes || listed.sha256 !== item.sha256) {
      throw new Error(`Python 运行时文件 SHA-256 或大小与固定清单不一致：${item.path}`);
    }
  }
  for (const itemPath of listedByPath.keys()) {
    if (!actualByPath.has(itemPath)) {
      throw new Error(`Python 运行时固定清单列出不存在文件：${itemPath}`);
    }
  }
  if (manifest.file_count !== actual.length || manifest.file_count !== listedByPath.size ||
      manifest.total_bytes !== actual.reduce((sum, item) => sum + item.size_bytes, 0)) {
    throw new Error("Python 运行时固定清单文件数或总字节数不一致");
  }
  for (const required of expectedRequired) {
    if (!actualByPath.has(required)) throw new Error(`Python 运行时缺少必需文件：${required}`);
  }
  if (platform === "win32") verifyWindowsIsolationFile(runtimeRoot);
  return {
    manifest,
    manifestTarget: lockTarget,
    runtimeRoot,
    entry: path.join(runtimeRoot, ...expectedEntry.split("/")),
    files: actual,
  };
}

function writePinnedManifest(root = REPO_ROOT, options = {}) {
  const projectRoot = path.resolve(root);
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const target = resolveProjectPath(
    projectRoot,
    manifestRelative(platform, arch),
    "Python runtime manifest",
  );
  const manifest = buildManifest(projectRoot, { ...options, platform, arch });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { target, manifest };
}

function parseArgs(argv) {
  const options = { platform: process.platform, arch: process.arch };
  let updateLock = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--platform") options.platform = argv[++index];
    else if (arg === "--arch") options.arch = argv[++index];
    else if (arg === "--runtime") options.runtimeRelative = argv[++index];
    else if (arg === "--version") options.version = argv[++index];
    else if (arg === "--update-lock") updateLock = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return { options, updateLock };
}

if (require.main === module) {
  try {
    const { options, updateLock } = parseArgs(process.argv.slice(2));
    const result = updateLock
      ? writePinnedManifest(REPO_ROOT, options)
      : verifyRuntime(REPO_ROOT, options);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      manifest: path.relative(REPO_ROOT, result.target || result.manifestTarget)
        .split(path.sep).join("/"),
      platform: result.manifest.target.platform,
      arch: result.manifest.target.arch,
      version: result.manifest.runtime.version,
      file_count: result.manifest.file_count,
      total_bytes: result.manifest.total_bytes,
      formal_source_provenance_audit_required:
        result.manifest.formal_source_provenance_audit_required,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DISTRIBUTION,
  DARWIN_ARM64_VERSION,
  DARWIN_X64_VERSION,
  LOCK_TYPE,
  PINNED_VERSIONS,
  SCHEMA_VERSION,
  WINDOWS_X64_VERSION,
  buildManifest,
  defaultRuntimeRelative,
  entryFor,
  inventory,
  manifestRelative,
  requiredFilesFor,
  sha256File,
  verifyRuntime,
  verifyWindowsIsolationFile,
  writePinnedManifest,
};
