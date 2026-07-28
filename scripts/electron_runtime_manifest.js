"use strict";

// Electron executes before the application can enforce any manuscript-level
// security policy. Pin every runtime file and directory to a repository-tracked
// manifest, and never hand a distribution to electron-builder until this
// non-executing gate succeeds.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");
const { compareUtf16 } = require("./deterministic_compare");
const { atomicReplaceTrackedFile } = require("./safe_tracked_file");
const { parseJsonStrict } = require("./strict_json");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_VERSION = "1.0";
const LOCK_TYPE = "oak-electron-runtime";
const RUNTIME_NAME = "Electron";
const PROVENANCE_NOTE = "npm package metadata is pinned, but the separately downloaded Electron binary distribution still requires formal source and redistribution audit before sale.";
const PROVENANCE_RELATIVE = "config/provenance/electron-43.1.0-win32-x64.json";
const MANIFEST_KEYS = Object.freeze([
  "schema_version",
  "lock_type",
  "runtime",
  "target",
  "package_lock",
  "entry",
  "required_files",
  "formal_source_provenance_audit_required",
  "provenance_note",
  "provenance_evidence",
  "directory_count",
  "directories",
  "file_count",
  "total_bytes",
  "files",
]);
const PINNED_TARGETS = Object.freeze({
  "win32-x64": "43.1.0",
});
const PINNED_REQUESTS = Object.freeze({
  "win32-x64": "^43.1.0",
});
const REQUIRED_FILES = Object.freeze({
  "win32-x64": Object.freeze([
    "LICENSE",
    "LICENSES.chromium.html",
    "electron.exe",
    "icudtl.dat",
    "resources.pak",
    "resources/default_app.asar",
    "version",
  ]),
});
const LOCAL_METADATA_FILES = new Set(["OAK_ELECTRON_DIST.json"]);
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  const actual = Object.keys(value).sort(compareUtf16);
  const wanted = [...expected].sort(compareUtf16);
  if (actual.length !== wanted.length || actual.some((item, index) => item !== wanted[index])) {
    throw new Error(`${label} 字段集合不严格匹配；实际 ${actual.join(", ")}`);
  }
}

function canonicalManifestBytes(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function readJsonStrict(target, label) {
  const bytes = fs.readFileSync(target);
  try {
    // Keep a BOM visible so the parser rejects it, and reject invalid UTF-8
    // rather than silently substituting U+FFFD in an npm trust input.
    const text = STRICT_UTF8.decode(bytes);
    return { bytes, value: parseJsonStrict(text, label) };
  } catch (error) {
    throw new Error(`${label} 无法严格解析：${error.message}`);
  }
}

function targetKey(platform, arch) {
  return `${platform}-${arch}`;
}

function validateTarget(platform, arch) {
  const key = targetKey(platform, arch);
  if (!Object.hasOwn(PINNED_TARGETS, key)) {
    throw new Error(`尚未定义 Electron 运行时固定锁：${key}`);
  }
  return key;
}

function manifestRelative(version, platform, arch) {
  validateTarget(platform, arch);
  if (version !== PINNED_TARGETS[targetKey(platform, arch)]) {
    throw new Error(
      `Electron 固定版本不匹配：${platform}-${arch} 期望 `
      + `${PINNED_TARGETS[targetKey(platform, arch)]}，实际 ${String(version)}`,
    );
  }
  return `config/tool-manifests/electron-${version}-${platform}-${arch}.json`;
}

function safeRelative(value, label) {
  if (typeof value !== "string" || value === "" || value.includes("\\") ||
      path.posix.isAbsolute(value) || path.posix.normalize(value) !== value ||
      value === "." || value.startsWith("../") || value.endsWith("/")) {
    throw new Error(`${label} 不是安全的相对 POSIX 路径：${String(value)}`);
  }
  return value;
}

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveProjectPath(root, relative, label) {
  const projectRoot = path.resolve(root);
  const safe = safeRelative(relative, label);
  const target = path.resolve(projectRoot, ...safe.split("/"));
  if (!isWithin(projectRoot, target)) throw new Error(`${label} 逃逸项目目录：${target}`);
  return target;
}

function requireSafeFile(target, label) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.nlink !== 1) {
    throw new Error(`${label} 缺失、为空、属于链接/reparse 或不是安全普通文件：${target}`);
  }
  return stat;
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

