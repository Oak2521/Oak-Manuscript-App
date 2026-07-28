"use strict";

const { createHash, randomUUID } = require("node:crypto");

const JOB_STATES = Object.freeze([
  "awaiting_upload",
  "queued",
  "processing",
  "result_ready",
  "deletion_pending",
]);
const PRINCIPAL_KINDS = new Set(["account", "anonymous"]);
const DOCUMENT_FORMATS = new Set(["docx", "md", "txt", "epub"]);
const MANUSCRIPT_TYPES = new Set(["paper", "print_book", "ebook"]);
const CHECK_CONFIGS = new Set(["quick", "full"]);
const CITATION_STYLES = new Set([
  "default",
  "gbt7714-2025",
  "apa-7",
  "chicago-18-nb",
  "chicago-18-ad",
  "none",
]);
const INPUT_MEDIA_TYPES = Object.freeze({
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown",
  txt: "text/plain",
  epub: "application/epub+zip",
});
const RESULT_MEDIA_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/epub+zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
]);
const CREATE_KEYS = Object.freeze([
  "schema_version", "request_type", "idempotency_key", "consent", "document",
]);
const CONSENT_KEYS = Object.freeze([
  "granted", "scope", "privacy_version", "granted_at",
]);
const DOCUMENT_KEYS = Object.freeze([
  "format", "manuscript_type", "check_config", "citation_style", "size_bytes",
]);
const PRINCIPAL_KEYS = Object.freeze(["kind", "subject_id"]);
const UPLOAD_KEYS = Object.freeze(["bytes", "media_type"]);
const UPLOAD_INTENT_KEYS = Object.freeze(["size_bytes", "media_type"]);
const PUBLIC_JOB_KEYS = Object.freeze([
  "schema_version", "record_type", "job_id", "state", "created_at", "expires_at",
  "input_retained", "result_available", "deletion_due_at",
]);
const RECEIPT_KEYS = Object.freeze([
  "schema_version", "receipt_type", "job_id", "reason", "deleted_at",
  "input_deleted", "output_deleted",
]);
const DELETION_REASONS = new Set(["canceled", "expired", "user_deleted", "processing_failed"]);
const ACTIVE_STATES = new Set(JOB_STATES);
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_RESULT_BYTES = 100 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class WebJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WebJobError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new WebJobError(code, message);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_REQUEST", `${label} 必须是对象`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(plainObject(value, label)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("INVALID_REQUEST", `${label} 字段集合非法`);
  }
}

function safeString(value, label, pattern, maxLength = 128) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength ||
      (pattern && !pattern.test(value))) {
    fail("INVALID_REQUEST", `${label} 非法`);
  }
  return value;
}

function exactEnum(value, allowed, label) {
  if (!allowed.has(value)) fail("INVALID_REQUEST", `${label} 非法`);
  return value;
}

function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail("INVALID_REQUEST", `${label} 非法`);
  }
  return value;
}

function isoTime(value, label) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
      Number.isNaN(Date.parse(value))) {
    fail("INVALID_REQUEST", `${label} 非法`);
  }
  return value;
}

function currentDate(clock) {
  const value = clock();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock 必须返回有效时间");
  return date;
}

function normalizePrincipal(input) {
  exactKeys(input, PRINCIPAL_KEYS, "principal");
  return {
    kind: exactEnum(input.kind, PRINCIPAL_KINDS, "principal.kind"),
    subject_id: safeString(
      input.subject_id,
      "principal.subject_id",
      /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/,
    ),
  };
}

