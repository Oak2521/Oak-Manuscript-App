"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const { compareUtf16 } = require("./deterministic_compare");
const { inventory } = require("./epubcheck_distribution");
const { atomicReplaceTrackedFile, ensureSafeDirectoryChain, readSafeRegularFile } = require("./safe_tracked_file");
const { parseJsonStrict } = require("./strict_json");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILE = Object.freeze({
  name: "EpubCheck",
  version: "5.3.0",
  publisher: "DAISY Consortium for W3C",
  distribution: "tools/epubcheck-5.3.0",
  manifest: "config/tool-manifests/epubcheck-5.3.0.json",
  evidence: "config/provenance/epubcheck-5.3.0.json",
  releasePage: "https://github.com/w3c/epubcheck/releases/tag/v5.3.0",
  releaseApi: "https://api.github.com/repos/w3c/epubcheck/releases/tags/v5.3.0",
  releaseApiSha256: "be34c2978685077eb3fbb9bcaf6078f56521243074e828546878a1f076dd333f",
  tag: "v5.3.0",
  publishedAt: "2025-09-01T16:06:11Z",
  artifactUrl: "https://github.com/w3c/epubcheck/releases/download/v5.3.0/epubcheck-5.3.0.zip",
  artifactFilename: "epubcheck-5.3.0.zip",
  artifactSize: 33_071_108,
  artifactSha256: "6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5",
  fileCount: 49,
  totalBytes: 36_263_890,
  licenseFiles: Object.freeze([
    "LICENSE.txt", "THIRD-PARTY.txt", "licenses/Apache-2.0.txt", "licenses/BSD-3-Clause.txt",
    "licenses/MIT.txt", "licenses/MPL-2.0.txt", "licenses/W3C.txt",
  ]),
});
const HASH_RE = /^[0-9a-f]{64}$/u;

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  const actual = Object.keys(value).sort(compareUtf16);
  const wanted = [...expected].sort(compareUtf16);
  if (actual.length !== wanted.length || actual.some((item, index) => item !== wanted[index])) {
    throw new Error(`${label} 字段集合不严格匹配：${actual.join(", ")}`);
  }
}

function safeRelative(value, label) {
  if (typeof value !== "string" || value === "" || value.includes("\\") || path.posix.isAbsolute(value) ||
      path.posix.normalize(value) !== value || value === "." || value.startsWith("../")) {
    throw new Error(`${label} 不是安全 POSIX 相对路径`);
  }
  return value;
}

