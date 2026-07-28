"use strict";

// Application-side semantic gate for already authenticated standards payloads.
// The signed-store verifies provenance and bytes; this module verifies that the
// payload only describes rules this application can actually execute safely.

const { TextDecoder } = require("node:util");
const { canonicalJson, compareSemver, sha256 } = require("./standards-store");

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_CAPABILITY_BYTES = 512 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_OBJECT_KEYS = 64;
const MAX_JSON_ARRAY_ITEMS = 2048;
const MAX_JSON_KEY_CODE_UNITS = 256;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RELEASE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const RULE_ID_RE = /^[A-Z0-9][A-Z0-9._-]{0,127}$/;
const STANDARD_ID_RE = /^[A-Z0-9][A-Z0-9._-]{0,127}$/;
const FIX_ID_RE = /^FIX-[A-Z0-9][A-Z0-9._-]{0,123}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9/_-]{0,255}$/;
const UNSAFE_TEXT_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
// This table is deliberately code, not updateable data. It is the Electron-side
// mirror of the mechanical fix implementations compiled into this app version.
// A signed standards release may select a subset of these capabilities, but it
// cannot assign a fixer to another rule or widen a fixer to another file format.
const AUTO_FIX_IMPLEMENTATIONS = Object.freeze({
  "DOCX-PARA-001": Object.freeze({ fix_id: "FIX-EMPTYPARA-001", format: "docx" }),
  "DOCX-PUNCT-001": Object.freeze({ fix_id: "FIX-PUNCT-001", format: "docx" }),
  "DOCX-SPACE-001": Object.freeze({ fix_id: "FIX-SPACE-001", format: "docx" }),
  "DOCX-SPACE-002": Object.freeze({ fix_id: "FIX-TAB-001", format: "docx" }),
  "EPUB-LANG-001": Object.freeze({ fix_id: "FIX-EPUB-LANG-001", format: "epub" }),
  "EPUB-MIME-001": Object.freeze({ fix_id: "FIX-EPUB-MIME-001", format: "epub" }),
});
const REQUIRED_STANDARD_FIELDS = Object.freeze([
  "standard_id", "title", "source_type", "official_source_url", "oak_resource_slug",
  "version", "updated_at", "scope", "summary", "status", "publisher", "reviewed_by",
  "copyright_use", "supersedes", "superseded_by", "rule_ids", "source_verified_at",
  "source_verification_status", "change_history",
]);
const REQUIRED_RULE_FIELDS = Object.freeze([
  "rule_id", "milestone", "applies_to", "severity", "confidence", "auto_fixable",
  "fix_id", "title", "explanation", "standard_refs", "enabled_by_default",
  "since_pack_version",
]);

class StandardsPayloadError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "StandardsPayloadError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new StandardsPayloadError(code, message, details);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, expected, label, code = "STANDARD_PAYLOAD_INVALID") {
  if (!isObject(value)) fail(code, `${label} 必须是对象`);
  const actual = Object.keys(value);
  const wanted = [...expected].sort();
  // Reject a key-count mismatch before sorting or returning attacker-controlled
  // key lists. This keeps a wide object from becoming a memory/log amplification.
  if (actual.length !== wanted.length) {
    fail(code, `${label} 字段集合非法`, {
      expected: wanted,
      actual_count: actual.length,
      actual_sample: actual.slice(0, 8).sort().map((key) => JSON.stringify(key)),
    });
  }
  actual.sort();
  if (actual.some((key, index) => key !== wanted[index])) {
    fail(code, `${label} 字段集合非法`, { expected: wanted, actual });
  }
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

function text(value, label, {
  max = 8192,
  pattern = null,
  empty = false,
  code = "STANDARD_PAYLOAD_INVALID",
} = {}) {
  if (typeof value !== "string" || value.length > max || hasLoneSurrogate(value) ||
      UNSAFE_TEXT_CONTROL_RE.test(value) || (!empty && value.trim() === "") ||
      (pattern && !pattern.test(value))) {
    fail(code, `${label} 非法`);
  }
  return value;
}

