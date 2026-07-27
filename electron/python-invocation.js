// Python 核心的跨平台隔离启动契约。Windows 嵌入式发行版有 ._pth，
// macOS 普通 CPython 没有；两端都用同一个固定 bootstrap 显式加入受控核心目录。

"use strict";

const path = require("path");

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
    // -I 会忽略 PYTHONUTF8/PYTHONIOENCODING；因此 UTF-8 必须由不可被
    // 继承环境覆盖的显式 -X utf8 固定，保证中文 JSON 在各系统同字节。
    args: ["-I", "-S", "-X", "utf8", "-c", fixedScript, ...args],
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
  { electronExec = null, packaged = false } = {},
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
  if (typeof electronExec === "string" && electronExec.trim() !== "") {
    isolated.OAK_ELECTRON_EXEC_PATH = electronExec;
  }
  return isolated;
}

module.exports = {
  CORE_BOOTSTRAP,
  createIsolatedPythonEnvironment,
  isolatedPythonInvocation,
  pythonCoreInvocation,
};