function resolveInside(root, relative, label) {
  const projectRoot = path.resolve(root);
  const target = path.resolve(projectRoot, ...safeRelative(relative, label).split("/"));
  const rel = path.relative(projectRoot, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${label} 逃逸项目目录`);
  return target;
}

function safeBytes(root, relative, label) {
  const record = readSafeRegularFile(path.resolve(root), resolveInside(root, relative, label), label);
  if (record.stat.nlink !== 1n || record.stat.size <= 0n) throw new Error(`${label} 必须是非空单链接普通文件`);
  return record.bytes;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function findEndOfCentralDirectory(bytes, label) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw new Error(`${label} 缺少唯一可定位的 ZIP EOCD`);
}

function inventoryZipArchive(bytes, rootDirectory, label = "ZIP", { maxOutputLength = 64 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) throw new Error(`${label} 不是有效 ZIP 字节`);
  safeRelative(rootDirectory, `${label} 根目录`);
  const eocd = findEndOfCentralDirectory(bytes, label);
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8);
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries || totalEntries === 0xffff ||
      centralSize === 0xffffffff || centralOffset === 0xffffffff ||
      centralOffset + centralSize > eocd) throw new Error(`${label} 使用多卷、ZIP64 或越界中央目录`);
  const rootPrefix = `${rootDirectory}/`;
  const seen = new Set();
  const files = [];
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`${label} 中央目录条目 ${index} 非法`);
    }
    const madeBy = bytes.readUInt16LE(cursor + 4);
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const diskStart = bytes.readUInt16LE(cursor + 34);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.length || diskStart !== 0 || compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff || localOffset === 0xffffffff || (flags & 1) !== 0 ||
        ![0, 8].includes(method)) throw new Error(`${label} 条目 ${index} 使用不支持或不安全的 ZIP 特性`);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString("utf8");
    if (!Buffer.from(name, "utf8").equals(nameBytes) || name.includes("\0") || name.includes("\\") ||
        path.posix.normalize(name) !== name || name.startsWith("/") || name.startsWith("../")) {
      throw new Error(`${label} 条目路径不安全：${name}`);
    }
    const unixMode = (madeBy >>> 8) === 3 ? (externalAttributes >>> 16) & 0xffff : 0;
    if ((unixMode & 0xf000) === 0xa000) throw new Error(`${label} 不接受符号链接：${name}`);
    const directory = name.endsWith("/");
    if (directory) {
      if (compressedSize !== 0 || uncompressedSize !== 0 || !(name === rootPrefix || name.startsWith(rootPrefix))) {
        throw new Error(`${label} 目录条目非法：${name}`);
      }
      cursor = next;
      continue;
    }
    if (!name.startsWith(rootPrefix)) throw new Error(`${label} 文件不在固定根目录：${name}`);
    const relative = safeRelative(name.slice(rootPrefix.length), `${label} 条目路径`);
    if (seen.has(relative)) throw new Error(`${label} 含重复文件：${relative}`);
    seen.add(relative);
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`${label} 本地文件头非法：${relative}`);
    }
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset || localFlags !== flags || localMethod !== method ||
        !bytes.subarray(localNameStart, localNameStart + localNameLength).equals(nameBytes)) {
      throw new Error(`${label} 本地/中央目录条目不一致：${relative}`);
    }
    const compressed = bytes.subarray(dataStart, dataEnd);
    const content = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength });
    if (content.length !== uncompressedSize || content.length <= 0) throw new Error(`${label} 解压大小非法：${relative}`);
    files.push({ path: relative, size_bytes: content.length, sha256: sha256(content) });
    cursor = next;
  }
  if (cursor !== centralOffset + centralSize) throw new Error(`${label} 中央目录大小不一致`);
  files.sort((left, right) => compareUtf16(left.path, right.path));
  return files;
}

function validateEvidence(evidence, profile = PROFILE) {
  exactKeys(evidence, ["schema_version", "evidence_type", "subject", "official_release", "derivation", "redistribution", "verification", "official_files"], "EpubCheck provenance");
  exactKeys(evidence.subject, ["name", "version", "distribution", "manifest"], "subject");
  exactKeys(evidence.official_release, ["publisher", "release_page_url", "release_api_url", "release_api_sha256", "tag", "published_at", "artifact"], "official_release");
  exactKeys(evidence.official_release.artifact, ["url", "filename", "size_bytes", "sha256", "github_server_digest"], "artifact");
  exactKeys(evidence.derivation, ["official_file_count", "local_file_count", "byte_identical_file_count", "official_total_bytes", "local_total_bytes", "controlled_modifications"], "derivation");
  exactKeys(evidence.redistribution, ["distribution_license", "license_files", "website_license_claim", "license_signal_consistent"], "redistribution");
  exactKeys(evidence.verification, ["machine_status", "human_review_status", "observed_at", "limitations"], "verification");
  const artifact = evidence.official_release.artifact;
  if (evidence.schema_version !== 1 || evidence.evidence_type !== "oak-tool-distribution-provenance" ||
      evidence.subject.name !== profile.name || evidence.subject.version !== profile.version ||
      evidence.subject.distribution !== profile.distribution || evidence.subject.manifest !== profile.manifest ||
      evidence.official_release.publisher !== profile.publisher ||
      evidence.official_release.release_page_url !== profile.releasePage ||
      evidence.official_release.release_api_url !== profile.releaseApi ||
      evidence.official_release.release_api_sha256 !== profile.releaseApiSha256 ||
      evidence.official_release.tag !== profile.tag || evidence.official_release.published_at !== profile.publishedAt ||
      artifact.url !== profile.artifactUrl || artifact.filename !== profile.artifactFilename ||
      artifact.size_bytes !== profile.artifactSize || artifact.sha256 !== profile.artifactSha256 ||
      artifact.github_server_digest !== `sha256:${profile.artifactSha256}`) {
    throw new Error("EpubCheck provenance 官方发行身份不匹配固定策略");
  }
  if (!Array.isArray(evidence.official_files) || evidence.official_files.length !== profile.fileCount) {
    throw new Error("EpubCheck provenance 官方文件数不匹配");
  }
  let previous = null;
  for (const [index, item] of evidence.official_files.entries()) {
    exactKeys(item, ["path", "size_bytes", "sha256"], `official_files[${index}]`);
    safeRelative(item.path, `official_files[${index}].path`);
    if (previous !== null && compareUtf16(previous, item.path) >= 0) throw new Error("EpubCheck 官方文件未严格排序");
    if (!Number.isSafeInteger(item.size_bytes) || item.size_bytes <= 0 || !HASH_RE.test(item.sha256)) {
      throw new Error("EpubCheck 官方文件记录非法");
    }
    previous = item.path;
  }
  const d = evidence.derivation;
  if (d.official_file_count !== profile.fileCount || d.local_file_count !== profile.fileCount ||
      d.byte_identical_file_count !== profile.fileCount || d.official_total_bytes !== profile.totalBytes ||
      d.local_total_bytes !== profile.totalBytes || !Array.isArray(d.controlled_modifications) ||
      d.controlled_modifications.length !== 0) throw new Error("EpubCheck provenance 推导事实不匹配");
  if (evidence.redistribution.distribution_license !== "BSD-3-Clause" ||
      JSON.stringify(evidence.redistribution.license_files) !== JSON.stringify(profile.licenseFiles) ||
      evidence.redistribution.website_license_claim !== "MIT" || evidence.redistribution.license_signal_consistent !== false ||
      evidence.verification.machine_status !== "verified" || evidence.verification.human_review_status !== "pending" ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(evidence.verification.observed_at) ||
      !Array.isArray(evidence.verification.limitations) || evidence.verification.limitations.length !== 4) {
    throw new Error("EpubCheck provenance 许可或审阅状态被夸大");
  }
  return evidence;
}

function compareTrees(official, local, profile = PROFILE) {
  if (official.length !== profile.fileCount || local.length !== profile.fileCount) throw new Error("EpubCheck 官方/本地文件数不匹配");
  if (JSON.stringify(official) !== JSON.stringify(local)) throw new Error("EpubCheck 本地分发不是官方 ZIP 的逐字节副本");
  const total = official.reduce((sum, item) => sum + item.size_bytes, 0);
  if (total !== profile.totalBytes) throw new Error("EpubCheck 官方分发总字节数不匹配");
  return total;
}

function buildEvidence(root = PROJECT_ROOT, {
  archive = "out/downloads/provenance/epubcheck-5.3.0/epubcheck-5.3.0.zip",
  releaseApi = "out/downloads/provenance/epubcheck-5.3.0/release-v5.3.0.json",
  observedAt = "2026-07-28",
  profile = PROFILE,
} = {}) {
  const projectRoot = path.resolve(root);
  const archiveBytes = safeBytes(projectRoot, archive, "EpubCheck 官方 ZIP");
  if (archiveBytes.length !== profile.artifactSize || sha256(archiveBytes) !== profile.artifactSha256) throw new Error("EpubCheck 官方 ZIP 大小或 SHA-256 不匹配");
  const apiBytes = safeBytes(projectRoot, releaseApi, "EpubCheck GitHub release API");
  if (sha256(apiBytes) !== profile.releaseApiSha256) throw new Error("EpubCheck GitHub release API 原始字节摘要不匹配");
  const api = parseJsonStrict(apiBytes.toString("utf8"), "EpubCheck GitHub release API");
  const asset = Array.isArray(api.assets) ? api.assets.find((item) => item?.name === profile.artifactFilename) : null;
  if (api.tag_name !== profile.tag || api.name !== "EPUBCheck v5.3.0" || api.published_at !== profile.publishedAt ||
      api.html_url !== profile.releasePage || !asset || asset.size !== profile.artifactSize ||
      asset.digest !== `sha256:${profile.artifactSha256}` || asset.browser_download_url !== profile.artifactUrl) {
    throw new Error("EpubCheck GitHub release API 未精确绑定固定官方制品");
  }
  const localDirectory = resolveInside(projectRoot, profile.distribution, "EpubCheck 本地分发目录");
  ensureSafeDirectoryChain(projectRoot, localDirectory, { label: "EpubCheck 本地分发目录" });
  const official = inventoryZipArchive(archiveBytes, profile.artifactFilename.slice(0, -4), "EpubCheck 官方 ZIP");
  const local = inventory(localDirectory, "EpubCheck 本地分发目录");
  const total = compareTrees(official, local, profile);
  const evidence = {
    schema_version: 1,
    evidence_type: "oak-tool-distribution-provenance",
    subject: { name: profile.name, version: profile.version, distribution: profile.distribution, manifest: profile.manifest },
    official_release: {
      publisher: profile.publisher, release_page_url: profile.releasePage, release_api_url: profile.releaseApi,
      release_api_sha256: sha256(apiBytes), tag: profile.tag, published_at: profile.publishedAt,
      artifact: { url: profile.artifactUrl, filename: profile.artifactFilename, size_bytes: archiveBytes.length,
        sha256: sha256(archiveBytes), github_server_digest: asset.digest },
    },
    derivation: { official_file_count: official.length, local_file_count: local.length,
      byte_identical_file_count: official.length, official_total_bytes: total, local_total_bytes: total,
      controlled_modifications: [] },
    redistribution: { distribution_license: "BSD-3-Clause", license_files: [...profile.licenseFiles],
      website_license_claim: "MIT", license_signal_consistent: false },
    verification: { machine_status: "verified", human_review_status: "pending", observed_at: observedAt,
      limitations: [
        "GitHub's server-reported SHA-256 and the downloaded ZIP digest match, but no detached artifact signature was published or verified.",
        "The signed Git tag shown by GitHub was not independently verified and does not by itself bind the generated release ZIP bytes.",
        "The current EPUBCheck website says MIT while the repository and official distribution contain a BSD-3-Clause license; human resolution is required.",
        "Third-party notices and all redistribution obligations still require named human sign-off before sale.",
      ] },
    official_files: official,
  };
  return validateEvidence(evidence, profile);
}

function verifyEvidenceAgainstDistribution(root = PROJECT_ROOT, { profile = PROFILE } = {}) {
  const projectRoot = path.resolve(root);
  const bytes = safeBytes(projectRoot, profile.evidence, "EpubCheck provenance evidence");
  const evidence = validateEvidence(parseJsonStrict(bytes.toString("utf8"), "EpubCheck provenance evidence"), profile);
  if (!bytes.equals(canonicalJson(evidence))) throw new Error("EpubCheck provenance evidence 不是 canonical UTF-8/LF JSON");
  const localDirectory = resolveInside(projectRoot, profile.distribution, "EpubCheck 本地分发目录");
  ensureSafeDirectoryChain(projectRoot, localDirectory, { label: "EpubCheck 本地分发目录" });
  const local = inventory(localDirectory, "EpubCheck 本地分发目录");
  if (JSON.stringify(local) !== JSON.stringify(evidence.official_files)) throw new Error("EpubCheck 本地分发与 provenance 官方文件树不一致");
  return { evidence, evidence_path: profile.evidence, evidence_sha256: sha256(bytes), machine_status: "verified", human_review_status: "pending" };
}

function writeEvidence(root = PROJECT_ROOT, options = {}) {
  const projectRoot = path.resolve(root);
  const profile = options.profile || PROFILE;
  const evidence = buildEvidence(projectRoot, options);
  return atomicReplaceTrackedFile({ root: projectRoot, target: resolveInside(projectRoot, profile.evidence, "EpubCheck provenance evidence"),
    bytes: canonicalJson(evidence), verify: () => verifyEvidenceAgainstDistribution(projectRoot, { profile }) }).verification;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some((item) => item !== "--update-evidence")) throw new Error(`未知参数：${args.join(", ")}`);
    const result = args.includes("--update-evidence") ? writeEvidence() : verifyEvidenceAgainstDistribution();
    process.stdout.write(`${JSON.stringify({ ok: true, evidence_path: result.evidence_path,
      evidence_sha256: result.evidence_sha256, version: result.evidence.subject.version,
      official_file_count: result.evidence.derivation.official_file_count,
      byte_identical_file_count: result.evidence.derivation.byte_identical_file_count,
      machine_status: result.machine_status, human_review_status: result.human_review_status }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { PROFILE, buildEvidence, canonicalJson, compareTrees, inventoryZipArchive, validateEvidence,
  verifyEvidenceAgainstDistribution, writeEvidence };
