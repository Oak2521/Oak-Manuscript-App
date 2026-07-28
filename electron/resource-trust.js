"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ANCHOR_RELATIVE = "electron/resource-trust-anchor.json";
const APP_MANIFEST_RELATIVE = "config/tool-manifests/app-resources-v1.json";
const SHA256_RE = /^[a-f0-9]{64}$/;

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function compareUtf16(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function fail(message) {
  throw new Error(`打包资源信任根错误：${message}`);
}

function readJsonBytes(bytes, label) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} 不是 JSON 对象`);
    return value;
  } catch (error) {
    if (String(error.message).startsWith("打包资源信任根错误：")) throw error;
    fail(`${label} JSON 无法解析：${error.message}`);
  }
}

function safeRelative(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") ||
      value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..")) {
    fail(`${label} 路径非法`);
  }
  return value;
}

function safeFile(root, relative, label) {
  const normalized = safeRelative(relative, label);
  const target = path.join(root, ...normalized.split("/"));
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    fail(`${label} 缺失：${normalized}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size <= 0) {
    fail(`${label} 不是非空、非链接、单链接常规文件：${normalized}`);
  }
  return { target, stat };
}

function validateFileRecords(records, label) {
  if (!Array.isArray(records)) fail(`${label}.files 必须是数组`);
  const result = [];
  let previous = null;
  for (const [index, item] of records.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).sort(compareUtf16).join("\0") !== ["path", "sha256", "size_bytes"].sort(compareUtf16).join("\0")) {
      fail(`${label}.files[${index}] 字段非法`);
    }
    const relative = safeRelative(item.path, `${label}.files[${index}].path`);
    if (!Number.isSafeInteger(item.size_bytes) || item.size_bytes < 0 ||
        typeof item.sha256 !== "string" || !SHA256_RE.test(item.sha256)) {
      fail(`${label}.files[${index}] 大小或 SHA-256 非法`);
    }
    if (previous !== null && compareUtf16(previous, relative) >= 0) {
      fail(`${label}.files 必须按 UTF-16 严格排序且不得重复`);
    }
    previous = relative;
    result.push(item);
  }
  return result;
}

function inventory(root, roots, excluded = new Set()) {
  const files = [];
  const visit = (base, directory) => {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      fail(`资源目录缺失或不可读：${path.relative(root, directory).split(path.sep).join("/")}`);
    }
    for (const entry of entries.sort((a, b) => compareUtf16(a.name, b.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(base, target).split(path.sep).join("/");
      const rootRelative = path.relative(root, target).split(path.sep).join("/");
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) fail(`资源不得含链接：${rootRelative}`);
      if (stat.isDirectory()) {
        visit(base, target);
      } else if (stat.isFile()) {
        if (excluded.has(rootRelative)) continue;
        if (stat.nlink !== 1) fail(`资源不是单链接常规文件：${rootRelative}`);
        files.push({
          path: roots.length === 1 ? relative : rootRelative,
          size_bytes: stat.size,
          sha256: sha256Bytes(fs.readFileSync(target)),
        });
      } else {
        fail(`资源含不支持的文件类型：${rootRelative}`);
      }
    }
  };
  for (const relative of roots) {
    const target = path.join(root, ...safeRelative(relative, "resource root").split("/"));
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`资源根不安全：${relative}`);
    visit(roots.length === 1 ? target : root, target);
  }
  return files.sort((a, b) => compareUtf16(a.path, b.path));
}

function verifyInventory(root, roots, expectedRecords, label, excluded = []) {
  const expected = validateFileRecords(expectedRecords, label);
  const actual = inventory(root, roots, new Set(excluded));
  if (actual.length !== expected.length) {
    const expectedPaths = new Set(expected.map((item) => item.path));
    const actualPaths = new Set(actual.map((item) => item.path));
    const unlisted = actual.filter((item) => !expectedPaths.has(item.path)).map((item) => item.path);
    const missing = expected.filter((item) => !actualPaths.has(item.path)).map((item) => item.path);
    fail(`${label} 文件集合不一致；unlisted=${unlisted.join(",") || "<none>"}；missing=${missing.join(",") || "<none>"}`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index];
    const found = actual[index];
    if (wanted.path !== found.path) fail(`${label} 文件顺序或路径不一致：${wanted.path}`);
    if (wanted.size_bytes !== found.size_bytes) fail(`${label} size 不一致：${wanted.path}`);
    if (wanted.sha256 !== found.sha256) fail(`${label} SHA-256 不一致：${wanted.path}`);
  }
  return { file_count: actual.length, total_bytes: actual.reduce((sum, item) => sum + item.size_bytes, 0) };
}

function readAnchoredJson(root, descriptor, label) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor) ||
      typeof descriptor.sha256 !== "string" || !SHA256_RE.test(descriptor.sha256)) {
    fail(`${label} anchor descriptor 非法`);
  }
  const { target } = safeFile(root, descriptor.manifest, label);
  const bytes = fs.readFileSync(target);
  if (sha256Bytes(bytes) !== descriptor.sha256) fail(`anchor lock ${label} SHA-256 不一致`);
  return { bytes, value: readJsonBytes(bytes, label), relative: descriptor.manifest };
}

