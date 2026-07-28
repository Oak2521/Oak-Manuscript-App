"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { SOURCE_ARCHIVES, LOCK_RELATIVE, TOOLCHAIN_RELATIVE } = require("./builder_toolchain_contract");
const { compareUtf16 } = require("./deterministic_compare");
const { canonicalJson } = require("./epubcheck_provenance");
const {
  assembleWindowsToolchain,
  inspectAndExtractArchive,
  isWindowsCodeSignImportEntry,
  validateSourceArchives,
} = require("./import_windows_builder_toolchain");
const { EXTRACTOR_FILES, verifyPinnedExtractor } = require("./pinned_7zip");
const { atomicReplaceTrackedFile, readSafeRegularFile } = require("./safe_tracked_file");
const { parseJsonStrict } = require("./strict_json");
const { verifyWindowsToolchain } = require("./verify_builder_toolchain");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILE = Object.freeze({
  builderVersion: "26.15.3",
  platform: "win32",
  arch: "x64",
  toolchainRoot: TOOLCHAIN_RELATIVE,
  runtimeLock: LOCK_RELATIVE,
  evidence: "config/provenance/electron-builder-win32-x64.json",
  appBuilderLibResolved: "https://registry.npmjs.org/app-builder-lib/-/app-builder-lib-26.15.3.tgz",
  appBuilderLibIntegrity: "sha512-2VnyWkqsP5v5XbBhL3tD5Syx8iNPBYsoU7kY4S2fz7wg8Rj/nztWKCUzGKaFRTv0Xwf3/H058CR1Kvtd/3lRow==",
  appBuilderLibPackageSha256: "3abe63010a62a67512f1dedaae48747081dfe22e22e4f197767bf2f4c51b60f9",
  checksumSourcePath: "node_modules/app-builder-lib/out/toolsets/windows.js",
  checksumSourceSha256: "a6e3009ca9680aec48646793289224a8df26cfb9c8dafba1e3b08323f09a331b",
  importerPath: "scripts/import_windows_builder_toolchain.js",
  importerSha256: "8e8c19afe7aefbb43648d41d2b45ee72860825702195d8ef997eba98fafd3c76",
  fileCount: 385,
  totalBytes: 19_150_116,
  treeSha256: "ff8e0f5f1175de445a57893dedde17a48c3365def4b1c00350841aff23e1d171",
  releases: Object.freeze([
    Object.freeze({ id: "nsis", tag: "nsis-3.0.4.1", publishedAt: "2019-11-27T08:12:40Z",
      apiSha256: "1622334edd90d3fab3710c9122cc298719aaafc4d9ae0057ac5d806fa0a07425" }),
    Object.freeze({ id: "nsisResources", tag: "nsis-resources-3.4.1", publishedAt: "2019-07-17T08:05:23Z",
      apiSha256: "2735ce72af81cd872fc775462e57b1b9243b292d85711507a6cf1a169cadcf5b" }),
    Object.freeze({ id: "winCodeSign", tag: "winCodeSign-2.6.0", publishedAt: "2020-03-03T12:36:19Z",
      apiSha256: "8abf3581b29ce721622896b3871e2a1082b8e4687c885e12e7df16852b9b3960" }),
  ]),
});
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

