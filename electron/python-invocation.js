// Python 核心的跨平台隔离启动契约。Windows 嵌入式发行版有 ._pth，
// macOS 普通 CPython 没有；两端都用同一个固定 bootstrap 显式加入受控核心目录。

"use strict";

const path = require("path");

const STANDARD_IDENTITY_FIELDS = Object.freeze([
  "bundle_id",
  "manifest_sha256",
  "name",
  "pinned",
  "release_sequence",
  "sha256",
  "version",
]);
const SAFE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

const CORE_BOOTSTRAP = [
  "import runpy,sys",
  "sys.path.insert(0,sys.argv.pop(1))",
  "runpy.run_module('oak_manuscript_core',run_name='__main__')",
].join(";");

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    throw new Error(`${label} 必须是非空且不含 NUL 的字符串`);
  }
  return value;
}

function isSafeSemver(value) {
  if (typeof value !== "string" || value.length > 128) return false;
  const match = SEMVER_RE.exec(value);
  if (match === null) return false;
  for (const raw of match.slice(1, 4)) {
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) return false;
  }
  const prerelease = value.split("+")[0].split("-").slice(1).join("-");
  if (prerelease && prerelease.split(".").some((item) => /^\d+$/.test(item) &&
      item.length > 1 && item.startsWith("0"))) return false;
  return true;
}

function serializeStandardIdentity(value) {
  const invalid = () => { throw new Error("标准包绑定身份非法"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const keys = Object.keys(value).sort();
  const expected = [...STANDARD_IDENTITY_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) invalid();
  if (typeof value.name !== "string" || !SAFE_ID_RE.test(value.name) ||
      !isSafeSemver(value.version) ||
      value.pinned !== true ||
      typeof value.sha256 !== "string" || !SHA256_RE.test(value.sha256) ||
      typeof value.bundle_id !== "string" || !SAFE_ID_RE.test(value.bundle_id) ||
      !Number.isSafeInteger(value.release_sequence) || value.release_sequence < 1 ||
      typeof value.manifest_sha256 !== "string" || !SHA256_RE.test(value.manifest_sha256)) {
    invalid();
  }
  const canonical = {};
  for (const field of STANDARD_IDENTITY_FIELDS) canonical[field] = value[field];
  return JSON.stringify(canonical);
}

function isolatedPythonInvocation({ executable, script, cwd, args = [] } = {}) {
  const command = nonEmptyString(executable, "Python 可执行文件");
  const fixedScript = nonEmptyString(script, "Python 固定脚本");
  const requestedCwd = nonEmptyString(cwd, "Python 工作目录");
  if (!path.isAbsolute(requestedCwd)) {
    throw new Error("Python 工作目录必须是绝对路径");
  }
  if (!Array.isArray(args) || args.some((item) =>
    typeof item !== "string" || item.includes("\0"))) {
    throw new Error("Python 固定脚本参数必须是无 NUL 的字符串数组");
  }
  return {
    command,
    // -I 会忽略 PYTHONDONTWRITEBYTECODE/PYTHONUTF8/PYTHONIOENCODING；因此
    // 禁止写入字节码与 UTF-8 都必须由不可被继承环境覆盖的显式参数固定。
    args: ["-I", "-B", "-S", "-X", "utf8", "-c", fixedScript, ...args],
    cwd: path.resolve(requestedCwd),
  };
}

function pythonCoreInvocation({ executable, coreDir, args = [] } = {}) {
  const requestedCoreDir = nonEmptyString(coreDir, "Python 核心目录");
  if (!path.isAbsolute(requestedCoreDir)) {
    throw new Error("Python 核心目录必须是绝对路径");
  }
  const resolvedCoreDir = path.resolve(requestedCoreDir);
  return isolatedPythonInvocation({
    executable,
    script: CORE_BOOTSTRAP,
    cwd: resolvedCoreDir,
    args: [resolvedCoreDir, ...args],
  });
}

function createIsolatedPythonEnvironment(
  source = process.env,
  {
    packaged = false,
    standardsStoreRoot = null,
    expectedStandardIdentity = null,
  } = {},
) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    const upper = key.toUpperCase();
    if (upper.startsWith("PYTHON") || upper.startsWith("OAK_")) continue;
    env[key] = value;
  }
  const isolated = {
    ...env,
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
    OAK_APP_PACKAGED: packaged ? "1" : "0",
  };
  if (standardsStoreRoot !== null) {
    const requested = nonEmptyString(standardsStoreRoot, "标准库根目录");
    if (!path.isAbsolute(requested)) throw new Error("标准库根目录必须是绝对路径");
    isolated.OAK_STANDARDS_STORE = path.resolve(requested);
  }
  if (expectedStandardIdentity !== null) {
    isolated.OAK_EXPECTED_STANDARD_IDENTITY = serializeStandardIdentity(expectedStandardIdentity);
  }
  return isolated;
}

module.exports = {
  CORE_BOOTSTRAP,
  createIsolatedPythonEnvironment,
  isolatedPythonInvocation,
  pythonCoreInvocation,
  serializeStandardIdentity,
};