function normalizedRealPath(target) {
  const resolved = fs.realpathSync.native(target);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function requireNoReparse(projectRoot, target, label) {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 不在项目目录内：${target}`);
  }
  const expected = path.join(fs.realpathSync.native(projectRoot), relative);
  if (normalizedRealPath(target) !== normalizedRealPath(expected)) {
    throw new Error(`${label} 经过链接或 reparse 重定向：${target}`);
  }
}

function readLockedElectron(root = REPO_ROOT, { platform = "win32", arch = "x64" } = {}) {
  const key = validateTarget(platform, arch);
  const projectRoot = path.resolve(root);
  const lockTarget = path.join(projectRoot, "package-lock.json");
  requireSafeFile(lockTarget, "package-lock.json");
  requireNoReparse(projectRoot, lockTarget, "package-lock.json");
  let packageLock;
  try {
    packageLock = readJsonStrict(lockTarget, "package-lock.json").value;
  } catch (error) {
    throw new Error(`package-lock.json 无法解析：${error.message}`);
  }
  const packageRecord = packageLock?.packages?.["node_modules/electron"];
  const rootSpec = packageLock?.packages?.[""]?.devDependencies?.electron;
  const expectedVersion = PINNED_TARGETS[key];
  const expectedRequest = PINNED_REQUESTS[key];
  if (!Number.isSafeInteger(packageLock?.lockfileVersion) || packageLock.lockfileVersion < 3 ||
      rootSpec !== expectedRequest ||
      packageRecord?.version !== expectedVersion ||
      typeof packageRecord?.resolved !== "string" || packageRecord.resolved === "" ||
      typeof packageRecord?.integrity !== "string" ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(packageRecord.integrity)) {
    throw new Error(
      `package-lock.json 未把 node_modules/electron 精确锁定到受支持版本 ${expectedVersion}`,
    );
  }

  const packageTarget = path.join(projectRoot, "node_modules", "electron", "package.json");
  requireSafeFile(packageTarget, "electron package.json");
  requireNoReparse(projectRoot, packageTarget, "electron package.json");
  let installed;
  try {
    installed = readJsonStrict(packageTarget, "electron package.json").value;
  } catch (error) {
    throw new Error(`electron package.json 无法解析：${error.message}`);
  }
  if (installed?.version !== expectedVersion) {
    throw new Error(
      `已安装 Electron 与 package-lock.json 不一致：期望 ${expectedVersion}，`
      + `实际 ${String(installed?.version)}`,
    );
  }
  return {
    version: expectedVersion,
    rootSpec,
    resolved: packageRecord.resolved,
    integrity: packageRecord.integrity,
  };
}

function resolveDistribution(root, distribution) {
  const projectRoot = path.resolve(root);
  const target = distribution === null || distribution === undefined
    ? path.join(projectRoot, "node_modules", "electron", "dist")
    : path.resolve(distribution);
  if (!isWithin(projectRoot, target)) {
    throw new Error(`Electron 运行时目录不在项目目录内：${target}`);
  }
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Electron 运行时目录缺失、属于链接/reparse 或不安全：${target}`);
  }
  requireNoReparse(projectRoot, target, "Electron 运行时目录");
  return target;
}

function inventory(root, { ignoredLocalMetadata = [] } = {}) {
  const ignored = new Set(ignoredLocalMetadata);
  for (const relative of ignored) {
    safeRelative(relative, "ignoredLocalMetadata");
    if (!LOCAL_METADATA_FILES.has(relative)) {
      throw new Error(`不得忽略未批准的 Electron 运行时文件：${relative}`);
    }
  }
  const directories = [];
  const files = [];
  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf16(left.name, right.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        throw new Error(`Electron 运行时不得含链接或 reparse：${relative}`);
      }
      requireNoReparse(root, target, `Electron 运行时条目 ${relative}`);
      if (stat.isDirectory()) {
        directories.push(relative);
        visit(target);
      } else if (stat.isFile()) {
        if (ignored.has(relative)) {
          requireSafeFile(target, `Electron 本地元数据 ${relative}`);
          continue;
        }
        if (stat.size <= 0 || stat.nlink !== 1) {
          throw new Error(`Electron 运行时含空文件、硬链接或不安全文件：${relative}`);
        }
        files.push({ path: relative, size_bytes: stat.size, sha256: sha256File(target) });
      } else {
        throw new Error(`Electron 运行时含非常规文件类型：${relative}`);
      }
    }
  }
  visit(root);
  return {
    directories: directories.sort(compareUtf16),
    files: files.sort((left, right) => compareUtf16(left.path, right.path)),
  };
}

