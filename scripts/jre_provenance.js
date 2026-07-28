"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { compareUtf16 } = require("./deterministic_compare");
const { canonicalJson, inventoryZipArchive } = require("./epubcheck_provenance");
const { atomicReplaceTrackedFile, ensureSafeDirectoryChain, readSafeRegularFile } = require("./safe_tracked_file");
const { listFiles } = require("./stage_epubcheck_jre");
const { parseJsonStrict } = require("./strict_json");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILE = Object.freeze({
  distribution: "Temurin",
  implementorVersion: "Temurin-21.0.11+10",
  javaVersion: "21.0.11",
  runtimeVersion: "21.0.11+10-LTS",
  targetPlatform: "win32",
  targetArch: "x64",
  runtimeRoot: "tools/jre-win32-x64",
  runtimeManifest: "tools/jre-win32-x64/manifest.json",
  runtimeLock: "config/tool-manifests/jre-win32-x64.json",
  evidence: "config/provenance/temurin-21.0.11+10-win32-x64.json",
  releasePage: "https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.11%2B10",
  releaseApi: "https://api.github.com/repos/adoptium/temurin21-binaries/releases/tags/jdk-21.0.11%2B10",
  releaseApiSha256: "6b76c193d01b76ef0d558ee79bf2df459bb79cfe281d37a380a5fa714207d61f",
  tag: "jdk-21.0.11+10",
  publishedAt: "2026-04-23T06:32:33Z",
  artifactFilename: "OpenJDK21U-jdk_x64_windows_hotspot_21.0.11_10.zip",
  artifactSize: 205_073_954,
  artifactSha256: "d3625e7cadf23787ea540229544b6e2ab494b3b54da1801879e583e1dfee0a64",
  metadataSize: 32_557,
  metadataSha256: "863216215e34a4218b8616fad24f7aa18636cec93ffccc62f17b1dcc663c9b8a",
  checksumSize: 116,
  checksumSha256: "f17855dbb78f9d208f9a42c166c7300e3f7d091e8048f4068bacf58b41feb9cd",
  signatureSize: 310,
  signatureSha256: "01892e4bf7cedba5b587a155af2a9d9513870bdc25156e47f328b50e4017af43",
  publicKeyUrl: "https://packages.adoptium.net/artifactory/api/gpg/key/public",
  publicKeySha256: "a46d5d3ab75c3c86dddf1bfd2957a067a24b1c6b2d2ed2bc69294bf970c5160b",
  officialRoot: "jdk-21.0.11+10",
  sourceFileCount: 490,
  sourceTotalBytes: 343_822_457,
  sourceTreeSha256: "613c12718b72625393d84c35b4f09886e7e67addcb401a0b1949902eb05d8932",
  buildRef: "https://github.com/adoptium/temurin-build/commit/a612825ee82a20ac872d60958c349854c1f29a8e",
  openjdkSource: "https://github.com/adoptium/jdk21u/commit/254494ad7d75b37f1c033245fb4dbd460d0347b5",
  runtimeFileCount: 207,
  runtimeTotalBytes: 52_384_264,
  runtimeTreeSha256: "16efd16ec81ed492a6c3c285f313456ec216099fb87000c1e607973c9e99210e",
  runtimeManifestSha256: "d0622d252094e387879713ef2497c917eec431e3d15287a826e7ccc6b8ce218d",
  preservedOfficialMaterialCount: 94,
});
const HASH_RE = /^[0-9a-f]{64}$/u;
const ARTIFACT_URL = `https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.11%2B10/${PROFILE.artifactFilename}`;
const JLINK_OPTIONS = Object.freeze([
  "--module-path", "<source-jdk>/jmods", "--add-modules", "java.se,jdk.unsupported,jdk.xml.dom",
  "--output", "<staging-output>", "--strip-debug", "--no-header-files", "--no-man-pages", "--compress=2",
]);

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

