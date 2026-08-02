// 路径策略：集中解析应用资源路径与写入范围校验（方案 §12.2）。
// 打包后资源在 process.resourcesPath；开发期直接用仓库目录。

"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { app } = require("electron");

function repoRoot() {
  // 开发期：electron . 的 appPath 即仓库根
  return app.getAppPath();
}

function resourcesRoot() {
  return app.isPackaged ? process.resourcesPath : repoRoot();
}

function appIsPackaged() {
  return app.isPackaged;
}

function pythonDir() {
  return path.join(resourcesRoot(), "python");
}

function configDir() {
  return path.join(resourcesRoot(), "config");
}

function samplesDir() {
  return path.join(resourcesRoot(), "samples");
}

function toolsDir() {
  return path.join(resourcesRoot(), "tools");
}

// sidecar Python：按目标系统选择捆绑运行时；开发期缺少运行时时回退系统 Python。
function pythonExecutableFor({
  platform = process.platform,
  root = resourcesRoot(),
  exists = fs.existsSync,
  packaged = false,
} = {}) {
  const windows = platform === "win32";
  const bundled = windows
    ? path.join(root, "python-runtime", "python.exe")
    : path.join(root, "python-runtime", "bin", "python3");
  if (exists(bundled)) return bundled;
  if (packaged) {
    throw new Error(`打包资源完整性错误：缺少捆绑 Python 运行时 ${bundled}`);
  }
  return windows ? "python" : "python3";
}

function pythonExecutable() {
  return pythonExecutableFor({ packaged: app.isPackaged });
}

// 仅做词法 containment；用户可写路径还必须经过下方逐段 lstat/realpath 校验。
function isWithin(base, candidate) {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function realpathSync(fsImpl, target) {
  const native = fsImpl.realpathSync && fsImpl.realpathSync.native;
  return native ? native(target) : fsImpl.realpathSync(target);
}

function pathIdentity(stats, realPath) {
  return {
    dev: String(stats.dev),
    ino: String(stats.ino),
    mode: String(stats.mode),
    birthtime: String(stats.birthtimeNs ?? stats.birthtimeMs ?? ""),
    realPath: path.resolve(realPath),
  };
}

function sameFilesystemObject(left, right) {
  if (!left || !right) return left === right;
  if (left.dev !== right.dev || left.ino !== right.ino || left.mode !== right.mode) return false;
  // 少数网络/虚拟文件系统把 inode 固定为 0；此时再用创建时间降低误判风险。
  return left.ino !== "0" || left.birthtime === right.birthtime;
}

function samePathIdentity(left, right) {
  return sameFilesystemObject(left, right)
    && path.relative(left.realPath, right.realPath) === ""
    && path.relative(right.realPath, left.realPath) === "";
}

function lstatOrNull(fsImpl, target) {
  try {
    return fsImpl.lstatSync(target, { bigint: true });
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
    throw error;
  }
}

function assertPlainDirectory(fsImpl, target, label) {
  const stat = lstatOrNull(fsImpl, target);
  if (!stat) throw new Error(`${label}不存在：${target}`);
  if (stat.isSymbolicLink()) throw new Error(`${label}不能是符号链接、junction 或重解析点：${target}`);
  if (!stat.isDirectory()) throw new Error(`${label}不是目录：${target}`);
  const realPath = realpathSync(fsImpl, target);
  return { stat, identity: pathIdentity(stat, realPath), realPath };
}

function assertExpectedParent(projectRoot, parent, expectedParentRelative) {
  if (expectedParentRelative === undefined || expectedParentRelative === null) return;
  const expected = path.resolve(projectRoot, expectedParentRelative);
  if (path.relative(expected, parent) !== "" || path.relative(parent, expected) !== "") {
    throw new Error(`目标父目录不是受控目录 ${expectedParentRelative}`);
  }
}

// 对项目根及 root→parent 的每个现存目录逐段 lstat，并把真实路径与文件身份作为快照。
function inspectProjectDirectoryChain(projectRoot, parent, { fsImpl = fs } = {}) {
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) {
    throw new Error("项目路径必须是绝对路径");
  }
  if (typeof parent !== "string" || !path.isAbsolute(parent)) {
    throw new Error("目标父目录必须是绝对路径");
  }

  const resolvedRoot = path.resolve(projectRoot);
  const resolvedParent = path.resolve(parent);
  if (!isWithin(resolvedRoot, resolvedParent)) throw new Error("目标父目录越过项目边界");

  const root = assertPlainDirectory(fsImpl, resolvedRoot, "项目根目录");
  const records = [{
    lexicalPath: resolvedRoot,
    realPath: root.realPath,
    identity: root.identity,
  }];

  const relative = path.relative(resolvedRoot, resolvedParent);
  const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
  let current = resolvedRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    const directory = assertPlainDirectory(fsImpl, current, "项目内目录");
    if (!isWithin(root.realPath, directory.realPath)) {
      throw new Error(`项目内目录的真实路径越界：${current}`);
    }
    records.push({
      lexicalPath: current,
      realPath: directory.realPath,
      identity: directory.identity,
    });
  }

  return {
    projectRoot: resolvedRoot,
    projectRealPath: root.realPath,
    parent: resolvedParent,
    records,
  };
}

