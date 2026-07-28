"use strict";

const STORE_NAME = "oak-manuscript-ephemeral-v1";
const DEFAULT_PREFIX = "oak-manuscript/jobs/v1";
const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
const JOB_ID_PATTERN = /^webjob-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9/-]{0,126}[a-z0-9])?$/;
const STORE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const OBJECT_TYPES = new Set(["input", "output"]);
const RESULT_MEDIA_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/epub+zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
]);
const METADATA_KEYS = Object.freeze([
  "schema_version", "record_type", "job_id", "object_type", "delete_at", "media_type",
  "size_bytes",
]);

class NetlifyEphemeralStorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NetlifyEphemeralStorageError";
    this.code = code;
  }
}

function fail(code) {
  const messages = {
    OBJECT_ALREADY_EXISTS: "临时对象已存在且内容不一致",
    OBJECT_WRITE_UNCONFIRMED: "临时对象写入未得到确认",
    OBJECT_METADATA_INVALID: "临时对象元数据非法",
    OBJECT_CONTENT_INVALID: "临时对象内容非法",
    OBJECT_DELETE_UNCONFIRMED: "临时对象删除未得到确认",
    OBJECT_LIST_INVALID: "临时对象列表响应非法",
    STORAGE_UNAVAILABLE: "临时对象存储暂时不可用",
  };
  throw new NetlifyEphemeralStorageError(code, messages[code]);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function validateJobId(jobId) {
  if (typeof jobId !== "string" || !JOB_ID_PATTERN.test(jobId)) {
    throw new TypeError("jobId 必须是规范 Web 任务标识");
  }
  return jobId;
}

function validateBytes(bytes, maximum, label) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maximum) {
    throw new TypeError(`${label}必须是有界非空 Buffer`);
  }
  return bytes;
}

function validateMetadata(metadata, expectedType, expectedJobId) {
  if (!exactKeys(metadata, METADATA_KEYS) || metadata.schema_version !== "1.0" ||
      metadata.record_type !== "oak_manuscript_ephemeral_object" ||
      metadata.object_type !== expectedType || metadata.job_id !== expectedJobId ||
      !canonicalTime(metadata.delete_at) || !Number.isSafeInteger(metadata.size_bytes) ||
      metadata.size_bytes < 1) {
    fail("OBJECT_METADATA_INVALID");
  }
  const maximum = expectedType === "input" ? MAX_INPUT_BYTES : MAX_OUTPUT_BYTES;
  if (metadata.size_bytes > maximum ||
      (expectedType === "input" && metadata.media_type !== null) ||
      (expectedType === "output" && !RESULT_MEDIA_TYPES.has(metadata.media_type))) {
    fail("OBJECT_METADATA_INVALID");
  }
  return metadata;
}

function metadataEqual(left, right) {
  return exactKeys(left, METADATA_KEYS) && exactKeys(right, METADATA_KEYS) &&
    METADATA_KEYS.every((key) => left[key] === right[key]);
}

function validateStore(store) {
  const methods = ["set", "getWithMetadata", "getMetadata", "delete", "list"];
  if (!store || methods.some((name) => typeof store[name] !== "function")) {
    throw new TypeError("store 未实现完整 Netlify Blobs 接口");
  }
  return store;
}

function makeMetadata(jobId, objectType, bytes, deleteAt, mediaType) {
  if (!canonicalTime(deleteAt)) throw new TypeError("deleteAt 必须是规范 UTC 时间");
  return Object.freeze({
    schema_version: "1.0",
    record_type: "oak_manuscript_ephemeral_object",
    job_id: jobId,
    object_type: objectType,
    delete_at: deleteAt,
    media_type: mediaType,
    size_bytes: bytes.length,
  });
}

