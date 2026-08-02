"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { strictJson } = require("./standards-payload");

const CONFIG_FILE = "desktop-auth.json";
const REDIRECT_URI = "oak-manuscript-auth://callback";
const EXACT_KEYS = Object.freeze([
  "schema_version", "config_type", "status", "authorization_endpoint", "token_endpoint",
  "user_endpoint", "client_id", "public_api_key", "api_origin", "redirect_uri", "scopes",
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

function validateDesktopAuthConfig(value) {
  if (!exactKeys(value) || value.schema_version !== "1.0" ||
      value.config_type !== "oak_manuscript_desktop_auth" ||
      !["pending_configuration", "configured"].includes(value.status) ||
      value.redirect_uri !== REDIRECT_URI || !Array.isArray(value.scopes) ||
      value.scopes.length < 1 || value.scopes.length > 8 ||
      new Set(value.scopes).size !== value.scopes.length ||
      value.scopes.some((scope) => typeof scope !== "string" || !/^[a-z][a-z0-9:_-]{0,31}$/u.test(scope))) {
    throw new Error("桌面账号配置错误：结构或固定字段非法");
  }
  const endpoints = ["authorization_endpoint", "token_endpoint", "user_endpoint"];
  if (value.status === "pending_configuration") {
    for (const key of [...endpoints, "client_id", "public_api_key", "api_origin"]) {
      if (value[key] !== null) throw new Error("桌面账号配置错误：待配置状态不得携带半成品端点或凭据");
    }
    return Object.freeze({ ...value, scopes: Object.freeze([...value.scopes]) });
  }
  for (const key of endpoints) canonicalHttpsUrl(value[key], key);
  canonicalHttpsUrl(value.api_origin, "api_origin", { originOnly: true });
  if (typeof value.client_id !== "string" || !/^[A-Za-z0-9._-]{8,128}$/u.test(value.client_id) ||
      typeof value.public_api_key !== "string" || value.public_api_key.length < 16 ||
      value.public_api_key.length > 4096 || /[\r\n\0]/u.test(value.public_api_key)) {
    throw new Error("桌面账号配置错误：client_id 或 public_api_key 非法");
  }
  return Object.freeze({ ...value, scopes: Object.freeze([...value.scopes]) });
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

module.exports = { CONFIG_FILE, REDIRECT_URI, loadDesktopAuthConfig, validateDesktopAuthConfig };
