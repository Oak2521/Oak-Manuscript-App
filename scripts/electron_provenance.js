"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { compareUtf16 } = require("./deterministic_compare");
const { canonicalJson, inventoryZipArchive } = require("./epubcheck_provenance");
const { verifyRuntime } = require("./electron_runtime_manifest");
const { atomicReplaceTrackedFile, readSafeRegularFile } = require("./safe_tracked_file");
const { parseJsonStrict } = require("./strict_json");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILE = Object.freeze({
  name: "Electron",
  version: "43.1.0",
  platform: "win32",
  arch: "x64",
  runtimeRoot: "node_modules/electron/dist",
  runtimeLock: "config/tool-manifests/electron-43.1.0-win32-x64.json",
  evidence: "config/provenance/electron-43.1.0-win32-x64.json",
  releasePage: "https://github.com/electron/electron/releases/tag/v43.1.0",
  releaseApi: "https://api.github.com/repos/electron/electron/releases/tags/v43.1.0",
  releaseApiSha256: "aab2c6e1c35460de487aa9d2a561340cea99e21b72f22c773b13a0b84c15bf8b",
  tag: "v43.1.0",
  publishedAt: "2026-07-07T19:27:26Z",
  artifactFilename: "electron-v43.1.0-win32-x64.zip",
  artifactSize: 144_237_574,
  artifactSha256: "a07dc1e3d5e589593d37e3b19d1b373e02bb58270e2eb0d6633eee0198ad09f0",
  shasumsSize: 7_610,
  shasumsSha256: "5750c4c4964f9febf50a03a69a54b2a671e0a6520c3ea6b4500081d32cf53f13",
  npmPackageJsonSha256: "112071db9cf7c002f294bb517b840a865fc5a74acacb3a2c79ace6a45c010264",
  npmChecksumsSha256: "7c6faa41291ccd0db2cd73236ca80e6c82398812ad2cf2b9490fd9524c7d13c5",
  fileCount: 75,
  totalBytes: 364_083_658,
  treeSha256: "652e9b29f6f8f37b7d8d8beffb2eb5c149efb7afe54bcf65f1df7facadcc0462",
});
const ARTIFACT_URL = `https://github.com/electron/electron/releases/download/${PROFILE.tag}/${PROFILE.artifactFilename}`;
const SHASUMS_URL = `https://github.com/electron/electron/releases/download/${PROFILE.tag}/SHASUMS256.txt`;
const HASH_RE = /^[0-9a-f]{64}$/u;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
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
  const base = path.resolve(root);
  const target = path.resolve(base, ...safeRelative(relative, label).split("/"));
  const rel = path.relative(base, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${label} 逃逸项目目录`);
  return target;
}

function safeBytes(root, relative, label) {
  const record = readSafeRegularFile(path.resolve(root), resolveInside(root, relative, label), label);
  if (record.stat.nlink !== 1n || record.stat.size <= 0n) throw new Error(`${label} 必须是非空单链接普通文件`);
  return record.bytes;
}

function treeDigest(files) {
  const digest = crypto.createHash("sha256");
  let total = 0;
  for (const item of files) {
    digest.update(item.path, "utf8");
    digest.update("\0");
    digest.update(String(item.size_bytes), "ascii");
    digest.update("\0");
    digest.update(item.sha256, "ascii");
    digest.update("\n");
    total += item.size_bytes;
  }
  return { file_count: files.length, total_bytes: total, sha256: digest.digest("hex") };
}

function validateFiles(files, label) {
  if (!Array.isArray(files) || files.length !== PROFILE.fileCount) throw new Error(`${label} 文件数非法`);
  let previous = null;
  for (const [index, item] of files.entries()) {
    exactKeys(item, ["path", "size_bytes", "sha256"], `${label}[${index}]`);
    safeRelative(item.path, `${label}[${index}].path`);
    if (previous !== null && compareUtf16(previous, item.path) >= 0) throw new Error(`${label} 未严格排序`);
    if (!Number.isSafeInteger(item.size_bytes) || item.size_bytes <= 0 || !HASH_RE.test(item.sha256)) {
      throw new Error(`${label} 含非法文件记录`);
    }
    previous = item.path;
  }
  const tree = treeDigest(files);
  if (tree.file_count !== PROFILE.fileCount || tree.total_bytes !== PROFILE.totalBytes ||
      tree.sha256 !== PROFILE.treeSha256) throw new Error(`${label} 文件树不匹配固定策略`);
  return tree;
}

function validateEvidence(evidence, profile = PROFILE) {
  exactKeys(evidence, ["schema_version", "evidence_type", "subject", "official_release", "npm_package", "derivation", "redistribution", "verification", "official_files"], "Electron provenance");
  exactKeys(evidence.subject, ["name", "version", "target", "runtime_root", "runtime_lock"], "subject");
  exactKeys(evidence.subject.target, ["platform", "arch"], "subject.target");
  exactKeys(evidence.official_release, ["publisher", "release_page_url", "release_api_url", "release_api_sha256", "tag", "published_at", "artifact", "shasums", "signature_status"], "official_release");
  exactKeys(evidence.official_release.artifact, ["url", "filename", "size_bytes", "sha256", "github_server_digest"], "artifact");
  exactKeys(evidence.official_release.shasums, ["url", "size_bytes", "sha256", "declared_artifact_sha256", "filename_matches"], "shasums");
  exactKeys(evidence.npm_package, ["package_lock_path", "resolved", "integrity", "installed_package_json_sha256", "installed_checksums_path", "installed_checksums_sha256", "artifact_digest_matches"], "npm_package");
  exactKeys(evidence.derivation, ["official_file_count", "local_file_count", "byte_identical_file_count", "official_total_bytes", "local_total_bytes", "official_tree_sha256", "local_tree_sha256"], "derivation");
  exactKeys(evidence.redistribution, ["license_expression", "runtime_license_path", "chromium_notices_path", "npm_license_path", "license_materials_byte_identical", "human_signoff_required"], "redistribution");
  exactKeys(evidence.verification, ["machine_status", "human_review_status", "observed_at", "limitations"], "verification");
  const release = evidence.official_release;
  const artifact = release.artifact;
  const sums = release.shasums;
  if (evidence.schema_version !== 1 || evidence.evidence_type !== "oak-electron-runtime-provenance" ||
      evidence.subject.name !== profile.name || evidence.subject.version !== profile.version ||
      evidence.subject.target.platform !== profile.platform || evidence.subject.target.arch !== profile.arch ||
      evidence.subject.runtime_root !== profile.runtimeRoot || evidence.subject.runtime_lock !== profile.runtimeLock ||
      release.publisher !== "Electron maintainers" || release.release_page_url !== profile.releasePage ||
      release.release_api_url !== profile.releaseApi || release.release_api_sha256 !== profile.releaseApiSha256 ||
      release.tag !== profile.tag || release.published_at !== profile.publishedAt ||
      artifact.url !== ARTIFACT_URL || artifact.filename !== profile.artifactFilename ||
      artifact.size_bytes !== profile.artifactSize || artifact.sha256 !== profile.artifactSha256 ||
      artifact.github_server_digest !== `sha256:${profile.artifactSha256}` ||
      sums.url !== SHASUMS_URL || sums.size_bytes !== profile.shasumsSize || sums.sha256 !== profile.shasumsSha256 ||
      sums.declared_artifact_sha256 !== profile.artifactSha256 || sums.filename_matches !== true ||
      release.signature_status !== "not_provided_as_release_asset") {
    throw new Error("Electron provenance 官方发行身份不匹配固定策略");
  }
  const npm = evidence.npm_package;
  if (npm.package_lock_path !== "package-lock.json" ||
      npm.resolved !== "https://registry.npmjs.org/electron/-/electron-43.1.0.tgz" ||
      npm.integrity !== "sha512-DPfxpQLd4NL3BJ8DBxYAfmLUKKesF5Rx9dQx5FyczAP8bhOPScjHE48GArVeXu68LlAainuwkmQTQvdZwpIIAQ==" ||
      npm.installed_package_json_sha256 !== profile.npmPackageJsonSha256 ||
      npm.installed_checksums_path !== "node_modules/electron/checksums.json" ||
      npm.installed_checksums_sha256 !== profile.npmChecksumsSha256 || npm.artifact_digest_matches !== true) {
    throw new Error("Electron npm package 或 checksums 绑定不匹配");
  }
  const tree = validateFiles(evidence.official_files, "official_files");
  const d = evidence.derivation;
  if (d.official_file_count !== tree.file_count || d.local_file_count !== tree.file_count ||
      d.byte_identical_file_count !== tree.file_count || d.official_total_bytes !== tree.total_bytes ||
      d.local_total_bytes !== tree.total_bytes || d.official_tree_sha256 !== tree.sha256 || d.local_tree_sha256 !== tree.sha256) {
    throw new Error("Electron provenance 本地派生事实非法");
  }
  const redist = evidence.redistribution;
  if (redist.license_expression !== "MIT" || redist.runtime_license_path !== "node_modules/electron/dist/LICENSE" ||
      redist.chromium_notices_path !== "node_modules/electron/dist/LICENSES.chromium.html" ||
      redist.npm_license_path !== "node_modules/electron/LICENSE" || redist.license_materials_byte_identical !== true ||
      redist.human_signoff_required !== true || evidence.verification.machine_status !== "verified" ||
      evidence.verification.human_review_status !== "pending" ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(evidence.verification.observed_at) ||
      !Array.isArray(evidence.verification.limitations) || evidence.verification.limitations.length !== 3) {
    throw new Error("Electron provenance 许可或审阅状态被夸大");
  }
  return evidence;
}

function buildEvidence(root = PROJECT_ROOT, {
  archive = `out/downloads/provenance/electron-43.1.0/${PROFILE.artifactFilename}`,
  releaseApi = "out/downloads/provenance/electron-43.1.0/github-release.json",
  shasums = "out/downloads/provenance/electron-43.1.0/SHASUMS256.txt",
  observedAt = "2026-07-28",
  profile = PROFILE,
} = {}) {
  const projectRoot = path.resolve(root);
  const archiveBytes = safeBytes(projectRoot, archive, "Electron 官方 ZIP");
  const apiBytes = safeBytes(projectRoot, releaseApi, "Electron GitHub release API");
  const sumsBytes = safeBytes(projectRoot, shasums, "Electron SHASUMS256");
  if (archiveBytes.length !== profile.artifactSize || sha256(archiveBytes) !== profile.artifactSha256 ||
      sha256(apiBytes) !== profile.releaseApiSha256 || sumsBytes.length !== profile.shasumsSize ||
      sha256(sumsBytes) !== profile.shasumsSha256) throw new Error("Electron 官方输入大小或 SHA-256 不匹配");
  const api = parseJsonStrict(apiBytes.toString("utf8"), "Electron GitHub release API");
  const asset = (api.assets || []).find((item) => item.name === profile.artifactFilename);
  if (api.tag_name !== profile.tag || api.name !== `electron ${profile.tag}` || api.published_at !== profile.publishedAt ||
      api.html_url !== profile.releasePage || !asset || asset.size !== profile.artifactSize ||
      asset.digest !== `sha256:${profile.artifactSha256}` || asset.browser_download_url !== ARTIFACT_URL) {
    throw new Error("Electron GitHub release API 未绑定固定制品");
  }
  const sumLine = sumsBytes.toString("utf8").split(/\r?\n/u)
    .find((line) => line.endsWith(` *${profile.artifactFilename}`));
  if (sumLine !== `${profile.artifactSha256} *${profile.artifactFilename}`) {
    throw new Error("Electron SHASUMS256 未精确声明固定 ZIP");
  }
  const npmPackageBytes = safeBytes(projectRoot, "node_modules/electron/package.json", "Electron npm package.json");
  const npmChecksumsBytes = safeBytes(projectRoot, "node_modules/electron/checksums.json", "Electron npm checksums");
  if (sha256(npmPackageBytes) !== profile.npmPackageJsonSha256 ||
      sha256(npmChecksumsBytes) !== profile.npmChecksumsSha256) throw new Error("Electron npm package 元数据漂移");
  const npmPackage = parseJsonStrict(npmPackageBytes.toString("utf8"), "Electron npm package.json");
  const npmChecksums = parseJsonStrict(npmChecksumsBytes.toString("utf8"), "Electron npm checksums");
  if (npmPackage.name !== "electron" || npmPackage.version !== profile.version || npmPackage.license !== "MIT" ||
      npmChecksums[profile.artifactFilename] !== profile.artifactSha256) throw new Error("Electron npm 元数据未绑定官方 ZIP");
  const official = inventoryZipArchive(archiveBytes, null, "Electron 官方 ZIP", { maxOutputLength: 512 * 1024 * 1024 });
  const officialTree = validateFiles(official, "Electron 官方 ZIP 文件");
  const runtime = verifyRuntime(projectRoot, { platform: profile.platform, arch: profile.arch });
  if (JSON.stringify(official) !== JSON.stringify(runtime.files)) throw new Error("本机 Electron dist 不是官方 ZIP 的逐字节副本");
  const runtimeLicense = official.find((item) => item.path === "LICENSE");
  if (!runtimeLicense || runtimeLicense.sha256 !== sha256(safeBytes(projectRoot, "node_modules/electron/LICENSE", "Electron npm LICENSE"))) {
    throw new Error("Electron npm/runtime LICENSE 未原字节一致保留");
  }
  const evidence = {
    schema_version: 1,
    evidence_type: "oak-electron-runtime-provenance",
    subject: { name: profile.name, version: profile.version, target: { platform: profile.platform, arch: profile.arch },
      runtime_root: profile.runtimeRoot, runtime_lock: profile.runtimeLock },
    official_release: {
      publisher: "Electron maintainers", release_page_url: profile.releasePage, release_api_url: profile.releaseApi,
      release_api_sha256: sha256(apiBytes), tag: profile.tag, published_at: profile.publishedAt,
      artifact: { url: ARTIFACT_URL, filename: profile.artifactFilename, size_bytes: archiveBytes.length,
        sha256: sha256(archiveBytes), github_server_digest: asset.digest },
      shasums: { url: SHASUMS_URL, size_bytes: sumsBytes.length, sha256: sha256(sumsBytes),
        declared_artifact_sha256: profile.artifactSha256, filename_matches: true },
      signature_status: "not_provided_as_release_asset",
    },
    npm_package: {
      package_lock_path: "package-lock.json", resolved: runtime.manifest.package_lock.resolved,
      integrity: runtime.manifest.package_lock.integrity, installed_package_json_sha256: sha256(npmPackageBytes),
      installed_checksums_path: "node_modules/electron/checksums.json",
      installed_checksums_sha256: sha256(npmChecksumsBytes), artifact_digest_matches: true,
    },
    derivation: {
      official_file_count: officialTree.file_count, local_file_count: runtime.files.length,
      byte_identical_file_count: officialTree.file_count, official_total_bytes: officialTree.total_bytes,
      local_total_bytes: officialTree.total_bytes, official_tree_sha256: officialTree.sha256,
      local_tree_sha256: officialTree.sha256,
    },
    redistribution: {
      license_expression: "MIT", runtime_license_path: "node_modules/electron/dist/LICENSE",
      chromium_notices_path: "node_modules/electron/dist/LICENSES.chromium.html",
      npm_license_path: "node_modules/electron/LICENSE", license_materials_byte_identical: true,
      human_signoff_required: true,
    },
    verification: {
      machine_status: "verified", human_review_status: "pending", observed_at: observedAt,
      limitations: [
        "The release snapshot contains no detached-signature asset; GitHub server digest, SHASUMS256 and npm checksums were cross-checked instead.",
        "The official ZIP and installed runtime are byte-bound, but this is not an independent reproducible-build audit of Electron and Chromium sources.",
        "MIT, Chromium third-party notices, trademark and redistribution obligations still require named human sign-off before sale.",
      ],
    },
    official_files: official,
  };
  return validateEvidence(evidence, profile);
}

function verifyEvidenceAgainstRuntime(root = PROJECT_ROOT, { profile = PROFILE, distribution = null } = {}) {
  const projectRoot = path.resolve(root);
  const bytes = safeBytes(projectRoot, profile.evidence, "Electron provenance evidence");
  const evidence = validateEvidence(parseJsonStrict(bytes.toString("utf8"), "Electron provenance evidence"), profile);
  if (!bytes.equals(canonicalJson(evidence))) throw new Error("Electron provenance evidence 不是 canonical UTF-8/LF JSON");
  const runtime = verifyRuntime(projectRoot, { platform: profile.platform, arch: profile.arch, distribution });
  if (JSON.stringify(runtime.files) !== JSON.stringify(evidence.official_files)) {
    throw new Error("Electron provenance 与实际 runtime 不一致");
  }
  const reference = runtime.manifest.provenance_evidence;
  if (reference?.path !== profile.evidence || reference?.sha256 !== sha256(bytes) ||
      reference?.machine_status !== "verified" || reference?.human_review_status !== "pending") {
    throw new Error("Electron runtime lock 未精确绑定 provenance evidence");
  }
  return { evidence, evidence_path: profile.evidence, evidence_sha256: sha256(bytes),
    machine_status: "verified", human_review_status: "pending" };
}

function writeEvidence(root = PROJECT_ROOT, options = {}) {
  const projectRoot = path.resolve(root);
  const profile = options.profile || PROFILE;
  const evidence = buildEvidence(projectRoot, options);
  const target = resolveInside(projectRoot, profile.evidence, "Electron provenance evidence");
  return atomicReplaceTrackedFile({ root: projectRoot, target, bytes: canonicalJson(evidence), verify: () => {
    const bytes = safeBytes(projectRoot, profile.evidence, "Electron provenance evidence");
    const parsed = validateEvidence(parseJsonStrict(bytes.toString("utf8"), "Electron provenance evidence"), profile);
    if (!bytes.equals(canonicalJson(parsed))) throw new Error("Electron provenance evidence 不是 canonical UTF-8/LF JSON");
    return { evidence: parsed, evidence_path: profile.evidence, evidence_sha256: sha256(bytes) };
  } }).verification;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some((item) => item !== "--update-evidence")) throw new Error(`未知参数：${args.join(", ")}`);
    const result = args.includes("--update-evidence") ? writeEvidence() : verifyEvidenceAgainstRuntime();
    process.stdout.write(`${JSON.stringify({ ok: true, evidence_path: result.evidence_path,
      evidence_sha256: result.evidence_sha256, official_file_count: result.evidence.derivation.official_file_count,
      byte_identical_file_count: result.evidence.derivation.byte_identical_file_count,
      machine_status: result.evidence.verification.machine_status,
      human_review_status: result.evidence.verification.human_review_status }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { PROFILE, buildEvidence, treeDigest, validateEvidence, verifyEvidenceAgainstRuntime, writeEvidence };
