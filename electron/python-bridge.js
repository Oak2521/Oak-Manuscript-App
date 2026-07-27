// Python sidecar 桥：shell=false、参数数组、严格 UTF-8 JSON（方案 §12.1–12.2，AD-002 契约）。

"use strict";

const { spawn } = require("child_process");
const path = require("node:path");
const pathPolicy = require("./path-policy");
const {
  createIsolatedPythonEnvironment,
  pythonCoreInvocation,
} = require("./python-invocation");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
let trustedStandardsStoreRoot = null;

function configureStandardsStoreRoot(root) {
  if (typeof root !== "string" || !path.isAbsolute(root) || root.includes("\0")) {
    throw new Error("标准库根目录必须是无 NUL 的绝对路径");
  }
  const resolved = path.resolve(root);
  if (trustedStandardsStoreRoot !== null && trustedStandardsStoreRoot !== resolved) {
    throw new Error("标准库根目录已固定，不能在进程内切换");
  }
  trustedStandardsStoreRoot = resolved;
  return trustedStandardsStoreRoot;
}

function createPythonEnvironment(
  source = process.env,
  {
    electronExec = process.execPath,
    packaged = pathPolicy.appIsPackaged(),
    standardsStoreRoot = trustedStandardsStoreRoot,
    expectedStandardIdentity = null,
  } = {},
) {
  return createIsolatedPythonEnvironment(source, {
    electronExec,
    packaged,
    standardsStoreRoot,
    expectedStandardIdentity,
  });
}

/**
 * 运行核心子命令。返回 { code, json, stderr }。
 * stdout 必须是单个 JSON 文档（核心的 AD-002 契约）；解析失败视为运行错误。
 */
function runCore(
  args,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  { expectedStandardIdentity = null } = {},
) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
      reject(new Error("非法的核心调用参数"));
      return;
    }
    const invocation = pythonCoreInvocation({
      executable: pathPolicy.pythonExecutable(),
      coreDir: pathPolicy.pythonDir(),
      args,
    });
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      shell: false,
      windowsHide: true,
      env: createPythonEnvironment(process.env, { expectedStandardIdentity }),
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("检查核心运行超时，已终止。项目文件安全（核心从不修改原稿）。"));
    }, timeoutMs);

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`无法启动检查核心（需要 Python 3.11+）：${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let json = null;
      const text = stdout.trim();
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          reject(new Error(`检查核心输出无法解析：${text.slice(0, 200)}`));
          return;
        }
      }
      resolve({ code, json, stderr: stderr.trim() });
    });
  });
}

// P0 高层桥方法：调用者只能选择固定命令与固定参数槽，不能注入任意 CLI 参数。
function planFixes(projectPath) {
  return runCore(["plan-fixes", "--project", projectPath]);
}

function applyFixPlan(projectPath, planId) {
  return runCore(["fix", "--project", projectPath, "--plan-id", planId]);
}

function listCheckpoints(projectPath) {
  return runCore(["list-checkpoints", "--project", projectPath]);
}

function restoreCheckpoint(projectPath, checkpointId) {
  return runCore(["restore-checkpoint", "--project", projectPath, "--checkpoint-id", checkpointId]);
}

module.exports = {
  configureStandardsStoreRoot,
  createPythonEnvironment,
  runCore,
  planFixes,
  applyFixPlan,
  listCheckpoints,
  restoreCheckpoint,
};