function oneOf(value, allowed, label, code = "STANDARD_PAYLOAD_INVALID") {
  if (!allowed.has(value)) fail(code, `${label} 非法：${String(value)}`);
  return value;
}

function snapshotBytes(bytes, label, maxBytes, code) {
  let raw;
  try {
    if (Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) raw = Buffer.from(bytes);
    else if (bytes instanceof ArrayBuffer) raw = Buffer.from(new Uint8Array(bytes));
    else fail(code, `${label} 必须是字节数据`);
  } catch (error) {
    if (error instanceof StandardsPayloadError) throw error;
    fail(code, `${label} 无法转换为字节数据`, { cause: error.message });
  }
  if (raw.length === 0 || raw.length > maxBytes) {
    fail(code, `${label} 大小非法`, { size: raw.length, max_bytes: maxBytes });
  }
  return raw;
}

function scanJsonStructure(decoded, label, code) {
  const stack = [];
  for (let index = 0; index < decoded.length; index += 1) {
    const char = decoded[index];
    if (char === "{") {
      stack.push({ type: "object", keys: new Set() });
    } else if (char === "[") {
      stack.push({ type: "array", separators: 0 });
    } else if (char === "}" || char === "]") {
      stack.pop();
    } else if (char === ",") {
      const frame = stack[stack.length - 1];
      if (frame?.type === "array") {
        frame.separators += 1;
        if (frame.separators >= MAX_JSON_ARRAY_ITEMS) {
          fail(code, `${label} 单个数组条目过多`);
        }
      }
    } else if (char === '"') {
      const start = index;
      let closed = false;
      for (index += 1; index < decoded.length; index += 1) {
        if (decoded[index] === "\\") {
          index += 1;
        } else if (decoded[index] === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) fail(code, `${label} 不是有效 JSON`);
      let cursor = index + 1;
      while (cursor < decoded.length && " \t\r\n".includes(decoded[cursor])) cursor += 1;
      if (decoded[cursor] === ":") {
        const frame = stack[stack.length - 1];
        if (!frame || frame.type !== "object") fail(code, `${label} 不是有效 JSON`);
        const token = decoded.slice(start, index + 1);
        if (token.length > MAX_JSON_KEY_CODE_UNITS + 2) {
          fail(code, `${label} 对象键名过长`);
        }
        let key;
        try {
          key = JSON.parse(token);
        } catch (error) {
          fail(code, `${label} 对象键名非法`, { cause: error.message });
        }
        if (hasLoneSurrogate(key)) fail(code, `${label} 对象键名含未配对 surrogate`);
        if (frame.keys.has(key)) {
          fail(code, `${label} 含重复对象键：${JSON.stringify(key)}`);
        }
        frame.keys.add(key);
        if (frame.keys.size > MAX_JSON_OBJECT_KEYS) {
          fail(code, `${label} 单个对象字段过多`);
        }
      }
    }
    if (stack.length > MAX_JSON_DEPTH) fail(code, `${label} JSON 嵌套过深`);
  }
}

function strictJson(bytes, label, {
  maxBytes = MAX_PAYLOAD_BYTES,
  code = "STANDARD_PAYLOAD_INVALID",
} = {}) {
  const raw = snapshotBytes(bytes, label, maxBytes, code);
  if (raw.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]))) {
    fail(code, `${label} 含 UTF-8 BOM`);
  }
  let decoded;
  try {
    decoded = UTF8.decode(raw);
  } catch (error) {
    fail(code, `${label} 不是严格 UTF-8`, { cause: error.message });
  }
  scanJsonStructure(decoded, label, code);
  try {
    return JSON.parse(decoded);
  } catch (error) {
    fail(code, `${label} 不是有效 JSON`, { cause: error.message });
  }
}

