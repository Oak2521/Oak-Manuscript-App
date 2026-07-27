"use strict";

// EpubCheck itself is code executed against untrusted manuscripts.  Its JAR
// and complete lib/ closure therefore use a repository-tracked hash manifest;
// merely checking that epubcheck.jar exists is not an integrity gate.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { compareUtf16 } = require("./deterministic_compare");

const REPO_ROOT = path.resolve(__dirname, "..");
const EPUBCHECK_VERSION = "5.3.0";
const SCHEMA_VERSION = "1.0";
const DISTRIBUTION_RELATIVE = `tools/epubcheck-${EPUBCHECK_VERSION}`;
const MANIFEST_RELATIVE = `config/tool-manifests/epubcheck-${EPUBCHECK_VERSION}.json`;
const REQUIRED_FILES = Object.freeze([
  "CHANGELOG.txt",
  "LICENSE.txt",
  "README.txt",
  "THIRD-PARTY.txt",
  "epubcheck.jar",
  "licenses/Apache-2.0.txt",
  "licenses/BSD-3-Clause.txt",
  "licenses/MIT.txt",
  "licenses/MPL-2.0.txt",
  "licenses/W3C.txt",
]);

function sha256File(target) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(target, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function safeRelative(value, label) {
  if (typeof value !== "string" || value === "" || value.includes("\\") ||
      path.posix.isAbsolute(value) || path.posix.normalize(value) !== value ||
      value === "." || value.startsWith("../")) {
    throw new Error(`${label} 不是安全的相对 POSIX 路径：${String(value)}`);
  }
  return value;
}

function inventory(root, label = "EpubCheck 分发目录") {
  const result = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf16(left.name, right.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error(`${label} 不得含符号链接：${relative}`);
      if (stat.isDirectory()) visit(target);
      else if (stat.isFile()) {
        if (stat.size <= 0) throw new Error(`${label} 含空文件：${relative}`);
        result.push({
          path: relative,
          size_bytes: stat.size,
          sha256: sha256File(target),
        });
      } else {
        throw new Error(`${label} 含不支持的文件类型：${relative}`);
      }
    }
  }
  visit(root);
  return result.sort((left, right) => compareUtf16(left.path, right.path));
}

function resolveProjectPath(root, relative, label) {
  const projectRoot = path.resolve(root);
  const target = path.resolve(projectRoot, ...safeRelative(relative, label).split("/"));
  const rel = path.relative(projectRoot, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`${label} 逃逸项目目录：${target}`);
  }
  return target;
}

function buildManifest(root = REPO_ROOT) {
  const projectRoot = path.resolve(root);
  const distribution = resolveProjectPath(
    projectRoot,
    DISTRIBUTION_RELATIVE,
    "EpubCheck distribution",
  );
  const stat = fs.lstatSync(distribution, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`EpubCheck 分发目录缺失或不安全：${distribution}`);
  }
  const files = inventory(distribution);
  const byPath = new Set(files.map((item) => item.path));
  for (const relative of REQUIRED_FILES) {
    if (!byPath.has(relative)) throw new Error(`EpubCheck 分发缺少必需文件：${relative}`);
  }
  if (!files.some((item) => item.path.startsWith("lib/") && item.path.endsWith(".jar"))) {
    throw new Error("EpubCheck 分发的 lib/ 中没有 JAR 依赖");
  }
  return {
    schema_version: SCHEMA_VERSION,
    tool: { name: "EpubCheck", version: EPUBCHECK_VERSION },
    distribution: DISTRIBUTION_RELATIVE,
    entry: "epubcheck.jar",
    required_files: [...REQUIRED_FILES],
    license_files: files
      .map((item) => item.path)
      .filter((item) => item === "LICENSE.txt" || item === "THIRD-PARTY.txt" ||
        item.startsWith("licenses/")),
    formal_provenance_audit_required: true,
    provenance_note: "Locally supplied distribution; origin and redistribution evidence require formal audit before sale.",
    file_count: files.length,
    total_bytes: files.reduce((sum, item) => sum + item.size_bytes, 0),
    files,
  };
}

