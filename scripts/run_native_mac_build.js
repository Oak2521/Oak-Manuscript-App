"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

function runNativeMacBuild({
  root = path.resolve(__dirname, ".."),
  hostPlatform = process.platform,
  hostArch = process.arch,
  env = process.env,
  spawn = spawnSync,
} = {}) {
  if (hostPlatform !== "darwin") {
    throw new Error(`macOS 原生构建只能在 darwin runner 执行；当前为 ${hostPlatform}`);
  }
  if (hostArch !== "x64" && hostArch !== "arm64") {
    throw new Error(`不支持的 macOS 原生构建架构：${hostArch}`);
  }
  const npmCli = env.npm_execpath;
  if (typeof npmCli !== "string" || npmCli.trim() === "" || !path.isAbsolute(npmCli)) {
    throw new Error("缺少 npm_execpath；请通过 npm run build:mac 启动原生构建");
  }
  const script = `build:mac:${hostArch}`;
  const result = spawn(process.execPath, [npmCli, "run", script], {
    cwd: path.resolve(root),
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`macOS ${hostArch} 构建被信号终止：${result.signal}`);
  if (result.status !== 0) {
    throw new Error(`macOS ${hostArch} 构建失败，退出码 ${String(result.status)}`);
  }
  return { arch: hostArch, script };
}

if (require.main === module) {
  try {
    runNativeMacBuild();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { runNativeMacBuild };