function provenanceReference(root) {
  const projectRoot = path.resolve(root);
  const target = resolveProjectPath(projectRoot, PROVENANCE_RELATIVE, "Electron provenance evidence");
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return null;
  requireSafeFile(target, "Electron provenance evidence");
  requireNoReparse(projectRoot, target, "Electron provenance evidence");
  const parsed = readJsonStrict(target, "Electron provenance evidence");
  if (!parsed.bytes.equals(Buffer.from(`${JSON.stringify(parsed.value, null, 2)}\n`, "utf8")) ||
      parsed.value?.schema_version !== 1 || parsed.value?.evidence_type !== "oak-electron-runtime-provenance" ||
      parsed.value?.subject?.name !== RUNTIME_NAME || parsed.value?.subject?.version !== PINNED_TARGETS["win32-x64"] ||
      parsed.value?.subject?.target?.platform !== "win32" || parsed.value?.subject?.target?.arch !== "x64" ||
      parsed.value?.verification?.machine_status !== "verified" ||
      parsed.value?.verification?.human_review_status !== "pending") {
    throw new Error("Electron provenance evidence 身份、canonical 字节或机器/人工状态不匹配");
  }
  return { path: PROVENANCE_RELATIVE, sha256: sha256File(target),
    machine_status: "verified", human_review_status: "pending" };
}

function manifestFromInventory(root, locked, platform, arch, actual) {
  const key = validateTarget(platform, arch);
  return {
    schema_version: SCHEMA_VERSION,
    lock_type: LOCK_TYPE,
    runtime: { name: RUNTIME_NAME, version: locked.version },
    target: { platform, arch },
    package_lock: {
      path: "package-lock.json",
      package_key: "node_modules/electron",
      requested: locked.rootSpec,
      resolved: locked.resolved,
      integrity: locked.integrity,
    },
    entry: platform === "win32" ? "electron.exe" : null,
    required_files: [...REQUIRED_FILES[key]],
    formal_source_provenance_audit_required: true,
    provenance_note: PROVENANCE_NOTE,
    provenance_evidence: provenanceReference(root),
    directory_count: actual.directories.length,
    directories: actual.directories,
    file_count: actual.files.length,
    total_bytes: actual.files.reduce((sum, item) => sum + item.size_bytes, 0),
    files: actual.files,
  };
}

function buildManifest(root = REPO_ROOT, {
  platform = "win32",
  arch = "x64",
  distribution = null,
} = {}) {
  const key = validateTarget(platform, arch);
  const projectRoot = path.resolve(root);
  const locked = readLockedElectron(projectRoot, { platform, arch });
  const runtimeRoot = resolveDistribution(projectRoot, distribution);
  const actual = inventory(runtimeRoot);
  const byPath = new Set(actual.files.map((item) => item.path));
  for (const required of REQUIRED_FILES[key]) {
    if (!byPath.has(required)) throw new Error(`Electron 运行时缺少必需文件：${required}`);
  }
  const versionTarget = path.join(runtimeRoot, "version");
  if (fs.readFileSync(versionTarget, "utf8").trim() !== locked.version) {
    throw new Error(`Electron dist/version 与 package-lock.json 不一致：${versionTarget}`);
  }
  return manifestFromInventory(projectRoot, locked, platform, arch, actual);
}

