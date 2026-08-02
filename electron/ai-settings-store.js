"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const MAGIC = Buffer.from("OAKAI001", "ascii");
const HEADER_BYTES = MAGIC.length + 4;
const MAX_CIPHERTEXT_BYTES = 64 * 1024;
const STATE_FILE = "settings-v1.enc";

function canonicalJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function fail(message) { throw new Error(`AI 设置存储错误：${message}`); }

function statOrNull(fsImpl, target) {
  try { return fsImpl.lstatSync(target, { bigint: true }); }
  catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function safeDirectory(fsImpl, target, label) {
  const stat = statOrNull(fsImpl, target);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} 不是安全目录`);
  return stat;
}

function safeFile(fsImpl, target, label) {
  const stat = statOrNull(fsImpl, target);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size <= 0n ||
      stat.size > BigInt(HEADER_BYTES + MAX_CIPHERTEXT_BYTES)) {
    fail(`${label} 不是安全的有界单链接文件`);
  }
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

function realpath(fsImpl, target) {
  return fsImpl.realpathSync.native
    ? fsImpl.realpathSync.native(target)
    : fsImpl.realpathSync(target);
}

function frame(ciphertext) {
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length < 1 || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
    fail("加密结果非法");
  }
  const bytes = Buffer.allocUnsafe(HEADER_BYTES + ciphertext.length);
  MAGIC.copy(bytes);
  bytes.writeUInt32BE(ciphertext.length, MAGIC.length);
  ciphertext.copy(bytes, HEADER_BYTES);
  return bytes;
}

function unframe(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < HEADER_BYTES ||
      !bytes.subarray(0, MAGIC.length).equals(MAGIC)) fail("文件头非法");
  const length = bytes.readUInt32BE(MAGIC.length);
  if (length < 1 || length > MAX_CIPHERTEXT_BYTES || bytes.length !== HEADER_BYTES + length) {
    fail("文件长度非法");
  }
  return bytes.subarray(HEADER_BYTES);
}

class EncryptedAISettingsStore {
  constructor({ rootDir, protect, unprotect, fsImpl = fs } = {}) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) {
      throw new TypeError("AI rootDir 必须是绝对路径");
    }
    if (typeof protect !== "function" || typeof unprotect !== "function") {
      throw new TypeError("AI protect/unprotect 非法");
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
    safeDirectory(this.fs, parent, "AI 设置父目录");
    if (statOrNull(this.fs, this.rootDir) === null) {
      this.fs.mkdirSync(this.rootDir, { recursive: false, mode: 0o700 });
    }
    safeDirectory(this.fs, this.rootDir, "AI 设置目录");
    if (path.dirname(realpath(this.fs, this.rootDir)) !== realpath(this.fs, parent)) {
      fail("AI 设置目录逃逸父目录");
    }
  }

  _readBytes() {
    if (statOrNull(this.fs, this.statePath) === null) return null;
    const before = safeFile(this.fs, this.statePath, "AI 设置文件");
    const beforeReal = realpath(this.fs, this.statePath);
    const rootReal = realpath(this.fs, this.rootDir);
    if (path.dirname(beforeReal) !== rootReal) fail("AI 设置文件逃逸存储目录");
    const descriptor = this.fs.openSync(this.statePath, fs.constants.O_RDONLY);
    let bytes;
    try {
      bytes = Buffer.alloc(Number(before.size));
      let total = 0;
      while (total < bytes.length) {
        const count = this.fs.readSync(descriptor, bytes, total, bytes.length - total, total);
        if (count <= 0) fail("AI 设置文件读取不完整");
        total += count;
      }
    } finally { this.fs.closeSync(descriptor); }
    const after = safeFile(this.fs, this.statePath, "AI 设置文件");
    const afterReal = realpath(this.fs, this.statePath);
    if (beforeReal !== afterReal || !sameIdentity(before, after)) fail("AI 设置读取期间发生变化");
    return bytes;
  }

  load() {
    const bytes = this._readBytes();
    if (bytes === null) return null;
    let plaintext;
    try { plaintext = this.unprotect(Buffer.from(unframe(bytes))); }
    catch { fail("无法用系统安全存储解密"); }
    if (typeof plaintext !== "string" || Buffer.byteLength(plaintext, "utf8") > MAX_CIPHERTEXT_BYTES) {
      fail("解密状态非法");
    }
    let value;
    try { value = JSON.parse(plaintext); } catch { fail("解密 JSON 非法"); }
    if (canonicalJson(value) !== plaintext) fail("状态不是 canonical JSON");
    return value;
  }

  save(value, { expectedRevision } = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new TypeError("expectedRevision 非法");
    }
    this._ensureRoot();
    const current = this.load();
    const currentRevision = current === null ? 0 : current.revision;
    if (currentRevision !== expectedRevision) fail("revision 已变化，拒绝覆盖");
    let encrypted;
    try { encrypted = this.protect(canonicalJson(value)); } catch { fail("系统安全存储加密失败"); }
    const bytes = frame(encrypted);
    const staged = path.join(this.rootDir,
      `.settings-v1-${process.pid}-${Date.now()}-${randomUUID()}.tmp`);
    let descriptor = null;
    try {
      descriptor = this.fs.openSync(staged,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      let total = 0;
      while (total < bytes.length) {
        const count = this.fs.writeSync(descriptor, bytes, total, bytes.length - total, total);
        if (count <= 0) fail("候选文件写入不完整");
        total += count;
      }
      this.fs.fsyncSync(descriptor);
      this.fs.closeSync(descriptor);
      descriptor = null;
      safeFile(this.fs, staged, "AI 设置候选文件");
      this.fs.renameSync(staged, this.statePath);
      fsyncDirectoryBestEffort(this.fs, this.rootDir);
      const committed = this.load();
      if (canonicalJson(committed) !== canonicalJson(value)) fail("提交后复验不一致");
      return committed;
    } finally {
      if (descriptor !== null) try { this.fs.closeSync(descriptor); } catch {}
      const stat = statOrNull(this.fs, staged);
      if (stat && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n) {
        try { this.fs.unlinkSync(staged); } catch {}
      }
    }
  }
}

module.exports = { EncryptedAISettingsStore, MAGIC, STATE_FILE, canonicalJson, frame, unframe };
