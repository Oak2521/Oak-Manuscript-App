"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  LOCK_RELATIVE,
  SOURCE_ARCHIVES,
  TOOLCHAIN_RELATIVE,
} = require("./builder_toolchain_contract");
const { compareUtf16 } = require("./deterministic_compare");
const { windowsExecutableArch } = require("./electron_dist");
const { parseJsonStrict } = require("./strict_json");

const BUILDER_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "node_modules", "electron-builder", "package.json"), "utf8"),
).version;

function sha256File(target) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(target));
  return hash.digest("hex");
}

function exactKeys(value, expected, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} 必须是对象`);
    return false;
  }
  const actual = Object.keys(value).sort(compareUtf16);
  const wanted = [...expected].sort(compareUtf16);
  if (actual.length !== wanted.length || actual.some((item, index) => item !== wanted[index])) {
    errors.push(`${label} 字段集合不严格匹配；实际 ${actual.join(", ")}`);
    return false;
  }
  return true;
}

function validateSourceArchiveRecords(value, label, errors) {
  if (!Array.isArray(value) || value.length !== SOURCE_ARCHIVES.length) {
    errors.push(`${label} 必须精确列出三份固定来源归档`);
    return false;
  }
  let valid = true;
  for (let index = 0; index < SOURCE_ARCHIVES.length; index += 1) {
    const actual = value[index];
    const expected = SOURCE_ARCHIVES[index];
    if (!exactKeys(actual, ["name", "size_bytes", "sha256"], `${label}[${index}]`, errors)) {
      valid = false;
      continue;
    }
    if (actual.name !== expected.name || actual.sha256 !== expected.sha256 ||
        !Number.isSafeInteger(actual.size_bytes) || actual.size_bytes <= 0) {
      errors.push(`${label}[${index}] 的名称、哈希或大小不符合固定来源合同`);
      valid = false;
    }
  }
  return valid;
}

function validateFileRecords(value, label, errors) {
  const listedByPath = new Map();
  if (!Array.isArray(value)) {
    errors.push(`${label} 必须是数组`);
    return listedByPath;
  }
  let previous = null;
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!exactKeys(item, ["path", "sha256", "size_bytes"], `${label}[${index}]`, errors)) {
      continue;
    }
    if (typeof item.path !== "string" || item.path.includes("\\") ||
        path.posix.isAbsolute(item.path) || path.posix.normalize(item.path) !== item.path ||
        item.path === "." || item.path.startsWith("../") || listedByPath.has(item.path) ||
        !Number.isSafeInteger(item.size_bytes) || item.size_bytes < 0 ||
        typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(item.sha256)) {
      errors.push(`${label} 文件记录非法或重复：${String(item?.path)}`);
      continue;
    }
    if (previous != null && compareUtf16(previous, item.path) >= 0) {
      errors.push(`${label} 未按稳定 UTF-16 路径顺序排列：${item.path}`);
    }
    previous = item.path;
    listedByPath.set(item.path, item);
  }
  return listedByPath;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pathInside(root, target, { allowRoot = false } = {}) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (allowRoot && relative === "") ||
    (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function validatePathChain(root, target, label, errors) {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  if (!pathInside(absoluteRoot, absoluteTarget, { allowRoot: true })) {
    errors.push(`${label} 路径逃逸项目根：${absoluteTarget}`);
    return false;
  }
  let cursor = absoluteRoot;
  for (const segment of path.relative(absoluteRoot, absoluteTarget).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat) return true;
    if (stat.isSymbolicLink()) {
      errors.push(`${label} 路径父链含符号链接、junction 或重解析点：${cursor}`);
      return false;
    }
  }
  if (fs.existsSync(absoluteTarget)) {
    const realRoot = fs.realpathSync.native(absoluteRoot);
    const realTarget = fs.realpathSync.native(absoluteTarget);
    if (!pathInside(realRoot, realTarget, { allowRoot: true })) {
      errors.push(`${label} 真实路径逃逸项目根：${absoluteTarget}`);
      return false;
    }
  }
  return true;
}

function listFiles(root, errors) {
  const files = [];
  const realRoot = fs.realpathSync.native(root);
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf16(left.name, right.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) errors.push(`离线构建工具链不得含符号链接：${relative}`);
      else if (!pathInside(realRoot, fs.realpathSync.native(target))) {
        errors.push(`离线构建工具链真实路径逃逸：${relative}`);
      } else if (stat.isDirectory()) visit(target);
      else if (stat.isFile() && stat.nlink !== 1) {
        errors.push(`离线构建工具链不得含硬链接：${relative}`);
      } else if (stat.isFile()) files.push({ path: relative, size_bytes: stat.size, target });
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
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size <= 0) {
    errors.push(`离线构建工具链缺少非空文件：${relative}`);
    return null;
  }
  return target;
}

function verifyWindowsToolchain(root, arch) {
  const projectRoot = path.resolve(root);
  const toolchain = path.join(projectRoot, "tools", "electron-builder", `win32-${arch}`);
  const errors = [];
  if (!validatePathChain(projectRoot, toolchain, "离线 Windows 构建工具链", errors)) {
    throw new Error(`离线 Windows 构建工具链门禁失败：\n- ${errors.join("\n- ")}`);
  }
  const rootStat = fs.lstatSync(toolchain, { throwIfNoEntry: false });
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(
      `离线 Windows 构建工具链缺失：${toolchain}。`
      + "需先取得三份固定归档，再显式运行安全导入器并以 --update-lock 生成受版本控制的独立全树锁；普通构建不会下载或自动导入。",
    );
  }

  const lockPath = path.join(projectRoot, ...LOCK_RELATIVE.split("/"));
  if (!validatePathChain(projectRoot, lockPath, "离线 Windows 构建工具链 tracked lock", errors)) {
    throw new Error(`离线 Windows 构建工具链门禁失败：\n- ${errors.join("\n- ")}`);
  }
  const manifestTarget = requireFile(toolchain, "manifest.json", errors);
  const lockTarget = requireFile(projectRoot, LOCK_RELATIVE, errors);
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
  let manifestBytes = null;
  if (manifestTarget) {
    try {
      manifestBytes = fs.readFileSync(manifestTarget);
      manifest = parseJsonStrict(manifestBytes.toString("utf8"), "离线构建工具链 manifest.json");
    } catch (error) {
      errors.push(`离线构建工具链 manifest.json 无法解析：${error.message}`);
    }
  }
  let lock = null;
  if (lockTarget) {
    try {
      lock = parseJsonStrict(
        fs.readFileSync(lockTarget, "utf8"),
        `离线构建工具链 tracked lock ${LOCK_RELATIVE}`,
      );
    } catch (error) {
      errors.push(`离线构建工具链 tracked lock 无法解析：${error.message}`);
    }
  }
  let manifestFiles = new Map();
  const actual = listFiles(toolchain, errors).filter((item) => item.path !== "manifest.json");
  const actualByPath = new Map(actual.map((item) => [item.path, item]));
  if (manifest) {
    exactKeys(manifest, [
      "schema_version",
      "host_platform",
      "host_arch",
      "electron_builder_version",
      "source_archives",
      "file_count",
      "total_bytes",
      "files",
    ], "离线构建工具链 manifest", errors);
    if (manifest.schema_version !== "1.0" || manifest.host_platform !== "win32" ||
        manifest.host_arch !== arch || manifest.electron_builder_version !== BUILDER_VERSION) {
      errors.push("离线构建工具链 manifest 的版本、平台或 electron-builder 版本不匹配");
    }
    validateSourceArchiveRecords(
      manifest.source_archives,
      "离线构建工具链 manifest.source_archives",
      errors,
    );
    manifestFiles = validateFileRecords(
      manifest.files,
      "离线构建工具链 manifest.files",
      errors,
    );
    for (const item of actual) {
      const listed = manifestFiles.get(item.path);
      if (!listed) errors.push(`离线构建工具链 manifest 漏列：${item.path}`);
      else if (listed.size_bytes !== item.size_bytes ||
          listed.sha256 !== sha256File(item.target)) {
        errors.push(`离线构建工具链哈希或大小不匹配：${item.path}`);
      }
    }
    for (const relative of manifestFiles.keys()) {
      if (!actualByPath.has(relative)) errors.push(`离线构建工具链 manifest 列出不存在文件：${relative}`);
    }
    if (manifest.file_count !== actual.length || manifest.file_count !== manifestFiles.size ||
        manifest.total_bytes !== actual.reduce((sum, item) => sum + item.size_bytes, 0)) {
      errors.push("离线构建工具链 manifest 的文件数或总字节数不一致");
    }
  }

  if (lock) {
    exactKeys(lock, [
      "schema_version",
      "host_platform",
      "host_arch",
      "electron_builder_version",
      "source_archives",
      "tool_manifest",
      "file_count",
      "total_bytes",
      "files",
    ], "离线构建工具链 tracked lock", errors);
    if (lock.schema_version !== "1.0" || lock.host_platform !== "win32" ||
        lock.host_arch !== arch || lock.electron_builder_version !== BUILDER_VERSION) {
      errors.push("离线构建工具链 tracked lock 的版本、平台或 electron-builder 版本不匹配");
    }
    validateSourceArchiveRecords(
      lock.source_archives,
      "离线构建工具链 tracked lock.source_archives",
      errors,
    );
    const lockFiles = validateFileRecords(
      lock.files,
      "离线构建工具链 tracked lock.files",
      errors,
    );
    if (!exactKeys(
      lock.tool_manifest,
      ["path", "size_bytes", "sha256"],
      "离线构建工具链 tracked lock.tool_manifest",
      errors,
    ) || lock.tool_manifest.path !== `${TOOLCHAIN_RELATIVE}/manifest.json` ||
        !Number.isSafeInteger(lock.tool_manifest.size_bytes) || lock.tool_manifest.size_bytes <= 0 ||
        typeof lock.tool_manifest.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(lock.tool_manifest.sha256)) {
      errors.push("离线构建工具链 tracked lock.tool_manifest 记录非法");
    } else if (manifestBytes &&
        (lock.tool_manifest.size_bytes !== manifestBytes.length ||
         lock.tool_manifest.sha256 !== crypto.createHash("sha256").update(manifestBytes).digest("hex"))) {
      errors.push("离线构建工具链 tracked lock 与 manifest.json 原始字节不匹配");
    }
    if (manifest && (!sameJson(lock.source_archives, manifest.source_archives) ||
        !sameJson(lock.files, manifest.files) || lock.file_count !== manifest.file_count ||
        lock.total_bytes !== manifest.total_bytes)) {
      errors.push("离线构建工具链 tracked lock 与 manifest 的来源、全树或汇总不匹配");
    }
    if (lock.file_count !== lockFiles.size || lock.total_bytes !==
        [...lockFiles.values()].reduce((sum, item) => sum + item.size_bytes, 0)) {
      errors.push("离线构建工具链 tracked lock 的文件数或总字节数不一致");
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
  parseJsonStrict,
  verifyOfflineToolchain,
  verifyWindowsToolchain,
};
