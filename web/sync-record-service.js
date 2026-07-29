// Authenticated server-side SyncRecord v1 validation and ownership service.
// This module deliberately does not import the Electron validator: the server
// must reject content-bearing or malformed records independently.

"use strict";

const MAX_RECORD_BYTES = 64 * 1024;
const MAX_ISSUES = 1000;
const DEFAULT_MAX_RECORDS_PER_ACCOUNT = 200;
const DEFAULT_MAX_LIST_ITEMS = 50;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ID_PATTERN = /^sync-v1:[0-9a-f]{16}:check-[0-9]{4,}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SEMVERISH_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const FORBIDDEN_KEY_PATTERN = /(?:content|body|text|title|abstract|keyword|preview|excerpt|snippet|filename|file_name|path|username|device|reference|footnote|image|sha(?:256)?|hash|fingerprint)/iu;

const ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "需要有效的湖岸账号",
  INVALID_RECORD: "同步记录不符合 SyncRecord v1 契约",
  IDEMPOTENCY_CONFLICT: "同步幂等标识与既有记录冲突",
  RECORD_NOT_FOUND: "同步记录不存在或无权访问",
  ACCOUNT_RECORD_LIMIT: "当前账号的同步记录数量已达上限",
  SERVICE_UNAVAILABLE: "同步服务暂时不可用",
});

class SyncRecordServiceError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.SERVICE_UNAVAILABLE);
    this.name = "SyncRecordServiceError";
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : "SERVICE_UNAVAILABLE";
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} 字段集合非法`);
  }
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} 非法`);
  return value;
}

function stringValue(value, pattern, label, maximum = 128) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum ||
      (pattern && !pattern.test(value))) throw new Error(`${label} 非法`);
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 非法`);
  return value;
}

function isoTime(value, label) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) ||
      Number.isNaN(Date.parse(value))) throw new Error(`${label} 非法`);
  return value;
}

function assertNoForbiddenKeys(value, trail = "SyncRecord") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) throw new Error(`${trail}.${key} 是同步禁止字段`);
    assertNoForbiddenKeys(child, `${trail}.${key}`);
  }
}

function countMap(value, label, allowedKeys = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 非法`);
  for (const [key, count] of Object.entries(value)) {
    stringValue(key, SAFE_ID_PATTERN, `${label} key`, 64);
    if (allowedKeys && !allowedKeys.includes(key)) throw new Error(`${label}.${key} 字段非法`);
    nonnegativeInteger(count, `${label}.${key}`);
  }
}

function validateIssue(issue) {
  exactKeys(issue, ["rule_id", "severity", "dimension", "status", "fixable"], "SyncRecord issue");
  stringValue(issue.rule_id, SAFE_ID_PATTERN, "issue.rule_id");
  enumValue(issue.severity, ["error", "warning", "suggestion"], "issue.severity");
  stringValue(issue.dimension, SAFE_ID_PATTERN, "issue.dimension", 64);
  enumValue(issue.status, ["open", "accepted", "rejected", "resolved"], "issue.status");
  if (typeof issue.fixable !== "boolean") throw new Error("issue.fixable 非法");
}

