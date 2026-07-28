"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  DEFAULT_MAX_RESULT_BYTES,
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_TTL_MS,
  INPUT_MEDIA_TYPES,
  WebJobError,
  validateCreateRequest,
  validateDeletionReceipt,
  validatePublicJob,
} = require("./job-contract");

const PRINCIPAL_KEYS = Object.freeze(["kind", "subject_id"]);
const UPLOAD_KEYS = Object.freeze(["bytes", "media_type"]);
const UPLOAD_INTENT_KEYS = Object.freeze(["size_bytes", "media_type"]);
const RESULT_MEDIA_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/epub+zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JOB_ID_PATTERN = new RegExp(`^webjob-${UUID_PATTERN.source.slice(1, -1)}$`);
const RESERVATION_KEYS = Object.freeze(["job_id", "reservation_id", "revision"]);
const LEASE_KEYS = Object.freeze([
  "schema_version", "lease_type", "job_id", "lease_id", "revision", "expires_at",
]);
const WORK_ITEM_KEYS = Object.freeze([
  "schema_version", "work_type", "lease", "document", "bytes",
]);
const CLAIM_OWNERS = new WeakMap();

function fail(code, message) {
  throw new WebJobError(code, message);
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_REQUEST", `${label} 必须是对象`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_REQUEST", `${label} 字段集合非法`);
  }
  return value;
}

function normalizePrincipal(value) {
  exactObject(value, PRINCIPAL_KEYS, "principal");
  if (!new Set(["account", "anonymous"]).has(value.kind) ||
      typeof value.subject_id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.subject_id)) {
    fail("INVALID_REQUEST", "principal 非法");
  }
  return Object.freeze({ kind: value.kind, subject_id: value.subject_id });
}