function validateFileRecords(files, label) {
  if (!Array.isArray(files)) throw new Error(`${label} 必须是数组`);
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
  return files;
}

function validateEvidence(evidence, profile = PROFILE) {
  exactKeys(evidence, ["schema_version", "evidence_type", "subject", "official_release", "derivation", "redistribution", "verification", "official_jdk_files"], "Temurin provenance");
  exactKeys(evidence.subject, ["distribution", "implementor_version", "java_version", "target", "runtime_root", "runtime_manifest", "runtime_lock"], "subject");
  exactKeys(evidence.subject.target, ["platform", "arch"], "subject.target");
  exactKeys(evidence.official_release, ["publisher", "release_page_url", "release_api_url", "release_api_sha256", "tag", "published_at", "artifact", "checksum", "build_metadata", "gpg"], "official_release");
  exactKeys(evidence.official_release.artifact, ["url", "filename", "size_bytes", "sha256", "github_server_digest"], "artifact");
  exactKeys(evidence.official_release.checksum, ["url", "size_bytes", "sha256", "declared_artifact_sha256", "filename_matches"], "checksum");
  exactKeys(evidence.official_release.build_metadata, ["url", "size_bytes", "sha256", "artifact_digest_matches", "vendor", "os", "arch", "binary_type", "version", "scm_ref", "build_ref", "openjdk_source"], "build_metadata");
  exactKeys(evidence.official_release.gpg, ["signature_url", "signature_size_bytes", "signature_sha256", "public_key_url", "public_key_sha256", "verification_status"], "gpg");
  exactKeys(evidence.derivation, ["official_jdk_file_count", "installed_jdk_file_count", "byte_identical_jdk_file_count", "official_jdk_total_bytes", "installed_jdk_total_bytes", "official_jdk_tree_sha256", "installed_jdk_tree_sha256", "module_policy", "requested_modules", "jlink_options", "runtime_file_count", "runtime_total_bytes", "runtime_tree_sha256", "runtime_manifest_sha256", "preserved_official_material_count", "generated_files"], "derivation");
  exactKeys(evidence.redistribution, ["license_summary", "notice_path", "legal_root", "source_release_path", "generated_notice_path", "official_materials_preserved", "human_signoff_required"], "redistribution");
  exactKeys(evidence.verification, ["machine_status", "human_review_status", "observed_at", "limitations"], "verification");

  const subject = evidence.subject;
  const release = evidence.official_release;
  const artifact = release.artifact;
  if (evidence.schema_version !== 1 || evidence.evidence_type !== "oak-jre-provenance" ||
      subject.distribution !== profile.distribution || subject.implementor_version !== profile.implementorVersion ||
      subject.java_version !== profile.javaVersion || subject.target.platform !== profile.targetPlatform ||
      subject.target.arch !== profile.targetArch || subject.runtime_root !== profile.runtimeRoot ||
      subject.runtime_manifest !== profile.runtimeManifest || subject.runtime_lock !== profile.runtimeLock ||
      release.publisher !== "Eclipse Adoptium" || release.release_page_url !== profile.releasePage ||
      release.release_api_url !== profile.releaseApi || release.release_api_sha256 !== profile.releaseApiSha256 ||
      release.tag !== profile.tag || release.published_at !== profile.publishedAt ||
      artifact.url !== ARTIFACT_URL || artifact.filename !== profile.artifactFilename ||
      artifact.size_bytes !== profile.artifactSize || artifact.sha256 !== profile.artifactSha256 ||
      artifact.github_server_digest !== `sha256:${profile.artifactSha256}`) {
    throw new Error("Temurin provenance 官方发行身份不匹配固定策略");
  }
  const checksum = release.checksum;
  const metadata = release.build_metadata;
  const gpg = release.gpg;
  if (checksum.url !== `${ARTIFACT_URL}.sha256.txt` || checksum.size_bytes !== profile.checksumSize ||
      checksum.sha256 !== profile.checksumSha256 || checksum.declared_artifact_sha256 !== profile.artifactSha256 ||
      checksum.filename_matches !== true || metadata.url !== `${ARTIFACT_URL}.json` ||
      metadata.size_bytes !== profile.metadataSize || metadata.sha256 !== profile.metadataSha256 ||
      metadata.artifact_digest_matches !== true || metadata.vendor !== "Eclipse Adoptium" ||
      metadata.os !== "windows" || metadata.arch !== "x64" || metadata.binary_type !== "jdk" ||
      metadata.version !== profile.runtimeVersion || metadata.scm_ref !== "jdk-21.0.11+10_adopt" ||
      metadata.build_ref !== profile.buildRef || metadata.openjdk_source !== profile.openjdkSource ||
      gpg.signature_url !== `${ARTIFACT_URL}.sig` || gpg.signature_size_bytes !== profile.signatureSize ||
      gpg.signature_sha256 !== profile.signatureSha256 || gpg.public_key_url !== profile.publicKeyUrl ||
      gpg.public_key_sha256 !== profile.publicKeySha256 || gpg.verification_status !== "not_verified_no_openpgp_tool") {
    throw new Error("Temurin provenance 校验、构建元数据或 GPG 状态非法");
  }
  validateFileRecords(evidence.official_jdk_files, "official_jdk_files");
  const sourceTree = treeDigest(evidence.official_jdk_files);
  if (sourceTree.file_count !== profile.sourceFileCount || sourceTree.total_bytes !== profile.sourceTotalBytes ||
      sourceTree.sha256 !== profile.sourceTreeSha256) throw new Error("Temurin provenance 官方 JDK 文件树不匹配");
  const d = evidence.derivation;
  if (d.official_jdk_file_count !== profile.sourceFileCount || d.installed_jdk_file_count !== profile.sourceFileCount ||
      d.byte_identical_jdk_file_count !== profile.sourceFileCount || d.official_jdk_total_bytes !== profile.sourceTotalBytes ||
      d.installed_jdk_total_bytes !== profile.sourceTotalBytes || d.official_jdk_tree_sha256 !== profile.sourceTreeSha256 ||
      d.installed_jdk_tree_sha256 !== profile.sourceTreeSha256 || d.module_policy !== "fixed-conservative-java-se" ||
      JSON.stringify(d.requested_modules) !== JSON.stringify(["java.se", "jdk.unsupported", "jdk.xml.dom"]) ||
      JSON.stringify(d.jlink_options) !== JSON.stringify(JLINK_OPTIONS) ||
      d.runtime_file_count !== profile.runtimeFileCount || d.runtime_total_bytes !== profile.runtimeTotalBytes ||
      d.runtime_tree_sha256 !== profile.runtimeTreeSha256 || d.runtime_manifest_sha256 !== profile.runtimeManifestSha256 ||
      d.preserved_official_material_count !== profile.preservedOfficialMaterialCount || JSON.stringify(d.generated_files) !==
        JSON.stringify(["SOURCE_JDK_RELEASE.txt", "THIRD_PARTY_NOTICES.md"])) {
    throw new Error("Temurin provenance jlink 派生事实非法");
  }
  if (evidence.redistribution.license_summary !== "GPLv2 with Classpath Exception; OpenJDK Assembly Exception and bundled third-party notices" ||
      evidence.redistribution.notice_path !== "NOTICE" || evidence.redistribution.legal_root !== "legal/" ||
      evidence.redistribution.source_release_path !== "SOURCE_JDK_RELEASE.txt" ||
      evidence.redistribution.generated_notice_path !== "THIRD_PARTY_NOTICES.md" ||
      evidence.redistribution.official_materials_preserved !== true ||
      evidence.redistribution.human_signoff_required !== true || evidence.verification.machine_status !== "verified" ||
      evidence.verification.human_review_status !== "pending" || !/^\d{4}-\d{2}-\d{2}$/u.test(evidence.verification.observed_at) ||
      !Array.isArray(evidence.verification.limitations) || evidence.verification.limitations.length !== 3) {
    throw new Error("Temurin provenance 再分发或审阅状态被夸大");
  }
  return evidence;
}