function validateServerSyncRecordV1(record) {
  try {
    assertNoForbiddenKeys(record);
    const baseKeys = [
      "schema_version", "record_type", "project_id", "run_id", "idempotency_id", "event",
      "document", "citation", "versions", "counts", "external_validation", "export_state",
      "created_at", "authorized_at",
    ];
    const actualKeys = Object.keys(record || {});
    const expectedKeys = record && Object.hasOwn(record, "issues") ? [...baseKeys, "issues"] : baseKeys;
    exactKeys(record, expectedKeys, "SyncRecord");
    enumValue(record.schema_version, ["1.0"], "SyncRecord schema_version");
    enumValue(record.record_type, ["oak_manuscript_result"], "SyncRecord record_type");
    stringValue(record.project_id, /^[0-9a-f]{16}$/u, "SyncRecord project_id");
    stringValue(record.run_id, /^check-[0-9]{4,}$/u, "SyncRecord run_id");
    stringValue(record.idempotency_id, ID_PATTERN, "SyncRecord idempotency_id", 192);
    if (record.idempotency_id !== `sync-v1:${record.project_id}:${record.run_id}`) {
      throw new Error("SyncRecord 幂等标识不匹配");
    }
    enumValue(record.event, ["check", "export"], "SyncRecord event");

    exactKeys(record.document, ["format", "manuscript_type", "check_config", "language_bucket", "length_bucket"], "SyncRecord document");
    enumValue(record.document.format, ["docx", "md", "txt", "epub"], "document.format");
    enumValue(record.document.manuscript_type, ["paper", "print_book", "ebook"], "document.manuscript_type");
    enumValue(record.document.check_config, ["quick", "full"], "document.check_config");
    enumValue(record.document.language_bucket, ["zh", "en", "mixed", "undetermined"], "document.language_bucket");
    enumValue(record.document.length_bucket, ["5千字以内", "5千—2万字", "2万—5万字", "5万—10万字", "10万字以上"], "document.length_bucket");

    exactKeys(record.citation, ["requested_style", "resolved_style", "mode", "confidence", "reason_code", "resolver_version"], "SyncRecord citation");
    enumValue(record.citation.requested_style, ["default", "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none"], "citation.requested_style");
    if (record.citation.resolved_style !== null) {
      enumValue(record.citation.resolved_style, ["gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none"], "citation.resolved_style");
    }
    enumValue(record.citation.mode, ["style_specific", "structure_only", "disabled"], "citation.mode");
    enumValue(record.citation.confidence, ["high", "medium", "low", "not_applicable"], "citation.confidence");
    stringValue(record.citation.reason_code, SAFE_ID_PATTERN, "citation.reason_code");
    stringValue(record.citation.resolver_version, SEMVERISH_PATTERN, "citation.resolver_version", 64);

    exactKeys(record.versions, ["rulepack", "app", "platform"], "SyncRecord versions");
    stringValue(record.versions.rulepack, SEMVERISH_PATTERN, "versions.rulepack", 64);
    stringValue(record.versions.app, SEMVERISH_PATTERN, "versions.app", 64);
    enumValue(record.versions.platform, ["win32", "darwin", "web"], "versions.platform");

    exactKeys(record.counts, ["total", "fixable", "by_severity", "by_dimension", "by_status"], "SyncRecord counts");
    nonnegativeInteger(record.counts.total, "counts.total");
    nonnegativeInteger(record.counts.fixable, "counts.fixable");
    countMap(record.counts.by_severity, "counts.by_severity", ["error", "warning", "suggestion"]);
    countMap(record.counts.by_dimension, "counts.by_dimension");
    countMap(record.counts.by_status, "counts.by_status", ["open", "accepted", "rejected", "resolved"]);
    const totals = [record.counts.by_severity, record.counts.by_dimension, record.counts.by_status]
      .map((map) => Object.values(map).reduce((sum, count) => sum + count, 0));
    if (totals.some((total) => total !== record.counts.total) ||
        record.counts.fixable > record.counts.total) throw new Error("SyncRecord 计数不一致");

    if (record.issues !== undefined) {
      if (!Array.isArray(record.issues) || record.issues.length > MAX_ISSUES) {
        throw new Error("SyncRecord issues 非法");
      }
      record.issues.forEach(validateIssue);
      if (record.issues.length !== record.counts.total) throw new Error("SyncRecord issues 与计数不一致");
    }
    exactKeys(record.external_validation, ["epubcheck", "ace"], "SyncRecord external_validation");
    for (const key of ["epubcheck", "ace"]) {
      enumValue(record.external_validation[key], ["not_run", "not_applicable", "passed", "failed", "unavailable"], `external_validation.${key}`);
    }
    enumValue(record.export_state, ["not_exported", "completed"], "SyncRecord export_state");
    isoTime(record.created_at, "SyncRecord created_at");
    if (record.authorized_at === null) throw new Error("SyncRecord 授权时间缺失");
    isoTime(record.authorized_at, "SyncRecord authorized_at");
    if (actualKeys.length !== expectedKeys.length) throw new Error("SyncRecord 字段集合非法");

    const bytes = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (bytes > MAX_RECORD_BYTES) throw new Error("SyncRecord 超过容量上限");
    return true;
  } catch (error) {
    if (error instanceof SyncRecordServiceError) throw error;
    throw new Error(`SyncRecord 服务端验证失败：${error.message}`);
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalRecord(record) {
  return JSON.stringify(canonicalValue(record));
}

function canonicalSyncRecordV1(record) {
  validateServerSyncRecordV1(record);
  return canonicalRecord(record);
}

function accountPrincipal(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal) ||
      Object.keys(principal).sort().join("\0") !== ["kind", "subject_id"].sort().join("\0") ||
      principal.kind !== "account" || typeof principal.subject_id !== "string" ||
      !ACCOUNT_PATTERN.test(principal.subject_id)) throw new SyncRecordServiceError("AUTH_REQUIRED");
  return principal.subject_id;
}

