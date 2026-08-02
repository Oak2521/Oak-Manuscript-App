// SyncRecord 本地持久队列的加密、原子文件存储。
// 本模块不接触网络；密钥材料由 Electron safeStorage / OS 凭据系统持有。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const MAGIC = Buffer.from("OAKSYNC1", "ascii");
const HEADER_BYTES = MAGIC.length + 4;
const MAX_CIPHERTEXT_BYTES = 16 * 1024 * 1024;
const STATE_FILE = "queue-v1.enc";

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fail(message) {
  throw new Error(`同步持久队列错误：${message}`);
}

function statOrNull(fsImpl, target) {
  try { return fsImpl.lstatSync(target, { bigint: true }); }
  catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function assertSafeDirectory(fsImpl, target, label) {
  const stat = statOrNull(fsImpl, target);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} 不是安全目录`);
  return stat;
}

function assertSafeFile(fsImpl, target, label) {
  const stat = statOrNull(fsImpl, target);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size <= 0n) {
    fail(`${label} 不是安全的单链接常规文件`);
  }
  if (stat.size > BigInt(HEADER_BYTES + MAX_CIPHERTEXT_BYTES)) fail(`${label} 超过大小限制`);
  return stat;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.nlink === right.nlink;
}

function fsyncDirectoryBestEffort(fsImpl, directory) {
  let descriptor = null;
  try {
    descriptor = fsImpl.openSync(directory, fs.constants.O_RDONLY);
    fsImpl.fsyncSync(descriptor);
  } catch {
    // Windows may reject opening a directory. File fsync + atomic rename remain mandatory.
  } finally {
    if (descriptor !== null) fsImpl.closeSync(descriptor);
  }
}

function frameCiphertext(ciphertext) {
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length < 1 || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
    fail("加密结果非法");
  }
  const result = Buffer.allocUnsafe(HEADER_BYTES + ciphertext.length);
  MAGIC.copy(result, 0);
  result.writeUInt32BE(ciphertext.length, MAGIC.length);
  ciphertext.copy(result, HEADER_BYTES);
  return result;
}

function unframeCiphertext(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < HEADER_BYTES || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    fail("队列文件头非法");
  }
  const length = bytes.readUInt32BE(MAGIC.length);
  if (length < 1 || length > MAX_CIPHERTEXT_BYTES || bytes.length !== HEADER_BYTES + length) {
    fail("队列文件长度非法");
  }
  return bytes.subarray(HEADER_BYTES);
}

class EncryptedSyncStore {
  constructor({ rootDir, protect, unprotect, fsImpl = fs } = {}) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("sync rootDir 必须是绝对路径");
    if (typeof protect !== "function" || typeof unprotect !== "function") {
      throw new TypeError("sync protect/unprotect 非法");
    }
    this.rootDir = path.resolve(rootDir);
    this.statePath = path.join(this.rootDir, STATE_FILE);
    this.protect = protect;
    this.unprotect = unprotect;
    this.fs = fsImpl;
    this.encrypted = true;
    this._ensureRoot();
  }

  _ensureRoot() {
    const parent = path.dirname(this.rootDir);
    assertSafeDirectory(this.fs, parent, "同步队列父目录");
    const existing = statOrNull(this.fs, this.rootDir);
    if (existing === null) this.fs.mkdirSync(this.rootDir, { recursive: false, mode: 0o700 });
    assertSafeDirectory(this.fs, this.rootDir, "同步队列目录");
    const rootReal = this.fs.realpathSync.native
      ? this.fs.realpathSync.native(this.rootDir)
      : this.fs.realpathSync(this.rootDir);
    const parentReal = this.fs.realpathSync.native
      ? this.fs.realpathSync.native(parent)
      : this.fs.realpathSync(parent);
    if (path.dirname(rootReal) !== parentReal) fail("同步队列目录逃逸父目录");
  }

  _readBytes() {
    const initial = statOrNull(this.fs, this.statePath);
    if (initial === null) return null;
    const before = assertSafeFile(this.fs, this.statePath, "同步队列文件");
    const beforeReal = this.fs.realpathSync.native
      ? this.fs.realpathSync.native(this.statePath)
      : this.fs.realpathSync(this.statePath);
    const rootReal = this.fs.realpathSync.native
      ? this.fs.realpathSync.native(this.rootDir)
      : this.fs.realpathSync(this.rootDir);
    if (path.dirname(beforeReal) !== rootReal) fail("同步队列文件逃逸存储目录");
    const descriptor = this.fs.openSync(this.statePath, fs.constants.O_RDONLY);
    let bytes;
    try {
      bytes = Buffer.alloc(Number(before.size));
      let total = 0;
      while (total < bytes.length) {
        const count = this.fs.readSync(descriptor, bytes, total, bytes.length - total, total);
        if (count <= 0) fail("同步队列文件读取不完整");
        total += count;
      }
    } finally {
      this.fs.closeSync(descriptor);
    }
    const after = assertSafeFile(this.fs, this.statePath, "同步队列文件");
    const afterReal = this.fs.realpathSync.native
      ? this.fs.realpathSync.native(this.statePath)
      : this.fs.realpathSync(this.statePath);
    if (beforeReal !== afterReal || !sameIdentity(before, after)) fail("同步队列文件在读取期间发生变化");
    return bytes;
  }

  load() {
    const framed = this._readBytes();
    if (framed === null) return null;
    let plaintext;
    try {
      plaintext = this.unprotect(Buffer.from(unframeCiphertext(framed)));
    } catch (error) {
      fail(`无法用系统安全存储解密：${String(error && error.message || error)}`);
    }
    if (typeof plaintext !== "string" || Buffer.byteLength(plaintext, "utf8") > MAX_CIPHERTEXT_BYTES) {
      fail("解密后的队列状态非法");
    }
    let value;
    try { value = JSON.parse(plaintext); }
    catch { fail("解密后的队列 JSON 非法"); }
    if (canonicalJson(value) !== plaintext) fail("队列状态不是 canonical JSON");
    return value;
  }

  save(value, { expectedRevision } = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new TypeError("expectedRevision 非法");
    }
    this._ensureRoot();
    const current = this.load();
    const currentRevision = current === null ? 0 : current.revision;
    if (currentRevision !== expectedRevision) fail("队列状态 revision 已变化，拒绝覆盖");
    const plaintext = canonicalJson(value);
    let ciphertext;
    try { ciphertext = this.protect(plaintext); }
    catch (error) { fail(`系统安全存储加密失败：${String(error && error.message || error)}`); }
    const framed = frameCiphertext(ciphertext);
    const staged = path.join(
      this.rootDir,
      `.queue-v1-${process.pid}-${Date.now()}-${randomUUID()}.tmp`,
    );
    let descriptor = null;
    try {
      descriptor = this.fs.openSync(staged, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      let total = 0;
      while (total < framed.length) {
        const count = this.fs.writeSync(descriptor, framed, total, framed.length - total, total);
        if (count <= 0) fail("同步队列候选文件写入不完整");
        total += count;
      }
      this.fs.fsyncSync(descriptor);
      this.fs.closeSync(descriptor);
      descriptor = null;
      assertSafeFile(this.fs, staged, "同步队列候选文件");
      this.fs.renameSync(staged, this.statePath);
      fsyncDirectoryBestEffort(this.fs, this.rootDir);
      const committed = this.load();
      if (canonicalJson(committed) !== plaintext) fail("同步队列提交后复验不一致");
      return committed;
    } finally {
      if (descriptor !== null) {
        try { this.fs.closeSync(descriptor); } catch {}
      }
      const stagedStat = statOrNull(this.fs, staged);
      if (stagedStat && stagedStat.isFile() && !stagedStat.isSymbolicLink() && stagedStat.nlink === 1n) {
        try { this.fs.unlinkSync(staged); } catch {}
      }
    }
  }
}

module.exports = {
  EncryptedSyncStore,
  MAGIC,
  MAX_CIPHERTEXT_BYTES,
  STATE_FILE,
  canonicalJson,
  frameCiphertext,
  unframeCiphertext,
};
