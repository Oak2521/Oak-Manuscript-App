// Python sidecar 桥：shell=false、参数数组、严格 UTF-8 JSON（方案 §12.1–12.2，AD-002 契约）。

"use strict";

const { spawn } = require("child_process");
const pathPolicy = require("./path-policy");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 运行核心子命令。返回 { code, json, stderr }。
 * stdout 必须是单个 JSON 文档（核心的 AD-002 契约）；解析失败视为运行错误。
 */
function runCore(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
      reject(new Error("非法的核心调用参数"));
      return;
    }
    const child = spawn(pathPolicy.pythonExecutable(), ["-m", "oak_manuscript_core", ...args], {
      cwd: pathPolicy.pythonDir(),
      shell: false,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
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

module.exports = { runCore };