function idempotencyId(value) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new SyncRecordServiceError("RECORD_NOT_FOUND");
  }
  return value;
}

function validateStoredRow(row, expectedAccount = null) {
  exactKeys(row, ["account_id", "canonical_record", "received_at", "record"], "同步 repository row");
  stringValue(row.account_id, ACCOUNT_PATTERN, "row.account_id");
  if (expectedAccount !== null && row.account_id !== expectedAccount) throw new Error("repository 账号归属漂移");
  if (typeof row.canonical_record !== "string" || row.canonical_record.length < 2 ||
      Buffer.byteLength(row.canonical_record, "utf8") > MAX_RECORD_BYTES) throw new Error("repository canonical_record 非法");
  isoTime(row.received_at, "row.received_at");
  validateServerSyncRecordV1(row.record);
  if (canonicalRecord(row.record) !== row.canonical_record) throw new Error("repository canonical_record 不一致");
  return row;
}

function publicItem(row) {
  validateStoredRow(row);
  return {
    idempotency_id: row.record.idempotency_id,
    received_at: row.received_at,
    record: clone(row.record),
  };
}

class MemorySyncRecordRepository {
  constructor() {
    this.byAccount = new Map();
  }

  _records(account) {
    let records = this.byAccount.get(account);
    if (!records) {
      records = new Map();
      this.byAccount.set(account, records);
    }
    return records;
  }

  async createOrReplay(account, canonical, row, maximum) {
    validateStoredRow(row, account);
    if (row.canonical_record !== canonical) throw new Error("repository candidate 不一致");
    const records = this._records(account);
    const existing = records.get(row.record.idempotency_id);
    if (existing) {
      return existing.canonical_record === canonical
        ? { outcome: "replayed", row: clone(existing) }
        : { outcome: "conflict", row: null };
    }
    if (records.size >= maximum) return { outcome: "limit", row: null };
    records.set(row.record.idempotency_id, clone(row));
    return { outcome: "created", row: clone(row) };
  }

  async listOwned(account, limit) {
    const all = [...this._records(account).values()]
      .sort((left, right) => right.received_at.localeCompare(left.received_at) ||
        right.record.idempotency_id.localeCompare(left.record.idempotency_id));
    return { rows: all.slice(0, limit).map(clone), total: all.length };
  }

  async getOwned(account, id) {
    const row = this._records(account).get(id);
    return row ? clone(row) : null;
  }

  async deleteOwned(account, id) {
    return this._records(account).delete(id);
  }
}

function repositoryContract(repository) {
  if (!repository || ["createOrReplay", "listOwned", "getOwned", "deleteOwned"]
    .some((name) => typeof repository[name] !== "function")) {
    throw new TypeError("SyncRecord repository 接口不完整");
  }
  return repository;
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new TypeError(`${label} 非法`);
  }
  return resolved;
}

class SyncRecordService {
  constructor({ repository, clock = () => new Date(), maxRecordsPerAccount,
    maxListItems } = {}) {
    this.repository = repositoryContract(repository);
    if (typeof clock !== "function") throw new TypeError("SyncRecord clock 非法");
    this.clock = clock;
    this.maxRecordsPerAccount = boundedInteger(
      maxRecordsPerAccount, DEFAULT_MAX_RECORDS_PER_ACCOUNT, 1, 500, "maxRecordsPerAccount",
    );
    this.maxListItems = boundedInteger(maxListItems, DEFAULT_MAX_LIST_ITEMS, 1, 100, "maxListItems");
  }

