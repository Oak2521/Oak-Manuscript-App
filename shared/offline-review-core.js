(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.createOakOfflineReviewCodec = factory;
})(typeof globalThis !== "undefined" ? globalThis : this, function (hashSync) {
"use strict";
const encoder = new TextEncoder();
const utf8Length = (value) => encoder.encode(value).byteLength;
const encode = (value) => encoder.encode(value);
const INPUT_LIMITS = Object.freeze({ max_depth: 32, max_nodes: 200000 });


const SCHEMA_VERSION = "1.0";
const RECORD_TYPE = "oak_manuscript_offline_review_package";
const LIMITS = Object.freeze({
  max_report_bytes: 16 * 1024 * 1024,
  max_package_bytes: 2 * 1024 * 1024,
  max_issues: 2000,
  max_array_items: 2000,
  max_string_bytes: 512,
  max_standard_refs_per_issue: 16,
});

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
const STRICT_SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;
const SOURCE_FORMATS = new Set(["docx", "epub", "md", "txt"]);
const MANUSCRIPT_TYPES = new Set(["paper", "print_book", "ebook"]);
const CHECK_KINDS = new Set(["check", "recheck"]);
const SEVERITIES = Object.freeze(["error", "warning", "suggestion"]);
const SEVERITY_SET = new Set(SEVERITIES);
const ISSUE_STATUSES = new Set(["open", "accepted", "resolved", "rejected"]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);
const STATUS_LEVELS = new Set([
  "尚未具备提交条件",
  "可在订正后提交",
  "基本具备编辑评估条件",
]);
const EXTERNAL_TOOL_STATUSES = new Set(["not_run", "passed", "failed"]);
const MILESTONES = new Set(["M1", "M2", "M3"]);

function fail(message) {
  throw new TypeError(message);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireObject(value, label, fields, { exact = true } = {}) {
  if (!isPlainObject(value)) {
    fail(`${label} 必须是对象`);
  }
  const actual = Object.keys(value);
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  const unknown = exact ? actual.filter((field) => !fields.includes(field)) : [];
  if (missing.length || unknown.length) {
    fail(`${label} 字段非法；缺失=${missing.join(",") || "无"}；unknown=${unknown.join(",") || "无"}`);
  }
  return value;
}

function requireString(value, label, { allowed, pattern } = {}) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} 必须是非空 string`);
  }
  if (utf8Length(value) > LIMITS.max_string_bytes) {
    fail(`${label} string 超过上限`);
  }
  if (allowed && !allowed.has(value)) {
    fail(`${label} 值非法`);
  }
  if (pattern && !pattern.test(value)) {
    fail(`${label} 格式非法`);
  }
  return value;
}

function requireSha256(value, label) {
  return requireString(value, label, { pattern: SHA256 });
}

function requireInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${label} 必须是 ${min}..${max} 的安全整数`);
  }
  return value;
}

function requireNullableInteger(value, label) {
  if (value === null) {
    return null;
  }
  return requireInteger(value, label);
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    fail(`${label} 必须是 boolean`);
  }
  return value;
}

function requireArray(value, label, max = LIMITS.max_array_items) {
  if (!Array.isArray(value)) {
    fail(`${label} 必须是 array`);
  }
  if (value.length > max) {
    fail(`${label} 超过 array 上限 ${max}`);
  }
  return value;
}

function requireUniqueStrings(value, label, { max, pattern = SAFE_ID, sorted = false } = {}) {
  const items = requireArray(value, label, max);
  for (const item of items) {
    requireString(item, `${label} item`, { pattern });
  }
  if (new Set(items).size !== items.length) {
    fail(`${label} 含重复项`);
  }
  if (sorted && items.some((item, index) => index > 0 && items[index - 1] > item)) {
    fail(`${label} 必须排序`);
  }
  return items;
}

function sortForCanonicalJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForCanonicalJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortForCanonicalJson(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  assertJsonShape(value);
  return JSON.stringify(sortForCanonicalJson(value));
}

function canonicalJsonOrFail(value, label) {
  let json;
  try {
    json = canonicalJson(value);
  } catch (error) {
    fail(`${label} 不是可序列化 JSON：${error.message}`);
  }
  if (typeof json !== "string") {
    fail(`${label} 不是可序列化 JSON`);
  }
  return json;
}