function runtimeFacts(root, profile = PROFILE, runtimeRootRelative = profile.runtimeRoot) {
  const runtimeRoot = resolveInside(root, runtimeRootRelative, "JRE 目录");
  ensureSafeDirectoryChain(root, runtimeRoot, { label: "JRE 目录" });
  const runtimeManifestRelative = `${runtimeRootRelative}/manifest.json`;
  const manifestBytes = safeBytes(root, runtimeManifestRelative, "JRE manifest");
  const manifest = parseJsonStrict(manifestBytes.toString("utf8"), "JRE manifest");
  const files = listFiles(runtimeRoot, { exclude: new Set(["manifest.json"]) });
  if (JSON.stringify(files) !== JSON.stringify(manifest.files)) throw new Error("JRE 实际文件树与 manifest 不一致");
  const tree = treeDigest(files);
  if (tree.file_count !== manifest.file_count || tree.total_bytes !== manifest.total_bytes) {
    throw new Error("JRE manifest 汇总与实际文件树不一致");
  }
  return { runtimeRoot, manifestBytes, manifest, files, tree };
}

function buildEvidence(root = PROJECT_ROOT, {
  archive = `out/downloads/provenance/temurin-21.0.11+10/${PROFILE.artifactFilename}`,
  releaseApi = "out/downloads/provenance/temurin-21.0.11+10/github-release.json",
  checksum = `out/downloads/provenance/temurin-21.0.11+10/${PROFILE.artifactFilename}.sha256.txt`,
  metadata = `out/downloads/provenance/temurin-21.0.11+10/${PROFILE.artifactFilename}.json`,
  signature = `out/downloads/provenance/temurin-21.0.11+10/${PROFILE.artifactFilename}.sig`,
  publicKey = "out/downloads/provenance/temurin-21.0.11+10/adoptium-public-key.asc",
  jdkHome = "C:/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot",
  observedAt = "2026-07-28",
  profile = PROFILE,
} = {}) {
  const projectRoot = path.resolve(root);
  const artifactBytes = safeBytes(projectRoot, archive, "Temurin 官方 ZIP");
  const apiBytes = safeBytes(projectRoot, releaseApi, "Temurin GitHub release API");
  const checksumBytes = safeBytes(projectRoot, checksum, "Temurin checksum");
  const metadataBytes = safeBytes(projectRoot, metadata, "Temurin build metadata");
  const signatureBytes = safeBytes(projectRoot, signature, "Temurin detached signature");
  const publicKeyBytes = safeBytes(projectRoot, publicKey, "Adoptium public key");
  for (const [label, bytes, size, digest] of [
    ["ZIP", artifactBytes, profile.artifactSize, profile.artifactSha256],
    ["release API", apiBytes, null, profile.releaseApiSha256],
    ["checksum", checksumBytes, profile.checksumSize, profile.checksumSha256],
    ["build metadata", metadataBytes, profile.metadataSize, profile.metadataSha256],
    ["signature", signatureBytes, profile.signatureSize, profile.signatureSha256],
    ["public key", publicKeyBytes, null, profile.publicKeySha256],
  ]) {
    if ((size !== null && bytes.length !== size) || sha256(bytes) !== digest) throw new Error(`Temurin ${label} 大小或 SHA-256 不匹配`);
  }
  const api = parseJsonStrict(apiBytes.toString("utf8"), "Temurin GitHub release API");
  const assets = new Map((api.assets || []).map((item) => [item.name, item]));
  for (const [filename, size, digest] of [
    [profile.artifactFilename, profile.artifactSize, profile.artifactSha256],
    [`${profile.artifactFilename}.sha256.txt`, profile.checksumSize, profile.checksumSha256],
    [`${profile.artifactFilename}.json`, profile.metadataSize, profile.metadataSha256],
    [`${profile.artifactFilename}.sig`, profile.signatureSize, profile.signatureSha256],
  ]) {
    const asset = assets.get(filename);
    if (!asset || asset.size !== size || asset.digest !== `sha256:${digest}` ||
        asset.browser_download_url !== `${ARTIFACT_URL}${filename === profile.artifactFilename ? "" : filename.slice(profile.artifactFilename.length)}`) {
      throw new Error(`Temurin GitHub release API 未绑定官方制品：${filename}`);
    }
  }
  if (api.tag_name !== profile.tag || api.name !== profile.tag || api.published_at !== profile.publishedAt ||
      api.html_url !== profile.releasePage) throw new Error("Temurin GitHub release API 身份不匹配");
  const checksumMatch = /^([0-9a-f]{64})  ([^\r\n]+)\r?\n?$/u.exec(checksumBytes.toString("utf8"));
  if (!checksumMatch || checksumMatch[1] !== profile.artifactSha256 || checksumMatch[2] !== profile.artifactFilename) {
    throw new Error("Temurin checksum 内容未精确声明固定 ZIP");
  }
  const meta = parseJsonStrict(metadataBytes.toString("utf8"), "Temurin build metadata");
  if (meta.vendor !== "Eclipse Adoptium" || meta.os !== "windows" || meta.arch !== "x64" ||
      meta.variant !== "temurin" || meta.binary_type !== "jdk" || meta.sha256 !== profile.artifactSha256 ||
      meta.version?.version !== profile.runtimeVersion || meta.scmRef !== "jdk-21.0.11+10_adopt") {
    throw new Error("Temurin build metadata 未绑定固定官方 JDK");
  }
  const official = inventoryZipArchive(artifactBytes, profile.officialRoot, "Temurin 官方 ZIP", { maxOutputLength: 256 * 1024 * 1024 });
  const installed = listFiles(path.resolve(jdkHome));
  if (JSON.stringify(official) !== JSON.stringify(installed)) throw new Error("本机 Temurin JDK 不是官方 ZIP 的逐字节副本");
  const sourceTree = treeDigest(official);
  if (sourceTree.file_count !== profile.sourceFileCount || sourceTree.total_bytes !== profile.sourceTotalBytes ||
      sourceTree.sha256 !== profile.sourceTreeSha256) throw new Error("Temurin 官方 ZIP 文件树不匹配固定策略");
  const runtime = runtimeFacts(projectRoot, profile);
  const lock = parseJsonStrict(safeBytes(projectRoot, profile.runtimeLock, "JRE lock").toString("utf8"), "JRE lock");
  if (lock.source_jdk?.tree_file_count !== sourceTree.file_count || lock.source_jdk?.tree_total_bytes !== sourceTree.total_bytes ||
      lock.source_jdk?.tree_sha256 !== sourceTree.sha256 || lock.runtime_manifest_sha256 !== sha256(runtime.manifestBytes)) {
    throw new Error("JRE lock 未绑定官方源 JDK 或生成 runtime manifest");
  }
  const officialByPath = new Map(official.map((item) => [item.path, item]));
  const preserved = runtime.files.filter((item) => item.path === "NOTICE" || item.path.startsWith("legal/"));
  for (const item of preserved) {
    if (JSON.stringify(item) !== JSON.stringify(officialByPath.get(item.path))) throw new Error(`JRE 未原字节保留官方许可材料：${item.path}`);
  }
  const evidence = {
    schema_version: 1,
    evidence_type: "oak-jre-provenance",
    subject: { distribution: profile.distribution, implementor_version: profile.implementorVersion,
      java_version: profile.javaVersion, target: { platform: profile.targetPlatform, arch: profile.targetArch },
      runtime_root: profile.runtimeRoot, runtime_manifest: profile.runtimeManifest, runtime_lock: profile.runtimeLock },
    official_release: {
      publisher: "Eclipse Adoptium", release_page_url: profile.releasePage, release_api_url: profile.releaseApi,
      release_api_sha256: sha256(apiBytes), tag: profile.tag, published_at: profile.publishedAt,
      artifact: { url: ARTIFACT_URL, filename: profile.artifactFilename, size_bytes: artifactBytes.length,
        sha256: sha256(artifactBytes), github_server_digest: assets.get(profile.artifactFilename).digest },
      checksum: { url: `${ARTIFACT_URL}.sha256.txt`, size_bytes: checksumBytes.length, sha256: sha256(checksumBytes),
        declared_artifact_sha256: checksumMatch[1], filename_matches: true },
      build_metadata: { url: `${ARTIFACT_URL}.json`, size_bytes: metadataBytes.length, sha256: sha256(metadataBytes),
        artifact_digest_matches: meta.sha256 === profile.artifactSha256, vendor: meta.vendor, os: meta.os, arch: meta.arch,
        binary_type: meta.binary_type, version: meta.version.version, scm_ref: meta.scmRef,
        build_ref: meta.buildRef, openjdk_source: meta.openjdk_source },
      gpg: { signature_url: `${ARTIFACT_URL}.sig`, signature_size_bytes: signatureBytes.length,
        signature_sha256: sha256(signatureBytes), public_key_url: profile.publicKeyUrl,
        public_key_sha256: sha256(publicKeyBytes), verification_status: "not_verified_no_openpgp_tool" },
    },
    derivation: {
      official_jdk_file_count: official.length, installed_jdk_file_count: installed.length,
      byte_identical_jdk_file_count: official.length, official_jdk_total_bytes: sourceTree.total_bytes,
      installed_jdk_total_bytes: sourceTree.total_bytes, official_jdk_tree_sha256: sourceTree.sha256,
      installed_jdk_tree_sha256: sourceTree.sha256, module_policy: runtime.manifest.module_policy,
      requested_modules: runtime.manifest.requested_modules, jlink_options: runtime.manifest.jlink_options,
      runtime_file_count: runtime.tree.file_count, runtime_total_bytes: runtime.tree.total_bytes,
      runtime_tree_sha256: runtime.tree.sha256, runtime_manifest_sha256: sha256(runtime.manifestBytes),
      preserved_official_material_count: preserved.length,
      generated_files: ["SOURCE_JDK_RELEASE.txt", "THIRD_PARTY_NOTICES.md"],
    },
    redistribution: {
      license_summary: "GPLv2 with Classpath Exception; OpenJDK Assembly Exception and bundled third-party notices",
      notice_path: "NOTICE", legal_root: "legal/", source_release_path: "SOURCE_JDK_RELEASE.txt",
      generated_notice_path: "THIRD_PARTY_NOTICES.md", official_materials_preserved: true,
      human_signoff_required: true,
    },
    verification: {
      machine_status: "verified", human_review_status: "pending", observed_at: observedAt,
      limitations: [
        "The detached signature and Adoptium public key were captured and hashed, but OpenPGP verification was not performed because no verifier is installed.",
        "The official ZIP, installed JDK and generated jlink runtime are byte-bound, but this is not an independent reproducible-build audit of Adoptium's source build.",
        "License, trademark, source-offer and third-party redistribution obligations still require named human sign-off before sale.",
      ],
    },
    official_jdk_files: official,
  };
  return validateEvidence(evidence, profile);
}