class NetlifyEphemeralStorage {
  constructor({ store, prefix = DEFAULT_PREFIX, clock = () => new Date() } = {}) {
    this.store = validateStore(store);
    if (typeof prefix !== "string" || !PREFIX_PATTERN.test(prefix) || prefix.includes("//") ||
        prefix.endsWith("/") || Buffer.byteLength(prefix, "utf8") > 128) {
      throw new TypeError("prefix 必须是规范的有界对象前缀");
    }
    if (typeof clock !== "function") throw new TypeError("clock 必须是函数");
    this.prefix = prefix;
    this.clock = clock;
  }

  _key(jobId, objectType) {
    validateJobId(jobId);
    if (!OBJECT_TYPES.has(objectType)) throw new TypeError("objectType 非法");
    return `${this.prefix}/${jobId}/${objectType}`;
  }

  _parseKey(key) {
    if (typeof key !== "string") return null;
    const match = key.match(new RegExp(`^${this.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\/(webjob-[0-9a-f-]+)\/(input|output)$`));
    if (!match || !JOB_ID_PATTERN.test(match[1])) return null;
    return Object.freeze({ job_id: match[1], object_type: match[2] });
  }

  async _readObject(jobId, objectType) {
    const key = this._key(jobId, objectType);
    let result;
    try {
      result = await this.store.getWithMetadata(key, { type: "arrayBuffer", consistency: "strong" });
    } catch {
      fail("STORAGE_UNAVAILABLE");
    }
    if (result === null) return null;
    if (!result || !(result.data instanceof ArrayBuffer)) fail("OBJECT_CONTENT_INVALID");
    const metadata = validateMetadata(result.metadata, objectType, jobId);
    const bytes = Buffer.from(result.data);
    if (bytes.length !== metadata.size_bytes) fail("OBJECT_CONTENT_INVALID");
    return Object.freeze({ bytes, metadata: Object.freeze({ ...metadata }) });
  }

  async _putObject(jobId, objectType, bytes, { deleteAt, mediaType }) {
    const key = this._key(jobId, objectType);
    const maximum = objectType === "input" ? MAX_INPUT_BYTES : MAX_OUTPUT_BYTES;
    validateBytes(bytes, maximum, objectType === "input" ? "输入" : "结果");
    if (objectType === "input" && mediaType !== null) throw new TypeError("输入对象不得记录结果媒体类型");
    if (objectType === "output" && !RESULT_MEDIA_TYPES.has(mediaType)) {
      throw new TypeError("结果媒体类型非法");
    }
    const metadata = makeMetadata(jobId, objectType, bytes, deleteAt, mediaType);
    let writeResult;
    try {
      writeResult = await this.store.set(key, bytes, { metadata, onlyIfNew: true });
    } catch {
      try {
        const existing = await this._readObject(jobId, objectType);
        if (existing && existing.bytes.equals(bytes) && metadataEqual(existing.metadata, metadata)) return;
      } catch {}
      fail("OBJECT_WRITE_UNCONFIRMED");
    }
    if (!writeResult || typeof writeResult.modified !== "boolean") fail("OBJECT_WRITE_UNCONFIRMED");
    if (writeResult.modified) return;
    const existing = await this._readObject(jobId, objectType);
    if (!existing || !existing.bytes.equals(bytes) || !metadataEqual(existing.metadata, metadata)) {
      fail("OBJECT_ALREADY_EXISTS");
    }
  }

  async putInput(jobId, bytes, { deleteAt } = {}) {
    return this._putObject(jobId, "input", bytes, { deleteAt, mediaType: null });
  }

  async putOutput(jobId, bytes, { deleteAt, mediaType } = {}) {
    return this._putObject(jobId, "output", bytes, { deleteAt, mediaType });
  }

  async readInput(jobId) {
    const object = await this._readObject(jobId, "input");
    return object ? Buffer.from(object.bytes) : null;
  }

  async readOutput(jobId) {
    const object = await this._readObject(jobId, "output");
    return object ? Buffer.from(object.bytes) : null;
  }

