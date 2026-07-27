"use strict";

// A repository-tracked lock is itself a trust input.  Updating it must not
// follow links or truncate the last-known-good file.  This module deliberately
// has no project-specific imports so pre-execution verifiers can use it without
// creating dependency cycles.

const fs = require("fs");
const path = require("path");

function normalizedPath(value) {
  let result = path.normalize(String(value));
  if (process.platform === "win32") {
    result = result
      .replace(/^\\\\\?\\UNC\\/iu, "\\\\")
      .replace(/^\\\\\?\\/u, "")
      .toLowerCase();
  }
  return result;
}

function pathInside(root, target, { allowRoot = false } = {}) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (allowRoot && relative === "") ||
    (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function requireDirectory(target, label) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} 必须是普通目录且不得为链接/reparse：${target}`);
  }
  return stat;
}

function ensureSafeDirectoryChain(root, target, { create = false, label = "受控目录" } = {}) {
  const projectRoot = path.resolve(root);
  const directory = path.resolve(target);
  if (!pathInside(projectRoot, directory, { allowRoot: true })) {
    throw new Error(`${label} 路径逃逸项目根：${directory}`);
  }
  requireDirectory(projectRoot, "项目根");
  const realRoot = fs.realpathSync.native(projectRoot);
  if (normalizedPath(realRoot) !== normalizedPath(projectRoot)) {
    throw new Error(`项目根经过链接或 reparse 重定向：${projectRoot}`);
  }

  let cursor = projectRoot;
  for (const segment of path.relative(projectRoot, directory).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let stat = fs.lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat && create) {
      try {
        fs.mkdirSync(cursor);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      stat = fs.lstatSync(cursor, { throwIfNoEntry: false });
    }
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} 路径链含缺失项、非目录、链接或 reparse：${cursor}`);
    }
    const relative = path.relative(projectRoot, cursor);
    const expectedReal = path.join(realRoot, relative);
    const actualReal = fs.realpathSync.native(cursor);
    if (normalizedPath(actualReal) !== normalizedPath(expectedReal)) {
      throw new Error(`${label} 路径链经过链接或 reparse 重定向：${cursor}`);
    }
  }
  return directory;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink;
}

function readSafeRegularFile(root, target, label, { allowMissing = false } = {}) {
  const projectRoot = path.resolve(root);
  const absolute = path.resolve(target);
  if (!pathInside(projectRoot, absolute)) {
    throw new Error(`${label} 路径逃逸项目根：${absolute}`);
  }
  ensureSafeDirectoryChain(projectRoot, path.dirname(absolute), { label: `${label} 父目录` });
  const before = fs.lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  if (!before) {
    if (allowMissing) return null;
    throw new Error(`${label} 缺失：${absolute}`);
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0n || before.nlink !== 1n) {
    throw new Error(`${label} 必须是非空、单链接普通文件且不得为链接/reparse：${absolute}`);
  }
  const expectedReal = path.join(
    fs.realpathSync.native(projectRoot),
    path.relative(projectRoot, absolute),
  );
  if (normalizedPath(fs.realpathSync.native(absolute)) !== normalizedPath(expectedReal)) {
    throw new Error(`${label} 经过链接或 reparse 重定向：${absolute}`);
  }
  const bytes = fs.readFileSync(absolute);
  const after = fs.lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  if (!after || !sameIdentity(before, after) || BigInt(bytes.length) !== after.size) {
    throw new Error(`${label} 在安全读取期间发生变化：${absolute}`);
  }
  return { bytes, stat: after };
}

function writeAllAndSync(target, bytes, fsync = fs.fsyncSync) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      target,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (!Number.isSafeInteger(written) || written <= 0) {
        throw new Error(`独占候选文件写入未取得进展：${target}`);
      }
      offset += written;
    }
    fsync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function unlinkSafeKnownFile(root, target, label) {
  const record = readSafeRegularFile(root, target, label, { allowMissing: true });
  if (record) fs.unlinkSync(target);
}

function cleanupTransaction(root, transaction, paths) {
  for (const [target, label] of paths) unlinkSafeKnownFile(root, target, label);
  fs.rmdirSync(transaction);
}

