"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  DEFAULT_TIMEOUT_MS,
  FAIL_MARKER,
  PASS_MARKER,
  createSmokeRunId,
  createSmokeEnvironment,
  ensureLocalDirectory,
  isInside,
  readExpectedAppVersion,
  smokeArguments,
  validateSmokeRunId,
} = require("./run_packaged_smoke");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

function getSourceSmokePaths(
  root = PROJECT_ROOT,
  electronExecutable = require("electron"),
  runId = "manual",
) {
  const projectRoot = path.resolve(root);
  const outRoot = path.join(projectRoot, "out");
  const smokeRoot = path.join(outRoot, "source-smoke", "runs", validateSmokeRunId(runId));
  const paths = {
    projectRoot,
    electronExecutable: path.resolve(electronExecutable),
    outRoot,
    smokeRoot,
    projectOutput: path.join(smokeRoot, "projects"),
    temp: path.join(smokeRoot, "tmp"),
    userData: path.join(smokeRoot, "electron-user-data"),
    diskCache: path.join(smokeRoot, "electron-cache"),
    home: path.join(smokeRoot, "home"),
    appData: path.join(smokeRoot, "home", "AppData", "Roaming"),
    localAppData: path.join(smokeRoot, "home", "AppData", "Local"),
    xdgCache: path.join(smokeRoot, "xdg-cache"),
    xdgConfig: path.join(smokeRoot, "xdg-config"),
    xdgData: path.join(smokeRoot, "xdg-data"),
    crashDumps: path.join(smokeRoot, "crash-dumps"),
  };
  if (!isInside(projectRoot, paths.electronExecutable)) {
    throw new Error(`源码冒烟 Electron 必须位于项目目录：${paths.electronExecutable}`);
  }
  for (const [name, target] of Object.entries(paths)) {
    if (["projectRoot", "electronExecutable", "outRoot"].includes(name)) continue;
    if (!isInside(outRoot, target)) throw new Error(`${name} 必须严格位于 ${outRoot} 内`);
  }
  return paths;
}

function runSourceSmoke({
  root = PROJECT_ROOT,
  electronExecutable = require("electron"),
  spawn = spawnSync,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  inheritedEnv = process.env,
  runId = createSmokeRunId(),
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`冒烟超时值非法：${String(timeoutMs)}`);
  }
  const paths = getSourceSmokePaths(root, electronExecutable, runId);
  const rootStat = fs.lstatSync(paths.projectRoot, { throwIfNoEntry: false });
  const electronStat = fs.lstatSync(paths.electronExecutable, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`项目根目录不存在或不安全：${paths.projectRoot}`);
  }
  if (!electronStat?.isFile() || electronStat.isSymbolicLink() || electronStat.size <= 0) {
    throw new Error(`源码冒烟 Electron 缺失或不安全：${paths.electronExecutable}`);
  }
  const rootReal = fs.realpathSync.native(paths.projectRoot);
  const electronReal = fs.realpathSync.native(paths.electronExecutable);
  if (!isInside(rootReal, electronReal)) {
    throw new Error(`源码冒烟 Electron 真实路径逃逸项目：${paths.electronExecutable}`);
  }

  for (const target of [
    paths.projectOutput,
    paths.temp,
    paths.userData,
    paths.diskCache,
    paths.home,
    paths.appData,
    paths.localAppData,
    paths.xdgCache,
    paths.xdgConfig,
    paths.xdgData,
    paths.crashDumps,
  ]) ensureLocalDirectory(paths.projectRoot, target);

  const expectedVersion = readExpectedAppVersion(paths.projectRoot);
  const args = [paths.projectRoot, ...smokeArguments(paths)];
  const result = spawn(paths.electronExecutable, args, {
    cwd: paths.projectRoot,
    env: createSmokeEnvironment(paths, inheritedEnv, expectedVersion, {
      expectedPackaged: "0",
      externalValidation: inheritedEnv.OAK_SMOKE_EXTERNAL_VALIDATION === "1",
    }),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (!result || typeof result !== "object") throw new Error("源码冒烟未返回进程结果");
  if (result.error) throw new Error(`无法运行源码冒烟：${result.error.message}`);
  if (result.signal) throw new Error(`源码冒烟被信号 ${result.signal} 终止`);
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const combined = `${stdout}\n${stderr}`;
  if (result.status !== 0) {
    throw new Error(
      `源码冒烟退出码为 ${String(result.status)}；输出：`
      + `${combined.trim().slice(-2000) || "<empty>"}`,
    );
  }
  const passLines = combined.split(/\r?\n/u)
    .filter((line) => line.trim() === PASS_MARKER).length;
  if (combined.includes(FAIL_MARKER) || passLines !== 1) {
    throw new Error(`源码冒烟缺少唯一成功标志 ${PASS_MARKER}`);
  }
  return {
    ok: true,
    electronExecutable: paths.electronExecutable,
    expectedVersion,
    runId,
    smokeRoot: paths.smokeRoot,
    outputRoot: paths.projectOutput,
    stdout,
    stderr,
  };
}

if (require.main === module) {
  try {
    const result = runSourceSmoke();
    process.stdout.write(`${PASS_MARKER}\n`);
    process.stdout.write(`源码 Electron：${result.electronExecutable}\n`);
    process.stdout.write(`冒烟输出：${result.outputRoot}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  getSourceSmokePaths,
  runSourceSmoke,
};