function ownerKey(principal) {
  return `${principal.kind}:${principal.subject_id}`;
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

function publicRecord(record) {
  const value = {
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
  validatePublicJob(value);
  return Object.freeze(value);
}

function deletionReceipt(record, reason, deletedAt) {
  const value = {
    schema_version: "1.0",
    receipt_type: "oak_manuscript_web_job_deletion",
    job_id: record.job_id,
    reason,
    deleted_at: deletedAt,
    input_deleted: true,
    output_deleted: true,
  };
  validateDeletionReceipt(value);
  return Object.freeze(value);
}

function currentDate(clock) {
  const value = clock();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock 必须返回有效时间");
  return date;
}

class PersistentWebJobService {
  constructor({
    repository,
    storage,
    clock = () => new Date(),
    uuidFactory = randomUUID,
    ttlMs = DEFAULT_TTL_MS,
    reservationTtlMs = 5 * 60 * 1000,
    leaseTtlMs = 5 * 60 * 1000,
    maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
    maxResultBytes = DEFAULT_MAX_RESULT_BYTES,
    maxActivePerOwner = 2,
    maxActiveGlobal = 100,
    auditSink = () => {},
  } = {}) {
    if (!repository || ["createOrReplay", "getOwned", "listOwned", "compareAndSwap",
      "claimNext", "finalizeDeletion", "listExpired"]
      .some((name) => typeof repository[name] !== "function")) {
      throw new TypeError("repository 未实现完整持久任务接口");
    }
    if (!storage || ["putInput", "putOutput", "readInput", "readOutput", "deleteInput", "deleteOutput"]
      .some((name) => typeof storage[name] !== "function")) {
      throw new TypeError("storage 未实现完整临时内容接口");
    }
    for (const [label, value, minimum, maximum] of [
      ["ttlMs", ttlMs, 60_000, 60 * 60 * 1000],
      ["reservationTtlMs", reservationTtlMs, 30_000, 15 * 60 * 1000],
      ["leaseTtlMs", leaseTtlMs, 30_000, 15 * 60 * 1000],
      ["maxUploadBytes", maxUploadBytes, 1, DEFAULT_MAX_UPLOAD_BYTES],
      ["maxResultBytes", maxResultBytes, 1, DEFAULT_MAX_RESULT_BYTES],
      ["maxActivePerOwner", maxActivePerOwner, 1, 100],
      ["maxActiveGlobal", maxActiveGlobal, 1, 100_000],
    ]) {
      if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new TypeError(`${label} 非法`);
      }
    }
    if (typeof clock !== "function" || typeof uuidFactory !== "function" ||
        typeof auditSink !== "function") {
      throw new TypeError("clock、uuidFactory 与 auditSink 必须是函数");
    }
    this.repository = repository;
    this.storage = storage;
    this.clock = clock;
    this.uuidFactory = uuidFactory;
    this.ttlMs = ttlMs;
    this.reservationTtlMs = reservationTtlMs;
    this.leaseTtlMs = leaseTtlMs;
    this.maxUploadBytes = maxUploadBytes;
    this.maxResultBytes = maxResultBytes;
    this.maxActivePerOwner = maxActivePerOwner;
    this.maxActiveGlobal = maxActiveGlobal;
    this.auditSink = auditSink;
  }

  _now() {
    return currentDate(this.clock);
  }

  _uuid() {
    const value = this.uuidFactory();
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw new TypeError("uuidFactory 必须返回规范 UUID 字符串");
    }
    return value;
  }

  _audit(eventType, record, reason = null) {
    try {
      this.auditSink(Object.freeze({
        schema_version: "1.0",
        event_type: eventType,
        job_id: record.job_id,
        occurred_at: this._now().toISOString(),
        reason,
      }));
    } catch {
      // 观察性事件不得改变持久状态或阻断临时内容删除。
    }
  }

  _next(record, overrides = {}) {
    return {
      state: record.state,
      input_retained: record.input_retained,
      result_available: record.result_available,
      result_media_type: record.result_media_type,
      pending_deletion_reason: record.pending_deletion_reason,
      upload_reservation_id: record.upload_reservation_id,
      upload_reservation_expires_at: record.upload_reservation_expires_at,
      lease_id: record.lease_id,
      lease_expires_at: record.lease_expires_at,
      ...overrides,
    };
  }

  async _cas(record, next, expectedStates = [record.state]) {
    return this.repository.compareAndSwap({
      owner_key: record.owner_key,
      job_id: record.job_id,
      expected_revision: record.revision,
      expected_states: expectedStates,
      next,
    });
  }

  async _expireIfDue(record) {
    if (Date.parse(record.expires_at) > this._now().getTime() || record.state === "deletion_pending") {
      return record;
    }
    const expired = await this._cas(record, this._next(record, {
      state: "deletion_pending",
      pending_deletion_reason: "expired",
      upload_reservation_id: null,
      upload_reservation_expires_at: null,
      lease_id: null,
      lease_expires_at: null,
    }));
    if (expired) {
      this._audit("deletion_pending", expired, "expired");
      return expired;
    }
    return this.repository.getOwned({ owner_key: record.owner_key, job_id: record.job_id });
  }

  async _owned(principalInput, jobId, { allowExpired = false } = {}) {
    const principal = normalizePrincipal(principalInput);
    if (typeof jobId !== "string" || !JOB_ID_PATTERN.test(jobId)) {
      fail("INVALID_REQUEST", "job_id 非法");
    }
    let record = await this.repository.getOwned({ owner_key: ownerKey(principal), job_id: jobId });
    if (!record) fail("JOB_NOT_FOUND", "任务不存在或无权访问");
    record = await this._expireIfDue(record);
    if (!record) fail("JOB_NOT_FOUND", "任务不存在或无权访问");
    if (record.state === "deletion_pending" && record.pending_deletion_reason === "expired" &&
        !allowExpired) {
      fail("JOB_EXPIRED", "任务已到期并等待删除");
    }
    return record;
  }

  async createJob(principalInput, requestInput) {
    const principal = normalizePrincipal(principalInput);
    validateCreateRequest(requestInput, { maxUploadBytes: this.maxUploadBytes });
    const now = this._now();
    const consentAt = Date.parse(requestInput.consent.granted_at);
    if (consentAt > now.getTime() + 5 * 60 * 1000 || consentAt < now.getTime() - 60 * 60 * 1000) {
      fail("CONSENT_STALE", "本次处理同意已过期或来自未来时间");
    }
    const requestCanonical = canonicalCreateRequest(requestInput);
    const fingerprint = createHash("sha256").update(requestCanonical, "utf8").digest("hex");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await this.repository.createOrReplay({
        owner_key: ownerKey(principal),
        job_id: `webjob-${this._uuid()}`,
        idempotency_key: requestInput.idempotency_key,
        request_fingerprint: fingerprint,
        request_canonical: requestCanonical,
        document: { ...requestInput.document },
        ttl_seconds: Math.floor(this.ttlMs / 1000),
        max_active_per_owner: this.maxActivePerOwner,
        max_active_global: this.maxActiveGlobal,
      });
      if (result.outcome === "created" || result.outcome === "replayed") {
        const record = await this._expireIfDue(result.record);
        this._audit(result.outcome === "created" ? "job_created" : "job_replayed", record);
        return publicRecord(record);
      }
      if (result.outcome === "job_id_collision") continue;
      if (result.outcome === "conflict") {
        fail("IDEMPOTENCY_CONFLICT", "同一幂等键对应不同任务请求");
      }
      if (result.outcome === "terminal") {
        fail("IDEMPOTENCY_TERMINAL", "同一幂等任务已经结束，不能隐式新建或重复计费");
      }
      if (result.outcome === "owner_limit") {
        fail("OWNER_CONCURRENCY_LIMIT", "当前账号或匿名会话的并发任务已满");
      }
      if (result.outcome === "global_limit") fail("GLOBAL_CONCURRENCY_LIMIT", "服务并发已满");
      fail("INVALID_STATE", "持久任务创建结果非法");
    }
    fail("JOB_ID_COLLISION", "任务标识连续碰撞，拒绝覆盖既有任务");
  }

  async getJob(principalInput, jobId) {
    return publicRecord(await this._owned(principalInput, jobId, { allowExpired: true }));
  }

  async listJobs(principalInput) {
    const principal = normalizePrincipal(principalInput);
    const records = await this.repository.listOwned({ owner_key: ownerKey(principal) });
    const result = [];
    for (const original of records) {
      const record = await this._expireIfDue(original);
      if (record) result.push(publicRecord(record));
    }
    return result.sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  async reserveUpload(principalInput, jobId, intentInput) {
    exactObject(intentInput, UPLOAD_INTENT_KEYS, "上传意图");
    let record = await this._owned(principalInput, jobId);
    if (record.state !== "awaiting_upload") fail("INVALID_TRANSITION", "任务当前不能接收上传");
    if (!Number.isSafeInteger(intentInput.size_bytes) || intentInput.size_bytes < 1 ||
        intentInput.size_bytes > this.maxUploadBytes || intentInput.size_bytes !== record.document.size_bytes) {
      fail("UPLOAD_SIZE_MISMATCH", "上传字节数与已确认任务不一致");
    }
    if (intentInput.media_type !== INPUT_MEDIA_TYPES[record.document.format]) {
      fail("UPLOAD_MEDIA_TYPE_MISMATCH", "上传媒体类型与文档格式不一致");
    }
    if (record.upload_reservation_id !== null) {
      if (Date.parse(record.upload_reservation_expires_at) > this._now().getTime()) {
        fail("INVALID_TRANSITION", "任务已有上传正在接收");
      }
      const cleared = await this._cas(record, this._next(record, {
        upload_reservation_id: null,
        upload_reservation_expires_at: null,
      }));
      if (!cleared) fail("INVALID_TRANSITION", "上传预留状态已变化");
      record = cleared;
    }
    const reservationId = this._uuid();
    const expiry = new Date(Math.min(
      this._now().getTime() + this.reservationTtlMs,
      Date.parse(record.expires_at),
    )).toISOString();
    const reserved = await this._cas(record, this._next(record, {
      upload_reservation_id: reservationId,
      upload_reservation_expires_at: expiry,
    }));
    if (!reserved) fail("INVALID_TRANSITION", "任务上传预留竞争失败");
    return Object.freeze({
      job_id: reserved.job_id,
      reservation_id: reservationId,
      revision: reserved.revision,
    });
  }

  _validateReservation(value, jobId) {
    exactObject(value, RESERVATION_KEYS, "上传预留");
    if (value.job_id !== jobId || typeof value.reservation_id !== "string" ||
        !UUID_PATTERN.test(value.reservation_id) || !Number.isSafeInteger(value.revision) ||
        value.revision < 1) {
      fail("INVALID_REQUEST", "上传预留非法");
    }
    return value;
  }

  async releaseUploadReservation(principalInput, jobId, reservationInput) {
    const reservation = this._validateReservation(reservationInput, jobId);
    const record = await this._owned(principalInput, jobId, { allowExpired: true });
    if (record.state !== "awaiting_upload" ||
        record.upload_reservation_id !== reservation.reservation_id) return false;
    const cleared = await this._cas(record, this._next(record, {
      upload_reservation_id: null,
      upload_reservation_expires_at: null,
    }));
    return Boolean(cleared);
  }

  async acceptReservedUpload(principalInput, jobId, reservationInput, uploadInput) {
    const reservation = this._validateReservation(reservationInput, jobId);
    exactObject(uploadInput, UPLOAD_KEYS, "上传载荷");
    if (!Buffer.isBuffer(uploadInput.bytes)) fail("INVALID_UPLOAD", "上传内容必须是 Buffer");
    const record = await this._owned(principalInput, jobId);
    if (record.state !== "awaiting_upload" || record.revision !== reservation.revision ||
        record.upload_reservation_id !== reservation.reservation_id ||
        Date.parse(record.upload_reservation_expires_at) <= this._now().getTime()) {
      fail("INVALID_TRANSITION", "上传预留不存在或已经失效");
    }
    if (uploadInput.bytes.length !== record.document.size_bytes || uploadInput.bytes.length < 1 ||
        uploadInput.bytes.length > this.maxUploadBytes) {
      fail("UPLOAD_SIZE_MISMATCH", "上传字节数与已确认任务不一致");
    }
    if (uploadInput.media_type !== INPUT_MEDIA_TYPES[record.document.format]) {
      fail("UPLOAD_MEDIA_TYPE_MISMATCH", "上传媒体类型与文档格式不一致");
    }
    await this.storage.putInput(record.job_id, uploadInput.bytes, { deleteAt: record.expires_at });
    const queued = await this._cas(record, this._next(record, {
      state: "queued",
      input_retained: true,
      upload_reservation_id: null,
      upload_reservation_expires_at: null,
    }));
    if (!queued) {
      try {
        await this.storage.deleteInput(record.job_id);
      } catch {
        this._audit("orphan_cleanup_failed", record, "upload_commit_conflict");
        fail("ZERO_RETENTION_DELETE_FAILED", "上传提交竞争且临时输入删除失败");
      }
      fail("INVALID_TRANSITION", "上传提交时任务状态已变化");
    }
    this._audit("upload_stored", queued);
    return publicRecord(queued);
  }

  async acceptUpload(principalInput, jobId, uploadInput) {
    exactObject(uploadInput, UPLOAD_KEYS, "上传载荷");
    if (!Buffer.isBuffer(uploadInput.bytes)) fail("INVALID_UPLOAD", "上传内容必须是 Buffer");
    const reservation = await this.reserveUpload(principalInput, jobId, {
      size_bytes: uploadInput.bytes.length,
      media_type: uploadInput.media_type,
    });
    try {
      return await this.acceptReservedUpload(principalInput, jobId, reservation, uploadInput);
    } catch (error) {
      try { await this.releaseUploadReservation(principalInput, jobId, reservation); } catch {}
      throw error;
    }
  }

  async claimNextProcessing() {
    const leaseId = this._uuid();
    const record = await this.repository.claimNext({
      lease_id: leaseId,
      lease_seconds: Math.floor(this.leaseTtlMs / 1000),
    });
    if (record === null) return null;
    const leaseRemaining = Date.parse(record.lease_expires_at) - this._now().getTime();
    if (record.state !== "processing" || record.lease_id !== leaseId ||
        record.lease_expires_at === null || record.input_retained !== true ||
        record.result_available !== false ||
        !Number.isFinite(leaseRemaining) || leaseRemaining < this.leaseTtlMs - 5_000) {
      fail("INVALID_TRANSITION", "私有队列返回了非法处理租约");
    }

    let bytes;
    try {
      bytes = await this.storage.readInput(record.job_id);
    } catch {
      this._audit("processing_input_unavailable", record, "temporary_storage_read_failed");
      fail("RESULT_NOT_AVAILABLE", "临时输入当前不可读取，任务将在租约到期后重试");
    }
    if (!Buffer.isBuffer(bytes) || bytes.length !== record.document.size_bytes ||
        bytes.length < 1 || bytes.length > this.maxUploadBytes) {
      let retained = true;
      try {
        await this.storage.deleteInput(record.job_id);
        retained = false;
      } catch {}
      await this._markProcessingFailure(record, retained);
      if (retained) fail("ZERO_RETENTION_DELETE_FAILED", "非法临时输入无法确认删除");
      fail("INVALID_UPLOAD", "临时输入与已确认任务不一致");
    }

    const lease = Object.freeze({
      schema_version: "1.0",
      lease_type: "oak_manuscript_web_job_processing_lease",
      job_id: record.job_id,
      lease_id: record.lease_id,
      revision: record.revision,
      expires_at: record.lease_expires_at,
    });
    const workItem = Object.freeze({
      schema_version: "1.0",
      work_type: "oak_manuscript_private_work_item",
      lease,
      document: Object.freeze({ ...record.document }),
      bytes,
    });
    CLAIM_OWNERS.set(workItem, Object.freeze({
      service: this,
      principal: Object.freeze({
        kind: record.owner_key.startsWith("account:") ? "account" : "anonymous",
        subject_id: record.owner_key.slice(record.owner_key.indexOf(":") + 1),
      }),
    }));
    this._audit("processing_started", record);
    return workItem;
  }

  async completeClaim(workItem, outputInput) {
    exactObject(workItem, WORK_ITEM_KEYS, "私有处理工作项");
    const claim = CLAIM_OWNERS.get(workItem);
    if (!claim || claim.service !== this || workItem.schema_version !== "1.0" ||
        workItem.work_type !== "oak_manuscript_private_work_item") {
      fail("INVALID_REQUEST", "私有处理工作项不是本服务当前租约");
    }
    const result = await this.completeJob(
      claim.principal,
      workItem.lease.job_id,
      workItem.lease,
      outputInput,
    );
    CLAIM_OWNERS.delete(workItem);
    return result;
  }

  abandonClaim(workItem, reason = "processor_failed") {
    exactObject(workItem, WORK_ITEM_KEYS, "私有处理工作项");
    const claim = CLAIM_OWNERS.get(workItem);
    if (!claim || claim.service !== this ||
        !new Set(["processor_failed", "processor_output_invalid"]).has(reason)) {
      fail("INVALID_REQUEST", "私有处理工作项或放弃原因非法");
    }
    CLAIM_OWNERS.delete(workItem);
    try {
      this.auditSink(Object.freeze({
        schema_version: "1.0",
        event_type: "processing_attempt_abandoned",
        job_id: workItem.lease.job_id,
        occurred_at: this._now().toISOString(),
        reason,
      }));
    } catch {}
    return true;
  }

  async beginProcessing(principalInput, jobId) {
    let record = await this._owned(principalInput, jobId);
    if (record.state === "processing") {
      if (record.lease_id === null || Date.parse(record.lease_expires_at) > this._now().getTime()) {
        fail("INVALID_TRANSITION", "任务已有有效处理租约");
      }
    } else if (record.state !== "queued") {
      fail("INVALID_TRANSITION", "任务当前不能开始处理");
    }
    const leaseId = this._uuid();
    const leaseExpiry = new Date(Math.min(
      this._now().getTime() + this.leaseTtlMs,
      Date.parse(record.expires_at),
    )).toISOString();
    const processing = await this._cas(record, this._next(record, {
      state: "processing",
      lease_id: leaseId,
      lease_expires_at: leaseExpiry,
    }), [record.state]);
    if (!processing) fail("INVALID_TRANSITION", "任务处理租约竞争失败");
    this._audit("processing_started", processing);
    return Object.freeze({
      schema_version: "1.0",
      lease_type: "oak_manuscript_web_job_processing_lease",
      job_id: processing.job_id,
      lease_id: leaseId,
      revision: processing.revision,
      expires_at: processing.lease_expires_at,
    });
  }

  _validateLease(value, jobId) {
    exactObject(value, LEASE_KEYS, "处理租约");
    if (value.schema_version !== "1.0" ||
        value.lease_type !== "oak_manuscript_web_job_processing_lease" ||
        value.job_id !== jobId || typeof value.lease_id !== "string" ||
        !UUID_PATTERN.test(value.lease_id) || !Number.isSafeInteger(value.revision) ||
        value.revision < 1 || typeof value.expires_at !== "string" ||
        Number.isNaN(Date.parse(value.expires_at)) ||
        new Date(value.expires_at).toISOString() !== value.expires_at) {
      fail("INVALID_REQUEST", "处理租约非法");
    }
    return value;
  }

  async _markProcessingFailure(record, inputRetained) {
    const current = await this.repository.getOwned({ owner_key: record.owner_key, job_id: record.job_id });
    if (!current || current.state === "deletion_pending") return current;
    return this._cas(current, this._next(current, {
      state: "deletion_pending",
      input_retained: inputRetained,
      result_available: false,
      result_media_type: null,
      pending_deletion_reason: "processing_failed",
      upload_reservation_id: null,
      upload_reservation_expires_at: null,
      lease_id: null,
      lease_expires_at: null,
    }));
  }

  async completeJob(principalInput, jobId, leaseInput, outputInput) {
    const lease = this._validateLease(leaseInput, jobId);
    exactObject(outputInput, UPLOAD_KEYS, "结果载荷");
    if (!Buffer.isBuffer(outputInput.bytes) || outputInput.bytes.length < 1 ||
        outputInput.bytes.length > this.maxResultBytes || !RESULT_MEDIA_TYPES.has(outputInput.media_type)) {
      fail("INVALID_RESULT", "结果内容非法或超限");
    }
    const record = await this._owned(principalInput, jobId);
    if (record.state !== "processing" || record.revision !== lease.revision ||
        record.lease_id !== lease.lease_id || record.lease_expires_at !== lease.expires_at ||
        Date.parse(record.lease_expires_at) <= this._now().getTime()) {
      fail("INVALID_TRANSITION", "任务当前没有有效处理租约");
    }
    await this.storage.putOutput(record.job_id, outputInput.bytes, {
      deleteAt: record.expires_at,
      mediaType: outputInput.media_type,
    });
    try {
      await this.storage.deleteInput(record.job_id);
    } catch {
      try { await this.storage.deleteOutput(record.job_id); } catch {}
      await this._markProcessingFailure(record, true);
      fail("ZERO_RETENTION_DELETE_FAILED", "输入删除失败，任务未被标记为完成");
    }
    const ready = await this._cas(record, this._next(record, {
      state: "result_ready",
      input_retained: false,
      result_available: true,
      result_media_type: outputInput.media_type,
      lease_id: null,
      lease_expires_at: null,
    }));
    if (!ready) {
      let outputDeleted = false;
      try {
        await this.storage.deleteOutput(record.job_id);
        outputDeleted = true;
      } catch {}
      await this._markProcessingFailure(record, false);
      if (!outputDeleted) fail("ZERO_RETENTION_DELETE_FAILED", "结果提交竞争且临时结果删除失败");
      fail("INVALID_TRANSITION", "结果提交时任务状态已变化");
    }
    this._audit("input_deleted", ready, "processing_completed");
    this._audit("result_ready", ready);
    return publicRecord(ready);
  }

  async downloadResultWithMetadata(principalInput, jobId) {
    const record = await this._owned(principalInput, jobId);
    if (record.state !== "result_ready" || !record.result_available ||
        !RESULT_MEDIA_TYPES.has(record.result_media_type)) {
      fail("RESULT_NOT_AVAILABLE", "任务结果不可下载");
    }
    const bytes = await this.storage.readOutput(record.job_id);
    if (!Buffer.isBuffer(bytes)) fail("RESULT_NOT_AVAILABLE", "任务结果已不存在");
    return Object.freeze({ bytes, media_type: record.result_media_type });
  }

  async downloadResult(principalInput, jobId) {
    return (await this.downloadResultWithMetadata(principalInput, jobId)).bytes;
  }

  async _purgeRecord(original, reason) {
    let record = original;
    if (record.state !== "deletion_pending") {
      record = await this._cas(record, this._next(record, {
        state: "deletion_pending",
        pending_deletion_reason: reason,
        upload_reservation_id: null,
        upload_reservation_expires_at: null,
        lease_id: null,
        lease_expires_at: null,
      }));
      if (!record) {
        record = await this.repository.getOwned({ owner_key: original.owner_key, job_id: original.job_id });
        if (!record) return deletionReceipt(original, reason, this._now().toISOString());
        if (record.state !== "deletion_pending") fail("INVALID_TRANSITION", "任务删除状态竞争失败");
      }
    } else {
      reason = record.pending_deletion_reason;
    }
    let failed = false;
    try { await this.storage.deleteInput(record.job_id); } catch { failed = true; }
    try { await this.storage.deleteOutput(record.job_id); } catch { failed = true; }
    if (failed) {
      this._audit("deletion_pending", record, reason);
      fail("ZERO_RETENTION_DELETE_FAILED", "临时内容删除失败，任务保留待重试状态");
    }
    let cleared = await this._cas(record, this._next(record, {
      state: "deletion_pending",
      input_retained: false,
      result_available: false,
      result_media_type: null,
      pending_deletion_reason: reason,
      upload_reservation_id: null,
      upload_reservation_expires_at: null,
      lease_id: null,
      lease_expires_at: null,
    }), ["deletion_pending"]);
    if (!cleared) {
      const current = await this.repository.getOwned({ owner_key: record.owner_key, job_id: record.job_id });
      if (!current) return deletionReceipt(record, reason, this._now().toISOString());
      if (current.state !== "deletion_pending" || current.input_retained || current.result_available) {
        fail("INVALID_TRANSITION", "删除后持久状态确认失败");
      }
      cleared = current;
    }
    const finalized = await this.repository.finalizeDeletion({
      owner_key: cleared.owner_key,
      job_id: cleared.job_id,
      expected_revision: cleared.revision,
    });
    if (!finalized) {
      const current = await this.repository.getOwned({ owner_key: cleared.owner_key, job_id: cleared.job_id });
      if (current) fail("INVALID_TRANSITION", "删除墓碑提交竞争失败");
    }
    const receipt = deletionReceipt(cleared, reason, this._now().toISOString());
    this._audit("deletion_completed", cleared, reason);
    return receipt;
  }

  async cancelJob(principalInput, jobId) {
    const record = await this._owned(principalInput, jobId, { allowExpired: true });
    return this._purgeRecord(record, record.pending_deletion_reason || "canceled");
  }

  async deleteJob(principalInput, jobId) {
    const record = await this._owned(principalInput, jobId, { allowExpired: true });
    return this._purgeRecord(record, record.pending_deletion_reason || "user_deleted");
  }

  async retryDeletion(principalInput, jobId) {
    const record = await this._owned(principalInput, jobId, { allowExpired: true });
    if (record.state !== "deletion_pending") fail("INVALID_TRANSITION", "任务当前不需要重试删除");
    return this._purgeRecord(record, record.pending_deletion_reason);
  }

  async sweepExpired({ limit = 100 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("limit 非法");
    const records = await this.repository.listExpired({ before: this._now().toISOString(), limit });
    const deleted = [];
    const pending = [];
    for (const original of records) {
      let record = await this._expireIfDue(original);
      if (!record) continue;
      try {
        deleted.push(await this._purgeRecord(record, record.pending_deletion_reason || "expired"));
      } catch (error) {
        if (!(error instanceof WebJobError) || error.code !== "ZERO_RETENTION_DELETE_FAILED") throw error;
        pending.push(record.job_id);
      }
    }
    return Object.freeze({ deleted: Object.freeze(deleted), pending: Object.freeze(pending) });
  }
}

module.exports = {
  PersistentWebJobService,
};