function verifyEvidenceAgainstRuntime(root = PROJECT_ROOT, { profile = PROFILE, runtimeRoot = profile.runtimeRoot } = {}) {
  const projectRoot = path.resolve(root);
  const bytes = safeBytes(projectRoot, profile.evidence, "Temurin provenance evidence");
  const evidence = validateEvidence(parseJsonStrict(bytes.toString("utf8"), "Temurin provenance evidence"), profile);
  if (!bytes.equals(canonicalJson(evidence))) throw new Error("Temurin provenance evidence 不是 canonical UTF-8/LF JSON");
  const runtime = runtimeFacts(projectRoot, profile, runtimeRoot);
  const d = evidence.derivation;
  if (sha256(runtime.manifestBytes) !== d.runtime_manifest_sha256 || runtime.tree.file_count !== d.runtime_file_count ||
      runtime.tree.total_bytes !== d.runtime_total_bytes || runtime.tree.sha256 !== d.runtime_tree_sha256) {
    throw new Error("Temurin provenance 与实际 jlink runtime 不一致");
  }
  const lock = parseJsonStrict(safeBytes(projectRoot, profile.runtimeLock, "JRE lock").toString("utf8"), "JRE lock");
  const reference = lock.provenance_evidence;
  const official = new Map(evidence.official_jdk_files.map((item) => [item.path, item]));
  if (reference?.path !== profile.evidence || reference?.sha256 !== sha256(bytes) ||
      reference?.machine_status !== "verified" || reference?.human_review_status !== "pending" ||
      lock.source_jdk?.tree_file_count !== PROFILE.sourceFileCount ||
      lock.source_jdk?.tree_total_bytes !== PROFILE.sourceTotalBytes ||
      lock.source_jdk?.tree_sha256 !== PROFILE.sourceTreeSha256 ||
      lock.runtime_manifest_sha256 !== d.runtime_manifest_sha256 ||
      lock.source_jdk?.release_sha256 !== official.get("release")?.sha256 ||
      lock.source_jdk?.java_sha256 !== official.get("bin/java.exe")?.sha256 ||
      lock.source_jdk?.jdeps_sha256 !== official.get("bin/jdeps.exe")?.sha256 ||
      lock.source_jdk?.jlink_sha256 !== official.get("bin/jlink.exe")?.sha256) {
    throw new Error("JRE lock 未精确绑定 Temurin provenance evidence");
  }
  return { evidence, evidence_path: profile.evidence, evidence_sha256: sha256(bytes),
    machine_status: "verified", human_review_status: "pending" };
}