function verifyRuntime(root = REPO_ROOT, {
  platform = "win32",
  arch = "x64",
  distribution = null,
  ignoredLocalMetadata = [],
} = {}) {
  const key = validateTarget(platform, arch);
  const projectRoot = path.resolve(root);
  const locked = readLockedElectron(projectRoot, { platform, arch });
  const lockRelative = manifestRelative(locked.version, platform, arch);
  const lockTarget = resolveProjectPath(projectRoot, lockRelative, "Electron runtime manifest");
  requireSafeFile(lockTarget, "Electron runtime manifest");
  requireNoReparse(projectRoot, lockTarget, "Electron runtime manifest");
  let manifestBytes;
  let manifest;
  try {
    const parsed = readJsonStrict(lockTarget, "Electron 运行时固定清单");
    manifestBytes = parsed.bytes;
    manifest = parsed.value;
  } catch (error) {
    throw new Error(`Electron 运行时固定清单无法解析：${error.message}`);
  }
  exactKeys(manifest, MANIFEST_KEYS, "Electron 运行时固定清单");
  exactKeys(manifest.runtime, ["name", "version"], "Electron 运行时固定清单 runtime");
  exactKeys(manifest.target, ["platform", "arch"], "Electron 运行时固定清单 target");
  exactKeys(
    manifest.package_lock,
    ["path", "package_key", "requested", "resolved", "integrity"],
    "Electron 运行时固定清单 package_lock",
  );
  if (manifest.provenance_evidence !== null) {
    exactKeys(manifest.provenance_evidence, ["path", "sha256", "machine_status", "human_review_status"], "Electron 运行时固定清单 provenance_evidence");
  }
  const requiredFiles = [...REQUIRED_FILES[key]];
  if (manifest.schema_version !== SCHEMA_VERSION || manifest.lock_type !== LOCK_TYPE ||
      manifest.runtime?.name !== RUNTIME_NAME || manifest.runtime?.version !== locked.version ||
      manifest.target?.platform !== platform || manifest.target?.arch !== arch ||
      manifest.entry !== "electron.exe" ||
      manifest.package_lock?.path !== "package-lock.json" ||
      manifest.package_lock?.package_key !== "node_modules/electron" ||
      manifest.package_lock?.requested !== locked.rootSpec ||
      manifest.package_lock?.resolved !== locked.resolved ||
      manifest.package_lock?.integrity !== locked.integrity ||
      manifest.formal_source_provenance_audit_required !== true ||
      manifest.provenance_note !== PROVENANCE_NOTE ||
      JSON.stringify(manifest.required_files) !== JSON.stringify(requiredFiles)) {
    throw new Error("Electron 运行时固定清单的 schema、版本、目标、npm 锁或审计状态不匹配");
  }

  const runtimeRoot = resolveDistribution(projectRoot, distribution);
  const actual = inventory(runtimeRoot, { ignoredLocalMetadata });
  if (!Array.isArray(manifest.directories) ||
      manifest.directories.some((item, index) =>
        safeRelative(item, `manifest.directories[${index}]`) !== item) ||
      JSON.stringify(manifest.directories) !== JSON.stringify(actual.directories) ||
      manifest.directory_count !== actual.directories.length) {
    throw new Error("Electron 运行时固定清单目录树漏列、多列、重复或顺序非法");
  }

  if (!Array.isArray(manifest.files)) throw new Error("Electron 运行时固定清单 files 必须是数组");
  const listedByPath = new Map();
  for (const [index, item] of manifest.files.entries()) {
    exactKeys(
      item,
      ["path", "size_bytes", "sha256"],
      `Electron 运行时固定清单 files[${index}]`,
    );
    const relative = safeRelative(item?.path, `manifest.files[${index}].path`);
    if (listedByPath.has(relative) || !Number.isSafeInteger(item.size_bytes) ||
        item.size_bytes <= 0 || typeof item.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(item.sha256)) {
      throw new Error(`Electron 运行时固定清单文件记录非法或重复：${relative}`);
    }
    listedByPath.set(relative, item);
  }
  const actualByPath = new Map(actual.files.map((item) => [item.path, item]));
  if (JSON.stringify([...listedByPath.keys()]) !== JSON.stringify([...actualByPath.keys()])) {
    for (const item of actual.files) {
      if (!listedByPath.has(item.path)) {
        throw new Error(`Electron 运行时固定清单漏列实际文件：${item.path}`);
      }
    }
    for (const relative of listedByPath.keys()) {
      if (!actualByPath.has(relative)) {
        throw new Error(`Electron 运行时固定清单多列或列出不存在文件：${relative}`);
      }
    }
    throw new Error("Electron 运行时固定清单文件顺序不稳定");
  }
  for (const item of actual.files) {
    const listed = listedByPath.get(item.path);
    if (listed.size_bytes !== item.size_bytes || listed.sha256 !== item.sha256) {
      throw new Error(`Electron 运行时文件 SHA-256 或大小与固定清单不一致：${item.path}`);
    }
  }
  const totalBytes = actual.files.reduce((sum, item) => sum + item.size_bytes, 0);
  if (manifest.file_count !== actual.files.length ||
      manifest.file_count !== listedByPath.size || manifest.total_bytes !== totalBytes) {
    throw new Error("Electron 运行时固定清单文件数或总字节数不一致");
  }
  for (const required of requiredFiles) {
    if (!actualByPath.has(required)) throw new Error(`Electron 运行时缺少必需文件：${required}`);
  }
  const versionTarget = path.join(runtimeRoot, "version");
  if (fs.readFileSync(versionTarget, "utf8").trim() !== locked.version) {
    throw new Error(`Electron dist/version 与 package-lock.json 不一致：${versionTarget}`);
  }
  const canonical = canonicalManifestBytes(manifestFromInventory(projectRoot, locked, platform, arch, actual));
  if (!manifestBytes.equals(canonical)) {
    throw new Error("Electron 运行时固定清单不是生成器定义的唯一规范 UTF-8/LF 字节序列");
  }
  return {
    manifest,
    manifestTarget: lockTarget,
    manifestSha256: sha256File(lockTarget),
    runtimeRoot,
    files: actual.files,
    directories: actual.directories,
  };
}