function validateCreateRequest(input, { maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES } = {}) {
  exactKeys(input, CREATE_KEYS, "创建任务请求");
  if (input.schema_version !== "1.0" || input.request_type !== "oak_manuscript_web_job") {
    fail("INVALID_REQUEST", "Web 作业 schema 或类型非法");
  }
  safeString(
    input.idempotency_key,
    "idempotency_key",
    /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/,
  );

  exactKeys(input.consent, CONSENT_KEYS, "consent");
  if (input.consent.granted !== true || input.consent.scope !== "single_job_processing") {
    fail("CONSENT_REQUIRED", "必须明确同意本次稿件处理");
  }
  safeString(
    input.consent.privacy_version,
    "consent.privacy_version",
    /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/,
  );
  isoTime(input.consent.granted_at, "consent.granted_at");

  exactKeys(input.document, DOCUMENT_KEYS, "document");
  exactEnum(input.document.format, DOCUMENT_FORMATS, "document.format");
  exactEnum(input.document.manuscript_type, MANUSCRIPT_TYPES, "document.manuscript_type");
  exactEnum(input.document.check_config, CHECK_CONFIGS, "document.check_config");
  exactEnum(input.document.citation_style, CITATION_STYLES, "document.citation_style");
  positiveInteger(input.document.size_bytes, "document.size_bytes", maxUploadBytes);
  return true;
}

function canonicalCreateRequest(input) {
  return JSON.stringify({
    schema_version: input.schema_version,
    request_type: input.request_type,
    idempotency_key: input.idempotency_key,
    consent: {
      granted: input.consent.granted,
      scope: input.consent.scope,
      privacy_version: input.consent.privacy_version,
      granted_at: input.consent.granted_at,
    },
    document: {
      format: input.document.format,
      manuscript_type: input.document.manuscript_type,
      check_config: input.document.check_config,
      citation_style: input.document.citation_style,
      size_bytes: input.document.size_bytes,
    },
  });
}

function requestFingerprint(input) {
  return createHash("sha256").update(canonicalCreateRequest(input), "utf8").digest("hex");
}

function validatePublicJob(input) {
  exactKeys(input, PUBLIC_JOB_KEYS, "公开任务状态");
  if (input.schema_version !== "1.0" || input.record_type !== "oak_manuscript_web_job_status") {
    fail("INVALID_STATE", "公开任务状态 schema 或类型非法");
  }
  safeString(input.job_id, "job_id", new RegExp(`^webjob-${UUID_PATTERN.source.slice(1, -1)}$`));
  exactEnum(input.state, new Set(JOB_STATES), "state");
  isoTime(input.created_at, "created_at");
  isoTime(input.expires_at, "expires_at");
  isoTime(input.deletion_due_at, "deletion_due_at");
  if (typeof input.input_retained !== "boolean" || typeof input.result_available !== "boolean") {
    fail("INVALID_STATE", "公开任务布尔状态非法");
  }
  return true;
}

function validateDeletionReceipt(input) {
  exactKeys(input, RECEIPT_KEYS, "删除回执");
  if (input.schema_version !== "1.0" || input.receipt_type !== "oak_manuscript_web_job_deletion") {
    fail("INVALID_STATE", "删除回执 schema 或类型非法");
  }
  safeString(input.job_id, "job_id", new RegExp(`^webjob-${UUID_PATTERN.source.slice(1, -1)}$`));
  exactEnum(input.reason, DELETION_REASONS, "reason");
  isoTime(input.deleted_at, "deleted_at");
  if (input.input_deleted !== true || input.output_deleted !== true) {
    fail("INVALID_STATE", "删除回执不得声称未完成删除");
  }
  return true;
}

class MemoryEphemeralStorage {
  constructor() {
    this.inputs = new Map();
    this.outputs = new Map();
  }

  async putInput(jobId, bytes, { deleteAt }) {
    this.inputs.set(jobId, { bytes: Buffer.from(bytes), deleteAt });
  }

  async putOutput(jobId, bytes, { deleteAt, mediaType }) {
    this.outputs.set(jobId, { bytes: Buffer.from(bytes), deleteAt, mediaType });
  }

  async readOutput(jobId) {
    const entry = this.outputs.get(jobId);
    return entry ? Buffer.from(entry.bytes) : null;
  }

  async deleteInput(jobId) {
    this.inputs.delete(jobId);
  }

  async deleteOutput(jobId) {
    this.outputs.delete(jobId);
  }

