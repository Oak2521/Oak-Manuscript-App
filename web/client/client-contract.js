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

  return Object.freeze({
    MAX_BYTES: MAX_BYTES,
    buildCreatePayload: buildCreatePayload,
    formatFromFilename: formatFromFilename,
    mediaTypeForFormat: mediaTypeForFormat,
    parseJobStatus: parseJobStatus,
  });
});