function sameDirectoryChain(left, right) {
  if (!left || !right || left.records.length !== right.records.length) return false;
  if (path.relative(left.projectRoot, right.projectRoot) !== "") return false;
  if (path.relative(left.parent, right.parent) !== "") return false;
  return left.records.every((record, index) => {
    const current = right.records[index];
    return record.lexicalPath === current.lexicalPath && samePathIdentity(record.identity, current.identity);
  });
}

function inspectExistingFile(fsImpl, chain, candidate, label) {
  const resolved = path.resolve(candidate);
  if (!isWithin(chain.projectRoot, resolved)) throw new Error(`${label}越过项目边界`);
  if (path.relative(chain.parent, path.dirname(resolved)) !== "") {
    throw new Error(`${label}不在已校验的父目录中`);
  }

  const stat = lstatOrNull(fsImpl, resolved);
  if (!stat) throw new Error(`${label}不存在：${resolved}`);
  if (stat.isSymbolicLink()) throw new Error(`${label}不能是符号链接、junction 或重解析点：${resolved}`);
  if (!stat.isFile()) throw new Error(`${label}不是普通文件：${resolved}`);
  if (BigInt(stat.nlink) > 1n) throw new Error(`${label}不能是硬链接：${resolved}`);
  const realPath = realpathSync(fsImpl, resolved);
  if (!isWithin(chain.projectRealPath, realPath)) throw new Error(`${label}的真实路径越界`);
  return {
    lexicalPath: resolved,
    realPath,
    identity: pathIdentity(stat, realPath),
  };
}

function assertSafeExistingProjectFile(projectRoot, candidate, {
  expectedParentRelative,
  fsImpl = fs,
} = {}) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error("项目文件路径必须是绝对路径");
  }
  const resolvedCandidate = path.resolve(candidate);
  const parent = path.dirname(resolvedCandidate);
  assertExpectedParent(path.resolve(projectRoot), parent, expectedParentRelative);
  const chain = inspectProjectDirectoryChain(projectRoot, parent, { fsImpl });
  const file = inspectExistingFile(fsImpl, chain, resolvedCandidate, "项目文件");
  return { chain, file, expectedParentRelative };
}

function assertSafeExistingProjectFileUnchanged(snapshot, { fsImpl = fs } = {}) {
  if (!snapshot || !snapshot.file || !snapshot.chain) throw new TypeError("路径安全快照非法");
  const current = assertSafeExistingProjectFile(
    snapshot.chain.projectRoot,
    snapshot.file.lexicalPath,
    { expectedParentRelative: snapshot.expectedParentRelative, fsImpl },
  );
  if (!sameDirectoryChain(snapshot.chain, current.chain)
      || !samePathIdentity(snapshot.file.identity, current.file.identity)) {
    throw new Error("项目文件或其父目录在操作期间发生变化");
  }
  return current;
}

function assertSafeProjectDirectory(projectRoot, candidate, {
  expectedParentRelative,
  fsImpl = fs,
} = {}) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error("项目目录路径必须是绝对路径");
  }
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedCandidate = path.resolve(candidate);
  assertExpectedParent(resolvedRoot, path.dirname(resolvedCandidate), expectedParentRelative);
  const chain = inspectProjectDirectoryChain(resolvedRoot, resolvedCandidate, { fsImpl });
  return { chain, expectedParentRelative };
}

function assertSafeProjectDirectoryUnchanged(snapshot, { fsImpl = fs } = {}) {
  if (!snapshot || !snapshot.chain) throw new TypeError("项目目录安全快照非法");
  const current = assertSafeProjectDirectory(
    snapshot.chain.projectRoot,
    snapshot.chain.parent,
    { expectedParentRelative: snapshot.expectedParentRelative, fsImpl },
  );
  if (!sameDirectoryChain(snapshot.chain, current.chain)) {
    throw new Error("项目目录在操作期间发生变化");
  }
  return current;
}

function inspectOptionalTarget(fsImpl, chain, target) {
  const stat = lstatOrNull(fsImpl, target);
  if (!stat) return null;
  return inspectExistingFile(fsImpl, chain, target, "写入目标");
}

function safelyRemoveTemporary(fsImpl, temporary, identity, expectedChain) {
  try {
    const currentChain = inspectProjectDirectoryChain(
      expectedChain.projectRoot,
      expectedChain.parent,
      { fsImpl },
    );
    if (!sameDirectoryChain(expectedChain, currentChain)) return;
    const current = inspectExistingFile(fsImpl, currentChain, temporary, "临时文件");
    if (!samePathIdentity(identity, current.identity)) return;
    fsImpl.unlinkSync(temporary);
  } catch {
    // 父目录身份不确定时绝不沿当前词法路径清理，避免二次越界。
  }
}

