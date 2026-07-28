"use strict";

// Build-time integrity contract for the bundled standards registry and rule pack.
// Imported updates use a signed .oakstd envelope; this file only creates/verifies
// the immutable bootstrap manifest shipped inside the application.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const CAPABILITIES_RELATIVE = "config/rule-capabilities.json";
const STANDARDS_RELATIVE = "config/standards.json";
const RULEPACK_RELATIVE = "config/rule-packs/oak-rules-2.0.0.json";
const MANIFEST_RELATIVE = "config/standard-packs/oak-standards-2.0.0.manifest.json";
const BUNDLE_ID = "oak-standards";
const RELEASE_SEQUENCE = 2;
const RELEASE_VERSION = "2.0.0";
const PREVIOUS_MANIFEST_SHA256 = "d33534f081b2122a90652ee03304a0e71177a7fd0d3130fffe77b0fea807d7af";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Canonical JSON only accepts safe integers");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value).sort(compareAscii);
    for (const key of keys) {
      if (!/^[A-Za-z0-9_]+$/.test(key)) throw new Error(`Canonical JSON key is not ASCII-safe: ${key}`);
      if (value[key] === undefined) throw new Error(`Canonical JSON value is undefined: ${key}`);
    }
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error(`Unsupported canonical JSON value: ${typeof value}`);
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function resolveProjectFile(root, relative, label) {
  const projectRoot = path.resolve(root);
  if (typeof relative !== "string" || relative === "" || relative.includes("\\") ||
      path.posix.isAbsolute(relative) || path.posix.normalize(relative) !== relative ||
      relative === "." || relative.startsWith("../")) {
    throw new Error(`${label} is not a safe relative POSIX path`);
  }
  const target = path.resolve(projectRoot, ...relative.split("/"));
  const rel = path.relative(projectRoot, target);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`${label} escapes the repository root`);
  }
  return target;
}

function readPlainFile(root, relative, label) {
  const target = resolveProjectFile(root, relative, label);
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.nlink > 1) {
    throw new Error(`${label} is missing, empty, linked, or not a plain file: ${target}`);
  }
  const bytes = fs.readFileSync(target);
  return { target, bytes, stat };
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON: ${error.message}`);
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort(compareAscii);
  const expected = [...keys].sort(compareAscii);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} keys differ: ${actual.join(", ")}`);
  }
}

function requireString(value, label, { empty = false } = {}) {
  if (typeof value !== "string" || (!empty && value.trim() === "") || value.includes("\0")) {
    throw new Error(`${label} must be ${empty ? "a" : "a non-empty"} NUL-free string`);
  }
  return value;
}

function validateCapabilities(capabilityFile, rulepack) {
  const capabilities = parseJson(capabilityFile.bytes, "Rule capability set");
  if (!capabilityFile.bytes.equals(canonicalBytes(capabilities))) {
    throw new Error("Rule capability set must be canonical compact JSON, ASCII-key sorted, UTF-8 plus LF");
  }
  exactKeys(capabilities, ["schema_version", "pack_name", "capabilities"], "Rule capability set");
  if (capabilities.schema_version !== "1.0" || capabilities.pack_name !== rulepack.pack_name ||
      !Array.isArray(capabilities.capabilities) || capabilities.capabilities.length === 0) {
    throw new Error("Rule capability set schema, pack name, or entries are invalid");
  }

  const rules = new Map(rulepack.rules.map((rule) => [rule.rule_id, rule]));
  let previous = null;
  for (const [index, item] of capabilities.capabilities.entries()) {
    exactKeys(item, ["rule_id", "milestone", "auto_fixable", "fix_id"], `capabilities[${index}]`);
    const id = requireString(item.rule_id, `capabilities[${index}].rule_id`);
    if (previous !== null && compareAscii(previous, id) >= 0) {
      throw new Error("Rule capabilities must be unique and ASCII rule_id sorted");
    }
    previous = id;
    const rule = rules.get(id);
    if (!rule || item.milestone !== rule.milestone || item.auto_fixable !== rule.auto_fixable ||
        item.fix_id !== rule.fix_id) {
      throw new Error(`Rule capability does not exactly match implemented rule metadata: ${id}`);
    }
  }
  if (capabilities.capabilities.length !== rules.size) {
    throw new Error("Bundled capability set must enumerate every bundled rule exactly once");
  }
  return capabilities;
}