function writePinnedManifest(root = REPO_ROOT, options = {}) {
  const projectRoot = path.resolve(root);
  const {
    rename = fs.renameSync,
    fsync = fs.fsyncSync,
    beforeCommit = null,
    verifyAfterWrite = null,
    ...manifestOptions
  } = options;
  const platform = manifestOptions.platform || "win32";
  const arch = manifestOptions.arch || "x64";
  const locked = readLockedElectron(projectRoot, { platform, arch });
  const target = resolveProjectPath(
    projectRoot,
    manifestRelative(locked.version, platform, arch),
    "Electron runtime manifest",
  );
  const verifyOptions = { ...manifestOptions, platform, arch };
  const manifest = buildManifest(projectRoot, verifyOptions);
  const transaction = atomicReplaceTrackedFile({
    root: projectRoot,
    target,
    bytes: canonicalManifestBytes(manifest),
    rename,
    fsync,
    beforeCommit,
    verify: () => verifyAfterWrite
      ? verifyAfterWrite({ root: projectRoot, target, manifest, options: verifyOptions })
      : verifyRuntime(projectRoot, verifyOptions),
  });
  return { target, manifest, transaction };
}

function parseArgs(argv) {
  const options = { platform: "win32", arch: "x64" };
  let updateLock = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--platform") options.platform = argv[++index];
    else if (arg === "--arch") options.arch = argv[++index];
    else if (arg === "--dist") options.distribution = path.resolve(REPO_ROOT, argv[++index]);
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
      mode: updateLock ? "update-lock" : "verify-read-only",
      manifest: path.relative(REPO_ROOT, result.target || result.manifestTarget)
        .split(path.sep).join("/"),
      platform: result.manifest.target.platform,
      arch: result.manifest.target.arch,
      version: result.manifest.runtime.version,
      directory_count: result.manifest.directory_count,
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
  LOCK_TYPE,
  PINNED_TARGETS,
  REQUIRED_FILES,
  RUNTIME_NAME,
  SCHEMA_VERSION,
  buildManifest,
  inventory,
  manifestRelative,
  parseArgs,
  readLockedElectron,
  sha256File,
  verifyRuntime,
  writePinnedManifest,
};