function sha256(value) {
  if (typeof hashSync !== "function") fail("synchronous digest unavailable; use Web Crypto adapter");
  return hashSync(value);
}

function copyRulepack(rulepack) {
  return {
    name: rulepack.name,
    version: rulepack.version,
    pinned: rulepack.pinned,
    sha256: rulepack.sha256,
    bundle_id: rulepack.bundle_id,
    release_sequence: rulepack.release_sequence,
    manifest_sha256: rulepack.manifest_sha256,
  };
}

function validateIsoInstant(value, label) {
  requireString(value, label, { pattern: ISO_INSTANT });
  if (Number.isNaN(Date.parse(value))) {
    fail(`${label} 时间非法`);
  }
  return value;
}

function validateRulepack(rulepack, label = "rulepack") {
  requireObject(rulepack, label, [
    "name",
    "version",
    "pinned",
    "sha256",
    "bundle_id",
    "release_sequence",
    "manifest_sha256",
  ]);
  requireString(rulepack.name, `${label}.name`, { pattern: SAFE_ID });
  requireString(rulepack.version, `${label}.version`, { pattern: STRICT_SEMVER });
  if (rulepack.pinned !== true) {
    fail(`${label}.pinned 必须为 true`);
  }
  requireSha256(rulepack.sha256, `${label}.sha256`);
  requireString(rulepack.bundle_id, `${label}.bundle_id`, { pattern: SAFE_BUNDLE_ID });
  requireInteger(rulepack.release_sequence, `${label}.release_sequence`, { min: 1 });
  requireSha256(rulepack.manifest_sha256, `${label}.manifest_sha256`);
  return rulepack;
}

function validateCountObject(value, label) {
  requireObject(value, label, SEVERITIES);
  for (const severity of SEVERITIES) {
    requireInteger(value[severity], `${label}.${severity}`);
  }
  return value;
}