function validateRulepack(rulepack) {
  exactKeys(rulepack, [
    "pack_name", "pack_version", "frozen_at", "description", "citation_default_mapping", "rules",
  ], "Bundled rule pack");
  if (rulepack.pack_name !== "oak-rules" || rulepack.pack_version !== RELEASE_VERSION ||
      !SEMVER_PATTERN.test(rulepack.pack_version) || !Array.isArray(rulepack.rules) ||
      rulepack.rules.length === 0) {
    throw new Error("Bundled rule pack identity or rules are invalid");
  }
  const ids = new Set();
  for (const [index, rule] of rulepack.rules.entries()) {
    const id = requireString(rule?.rule_id, `rules[${index}].rule_id`);
    if (ids.has(id)) throw new Error(`Duplicate rule_id: ${id}`);
    ids.add(id);
    if (!["M1", "M2", "M3"].includes(rule.milestone) || typeof rule.auto_fixable !== "boolean" ||
        !(rule.fix_id === null || typeof rule.fix_id === "string") ||
        !Array.isArray(rule.standard_refs) || rule.standard_refs.length === 0) {
      throw new Error(`Rule metadata is incomplete: ${id}`);
    }
  }
  const mapping = rulepack.citation_default_mapping;
  exactKeys(mapping, ["version", "standard_ref", "map", "resolver"],
    "Bundled citation resolver mapping");
  if (mapping.version !== RELEASE_VERSION || !Array.isArray(mapping.map) ||
      mapping.map.length === 0) {
    throw new Error("Bundled citation mapping version or entries are invalid");
  }
  exactKeys(mapping.resolver, [
    "id", "version", "signal_extractor_version", "thresholds", "style_capability_rules",
  ], "Bundled citation resolver");
  if (mapping.resolver.id !== "oak-citation-structure-resolver" ||
      !SEMVER_PATTERN.test(mapping.resolver.version) ||
      !SEMVER_PATTERN.test(mapping.resolver.signal_extractor_version)) {
    throw new Error("Bundled citation resolver identity is invalid");
  }
  exactKeys(mapping.resolver.thresholds, [
    "strong_min_unique", "moderate_min_unique",
    "strong_min_coverage_percent", "moderate_min_coverage_percent",
  ], "Bundled citation resolver thresholds");
  const thresholds = mapping.resolver.thresholds;
  if (!(Number.isSafeInteger(thresholds.moderate_min_unique) &&
        Number.isSafeInteger(thresholds.strong_min_unique) &&
        Number.isSafeInteger(thresholds.moderate_min_coverage_percent) &&
        Number.isSafeInteger(thresholds.strong_min_coverage_percent) &&
        thresholds.moderate_min_unique >= 1 &&
        thresholds.moderate_min_unique <= thresholds.strong_min_unique &&
        thresholds.strong_min_unique <= 1000 &&
        thresholds.moderate_min_coverage_percent >= 1 &&
        thresholds.moderate_min_coverage_percent <= thresholds.strong_min_coverage_percent &&
        thresholds.strong_min_coverage_percent <= 100)) {
    throw new Error("Bundled citation resolver thresholds are invalid");
  }
  const styleRules = mapping.resolver.style_capability_rules;
  const styles = ["gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad"];
  exactKeys(styleRules, styles, "Bundled citation resolver capabilities");
  const byId = new Map(rulepack.rules.map((rule) => [rule.rule_id, rule]));
  for (const style of styles) {
    if (!Array.isArray(styleRules[style]) || styleRules[style].length === 0 ||
        new Set(styleRules[style]).size !== styleRules[style].length ||
        styleRules[style].some((id) => !byId.has(id) ||
          !byId.get(id).applies_to.citation_styles.includes(style))) {
      throw new Error(`Bundled citation resolver capability is invalid: ${style}`);
    }
  }
  return ids;
}