  inspect(jobId) {
    const input = this.inputs.get(jobId);
    const output = this.outputs.get(jobId);
    return {
      input_present: Boolean(input),
      output_present: Boolean(output),
      input_delete_at: input ? input.deleteAt : null,
      output_delete_at: output ? output.deleteAt : null,
      output_media_type: output ? output.mediaType : null,
    };
  }
}

class WebJobService {
  constructor({
    storage = new MemoryEphemeralStorage(),
    clock = () => new Date(),
    uuidFactory = randomUUID,
    ttlMs = DEFAULT_TTL_MS,
    maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
    maxResultBytes = DEFAULT_MAX_RESULT_BYTES,
    maxActivePerOwner = 2,
    maxActiveGlobal = 100,
    auditSink = () => {},
  } = {}) {
    if (!storage || ["putInput", "putOutput", "readOutput", "deleteInput", "deleteOutput"]
      .some((name) => typeof storage[name] !== "function")) {
      throw new TypeError("storage 未实现完整临时存储接口");
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 60 * 60 * 1000) {
      throw new TypeError("ttlMs 必须在 1 分钟到 1 小时之间");
    }
    for (const [label, value] of [
      ["maxUploadBytes", maxUploadBytes], ["maxResultBytes", maxResultBytes],
      ["maxActivePerOwner", maxActivePerOwner], ["maxActiveGlobal", maxActiveGlobal],
    ]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} 非法`);
    }
    if (maxUploadBytes > DEFAULT_MAX_UPLOAD_BYTES || maxResultBytes > DEFAULT_MAX_RESULT_BYTES) {
      throw new TypeError("运行时字节上限不得放宽 tracked schema 的固定上限");
    }
    if (typeof clock !== "function" || typeof uuidFactory !== "function" || typeof auditSink !== "function") {
      throw new TypeError("clock、uuidFactory 与 auditSink 必须是函数");
    }
    this.storage = storage;
    this.clock = clock;
    this.uuidFactory = uuidFactory;
    this.ttlMs = ttlMs;
    this.maxUploadBytes = maxUploadBytes;
    this.maxResultBytes = maxResultBytes;
    this.maxActivePerOwner = maxActivePerOwner;
    this.maxActiveGlobal = maxActiveGlobal;
    this.auditSink = auditSink;
    this.jobs = new Map();
    this.idempotency = new Map();
  }

  _now() {
    return currentDate(this.clock);
  }

  _ownerKey(principal) {
    return `${principal.kind}:${principal.subject_id}`;
  }

  _newJobId() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const uuid = this.uuidFactory();
      if (typeof uuid !== "string" || !UUID_PATTERN.test(uuid)) {
        throw new TypeError("uuidFactory 必须返回规范 UUID 字符串");
      }
      const jobId = `webjob-${uuid}`;
      if (!this.jobs.has(jobId)) return jobId;
    }
    fail("JOB_ID_COLLISION", "任务标识连续碰撞，拒绝覆盖既有任务");
  }

  _audit(eventType, record, reason = null) {
    const event = {
      schema_version: "1.0",
      event_type: eventType,
      job_id: record.job_id,
      occurred_at: this._now().toISOString(),
      reason,
    };
    try {
      this.auditSink(clone(event));
    } catch {
      // 观察性事件接收器不得阻止内容删除或使已提交的任务状态半途返回失败。
    }
  }

  _public(record) {
    const result = {
      schema_version: "1.0",
      record_type: "oak_manuscript_web_job_status",
      job_id: record.job_id,
      state: record.state,
      created_at: record.created_at,
      expires_at: record.expires_at,
      input_retained: record.input_retained,
      result_available: record.result_available,
      deletion_due_at: record.expires_at,
    };
    validatePublicJob(result);
    return result;
  }

  _markExpired(record) {
    if (Date.parse(record.expires_at) > this._now().getTime()) return false;
    if (record.pending_deletion_reason !== "expired") {
      record.state = "deletion_pending";
      record.pending_deletion_reason = "expired";
      this._audit("deletion_pending", record, "expired");
    }
    return true;
  }

  _ownedRecord(principalInput, jobId, { allowExpired = false } = {}) {
    const principal = normalizePrincipal(principalInput);
    safeString(jobId, "job_id", new RegExp(`^webjob-${UUID_PATTERN.source.slice(1, -1)}$`));
    const record = this.jobs.get(jobId);
    if (!record || record.owner_key !== this._ownerKey(principal)) {
      fail("JOB_NOT_FOUND", "任务不存在或无权访问");
    }
    if (this._markExpired(record) && !allowExpired) {
      fail("JOB_EXPIRED", "任务已到期并等待删除");
    }
    return record;
  }

  async createJob(principalInput, requestInput) {
    const principal = normalizePrincipal(principalInput);
    validateCreateRequest(requestInput, { maxUploadBytes: this.maxUploadBytes });
    const ownerKey = this._ownerKey(principal);
    const idempotencyKey = `${ownerKey}\u0000${requestInput.idempotency_key}`;
    const requestCanonical = canonicalCreateRequest(requestInput);
    const fingerprint = requestFingerprint(requestInput);
    const previousEntry = this.idempotency.get(idempotencyKey);
    if (previousEntry) {
      if (previousEntry.request_fingerprint !== fingerprint) {
        fail("IDEMPOTENCY_CONFLICT", "同一幂等键对应不同任务请求");
      }
      if (previousEntry.terminal || !previousEntry.job_id) {
        fail("IDEMPOTENCY_TERMINAL", "同一幂等任务已经结束，不能隐式新建或重复计费");
      }
      const previous = this.jobs.get(previousEntry.job_id);
      if (!previous) fail("IDEMPOTENCY_TERMINAL", "幂等任务状态不完整，拒绝隐式重建");
      return this._public(previous);
    }

    const active = [...this.jobs.values()].filter((job) => ACTIVE_STATES.has(job.state));
    if (active.length >= this.maxActiveGlobal) fail("GLOBAL_CONCURRENCY_LIMIT", "服务并发已满");
    if (active.filter((job) => job.owner_key === ownerKey).length >= this.maxActivePerOwner) {
      fail("OWNER_CONCURRENCY_LIMIT", "当前账号或匿名会话的并发任务已满");
    }

    const now = this._now();
    const consentAt = Date.parse(requestInput.consent.granted_at);
    if (consentAt > now.getTime() + 5 * 60 * 1000 || consentAt < now.getTime() - 60 * 60 * 1000) {
      fail("CONSENT_STALE", "本次处理同意已过期或来自未来时间");
    }
    const record = {
      job_id: this._newJobId(),
      owner_key: ownerKey,
      state: "awaiting_upload",
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + this.ttlMs).toISOString(),
      input_retained: false,
      result_available: false,
      request_canonical: requestCanonical,
      idempotency_key: requestInput.idempotency_key,
      document: clone(requestInput.document),
    };
    this.jobs.set(record.job_id, record);
    this.idempotency.set(idempotencyKey, {
      job_id: record.job_id,
      request_fingerprint: fingerprint,
      terminal: false,
    });
    this._audit("job_created", record);
    return this._public(record);
  }

  getJob(principalInput, jobId) {
    return this._public(this._ownedRecord(principalInput, jobId, { allowExpired: true }));
  }

  listJobs(principalInput) {
    const principal = normalizePrincipal(principalInput);
    const ownerKey = this._ownerKey(principal);
    return [...this.jobs.values()]
      .filter((record) => record.owner_key === ownerKey)
      .map((record) => {
        this._markExpired(record);
        return record;
      })
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map((record) => this._public(record));
  }

  async acceptUpload(principalInput, jobId, uploadInput) {
    exactKeys(uploadInput, UPLOAD_KEYS, "上传载荷");
    if (!Buffer.isBuffer(uploadInput.bytes)) fail("INVALID_UPLOAD", "上传内容必须是 Buffer");
    const reservation = this.reserveUpload(principalInput, jobId, {
      size_bytes: uploadInput.bytes.length,
      media_type: uploadInput.media_type,
    });
    try {
      return await this.acceptReservedUpload(principalInput, jobId, reservation, uploadInput);
    } catch (error) {
      try { this.releaseUploadReservation(principalInput, jobId, reservation); } catch {}
      throw error;
    }
  }

  reserveUpload(principalInput, jobId, intentInput) {
    const record = this._ownedRecord(principalInput, jobId);
    if (record.state !== "awaiting_upload") fail("INVALID_TRANSITION", "任务当前不能接收上传");
    if (record.upload_reservation) fail("INVALID_TRANSITION", "任务已有上传正在接收");
    exactKeys(intentInput, UPLOAD_INTENT_KEYS, "上传意图");
    positiveInteger(intentInput.size_bytes, "上传意图.size_bytes", this.maxUploadBytes);
    if (intentInput.size_bytes !== record.document.size_bytes) {
      fail("UPLOAD_SIZE_MISMATCH", "上传字节数与已确认任务不一致");
    }
    if (intentInput.media_type !== INPUT_MEDIA_TYPES[record.document.format]) {
      fail("UPLOAD_MEDIA_TYPE_MISMATCH", "上传媒体类型与文档格式不一致");
    }
    const reservation = Object.freeze({ job_id: record.job_id });
    record.upload_reservation = reservation;
    return reservation;
  }

  releaseUploadReservation(principalInput, jobId, reservation) {
    const record = this._ownedRecord(principalInput, jobId, { allowExpired: true });
    if (record.upload_reservation === reservation) {
      record.upload_reservation = null;
      return true;
    }
    return false;
  }

  async acceptReservedUpload(principalInput, jobId, reservation, uploadInput) {
    const record = this._ownedRecord(principalInput, jobId);
    if (record.state !== "awaiting_upload" || record.upload_reservation !== reservation) {
      fail("INVALID_TRANSITION", "上传预留不存在或已经失效");
    }
    exactKeys(uploadInput, UPLOAD_KEYS, "上传载荷");
    if (!Buffer.isBuffer(uploadInput.bytes)) fail("INVALID_UPLOAD", "上传内容必须是 Buffer");
    if (uploadInput.bytes.length !== record.document.size_bytes ||
        uploadInput.bytes.length < 1 || uploadInput.bytes.length > this.maxUploadBytes) {
      fail("UPLOAD_SIZE_MISMATCH", "上传字节数与已确认任务不一致");
    }
    if (uploadInput.media_type !== INPUT_MEDIA_TYPES[record.document.format]) {
      fail("UPLOAD_MEDIA_TYPE_MISMATCH", "上传媒体类型与文档格式不一致");
    }
    try {
      await this.storage.putInput(record.job_id, uploadInput.bytes, { deleteAt: record.expires_at });
      record.state = "queued";
      record.input_retained = true;
      this._audit("upload_stored", record);
      return this._public(record);
    } finally {
      if (record.upload_reservation === reservation) record.upload_reservation = null;
    }
  }

  beginProcessing(principalInput, jobId) {
    const record = this._ownedRecord(principalInput, jobId);
    if (record.state !== "queued") fail("INVALID_TRANSITION", "任务当前不能开始处理");
    record.state = "processing";
    this._audit("processing_started", record);
    return this._public(record);
  }

  async completeJob(principalInput, jobId, outputInput) {
    const record = this._ownedRecord(principalInput, jobId);
    if (record.state !== "processing") fail("INVALID_TRANSITION", "任务当前不能完成");
    exactKeys(outputInput, UPLOAD_KEYS, "结果载荷");
    if (!Buffer.isBuffer(outputInput.bytes) || outputInput.bytes.length < 1 ||
        outputInput.bytes.length > this.maxResultBytes) {
      fail("INVALID_RESULT", "结果内容非法或超限");
    }
    exactEnum(outputInput.media_type, RESULT_MEDIA_TYPES, "结果媒体类型");

    try {
      await this.storage.putOutput(record.job_id, outputInput.bytes, {
        deleteAt: record.expires_at,
        mediaType: outputInput.media_type,
      });
      await this.storage.deleteInput(record.job_id);
    } catch (error) {
      try { await this.storage.deleteOutput(record.job_id); } catch {}
      record.state = "deletion_pending";
      record.result_available = false;
      record.result_media_type = null;
      record.pending_deletion_reason = "processing_failed";
      this._audit("deletion_pending", record, "completion_input_delete_failed");
      fail("ZERO_RETENTION_DELETE_FAILED", "输入删除失败，任务未被标记为完成");
    }
    record.state = "result_ready";
    record.input_retained = false;
    record.result_available = true;
    record.result_media_type = outputInput.media_type;
    this._audit("input_deleted", record, "processing_completed");
    this._audit("result_ready", record);
    return this._public(record);
  }

  async downloadResult(principalInput, jobId) {
    return (await this.downloadResultWithMetadata(principalInput, jobId)).bytes;
  }

  async downloadResultWithMetadata(principalInput, jobId) {
    const record = this._ownedRecord(principalInput, jobId);
    if (record.state !== "result_ready" || !record.result_available ||
        !RESULT_MEDIA_TYPES.has(record.result_media_type)) {
      fail("RESULT_NOT_AVAILABLE", "任务结果不可下载");
    }
    const bytes = await this.storage.readOutput(record.job_id);
    if (!Buffer.isBuffer(bytes)) fail("RESULT_NOT_AVAILABLE", "任务结果已不存在");
    return { bytes, media_type: record.result_media_type };
  }

  async _purge(record, reason) {
    try {
      await this.storage.deleteInput(record.job_id);
      record.input_retained = false;
      await this.storage.deleteOutput(record.job_id);
      record.result_available = false;
      record.result_media_type = null;
    } catch (error) {
      record.state = "deletion_pending";
      record.pending_deletion_reason = reason;
      this._audit("deletion_pending", record, reason);
      fail("ZERO_RETENTION_DELETE_FAILED", "临时内容删除失败，任务保留待重试状态");
    }
    const deletedAt = this._now().toISOString();
    const receipt = {
      schema_version: "1.0",
      receipt_type: "oak_manuscript_web_job_deletion",
      job_id: record.job_id,
      reason,
      deleted_at: deletedAt,
      input_deleted: true,
      output_deleted: true,
    };
    validateDeletionReceipt(receipt);
    this.jobs.delete(record.job_id);
    const idempotencyKey = `${record.owner_key}\u0000${record.idempotency_key}`;
    const entry = this.idempotency.get(idempotencyKey);
    if (entry) this.idempotency.set(idempotencyKey, { ...entry, job_id: null, terminal: true });
    this._audit("deletion_completed", record, reason);
    return receipt;
  }

  async cancelJob(principalInput, jobId) {
    const record = this._ownedRecord(principalInput, jobId, { allowExpired: true });
    return this._purge(record, record.pending_deletion_reason || "canceled");
  }

  async deleteJob(principalInput, jobId) {
    const record = this._ownedRecord(principalInput, jobId, { allowExpired: true });
    return this._purge(record, record.pending_deletion_reason || "user_deleted");
  }

  async retryDeletion(principalInput, jobId) {
    const record = this._ownedRecord(principalInput, jobId, { allowExpired: true });
    if (record.state !== "deletion_pending") fail("INVALID_TRANSITION", "任务当前不需要重试删除");
    return this._purge(record, record.pending_deletion_reason || "user_deleted");
  }

  async sweepExpired() {
    const now = this._now();
    const deleted = [];
    const pending = [];
    for (const record of [...this.jobs.values()]) {
      if (Date.parse(record.expires_at) > now.getTime()) continue;
      try {
        deleted.push(await this._purge(record, "expired"));
      } catch (error) {
        if (!(error instanceof WebJobError) || error.code !== "ZERO_RETENTION_DELETE_FAILED") throw error;
        pending.push(record.job_id);
      }
    }
    return { deleted, pending };
  }
}

module.exports = {
  JOB_STATES,
  INPUT_MEDIA_TYPES,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_MAX_RESULT_BYTES,
  WebJobError,
  MemoryEphemeralStorage,
  WebJobService,
  validateCreateRequest,
  validatePublicJob,
  validateDeletionReceipt,
};
