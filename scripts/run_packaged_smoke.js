"use strict";

const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PRODUCT_EXE = "湖岸稿件 Oak Manuscript.exe";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const PASS_MARKER = "SMOKE-RESULT: PASS";
const FAIL_MARKER = "SMOKE-RESULT: FAIL";
const EXPECTED_VERSION_ENV = "OAK_EXPECTED_APP_VERSION";
const EXPECT_PACKAGED_ENV = "OAK_EXPECT_PACKAGED";
const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const UNSAFE_ENV_NAMES = new Set([
  "all_proxy",
  "chrome_log_file",
  "classpath",
  "csc_key_password",
  "csc_link",
  "electron_enable_logging",
  "electron_force_is_packaged",
  "electron_log_file",
  "electron_no_attach_console",
  "electron_run_as_node",
  "http_proxy",
  "https_proxy",
  "java_tool_options",
  "jdk_java_options",
  "node_extra_ca_certs",
  "node_options",
  "node_path",
  "node_tls_reject_unauthorized",
  "no_proxy",
  "pythonbreakpoint",
  "pythonexecutable",
  "pythonhome",
  "pythoninspect",
  "pythonpath",
  "pythonprofileimporttime",
  "pythonstartup",
  "pythonuserbase",
  "pythonwarnings",
  "sslkeylogfile",
  "win_csc_key_password",
  "win_csc_link",
  "_java_options",
]);

function isInside(base, candidate, { allowEqual = false } = {}) {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  if (relative === "") return allowEqual;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertInside(base, candidate, label) {
  if (!isInside(base, candidate)) {
    throw new Error(`${label} 必须严格位于 ${base} 内：${candidate}`);
  }
}

function createSmokeRunId() {
  return `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
}

function validateSmokeRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID_RE.test(runId)) {
    throw new Error(`冒烟运行 ID 非法：${String(runId)}`);
  }
  return runId;
}

function getSmokePaths(root = PROJECT_ROOT, runId = "manual") {
  const validatedRunId = validateSmokeRunId(runId);
  const projectRoot = path.resolve(root);
  const outRoot = path.join(projectRoot, "out");
  const smokeRoot = path.join(outRoot, "packaged-smoke", "runs", validatedRunId);
  const paths = {
    projectRoot,
    executable: path.join(projectRoot, "release", "win-unpacked", PRODUCT_EXE),
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
  assertInside(projectRoot, paths.executable, "打包 EXE");
  for (const [name, target] of Object.entries(paths)) {
    if (["projectRoot", "executable", "outRoot"].includes(name)) continue;
    assertInside(outRoot, target, name);
  }
  return paths;
}

function ensureLocalDirectory(projectRoot, target) {
  assertInside(projectRoot, target, "冒烟输出目录");
  const relative = path.relative(projectRoot, target);
  let cursor = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      fs.mkdirSync(cursor);
      stat = fs.lstatSync(cursor);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`冒烟输出路径包含非目录或链接，拒绝写入：${cursor}`);
    }
  }

  const realRoot = fs.realpathSync.native(projectRoot);
  const realTarget = fs.realpathSync.native(target);
  if (!isInside(realRoot, realTarget)) {
    throw new Error(`冒烟输出目录真实路径逃逸项目：${target}`);
  }
}

function verifyWindowsX64Executable(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`打包 EXE 不存在：${target}`);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 128) {
    throw new Error(`打包 EXE 不是安全的非空常规文件：${target}`);
  }

  const handle = fs.openSync(target, "r");
  try {
    const dos = Buffer.alloc(64);
    if (fs.readSync(handle, dos, 0, dos.length, 0) !== dos.length || dos.toString("ascii", 0, 2) !== "MZ") {
      throw new Error(`打包 EXE 缺少 DOS MZ 文件头：${target}`);
    }
    const peOffset = dos.readUInt32LE(0x3c);
    if (peOffset < 64 || peOffset > stat.size - 26) {
      throw new Error(`打包 EXE 的 PE 头偏移非法：${target}`);
    }
    const pe = Buffer.alloc(26);
    if (fs.readSync(handle, pe, 0, pe.length, peOffset) !== pe.length ||
        !pe.subarray(0, 4).equals(Buffer.from("PE\0\0", "binary"))) {
      throw new Error(`打包 EXE 缺少有效 PE 签名：${target}`);
    }
    const machine = pe.readUInt16LE(4);
    const optionalHeaderMagic = pe.readUInt16LE(24);
    if (machine !== 0x8664 || optionalHeaderMagic !== 0x020b) {
      throw new Error(
        `打包 EXE 必须为 Windows x64 PE32+；machine=0x${machine.toString(16)}`
        + `，magic=0x${optionalHeaderMagic.toString(16)}`,
      );
    }
    return { arch: "x64", format: "PE32+", size: stat.size };
  } finally {
    fs.closeSync(handle);
  }
}

function readExpectedAppVersion(projectRoot) {
  const packagePath = path.join(projectRoot, "package.json");
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取打包冒烟期望版本 ${packagePath}：${error.message}`);
  }
  if (!parsed || typeof parsed.version !== "string" || parsed.version.trim() === "") {
    throw new Error(`package.json 缺少有效版本号：${packagePath}`);
  }
  return parsed.version;
}