  _now() {
    const value = this.clock();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new SyncRecordServiceError("SERVICE_UNAVAILABLE");
    return date;
  }

  async _call(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SyncRecordServiceError) throw error;
      throw new SyncRecordServiceError("SERVICE_UNAVAILABLE");
    }
  }

  async create(principal, input) {
    const account = accountPrincipal(principal);
    try { validateServerSyncRecordV1(input); } catch { throw new SyncRecordServiceError("INVALID_RECORD"); }
    const now = this._now();
    const authorized = Date.parse(input.authorized_at);
    if (authorized < Date.parse(input.created_at) || authorized > now.getTime() + MAX_FUTURE_SKEW_MS) {
      throw new SyncRecordServiceError("INVALID_RECORD");
    }
    const record = clone(input);
    const canonical = canonicalRecord(record);
    const candidate = {
      account_id: account,
      canonical_record: canonical,
      received_at: now.toISOString(),
      record,
    };
    const result = await this._call(() => this.repository.createOrReplay(
      account, canonical, candidate, this.maxRecordsPerAccount,
    ));
    if (!result || typeof result !== "object" || Array.isArray(result) ||
        !["created", "replayed", "conflict", "limit"].includes(result.outcome)) {
      throw new SyncRecordServiceError("SERVICE_UNAVAILABLE");
    }
    if (result.outcome === "conflict") throw new SyncRecordServiceError("IDEMPOTENCY_CONFLICT");
    if (result.outcome === "limit") throw new SyncRecordServiceError("ACCOUNT_RECORD_LIMIT");
    try { validateStoredRow(result.row, account); } catch { throw new SyncRecordServiceError("SERVICE_UNAVAILABLE"); }
    return { schema_version: "1.0", outcome: result.outcome, item: publicItem(result.row) };
  }

  async list(principal) {
    const account = accountPrincipal(principal);
    const result = await this._call(() => this.repository.listOwned(account, this.maxListItems));
    if (!result || typeof result !== "object" || Array.isArray(result) ||
        Object.keys(result).sort().join("\0") !== ["rows", "total"].sort().join("\0") ||
        !Array.isArray(result.rows) || !Number.isSafeInteger(result.total) ||
        result.total < result.rows.length) {
      throw new SyncRecordServiceError("SERVICE_UNAVAILABLE");
    }
    try { result.rows.forEach((row) => validateStoredRow(row, account)); }
    catch { throw new SyncRecordServiceError("SERVICE_UNAVAILABLE"); }
    return {
      schema_version: "1.0",
      items: result.rows.map(publicItem),
      truncated: result.total > result.rows.length,
    };
  }

  async get(principal, id) {
    const account = accountPrincipal(principal);
    const safeId = idempotencyId(id);
    const row = await this._call(() => this.repository.getOwned(account, safeId));
    if (row === null) throw new SyncRecordServiceError("RECORD_NOT_FOUND");
    try { validateStoredRow(row, account); }
    catch { throw new SyncRecordServiceError("SERVICE_UNAVAILABLE"); }
    return { schema_version: "1.0", item: publicItem(row) };
  }

  async delete(principal, id) {
    const account = accountPrincipal(principal);
    const safeId = idempotencyId(id);
    const deleted = await this._call(() => this.repository.deleteOwned(account, safeId));
    if (deleted !== true) throw new SyncRecordServiceError("RECORD_NOT_FOUND");
    return { schema_version: "1.0", deleted: true, idempotency_id: safeId };
  }
}

module.exports = {
  canonicalSyncRecordV1,
  DEFAULT_MAX_LIST_ITEMS,
  DEFAULT_MAX_RECORDS_PER_ACCOUNT,
  MAX_RECORD_BYTES,
  MemorySyncRecordRepository,
  SyncRecordService,
  SyncRecordServiceError,
  validateServerSyncRecordV1,
};