function uniqueStrings(values, label, {
  min = 1,
  max = 512,
  pattern = null,
  allowed = null,
  exclusiveWildcard = false,
} = {}) {
  if (!Array.isArray(values) || values.length < min || values.length > max) {
    fail("STANDARD_PAYLOAD_INVALID", `${label} 数量非法`);
  }
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    text(value, `${label}[${index}]`, { max: 256, pattern });
    if (allowed && !allowed.has(value)) fail("STANDARD_PAYLOAD_INVALID", `${label} 含不支持值 ${value}`);
    if (seen.has(value)) fail("STANDARD_PAYLOAD_INVALID", `${label} 含重复值 ${value}`);
    seen.add(value);
  }
  if (exclusiveWildcard && seen.has("*") && seen.size !== 1) {
    fail("STANDARD_PAYLOAD_INVALID", `${label} 的 * 不得与具体值并列`);
  }
  return seen;
}

function validateDate(value, label, { notAfter = null } = {}) {
  text(value, label, { max: 10, pattern: DATE_RE });
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) {
    fail("STANDARD_PAYLOAD_INVALID", `${label} 不是有效公历日期`);
  }
  if (notAfter !== null && value > notAfter) {
    fail("STANDARD_PAYLOAD_INVALID", `${label} 晚于 ${notAfter}`);
  }
  return value;
}

function manifestReleaseDate(manifest) {
  if (!isObject(manifest)) fail("STANDARD_PAYLOAD_INVALID", "manifest 必须是对象");
  text(manifest.released_at, "manifest.released_at", { max: 24, pattern: RELEASE_TIME_RE });
  return validateDate(manifest.released_at.slice(0, 10), "manifest.released_at 日期");
}

function validateSemver(value, label) {
  text(value, label, { max: 128, pattern: SEMVER_RE });
  // compareSemver also applies the cross-runtime numeric bounds and prerelease rules.
  compareSemver(value, value);
  return value;
}

function validateCapabilities(capabilityBytes) {
  const raw = snapshotBytes(
    capabilityBytes,
    "规则能力表",
    MAX_CAPABILITY_BYTES,
    "STANDARD_CAPABILITY_INVALID",
  );
  const value = strictJson(raw, "规则能力表", {
    maxBytes: MAX_CAPABILITY_BYTES,
    code: "STANDARD_CAPABILITY_INVALID",
  });
  // Validate and bound the shallow schema before recursive canonicalization.
  exactKeys(
    value,
    ["schema_version", "pack_name", "capabilities"],
    "规则能力表",
    "STANDARD_CAPABILITY_INVALID",
  );
  if (value.schema_version !== "1.0") fail("STANDARD_CAPABILITY_INVALID", "规则能力 schema 不受支持");
  text(value.pack_name, "规则能力 pack_name", {
    max: 128,
    pattern: /^[a-z0-9][a-z0-9._-]*$/,
    code: "STANDARD_CAPABILITY_INVALID",
  });
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0 ||
      value.capabilities.length > 1024) {
    fail("STANDARD_CAPABILITY_INVALID", "规则能力条目数量非法");
  }
  const byRule = new Map();
  let previous = null;
  for (const [index, entry] of value.capabilities.entries()) {
    exactKeys(entry, ["rule_id", "milestone", "auto_fixable", "fix_id"],
      `规则能力[${index}]`, "STANDARD_CAPABILITY_INVALID");
    const id = text(entry.rule_id, `规则能力[${index}].rule_id`, {
      pattern: RULE_ID_RE,
      code: "STANDARD_CAPABILITY_INVALID",
    });
    if (previous !== null && id <= previous) {
      fail("STANDARD_CAPABILITY_INVALID", "规则能力必须按 ASCII rule_id 严格排序且不重复");
    }
    previous = id;
    oneOf(
      entry.milestone,
      new Set(["M1", "M2", "M3"]),
      `${id}.milestone`,
      "STANDARD_CAPABILITY_INVALID",
    );
    if (typeof entry.auto_fixable !== "boolean") {
      fail("STANDARD_CAPABILITY_INVALID", `${id}.auto_fixable 必须是布尔值`);
    }
    const implementation = AUTO_FIX_IMPLEMENTATIONS[id];
    if (entry.auto_fixable) {
      text(entry.fix_id, `${id}.fix_id`, {
        pattern: FIX_ID_RE,
        code: "STANDARD_CAPABILITY_INVALID",
      });
      if (!implementation || entry.fix_id !== implementation.fix_id) {
        fail("STANDARD_CAPABILITY_INVALID", `${id} 自动修复能力与本 APP 编译实现不一致`);
      }
    } else {
      if (entry.fix_id !== null) {
        fail("STANDARD_CAPABILITY_INVALID", `${id} 不可修复却声明 fix_id`);
      }
      if (implementation) {
        fail("STANDARD_CAPABILITY_INVALID", `${id} 缺少本 APP 已编译的自动修复能力`);
      }
    }
    byRule.set(id, entry);
  }
  for (const id of Object.keys(AUTO_FIX_IMPLEMENTATIONS)) {
    if (!byRule.has(id)) {
      fail("STANDARD_CAPABILITY_INVALID", `规则能力表缺少本 APP 已编译规则 ${id}`);
    }
  }
  let canonical;
  try {
    canonical = Buffer.from(canonicalJson(value), "utf8");
  } catch (error) {
    fail("STANDARD_CAPABILITY_INVALID", "规则能力表无法 canonical 化", {
      cause: error.message,
    });
  }
  if (!raw.equals(canonical)) {
    fail("STANDARD_CAPABILITY_INVALID", "规则能力表不是 canonical UTF-8 + LF 字节");
  }
  return { document: value, byRule, sha256: sha256(raw) };
}