function writeEvidence(root = PROJECT_ROOT, options = {}) {
  const projectRoot = path.resolve(root);
  const profile = options.profile || PROFILE;
  const evidence = buildEvidence(projectRoot, options);
  const target = resolveInside(projectRoot, profile.evidence, "Temurin provenance evidence");
  return atomicReplaceTrackedFile({ root: projectRoot, target, bytes: canonicalJson(evidence),
    verify: () => {
      const bytes = safeBytes(projectRoot, profile.evidence, "Temurin provenance evidence");
      const parsed = validateEvidence(parseJsonStrict(bytes.toString("utf8"), "Temurin provenance evidence"), profile);
      if (!bytes.equals(canonicalJson(parsed))) throw new Error("Temurin provenance evidence 不是 canonical UTF-8/LF JSON");
      return { evidence: parsed, evidence_path: profile.evidence, evidence_sha256: sha256(bytes) };
    } }).verification;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some((item) => item !== "--update-evidence")) throw new Error(`未知参数：${args.join(", ")}`);
    const result = args.includes("--update-evidence") ? writeEvidence() : verifyEvidenceAgainstRuntime();
    process.stdout.write(`${JSON.stringify({ ok: true, evidence_path: result.evidence_path,
      evidence_sha256: result.evidence_sha256, official_jdk_file_count: result.evidence.derivation.official_jdk_file_count,
      byte_identical_jdk_file_count: result.evidence.derivation.byte_identical_jdk_file_count,
      runtime_file_count: result.evidence.derivation.runtime_file_count,
      machine_status: result.evidence.verification.machine_status,
      human_review_status: result.evidence.verification.human_review_status }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { PROFILE, buildEvidence, treeDigest, validateEvidence, verifyEvidenceAgainstRuntime, writeEvidence };
