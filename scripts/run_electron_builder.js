"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { resolveElectronDist } = require("./electron_dist");
const { verifyPinnedExtractor } = require("./pinned_7zip");
const { verifyOfflineToolchain } = require("./verify_builder_toolchain");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const NETWORK_SIGNING_ENV = new Set([
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "CSC_NAME",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "WIN_CSC_NAME",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "API_KEY",
  "API_KEY_ID",
  "API_KEY_ISSUER_ID",
  "AC_USERNAME",
  "AC_PASSWORD",
  "AC_TEAM_ID",
  "SM_HOST",
  "SM_API_KEY",
  "SM_CLIENT_CERT_FILE",
  "SM_CLIENT_CERT_PASSWORD",
  "GITHUB_TOKEN",
  "GH_TOKEN",
]);

function assertInsideProject(root, target, label) {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须位于项目目录内：${target}`);
  }
}

function ensureBuildDirectory(projectRoot, target, label) {
  assertInsideProject(projectRoot, target, label);
  const rootStat = fs.lstatSync(projectRoot, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`项目根目录不存在或不安全：${projectRoot}`);
  }
  let cursor = projectRoot;
  for (const segment of path.relative(projectRoot, target).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let stat = fs.lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat) {
      fs.mkdirSync(cursor);
      stat = fs.lstatSync(cursor);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} 路径包含链接或非目录，拒绝构建：${cursor}`);
    }
    const realRoot = fs.realpathSync.native(projectRoot);
    const realCursor = fs.realpathSync.native(cursor);
    const relative = path.relative(realRoot, realCursor);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`${label} 真实路径逃逸项目，拒绝构建：${cursor}`);
    }
  }
}

function getBuildPaths(root = PROJECT_ROOT) {
  const projectRoot = path.resolve(root);
  const paths = {
    electronCache: path.join(projectRoot, "out", "cache", "electron"),
    builderCache: path.join(projectRoot, "out", "cache", "electron-builder"),
    xdgCache: path.join(projectRoot, "out", "cache", "xdg"),
    temp: path.join(projectRoot, "out", "tmp", "electron-builder"),
    release: path.join(projectRoot, "release"),
  };
  for (const [label, target] of Object.entries(paths)) {
    assertInsideProject(projectRoot, target, label);
  }
  return { projectRoot, ...paths };
}

function createBuilderEnvironment({
  root = PROJECT_ROOT,
  env = process.env,
  toolchainEnv = {},
} = {}) {
  const paths = getBuildPaths(root);
  const result = { ...env };
  for (const key of Object.keys(result)) {
    if (NETWORK_SIGNING_ENV.has(key.toUpperCase())) delete result[key];
  }
  return {
    ...result,
    ELECTRON_CACHE: paths.electronCache,
    ELECTRON_BUILDER_CACHE: paths.builderCache,
    XDG_CACHE_HOME: paths.xdgCache,
    TEMP: paths.temp,
    TMP: paths.temp,
    TMPDIR: paths.temp,
    ...toolchainEnv,
    ELECTRON_BUILDER_OFFLINE: "true",
    npm_config_offline: "true",
    // alpha 构建不继承主机证书，也不进行身份自动发现。正式签名将使用
    // 单独、显式授权且可审计的入口。
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  };
}

function runElectronBuilder(args, {
  root = PROJECT_ROOT,
  spawn = spawnSync,
  preflight = verifyOfflineToolchain,
  resolveDist = resolveElectronDist,
  resolveSevenZip = verifyPinnedExtractor,
  hostPlatform = process.platform,
  hostArch = process.arch,
} = {}) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error("必须指定 electron-builder 平台与架构参数");
  }
  if (!args.includes("--win") && !args.includes("--mac")) {
    throw new Error("只允许通过本项目包装器构建 Windows 或 macOS 包");
  }
  if (args.includes("--publish") || args.includes("-p")) {
    throw new Error("构建包装器不接受发布参数；正式发布必须单独授权");
  }
  const allowed = new Set(["--win", "--mac", "--x64", "--arm64"]);
  const unexpected = args.filter((arg) => !allowed.has(arg));
  if (unexpected.length > 0) {
    throw new Error(`构建包装器拒绝配置绕过参数：${unexpected.join(", ")}`);
  }
  for (const flag of allowed) {
    if (args.filter((arg) => arg === flag).length > 1) {
      throw new Error(`构建包装器不接受重复参数：${flag}`);
    }
  }
  const platformCount = Number(args.includes("--win")) + Number(args.includes("--mac"));
  if (platformCount !== 1) throw new Error("必须且只能指定一个目标平台：--win 或 --mac");
  const architectureCount = Number(args.includes("--x64")) + Number(args.includes("--arm64"));
  if (architectureCount !== 1) throw new Error("必须且只能指定一个目标架构：--x64 或 --arm64");
  if (args.includes("--win") && (args.includes("--arm64") || !args.includes("--x64"))) {
    throw new Error("本项目 Windows 构建仅允许固定 x64 架构");
  }

  const platform = args.includes("--win") ? "win32" : "darwin";
  if (platform === "win32" && hostPlatform !== "win32") {
    throw new Error(`Windows 正式构建必须在 win32 主机执行；当前为 ${hostPlatform}`);
  }
  if (platform === "darwin" && hostPlatform !== "darwin") {
    throw new Error(`macOS 正式构建必须在 darwin 主机执行；当前为 ${hostPlatform}`);
  }
  const arch = args.includes("--arm64") ? "arm64" : "x64";
  if (platform === "darwin" && hostArch !== arch) {
    throw new Error(`macOS 正式构建必须使用原生 ${arch} runner；当前主机架构为 ${hostArch}`);
  }

  const paths = getBuildPaths(root);
  const toolchain = preflight({ root: paths.projectRoot, platform, arch });
  const sevenZip = platform === "win32" ? resolveSevenZip(paths.projectRoot) : null;
  const electron = resolveDist({
    projectRoot: paths.projectRoot,
    platform,
    arch,
    hostPlatform,
    hostArch,
  });
  if (typeof electron?.dist !== "string" || !path.isAbsolute(electron.dist)) {
    throw new Error("受控 Electron dist 解析器未返回绝对目录");
  }
  assertInsideProject(paths.projectRoot, electron.dist, "受控 Electron dist");
  for (const [label, target] of Object.entries({
    electronCache: paths.electronCache,
    builderCache: paths.builderCache,
    xdgCache: paths.xdgCache,
    temp: paths.temp,
    release: paths.release,
  })) {
    ensureBuildDirectory(paths.projectRoot, target, label);
  }

  const cli = require.resolve("electron-builder/cli.js", { paths: [paths.projectRoot] });
  const result = spawn(
    process.execPath,
    [cli, ...args, `--config.electronDist=${electron.dist}`, "--publish", "never"],
    {
      cwd: paths.projectRoot,
      env: createBuilderEnvironment({
        root: paths.projectRoot,
        toolchainEnv: {
          ...toolchain.env,
          ...(sevenZip == null ? {} : { ELECTRON_BUILDER_7ZIP_PATH: sevenZip }),
        },
      }),
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`electron-builder 被信号 ${result.signal} 终止`);
  return result.status ?? 1;
}

if (require.main === module) {
  try {
    process.exitCode = runElectronBuilder(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  NETWORK_SIGNING_ENV,
  createBuilderEnvironment,
  ensureBuildDirectory,
  getBuildPaths,
  runElectronBuilder,
};