function validateStandards(standards, rulepack, ruleIds) {
  exactKeys(standards, ["schema_version", "registry_version", "updated_at", "standards"], "Standards registry");
  if (standards.schema_version !== "2.0" || standards.registry_version !== RELEASE_VERSION ||
      !Array.isArray(standards.standards) || standards.standards.length === 0) {
    throw new Error("Standards registry schema, version, or entries are invalid");
  }

  const expected = new Map();
  const allowedStatuses = new Set(["active", "superseded", "under_review", "deprecated"]);
  const allowedCopyright = new Set(["metadata_only", "short_excerpt", "open_license"]);
  const allowedVerification = new Set(["verified", "pending", "unavailable"]);
  const allowedSourceTypes = new Set(["official", "technical_spec", "oak_interpretation"]);
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  for (const [index, standard] of standards.standards.entries()) {
    const id = requireString(standard?.standard_id, `standards[${index}].standard_id`);
    if (expected.has(id)) throw new Error(`Duplicate standard_id: ${id}`);
    expected.set(id, []);
    for (const key of [
      "title", "source_type", "official_source_url", "oak_resource_slug", "version", "updated_at",
      "scope", "summary", "status", "publisher", "copyright_use", "source_verification_status",
    ]) requireString(standard[key], `${id}.${key}`, { empty: key === "official_source_url" });
    if (!allowedStatuses.has(standard.status) ||
        !allowedCopyright.has(standard.copyright_use) ||
        !allowedVerification.has(standard.source_verification_status) ||
        !allowedSourceTypes.has(standard.source_type) ||
        !datePattern.test(standard.updated_at) || /(?:placeholder|待补充|占位|TODO)/iu.test(standard.summary)) {
      throw new Error(`Standards governance values are invalid or contain placeholders: ${id}`);
    }
    if (standard.official_source_url !== "") {
      let sourceUrl;
      try {
        sourceUrl = new URL(standard.official_source_url);
      } catch {
        throw new Error(`Standard official_source_url is invalid: ${id}`);
      }
      if (sourceUrl.protocol !== "https:" || sourceUrl.username !== "" || sourceUrl.password !== "") {
        throw new Error(`Standard official_source_url must be credential-free HTTPS: ${id}`);
      }
    } else if (standard.source_type !== "oak_interpretation" &&
               (standard.status !== "under_review" ||
                standard.source_verification_status !== "unavailable")) {
      throw new Error(`Empty official_source_url is only allowed for explicitly unavailable review: ${id}`);
    }
    if (!Array.isArray(standard.reviewed_by) || standard.reviewed_by.length === 0 ||
        standard.reviewed_by.some((value) => typeof value !== "string" || value.trim() === "") ||
        !Array.isArray(standard.supersedes) ||
        !(standard.superseded_by === null || typeof standard.superseded_by === "string") ||
        !Array.isArray(standard.rule_ids) || !Array.isArray(standard.change_history) ||
        standard.change_history.length === 0 ||
        !(standard.source_verified_at === null || typeof standard.source_verified_at === "string")) {
      throw new Error(`Standards governance metadata is incomplete: ${id}`);
    }
    if (new Set(standard.supersedes).size !== standard.supersedes.length ||
        new Set(standard.rule_ids).size !== standard.rule_ids.length ||
        (standard.source_verified_at !== null && !datePattern.test(standard.source_verified_at))) {
      throw new Error(`Standards governance lists or verification date are invalid: ${id}`);
    }
    for (const [changeIndex, change] of standard.change_history.entries()) {
      exactKeys(change, ["changed_at", "change_type", "summary"],
        `${id}.change_history[${changeIndex}]`);
      if (!datePattern.test(change.changed_at) ||
          typeof change.change_type !== "string" || change.change_type.trim() === "" ||
          typeof change.summary !== "string" || change.summary.trim() === "") {
        throw new Error(`Standard change history is invalid: ${id}`);
      }
    }
  }

  for (const rule of rulepack.rules) {
    for (const standardId of rule.standard_refs) {
      if (!expected.has(standardId)) throw new Error(`Unknown standard ${standardId} referenced by ${rule.rule_id}`);
      expected.get(standardId).push(rule.rule_id);
    }
  }
  for (const standard of standards.standards) {
    const declared = [...standard.rule_ids].sort(compareAscii);
    const actual = expected.get(standard.standard_id).sort(compareAscii);
    if (declared.some((id) => !ruleIds.has(id)) || JSON.stringify(declared) !== JSON.stringify(actual)) {
      throw new Error(`standard.rule_ids does not match reverse rule references: ${standard.standard_id}`);
    }
  }
  return standards;
}

function fileRecord(logicalPath, file) {
  return {
    media_type: "application/json",
    path: logicalPath,
    sha256: sha256(file.bytes),
    size_bytes: file.bytes.length,
  };
}

function loadAndValidateAssets(root = REPO_ROOT) {
  const projectRoot = path.resolve(root);
  const standardsFile = readPlainFile(projectRoot, STANDARDS_RELATIVE, "Standards registry");
  const rulepackFile = readPlainFile(projectRoot, RULEPACK_RELATIVE, "Bundled rule pack");
  const capabilityFile = readPlainFile(projectRoot, CAPABILITIES_RELATIVE, "Rule capability set");
  const rulepack = parseJson(rulepackFile.bytes, "Bundled rule pack");
  const ruleIds = validateRulepack(rulepack);
  const standards = validateStandards(
    parseJson(standardsFile.bytes, "Standards registry"), rulepack, ruleIds,
  );
  const capabilities = validateCapabilities(capabilityFile, rulepack);
  return { projectRoot, standardsFile, rulepackFile, capabilityFile, standards, rulepack, capabilities };
}

