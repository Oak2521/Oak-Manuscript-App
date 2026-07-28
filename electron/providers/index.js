// 统一账号、权益与结果同步 Provider 契约。
// 当前实现完全离线：生产 Auth transport、凭据存储和同步 transport 均未配置。

"use strict";

const { randomUUID } = require("node:crypto");

const SYNC_CHOICES = Object.freeze([
  "sync_once",
  "ask_each_time",
  "not_now",
  "never_for_project",
]);
const SYNC_PREFERENCES = new Set(["never_asked", "off", "ask_each_time", "always"]);
const SYNC_QUEUE_STATES = new Set(["pending_transport", "canceled"]);
const SYNC_STORE_KEYS = Object.freeze([
  "schema_version", "store_type", "revision", "preference", "project_blocks", "queue",
]);
const SYNC_QUEUE_ITEM_KEYS = Object.freeze([
  "account_id", "queue_id", "idempotency_id", "state", "created_at", "updated_at",
  "attempts", "last_error", "payload",
]);
const FORBIDDEN_KEY_PATTERN = /(?:content|body|text|title|abstract|keyword|preview|excerpt|snippet|filename|file_name|path|username|device|reference|footnote|image|sha(?:256)?|hash|fingerprint)/i;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} 必须是对象`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(plainObject(value, label)).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} 字段集合非法`);
  }
}

function safeString(value, label, pattern, maxLength = 128) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength ||
      (pattern && !pattern.test(value))) {
    throw new Error(`${label} 非法`);
  }
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`${label} 非法`);
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 非法`);
  return value;
}

function isoTime(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
      Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} 非法`);
  }
  return value;
}

