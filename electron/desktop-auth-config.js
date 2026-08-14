"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { strictJson } = require("./standards-payload");

const CONFIG_FILE = "desktop-auth.json";
const APPLICATION_ID = "oak-manuscript-desktop";
const EXACT_KEYS = Object.freeze([
  "schema_version", "config_type", "status", "application_id", "account_center_origin",
  "issuer", "trusted_keys", "sync_api_origin",
]);

function exactKeys(value, expected = EXACT_KEYS) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function canonicalHttpsUrl(value, label, { originOnly = false } = {}) {
  if (typeof value !== "string" || value.length < 9 || value.length > 2048) {
    throw new Error(`桌面账号配置错误：${label} 必须是 HTTPS URL`);
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`桌面账号配置错误：${label} 非法`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search ||
      (originOnly && (parsed.origin !== value || parsed.pathname !== "/")) ||
      (!originOnly && parsed.toString() !== value)) {
    throw new Error(`桌面账号配置错误：${label} 必须是规范 HTTPS ${originOnly ? "origin" : "URL"}`);
  }
  return value;
}

function validateTrustedKey(value) {
  if (!exactKeys(value, ["key_id", "algorithm", "public_key_jwk"]) ||
      typeof value.key_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value.key_id) ||
      value.algorithm !== "Ed25519" || !exactKeys(value.public_key_jwk, ["crv", "kty", "x"]) ||
      value.public_key_jwk.crv !== "Ed25519" || value.public_key_jwk.kty !== "OKP" ||
      typeof value.public_key_jwk.x !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value.public_key_jwk.x)) {
    throw new Error("桌面账号配置错误：受信 Ed25519 公钥非法");
  }
  return Object.freeze({ ...value, public_key_jwk: Object.freeze({ ...value.public_key_jwk }) });
}

function validateDesktopAuthConfig(value) {
  if (!exactKeys(value) || value.schema_version !== "2.0" ||
      value.config_type !== "oak_manuscript_desktop_application_login" ||
      !["pending_configuration", "configured"].includes(value.status) ||
      value.application_id !== APPLICATION_ID || !Array.isArray(value.trusted_keys)) {
    throw new Error("桌面账号配置错误：结构或固定字段非法");
  }
  if (value.status === "pending_configuration") {
    if (value.account_center_origin !== null || value.issuer !== null ||
        value.sync_api_origin !== null || value.trusted_keys.length !== 0) {
      throw new Error("桌面账号配置错误：待配置状态不得携带端点或密钥");
    }
    return Object.freeze({ ...value, trusted_keys: Object.freeze([]) });
  }
  canonicalHttpsUrl(value.account_center_origin, "account_center_origin", { originOnly: true });
  canonicalHttpsUrl(value.issuer, "issuer");
  canonicalHttpsUrl(value.sync_api_origin, "sync_api_origin", { originOnly: true });
  if (value.trusted_keys.length < 1 || value.trusted_keys.length > 8) throw new Error("桌面账号配置错误：受信公钥数量非法");
  const trustedKeys = value.trusted_keys.map(validateTrustedKey);
  if (new Set(trustedKeys.map((item) => item.key_id)).size !== trustedKeys.length) throw new Error("桌面账号配置错误：受信公钥重复");
  return Object.freeze({ ...value, trusted_keys: Object.freeze(trustedKeys) });
}

function loadDesktopAuthConfig(configDir, fsImpl = fs) {
  if (typeof configDir !== "string" || !path.isAbsolute(configDir)) {
    throw new TypeError("configDir 必须是绝对路径");
  }
  const target = path.join(configDir, CONFIG_FILE);
  const stat = fsImpl.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 2 || stat.size > 64 * 1024) {
    throw new Error("桌面账号配置错误：配置文件不是安全的有界单链接文件");
  }
  return validateDesktopAuthConfig(strictJson(fsImpl.readFileSync(target), "桌面账号配置", { maxBytes: 64 * 1024 }));
}

module.exports = { APPLICATION_ID, CONFIG_FILE, loadDesktopAuthConfig, validateDesktopAuthConfig };