function createSmokeEnvironment(
  paths,
  inherited = process.env,
  expectedVersion,
  { expectedPackaged = "1", externalValidation = false } = {},
) {
  if (typeof expectedVersion !== "string" || expectedVersion.trim() === "") {
    throw new Error("冒烟必须提供从 package.json 读取的期望版本");
  }
  if (expectedPackaged !== "0" && expectedPackaged !== "1") {
    throw new Error(`冒烟打包身份必须为 0 或 1：${String(expectedPackaged)}`);
  }
  const env = {};
  for (const [name, value] of Object.entries(inherited)) {
    const lower = name.toLowerCase();
    if (lower.startsWith("oak_") ||
        lower.startsWith("electron_") ||
        lower.startsWith("node_") ||
        lower.startsWith("python") ||
        lower.startsWith("chrome_") ||
        lower.startsWith("java_") ||
        lower.startsWith("jdk_java_") ||
        UNSAFE_ENV_NAMES.has(lower)) continue;
    env[name] = value;
  }

  const fixed = {
    ...env,
    OAK_SMOKE_OUTPUT_ROOT: paths.projectOutput,
    [EXPECTED_VERSION_ENV]: expectedVersion,
    [EXPECT_PACKAGED_ENV]: expectedPackaged,
    TEMP: paths.temp,
    TMP: paths.temp,
    TMPDIR: paths.temp,
    HOME: paths.home,
    USERPROFILE: paths.home,
    APPDATA: paths.appData,
    LOCALAPPDATA: paths.localAppData,
    XDG_CACHE_HOME: paths.xdgCache,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_DATA_HOME: paths.xdgData,
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
  };
  if (externalValidation === true) fixed.OAK_SMOKE_EXTERNAL_VALIDATION = "1";
  return fixed;
}

function smokeArguments(paths) {
  return [
    "--smoke",
    `--user-data-dir=${paths.userData}`,
    `--disk-cache-dir=${paths.diskCache}`,
    `--crash-dumps-dir=${paths.crashDumps}`,
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-domain-reliability",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
    "--no-pings",
  ];
}

function runPackagedSmoke({
  root = PROJECT_ROOT,
  spawn = spawnSync,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  inheritedEnv = process.env,
  hostPlatform = process.platform,
  runId = createSmokeRunId(),
} = {}) {
  if (hostPlatform !== "win32") {
    throw new Error(`Windows 打包冒烟只能在 win32 主机执行；当前为 ${hostPlatform}`);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`冒烟超时值非法：${String(timeoutMs)}`);
  }

  const paths = getSmokePaths(root, runId);
  const rootStat = fs.lstatSync(paths.projectRoot);
  if (!rootStat.isDirectory()) throw new Error(`项目根目录不存在：${paths.projectRoot}`);
  const executableReal = (() => {
    verifyWindowsX64Executable(paths.executable);
    return fs.realpathSync.native(paths.executable);
  })();
  const expectedVersion = readExpectedAppVersion(paths.projectRoot);
  const rootReal = fs.realpathSync.native(paths.projectRoot);
  if (!isInside(rootReal, executableReal)) {
    throw new Error(`打包 EXE 真实路径逃逸项目：${paths.executable}`);
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

  const args = smokeArguments(paths);
  const result = spawn(paths.executable, args, {
    cwd: paths.projectRoot,
    env: createSmokeEnvironment(paths, inheritedEnv, expectedVersion),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (!result || typeof result !== "object") {
    throw new Error("打包 EXE 冒烟未返回进程结果");
  }
  if (result.error) {
    const timedOut = result.error.code === "ETIMEDOUT" || result.error.errno === "ETIMEDOUT";
    throw new Error(
      timedOut
        ? `打包 EXE 冒烟超时（${timeoutMs} ms），已终止`
        : `无法运行打包 EXE 冒烟：${result.error.message}`,
    );
  }
  if (result.signal) throw new Error(`打包 EXE 冒烟被信号 ${result.signal} 终止`);

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const combined = `${stdout}\n${stderr}`;
  if (result.status !== 0) {
    throw new Error(
      `打包 EXE 冒烟退出码为 ${String(result.status)}；输出：${combined.trim().slice(-2000) || "<empty>"}`,
    );
  }
  const passLines = combined
    .split(/\r?\n/u)
    .filter((line) => line.trim() === PASS_MARKER).length;
  if (combined.includes(FAIL_MARKER) || passLines !== 1) {
    throw new Error(
      `打包 EXE 冒烟缺少唯一成功标志 ${PASS_MARKER}；输出：`
      + `${combined.trim().slice(-2000) || "<empty>"}`,
    );
  }

  return {
    ok: true,
    executable: paths.executable,
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
    const result = runPackagedSmoke();
    process.stdout.write(`${PASS_MARKER}\n`);
    process.stdout.write(`打包 EXE：${result.executable}\n`);
    process.stdout.write(`冒烟输出：${result.outputRoot}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  FAIL_MARKER,
  EXPECTED_VERSION_ENV,
  EXPECT_PACKAGED_ENV,
  PASS_MARKER,
  PRODUCT_EXE,
  createSmokeRunId,
  createSmokeEnvironment,
  ensureLocalDirectory,
  getSmokePaths,
  isInside,
  readExpectedAppVersion,
  runPackagedSmoke,
  smokeArguments,
  validateSmokeRunId,
  verifyWindowsX64Executable,
};