function validateReleaseRecords(records) {
  if (!Array.isArray(records) || records.length !== PROFILE.releases.length) throw new Error("builder releases 必须精确列出三项");
  for (const [index, record] of records.entries()) {
    const fixed = PROFILE.releases[index];
    const archive = SOURCE_ARCHIVES[index];
    exactKeys(record, ["id", "tag", "published_at", "release_page_url", "release_api_url", "release_api_sha256", "asset", "signature_status"], `official_releases[${index}]`);
    exactKeys(record.asset, ["url", "filename", "size_bytes", "sha256", "github_server_digest_status"], `official_releases[${index}].asset`);
    if (record.id !== fixed.id || record.tag !== fixed.tag || record.published_at !== fixed.publishedAt ||
        record.release_page_url !== `https://github.com/electron-userland/electron-builder-binaries/releases/tag/${fixed.tag}` ||
        record.release_api_url !== `https://api.github.com/repos/electron-userland/electron-builder-binaries/releases/tags/${fixed.tag}` ||
        record.release_api_sha256 !== fixed.apiSha256 || record.asset.url !== archive.url ||
        record.asset.filename !== archive.name || record.asset.sha256 !== archive.sha256 ||
        !Number.isSafeInteger(record.asset.size_bytes) || record.asset.size_bytes <= 0 ||
        record.asset.github_server_digest_status !== "unavailable_legacy_release" ||
        record.signature_status !== "not_provided_as_release_asset") {
      throw new Error(`builder release ${fixed.tag} 身份不匹配固定策略`);
    }
  }
}

function validateEvidence(evidence, profile = PROFILE) {
  exactKeys(evidence, ["schema_version", "evidence_type", "subject", "official_releases", "hash_authority", "derivation", "redistribution", "verification"], "builder provenance");
  exactKeys(evidence.subject, ["electron_builder_version", "platform", "arch", "toolchain_root", "tracked_lock"], "subject");
  exactKeys(evidence.hash_authority, ["package_lock_path", "app_builder_lib_resolved", "app_builder_lib_integrity", "app_builder_lib_package_sha256", "checksum_source_path", "checksum_source_sha256", "all_archive_hashes_present"], "hash_authority");
  exactKeys(evidence.derivation, ["source_archive_count", "importer_path", "importer_sha256", "extractor_files", "rebuilt_from_archives", "toolchain_file_count", "toolchain_total_bytes", "toolchain_tree_sha256"], "derivation");
  exactKeys(evidence.redistribution, ["build_time_only", "retained_license_files", "missing_named_license_materials", "human_signoff_required"], "redistribution");
  exactKeys(evidence.verification, ["machine_status", "human_review_status", "observed_at", "limitations"], "verification");
  if (evidence.schema_version !== 1 || evidence.evidence_type !== "oak-windows-builder-provenance" ||
      evidence.subject.electron_builder_version !== profile.builderVersion || evidence.subject.platform !== profile.platform ||
      evidence.subject.arch !== profile.arch || evidence.subject.toolchain_root !== profile.toolchainRoot ||
      evidence.subject.tracked_lock !== profile.runtimeLock) throw new Error("builder provenance subject 不匹配");
  validateReleaseRecords(evidence.official_releases);
  const auth = evidence.hash_authority;
  if (auth.package_lock_path !== "package-lock.json" || auth.app_builder_lib_resolved !== profile.appBuilderLibResolved ||
      auth.app_builder_lib_integrity !== profile.appBuilderLibIntegrity ||
      auth.app_builder_lib_package_sha256 !== profile.appBuilderLibPackageSha256 ||
      auth.checksum_source_path !== profile.checksumSourcePath || auth.checksum_source_sha256 !== profile.checksumSourceSha256 ||
      auth.all_archive_hashes_present !== true) throw new Error("builder hash authority 不匹配");
  const d = evidence.derivation;
  if (d.source_archive_count !== 3 || d.importer_path !== profile.importerPath || d.importer_sha256 !== profile.importerSha256 ||
      !Array.isArray(d.extractor_files) || d.extractor_files.length !== 2 || d.rebuilt_from_archives !== true ||
      d.toolchain_file_count !== profile.fileCount || d.toolchain_total_bytes !== profile.totalBytes ||
      d.toolchain_tree_sha256 !== profile.treeSha256) throw new Error("builder 派生事实不匹配");
  for (const [index, item] of d.extractor_files.entries()) {
    exactKeys(item, ["path", "sha256"], `extractor_files[${index}]`);
    if (item.path !== EXTRACTOR_FILES[index].relative || item.sha256 !== EXTRACTOR_FILES[index].sha256) {
      throw new Error("builder 固定解压器证据不匹配");
    }
  }
  const redist = evidence.redistribution;
  if (redist.build_time_only !== true || redist.human_signoff_required !== true ||
      JSON.stringify(redist.missing_named_license_materials) !== JSON.stringify(["nsis-resources", "selected-winCodeSign"]) ||
      !Array.isArray(redist.retained_license_files) || redist.retained_license_files.length !== 1) {
    throw new Error("builder 许可边界被夸大");
  }
  exactKeys(redist.retained_license_files[0], ["path", "size_bytes", "sha256"], "retained_license_files[0]");
  if (redist.retained_license_files[0].path !== `${profile.toolchainRoot}/nsis/COPYING` ||
      redist.retained_license_files[0].size_bytes !== 15488 ||
      redist.retained_license_files[0].sha256 !== "3c8de989f6504d52f5f8dfafedb6668cd47201f5d01f1319570727c091425dd6") {
    throw new Error("builder NSIS COPYING 证据不匹配");
  }
  if (evidence.verification.machine_status !== "verified" || evidence.verification.human_review_status !== "pending" ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(evidence.verification.observed_at) ||
      !Array.isArray(evidence.verification.limitations) || evidence.verification.limitations.length !== 3) {
    throw new Error("builder 人工审阅状态被夸大");
  }
  return evidence;
}