function validateMapping(mapping, standardIds, ruleDefinitions) {
  if (!isObject(mapping)) fail("STANDARD_PAYLOAD_INVALID", "citation_default_mapping 必须是对象");
  const hasResolver = Object.hasOwn(mapping, "resolver");
  exactKeys(
    mapping,
    hasResolver ? ["version", "standard_ref", "map", "resolver"] :
      ["version", "standard_ref", "map"],
    "citation_default_mapping",
  );
  validateSemver(mapping.version, "citation_default_mapping.version");
  text(mapping.standard_ref, "citation_default_mapping.standard_ref", { pattern: STANDARD_ID_RE });
  if (!standardIds.has(mapping.standard_ref)) {
    fail("STANDARD_PAYLOAD_INVALID", "默认体例映射引用了未注册标准");
  }
  if (!Array.isArray(mapping.map) || mapping.map.length === 0 || mapping.map.length > 16) {
    fail("STANDARD_PAYLOAD_INVALID", "默认体例映射条目数量非法");
  }
  const manuscriptTypes = new Set(["paper", "print_book", "ebook"]);
  const languages = new Set(["zh", "en", "mixed"]);
  const citationStyles = new Set([
    "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none",
  ]);
  const covered = new Set();
  for (const [index, entry] of mapping.map.entries()) {
    exactKeys(entry, ["manuscript_type", "languages", "citation_style"],
      `citation_default_mapping.map[${index}]`);
    oneOf(entry.manuscript_type, manuscriptTypes, `mapping[${index}].manuscript_type`);
    oneOf(entry.citation_style, citationStyles, `mapping[${index}].citation_style`);
    const entryLanguages = uniqueStrings(entry.languages, `mapping[${index}].languages`, {
      max: 3,
      allowed: languages,
    });
    for (const language of entryLanguages) {
      const key = `${entry.manuscript_type}\0${language}`;
      if (covered.has(key)) fail("STANDARD_PAYLOAD_INVALID", `默认体例映射重复覆盖 ${key}`);
      covered.add(key);
    }
  }
  for (const manuscriptType of manuscriptTypes) {
    for (const language of languages) {
      if (!covered.has(`${manuscriptType}\0${language}`)) {
        fail("STANDARD_PAYLOAD_INVALID", `默认体例映射未覆盖 ${manuscriptType} × ${language}`);
      }
    }
  }

  if (!hasResolver) return;
  const resolver = mapping.resolver;
  exactKeys(resolver, [
    "id", "version", "signal_extractor_version", "thresholds", "style_capability_rules",
  ], "citation_default_mapping.resolver");
  text(resolver.id, "citation_default_mapping.resolver.id", {
    max: 128,
    pattern: /^[a-z0-9][a-z0-9._-]*$/,
  });
  validateSemver(resolver.version, "citation_default_mapping.resolver.version");
  validateSemver(
    resolver.signal_extractor_version,
    "citation_default_mapping.resolver.signal_extractor_version",
  );
  const thresholds = resolver.thresholds;
  exactKeys(thresholds, [
    "strong_min_unique", "moderate_min_unique",
    "strong_min_coverage_percent", "moderate_min_coverage_percent",
  ], "citation_default_mapping.resolver.thresholds");
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isSafeInteger(value)) {
      fail("STANDARD_PAYLOAD_INVALID", `citation resolver threshold ${name} 必须是安全整数`);
    }
  }
  if (!(thresholds.moderate_min_unique >= 1 &&
        thresholds.moderate_min_unique <= thresholds.strong_min_unique &&
        thresholds.strong_min_unique <= 1000 &&
        thresholds.moderate_min_coverage_percent >= 1 &&
        thresholds.moderate_min_coverage_percent <= thresholds.strong_min_coverage_percent &&
        thresholds.strong_min_coverage_percent <= 100)) {
    fail("STANDARD_PAYLOAD_INVALID", "citation resolver thresholds 次序或范围非法");
  }
  const capabilityRules = resolver.style_capability_rules;
  const specificStyles = new Set([
    "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad",
  ]);
  exactKeys(capabilityRules, [...specificStyles], "citation resolver style_capability_rules");
  for (const style of specificStyles) {
    const ids = uniqueStrings(capabilityRules[style], `citation resolver ${style} capability rules`, {
      max: 32,
      pattern: RULE_ID_RE,
    });
    if (ids.size === 0) {
      fail("STANDARD_PAYLOAD_INVALID", `citation resolver ${style} 能力规则不能为空`);
    }
    for (const ruleId of ids) {
      const definition = ruleDefinitions.get(ruleId);
      if (!definition || !definition.applies_to.citation_styles.includes(style)) {
        fail("STANDARD_PAYLOAD_INVALID", `citation resolver ${style} 能力规则未声明该体例`);
      }
    }
  }
}