function verifyPackagedResourceTrust({ root, platform = process.platform, arch = process.arch, anchor }) {
  const resourcesRoot = path.resolve(root);
  if (!anchor || anchor.schema_version !== "1.0" ||
      anchor.anchor_type !== "oak-packaged-resource-trust-root" || !Array.isArray(anchor.targets)) {
    fail("ASAR trust anchor schema 非法");
  }
  const app = readAnchoredJson(resourcesRoot, anchor.app_resources, "app resources manifest");
  if (app.relative !== APP_MANIFEST_RELATIVE || app.value.schema_version !== "1.0" ||
      app.value.lock_type !== "oak-app-loose-resources" || !Array.isArray(app.value.roots) ||
      !Array.isArray(app.value.excluded_paths) || app.value.excluded_paths.length !== 1 ||
      app.value.excluded_paths[0] !== APP_MANIFEST_RELATIVE ||
      app.value.file_count !== anchor.app_resources.file_count ||
      app.value.total_bytes !== anchor.app_resources.total_bytes) {
    fail("app resources manifest 与 ASAR anchor 不一致");
  }
  const appEvidence = verifyInventory(
    resourcesRoot,
    app.value.roots,
    app.value.files,
    "app loose resources",
    app.value.excluded_paths,
  );
  if (appEvidence.file_count !== app.value.file_count || appEvidence.total_bytes !== app.value.total_bytes) {
    fail("app loose resources 汇总不一致");
  }

  const target = anchor.targets.find((item) => item?.platform === platform && item?.arch === arch);
  if (!target || !target.locks || typeof target.locks !== "object") {
    fail(`trust target 缺失：${platform}-${arch}`);
  }
  const python = readAnchoredJson(resourcesRoot, target.locks.python_runtime, "python runtime");
  const epubcheck = readAnchoredJson(resourcesRoot, target.locks.epubcheck, "epubcheck");
  const jre = readAnchoredJson(resourcesRoot, target.locks.jre, "jre");
  const ace = readAnchoredJson(resourcesRoot, target.locks.ace, "ace");

  verifyInventory(resourcesRoot, ["python-runtime"], python.value.files, "python runtime");
  verifyInventory(resourcesRoot, ["tools/epubcheck-5.3.0"], epubcheck.value.files, "epubcheck");

  const jreManifest = safeFile(resourcesRoot, "tools/jre/manifest.json", "jre runtime manifest");
  const jreManifestBytes = fs.readFileSync(jreManifest.target);
  if (sha256Bytes(jreManifestBytes) !== jre.value.runtime_manifest_sha256) {
    fail("jre runtime manifest SHA-256 不一致");
  }
  const jreRuntime = readJsonBytes(jreManifestBytes, "jre runtime manifest");
  verifyInventory(resourcesRoot, ["tools/jre"], jreRuntime.files, "jre runtime", ["tools/jre/manifest.json"]);

  const aceManifest = safeFile(resourcesRoot, "tools/ace/manifest.json", "ace stage manifest");
  const aceManifestBytes = fs.readFileSync(aceManifest.target);
  if (sha256Bytes(aceManifestBytes) !== ace.value.stage_manifest_sha256) {
    fail("ace stage manifest SHA-256 不一致");
  }
  const aceStage = readJsonBytes(aceManifestBytes, "ace stage manifest");
  verifyInventory(resourcesRoot, ["tools/ace"], aceStage.files, "ace stage", ["tools/ace/manifest.json"]);

  return {
    ok: true,
    packaged: true,
    platform,
    arch,
    app_manifest_sha256: anchor.app_resources.sha256,
    app_file_count: appEvidence.file_count,
    app_total_bytes: appEvidence.total_bytes,
    lock_sha256s: {
      python_runtime: target.locks.python_runtime.sha256,
      epubcheck: target.locks.epubcheck.sha256,
      jre: target.locks.jre.sha256,
      ace: target.locks.ace.sha256,
    },
  };
}

function readAnchorBytesFromAsar(asarPath) {
  // This parser is used by the external post-package gate. Keep it lazy so the
  // packaged application does not depend on electron-builder's development tree.
  const { extractFile } = require("@electron/asar");
  const absolute = path.resolve(asarPath);
  const before = safeFile(path.dirname(absolute), path.basename(absolute), "app.asar");
  const beforeReal = fs.realpathSync.native(absolute);
  let bytes;
  try {
    bytes = extractFile(absolute, ANCHOR_RELATIVE);
  } catch (error) {
    fail(`无法从 app.asar 读取 trust anchor：${error.message}`);
  }
  const after = safeFile(path.dirname(absolute), path.basename(absolute), "app.asar");
  const afterReal = fs.realpathSync.native(absolute);
  if (beforeReal !== afterReal || before.stat.dev !== after.stat.dev || before.stat.ino !== after.stat.ino ||
      before.stat.size !== after.stat.size || before.stat.mtimeMs !== after.stat.mtimeMs) {
    fail("app.asar 在读取 trust anchor 期间发生变化");
  }
  return Buffer.from(bytes);
}

function readAnchorFromAsar(asarPath) {
  return readJsonBytes(readAnchorBytesFromAsar(asarPath), "app.asar trust anchor");
}

function verifyPackagedResourceTrustFromAsar({ root, platform = process.platform, arch = process.arch }) {
  const resourcesRoot = path.resolve(root);
  const anchor = readAnchorFromAsar(path.join(resourcesRoot, "app.asar"));
  return verifyPackagedResourceTrust({ root: resourcesRoot, platform, arch, anchor });
}

module.exports = {
  ANCHOR_RELATIVE,
  APP_MANIFEST_RELATIVE,
  readAnchorBytesFromAsar,
  readAnchorFromAsar,
  verifyPackagedResourceTrust,
  verifyPackagedResourceTrustFromAsar,
};
