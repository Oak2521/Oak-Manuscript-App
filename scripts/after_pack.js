"use strict";

const path = require("node:path");
const { Arch } = require("builder-util");
const {
  KNOWN_FUSES,
  assertSafePackagedFuseFile,
  tierFromPackage,
  verifyPackagedFuseBinary,
} = require("./electron_fuse_policy");

function normalizeArch(value) {
  const arch = typeof value === "number" ? Arch[value] : value;
  if (typeof arch !== "string" || arch === "") {
    throw new Error("electron-builder afterPack 未提供目标架构");
  }
  return arch;
}

function createFuseWriteConfiguration(fuses, { platform, arch }) {
  if (!fuses || fuses.FuseVersion?.V1 !== "1" || !fuses.FuseV1Options) {
    throw new Error("@electron/fuses API 不符合 v1 固定合同");
  }
  const config = {
    version: fuses.FuseVersion.V1,
    strictlyRequireAllFuses: true,
    resetAdHocDarwinSignature: platform === "darwin" && arch === "arm64",
  };
  for (const [index, name, enabled] of KNOWN_FUSES) {
    if (fuses.FuseV1Options[name] !== index) {
      throw new Error(`@electron/fuses ${name} 索引不符合固定合同`);
    }
    config[index] = enabled;
  }
  return config;
}

function sameStableFile(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.nlink === 1n && right.nlink === 1n;
}

function resolvePackagedExecutable(context) {
  const root = context?.packager?.projectDir;
  const appOutDir = context?.appOutDir;
  const platform = context?.electronPlatformName;
  const productFilename = context?.packager?.appInfo?.productFilename;
  if (typeof root !== "string" || root === "") {
    throw new Error("electron-builder afterPack 未提供项目根目录");
  }
  if (typeof appOutDir !== "string" || appOutDir === "") {
    throw new Error("electron-builder afterPack 未提供输出目录");
  }
  if (!new Set(["win32", "darwin"]).has(platform)) {
    throw new Error(`electron-builder afterPack 目标平台不受支持：${String(platform)}`);
  }
  if (typeof productFilename !== "string" || productFilename === "" ||
      productFilename.includes("/") || productFilename.includes("\\")) {
    throw new Error("electron-builder afterPack 产品文件名非法");
  }
  const executable = platform === "win32"
    ? path.join(appOutDir, `${productFilename}.exe`)
    : path.join(appOutDir, `${productFilename}.app`, "Contents", "MacOS", productFilename);
  assertSafePackagedFuseFile(executable, { root, label: "afterPack 应用可执行文件" });
  return { root: path.resolve(root), executable, platform };
}

async function afterPack(context, {
  loadFuses = () => import("@electron/fuses"),
  verify = verifyPackagedFuseBinary,
} = {}) {
  const { root, executable, platform } = resolvePackagedExecutable(context);
  const arch = normalizeArch(context.arch);
  const releaseTier = tierFromPackage(context?.packager?.appInfo?.version, "auto");
  const fuses = await loadFuses();
  if (typeof fuses.flipFuses !== "function" || typeof fuses.pathToFuseFile !== "function") {
    throw new Error("@electron/fuses 缺少写入或路径解析 API");
  }
  const fuseFile = fuses.pathToFuseFile(executable);
  const { stat: before } = assertSafePackagedFuseFile(fuseFile, {
    root,
    label: "afterPack 实际 fuse 文件",
  });
  const config = createFuseWriteConfiguration(fuses, { platform, arch });
  const sentinels = await fuses.flipFuses(executable, config);
  if (sentinels !== 1) {
    throw new Error(`当前分架构构建必须恰好写入 1 个 Electron fuse wire：${String(sentinels)}`);
  }
  const { stat: after } = assertSafePackagedFuseFile(fuseFile, {
    root,
    label: "afterPack 写后实际 fuse 文件",
  });
  if (!sameStableFile(before, after)) {
    throw new Error("实际 Electron fuse 文件在写入期间发生身份替换");
  }
  const report = await verify(executable, { root, releaseTier });
  if (!report?.ok || !report.fully_known) {
    throw new Error("Electron fuse 写后回读未满足完整固定策略");
  }
  process.stdout.write(
    `[fuse-gate] ${platform}-${arch} 写入并回读 9 项 fuse：${sentinels} 个 wire\n`,
  );
  return { ...report, sentinels };
}

module.exports = afterPack;
module.exports.afterPack = afterPack;
module.exports.createFuseWriteConfiguration = createFuseWriteConfiguration;
module.exports.resolvePackagedExecutable = resolvePackagedExecutable;
module.exports.sameStableFile = sameStableFile;