function validateRulepack(rulepack, manifest, capabilities, releaseDate) {
  exactKeys(rulepack, [
    "pack_name", "pack_version", "frozen_at", "description", "citation_default_mapping", "rules",
  ], "规则包");
  text(rulepack.pack_name, "pack_name", { max: 128, pattern: /^[a-z0-9][a-z0-9._-]*$/ });
  validateSemver(rulepack.pack_version, "pack_version");
  validateDate(rulepack.frozen_at, "frozen_at", { notAfter: releaseDate });
  text(rulepack.description, "description", { max: 16384 });
  if (rulepack.pack_name !== manifest.rulepack.name ||
      rulepack.pack_name !== capabilities.document.pack_name ||
      rulepack.pack_version !== manifest.rulepack.version ||
      rulepack.pack_version !== manifest.version) {
    fail("STANDARD_CAPABILITY_MISMATCH", "规则包名称/版本与 manifest 或 APP 能力表不一致");
  }
  if (!Array.isArray(rulepack.rules) || rulepack.rules.length === 0 || rulepack.rules.length > 1024) {
    fail("STANDARD_PAYLOAD_INVALID", "规则包 rules 数量非法");
  }

  const ids = new Set();
  const standardsByRule = new Map();
  const allowedFormats = new Set(["docx", "md", "txt", "epub"]);
  const allowedTypes = new Set(["paper", "print_book", "ebook"]);
  const allowedLanguages = new Set(["*", "zh", "en", "mixed"]);
  const allowedCitations = new Set([
    "*", "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none",
    "structure-only",
  ]);
  const definitionsById = new Map();
  for (const [index, rule] of rulepack.rules.entries()) {
    exactKeys(rule, REQUIRED_RULE_FIELDS, `rules[${index}]`);
    const id = text(rule.rule_id, `rules[${index}].rule_id`, { pattern: RULE_ID_RE });
    if (ids.has(id)) fail("STANDARD_PAYLOAD_INVALID", `rule_id 重复：${id}`);
    ids.add(id);
    definitionsById.set(id, rule);
    const capability = capabilities.byRule.get(id);
    if (!capability) fail("STANDARD_CAPABILITY_MISMATCH", `规则 ${id} 不在 APP 能力表中`);
    for (const field of ["milestone", "auto_fixable", "fix_id"]) {
      if (rule[field] !== capability[field]) {
        fail("STANDARD_CAPABILITY_MISMATCH", `规则 ${id}.${field} 与 APP 能力表不一致`);
      }
    }
    oneOf(rule.severity, new Set(["error", "warning", "suggestion"]), `${id}.severity`);
    oneOf(rule.confidence, new Set(["high", "medium", "low"]), `${id}.confidence`);
    if (rule.auto_fixable && rule.confidence !== "high") {
      fail("STANDARD_CAPABILITY_MISMATCH", `自动修复规则 ${id} 必须为 high confidence`);
    }
    if (typeof rule.enabled_by_default !== "boolean") {
      fail("STANDARD_PAYLOAD_INVALID", `${id}.enabled_by_default 必须是布尔值`);
    }
    validateSemver(rule.since_pack_version, `${id}.since_pack_version`);
    if (compareSemver(rule.since_pack_version, rulepack.pack_version) > 0) {
      fail("STANDARD_PAYLOAD_INVALID", `${id}.since_pack_version 晚于当前规则包`);
    }
    text(rule.title, `${id}.title`, { max: 512 });
    text(rule.explanation, `${id}.explanation`, { max: 16384 });
    const refs = uniqueStrings(rule.standard_refs, `${id}.standard_refs`, {
      max: 32,
      pattern: STANDARD_ID_RE,
    });
    standardsByRule.set(id, refs);
    exactKeys(rule.applies_to, ["formats", "manuscript_types", "languages", "citation_styles"],
      `${id}.applies_to`);
    const formats = uniqueStrings(rule.applies_to.formats, `${id}.formats`, {
      max: 4,
      allowed: allowedFormats,
    });
    if (rule.auto_fixable) {
      const implementation = AUTO_FIX_IMPLEMENTATIONS[id];
      if (!implementation || formats.size !== 1 || !formats.has(implementation.format)) {
        fail(
          "STANDARD_CAPABILITY_MISMATCH",
          `自动修复规则 ${id} 的文件格式范围超出本 APP 编译实现`,
        );
      }
    }
    uniqueStrings(rule.applies_to.manuscript_types, `${id}.manuscript_types`, {
      max: 3, allowed: allowedTypes,
    });
    uniqueStrings(rule.applies_to.languages, `${id}.languages`, {
      max: 4, allowed: allowedLanguages, exclusiveWildcard: true,
    });
    uniqueStrings(rule.applies_to.citation_styles, `${id}.citation_styles`, {
      max: 7, allowed: allowedCitations, exclusiveWildcard: true,
    });
  }
  return { ids, standardsByRule, definitionsById };
}