function assertNoForbiddenKeys(value, trail = "record") {
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

function normalizeIssue(input) {
  const issue = plainObject(input, "问题记录");
  return {
    rule_id: safeString(issue.rule_id, "rule_id", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    severity: enumValue(issue.severity, new Set(["error", "warning", "suggestion"]), "severity"),
    dimension: safeString(issue.dimension, "dimension", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    status: enumValue(issue.status, new Set(["open", "accepted", "rejected", "resolved"]), "status"),
    fixable: issue.fixable === true,
  };
}

function countBy(items, key, initial = {}) {
  const counts = { ...initial };
  for (const item of items) counts[item[key]] = (counts[item[key]] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function buildSyncRecordV1(input, { includeIssues = false } = {}) {
  const source = plainObject(input, "同步来源");
  const issues = Array.isArray(source.issues) ? source.issues.map(normalizeIssue) : [];
  const citation = plainObject(source.citation, "citation");
  const external = plainObject(source.externalValidation, "externalValidation");
  const projectId = safeString(source.projectId, "projectId", /^[0-9a-f]{16}$/);
  const runId = safeString(source.runId, "runId", /^check-[0-9]{4,}$/);
  const record = {
    schema_version: "1.0",
    record_type: "oak_manuscript_result",
    project_id: projectId,
    run_id: runId,
    idempotency_id: `sync-v1:${projectId}:${runId}`,
    event: enumValue(source.event, new Set(["check", "export"]), "event"),
    document: {
      format: enumValue(source.format, new Set(["docx", "md", "txt", "epub"]), "format"),
      manuscript_type: enumValue(
        source.manuscriptType,
        new Set(["paper", "print_book", "ebook"]),
        "manuscriptType",
      ),
      check_config: enumValue(source.checkConfig, new Set(["quick", "full"]), "checkConfig"),
      language_bucket: enumValue(
        source.languageBucket,
        new Set(["zh", "en", "mixed", "undetermined"]),
        "languageBucket",
      ),
      length_bucket: enumValue(
        source.lengthBucket,
        new Set(["5千字以内", "5千—2万字", "2万—5万字", "5万—10万字", "10万字以上"]),
        "lengthBucket",
      ),
    },
    citation: {
      requested_style: enumValue(
        citation.requestedStyle,
        new Set(["default", "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none"]),
        "requestedStyle",
      ),
      resolved_style: citation.resolvedStyle === null ? null : enumValue(
        citation.resolvedStyle,
        new Set(["gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none"]),
        "resolvedStyle",
      ),
      mode: enumValue(citation.mode, new Set(["style_specific", "structure_only", "disabled"]), "mode"),
      confidence: enumValue(citation.confidence, new Set(["high", "medium", "low", "not_applicable"]), "confidence"),
      reason_code: safeString(citation.reasonCode, "reasonCode", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
      resolver_version: safeString(citation.resolverVersion, "resolverVersion", /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/),
    },
    versions: {
      rulepack: safeString(source.rulepackVersion, "rulepackVersion", /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/),
      app: safeString(source.appVersion, "appVersion", /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/),
      platform: enumValue(source.platform, new Set(["win32", "darwin", "web"]), "platform"),
    },
    counts: {
      total: issues.length,
      fixable: issues.filter((issue) => issue.fixable).length,
      by_severity: countBy(issues, "severity", { error: 0, warning: 0, suggestion: 0 }),
      by_dimension: countBy(issues, "dimension"),
      by_status: countBy(issues, "status"),
    },
    ...(includeIssues ? { issues } : {}),
    external_validation: {
      epubcheck: enumValue(
        external.epubcheck,
        new Set(["not_run", "not_applicable", "passed", "failed", "unavailable"]),
        "externalValidation.epubcheck",
      ),
      ace: enumValue(
        external.ace,
        new Set(["not_run", "not_applicable", "passed", "failed", "unavailable"]),
        "externalValidation.ace",
      ),
    },
    export_state: enumValue(source.exportState, new Set(["not_exported", "completed"]), "exportState"),
    created_at: isoTime(source.createdAt, "createdAt"),
    authorized_at: isoTime(source.authorizedAt, "authorizedAt", { nullable: true }),
  };
  validateSyncRecordV1(record);
  return record;
}

function validateCountMap(value, label, allowedKeys = null) {
  const map = plainObject(value, label);
  for (const [key, count] of Object.entries(map)) {
    safeString(key, `${label} key`, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
    if (allowedKeys && !allowedKeys.has(key)) throw new Error(`${label}.${key} 字段非法`);
    nonnegativeInteger(count, `${label}.${key}`);
  }
}

function validateSyncRecordV1(record) {
  assertNoForbiddenKeys(record);
  const required = [
    "schema_version", "record_type", "project_id", "run_id", "idempotency_id", "event",
    "document", "citation", "versions", "counts", "external_validation", "export_state",
    "created_at", "authorized_at",
  ];
  const allowed = new Set([...required, "issues"]);
  const actual = Object.keys(plainObject(record, "SyncRecord"));
  if (actual.some((key) => !allowed.has(key)) || required.some((key) => !actual.includes(key))) {
    throw new Error("SyncRecord 字段集合非法");
  }
  enumValue(record.schema_version, new Set(["1.0"]), "schema_version");
  enumValue(record.record_type, new Set(["oak_manuscript_result"]), "record_type");
  safeString(record.project_id, "project_id", /^[0-9a-f]{16}$/);
  safeString(record.run_id, "run_id", /^check-[0-9]{4,}$/);
  if (record.idempotency_id !== `sync-v1:${record.project_id}:${record.run_id}`) {
    throw new Error("idempotency_id 非法");
  }
  enumValue(record.event, new Set(["check", "export"]), "event");

  exactKeys(record.document, ["format", "manuscript_type", "check_config", "language_bucket", "length_bucket"], "document");
  enumValue(record.document.format, new Set(["docx", "md", "txt", "epub"]), "document.format");
  enumValue(record.document.manuscript_type, new Set(["paper", "print_book", "ebook"]), "document.manuscript_type");
  enumValue(record.document.check_config, new Set(["quick", "full"]), "document.check_config");
  enumValue(record.document.language_bucket, new Set(["zh", "en", "mixed", "undetermined"]), "document.language_bucket");
  enumValue(record.document.length_bucket, new Set(["5千字以内", "5千—2万字", "2万—5万字", "5万—10万字", "10万字以上"]), "document.length_bucket");

  exactKeys(record.citation, ["requested_style", "resolved_style", "mode", "confidence", "reason_code", "resolver_version"], "citation");
  enumValue(record.citation.requested_style, new Set(["default", "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none"]), "citation.requested_style");
  if (record.citation.resolved_style !== null) {
    enumValue(record.citation.resolved_style, new Set(["gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none"]), "citation.resolved_style");
  }
  enumValue(record.citation.mode, new Set(["style_specific", "structure_only", "disabled"]), "citation.mode");
  enumValue(record.citation.confidence, new Set(["high", "medium", "low", "not_applicable"]), "citation.confidence");
  safeString(record.citation.reason_code, "citation.reason_code", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  safeString(record.citation.resolver_version, "citation.resolver_version", /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/);

  exactKeys(record.versions, ["rulepack", "app", "platform"], "versions");
  safeString(record.versions.rulepack, "versions.rulepack", /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/);
  safeString(record.versions.app, "versions.app", /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/);
  enumValue(record.versions.platform, new Set(["win32", "darwin", "web"]), "versions.platform");

  exactKeys(record.counts, ["total", "fixable", "by_severity", "by_dimension", "by_status"], "counts");
  nonnegativeInteger(record.counts.total, "counts.total");
  nonnegativeInteger(record.counts.fixable, "counts.fixable");
  validateCountMap(record.counts.by_severity, "counts.by_severity", new Set(["error", "warning", "suggestion"]));
  validateCountMap(record.counts.by_dimension, "counts.by_dimension");
  validateCountMap(record.counts.by_status, "counts.by_status", new Set(["open", "accepted", "rejected", "resolved"]));
  const severityTotal = Object.values(record.counts.by_severity).reduce((sum, value) => sum + value, 0);
  const dimensionTotal = Object.values(record.counts.by_dimension).reduce((sum, value) => sum + value, 0);
  const statusTotal = Object.values(record.counts.by_status).reduce((sum, value) => sum + value, 0);
  if (severityTotal !== record.counts.total || dimensionTotal !== record.counts.total ||
      statusTotal !== record.counts.total || record.counts.fixable > record.counts.total) {
    throw new Error("counts 汇总非法");
  }
  if (record.issues !== undefined) {
    if (!Array.isArray(record.issues)) throw new Error("issues 非法");
    for (const issue of record.issues) {
      exactKeys(issue, ["rule_id", "severity", "dimension", "status", "fixable"], "issue");
      normalizeIssue(issue);
    }
    if (record.issues.length !== record.counts.total) throw new Error("issues 与 counts 不一致");
  }

  exactKeys(record.external_validation, ["epubcheck", "ace"], "external_validation");
  for (const key of ["epubcheck", "ace"]) {
    enumValue(record.external_validation[key], new Set(["not_run", "not_applicable", "passed", "failed", "unavailable"]), `external_validation.${key}`);
  }
  enumValue(record.export_state, new Set(["not_exported", "completed"]), "export_state");
  isoTime(record.created_at, "created_at");
  isoTime(record.authorized_at, "authorized_at", { nullable: true });
  return true;
}

function accountId(value) {
  return safeString(value, "account_id", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
}

function validateStoredQueueItem(item) {
  exactKeys(item, SYNC_QUEUE_ITEM_KEYS, "同步队列项");
  accountId(item.account_id);
  safeString(item.queue_id, "queue_id", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  safeString(item.idempotency_id, "idempotency_id", /^sync-v1:[0-9a-f]{16}:check-[0-9]{4,}$/);
  enumValue(item.state, SYNC_QUEUE_STATES, "同步队列 state");
  isoTime(item.created_at, "同步队列 created_at");
  isoTime(item.updated_at, "同步队列 updated_at");
  nonnegativeInteger(item.attempts, "同步队列 attempts");
  if (item.last_error !== null) {
    safeString(item.last_error, "同步队列 last_error", /^[A-Z][A-Z0-9_]{0,63}$/);
  }
  validateSyncRecordV1(item.payload);
  if (item.idempotency_id !== item.payload.idempotency_id || item.payload.authorized_at === null) {
    throw new Error("同步队列项与 payload 身份或授权时间不一致");
  }
  return item;
}

function validateSyncStoreState(state) {
  exactKeys(state, SYNC_STORE_KEYS, "同步持久状态");
  enumValue(state.schema_version, new Set(["1.0"]), "同步持久状态 schema_version");
  enumValue(state.store_type, new Set(["oak_manuscript_sync_queue"]), "同步持久状态 store_type");
  if (!Number.isSafeInteger(state.revision) || state.revision < 1) throw new Error("同步持久状态 revision 非法");
  enumValue(state.preference, SYNC_PREFERENCES, "同步持久状态 preference");
  if (!Array.isArray(state.project_blocks) || !Array.isArray(state.queue)) {
    throw new Error("同步持久状态集合非法");
  }
  const blocks = new Set();
  for (const block of state.project_blocks) {
    exactKeys(block, ["account_id", "project_id"], "同步项目阻止项");
    const key = `${accountId(block.account_id)}\0${safeString(block.project_id, "project_id", /^[0-9a-f]{16}$/)}`;
    if (blocks.has(key)) throw new Error("同步项目阻止项重复");
    blocks.add(key);
  }
  const queueIds = new Set();
  const idempotency = new Set();
  for (const item of state.queue) {
    validateStoredQueueItem(item);
    const idemKey = `${item.account_id}\0${item.idempotency_id}`;
    if (queueIds.has(item.queue_id) || idempotency.has(idemKey)) throw new Error("同步队列身份重复");
    queueIds.add(item.queue_id);
    idempotency.add(idemKey);
  }
  return true;
}

class AuthProvider {
  constructor({ allowLocalSimulation = false, clock = () => new Date() } = {}) {
    this.allowLocalSimulation = allowLocalSimulation;
    this.clock = clock;
    this.session = { state: "signed_out", accountId: null, sessionExpiresAt: null };
  }

  status() {
    const loggedIn = this.session.state === "authenticated";
    return {
      state: this.session.state,
      loggedIn,
      accountId: loggedIn ? this.session.accountId : null,
      sessionExpiresAt: loggedIn ? this.session.sessionExpiresAt : null,
      authMode: "system_browser_pkce",
      productionConfigured: false,
      message: this.session.state === "signed_out"
        ? "湖岸统一账号尚未接入生产服务；当前不会打开登录页或发起网络请求。"
        : this.session.state === "expired"
          ? "湖岸账号本地模拟会话已过期。"
          : this.session.state === "revoked"
            ? "湖岸账号本地模拟设备已撤销。"
            : "湖岸账号本地模拟会话已登录；未连接生产服务。",
    };
  }

  beginLogin() {
    return {
      state: "configuration_required",
      opened: false,
      authMode: "system_browser_pkce",
      message: "生产账号服务尚未配置，未发起网络请求。",
    };
  }

  simulateLogin({ accountId, ttlSeconds = 3600 } = {}) {
    if (!this.allowLocalSimulation) throw new Error("本地账号模拟未启用");
    safeString(accountId, "accountId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) throw new Error("ttlSeconds 非法");
    const expires = new Date(this.clock().getTime() + ttlSeconds * 1000).toISOString();
    this.session = { state: "authenticated", accountId, sessionExpiresAt: expires };
    return this.status();
  }

  logout() {
    this.session = { state: "signed_out", accountId: null, sessionExpiresAt: null };
    return this.status();
  }

  expireSession() {
    this.session = { state: "expired", accountId: null, sessionExpiresAt: null };
    return this.status();
  }

  revokeDevice() {
    this.session = { state: "revoked", accountId: null, sessionExpiresAt: null };
    return this.status();
  }
}

const FREE_CAPABILITIES = Object.freeze({
  localProjectAccess: true,
  existingExports: true,
  basicRules: true,
  completeRulepacks: false,
  allPublishedMechanicalFixes: false,
  completeExports: false,
  enhancedCheckpoints: false,
  fullSyncHistory: false,
});
const PRO_CAPABILITIES = Object.freeze(Object.fromEntries(
  Object.keys(FREE_CAPABILITIES).map((key) => [key, true]),
));

class LicenseProvider {
  constructor({
    tier = "free",
    entitlementState = "local_default",
    validUntil = null,
    graceUntil = null,
    clock = () => new Date(),
  } = {}) {
    this.tier = enumValue(tier, new Set(["free", "pro"]), "tier");
    this.entitlementState = safeString(entitlementState, "entitlementState", /^[A-Za-z][A-Za-z0-9_-]{0,31}$/);
    this.validUntil = validUntil === null ? null : isoTime(validUntil, "validUntil");
    this.graceUntil = graceUntil === null ? null : isoTime(graceUntil, "graceUntil");
    if ((this.validUntil === null) !== (this.graceUntil === null)) {
      throw new Error("validUntil 与 graceUntil 必须同时提供");
    }
    if (this.validUntil !== null && Date.parse(this.graceUntil) < Date.parse(this.validUntil)) {
      throw new Error("graceUntil 不能早于 validUntil");
    }
    this.clock = clock;
  }

  status() {
    let entitlementState = this.entitlementState;
    if (this.tier === "pro" && this.validUntil !== null) {
      const now = this.clock().getTime();
      entitlementState = now <= Date.parse(this.validUntil)
        ? "active"
        : now <= Date.parse(this.graceUntil)
          ? "grace"
          : "expired";
    }
    const effectiveTier = this.tier === "pro" && !["expired", "invalid"].includes(entitlementState)
      ? "pro"
      : "free";
    return {
      tier: this.tier,
      effectiveTier,
      entitlementState,
      validUntil: this.validUntil,
      graceUntil: this.graceUntil,
      signatureVerified: false,
      productionConfigured: false,
      localProjectsLocked: false,
      deviceLimit: effectiveTier === "pro" ? 3 : 1,
      capabilities: clone(effectiveTier === "pro" ? PRO_CAPABILITIES : FREE_CAPABILITIES),
      message: effectiveTier === "pro"
        ? `Pro 本地模拟权益（${entitlementState}）；生产订阅服务尚未接入，本地文件始终可访问。`
        : "Free 本地默认权益；生产订阅服务尚未接入，本地文件始终可访问。",
    };
  }
}

class SyncProvider {
  constructor({ clock = () => new Date(), idFactory = null, requirePersistence = false } = {}) {
    this.clock = clock;
    this.idFactory = idFactory || (() => `queue-${randomUUID()}`);
    this.requirePersistence = requirePersistence === true;
    this.preference = "never_asked";
    this.projectBlocks = new Set();
    this.queue = new Map();
    this.byIdempotency = new Map();
    this.revision = 0;
    this.store = null;
    this.persistenceFailure = null;
  }

  getPreference() { return this.preference; }

  persistenceStatus() {
    if (this.store) return { state: "ready", encrypted: this.store.encrypted === true, persistent: true };
    if (this.persistenceFailure) return { state: "unavailable", encrypted: false, persistent: false };
    return {
      state: this.requirePersistence ? "initializing" : "memory_only",
      encrypted: false,
      persistent: false,
    };
  }

  configurePersistence(store) {
    if (!store || typeof store.load !== "function" || typeof store.save !== "function" || store.encrypted !== true) {
      throw new TypeError("同步持久存储必须提供加密 load/save 契约");
    }
    const loaded = store.load();
    if (loaded !== null) {
      validateSyncStoreState(loaded);
      this._importState(loaded);
    }
    this.store = store;
    this.persistenceFailure = null;
    return this.persistenceStatus();
  }

  disablePersistence(error = null) {
    this.store = null;
    this.persistenceFailure = error || new Error("系统安全存储不可用");
    return this.persistenceStatus();
  }

  _blockKey(account, project) { return `${account}\0${project}`; }

  _idempotencyKey(account, idempotencyId) { return `${account}\0${idempotencyId}`; }

  _exportState(revision = this.revision) {
    const projectBlocks = [...this.projectBlocks]
      .sort()
      .map((key) => {
        const separator = key.indexOf("\0");
        return { account_id: key.slice(0, separator), project_id: key.slice(separator + 1) };
      });
    const queue = [...this.queue.values()]
      .map(clone)
      .sort((left, right) => left.queue_id < right.queue_id ? -1 : left.queue_id > right.queue_id ? 1 : 0);
    return {
      schema_version: "1.0",
      store_type: "oak_manuscript_sync_queue",
      revision,
      preference: this.preference,
      project_blocks: projectBlocks,
      queue,
    };
  }

  _importState(state) {
    validateSyncStoreState(state);
    this.revision = state.revision;
    this.preference = state.preference;
    this.projectBlocks = new Set(state.project_blocks.map((item) => this._blockKey(item.account_id, item.project_id)));
    this.queue = new Map(state.queue.map((item) => [item.queue_id, clone(item)]));
    this.byIdempotency = new Map(state.queue.map((item) => [
      this._idempotencyKey(item.account_id, item.idempotency_id),
      item.queue_id,
    ]));
  }

  _transaction(mutator) {
    if (this.requirePersistence && !this.store) {
      throw new Error("本机加密同步队列不可用；没有发送或保存任何同步负载");
    }
    const draftProvider = new SyncProvider({ clock: this.clock, idFactory: this.idFactory });
    draftProvider.preference = this.preference;
    draftProvider.projectBlocks = new Set(this.projectBlocks);
    draftProvider.queue = new Map([...this.queue].map(([key, value]) => [key, clone(value)]));
    draftProvider.byIdempotency = new Map(this.byIdempotency);
    draftProvider.revision = this.revision;
    const result = mutator(draftProvider);
    const next = draftProvider._exportState(this.revision + 1);
    validateSyncStoreState(next);
    if (this.store) this.store.save(next, { expectedRevision: this.revision });
    this._importState(next);
    return result;
  }

  setPreference(value) {
    if (!SYNC_PREFERENCES.has(value)) throw new Error("同步偏好非法");
    if (value !== this.preference) this._transaction((draft) => { draft.preference = value; });
    return value;
  }

  _requireAuth(authStatus) {
    if (!authStatus || authStatus.loggedIn !== true || authStatus.state !== "authenticated") {
      throw new Error("必须先登录湖岸账号；登录本身不代表同意同步");
    }
  }

  shouldOffer(projectId, authStatus) {
    if (!authStatus || authStatus.loggedIn !== true || authStatus.state !== "authenticated") return false;
    return this.preference !== "off" && !this.projectBlocks.has(this._blockKey(accountId(authStatus.accountId), projectId));
  }

  preview(record, authStatus) {
    this._requireAuth(authStatus);
    validateSyncRecordV1(record);
    if (!this.shouldOffer(record.project_id, authStatus)) throw new Error("该项目已关闭同步询问");
    if (this.requirePersistence && !this.store) {
      throw new Error("本机加密同步队列不可用；没有读取稿件，也不会创建同步预览");
    }
    return {
      record: clone(record),
      choices: [...SYNC_CHOICES],
      transportConfigured: false,
      persistence: this.persistenceStatus(),
    };
  }

  confirm(record, choice, authStatus) {
    this._requireAuth(authStatus);
    validateSyncRecordV1(record);
    enumValue(choice, new Set(SYNC_CHOICES), "同步选择");
    if (choice === "not_now") {
      return { action: choice, queued: false, preference: this.preference };
    }
    if (choice === "never_for_project") {
      const key = this._blockKey(accountId(authStatus.accountId), record.project_id);
      if (!this.projectBlocks.has(key)) this._transaction((draft) => { draft.projectBlocks.add(key); });
      return { action: choice, queued: false, preference: this.preference };
    }
    const account = accountId(authStatus.accountId);

    const existingId = this.byIdempotency.get(this._idempotencyKey(account, record.idempotency_id));
    if (existingId && this.queue.has(existingId)) {
      return {
        action: choice,
        queued: true,
        preference: this.preference,
        duplicate: true,
        item: this._publicItem(this.queue.get(existingId)),
        persistence: this.persistenceStatus(),
      };
    }
    const now = this.clock().toISOString();
    const payload = clone(record);
    if (payload.authorized_at === null) payload.authorized_at = now;
    validateSyncRecordV1(payload);
    const item = {
      account_id: account,
      queue_id: safeString(this.idFactory(), "queue_id", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
      idempotency_id: payload.idempotency_id,
      state: "pending_transport",
      created_at: now,
      updated_at: now,
      attempts: 0,
      last_error: null,
      payload,
    };
    this._transaction((draft) => {
      if (choice === "ask_each_time") draft.preference = "ask_each_time";
      draft.queue.set(item.queue_id, clone(item));
      draft.byIdempotency.set(draft._idempotencyKey(account, item.idempotency_id), item.queue_id);
    });
    return {
      action: choice,
      queued: true,
      preference: this.preference,
      duplicate: false,
      item: this._publicItem(item),
      persistence: this.persistenceStatus(),
    };
  }

  _publicItem(item) {
    const result = clone(item);
    delete result.account_id;
    return result;
  }

  listQueue(authStatus) {
    this._requireAuth(authStatus);
    const account = accountId(authStatus.accountId);
    return [...this.queue.values()]
      .filter((item) => item.account_id === account)
      .map((item) => this._publicItem(item));
  }

  _item(queueId, authStatus) {
    this._requireAuth(authStatus);
    safeString(queueId, "queueId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    const item = this.queue.get(queueId);
    if (!item) throw new Error("同步队列项不存在");
    if (item.account_id !== accountId(authStatus.accountId)) throw new Error("同步队列项不属于当前账号");
    return item;
  }

  cancel(queueId, authStatus) {
    const item = this._item(queueId, authStatus);
    if (item.state !== "canceled") {
      const now = this.clock().toISOString();
      this._transaction((draft) => {
        const target = draft.queue.get(queueId);
        target.state = "canceled";
        target.updated_at = now;
      });
    }
    return this._publicItem(this.queue.get(queueId));
  }

  retry(queueId, authStatus) {
    const item = this._item(queueId, authStatus);
    if (item.state !== "pending_transport" || item.last_error !== null) {
      const now = this.clock().toISOString();
      this._transaction((draft) => {
        const target = draft.queue.get(queueId);
        target.state = "pending_transport";
        target.updated_at = now;
        target.last_error = null;
      });
    }
    return this._publicItem(this.queue.get(queueId));
  }

  delete(queueId, authStatus) {
    const item = this._item(queueId, authStatus);
    this._transaction((draft) => {
      draft.byIdempotency.delete(draft._idempotencyKey(item.account_id, item.idempotency_id));
      draft.queue.delete(queueId);
    });
    return true;
  }
}

const authProvider = new AuthProvider();
const licenseProvider = new LicenseProvider();
const syncProvider = new SyncProvider({ requirePersistence: true });

const EvaluationProvider = {
  evaluationUrl() {
    return "https://oakbylake.com/free-manuscript-check/?utm_source=oak-manuscript-app&intent=evaluation";
  },
};

module.exports = {
  AuthProvider,
  LicenseProvider,
  SyncProvider,
  buildSyncRecordV1,
  validateSyncRecordV1,
  validateStoredQueueItem,
  validateSyncStoreState,
  SYNC_CHOICES,
  authProvider,
  licenseProvider,
  syncProvider,
  EvaluationProvider,
};
