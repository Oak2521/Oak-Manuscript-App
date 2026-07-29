(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OakWebClientContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var FORMATS = Object.freeze(["docx", "md", "txt", "epub"]);
  var MANUSCRIPT_TYPES = Object.freeze(["paper", "print_book", "ebook"]);
  var CHECK_CONFIGS = Object.freeze(["quick", "full"]);
  var CITATION_STYLES = Object.freeze([
    "default", "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none",
  ]);
  var MEDIA_TYPES = Object.freeze({
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    md: "text/markdown",
    txt: "text/plain",
    epub: "application/epub+zip",
  });
  var MAX_BYTES = 50 * 1024 * 1024;
  var KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
  var JOB_ID_PATTERN = /^webjob-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  var JOB_STATES = Object.freeze([
    "awaiting_upload", "queued", "processing", "result_ready", "deletion_pending",
  ]);
  var STATUS_KEYS = Object.freeze([
    "schema_version", "record_type", "job_id", "state", "created_at", "expires_at",
    "input_retained", "result_available", "deletion_due_at",
  ]);
  var SYNC_BASE = "/manuscript/api/v1/sync-records";
  var SYNC_ID_PATTERN = /^sync-v1:[0-9a-f]{16}:check-[0-9]{4,}$/;
  var SYNC_RECORD_KEYS = Object.freeze([
    "schema_version", "record_type", "project_id", "run_id", "idempotency_id", "event",
    "document", "citation", "versions", "counts", "external_validation", "export_state",
    "created_at", "authorized_at",
  ]);

  function includes(list, value) { return list.indexOf(value) !== -1; }

  function exactKeys(input, expected) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return false;
    var actual = Object.keys(input).sort();
    var wanted = expected.slice().sort();
    return actual.length === wanted.length && actual.every(function (key, index) {
      return key === wanted[index];
    });
  }

  function formatFromFilename(filename) {
    if (typeof filename !== "string") return null;
    var match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match && includes(FORMATS, match[1]) ? match[1] : null;
  }

  function mediaTypeForFormat(format) {
    if (!includes(FORMATS, format)) throw new TypeError("不支持的稿件格式");
    return MEDIA_TYPES[format];
  }

  function buildCreatePayload(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("任务参数非法");
    }
    if (!includes(FORMATS, input.format) || !includes(MANUSCRIPT_TYPES, input.manuscriptType) ||
        !includes(CHECK_CONFIGS, input.checkConfig) || !includes(CITATION_STYLES, input.citationStyle)) {
      throw new TypeError("任务枚举非法");
    }
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_BYTES) {
      throw new TypeError("稿件大小超出范围");
    }
    if (typeof input.idempotencyKey !== "string" || !KEY_PATTERN.test(input.idempotencyKey)) {
      throw new TypeError("幂等键非法");
    }
    if (typeof input.grantedAt !== "string" || Number.isNaN(Date.parse(input.grantedAt))) {
      throw new TypeError("同意时间非法");
    }
    return Object.freeze({
      schema_version: "1.0",
      request_type: "oak_manuscript_web_job",
      idempotency_key: input.idempotencyKey,
      consent: Object.freeze({
        granted: true,
        scope: "single_job_processing",
        privacy_version: "web-privacy-v1",
        granted_at: input.grantedAt,
      }),
      document: Object.freeze({
        format: input.format,
        manuscript_type: input.manuscriptType,
        check_config: input.checkConfig,
        citation_style: input.citationStyle,
        size_bytes: input.sizeBytes,
      }),
    });
  }

  function parseJobStatus(input) {
    if (!exactKeys(input, STATUS_KEYS) || input.schema_version !== "1.0" ||
        input.record_type !== "oak_manuscript_web_job_status" ||
        typeof input.job_id !== "string" || !JOB_ID_PATTERN.test(input.job_id) ||
        !includes(JOB_STATES, input.state) || typeof input.input_retained !== "boolean" ||
        typeof input.result_available !== "boolean") {
      throw new TypeError("任务状态响应非法");
    }
    for (var field of ["created_at", "expires_at", "deletion_due_at"]) {
      if (typeof input[field] !== "string" || Number.isNaN(Date.parse(input[field]))) {
        throw new TypeError("任务状态响应非法");
      }
    }
    return Object.freeze({
      schema_version: input.schema_version,
      record_type: input.record_type,
      job_id: input.job_id,
      state: input.state,
      created_at: input.created_at,
      expires_at: input.expires_at,
      input_retained: input.input_retained,
      result_available: input.result_available,
      deletion_due_at: input.deletion_due_at,
    });
  }

  function canonicalTime(value) {
    return typeof value === "string" && !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString() === value;
  }

  function safeCountMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 64) return false;
    return Object.entries(value).every(function (entry) {
      return /^[a-z][a-z0-9_-]{0,63}$/.test(entry[0]) && Number.isSafeInteger(entry[1]) && entry[1] >= 0;
    });
  }

  function parseSyncRecord(record) {
    var expected = SYNC_RECORD_KEYS.slice();
    if (record && Object.prototype.hasOwnProperty.call(record, "issues")) expected.push("issues");
    if (!exactKeys(record, expected) || record.schema_version !== "1.0" ||
        record.record_type !== "oak_manuscript_result" ||
        typeof record.project_id !== "string" || !/^[0-9a-f]{16}$/.test(record.project_id) ||
        typeof record.run_id !== "string" || !/^check-[0-9]{4,}$/.test(record.run_id) ||
        typeof record.idempotency_id !== "string" || !SYNC_ID_PATTERN.test(record.idempotency_id) ||
        record.idempotency_id !== "sync-v1:" + record.project_id + ":" + record.run_id ||
        !includes(["check", "export"], record.event) || !canonicalTime(record.created_at) ||
        !canonicalTime(record.authorized_at) || Date.parse(record.authorized_at) < Date.parse(record.created_at)) {
      throw new TypeError("网站同步记录响应非法");
    }
    if (!exactKeys(record.document, ["format", "manuscript_type", "check_config", "language_bucket", "length_bucket"]) ||
        !includes(FORMATS, record.document.format) || !includes(MANUSCRIPT_TYPES, record.document.manuscript_type) ||
        !includes(CHECK_CONFIGS, record.document.check_config) ||
        !includes(["zh", "en", "mixed", "unknown"], record.document.language_bucket) ||
        typeof record.document.length_bucket !== "string" || record.document.length_bucket.length < 1 || record.document.length_bucket.length > 32) {
      throw new TypeError("网站同步记录响应非法");
    }
    if (!exactKeys(record.citation, ["requested_style", "resolved_style", "mode", "confidence", "reason_code", "resolver_version"]) ||
        !includes(CITATION_STYLES, record.citation.requested_style) ||
        !includes(CITATION_STYLES, record.citation.resolved_style) ||
        !includes(["style_specific", "limited", "disabled"], record.citation.mode) ||
        !includes(["high", "medium", "low", "not_applicable"], record.citation.confidence) ||
        typeof record.citation.reason_code !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(record.citation.reason_code) ||
        typeof record.citation.resolver_version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(record.citation.resolver_version)) {
      throw new TypeError("网站同步记录响应非法");
    }
    if (!exactKeys(record.versions, ["rulepack", "app", "platform"]) ||
        typeof record.versions.rulepack !== "string" || typeof record.versions.app !== "string" ||
        !includes(["win32", "darwin", "web"], record.versions.platform)) {
      throw new TypeError("网站同步记录响应非法");
    }
    if (!exactKeys(record.counts, ["total", "fixable", "by_severity", "by_dimension", "by_status"]) ||
        !Number.isSafeInteger(record.counts.total) || record.counts.total < 0 ||
        !Number.isSafeInteger(record.counts.fixable) || record.counts.fixable < 0 || record.counts.fixable > record.counts.total ||
        !exactKeys(record.counts.by_severity, ["error", "warning", "suggestion"]) ||
        !safeCountMap(record.counts.by_severity) || !safeCountMap(record.counts.by_dimension) || !safeCountMap(record.counts.by_status) ||
        record.counts.by_severity.error + record.counts.by_severity.warning + record.counts.by_severity.suggestion !== record.counts.total) {
      throw new TypeError("网站同步记录响应非法");
    }
    if (!exactKeys(record.external_validation, ["epubcheck", "ace"]) ||
        !includes(["not_applicable", "not_run", "passed", "failed"], record.external_validation.epubcheck) ||
        !includes(["not_applicable", "not_run", "passed", "failed"], record.external_validation.ace) ||
        !includes(["not_started", "completed", "partial"], record.export_state)) {
      throw new TypeError("网站同步记录响应非法");
    }
    if (Object.prototype.hasOwnProperty.call(record, "issues")) {
      if (!Array.isArray(record.issues) || record.issues.length > 1000 || record.issues.some(function (issue) {
        return !exactKeys(issue, ["rule_id", "severity", "dimension", "status", "fixable"]) ||
          typeof issue.rule_id !== "string" || typeof issue.dimension !== "string" ||
          !includes(["error", "warning", "suggestion"], issue.severity) ||
          !includes(["open", "accepted", "rejected", "deferred", "resolved"], issue.status) ||
          typeof issue.fixable !== "boolean";
      })) throw new TypeError("网站同步记录响应非法");
    }
    return {
      projectId: record.project_id, runId: record.run_id, event: record.event,
      format: record.document.format, manuscriptType: record.document.manuscript_type,
      checkConfig: record.document.check_config, languageBucket: record.document.language_bucket,
      lengthBucket: record.document.length_bucket, requestedStyle: record.citation.requested_style,
      resolvedStyle: record.citation.resolved_style, total: record.counts.total,
      fixable: record.counts.fixable, errors: record.counts.by_severity.error,
      warnings: record.counts.by_severity.warning, suggestions: record.counts.by_severity.suggestion,
      rulepackVersion: record.versions.rulepack, appVersion: record.versions.app,
      platform: record.versions.platform, exportState: record.export_state,
    };
  }

  function parseSyncRecordList(input) {
    if (!exactKeys(input, ["schema_version", "items", "truncated"]) || input.schema_version !== "1.0" ||
        !Array.isArray(input.items) || input.items.length > 50 || typeof input.truncated !== "boolean") {
      throw new TypeError("网站同步记录列表响应非法");
    }
    return Object.freeze({
      truncated: input.truncated,
      items: input.items.map(function (item) {
        if (!exactKeys(item, ["idempotency_id", "received_at", "record"]) ||
            typeof item.idempotency_id !== "string" || !SYNC_ID_PATTERN.test(item.idempotency_id) ||
            !canonicalTime(item.received_at) || item.record.idempotency_id !== item.idempotency_id) {
          throw new TypeError("网站同步记录列表响应非法");
        }
        return Object.freeze(Object.assign({
          idempotencyId: item.idempotency_id,
          receivedAt: item.received_at,
        }, parseSyncRecord(item.record)));
      }),
    });
  }

  function syncRecordPath(idempotencyId) {
    if (typeof idempotencyId !== "string" || !SYNC_ID_PATTERN.test(idempotencyId)) throw new TypeError("同步记录标识非法");
    return SYNC_BASE + "/" + idempotencyId;
  }

  function parseSyncDeleteResponse(input) {
    if (!exactKeys(input, ["schema_version", "deleted", "idempotency_id"]) || input.schema_version !== "1.0" ||
        input.deleted !== true || typeof input.idempotency_id !== "string" || !SYNC_ID_PATTERN.test(input.idempotency_id)) {
      throw new TypeError("同步记录删除响应非法");
    }
    return Object.freeze({ idempotencyId: input.idempotency_id });
  }

  return Object.freeze({
    MAX_BYTES: MAX_BYTES,
    buildCreatePayload: buildCreatePayload,
    formatFromFilename: formatFromFilename,
    mediaTypeForFormat: mediaTypeForFormat,
    parseJobStatus: parseJobStatus,
    parseSyncDeleteResponse: parseSyncDeleteResponse,
    parseSyncRecordList: parseSyncRecordList,
    syncRecordPath: syncRecordPath,
  });
});