function atomicReplaceTrackedFile({
  root,
  target,
  bytes,
  verify,
  rename = fs.renameSync,
  fsync = fs.fsyncSync,
  beforeCommit = null,
}) {
  const projectRoot = path.resolve(root);
  const destination = path.resolve(target);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new TypeError("tracked file 候选内容必须是非空 Buffer");
  }
  if (typeof verify !== "function" || typeof rename !== "function" ||
      typeof fsync !== "function" || (beforeCommit !== null && typeof beforeCommit !== "function")) {
    throw new TypeError("tracked file 事务依赖参数非法");
  }
  const parent = ensureSafeDirectoryChain(projectRoot, path.dirname(destination), {
    create: true,
    label: "tracked file 父目录",
  });
  const previous = readSafeRegularFile(projectRoot, destination, "现有 tracked file", {
    allowMissing: true,
  });
  const transaction = fs.mkdtempSync(path.join(parent, `.${path.basename(destination)}.txn-`));
  ensureSafeDirectoryChain(projectRoot, transaction, { label: "tracked file 事务目录" });
  const candidate = path.join(transaction, "candidate.json");
  const backup = path.join(transaction, "previous.json");
  let committed = false;
  let verification;

  try {
    writeAllAndSync(candidate, bytes, fsync);
    const candidateRecord = readSafeRegularFile(
      projectRoot,
      candidate,
      "tracked file 候选",
    );
    if (!candidateRecord.bytes.equals(bytes)) throw new Error("tracked file 候选写后字节不一致");
    if (previous) {
      writeAllAndSync(backup, previous.bytes, fsync);
      const backupRecord = readSafeRegularFile(projectRoot, backup, "tracked file 备份");
      if (!backupRecord.bytes.equals(previous.bytes)) {
        throw new Error("tracked file 备份写后字节不一致");
      }
    }

    if (beforeCommit) beforeCommit({ destination, transaction, candidate, backup });
    ensureSafeDirectoryChain(projectRoot, parent, { label: "tracked file 提交父目录" });
    const current = readSafeRegularFile(projectRoot, destination, "提交前 tracked file", {
      allowMissing: true,
    });
    if ((previous === null) !== (current === null) ||
        (previous && (!sameIdentity(previous.stat, current.stat) ||
          !previous.bytes.equals(current.bytes)))) {
      throw new Error("tracked file 在事务提交前发生并发替换或字节变化");
    }

    rename(candidate, destination);
    committed = true;
    const installed = readSafeRegularFile(projectRoot, destination, "已换入 tracked file");
    if (!installed.bytes.equals(bytes)) throw new Error("tracked file 原子换入后字节不一致");
    verification = verify();
    if (verification === false) throw new Error("tracked file 换入后验证明确返回失败");

    if (previous) unlinkSafeKnownFile(projectRoot, backup, "tracked file 成功备份");
    // At this point the verified replacement is committed.  Failure to remove
    // an otherwise empty transaction directory must not destroy that result.
    let cleanupArtifact = null;
    try {
      fs.rmdirSync(transaction);
    } catch (_error) {
      cleanupArtifact = transaction;
    }
    return { destination, previous: previous !== null, verification, cleanupArtifact };
  } catch (error) {
    const rollbackErrors = [];
    if (committed) {
      try {
        if (previous) {
          const backupRecord = readSafeRegularFile(projectRoot, backup, "回滚 tracked file 备份");
          if (!backupRecord.bytes.equals(previous.bytes)) {
            throw new Error("回滚备份字节与原文件不一致");
          }
          rename(backup, destination);
          const restored = readSafeRegularFile(projectRoot, destination, "回滚后的 tracked file");
          if (!restored.bytes.equals(previous.bytes)) throw new Error("回滚后旧字节未恢复");
        } else {
          rename(destination, candidate);
          if (fs.lstatSync(destination, { throwIfNoEntry: false })) {
            throw new Error("回滚后原本不存在的 tracked file 仍然存在");
          }
        }
        committed = false;
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    } else {
      try {
        const current = readSafeRegularFile(projectRoot, destination, "失败后的 tracked file", {
          allowMissing: true,
        });
        if ((previous === null) !== (current === null) ||
            (previous && !previous.bytes.equals(current.bytes))) {
          throw new Error("forward rename 失败后旧 tracked file 状态不一致");
        }
      } catch (stateError) {
        rollbackErrors.push(stateError.message);
      }
    }

    if (rollbackErrors.length > 0) {
      throw new Error(
        `tracked file 换入失败：${error.message}；事务回滚也失败：`
        + `${rollbackErrors.join("；")}；证据保留于 ${transaction}`,
        { cause: error },
      );
    }
    try {
      cleanupTransaction(projectRoot, transaction, [
        [candidate, "回滚候选"],
        [backup, "回滚备份"],
      ]);
    } catch (cleanupError) {
      throw new Error(
        `tracked file 换入失败：${error.message}；旧状态已恢复，但事务清理失败：`
        + `${cleanupError.message}；证据保留于 ${transaction}`,
        { cause: error },
      );
    }
    throw error;
  }
}

module.exports = {
  atomicReplaceTrackedFile,
  ensureSafeDirectoryChain,
  readSafeRegularFile,
};
