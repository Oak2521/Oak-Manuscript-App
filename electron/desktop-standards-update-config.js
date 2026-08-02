"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { strictJson } = require("./standards-payload");

const CONFIG_FILE = "desktop-standards-update.json";
const EXACT_KEYS = Object.freeze([
  "schema_version", "config_type", "status", "update_endpoint", "revocation_endpoint",
]);
const UPDATE_PATH = "/manuscript/standards/v1/check";
const REVOCATION_PATH = "/manuscript/standards/v1/revocations";

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function canonicalHttpsUrl(value, name, expectedPath) {
  if (typeof value !== "string" || value.length < 9 || value.length > 2048) {
    throw new Error(`桌面标准更新配置错误：${name} 必须是 HTTPS URL`);
  }
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error(`桌面标准更新配置错误：${name} 非法`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash ||
      parsed.search || parsed.toString() !== value) {
    throw new Error(`桌面标准更新配置错误：${name} 必须是规范 HTTPS URL`);
  }
  if (parsed.pathname !== expectedPath) {
    throw new Error(`桌面标准更新配置错误：${name} 必须使用固定路径`);
  }
  return parsed;
}

function validateDesktopStandardsUpdateConfig(value) {
  if (!exactKeys(value, EXACT_KEYS) || value.schema_version !== "1.1" ||
      value.config_type !== "oak_manuscript_standards_update" ||
      !["pending_configuration", "configured"].includes(value.status)) {
    throw new Error("桌面标准更新配置错误：结构或固定字段非法");
  }
  if (value.status === "pending_configuration") {
    if (value.update_endpoint !== null || value.revocation_endpoint !== null) {
      throw new Error("桌面标准更新配置错误：待配置状态不得携带半成品端点");
    }
    return Object.freeze({ ...value });
  }
  const update = canonicalHttpsUrl(value.update_endpoint, "update_endpoint", UPDATE_PATH);
  const revocation = canonicalHttpsUrl(
    value.revocation_endpoint,
    "revocation_endpoint",
    REVOCATION_PATH,
  );
  if (update.origin !== revocation.origin) {
    throw new Error("桌面标准更新配置错误：update/revocation 端点必须同源");
  }
  return Object.freeze({ ...value });
}

function loadDesktopStandardsUpdateConfig(configDir, fsImpl = fs) {
  if (typeof configDir !== "string" || !path.isAbsolute(configDir)) {
    throw new TypeError("configDir 必须是绝对路径");
  }
  const target = path.join(configDir, CONFIG_FILE);
  const stat = fsImpl.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      stat.size < 2 || stat.size > 64 * 1024) {
    throw new Error("桌面标准更新配置错误：配置文件不是安全的有界单链接文件");
  }
  return validateDesktopStandardsUpdateConfig(
    strictJson(fsImpl.readFileSync(target), "桌面标准更新配置", { maxBytes: 64 * 1024 }),
  );
}

module.exports = {
  CONFIG_FILE,
  loadDesktopStandardsUpdateConfig,
  validateDesktopStandardsUpdateConfig,
};