function deriveManifestFromArchives(root, archiveDirectory) {
  const projectRoot = path.resolve(root);
  const sources = validateSourceArchives(archiveDirectory);
  const extractor = verifyPinnedExtractor(projectRoot);
  const tempParent = path.join(projectRoot, "out", "tmp");
  fs.mkdirSync(tempParent, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(tempParent, "builder-provenance-"));
  try {
    const extracted = Object.create(null);
    for (const source of sources) {
      const destination = path.join(tempRoot, source.id);
      inspectAndExtractArchive({ archive: source.target, destination, expectedSha256: source.sha256, extractor,
        includeEntry: source.id === "winCodeSign" ? isWindowsCodeSignImportEntry : null });
      extracted[source.id] = destination;
    }
    return assembleWindowsToolchain({
      candidateProjectRoot: path.join(tempRoot, "candidate-project"), nsisRoot: extracted.nsis,
      nsisResourcesRoot: extracted.nsisResources, winCodeSignRoot: extracted.winCodeSign,
      sourceArchives: sources, provenanceEvidence: null,
    }).manifest;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function buildEvidence(root = PROJECT_ROOT, {
  archiveDirectory = "out/downloads/windows-builder",
  releaseDirectory = "out/downloads/provenance/electron-builder-win32-x64",
  observedAt = "2026-07-28",
  profile = PROFILE,
} = {}) {
  const projectRoot = path.resolve(root);
  const lock = parseJsonStrict(safeBytes(projectRoot, profile.runtimeLock, "builder tracked lock").toString("utf8"), "builder tracked lock");
  const derived = deriveManifestFromArchives(projectRoot, resolveInside(projectRoot, archiveDirectory, "builder archive directory"));
  if (JSON.stringify(derived.source_archives) !== JSON.stringify(lock.source_archives) ||
      JSON.stringify(derived.files) !== JSON.stringify(lock.files) || derived.file_count !== lock.file_count ||
      derived.total_bytes !== lock.total_bytes) throw new Error("三份固定归档重建结果与 tracked builder 工具树不一致");
  const tree = treeDigest(derived.files);
  if (tree.file_count !== profile.fileCount || tree.total_bytes !== profile.totalBytes || tree.sha256 !== profile.treeSha256) {
    throw new Error("builder 工具树摘要不匹配固定策略");
  }
  const packageLock = parseJsonStrict(safeBytes(projectRoot, "package-lock.json", "package-lock.json").toString("utf8"), "package-lock.json");
  const appBuilder = packageLock.packages?.["node_modules/app-builder-lib"];
  const packageBytes = safeBytes(projectRoot, "node_modules/app-builder-lib/package.json", "app-builder-lib package.json");
  const checksumSource = safeBytes(projectRoot, profile.checksumSourcePath, "app-builder-lib checksum source");
  const importerBytes = safeBytes(projectRoot, profile.importerPath, "builder importer");
  if (appBuilder?.version !== profile.builderVersion || appBuilder?.resolved !== profile.appBuilderLibResolved ||
      appBuilder?.integrity !== profile.appBuilderLibIntegrity || sha256(packageBytes) !== profile.appBuilderLibPackageSha256 ||
      sha256(checksumSource) !== profile.checksumSourceSha256 || sha256(importerBytes) !== profile.importerSha256 ||
      !SOURCE_ARCHIVES.every((item) => checksumSource.includes(Buffer.from(item.sha256, "ascii")))) {
    throw new Error("app-builder-lib 版本、npm 锁或三份归档哈希来源不匹配");
  }
  const releases = profile.releases.map((fixed, index) => {
    const archive = SOURCE_ARCHIVES[index];
    const apiRelative = `${releaseDirectory}/${fixed.tag}-release.json`;
    const apiBytes = safeBytes(projectRoot, apiRelative, `${fixed.tag} release API`);
    if (sha256(apiBytes) !== fixed.apiSha256) throw new Error(`${fixed.tag} release API 摘要不匹配`);
    const api = parseJsonStrict(apiBytes.toString("utf8"), `${fixed.tag} release API`);
    const asset = (api.assets || []).find((item) => item.name === archive.name);
    const source = derived.source_archives[index];
    if (api.tag_name !== fixed.tag || api.name !== fixed.tag || api.published_at !== fixed.publishedAt ||
        api.html_url !== `https://github.com/electron-userland/electron-builder-binaries/releases/tag/${fixed.tag}` ||
        !asset || asset.size !== source.size_bytes || asset.browser_download_url !== archive.url || asset.digest != null) {
      throw new Error(`${fixed.tag} GitHub release API 未绑定固定归档`);
    }
    return { id: fixed.id, tag: fixed.tag, published_at: fixed.publishedAt,
      release_page_url: api.html_url,
      release_api_url: `https://api.github.com/repos/electron-userland/electron-builder-binaries/releases/tags/${fixed.tag}`,
      release_api_sha256: sha256(apiBytes),
      asset: { url: archive.url, filename: archive.name, size_bytes: source.size_bytes, sha256: archive.sha256,
        github_server_digest_status: "unavailable_legacy_release" },
      signature_status: "not_provided_as_release_asset" };
  });
  const copying = derived.files.find((item) => item.path === "nsis/COPYING");
  if (!copying) throw new Error("builder 派生工具树缺少 NSIS COPYING");
  const evidence = {
    schema_version: 1,
    evidence_type: "oak-windows-builder-provenance",
    subject: { electron_builder_version: profile.builderVersion, platform: profile.platform, arch: profile.arch,
      toolchain_root: profile.toolchainRoot, tracked_lock: profile.runtimeLock },
    official_releases: releases,
    hash_authority: { package_lock_path: "package-lock.json", app_builder_lib_resolved: appBuilder.resolved,
      app_builder_lib_integrity: appBuilder.integrity, app_builder_lib_package_sha256: sha256(packageBytes),
      checksum_source_path: profile.checksumSourcePath, checksum_source_sha256: sha256(checksumSource),
      all_archive_hashes_present: true },
    derivation: { source_archive_count: 3, importer_path: profile.importerPath, importer_sha256: sha256(importerBytes),
      extractor_files: EXTRACTOR_FILES.map((item) => ({ path: item.relative, sha256: item.sha256 })),
      rebuilt_from_archives: true, toolchain_file_count: tree.file_count, toolchain_total_bytes: tree.total_bytes,
      toolchain_tree_sha256: tree.sha256 },
    redistribution: { build_time_only: true,
      retained_license_files: [{ path: `${profile.toolchainRoot}/${copying.path}`, size_bytes: copying.size_bytes, sha256: copying.sha256 }],
      missing_named_license_materials: ["nsis-resources", "selected-winCodeSign"], human_signoff_required: true },
    verification: { machine_status: "verified", human_review_status: "pending", observed_at: observedAt,
      limitations: [
        "The three legacy GitHub releases expose no server digest and no detached-signature asset; exact SHA-256 values are cross-checked against app-builder-lib 26.15.3 code and local archive bytes.",
        "The selected winCodeSign and nsis-resources payloads contain no retained named license file in the assembled build-only tree.",
        "NSIS plugins, rcedit, Microsoft Windows Kit payloads, source provenance and build-tool redistribution obligations still require named human sign-off before sale.",
      ] },
  };
  return validateEvidence(evidence, profile);
}

function verifyEvidenceAgainstToolchain(root = PROJECT_ROOT, { profile = PROFILE } = {}) {
  const projectRoot = path.resolve(root);
  const bytes = safeBytes(projectRoot, profile.evidence, "builder provenance evidence");
  const evidence = validateEvidence(parseJsonStrict(bytes.toString("utf8"), "builder provenance evidence"), profile);
  if (!bytes.equals(canonicalJson(evidence))) throw new Error("builder provenance evidence 不是 canonical UTF-8/LF JSON");
  verifyWindowsToolchain(projectRoot, profile.arch);
  const lock = parseJsonStrict(safeBytes(projectRoot, profile.runtimeLock, "builder tracked lock").toString("utf8"), "builder tracked lock");
  const tree = treeDigest(lock.files);
  const reference = lock.provenance_evidence;
  if (tree.file_count !== evidence.derivation.toolchain_file_count || tree.total_bytes !== evidence.derivation.toolchain_total_bytes ||
      tree.sha256 !== evidence.derivation.toolchain_tree_sha256 || reference?.path !== profile.evidence ||
      reference?.sha256 !== sha256(bytes) || reference?.machine_status !== "verified" ||
      reference?.human_review_status !== "pending") throw new Error("builder tracked lock 未精确绑定 provenance evidence 或工具树");
  return { evidence, evidence_path: profile.evidence, evidence_sha256: sha256(bytes),
    machine_status: "verified", human_review_status: "pending" };
}

function writeEvidence(root = PROJECT_ROOT, options = {}) {
  const projectRoot = path.resolve(root);
  const profile = options.profile || PROFILE;
  const evidence = buildEvidence(projectRoot, options);
  const target = resolveInside(projectRoot, profile.evidence, "builder provenance evidence");
  return atomicReplaceTrackedFile({ root: projectRoot, target, bytes: canonicalJson(evidence), verify: () => {
    const bytes = safeBytes(projectRoot, profile.evidence, "builder provenance evidence");
    const parsed = validateEvidence(parseJsonStrict(bytes.toString("utf8"), "builder provenance evidence"), profile);
    if (!bytes.equals(canonicalJson(parsed))) throw new Error("builder provenance evidence 不是 canonical UTF-8/LF JSON");
    return { evidence: parsed, evidence_path: profile.evidence, evidence_sha256: sha256(bytes) };
  } }).verification;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some((item) => item !== "--update-evidence")) throw new Error(`未知参数：${args.join(", ")}`);
    const result = args.includes("--update-evidence") ? writeEvidence() : verifyEvidenceAgainstToolchain();
    process.stdout.write(`${JSON.stringify({ ok: true, evidence_path: result.evidence_path,
      evidence_sha256: result.evidence_sha256, source_archive_count: result.evidence.derivation.source_archive_count,
      toolchain_file_count: result.evidence.derivation.toolchain_file_count,
      machine_status: result.evidence.verification.machine_status,
      human_review_status: result.evidence.verification.human_review_status }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { PROFILE, buildEvidence, deriveManifestFromArchives, treeDigest, validateEvidence,
  verifyEvidenceAgainstToolchain, writeEvidence };
