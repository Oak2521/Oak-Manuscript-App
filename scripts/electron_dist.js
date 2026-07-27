"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SUPPORTED_PLATFORMS = new Set(["win32", "darwin"]);
const SUPPORTED_ARCHES = new Set(["x64", "arm64"]);

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function requireRegularFile(target, label) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    throw new Error(`Electron dist 缺少 ${label}：${target}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
    throw new Error(`Electron dist 的 ${label} 不是安全的非空文件：${target}`);
  }
  return target;
}

function readPackageVersion(projectRoot) {
  const target = requireRegularFile(
    path.join(projectRoot, "node_modules", "electron", "package.json"),
    "electron package.json",
  );
  const manifest = JSON.parse(fs.readFileSync(target, "utf8"));
  if (typeof manifest.version !== "string" || manifest.version === "") {
    throw new Error("electron package.json 缺少有效 version");
  }
  return manifest.version;
}

function windowsExecutableArch(target) {
  const descriptor = fs.openSync(target, "r");
  try {
    const header = Buffer.alloc(65536);
    const size = fs.readSync(descriptor, header, 0, header.length, 0);
    if (size < 64 || header.toString("ascii", 0, 2) !== "MZ") {
      throw new Error("不是有效 PE 文件（缺少 MZ）");
    }
    const peOffset = header.readUInt32LE(0x3c);
    if (peOffset + 6 > size || header.toString("binary", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
      throw new Error("不是有效 PE 文件（缺少 PE 标头）");
    }
    const machine = header.readUInt16LE(peOffset + 4);
    if (machine === 0x8664) return "x64";
    if (machine === 0xaa64) return "arm64";
    if (machine === 0x014c) return "ia32";
    return `unknown-0x${machine.toString(16)}`;
  } finally {
    fs.closeSync(descriptor);
  }
}

function cpuArch(cpuType) {
  if (cpuType === 0x01000007) return "x64";
  if (cpuType === 0x0100000c) return "arm64";
  return null;
}

function macExecutableArches(target) {
  const descriptor = fs.openSync(target, "r");
  try {
    const header = Buffer.alloc(65536);
    const size = fs.readSync(descriptor, header, 0, header.length, 0);
    if (size < 8) throw new Error("Mach-O 文件过短");
    const magicLE = header.readUInt32LE(0);
    const magicBE = header.readUInt32BE(0);
    if (magicLE === 0xfeedface || magicLE === 0xfeedfacf) {
      return new Set([cpuArch(header.readUInt32LE(4))].filter(Boolean));
    }
    if (magicBE === 0xfeedface || magicBE === 0xfeedfacf) {
      return new Set([cpuArch(header.readUInt32BE(4))].filter(Boolean));
    }

    let littleEndian;
    let is64;
    if (magicBE === 0xcafebabe || magicBE === 0xcafebabf) {
      littleEndian = false;
      is64 = magicBE === 0xcafebabf;
    } else if (magicLE === 0xcafebabe || magicLE === 0xcafebabf) {
      littleEndian = true;
      is64 = magicLE === 0xcafebabf;
    } else {
      throw new Error("不是有效 Mach-O/FAT 文件");
    }
    const read32 = littleEndian
      ? (offset) => header.readUInt32LE(offset)
      : (offset) => header.readUInt32BE(offset);
    const count = read32(4);
    const recordSize = is64 ? 32 : 20;
    if (count <= 0 || count > 16 || 8 + count * recordSize > size) {
      throw new Error("Mach-O FAT 架构表非法");
    }
    const result = new Set();
    for (let index = 0; index < count; index += 1) {
      const arch = cpuArch(read32(8 + index * recordSize));
      if (arch) result.add(arch);
    }
    return result;
  } finally {
    fs.closeSync(descriptor);
  }
}

function sha256File(target) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(target, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      position += count;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function electronDistPath({
  projectRoot,
  platform,
  arch,
  hostPlatform = process.platform,
  hostArch = process.arch,
}) {
  if (!SUPPORTED_PLATFORMS.has(platform)) throw new Error(`不支持 Electron dist 平台：${platform}`);
  if (!SUPPORTED_ARCHES.has(arch)) throw new Error(`不支持 Electron dist 架构：${arch}`);
  const root = path.resolve(projectRoot);
  const target = platform === hostPlatform && arch === hostArch
    ? path.join(root, "node_modules", "electron", "dist")
    : path.join(root, "out", "electron-dist", `${platform}-${arch}`);
  if (!isWithin(root, target)) throw new Error(`Electron dist 路径逃逸项目目录：${target}`);
  return target;
}

function validateElectronDist({
  projectRoot,
  platform,
  arch,
  dist,
  requireMarker = false,
}) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(dist);
  if (!isWithin(root, target)) throw new Error(`Electron dist 不在项目目录内：${target}`);
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Electron dist 目录缺失或不安全：${target}`);
  }

  const expectedVersion = readPackageVersion(root);
  const versionTarget = requireRegularFile(path.join(target, "version"), "version");
  const actualVersion = fs.readFileSync(versionTarget, "utf8").trim();
  if (actualVersion !== expectedVersion) {
    throw new Error(`Electron dist 版本不一致：期望 ${expectedVersion}，实际 ${actualVersion}`);
  }
  requireRegularFile(path.join(target, "LICENSE"), "LICENSE");
  requireRegularFile(path.join(target, "LICENSES.chromium.html"), "LICENSES.chromium.html");

  let executable;
  if (platform === "win32") {
    executable = requireRegularFile(path.join(target, "electron.exe"), "electron.exe");
    requireRegularFile(path.join(target, "resources", "default_app.asar"), "default_app.asar");
    requireRegularFile(path.join(target, "resources.pak"), "resources.pak");
    requireRegularFile(path.join(target, "icudtl.dat"), "icudtl.dat");
    const actualArch = windowsExecutableArch(executable);
    if (actualArch !== arch) {
      throw new Error(`Electron PE 架构不一致：期望 ${arch}，实际 ${actualArch}`);
    }
  } else {
    executable = requireRegularFile(
      path.join(target, "Electron.app", "Contents", "MacOS", "Electron"),
      "Electron.app executable",
    );
    requireRegularFile(
      path.join(target, "Electron.app", "Contents", "Info.plist"),
      "Electron.app Info.plist",
    );
    requireRegularFile(
      path.join(target, "Electron.app", "Contents", "Resources", "default_app.asar"),
      "Electron.app default_app.asar",
    );
    const arches = macExecutableArches(executable);
    if (!arches.has(arch)) {
      throw new Error(`Electron Mach-O 不含目标架构 ${arch}：${Array.from(arches).join(",")}`);
    }
  }

  if (requireMarker) {
    const markerTarget = requireRegularFile(
      path.join(target, "OAK_ELECTRON_DIST.json"),
      "OAK_ELECTRON_DIST.json",
    );
    const marker = JSON.parse(fs.readFileSync(markerTarget, "utf8"));
    const executableHash = sha256File(executable);
    if (marker.schema_version !== "1.0" || marker.platform !== platform ||
        marker.arch !== arch || marker.electron_version !== expectedVersion ||
        marker.executable_sha256 !== executableHash) {
      throw new Error("跨目标 Electron dist 标识与目标或可执行文件不一致");
    }
  }
  return { dist: target, version: actualVersion, platform, arch, executable };
}

