"use strict";

const crypto = require("crypto");
const path = require("path");
const { parseJsonStrict } = require("./strict_json");
const { readSafeRegularFile } = require("./safe_tracked_file");

const REPO_ROOT = path.resolve(__dirname, "..");
const IDENTITY_RELATIVE = "config/release-identity.json";
const SCHEMA_RELATIVE = "config/schemas/release-identity-v1.schema.json";
const SCHEMA_SHA256 = "adbe8151e239d102e71830e7272ff7af77425e6eaf481a0d6c22ef3aeb9e4054";
const EXPECTED_KEYS = Object.freeze([
  "schema_version",
  "identity_id",
  "product_name",
  "app_id",
  "publisher_brand",
  "official_website",
  "legal_seller_name",
  "support_url",
  "privacy_policy_url",
  "terms_url",
  "copyright_notice",
  "signing",
  "human_review",
]);
const EXPECTED_SIGNING_KEYS = Object.freeze(["windows_certificate_subject", "apple_team_id"]);
const EXPECTED_REVIEW_KEYS = Object.freeze(["status", "reviewed_by", "reviewed_at"]);
const PLACEHOLDER_RE = /(?:\btbd\b|\btodo\b|\bpending\b|待定|未确定|示例|example\.com)/iu;

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} 字段或顺序必须精确为：${expected.join(", ")}`);
  }
}

function requireFixed(value, field, expected) {
  if (value[field] !== expected) throw new Error(`${field} 必须固定为 ${expected}`);
}

function validateNullableText(value, field) {
  const content = value[field];
  if (content === null) return;
  if (typeof content !== "string" || content.trim() !== content || content.length === 0) {
    throw new Error(`${field} 必须为 null 或非空、无首尾空白的字符串`);
  }
  if (PLACEHOLDER_RE.test(content)) throw new Error(`${field} 不得使用占位文本`);
}

function validateOfficialUrl(value, field) {
  validateNullableText(value, field);
  if (value[field] === null) return;
  let url;
  try {
    url = new URL(value[field]);
  } catch (error) {
    throw new Error(`${field} 不是有效 URL：${error.message}`);
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      !(hostname === "oakbylake.com" || hostname.endsWith(".oakbylake.com"))) {
    throw new Error(`${field} 必须是 oakbylake.com 域内、不含凭据或 fragment 的 HTTPS URL`);
  }
}

function readCanonicalJson(root, relative, label) {
  const target = path.join(root, ...relative.split("/"));
  const record = readSafeRegularFile(root, target, label);
  const text = record.bytes.toString("utf8");
  const value = parseJsonStrict(text, label);
  if (!record.bytes.equals(canonicalBytes(value))) throw new Error(`${label} 不是规范 JSON 字节`);
  return { value, bytes: record.bytes, target };
}

function readStrictJson(root, relative, label) {
  const target = path.join(root, ...relative.split("/"));
  const record = readSafeRegularFile(root, target, label);
  return {
    value: parseJsonStrict(record.bytes.toString("utf8"), label),
    bytes: record.bytes,
    target,
  };
}

function readSchema(identityRoot) {
  const schema = readCanonicalJson(identityRoot, SCHEMA_RELATIVE, "发行商身份 schema");
  if (crypto.createHash("sha256").update(schema.bytes).digest("hex") !== SCHEMA_SHA256) {
    throw new Error("发行商身份 schema 与 v1 固定摘要不一致");
  }
  const properties = schema.value?.properties;
  if (schema.value?.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
      schema.value?.$id !== "https://oakbylake.com/schemas/oak-manuscript/release-identity-v1.schema.json" ||
      schema.value?.type !== "object" || schema.value?.additionalProperties !== false ||
      JSON.stringify(schema.value?.required) !== JSON.stringify(EXPECTED_KEYS) ||
      !properties || Object.keys(properties).join("\u0000") !== EXPECTED_KEYS.join("\u0000") ||
      properties.schema_version?.const !== "1.0" ||
      properties.identity_id?.const !== "oak-manuscript-release-identity" ||
      properties.product_name?.const !== "湖岸稿件 Oak Manuscript" ||
      properties.app_id?.const !== "com.oakbylake.manuscript" ||
      properties.publisher_brand?.const !== "湖岸橡树" ||
      properties.official_website?.const !== "https://oakbylake.com/") {
    throw new Error("发行商身份 schema 与 v1 精确契约不一致");
  }
  return schema;
}

function packageAuthorName(author) {
  if (typeof author === "string") return author;
  if (author && typeof author === "object" && !Array.isArray(author)) return author.name;
  return null;
}

function verifyReleaseIdentity({
  identityRoot = REPO_ROOT,
  packageRoot = identityRoot,
  platform = process.platform,
} = {}) {
  if (platform !== "win32" && platform !== "darwin") {
    throw new Error(`不支持的发行身份平台：${String(platform)}`);
  }
  const resolvedIdentityRoot = path.resolve(identityRoot);
  const resolvedPackageRoot = path.resolve(packageRoot);
  readSchema(resolvedIdentityRoot);
  const identityRecord = readCanonicalJson(
    resolvedIdentityRoot,
    IDENTITY_RELATIVE,
    "发行商身份文件",
  );
  const identity = identityRecord.value;
  assertExactKeys(identity, EXPECTED_KEYS, "发行商身份文件");
  assertExactKeys(identity.signing, EXPECTED_SIGNING_KEYS, "signing");
  assertExactKeys(identity.human_review, EXPECTED_REVIEW_KEYS, "human_review");
  requireFixed(identity, "schema_version", "1.0");
  requireFixed(identity, "identity_id", "oak-manuscript-release-identity");
  requireFixed(identity, "product_name", "湖岸稿件 Oak Manuscript");
  requireFixed(identity, "app_id", "com.oakbylake.manuscript");
  requireFixed(identity, "publisher_brand", "湖岸橡树");
  requireFixed(identity, "official_website", "https://oakbylake.com/");
  for (const field of ["legal_seller_name", "copyright_notice"]) {
    validateNullableText(identity, field);
  }
  for (const field of ["support_url", "privacy_policy_url", "terms_url"]) {
    validateOfficialUrl(identity, field);
  }
  for (const field of EXPECTED_SIGNING_KEYS) validateNullableText(identity.signing, field);
  for (const field of ["reviewed_by", "reviewed_at"]) {
    validateNullableText(identity.human_review, field);
  }
  if (!new Set(["pending", "verified"]).has(identity.human_review.status)) {
    throw new Error("human_review.status 只能是 pending 或 verified");
  }
  if (identity.signing.apple_team_id !== null &&
      !/^[A-Z0-9]{10}$/u.test(identity.signing.apple_team_id)) {
    throw new Error("signing.apple_team_id 必须是 10 位大写字母或数字");
  }
  if (identity.human_review.reviewed_at !== null &&
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(identity.human_review.reviewed_at)) {
    throw new Error("human_review.reviewed_at 必须是 UTC 秒精度 RFC 3339 时间");
  }

  const packageRecord = readStrictJson(resolvedPackageRoot, "package.json", "package.json");
  const packageJson = packageRecord.value;
  if (packageJson.productName !== identity.product_name) throw new Error("package.json productName 与身份文件不一致");
  if (packageJson.build?.appId !== identity.app_id) throw new Error("package.json build.appId 与身份文件不一致");

  const missing = [];
  for (const field of [
    "legal_seller_name",
    "support_url",
    "privacy_policy_url",
    "terms_url",
    "copyright_notice",
  ]) {
    if (identity[field] === null) missing.push(field);
  }
  const platformSigningField = platform === "win32"
    ? "windows_certificate_subject"
    : "apple_team_id";
  if (identity.signing[platformSigningField] === null) missing.push(`signing.${platformSigningField}`);
  if (identity.human_review.status !== "verified") missing.push("human_review.status");
  if (identity.human_review.reviewed_by === null) missing.push("human_review.reviewed_by");
  if (identity.human_review.reviewed_at === null) missing.push("human_review.reviewed_at");
  const authorName = packageAuthorName(packageJson.author);
  if (identity.legal_seller_name === null || authorName !== identity.legal_seller_name) {
    missing.push("package.json.author");
  }
  if (packageJson.homepage !== identity.official_website) missing.push("package.json.homepage");
  if (identity.copyright_notice === null ||
      packageJson.build?.copyright !== identity.copyright_notice) {
    missing.push("package.json.build.copyright");
  }

  return {
    ok: true,
    complete: missing.length === 0,
    platform,
    identity_path: IDENTITY_RELATIVE,
    schema_path: SCHEMA_RELATIVE,
    product_name: identity.product_name,
    app_id: identity.app_id,
    publisher_brand: identity.publisher_brand,
    official_website: identity.official_website,
    human_review_status: identity.human_review.status,
    missing_fields: missing,
  };
}

function parseArgs(argv) {
  let platform = process.platform;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--platform" && index + 1 < argv.length) platform = argv[++index];
    else throw new Error(`未知或不完整参数：${argv[index]}`);
  }
  return { platform };
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(verifyReleaseIdentity(parseArgs(process.argv.slice(2))), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  IDENTITY_RELATIVE,
  SCHEMA_RELATIVE,
  parseArgs,
  verifyReleaseIdentity,
};