  async _deleteObject(jobId, objectType) {
    const key = this._key(jobId, objectType);
    try {
      await this.store.delete(key);
      const remaining = await this.store.getMetadata(key, { consistency: "strong" });
      if (remaining !== null) fail("OBJECT_DELETE_UNCONFIRMED");
    } catch (error) {
      if (error instanceof NetlifyEphemeralStorageError) throw error;
      fail("OBJECT_DELETE_UNCONFIRMED");
    }
  }

  async deleteInput(jobId) {
    return this._deleteObject(jobId, "input");
  }

  async deleteOutput(jobId) {
    return this._deleteObject(jobId, "output");
  }

  _now() {
    const value = this.clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError("clock 返回非法时间");
    return new Date(value.getTime());
  }

  async sweepExpiredObjects() {
    const now = this._now().getTime();
    let pages;
    try {
      pages = this.store.list({ prefix: `${this.prefix}/`, paginate: true });
    } catch {
      fail("STORAGE_UNAVAILABLE");
    }
    if (!pages || typeof pages[Symbol.asyncIterator] !== "function") fail("OBJECT_LIST_INVALID");
    const result = { scanned: 0, deleted: [], pending: [], invalid_keys: 0 };
    try {
      for await (const page of pages) {
        if (!page || !Array.isArray(page.blobs)) fail("OBJECT_LIST_INVALID");
        for (const blob of page.blobs) {
          result.scanned += 1;
          const identity = this._parseKey(blob?.key);
          if (!identity) {
            result.invalid_keys += 1;
            continue;
          }
          let found;
          try {
            found = await this.store.getMetadata(blob.key, { consistency: "strong" });
          } catch {
            result.pending.push(Object.freeze({ ...identity, reason: "metadata_unavailable" }));
            continue;
          }
          if (found === null) continue;
          let metadata;
          let reason = "expired";
          try {
            metadata = validateMetadata(found.metadata, identity.object_type, identity.job_id);
            if (Date.parse(metadata.delete_at) > now) continue;
          } catch {
            reason = "invalid_metadata";
          }
          try {
            await this._deleteObject(identity.job_id, identity.object_type);
            result.deleted.push(Object.freeze({ ...identity, reason }));
          } catch {
            result.pending.push(Object.freeze({ ...identity, reason }));
          }
        }
      }
    } catch (error) {
      if (error instanceof NetlifyEphemeralStorageError && error.code !== "OBJECT_DELETE_UNCONFIRMED") {
        throw error;
      }
      if (!(error instanceof NetlifyEphemeralStorageError)) fail("STORAGE_UNAVAILABLE");
      throw error;
    }
    return Object.freeze({
      scanned: result.scanned,
      deleted: Object.freeze(result.deleted),
      pending: Object.freeze(result.pending),
      invalid_keys: result.invalid_keys,
    });
  }
}

function createNetlifyEphemeralStorage({
  storeName = STORE_NAME,
  prefix = DEFAULT_PREFIX,
  clock,
  getStoreImpl,
} = {}) {
  if (typeof storeName !== "string" || !STORE_NAME_PATTERN.test(storeName) ||
      Buffer.byteLength(storeName, "utf8") > 64) {
    throw new TypeError("storeName 必须是规范的有界站点级 store 名称");
  }
  let factory = getStoreImpl;
  if (factory === undefined) {
    try {
      factory = require("@netlify/blobs").getStore;
    } catch {
      throw new TypeError("Web 子包尚未安装 @netlify/blobs");
    }
  }
  if (typeof factory !== "function") throw new TypeError("getStoreImpl 必须是函数");
  const store = factory({ name: storeName, consistency: "strong" });
  return new NetlifyEphemeralStorage({ store, prefix, clock });
}

module.exports = {
  DEFAULT_PREFIX,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  NetlifyEphemeralStorage,
  NetlifyEphemeralStorageError,
  STORE_NAME,
  createNetlifyEphemeralStorage,
};