function buildManifest(root = REPO_ROOT) {
  const assets = loadAndValidateAssets(root);
  const capabilitySetSha256 = sha256(assets.capabilityFile.bytes);
  const rulepackSha256 = sha256(assets.rulepackFile.bytes);
  return {
    schema_version: "1.0",
    kind: "oak-standard-release",
    bundle_id: BUNDLE_ID,
    release_sequence: RELEASE_SEQUENCE,
    version: RELEASE_VERSION,
    channel: "stable",
    released_at: "2026-07-27T00:00:00Z",
    expires_at: null,
    min_app: "0.1.0-alpha.5",
    max_app_exclusive: "0.2.0",
    signing_role: "bundled",
    files: [
      fileRecord("standards.json", assets.standardsFile),
      fileRecord("rulepack.json", assets.rulepackFile),
    ],
    rulepack: {
      name: assets.rulepack.pack_name,
      version: assets.rulepack.pack_version,
      sha256: rulepackSha256,
      capability_set_sha256: capabilitySetSha256,
    },
    rollback_target: {
      manifest_sha256: PREVIOUS_MANIFEST_SHA256,
      release_sequence: 1,
    },
    change_summary: [
      "新增版本化的默认引用体例结构信号解析器。",
      "低置信度时仅运行明确声明的结构与一致性检查，不再强行套用具体体例。",
      "项目与报告记录最终体例、理由、置信度和解析器版本。",
    ],
  };
}

function normalizeTrustedJsonFiles(root = REPO_ROOT) {
  const projectRoot = path.resolve(root);
  for (const [relative, label] of [
    [STANDARDS_RELATIVE, "Standards registry"],
    [RULEPACK_RELATIVE, "Bundled rule pack"],
  ]) {
    const file = readPlainFile(projectRoot, relative, label);
    const text = file.bytes.toString("utf8");
    if (text.startsWith("\uFEFF") || text.includes("\0")) {
      throw new Error(`${label} must not contain a BOM or NUL`);
    }
    const normalized = Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
    if (!file.bytes.equals(normalized)) fs.writeFileSync(file.target, normalized);
  }
}

function verifyStandardAssets(root = REPO_ROOT) {
  const projectRoot = path.resolve(root);
  const expected = buildManifest(projectRoot);
  const manifestFile = readPlainFile(projectRoot, MANIFEST_RELATIVE, "Bundled standards manifest");
  const actual = parseJson(manifestFile.bytes, "Bundled standards manifest");
  const expectedBytes = canonicalBytes(expected);
  if (!manifestFile.bytes.equals(expectedBytes) || canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error("Bundled standards manifest is stale, non-canonical, or does not match current assets");
  }
  const digest = sha256(manifestFile.bytes);
  if (!SHA256_PATTERN.test(digest)) throw new Error("Manifest SHA-256 is invalid");
  return { manifest: actual, manifestTarget: manifestFile.target, manifestSha256: digest };
}

function writeStandardManifest(root = REPO_ROOT) {
  const projectRoot = path.resolve(root);
  normalizeTrustedJsonFiles(projectRoot);
  const target = resolveProjectFile(projectRoot, MANIFEST_RELATIVE, "Bundled standards manifest");
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error(`Bundled standards manifest directory is unsafe: ${parent}`);
  }
  const manifest = buildManifest(projectRoot);
  const bytes = canonicalBytes(manifest);
  fs.writeFileSync(target, bytes, { encoding: null, flag: "w" });
  return { manifest, manifestTarget: target, manifestSha256: sha256(bytes) };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--write") || args.filter((arg) => arg === "--write").length > 1) {
      throw new Error(`Unknown arguments: ${args.join(" ")}`);
    }
    const result = args.includes("--write") ? writeStandardManifest() : verifyStandardAssets();
    process.stdout.write(`${JSON.stringify({
      ok: true,
      bundle_id: result.manifest.bundle_id,
      release_sequence: result.manifest.release_sequence,
      version: result.manifest.version,
      manifest_sha256: result.manifestSha256,
      manifest: path.relative(REPO_ROOT, result.manifestTarget).split(path.sep).join("/"),
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  BUNDLE_ID,
  CAPABILITIES_RELATIVE,
  MANIFEST_RELATIVE,
  PREVIOUS_MANIFEST_SHA256,
  RELEASE_SEQUENCE,
  RELEASE_VERSION,
  RULEPACK_RELATIVE,
  STANDARDS_RELATIVE,
  buildManifest,
  canonicalBytes,
  canonicalJson,
  loadAndValidateAssets,
  normalizeTrustedJsonFiles,
  sha256,
  verifyStandardAssets,
  writeStandardManifest,
};
