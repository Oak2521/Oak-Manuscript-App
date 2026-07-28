"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { compareUtf16 } = require("./deterministic_compare");
const { inventory } = require("./python_runtime_manifest");
const { atomicReplaceTrackedFile, readSafeRegularFile } = require("./safe_tracked_file");
const { parseJsonStrict } = require("./strict_json");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SCHEMA_VERSION = 1;
const EVIDENCE_TYPE = "oak-runtime-provenance";
const HASH_RE = /^[0-9a-f]{64}$/u;
const CPYTHON_PROFILE = Object.freeze({
  distribution: "CPython",
  version: "3.13.14",
  platform: "win32",
  arch: "x64",
  runtimeRelative: "python-runtime",
  runtimeManifestRelative: "config/tool-manifests/python-runtime-win32-x64.json",
  evidenceRelative: "config/provenance/cpython-3.13.14-win32-x64.json",
  publisher: "Python Software Foundation",
  releasePageUrl: "https://www.python.org/downloads/release/python-31314/",
  artifactUrl: "https://www.python.org/ftp/python/3.13.14/python-3.13.14-embed-amd64.zip",
  artifactFilename: "python-3.13.14-embed-amd64.zip",
  artifactSizeBytes: 10_964_839,
  artifactSha256: "90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907",
  sigstoreUrl: "https://www.python.org/ftp/python/3.13.14/python-3.13.14-embed-amd64.zip.sigstore",
  spdxUrl: "https://www.python.org/ftp/python/3.13.14/python-3.13.14-embed-amd64.zip.spdx.json",
  gpgUrl: "https://www.python.org/ftp/python/3.13.14/python-3.13.14-embed-amd64.zip.asc",
  licenseId: "PSF-2.0",
  licensePath: "LICENSE.txt",
  officialFileCount: 34,
  controlledPath: "python313._pth",
  appendedBytes: Buffer.from("..\\python\r\n", "utf8"),
  signerIdentity: "email:thomas@python.org",
});

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

function assertSafeRelative(value, label) {
  if (typeof value !== "string" || value === "" || value.includes("\\") || path.posix.isAbsolute(value) ||
      path.posix.normalize(value) !== value || value === "." || value.startsWith("../")) {
    throw new Error(`${label} 不是安全的 POSIX 相对路径：${String(value)}`);
  }
  return value;
}

