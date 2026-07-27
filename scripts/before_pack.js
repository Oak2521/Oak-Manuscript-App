"use strict";

const { Arch } = require("builder-util");
const {
  releaseTierForVersion,
  verifyPackagedResources,
} = require("./verify_packaged_resources");

function beforePack(context, { verify = verifyPackagedResources } = {}) {
  const root = context?.packager?.projectDir;
  const platform = context?.electronPlatformName;
  const arch = typeof context?.arch === "number" ? Arch[context.arch] : context?.arch;
  const releaseTier = releaseTierForVersion(context?.packager?.appInfo?.version);
  if (typeof root !== "string" || root === "") {
    throw new Error("electron-builder beforePack 未提供项目根目录");
  }
  if (typeof platform !== "string" || platform === "") {
    throw new Error("electron-builder beforePack 未提供目标平台");
  }
  if (typeof arch !== "string" || arch === "") {
    throw new Error("electron-builder beforePack 未提供目标架构");
  }
  const report = verify({ root, platform, arch, source: true, releaseTier });
  process.stdout.write(
    `[resource-gate] ${platform}-${arch} 通过：${report.checks.length} 项资源检查\n`,
  );
}

module.exports = beforePack;
module.exports.beforePack = beforePack;
module.exports.releaseTierForVersion = releaseTierForVersion;