function validateSourceIdentity(value, label = "source_identity") {
  requireObject(value, label, ["format", "size_bytes", "sha256"]);
  requireString(value.format, `${label}.format`, { allowed: SOURCE_FORMATS });
  requireInteger(value.size_bytes, `${label}.size_bytes`, { min: 1 });
  requireSha256(value.sha256, `${label}.sha256`);
  return value;
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function expectedCounts(issues, pendingOnly) {
  const counts = { error: 0, warning: 0, suggestion: 0 };
  for (const issue of issues) {
    if (!pendingOnly || issue.status === "open" || issue.status === "accepted") {
      counts[issue.severity] += 1;
    }
  }
  return counts;
}

function expectedStatusLevel(pendingCounts) {
  if (pendingCounts.error > 0) {
    return "尚未具备提交条件";
  }
  if (pendingCounts.warning > 0) {
    return "可在订正后提交";
  }
  return "基本具备编辑评估条件";
}

function validateLocationInput(location, label) {
  requireObject(location, label, ["part", "paragraph", "line", "note_id", "resource"]);
  requireString(location.part, `${label}.part`, { pattern: SAFE_ID });
  requireNullableInteger(location.paragraph, `${label}.paragraph`);
  requireNullableInteger(location.line, `${label}.line`);
  requireNullableInteger(location.note_id, `${label}.note_id`);
  if (location.resource !== null) {
    requireString(location.resource, `${label}.resource`);
  }
  return location;
}

function projectLocation(location) {
  return {
    part: location.part,
    paragraph: location.paragraph,
    line: location.line,
    note_id: location.note_id,
    resource_sha256: location.resource === null ? null : sha256(location.resource),
  };
}

function validateProjectedLocation(location, label) {
  requireObject(location, label, ["part", "paragraph", "line", "note_id", "resource_sha256"]);
  requireString(location.part, `${label}.part`, { pattern: SAFE_ID });
  requireNullableInteger(location.paragraph, `${label}.paragraph`);
  requireNullableInteger(location.line, `${label}.line`);
  requireNullableInteger(location.note_id, `${label}.note_id`);
  if (location.resource_sha256 !== null) {
    requireSha256(location.resource_sha256, `${label}.resource_sha256`);
  }
  return location;
}

function validateIssueInput(issue, index, report) {
  const label = `report.issues[${index}]`;
  requireObject(issue, label, [
    "issue_id",
    "rule_id",
    "profile",
    "severity",
    "title",
    "explanation",
    "location",
    "preview",
    "standard_refs",
    "auto_fixable",
    "fix_id",
    "confidence",
    "status",
  ], { exact: false });
  requireString(issue.issue_id, `${label}.issue_id`, { pattern: SAFE_ID });
  if (!issue.issue_id.startsWith(`${report.check.check_id}-`)) {
    fail(`${label}.issue_id 不属于 check_id`);
  }
  requireString(issue.rule_id, `${label}.rule_id`, { pattern: SAFE_ID });
  requireString(issue.profile, `${label}.profile`, { allowed: MANUSCRIPT_TYPES });
  if (issue.profile !== report.manuscript_type) {
    fail(`${label}.profile 与 manuscript_type 不匹配`);
  }
  requireString(issue.severity, `${label}.severity`, { allowed: SEVERITY_SET });
  validateLocationInput(issue.location, `${label}.location`);
  requireUniqueStrings(issue.standard_refs, `${label}.standard_refs`, {
    max: LIMITS.max_standard_refs_per_issue,
  });
  requireBoolean(issue.auto_fixable, `${label}.auto_fixable`);
  requireString(issue.confidence, `${label}.confidence`, { allowed: CONFIDENCE_LEVELS });
  requireString(issue.status, `${label}.status`, { allowed: ISSUE_STATUSES });
  return issue;
}

function projectIssue(issue) {
  return {
    issue_id: issue.issue_id,
    rule_id: issue.rule_id,
    profile: issue.profile,
    severity: issue.severity,
    location: projectLocation(issue.location),
    standard_refs: [...issue.standard_refs],
    auto_fixable: issue.auto_fixable,
    confidence: issue.confidence,
    status: issue.status,
  };
}

function validateProjectedIssue(issue, index, payload) {
  const label = `payload.issues[${index}]`;
  requireObject(issue, label, [
    "issue_id",
    "rule_id",
    "profile",
    "severity",
    "location",
    "standard_refs",
    "auto_fixable",
    "confidence",
    "status",
  ]);
  requireString(issue.issue_id, `${label}.issue_id`, { pattern: SAFE_ID });
  if (!issue.issue_id.startsWith(`${payload.check.check_id}-`)) {
    fail(`${label}.issue_id 不属于 check_id`);
  }
  requireString(issue.rule_id, `${label}.rule_id`, { pattern: SAFE_ID });
  requireString(issue.profile, `${label}.profile`, { allowed: MANUSCRIPT_TYPES });
  if (issue.profile !== payload.document.manuscript_type) {
    fail(`${label}.profile 与 document.manuscript_type 不匹配`);
  }
  requireString(issue.severity, `${label}.severity`, { allowed: SEVERITY_SET });
  validateProjectedLocation(issue.location, `${label}.location`);
  requireUniqueStrings(issue.standard_refs, `${label}.standard_refs`, {
    max: LIMITS.max_standard_refs_per_issue,
  });
  requireBoolean(issue.auto_fixable, `${label}.auto_fixable`);
  requireString(issue.confidence, `${label}.confidence`, { allowed: CONFIDENCE_LEVELS });
  requireString(issue.status, `${label}.status`, { allowed: ISSUE_STATUSES });
  return issue;
}

function validateFormatCoverage(value, sourceFormat, label = "format_coverage") {
  if (value === null) {
    if (sourceFormat !== "epub") {
      fail(`${label} 仅 EPUB 可为 null`);
    }
    return null;
  }
  requireObject(value, label, [
    "schema_version",
    "format",
    "status",
    "rule_ids",
    "auto_fixable_rule_ids",
    "excluded_contexts",
    "not_checked",
  ]);
  const expectedVersion = sourceFormat === "docx" ? "1.1" : "1.0";
  if (value.schema_version !== expectedVersion || value.format !== sourceFormat || value.status !== "limited") {
    fail(`${label} identity 与 source format 不匹配`);
  }
  requireUniqueStrings(value.rule_ids, `${label}.rule_ids`, { sorted: true });
  requireUniqueStrings(value.auto_fixable_rule_ids, `${label}.auto_fixable_rule_ids`, { sorted: true });
  if (value.auto_fixable_rule_ids.some((ruleId) => !value.rule_ids.includes(ruleId))) {
    fail(`${label}.auto_fixable_rule_ids 不属于 rule_ids`);
  }
  requireUniqueStrings(value.excluded_contexts, `${label}.excluded_contexts`);
  requireUniqueStrings(value.not_checked, `${label}.not_checked`);
  return value;
}

function projectFormatCoverage(value, sourceFormat) {
  if (value === null) {
    if (sourceFormat !== "epub") {
      fail("report.format_coverage 仅 EPUB 可为 null");
    }
    return null;
  }
  const projected = {
    schema_version: value.schema_version,
    format: value.format,
    status: value.status,
    rule_ids: [...value.rule_ids],
    auto_fixable_rule_ids: [...value.auto_fixable_rule_ids],
    excluded_contexts: [...value.excluded_contexts],
    not_checked: [...value.not_checked],
  };
  validateFormatCoverage(projected, sourceFormat, "report.format_coverage");
  return projected;
}

function validateReportInput(report, sourceIdentity) {
  requireObject(report, "report", [
    "generated_at",
    "app_version",
    "manuscript_type",
    "check",
    "rulepack",
    "status_level",
    "pending_counts",
    "issues",
    "format_coverage",
    "skipped_rule_groups",
    "external_tools",
  ], { exact: false });
  const reportJson = canonicalJsonOrFail(report, "report");
  if (utf8Length(reportJson) > LIMITS.max_report_bytes) {
    fail("report 超过上限");
  }
  validateIsoInstant(report.generated_at, "report.generated_at");
  requireString(report.app_version, "report.app_version", { pattern: STRICT_SEMVER });
  requireString(report.manuscript_type, "report.manuscript_type", { allowed: MANUSCRIPT_TYPES });
  validateRulepack(report.rulepack, "report.rulepack");

  requireObject(report.check, "report.check", [
    "check_id",
    "kind",
    "started_at",
    "finished_at",
    "rulepack_version",
    "rulepack",
    "issue_counts",
  ], { exact: false });
  requireString(report.check.check_id, "report.check.check_id", { pattern: SAFE_ID });
  requireString(report.check.kind, "report.check.kind", { allowed: CHECK_KINDS });
  validateIsoInstant(report.check.started_at, "report.check.started_at");
  validateIsoInstant(report.check.finished_at, "report.check.finished_at");
  if (Date.parse(report.check.finished_at) < Date.parse(report.check.started_at)) {
    fail("report.check 时间顺序非法");
  }
  requireString(report.check.rulepack_version, "report.check.rulepack_version", { pattern: STRICT_SEMVER });
  validateRulepack(report.check.rulepack, "report.check.rulepack");
  if (report.check.rulepack_version !== report.rulepack.version || !sameJson(report.check.rulepack, report.rulepack)) {
    fail("report rulepack identity 不匹配");
  }
  validateCountObject(report.check.issue_counts, "report.check.issue_counts");

  const issues = requireArray(report.issues, "report.issues", LIMITS.max_issues);
  issues.forEach((issue, index) => validateIssueInput(issue, index, report));
  if (new Set(issues.map((issue) => issue.issue_id)).size !== issues.length) {
    fail("report.issues issue_id 重复");
  }
  if (!sameJson(report.check.issue_counts, expectedCounts(issues, false))) {
    fail("report.check.issue_counts 与 issues 不匹配");
  }
  validateCountObject(report.pending_counts, "report.pending_counts");
  const pendingCounts = expectedCounts(issues, true);
  if (!sameJson(report.pending_counts, pendingCounts)) {
    fail("report.pending_counts 与 issues 不匹配");
  }
  requireString(report.status_level, "report.status_level", { allowed: STATUS_LEVELS });
  if (report.status_level !== expectedStatusLevel(pendingCounts)) {
    fail("report.status_level 与 pending_counts 不匹配");
  }

  projectFormatCoverage(report.format_coverage, sourceIdentity.format);

  const skipped = requireArray(report.skipped_rule_groups, "report.skipped_rule_groups");
  for (const [index, group] of skipped.entries()) {
    requireObject(group, `report.skipped_rule_groups[${index}]`, ["milestone", "reason"], { exact: false });
    requireString(group.milestone, `report.skipped_rule_groups[${index}].milestone`, {
      allowed: MILESTONES,
    });
    if (group.reason !== "本版本未实现") {
      fail(`report.skipped_rule_groups[${index}].reason 非法`);
    }
  }
  if (new Set(skipped.map((group) => group.milestone)).size !== skipped.length) {
    fail("report.skipped_rule_groups milestone 重复");
  }

  requireObject(report.external_tools, "report.external_tools", ["epubcheck", "ace"]);
  for (const tool of ["epubcheck", "ace"]) {
    requireString(report.external_tools[tool], `report.external_tools.${tool}`, {
      allowed: EXTERNAL_TOOL_STATUSES,
    });
  }
  return reportJson;
}

function buildOfflineReviewPackage(report, sourceIdentity) {
  validateSourceIdentity(sourceIdentity, "source_identity");
  const reportJson = validateReportInput(report, sourceIdentity);
  const formatCoverage = projectFormatCoverage(report.format_coverage, sourceIdentity.format);
  const payload = {
    source_identity: {
      format: sourceIdentity.format,
      size_bytes: sourceIdentity.size_bytes,
      sha256: sourceIdentity.sha256,
    },
    report_identity: {
      check_id: report.check.check_id,
      app_version: report.app_version,
      generated_at: report.generated_at,
      canonical_sha256: sha256(reportJson),
    },
    rulepack: copyRulepack(report.rulepack),
    document: {
      format: sourceIdentity.format,
      manuscript_type: report.manuscript_type,
    },
    check: {
      check_id: report.check.check_id,
      kind: report.check.kind,
      started_at: report.check.started_at,
      finished_at: report.check.finished_at,
      issue_counts: { ...report.check.issue_counts },
    },
    status: {
      level: report.status_level,
      pending_counts: { ...report.pending_counts },
    },
    issues: report.issues.map(projectIssue),
    format_coverage: formatCoverage,
    skipped_rule_groups: report.skipped_rule_groups.map((group) => ({
      milestone: group.milestone,
    })),
    external_tools: {
      epubcheck: report.external_tools.epubcheck,
      ace: report.external_tools.ace,
    },
  };

  const reviewPackage = {
    schema_version: SCHEMA_VERSION,
    record_type: RECORD_TYPE,
    payload,
    payload_sha256: sha256(canonicalJson(payload)),
  };
  validateOfflineReviewPackage(reviewPackage);
  if (utf8Length(`${canonicalJson(reviewPackage)}\n`) > LIMITS.max_package_bytes) {
    fail("offline review package 超过 package 上限");
  }
  return reviewPackage;
}

function validateReportIdentity(value, label = "payload.report_identity") {
  requireObject(value, label, ["check_id", "app_version", "generated_at", "canonical_sha256"]);
  requireString(value.check_id, `${label}.check_id`, { pattern: SAFE_ID });
  requireString(value.app_version, `${label}.app_version`, { pattern: STRICT_SEMVER });
  validateIsoInstant(value.generated_at, `${label}.generated_at`);
  requireSha256(value.canonical_sha256, `${label}.canonical_sha256`);
}

function validateStructure(reviewPackage) {
  assertJsonShape(reviewPackage, LIMITS.max_package_bytes, "package");
  requireObject(reviewPackage, "offline review package", [
    "schema_version",
    "record_type",
    "payload",
    "payload_sha256",
  ]);
  if (reviewPackage.schema_version !== SCHEMA_VERSION) {
    fail("offline review package schema 不受支持");
  }
  if (reviewPackage.record_type !== RECORD_TYPE) {
    fail("offline review package record_type 非法");
  }
  requireObject(reviewPackage.payload, "payload", [
    "source_identity",
    "report_identity",
    "rulepack",
    "document",
    "check",
    "status",
    "issues",
    "format_coverage",
    "skipped_rule_groups",
    "external_tools",
  ]);
  const payload = reviewPackage.payload;
  validateSourceIdentity(payload.source_identity, "payload.source_identity");
  validateReportIdentity(payload.report_identity);
  validateRulepack(payload.rulepack, "payload.rulepack");

  requireObject(payload.document, "payload.document", ["format", "manuscript_type"]);
  requireString(payload.document.format, "payload.document.format", { allowed: SOURCE_FORMATS });
  requireString(payload.document.manuscript_type, "payload.document.manuscript_type", {
    allowed: MANUSCRIPT_TYPES,
  });
  if (payload.document.format !== payload.source_identity.format) {
    fail("payload document/source format 不匹配");
  }

  requireObject(payload.check, "payload.check", [
    "check_id",
    "kind",
    "started_at",
    "finished_at",
    "issue_counts",
  ]);
  requireString(payload.check.check_id, "payload.check.check_id", { pattern: SAFE_ID });
  if (payload.check.check_id !== payload.report_identity.check_id) {
    fail("payload check/report identity 不匹配");
  }
  requireString(payload.check.kind, "payload.check.kind", { allowed: CHECK_KINDS });
  validateIsoInstant(payload.check.started_at, "payload.check.started_at");
  validateIsoInstant(payload.check.finished_at, "payload.check.finished_at");
  if (Date.parse(payload.check.finished_at) < Date.parse(payload.check.started_at)) {
    fail("payload.check 时间顺序非法");
  }
  validateCountObject(payload.check.issue_counts, "payload.check.issue_counts");

  requireObject(payload.status, "payload.status", ["level", "pending_counts"]);
  requireString(payload.status.level, "payload.status.level", { allowed: STATUS_LEVELS });
  validateCountObject(payload.status.pending_counts, "payload.status.pending_counts");

  const issues = requireArray(payload.issues, "payload.issues", LIMITS.max_issues);
  issues.forEach((issue, index) => validateProjectedIssue(issue, index, payload));
  if (new Set(issues.map((issue) => issue.issue_id)).size !== issues.length) {
    fail("payload.issues issue_id 重复");
  }
  if (!sameJson(payload.check.issue_counts, expectedCounts(issues, false))) {
    fail("payload.check.issue_counts 与 issues 不匹配");
  }
  if (!sameJson(payload.status.pending_counts, expectedCounts(issues, true))) {
    fail("payload.status.pending_counts 与 issues 不匹配");
  }
  if (payload.status.level !== expectedStatusLevel(payload.status.pending_counts)) {
    fail("payload.status.level 与 pending_counts 不匹配");
  }

  validateFormatCoverage(payload.format_coverage, payload.source_identity.format, "payload.format_coverage");

  const skipped = requireArray(payload.skipped_rule_groups, "payload.skipped_rule_groups");
  for (const [index, group] of skipped.entries()) {
    requireObject(group, `payload.skipped_rule_groups[${index}]`, ["milestone"]);
    requireString(group.milestone, `payload.skipped_rule_groups[${index}].milestone`, {
      allowed: MILESTONES,
    });
  }
  if (new Set(skipped.map((group) => group.milestone)).size !== skipped.length) {
    fail("payload.skipped_rule_groups milestone 重复");
  }

  requireObject(payload.external_tools, "payload.external_tools", ["epubcheck", "ace"]);
  for (const tool of ["epubcheck", "ace"]) {
    requireString(payload.external_tools[tool], `payload.external_tools.${tool}`, {
      allowed: EXTERNAL_TOOL_STATUSES,
    });
  }

  requireSha256(reviewPackage.payload_sha256, "payload_sha256");

  return reviewPackage;
}

function serializeOfflineReviewPackage(reviewPackage) {
  validateOfflineReviewPackage(reviewPackage);
  const bytes = encode(`${canonicalJson(reviewPackage)}\n`);
  if (bytes.length > LIMITS.max_package_bytes) {
    fail("offline review package 超过 package 上限");
  }
  return bytes;
}

function validateExpectedIdentity(reviewPackage, expected) {
  if (!isPlainObject(expected)) {
    fail("expected identity 必须是对象");
  }
  const allowed = new Set(["source_sha256", "report_canonical_sha256", "rulepack"]);
  const unknown = Object.keys(expected).filter((key) => !allowed.has(key));
  if (unknown.length) {
    fail(`expected identity unknown 字段：${unknown.join(",")}`);
  }
  if (Object.hasOwn(expected, "source_sha256")) {
    requireSha256(expected.source_sha256, "expected source_sha256");
    if (reviewPackage.payload.source_identity.sha256 !== expected.source_sha256) {
      fail("source identity 不匹配");
    }
  }
  if (Object.hasOwn(expected, "report_canonical_sha256")) {
    requireSha256(expected.report_canonical_sha256, "expected report_canonical_sha256");
    if (reviewPackage.payload.report_identity.canonical_sha256 !== expected.report_canonical_sha256) {
      fail("report identity 不匹配");
    }
  }
  if (Object.hasOwn(expected, "rulepack")) {
    validateRulepack(expected.rulepack, "expected rulepack");
    if (!sameJson(reviewPackage.payload.rulepack, expected.rulepack)) {
      fail("rulepack identity 不匹配");
    }
  }
}

// Bound the raw nesting before JSON.parse and the object graph before recursion.
function assertJsonShape(value, maxBytes = LIMITS.max_report_bytes, label = "report") {
  const pending = [{ value, depth: 0, label }];
  let nodes = 0, estimatedBytes = 0;
  while (pending.length) {
    const item = pending.pop(), current = item.value;
    if (++nodes > INPUT_LIMITS.max_nodes) fail(label + " node count limit");
    if (item.depth > INPUT_LIMITS.max_depth) fail(label + " depth limit 32");
    if (current === null || typeof current === "boolean") estimatedBytes += 5;
    else if (typeof current === "number") {
      if (!Number.isFinite(current)) fail(label + " non-finite number");
      estimatedBytes += String(current).length;
    } else if (typeof current === "string") {
      if (current.length > maxBytes) fail(label + " bytes 超过上限");
      estimatedBytes += utf8Length(current) + 2;
    } else {
      if (!Array.isArray(current) && !isPlainObject(current)) fail(label + " non-JSON object");
      const keys = Object.keys(current);
      if (keys.length > LIMITS.max_array_items) fail(item.label + " array/object 超过上限");
      if (Array.isArray(current) && keys.length !== current.length) fail(label + " sparse array");
      if (Object.getOwnPropertySymbols(current).length) fail(label + " symbol fields");
      estimatedBytes += 2 + keys.length;
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) fail(label + " accessor field");
        if (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/.test(key)) fail(label + " array field");
        if (key.length > maxBytes) fail(label + " key 超过上限");
        estimatedBytes += Array.isArray(current) ? 0 : utf8Length(key) + 3;
        pending.push({value: descriptor.value, depth:item.depth+1, label:item.label+"."+key});
      }
    }
    if (estimatedBytes > maxBytes) fail(label + " bytes 超过上限");
  }
}
function parseBoundedJson(text, maxBytes = LIMITS.max_package_bytes) {
  if (typeof text !== "string" || text.length > maxBytes || utf8Length(text) > maxBytes) fail("JSON bytes 超过上限");
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") {
      if (++depth > INPUT_LIMITS.max_depth) fail("JSON depth limit 32");
    } else if (c === "}" || c === "]") depth--;
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail("invalid JSON"); }
  assertJsonShape(parsed, maxBytes, "JSON");
  return parsed;
}
function readPackage(bytes, expected = {}) {
  if (!(bytes instanceof Uint8Array)) fail("offline review package 必须是 bytes");
  if (bytes.byteLength === 0 || bytes.byteLength > LIMITS.max_package_bytes) fail("package bytes 超过上限");
  const input = new Uint8Array(bytes);
  if (input[0] === 239 && input[1] === 187 && input[2] === 191) fail("UTF-8 BOM forbidden");
  let text;
  try { text = new TextDecoder("utf-8", {fatal:true}).decode(input); }
  catch { fail("invalid UTF-8"); }
  const parsed = parseBoundedJson(text);
  if (text !== canonicalJsonOrFail(parsed,"package")+"\n") fail("non-canonical JSON or duplicate key");
  validateStructure(parsed);
  validateExpectedIdentity(parsed, expected);
  return parsed;
}
function assertPayloadHash(pkg, actualHash) {
  if (pkg.payload_sha256 !== actualHash) fail("payload SHA-256 不匹配，可能已被篡改");
}
function validateOfflineReviewPackage(pkg) {
  validateStructure(pkg);
  assertPayloadHash(pkg, sha256(canonicalJson(pkg.payload)));
  return pkg;
}
function parseOfflineReviewPackage(bytes, expected = {}) {
  const pkg = readPackage(bytes, expected);
  assertPayloadHash(pkg, sha256(canonicalJson(pkg.payload)));
  return pkg;
}
return Object.freeze({
  LIMITS, INPUT_LIMITS, buildOfflineReviewPackage, parseOfflineReviewPackage,
  serializeOfflineReviewPackage, validateOfflineReviewPackage,
  readPackage, validateStructure, assertPayloadHash, validateExpectedIdentity,
  canonicalJson, parseBoundedJson, assertJsonShape, encode
});
});