function validateStandards(standards, manifest, rulepack, rules, releaseDate) {
  exactKeys(standards, ["schema_version", "registry_version", "updated_at", "standards"],
    "标准注册表");
  if (standards.schema_version !== "2.0" || standards.registry_version !== manifest.version) {
    fail("STANDARD_PAYLOAD_INVALID", "标准注册表 schema 或 registry_version 与 manifest 不一致");
  }
  const registryUpdatedAt = validateDate(standards.updated_at, "标准注册表 updated_at", {
    notAfter: releaseDate,
  });
  if (!Array.isArray(standards.standards) || standards.standards.length === 0 ||
      standards.standards.length > 1024) {
    fail("STANDARD_PAYLOAD_INVALID", "标准注册表条目数量非法");
  }

  const byId = new Map();
  const declaredRules = new Map();
  const statuses = new Set(["active", "superseded", "under_review", "deprecated"]);
  const sourceTypes = new Set(["official", "technical_spec", "oak_interpretation"]);
  const copyrightUses = new Set(["metadata_only", "short_excerpt", "open_license"]);
  const verificationStatuses = new Set(["verified", "pending", "unavailable"]);
  for (const [index, standard] of standards.standards.entries()) {
    exactKeys(standard, REQUIRED_STANDARD_FIELDS, `standards[${index}]`);
    const id = text(standard.standard_id, `standards[${index}].standard_id`, {
      pattern: STANDARD_ID_RE,
    });
    if (byId.has(id)) fail("STANDARD_PAYLOAD_INVALID", `standard_id 重复：${id}`);
    byId.set(id, standard);
    oneOf(standard.status, statuses, `${id}.status`);
    oneOf(standard.source_type, sourceTypes, `${id}.source_type`);
    oneOf(standard.copyright_use, copyrightUses, `${id}.copyright_use`);
    oneOf(standard.source_verification_status, verificationStatuses,
      `${id}.source_verification_status`);
    for (const field of ["title", "version", "scope", "summary", "publisher"]) {
      text(standard[field], `${id}.${field}`, { max: field === "summary" ? 16384 : 2048 });
    }
    if (/(?:placeholder|待补充|占位|TODO)/iu.test(standard.summary)) {
      fail("STANDARD_PAYLOAD_INVALID", `${id}.summary 仍含占位内容`);
    }
    validateDate(standard.updated_at, `${id}.updated_at`, { notAfter: registryUpdatedAt });
    text(standard.oak_resource_slug, `${id}.oak_resource_slug`, { pattern: SLUG_RE });
    text(standard.official_source_url, `${id}.official_source_url`, { max: 4096, empty: true });
    if (standard.official_source_url !== "") {
      let url;
      try { url = new URL(standard.official_source_url); } catch {
        fail("STANDARD_PAYLOAD_INVALID", `${id}.official_source_url 非法`);
      }
      if (url.protocol !== "https:" || url.username || url.password ||
          url.hostname === "" || url.href !== standard.official_source_url) {
        fail(
          "STANDARD_PAYLOAD_INVALID",
          `${id}.official_source_url 必须是规范、无凭据的 HTTPS URL`,
        );
      }
    } else if (standard.source_type !== "oak_interpretation" &&
               (standard.status !== "under_review" ||
                standard.source_verification_status !== "unavailable")) {
      fail("STANDARD_PAYLOAD_INVALID", `${id} 缺少外部官方来源且未明确标为不可核验`);
    }
    const reviewers = uniqueStrings(standard.reviewed_by, `${id}.reviewed_by`, { max: 32 });
    if (reviewers.size === 0) fail("STANDARD_PAYLOAD_INVALID", `${id} 缺少审核者`);
    uniqueStrings(standard.supersedes, `${id}.supersedes`, {
      min: 0, max: 64, pattern: STANDARD_ID_RE,
    });
    const ruleIds = uniqueStrings(standard.rule_ids, `${id}.rule_ids`, {
      min: 0, max: 1024, pattern: RULE_ID_RE,
    });
    declaredRules.set(id, ruleIds);
    if (standard.superseded_by !== null) {
      text(standard.superseded_by, `${id}.superseded_by`, { pattern: STANDARD_ID_RE });
    }
    if (standard.status === "superseded" && standard.superseded_by === null) {
      fail("STANDARD_PAYLOAD_INVALID", `${id} 已 superseded 但缺少 superseded_by`);
    }
    if (standard.source_verified_at !== null) {
      validateDate(standard.source_verified_at, `${id}.source_verified_at`, {
        notAfter: registryUpdatedAt,
      });
    } else if (standard.source_verification_status === "verified") {
      fail("STANDARD_PAYLOAD_INVALID", `${id} 声明 verified 但没有核验日期`);
    }
    if (!Array.isArray(standard.change_history) || standard.change_history.length === 0 ||
        standard.change_history.length > 128) {
      fail("STANDARD_PAYLOAD_INVALID", `${id}.change_history 数量非法`);
    }
    let previousChangeDate = null;
    for (const [changeIndex, change] of standard.change_history.entries()) {
      exactKeys(change, ["changed_at", "change_type", "summary"],
        `${id}.change_history[${changeIndex}]`);
      const changedAt = validateDate(
        change.changed_at,
        `${id}.change_history[${changeIndex}].changed_at`,
        { notAfter: registryUpdatedAt },
      );
      if (previousChangeDate !== null && changedAt < previousChangeDate) {
        fail("STANDARD_PAYLOAD_INVALID", `${id}.change_history 必须按日期升序排列`);
      }
      previousChangeDate = changedAt;
      text(change.change_type, `${id}.change_history[${changeIndex}].change_type`, { max: 128 });
      text(change.summary, `${id}.change_history[${changeIndex}].summary`, { max: 4096 });
    }
  }

  for (const standard of byId.values()) {
    for (const related of [...standard.supersedes, standard.superseded_by].filter(Boolean)) {
      if (!byId.has(related) || related === standard.standard_id) {
        fail("STANDARD_PAYLOAD_INVALID", `${standard.standard_id} 的替代关系引用非法`);
      }
    }
  }
  const expectedByStandard = new Map([...byId.keys()].map((id) => [id, new Set()]));
  for (const [ruleId, refs] of rules.standardsByRule.entries()) {
    for (const standardId of refs) {
      if (!expectedByStandard.has(standardId)) {
        fail("STANDARD_PAYLOAD_INVALID", `规则 ${ruleId} 引用了未知标准 ${standardId}`);
      }
      expectedByStandard.get(standardId).add(ruleId);
    }
  }
  for (const [standardId, declared] of declaredRules.entries()) {
    const expected = expectedByStandard.get(standardId);
    if (declared.size !== expected.size || [...declared].some((id) => !expected.has(id))) {
      fail("STANDARD_PAYLOAD_INVALID", `${standardId}.rule_ids 与规则反向引用不一致`);
    }
  }
  validateMapping(
    rulepack.citation_default_mapping,
    new Set(byId.keys()),
    rules.definitionsById,
  );
  return byId;
}