function verifyDistribution(root = REPO_ROOT) {
  const projectRoot = path.resolve(root);
  const manifestTarget = resolveProjectPath(projectRoot, MANIFEST_RELATIVE, "EpubCheck manifest");
  const manifestStat = fs.lstatSync(manifestTarget, { throwIfNoEntry: false });
  if (!manifestStat || !manifestStat.isFile() || manifestStat.isSymbolicLink() ||
      manifestStat.size <= 0) {
    throw new Error(`EpubCheck 固定清单缺失或不安全：${manifestTarget}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestTarget, "utf8"));
  } catch (error) {
    throw new Error(`EpubCheck 固定清单无法解析：${error.message}`);
  }
  if (manifest.schema_version !== SCHEMA_VERSION || manifest.tool?.name !== "EpubCheck" ||
      manifest.tool?.version !== EPUBCHECK_VERSION ||
      manifest.distribution !== DISTRIBUTION_RELATIVE || manifest.entry !== "epubcheck.jar" ||
      manifest.formal_provenance_audit_required !== true) {
    throw new Error("EpubCheck 固定清单的 schema、工具版本、目录、入口或审计状态不匹配");
  }
  const distribution = resolveProjectPath(projectRoot, manifest.distribution, "EpubCheck distribution");
  const distributionStat = fs.lstatSync(distribution, { throwIfNoEntry: false });
  if (!distributionStat || !distributionStat.isDirectory() || distributionStat.isSymbolicLink()) {
    throw new Error(`EpubCheck 分发目录缺失或不安全：${distribution}`);
  }
  const actual = inventory(distribution);
  const actualByPath = new Map(actual.map((item) => [item.path, item]));
  const listedByPath = new Map();
  if (!Array.isArray(manifest.files)) throw new Error("EpubCheck 固定清单 files 必须是数组");
  for (const [index, item] of manifest.files.entries()) {
    const relative = safeRelative(item?.path, `manifest.files[${index}].path`);
    if (listedByPath.has(relative) || !Number.isSafeInteger(item.size_bytes) ||
        item.size_bytes <= 0 || typeof item.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(item.sha256)) {
      throw new Error(`EpubCheck 固定清单文件记录非法或重复：${relative}`);
    }
    listedByPath.set(relative, item);
  }
  for (const item of actual) {
    const listed = listedByPath.get(item.path);
    if (!listed) throw new Error(`EpubCheck 固定清单漏列实际文件：${item.path}`);
    if (listed.size_bytes !== item.size_bytes || listed.sha256 !== item.sha256) {
      throw new Error(`EpubCheck 文件 SHA-256 或大小与固定清单不一致：${item.path}`);
    }
  }
  for (const relative of listedByPath.keys()) {
    if (!actualByPath.has(relative)) throw new Error(`EpubCheck 固定清单列出不存在文件：${relative}`);
  }
  if (manifest.file_count !== actual.length || manifest.file_count !== listedByPath.size ||
      manifest.total_bytes !== actual.reduce((sum, item) => sum + item.size_bytes, 0)) {
    throw new Error("EpubCheck 固定清单文件数或总字节数不一致");
  }
  if (!Array.isArray(manifest.required_files) ||
      JSON.stringify(manifest.required_files) !== JSON.stringify(REQUIRED_FILES) ||
      manifest.required_files.some((item) => !actualByPath.has(item))) {
    throw new Error("EpubCheck 固定清单 required_files 不完整或被修改");
  }
  const expectedLicenses = actual
    .map((item) => item.path)
    .filter((item) => item === "LICENSE.txt" || item === "THIRD-PARTY.txt" ||
      item.startsWith("licenses/"));
  if (!Array.isArray(manifest.license_files) ||
      JSON.stringify(manifest.license_files) !== JSON.stringify(expectedLicenses)) {
    throw new Error("EpubCheck 固定清单 license_files 与实际许可证材料不一致");
  }
  return {
    manifest,
    manifestTarget,
    distribution,
    entry: path.join(distribution, "epubcheck.jar"),
    files: actual,
  };
}

function writePinnedManifest(root = REPO_ROOT) {
  const projectRoot = path.resolve(root);
  const target = resolveProjectPath(projectRoot, MANIFEST_RELATIVE, "EpubCheck manifest");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const manifest = buildManifest(projectRoot);
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { target, manifest };
}

if (require.main === module) {
  try {
    const write = process.argv.slice(2).includes("--write");
    const unexpected = process.argv.slice(2).filter((item) => item !== "--write");
    if (unexpected.length) throw new Error(`未知参数：${unexpected.join(", ")}`);
    const result = write ? writePinnedManifest() : verifyDistribution();
    process.stdout.write(`${JSON.stringify({
      ok: true,
      manifest: path.relative(REPO_ROOT, result.target || result.manifestTarget)
        .split(path.sep).join("/"),
      version: result.manifest.tool.version,
      file_count: result.manifest.file_count,
      total_bytes: result.manifest.total_bytes,
      formal_provenance_audit_required: result.manifest.formal_provenance_audit_required,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DISTRIBUTION_RELATIVE,
  EPUBCHECK_VERSION,
  MANIFEST_RELATIVE,
  REQUIRED_FILES,
  SCHEMA_VERSION,
  buildManifest,
  inventory,
  sha256File,
  verifyDistribution,
  writePinnedManifest,
};