// 在受控项目目录中以同目录临时文件 + 原子 rename 写入；缺失的最终文件是合法情形。
function writeProjectFileAtomicSync(projectRoot, target, data, {
  expectedParentRelative,
  fsImpl = fs,
  randomBytes = crypto.randomBytes,
} = {}) {
  if (typeof target !== "string" || !path.isAbsolute(target)) {
    throw new Error("写入目标必须是绝对路径");
  }
  const resolvedTarget = path.resolve(target);
  const parent = path.dirname(resolvedTarget);
  assertExpectedParent(path.resolve(projectRoot), parent, expectedParentRelative);
  const before = inspectProjectDirectoryChain(projectRoot, parent, { fsImpl });
  const originalTarget = inspectOptionalTarget(fsImpl, before, resolvedTarget);

  let temporary = null;
  let temporaryIdentity = null;
  let descriptor = null;
  let committed = false;
  try {
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const token = randomBytes(16).toString("hex");
      temporary = path.join(parent, `.${path.basename(resolvedTarget)}.${process.pid}.${token}.tmp`);
      try {
        descriptor = fsImpl.openSync(temporary, flags, 0o600);
        break;
      } catch (error) {
        if (!error || error.code !== "EEXIST") throw error;
      }
    }
    if (descriptor === null) throw new Error("无法创建唯一的受控临时文件");

    // 打开后、写入任何用户内容前复核目录链，防止 open 前的目录换入。
    const afterOpen = inspectProjectDirectoryChain(projectRoot, parent, { fsImpl });
    if (!sameDirectoryChain(before, afterOpen)) throw new Error("写入父目录在打开临时文件时发生变化");
    const openedTemporary = inspectExistingFile(fsImpl, afterOpen, temporary, "临时文件");
    const descriptorIdentity = pathIdentity(fsImpl.fstatSync(descriptor, { bigint: true }), openedTemporary.realPath);
    if (!sameFilesystemObject(descriptorIdentity, openedTemporary.identity)) {
      throw new Error("临时文件描述符与目录项身份不一致");
    }
    temporaryIdentity = openedTemporary.identity;

    fsImpl.writeFileSync(descriptor, data);
    fsImpl.fsyncSync(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = null;

    // 写后、提交前再次复核完整父目录身份。
    const beforeCommit = inspectProjectDirectoryChain(projectRoot, parent, { fsImpl });
    if (!sameDirectoryChain(before, beforeCommit)) throw new Error("写入父目录在写入期间发生变化");
    const currentTemporary = inspectExistingFile(fsImpl, beforeCommit, temporary, "临时文件");
    if (!samePathIdentity(temporaryIdentity, currentTemporary.identity)) {
      throw new Error("临时文件在提交前发生变化");
    }

    const currentTarget = inspectOptionalTarget(fsImpl, beforeCommit, resolvedTarget);
    if ((originalTarget === null) !== (currentTarget === null)
        || (originalTarget && !samePathIdentity(originalTarget.identity, currentTarget.identity))) {
      throw new Error("写入目标在操作期间发生变化");
    }

    // rename 替换目录项本身，不跟随目标 symlink；预检仍会拒绝已经存在的链接。
    fsImpl.renameSync(temporary, resolvedTarget);
    committed = true;

    const afterCommit = inspectProjectDirectoryChain(projectRoot, parent, { fsImpl });
    if (!sameDirectoryChain(before, afterCommit)) throw new Error("写入父目录在提交后发生变化");
    const committedTarget = inspectExistingFile(fsImpl, afterCommit, resolvedTarget, "写入目标");
    if (!sameFilesystemObject(temporaryIdentity, committedTarget.identity)) {
      throw new Error("提交后的目标不是刚写入的文件");
    }
    return resolvedTarget;
  } finally {
    if (descriptor !== null) {
      try { fsImpl.closeSync(descriptor); } catch { /* best effort */ }
    }
    if (!committed && temporary && temporaryIdentity) {
      safelyRemoveTemporary(fsImpl, temporary, temporaryIdentity, before);
    }
  }
}

// 项目目录合法性：包含 project.json
function looksLikeProject(dir) {
  try {
    return fs.existsSync(path.join(dir, "project.json"));
  } catch {
    return false;
  }
}

module.exports = {
  appIsPackaged,
  repoRoot,
  resourcesRoot,
  pythonDir,
  configDir,
  samplesDir,
  toolsDir,
  pythonExecutableFor,
  pythonExecutable,
  isWithin,
  assertSafeExistingProjectFile,
  assertSafeExistingProjectFileUnchanged,
  assertSafeProjectDirectory,
  assertSafeProjectDirectoryUnchanged,
  writeProjectFileAtomicSync,
  looksLikeProject,
};