function createStandardsPayloadValidator({ capabilityBytes }) {
  const capabilities = validateCapabilities(capabilityBytes);
  return async function validatePayload({
    manifest,
    standardsBytes,
    rulepackBytes,
    capabilitySetSha256,
  }) {
    if (!isObject(manifest) || capabilitySetSha256 !== capabilities.sha256 ||
        manifest.rulepack?.capability_set_sha256 !== capabilities.sha256) {
      fail("STANDARD_CAPABILITY_MISMATCH", "manifest capability_set_sha256 与本 APP 不一致");
    }
    const releaseDate = manifestReleaseDate(manifest);
    const rulepack = strictJson(rulepackBytes, "rulepack.json", {
      maxBytes: MAX_PAYLOAD_BYTES,
    });
    const standards = strictJson(standardsBytes, "standards.json", {
      maxBytes: MAX_PAYLOAD_BYTES,
    });
    const rules = validateRulepack(rulepack, manifest, capabilities, releaseDate);
    const standardIndex = validateStandards(
      standards,
      manifest,
      rulepack,
      rules,
      releaseDate,
    );
    return {
      ok: true,
      pack_name: rulepack.pack_name,
      pack_version: rulepack.pack_version,
      rule_count: rules.ids.size,
      standard_count: standardIndex.size,
    };
  };
}

module.exports = {
  StandardsPayloadError,
  createStandardsPayloadValidator,
  strictJson,
  validateCapabilities,
};