function resolveInside(root, relative, label) {
  const projectRoot = path.resolve(root);
  const safe = assertSafeRelative(relative, label);
  const target = path.resolve(projectRoot, ...safe.split("/"));
  const rel = path.relative(projectRoot, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${label} 逃逸项目目录：${target}`);
  return target;
}

function safeBytes(root, target, label) {
  const record = readSafeRegularFile(path.resolve(root), path.resolve(target), label);
  if (record.stat.nlink !== 1n || record.stat.size <= 0n) throw new Error(`${label} 必须是非空单链接普通文件`);
  return record.bytes;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function hashRecord(root, target, label) {
  const bytes = safeBytes(root, target, label);
  return { bytes, size_bytes: bytes.length, sha256: sha256(bytes) };
}

function verifySigstoreBundle(bundleBytes, artifactBytes, profile = CPYTHON_PROFILE) {
  const bundle = parseJsonStrict(bundleBytes.toString("utf8"), "CPython Sigstore bundle");
  if (bundle.mediaType !== "application/vnd.dev.sigstore.bundle.v0.3+json") {
    throw new Error("CPython Sigstore bundle mediaType 不匹配");
  }
  const digest = Buffer.from(bundle.messageSignature?.messageDigest?.digest || "", "base64");
  const signature = Buffer.from(bundle.messageSignature?.signature || "", "base64");
  const certificateBytes = Buffer.from(bundle.verificationMaterial?.certificate?.rawBytes || "", "base64");
  if (bundle.messageSignature?.messageDigest?.algorithm !== "SHA2_256" ||
      !digest.equals(crypto.createHash("sha256").update(artifactBytes).digest())) {
    throw new Error("CPython Sigstore bundle 的制品摘要不匹配");
  }
  let certificate;
  try {
    certificate = new crypto.X509Certificate(certificateBytes);
  } catch (error) {
    throw new Error(`CPython Sigstore 证书无法解析：${error.message}`);
  }
  if (!crypto.verify("sha256", artifactBytes, certificate.publicKey, signature)) {
    throw new Error("CPython Sigstore 叶证书签名验证失败");
  }
  if (certificate.subjectAltName !== profile.signerIdentity || !certificate.issuer.includes("sigstore.dev")) {
    throw new Error("CPython Sigstore 签名身份或签发者不匹配固定发行证据");
  }
  const tlog = bundle.verificationMaterial?.tlogEntries;
  if (!Array.isArray(tlog) || tlog.length !== 1 || tlog[0]?.kindVersion?.kind !== "hashedrekord") {
    throw new Error("CPython Sigstore bundle 缺少唯一 hashedrekord 透明日志记录");
  }
  const body = parseJsonStrict(Buffer.from(tlog[0].canonicalizedBody || "", "base64").toString("utf8"), "Sigstore Rekor body");
  if (body.spec?.data?.hash?.algorithm !== "sha256" || body.spec?.data?.hash?.value !== profile.artifactSha256) {
    throw new Error("CPython Sigstore Rekor 记录未绑定固定制品摘要");
  }
  const entryIndex = String(tlog[0].logIndex);
  const proofIndex = String(tlog[0].inclusionProof?.logIndex ?? "");
  if (!/^\d+$/u.test(entryIndex) || !/^\d+$/u.test(proofIndex)) {
    throw new Error("CPython Sigstore 透明日志索引缺失或非法");
  }
  return {
    media_type: bundle.mediaType,
    artifact_digest_matches: true,
    leaf_signature_verified: true,
    certificate_issuer: certificate.issuer.replace(/\n/gu, ", "),
    certificate_identity: certificate.subjectAltName,
    certificate_valid_from: new Date(certificate.validFrom).toISOString(),
    certificate_valid_to: new Date(certificate.validTo).toISOString(),
    transparency_log_kind: "hashedrekord",
    transparency_log_entry_index: entryIndex,
    transparency_log_proof_index: proofIndex,
    transparency_log_index_consistent: entryIndex === proofIndex,
    full_sigstore_trust_chain_verified: false,
  };
}

function verifySpdx(spdxBytes, profile = CPYTHON_PROFILE) {
  const document = parseJsonStrict(spdxBytes.toString("utf8"), "CPython SPDX SBOM");
  const packages = Array.isArray(document.packages) ? document.packages : [];
  const subject = packages.find((item) => item?.name === profile.distribution && item?.versionInfo === profile.version);
  const checksum = subject?.checksums?.find((item) => item?.algorithm === "SHA256")?.checksumValue;
  if (document.spdxVersion !== "SPDX-2.3" || document.dataLicense !== "CC0-1.0" || !subject ||
      subject.downloadLocation !== profile.artifactUrl || subject.packageFileName !== profile.artifactFilename ||
      subject.supplier !== `Organization: ${profile.publisher}` || subject.licenseConcluded !== profile.licenseId ||
      checksum !== profile.artifactSha256) {
    throw new Error("CPython 官方 SPDX 未精确绑定发行物、供应方、许可证与 SHA-256");
  }
  return {
    format: "SPDX-2.3",
    document_name: document.name,
    artifact_digest_matches: true,
    supplier: subject.supplier,
    license_concluded: subject.licenseConcluded,
  };
}

function compareInventories(officialFiles, localFiles, officialRoot, localRoot, profile = CPYTHON_PROFILE) {
  if (officialFiles.length !== profile.officialFileCount || localFiles.length !== profile.officialFileCount) {
    throw new Error(`CPython 官方/本地文件数必须都为 ${profile.officialFileCount}`);
  }
  const official = new Map(officialFiles.map((item) => [item.path, item]));
  const local = new Map(localFiles.map((item) => [item.path, item]));
  const names = [...new Set([...official.keys(), ...local.keys()])].sort(compareUtf16);
  const differences = [];
  for (const name of names) {
    const source = official.get(name);
    const target = local.get(name);
    if (!source || !target) throw new Error(`CPython 官方/本地文件集合不一致：${name}`);
    if (source.size_bytes !== target.size_bytes || source.sha256 !== target.sha256) differences.push({ source, target });
  }
  if (differences.length !== 1 || differences[0].source.path !== profile.controlledPath) {
    throw new Error(`CPython 只允许 ${profile.controlledPath} 存在一个受控差异`);
  }
  const projectRoot = path.resolve(localRoot, "..");
  const officialBytes = safeBytes(projectRoot, path.join(officialRoot, profile.controlledPath), "CPython 官方受控路径文件");
  const localBytes = safeBytes(projectRoot, path.join(localRoot, profile.controlledPath), "CPython 本地受控路径文件");
  if (localBytes.length !== officialBytes.length + profile.appendedBytes.length ||
      !localBytes.subarray(0, officialBytes.length).equals(officialBytes) ||
      !localBytes.subarray(officialBytes.length).equals(profile.appendedBytes)) {
    throw new Error(`CPython ${profile.controlledPath} 不是对官方字节的唯一固定追加`);
  }
  return {
    official_file_count: officialFiles.length,
    local_file_count: localFiles.length,
    byte_identical_file_count: officialFiles.length - 1,
    controlled_modifications: [{
      path: profile.controlledPath,
      operation: "append_exact_bytes",
      official_size_bytes: differences[0].source.size_bytes,
      official_sha256: differences[0].source.sha256,
      local_size_bytes: differences[0].target.size_bytes,
      local_sha256: differences[0].target.sha256,
      appended_utf8: profile.appendedBytes.toString("utf8"),
      purpose: "Expose the packaged Oak Manuscript Python core while preserving isolated mode and keeping site disabled.",
    }],
  };
}

function validateEvidence(evidence, profile = CPYTHON_PROFILE) {
  exactKeys(evidence, ["schema_version", "evidence_type", "subject", "official_release", "derivation", "redistribution", "verification", "official_files"], "runtime provenance");
  exactKeys(evidence.subject, ["distribution", "version", "target", "runtime_root", "runtime_manifest"], "runtime provenance.subject");
  exactKeys(evidence.subject.target, ["platform", "arch"], "runtime provenance.subject.target");
  exactKeys(evidence.official_release, ["publisher", "release_page_url", "artifact", "sigstore", "spdx", "gpg"], "runtime provenance.official_release");
  exactKeys(evidence.official_release.artifact, ["url", "filename", "size_bytes", "sha256"], "runtime provenance artifact");
  exactKeys(evidence.official_release.sigstore, ["url", "bundle_sha256", "media_type", "artifact_digest_matches", "leaf_signature_verified", "certificate_issuer", "certificate_identity", "certificate_valid_from", "certificate_valid_to", "transparency_log_kind", "transparency_log_entry_index", "transparency_log_proof_index", "transparency_log_index_consistent", "full_sigstore_trust_chain_verified"], "runtime provenance sigstore");
  exactKeys(evidence.official_release.spdx, ["url", "document_sha256", "format", "document_name", "artifact_digest_matches", "supplier", "license_concluded"], "runtime provenance spdx");
  exactKeys(evidence.official_release.gpg, ["url", "signature_sha256", "verification_status"], "runtime provenance gpg");
  exactKeys(evidence.derivation, ["official_file_count", "local_file_count", "byte_identical_file_count", "controlled_modifications"], "runtime provenance.derivation");
  exactKeys(evidence.redistribution, ["license_id", "license_path", "official_license_sha256", "local_license_sha256", "license_preserved", "modification_disclosed"], "runtime provenance.redistribution");
  exactKeys(evidence.verification, ["machine_status", "human_review_status", "observed_at", "limitations"], "runtime provenance.verification");
  const artifact = evidence.official_release.artifact;
  if (evidence.schema_version !== SCHEMA_VERSION || evidence.evidence_type !== EVIDENCE_TYPE ||
      evidence.subject.distribution !== profile.distribution || evidence.subject.version !== profile.version ||
      evidence.subject.target.platform !== profile.platform || evidence.subject.target.arch !== profile.arch ||
      evidence.subject.runtime_root !== profile.runtimeRelative || evidence.subject.runtime_manifest !== profile.runtimeManifestRelative ||
      evidence.official_release.publisher !== profile.publisher || evidence.official_release.release_page_url !== profile.releasePageUrl ||
      artifact.url !== profile.artifactUrl || artifact.filename !== profile.artifactFilename ||
      artifact.size_bytes !== profile.artifactSizeBytes || artifact.sha256 !== profile.artifactSha256) {
    throw new Error("CPython provenance 的 subject 或官方发行物身份不匹配固定策略");
  }
  const sigstore = evidence.official_release.sigstore;
  const spdx = evidence.official_release.spdx;
  const gpg = evidence.official_release.gpg;
  if (sigstore.url !== profile.sigstoreUrl || !HASH_RE.test(sigstore.bundle_sha256) ||
      sigstore.media_type !== "application/vnd.dev.sigstore.bundle.v0.3+json" ||
      sigstore.artifact_digest_matches !== true || sigstore.leaf_signature_verified !== true ||
      sigstore.certificate_identity !== profile.signerIdentity || sigstore.transparency_log_kind !== "hashedrekord" ||
      !/^\d+$/u.test(sigstore.transparency_log_entry_index) ||
      !/^\d+$/u.test(sigstore.transparency_log_proof_index) ||
      sigstore.transparency_log_index_consistent !== false ||
      sigstore.full_sigstore_trust_chain_verified !== false ||
      spdx.url !== profile.spdxUrl || !HASH_RE.test(spdx.document_sha256) || spdx.format !== "SPDX-2.3" ||
      spdx.artifact_digest_matches !== true || spdx.supplier !== `Organization: ${profile.publisher}` ||
      spdx.license_concluded !== profile.licenseId || gpg.url !== profile.gpgUrl ||
      !HASH_RE.test(gpg.signature_sha256) || gpg.verification_status !== "downloaded_not_cryptographically_verified") {
    throw new Error("CPython provenance 的官方签名/SBOM 元数据不完整或被夸大");
  }
  if (!Array.isArray(evidence.official_files) || evidence.official_files.length !== profile.officialFileCount) {
    throw new Error("CPython provenance 的官方文件清单数量不匹配");
  }
  let previous = null;
  for (const [index, item] of evidence.official_files.entries()) {
    exactKeys(item, ["path", "size_bytes", "sha256"], `runtime provenance.official_files[${index}]`);
    assertSafeRelative(item.path, `runtime provenance.official_files[${index}].path`);
    if ((previous !== null && compareUtf16(previous, item.path) >= 0) || !Number.isSafeInteger(item.size_bytes) ||
        item.size_bytes <= 0 || !HASH_RE.test(item.sha256)) throw new Error("CPython provenance 官方文件清单非法、重复或未排序");
    previous = item.path;
  }
  if (!Array.isArray(evidence.derivation.controlled_modifications) || evidence.derivation.controlled_modifications.length !== 1) {
    throw new Error("CPython provenance 必须恰有一个受控修改");
  }
  const modification = evidence.derivation.controlled_modifications[0];
  exactKeys(modification, ["path", "operation", "official_size_bytes", "official_sha256", "local_size_bytes", "local_sha256", "appended_utf8", "purpose"], "runtime provenance controlled modification");
  if (evidence.derivation.official_file_count !== profile.officialFileCount ||
      evidence.derivation.local_file_count !== profile.officialFileCount ||
      evidence.derivation.byte_identical_file_count !== profile.officialFileCount - 1 ||
      modification.path !== profile.controlledPath || modification.operation !== "append_exact_bytes" ||
      modification.appended_utf8 !== profile.appendedBytes.toString("utf8") ||
      !HASH_RE.test(modification.official_sha256) || !HASH_RE.test(modification.local_sha256)) {
    throw new Error("CPython provenance 的受控派生事实不匹配固定策略");
  }
  if (evidence.redistribution.license_id !== profile.licenseId ||
      evidence.redistribution.license_path !== profile.licensePath ||
      evidence.redistribution.official_license_sha256 !== evidence.redistribution.local_license_sha256 ||
      !HASH_RE.test(evidence.redistribution.local_license_sha256) || evidence.redistribution.license_preserved !== true ||
      evidence.redistribution.modification_disclosed !== true || evidence.verification.machine_status !== "verified" ||
      evidence.verification.human_review_status !== "pending" || !/^\d{4}-\d{2}-\d{2}$/u.test(evidence.verification.observed_at) ||
      !Array.isArray(evidence.verification.limitations) || evidence.verification.limitations.length !== 4) {
    throw new Error("CPython provenance 的再分发或审阅状态非法");
  }
  return evidence;
}

function buildEvidence(root = PROJECT_ROOT, {
  profile = CPYTHON_PROFILE,
  officialRootRelative = "out/provenance/python-3.13.14/official-extracted",
  archiveRelative = "out/downloads/provenance/python-3.13.14/python-3.13.14-embed-amd64.zip",
  sigstoreRelative = "out/downloads/provenance/python-3.13.14/python-3.13.14-embed-amd64.zip.sigstore",
  spdxRelative = "out/downloads/provenance/python-3.13.14/python-3.13.14-embed-amd64.zip.spdx.json",
  gpgRelative = "out/downloads/provenance/python-3.13.14/python-3.13.14-embed-amd64.zip.asc",
  observedAt = "2026-07-28",
  sigstoreVerifier = verifySigstoreBundle,
  spdxVerifier = verifySpdx,
} = {}) {
  const projectRoot = path.resolve(root);
  const officialRoot = resolveInside(projectRoot, officialRootRelative, "CPython 官方解压目录");
  const localRoot = resolveInside(projectRoot, profile.runtimeRelative, "CPython 本地运行时目录");
  for (const [label, directory] of [["官方解压目录", officialRoot], ["本地运行时目录", localRoot]]) {
    const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`CPython ${label} 缺失或不安全`);
  }
  const archive = hashRecord(projectRoot, resolveInside(projectRoot, archiveRelative, "CPython 官方 ZIP"), "CPython 官方 ZIP");
  if (archive.size_bytes !== profile.artifactSizeBytes || archive.sha256 !== profile.artifactSha256) {
    throw new Error("CPython 官方 ZIP 大小或 SHA-256 与 python.org 固定值不一致");
  }
  const sigstore = hashRecord(projectRoot, resolveInside(projectRoot, sigstoreRelative, "CPython Sigstore"), "CPython Sigstore");
  const spdx = hashRecord(projectRoot, resolveInside(projectRoot, spdxRelative, "CPython SPDX"), "CPython SPDX");
  const gpg = hashRecord(projectRoot, resolveInside(projectRoot, gpgRelative, "CPython GPG"), "CPython GPG");
  const signatureFacts = sigstoreVerifier(sigstore.bytes, archive.bytes, profile);
  const spdxFacts = spdxVerifier(spdx.bytes, profile);
  const officialFiles = inventory(officialRoot, "CPython 官方解压目录");
  const localFiles = inventory(localRoot, "CPython 本地运行时目录");
  const derivation = compareInventories(officialFiles, localFiles, officialRoot, localRoot, profile);
  const officialLicense = officialFiles.find((item) => item.path === profile.licensePath);
  const localLicense = localFiles.find((item) => item.path === profile.licensePath);
  if (!officialLicense || !localLicense || officialLicense.sha256 !== localLicense.sha256) {
    throw new Error("CPython LICENSE.txt 未从官方发行物逐字节保留");
  }
  const evidence = {
    schema_version: SCHEMA_VERSION,
    evidence_type: EVIDENCE_TYPE,
    subject: {
      distribution: profile.distribution,
      version: profile.version,
      target: { platform: profile.platform, arch: profile.arch },
      runtime_root: profile.runtimeRelative,
      runtime_manifest: profile.runtimeManifestRelative,
    },
    official_release: {
      publisher: profile.publisher,
      release_page_url: profile.releasePageUrl,
      artifact: { url: profile.artifactUrl, filename: profile.artifactFilename, size_bytes: archive.size_bytes, sha256: archive.sha256 },
      sigstore: { url: profile.sigstoreUrl, bundle_sha256: sigstore.sha256, ...signatureFacts },
      spdx: { url: profile.spdxUrl, document_sha256: spdx.sha256, ...spdxFacts },
      gpg: { url: profile.gpgUrl, signature_sha256: gpg.sha256, verification_status: "downloaded_not_cryptographically_verified" },
    },
    derivation,
    redistribution: {
      license_id: profile.licenseId,
      license_path: profile.licensePath,
      official_license_sha256: officialLicense.sha256,
      local_license_sha256: localLicense.sha256,
      license_preserved: true,
      modification_disclosed: true,
    },
    verification: {
      machine_status: "verified",
      human_review_status: "pending",
      observed_at: observedAt,
      limitations: [
        "The Sigstore leaf signature and embedded artifact digest were verified, but the complete Fulcio/Rekor trust chain was not independently replayed.",
        "The official Sigstore bundle's tlog entry logIndex differs from its inclusion-proof logIndex; both values are preserved and the inconsistency requires human review.",
        "The detached GPG signature was downloaded but not cryptographically verified.",
        "Legal redistribution obligations still require named human sign-off before sale.",
      ],
    },
    official_files: officialFiles,
  };
  validateEvidence(evidence, profile);
  return evidence;
}

function verifyEvidenceAgainstRuntime(root = PROJECT_ROOT, {
  profile = CPYTHON_PROFILE,
  evidenceRelative = profile.evidenceRelative,
} = {}) {
  const projectRoot = path.resolve(root);
  const target = resolveInside(projectRoot, evidenceRelative, "CPython provenance evidence");
  const bytes = safeBytes(projectRoot, target, "CPython provenance evidence");
  const evidence = validateEvidence(parseJsonStrict(bytes.toString("utf8"), "CPython provenance evidence"), profile);
  if (!bytes.equals(canonicalJson(evidence))) throw new Error("CPython provenance evidence 不是 canonical UTF-8/LF JSON");
  const localRoot = resolveInside(projectRoot, profile.runtimeRelative, "CPython 本地运行时目录");
  const localFiles = inventory(localRoot, "CPython 本地运行时目录");
  const local = new Map(localFiles.map((item) => [item.path, item]));
  const modification = evidence.derivation.controlled_modifications[0];
  for (const official of evidence.official_files) {
    const actual = local.get(official.path);
    if (!actual) throw new Error(`CPython 本地运行时缺少官方文件：${official.path}`);
    if (official.path === modification.path) {
      const localBytes = safeBytes(projectRoot, path.join(localRoot, modification.path), "CPython 本地受控路径文件");
      const officialLength = localBytes.length - profile.appendedBytes.length;
      if (officialLength !== modification.official_size_bytes ||
          localBytes.length !== modification.local_size_bytes ||
          !localBytes.subarray(officialLength).equals(profile.appendedBytes) ||
          sha256(localBytes.subarray(0, officialLength)) !== modification.official_sha256 ||
          actual.sha256 !== modification.local_sha256 || actual.size_bytes !== modification.local_size_bytes) {
        throw new Error("CPython 受控 python313._pth 派生验证失败");
      }
    } else if (actual.sha256 !== official.sha256 || actual.size_bytes !== official.size_bytes) {
      throw new Error(`CPython 本地文件不再匹配官方发行物：${official.path}`);
    }
  }
  if (localFiles.length !== evidence.derivation.local_file_count) throw new Error("CPython 本地运行时文件数漂移");
  return {
    evidence,
    evidence_path: evidenceRelative,
    evidence_sha256: sha256(bytes),
    machine_status: evidence.verification.machine_status,
    human_review_status: evidence.verification.human_review_status,
  };
}

function writeEvidence(root = PROJECT_ROOT, options = {}) {
  const projectRoot = path.resolve(root);
  const evidence = buildEvidence(projectRoot, options);
  const target = resolveInside(projectRoot, (options.profile || CPYTHON_PROFILE).evidenceRelative, "CPython provenance evidence");
  const profile = options.profile || CPYTHON_PROFILE;
  const transaction = atomicReplaceTrackedFile({
    root: projectRoot,
    target,
    bytes: canonicalJson(evidence),
    verify: () => verifyEvidenceAgainstRuntime(projectRoot, { profile }),
  });
  return transaction.verification;
}

function parseArgs(argv) {
  const options = {};
  let updateEvidence = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--update-evidence") updateEvidence = true;
    else if (arg === "--official-root") options.officialRootRelative = argv[++index];
    else if (arg === "--archive") options.archiveRelative = argv[++index];
    else if (arg === "--sigstore") options.sigstoreRelative = argv[++index];
    else if (arg === "--spdx") options.spdxRelative = argv[++index];
    else if (arg === "--gpg") options.gpgRelative = argv[++index];
    else if (arg === "--observed-at") options.observedAt = argv[++index];
    else throw new Error(`未知参数：${arg}`);
  }
  return { updateEvidence, options };
}

if (require.main === module) {
  try {
    const { updateEvidence, options } = parseArgs(process.argv.slice(2));
    const result = updateEvidence ? writeEvidence(PROJECT_ROOT, options) : verifyEvidenceAgainstRuntime(PROJECT_ROOT);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      evidence_path: result.evidence_path,
      evidence_sha256: result.evidence_sha256,
      distribution: result.evidence.subject.distribution,
      version: result.evidence.subject.version,
      platform: result.evidence.subject.target.platform,
      arch: result.evidence.subject.target.arch,
      official_file_count: result.evidence.derivation.official_file_count,
      byte_identical_file_count: result.evidence.derivation.byte_identical_file_count,
      controlled_modifications: result.evidence.derivation.controlled_modifications.length,
      machine_status: result.machine_status,
      human_review_status: result.human_review_status,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CPYTHON_PROFILE,
  EVIDENCE_TYPE,
  SCHEMA_VERSION,
  buildEvidence,
  canonicalJson,
  compareInventories,
  parseArgs,
  validateEvidence,
  verifyEvidenceAgainstRuntime,
  verifySigstoreBundle,
  verifySpdx,
  writeEvidence,
};
