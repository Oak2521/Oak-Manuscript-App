"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { strictJson } = require("./standards-payload");

const CONFIG_FILE = "desktop-license.json";
const AUDIENCE = "oak-manuscript-desktop";
const EXACT_KEYS = Object.freeze([
  "schema_version", "config_type", "status", "entitlement_endpoint", "issuer",
  "audience", "trusted_keys",
]);

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function canonicalHttpsUrl(value, label, { originOnly = false } = {}) {
  if (typeof value !== "string" || value.length < 9 || value.length > 2048) {
    throw new Error(`桌面权益配置错误：${label} 必须是 HTTPS URL`);
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`桌面权益配置错误：${label} 非法`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search ||
      (originOnly && (parsed.origin + "/" !== value || parsed.pathname !== "/")) ||
      (!originOnly && parsed.toString() !== value)) {
    throw new Error(`桌面权益配置错误：${label} 必须是规范 HTTPS ${originOnly ? "issuer origin" : "URL"}`);
  }
  return value;
}

function validateKey(item) {
  if (!exactKeys(item, ["key_id", "algorithm", "public_key_jwk"]) ||
      typeof item.key_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u.test(item.key_id) ||
      item.algorithm !== "Ed25519" ||
      !exactKeys(item.public_key_jwk, ["kty", "crv", "x"]) ||
      item.public_key_jwk.kty !== "OKP" || item.public_key_jwk.crv !== "Ed25519" ||
      typeof item.public_key_jwk.x !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(item.public_key_jwk.x)) {
    throw new Error("桌面权益配置错误：Ed25519 公钥非法");
  }
  let bytes;
  try { bytes = Buffer.from(item.public_key_jwk.x, "base64url"); } catch { bytes = null; }
  if (!bytes || bytes.length !== 32 || bytes.toString("base64url") !== item.public_key_jwk.x) {
    throw new Error("桌面权益配置错误：Ed25519 公钥非法");
  }
  return Object.freeze({
    key_id: item.key_id,
    algorithm: item.algorithm,
    public_key_jwk: Object.freeze({ ...item.public_key_jwk }),
  });
}

function validateDesktopLicenseConfig(value) {
  if (!exactKeys(value, EXACT_KEYS) || value.schema_version !== "1.0" ||
      value.config_type !== "oak_manuscript_desktop_license" ||
      !["pending_configuration", "configured"].includes(value.status) ||
      value.audience !== AUDIENCE || !Array.isArray(value.trusted_keys) || value.trusted_keys.length > 4) {
    throw new Error("桌面权益配置错误：结构或固定字段非法");
  }
  if (value.status === "pending_configuration") {
    if (value.entitlement_endpoint !== null || value.issuer !== null || value.trusted_keys.length !== 0) {
      throw new Error("桌面权益配置错误：待配置状态不得携带半成品端点或公钥");
    }
    return Object.freeze({ ...value, trusted_keys: Object.freeze([]) });
  }
  canonicalHttpsUrl(value.entitlement_endpoint, "entitlement_endpoint");
  canonicalHttpsUrl(value.issuer, "issuer", { originOnly: true });
  if (value.trusted_keys.length < 1) throw new Error("桌面权益配置错误：至少需要一个受信公钥");
  const trustedKeys = value.trusted_keys.map(validateKey);
  if (new Set(trustedKeys.map((item) => item.key_id)).size !== trustedKeys.length) {
    throw new Error("桌面权益配置错误：key_id 重复");
  }
  return Object.freeze({ ...value, trusted_keys: Object.freeze(trustedKeys) });
}

function loadDesktopLicenseConfig(configDir, fsImpl = fs) {
  if (typeof configDir !== "string" || !path.isAbsolute(configDir)) throw new TypeError("configDir 必须是绝对路径");
  const target = path.join(configDir, CONFIG_FILE);
  const stat = fsImpl.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 2 || stat.size > 64 * 1024) {
    throw new Error("桌面权益配置错误：配置文件不是安全的有界单链接文件");
  }
  return validateDesktopLicenseConfig(strictJson(fsImpl.readFileSync(target), "桌面权益配置", { maxBytes: 64 * 1024 }));
}

module.exports = { AUDIENCE, CONFIG_FILE, loadDesktopLicenseConfig, validateDesktopLicenseConfig };