function resolveElectronDist({
  projectRoot,
  platform,
  arch,
  hostPlatform = process.platform,
  hostArch = process.arch,
}) {
  const native = platform === hostPlatform && arch === hostArch;
  const dist = electronDistPath({ projectRoot, platform, arch, hostPlatform, hostArch });
  return validateElectronDist({
    projectRoot,
    platform,
    arch,
    dist,
    requireMarker: !native,
  });
}

function electronDist(context) {
  const projectRoot = typeof context?.packager?.projectDir === "string"
    ? path.resolve(context.packager.projectDir)
    : path.resolve(__dirname, "..");
  const platform = context?.platformName;
  const arch = context?.arch;
  try {
    if (typeof platform !== "string" || typeof arch !== "string") {
      throw new Error("electronDist hook 缺少 platformName/arch");
    }
    return resolveElectronDist({ projectRoot, platform, arch }).dist;
  } catch (error) {
    // electron-builder 会捕获 hook 抛错并回退联网下载。返回明确不存在的仓库内路径，
    // 让其后续 selectElectron() 在回退逻辑之外失败，保证离线门禁不可绕过。
    const token = crypto.randomUUID();
    const safePlatform = typeof platform === "string" ? platform.replace(/[^a-z0-9_-]/gi, "_") : "unknown";
    const safeArch = typeof arch === "string" ? arch.replace(/[^a-z0-9_-]/gi, "_") : "unknown";
    const sentinel = path.join(
      projectRoot,
      "out",
      "electron-dist",
      ".missing",
      `${safePlatform}-${safeArch}-${process.pid}-${token}`,
    );
    process.stderr.write(`[electron-dist] ${error.message}; refusing download fallback\n`);
    return sentinel;
  }
}

module.exports = electronDist;
module.exports.electronDistPath = electronDistPath;
module.exports.resolveElectronDist = resolveElectronDist;
module.exports.validateElectronDist = validateElectronDist;
module.exports.windowsExecutableArch = windowsExecutableArch;
module.exports.macExecutableArches = macExecutableArches;
