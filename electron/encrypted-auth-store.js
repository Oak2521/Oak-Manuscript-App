"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const MAGIC = Buffer.from("OAKAUTH1", "ascii");
const HEADER_BYTES = MAGIC.length + 4;
const MAX_CIPHERTEXT_BYTES = 128 * 1024;
const STATE_FILE = "session-v1.enc";

function canonicalJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function fail(message) { throw new Error(`账号会话存储错误：${message}`); }
function statOrNull(fsImpl, target) {
  try { return fsImpl.lstatSync(target, { bigint: true }); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
function safeDirectory(fsImpl, target, label) {
  const stat = statOrNull(fsImpl, target);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} 不是安全目录`);
  return stat;
}
function safeFile(fsImpl, target, label) {
  const stat = statOrNull(fsImpl, target);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size <= 0n ||
      stat.size > BigInt(HEADER_BYTES + MAX_CIPHERTEXT_BYTES)) fail(`${label} 不是安全的有界单链接文件`);
  return stat;
}
function realpath(fsImpl, target) {
  return fsImpl.realpathSync.native ? fsImpl.realpathSync.native(target) : fsImpl.realpathSync(target);
}
function sameIdentity(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeNs === b.mtimeNs && a.nlink === b.nlink;
}
function frame(ciphertext) {
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length < 1 || ciphertext.length > MAX_CIPHERTEXT_BYTES) fail("加密结果非法");
  const bytes = Buffer.allocUnsafe(HEADER_BYTES + ciphertext.length);
  MAGIC.copy(bytes); bytes.writeUInt32BE(ciphertext.length, MAGIC.length); ciphertext.copy(bytes, HEADER_BYTES);
  return bytes;
}
function unframe(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < HEADER_BYTES || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) fail("文件头非法");
  const length = bytes.readUInt32BE(MAGIC.length);
  if (length < 1 || length > MAX_CIPHERTEXT_BYTES || bytes.length !== HEADER_BYTES + length) fail("文件长度非法");
  return bytes.subarray(HEADER_BYTES);
}
function fsyncDirectoryBestEffort(fsImpl, directory) {
  let fd = null;
  try { fd = fsImpl.openSync(directory, fs.constants.O_RDONLY); fsImpl.fsyncSync(fd); }
  catch {} finally { if (fd !== null) fsImpl.closeSync(fd); }
}

class EncryptedAuthStore {
  constructor({ rootDir, protect, unprotect, fsImpl = fs } = {}) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("auth rootDir 必须是绝对路径");
    if (typeof protect !== "function" || typeof unprotect !== "function") throw new TypeError("auth protect/unprotect 非法");
    this.rootDir = path.resolve(rootDir); this.statePath = path.join(this.rootDir, STATE_FILE);
    this.protect = protect; this.unprotect = unprotect; this.fs = fsImpl; this.encrypted = true;
    this._ensureRoot();
  }
  _ensureRoot() {
    const parent = path.dirname(this.rootDir); safeDirectory(this.fs, parent, "账号会话父目录");
    if (statOrNull(this.fs, this.rootDir) === null) this.fs.mkdirSync(this.rootDir, { recursive: false, mode: 0o700 });
    safeDirectory(this.fs, this.rootDir, "账号会话目录");
    if (path.dirname(realpath(this.fs, this.rootDir)) !== realpath(this.fs, parent)) fail("账号会话目录逃逸父目录");
  }
  _readBytes() {
    if (statOrNull(this.fs, this.statePath) === null) return null;
    const before = safeFile(this.fs, this.statePath, "账号会话文件");
    const beforeReal = realpath(this.fs, this.statePath);
    if (path.dirname(beforeReal) !== realpath(this.fs, this.rootDir)) fail("账号会话文件逃逸存储目录");
    const fd = this.fs.openSync(this.statePath, fs.constants.O_RDONLY);
    let bytes;
    try {
      bytes = Buffer.alloc(Number(before.size)); let total = 0;
      while (total < bytes.length) { const n = this.fs.readSync(fd, bytes, total, bytes.length - total, total); if (n <= 0) fail("读取不完整"); total += n; }
    } finally { this.fs.closeSync(fd); }
    const after = safeFile(this.fs, this.statePath, "账号会话文件");
    if (beforeReal !== realpath(this.fs, this.statePath) || !sameIdentity(before, after)) fail("读取期间文件发生变化");
    return bytes;
  }
  load() {
    const bytes = this._readBytes(); if (bytes === null) return null;
    let plaintext; try { plaintext = this.unprotect(Buffer.from(unframe(bytes))); } catch { fail("无法用系统安全存储解密"); }
    if (typeof plaintext !== "string" || Buffer.byteLength(plaintext, "utf8") > MAX_CIPHERTEXT_BYTES) fail("解密状态非法");
    let value; try { value = JSON.parse(plaintext); } catch { fail("解密 JSON 非法"); }
    if (canonicalJson(value) !== plaintext) fail("状态不是 canonical JSON");
    return value;
  }
  save(value, { expectedRevision } = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError("expectedRevision 非法");
    this._ensureRoot(); const current = this.load();
    if ((current === null ? 0 : current.revision) !== expectedRevision) fail("revision 已变化，拒绝覆盖");
    let ciphertext; try { ciphertext = this.protect(canonicalJson(value)); } catch { fail("系统安全存储加密失败"); }
    const bytes = frame(ciphertext);
    const staged = path.join(this.rootDir, `.session-v1-${process.pid}-${Date.now()}-${randomUUID()}.tmp`);
    let fd = null;
    try {
      fd = this.fs.openSync(staged, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      let total = 0; while (total < bytes.length) { const n = this.fs.writeSync(fd, bytes, total, bytes.length - total, total); if (n <= 0) fail("候选文件写入不完整"); total += n; }
      this.fs.fsyncSync(fd); this.fs.closeSync(fd); fd = null; safeFile(this.fs, staged, "账号会话候选文件");
      this.fs.renameSync(staged, this.statePath); fsyncDirectoryBestEffort(this.fs, this.rootDir);
      const committed = this.load(); if (canonicalJson(committed) !== canonicalJson(value)) fail("提交后复验不一致");
      return committed;
    } finally {
      if (fd !== null) try { this.fs.closeSync(fd); } catch {}
      const stat = statOrNull(this.fs, staged); if (stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n) try { this.fs.unlinkSync(staged); } catch {}
    }
  }
}

module.exports = { EncryptedAuthStore, MAGIC, STATE_FILE, canonicalJson, frame, unframe };
