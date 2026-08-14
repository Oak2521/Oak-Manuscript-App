"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const CONTRACT_ROOT = path.join(REPO_ROOT, "config", "contracts", "oak-account", "1.0");
const SHA256 = /^[a-f0-9]{64}$/u;

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) {
    throw new Error(`${label} 字段集合非法`);
  }
  return value;
}

function readJson(target, label) {
  const bytes = fs.readFileSync(target);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} 不是有效 UTF-8 JSON`); }
  return { bytes, value };
}

function verifyFrozenOakAccountContract({ contractRoot = CONTRACT_ROOT, verifyHashes = true } = {}) {
  const root = path.resolve(contractRoot);
  const provenance = readJson(path.join(root, "provenance.json"), "合同 provenance").value;
  exactKeys(provenance, ["schema_version", "contract", "source_repository", "source_commit", "source_status", "copied_at", "files"], "合同 provenance");
  if (provenance.schema_version !== "oak-manuscript-frozen-contract-provenance/1.0" ||
      provenance.contract !== "oak-desktop-application-login/1.0" ||
      provenance.source_commit !== "6aea9986539a0f55b2961426fa08e486a9e30b19" ||
      provenance.source_status !== "FROZEN_FOR_CONSUMER_IMPLEMENTATION" ||
      !Array.isArray(provenance.files) || provenance.files.length !== 16) {
    throw new Error("合同 provenance 版本、来源或文件数非法");
  }
  const seen = new Set();
  for (const entry of provenance.files) {
    exactKeys(entry, ["path", "bytes", "sha256"], "合同文件记录");
    if (typeof entry.path !== "string" || entry.path.includes("\\") || entry.path.startsWith("/") || entry.path.includes("..") ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 2 || !SHA256.test(entry.sha256) || seen.has(entry.path)) {
      throw new Error("合同文件记录非法");
    }
    seen.add(entry.path);
    const target = path.resolve(root, ...entry.path.split("/"));
    if (path.relative(root, target).startsWith("..")) throw new Error("合同文件路径逃逸");
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("合同文件不是安全单链接文件");
    const bytes = fs.readFileSync(target);
    if (verifyHashes && (bytes.length !== entry.bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== entry.sha256)) {
      throw new Error(`合同文件 SHA-256 或字节数不匹配：${entry.path}`);
    }
    JSON.parse(bytes.toString("utf8"));
  }
  const contractBytes = fs.readFileSync(path.join(root, "oak-desktop-application-login.v1.json"));
  const contract = JSON.parse(contractBytes.toString("utf8"));
  if (contract.schema_version !== "oak-desktop-application-login/1.0") {
    throw new Error("只支持冻结合同 major 1.0");
  }
  if (contract.status !== "FROZEN_FOR_CONSUMER_IMPLEMENTATION" ||
      contract.callback.host !== "127.0.0.1" || contract.callback.path_nonce_minimum_bits < 256 ||
      contract.callback.state_minimum_bits < 256 || contract.pkce.method !== "S256" ||
      contract.tokens.access.maximum_lifetime_seconds !== 300 || contract.tokens.access.storage !== "main_process_memory_only" ||
      contract.tokens.refresh.rotation !== "every_successful_refresh" ||
      contract.claims.business_authorization_in_claims !== false ||
      contract.secure_storage.access_token_persistence !== false) {
    throw new Error("冻结合同关键安全语义漂移");
  }
  const acceptance = readJson(path.join(root, "oak-desktop-application-login-consumer-acceptance.v1.json"), "消费者验收").value;
  const negatives = readJson(path.join(root, "examples", "desktop-login-negative-vectors.v1.json"), "负向向量").value;
  if (acceptance.required_contract_major !== 1 || !Array.isArray(acceptance.checklist) || acceptance.checklist.length !== 16 ||
      !Array.isArray(negatives.vectors) || negatives.vectors.length !== 20) {
    throw new Error("消费者验收或负向向量不完整");
  }
  const fixtureCount = provenance.files.filter((item) => /examples\/desktop-(?!login-negative).*\.valid\.json$/u.test(item.path)).length;
  if (fixtureCount !== 6) throw new Error("有效 fixture 数量非法");
  return {
    ok: true,
    schemaVersion: contract.schema_version,
    sourceCommit: provenance.source_commit,
    machineContractSha256: crypto.createHash("sha256").update(contractBytes).digest("hex"),
    verifiedFiles: provenance.files.length,
    validFixtures: fixtureCount,
    negativeVectors: negatives.vectors.length,
    consumerChecklistItems: acceptance.checklist.length,
  };
}

if (require.main === module) {
  try { console.log(JSON.stringify(verifyFrozenOakAccountContract())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { CONTRACT_ROOT, verifyFrozenOakAccountContract };
