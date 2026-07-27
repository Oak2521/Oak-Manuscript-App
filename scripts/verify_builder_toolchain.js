"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { compareUtf16 } = require("./deterministic_compare");
const { windowsExecutableArch } = require("./electron_dist");

const BUILDER_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "node_modules", "electron-builder", "package.json"), "utf8"),
).version;

function sha256File(target) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(target));
  return hash.digest("hex");
}

function listFiles(root, errors) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf16(left.name, right.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) errors.push(`离线构建工具链不得含符号链接：${relative}`);
      else if (stat.isDirectory()) visit(target);
      else if (stat.isFile()) files.push({ path: relative, size_bytes: stat.size, target });
      else errors.push(`离线构建工具链含不支持的文件类型：${relative}`);
    }
  }
  visit(root);
  return files.sort((left, right) => compareUtf16(left.path, right.path));
}

function requireDirectory(root, relative, errors, { nonEmpty = false } = {}) {
  const target = path.join(root, ...relative.split("/"));
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    errors.push(`离线构建工具链缺少目录：${relative}`);
    return null;
  }
  if (nonEmpty && fs.readdirSync(target).length === 0) errors.push(`离线构建工具链目录为空：${relative}`);
  return target;
}

function requireFile(root, relative, errors) {
  const target = path.join(root, ...relative.split("/"));
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
    errors.push(`离线构建工具链缺少非空文件：${relative}`);
    return null;
  }
  return target;
}

function verifyWindowsToolchain(root, arch) {
  const projectRoot = path.resolve(root);
  const toolchain = path.join(projectRoot, "tools", "electron-builder", `win32-${arch}`);
  const errors = [];
  const rootStat = fs.lstatSync(toolchain, { throwIfNoEntry: false });
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(
      `离线 Windows 构建工具链缺失：${toolchain}。`
      + "需在用户批准联网后获取 NSIS、NSIS resources、rcedit 与 signtool，并生成 manifest.json。",
    );
  }

  const manifestTarget = requireFile(toolchain, "manifest.json", errors);
  const critical = {
    makensis: requireFile(toolchain, "nsis/Bin/makensis.exe", errors),
    elevate: requireFile(toolchain, "nsis/elevate.exe", errors),
    rceditX64: requireFile(toolchain, "rcedit/rcedit-x64.exe", errors),
    rceditX86: requireFile(toolchain, "rcedit/rcedit-x86.exe", errors),
    signtool: requireFile(toolchain, "signtool.exe", errors),
  };
  requireDirectory(toolchain, "nsis/Include", errors, { nonEmpty: true });
  requireDirectory(toolchain, "nsis/Stubs", errors, { nonEmpty: true });
  requireDirectory(toolchain, "nsis/Contrib", errors, { nonEmpty: true });
  requireDirectory(toolchain, "nsis-resources/plugins", errors, { nonEmpty: true });

  let manifest = null;
  if (manifestTarget) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestTarget, "utf8"));
    } catch (error) {
      errors.push(`离线构建工具链 manifest.json 无法解析：${error.message}`);
    }
  }
  if (manifest) {
    if (manifest.schema_version !== "1.0" || manifest.host_platform !== "win32" ||
        manifest.host_arch !== arch || manifest.electron_builder_version !== BUILDER_VERSION) {
      errors.push("离线构建工具链 manifest 的版本、平台或 electron-builder 版本不匹配");
    }
    const actual = listFiles(toolchain, errors).filter((item) => item.path !== "manifest.json");
    const actualByPath = new Map(actual.map((item) => [item.path, item]));
    const listedByPath = new Map();
    if (!Array.isArray(manifest.files)) {
      errors.push("离线构建工具链 manifest.files 必须是数组");
    } else {
      for (const item of manifest.files) {
        if (typeof item?.path !== "string" || item.path.includes("\\") ||
            path.posix.isAbsolute(item.path) || path.posix.normalize(item.path) !== item.path ||
            item.path.startsWith("../") || listedByPath.has(item.path) ||
            !Number.isSafeInteger(item.size_bytes) || item.size_bytes < 0 ||
            typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(item.sha256)) {
          errors.push(`离线构建工具链 manifest 文件记录非法：${String(item?.path)}`);
          continue;
        }
        listedByPath.set(item.path, item);
      }
    }
    for (const item of actual) {
      const listed = listedByPath.get(item.path);
      if (!listed) errors.push(`离线构建工具链 manifest 漏列：${item.path}`);
      else if (listed.size_bytes !== item.size_bytes ||
          listed.sha256.toLowerCase() !== sha256File(item.target)) {
        errors.push(`离线构建工具链哈希或大小不匹配：${item.path}`);
      }
    }
    for (const relative of listedByPath.keys()) {
      if (!actualByPath.has(relative)) errors.push(`离线构建工具链 manifest 列出不存在文件：${relative}`);
    }
    if (manifest.file_count !== actual.length || manifest.file_count !== listedByPath.size ||
        manifest.total_bytes !== actual.reduce((sum, item) => sum + item.size_bytes, 0)) {
      errors.push("离线构建工具链 manifest 的文件数或总字节数不一致");
    }
  }

  for (const [label, target] of Object.entries(critical)) {
    if (!target) continue;
    try {
      const actualArch = windowsExecutableArch(target);
      if (label === "rceditX64" || label === "signtool") {
        if (actualArch !== "x64") errors.push(`${label} 必须为 x64 PE，实际 ${actualArch}`);
      } else if (actualArch !== "x64" && actualArch !== "ia32") {
        errors.push(`${label} 必须为 x64/ia32 PE，实际 ${actualArch}`);
      }
    } catch (error) {
      errors.push(`${label} PE 校验失败：${error.message}`);
    }
  }

  if (errors.length > 0) throw new Error(`离线 Windows 构建工具链门禁失败：\n- ${errors.join("\n- ")}`);
  return {
    toolchain,
    env: {
      ELECTRON_BUILDER_NSIS_DIR: path.join(toolchain, "nsis"),
      ELECTRON_BUILDER_NSIS_RESOURCES_DIR: path.join(toolchain, "nsis-resources"),
      ELECTRON_BUILDER_RCEDIT_PATH: path.join(toolchain, "rcedit"),
      SIGNTOOL_PATH: path.join(toolchain, "signtool.exe"),
    },
  };
}

function verifyOfflineToolchain({ root, platform, arch }) {
  if (platform === "win32") return verifyWindowsToolchain(root, arch);
  if (platform === "darwin") {
    if (process.platform !== "darwin") throw new Error("macOS 构建工具链只能在 darwin 主机验证");
    return { toolchain: null, env: {} };
  }
  throw new Error(`不支持的离线构建工具链平台：${platform}`);
}

module.exports = {
  BUILDER_VERSION,
  verifyOfflineToolchain,
  verifyWindowsToolchain,
};
