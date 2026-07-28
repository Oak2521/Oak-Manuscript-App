"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { compareUtf16 } = require("./deterministic_compare");
const { atomicReplaceTrackedFile } = require("./safe_tracked_file");

const REPO_ROOT = path.resolve(__dirname, "..");
const APP_MANIFEST_RELATIVE = "config/tool-manifests/app-resources-v1.json";
const ANCHOR_RELATIVE = "electron/resource-trust-anchor.json";
const SCHEMA_VERSION = "1.0";
const SHA256_RE = /^[a-f0-9]{64}$/;

const RESOURCE_ROOTS = Object.freeze([
  Object.freeze({ path: "python/oak_manuscript_core", filter: "python-source" }),
  Object.freeze({ path: "config", filter: "all" }),
  Object.freeze({ path: "samples", filter: "all" }),
]);

const TARGET_LOCKS = Object.freeze([
  Object.freeze({
    platform: "win32",
    arch: "x64",
    locks: Object.freeze({
      python_runtime: "config/tool-manifests/python-runtime-win32-x64.json",
      epubcheck: "config/tool-manifests/epubcheck-5.3.0.json",
      jre: "config/tool-manifests/jre-win32-x64.json",
      ace: "config/tool-manifests/ace-1.4.6.json",
    }),
  }),
  Object.freeze({
    platform: "darwin",
    arch: "x64",
    locks: Object.freeze({
      python_runtime: "config/tool-manifests/python-runtime-darwin-x64.json",
      epubcheck: "config/tool-manifests/epubcheck-5.3.0.json",
      jre: "config/tool-manifests/jre-darwin-x64.json",
      ace: "config/tool-manifests/ace-1.4.6.json",
    }),
  }),
  Object.freeze({
    platform: "darwin",
    arch: "arm64",
    locks: Object.freeze({
      python_runtime: "config/tool-manifests/python-runtime-darwin-arm64.json",
      epubcheck: "config/tool-manifests/epubcheck-5.3.0.json",
      jre: "config/tool-manifests/jre-darwin-arm64.json",
      ace: "config/tool-manifests/ace-1.4.6.json",
    }),
  }),
]);

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertSafeFile(target, label) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size <= 0) {
    throw new Error(`${label} 必须是非空、非链接、单链接常规文件`);
  }
  return stat;
}

function shouldShip(relative, filter) {
  if (relative === APP_MANIFEST_RELATIVE) return false;
  if (filter === "python-source") return relative.endsWith(".py");
  return true;
}

function inventorySource(root) {
  const files = [];
  for (const descriptor of RESOURCE_ROOTS) {
    const start = path.join(root, ...descriptor.path.split("/"));
    const startStat = fs.lstatSync(start);
    if (!startStat.isDirectory() || startStat.isSymbolicLink()) {
      throw new Error(`打包资源根不安全：${descriptor.path}`);
    }
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => compareUtf16(left.name, right.name))) {
        const target = path.join(directory, entry.name);
        const relative = path.relative(root, target).split(path.sep).join("/");
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink()) throw new Error(`打包资源不得含链接：${relative}`);
        if (stat.isDirectory()) {
          visit(target);
        } else if (stat.isFile()) {
          if (!shouldShip(relative, descriptor.filter)) continue;
          if (stat.nlink !== 1) {
            throw new Error(`打包资源必须是单链接常规文件：${relative}`);
          }
          files.push({
            path: relative,
            size_bytes: stat.size,
            sha256: sha256Bytes(fs.readFileSync(target)),
          });
        } else {
          throw new Error(`打包资源含不支持的文件类型：${relative}`);
        }
      }
    };
    visit(start);
  }
  return files.sort((left, right) => compareUtf16(left.path, right.path));
}

function buildSourceResourceTrust(root = REPO_ROOT) {
  const projectRoot = path.resolve(root);
  const files = inventorySource(projectRoot);
  const appManifest = {
    schema_version: SCHEMA_VERSION,
    lock_type: "oak-app-loose-resources",
    roots: RESOURCE_ROOTS.map((item) => item.path),
    excluded_paths: [APP_MANIFEST_RELATIVE],
    file_count: files.length,
    total_bytes: files.reduce((sum, item) => sum + item.size_bytes, 0),
    files,
  };
  const appManifestBytes = canonicalBytes(appManifest);
  const targets = [];
  for (const target of TARGET_LOCKS) {
    const entries = Object.entries(target.locks);
    if (!entries.every(([, relative]) => fs.existsSync(path.join(projectRoot, ...relative.split("/"))))) {
      continue;
    }
    const locks = {};
    for (const [name, relative] of entries) {
      const lockTarget = path.join(projectRoot, ...relative.split("/"));
      assertSafeFile(lockTarget, `resource trust lock ${name}`);
      locks[name] = {
        manifest: relative,
        sha256: sha256Bytes(fs.readFileSync(lockTarget)),
      };
    }
    targets.push({ platform: target.platform, arch: target.arch, locks });
  }
  if (targets.length === 0) throw new Error("没有完整的平台运行资源锁可写入 trust anchor");
  const anchor = {
    schema_version: SCHEMA_VERSION,
    anchor_type: "oak-packaged-resource-trust-root",
    app_resources: {
      manifest: APP_MANIFEST_RELATIVE,
      sha256: sha256Bytes(appManifestBytes),
      file_count: appManifest.file_count,
      total_bytes: appManifest.total_bytes,
    },
    targets,
  };
  const anchorBytes = canonicalBytes(anchor);
  return {
    appManifest,
    appManifestBytes,
    appManifestSha256: sha256Bytes(appManifestBytes),
    anchor,
    anchorBytes,
    anchorSha256: sha256Bytes(anchorBytes),
  };
}

function verifySourceResourceTrust(root = REPO_ROOT) {
  const projectRoot = path.resolve(root);
  const built = buildSourceResourceTrust(projectRoot);
  const appTarget = path.join(projectRoot, ...APP_MANIFEST_RELATIVE.split("/"));
  const anchorTarget = path.join(projectRoot, ...ANCHOR_RELATIVE.split("/"));
  assertSafeFile(appTarget, APP_MANIFEST_RELATIVE);
  assertSafeFile(anchorTarget, ANCHOR_RELATIVE);
  if (!fs.readFileSync(appTarget).equals(built.appManifestBytes)) {
    throw new Error(`${APP_MANIFEST_RELATIVE} 与当前打包资源树不一致；需显式 --update-lock`);
  }
  if (!fs.readFileSync(anchorTarget).equals(built.anchorBytes)) {
    throw new Error(`${ANCHOR_RELATIVE} 与当前锁摘要不一致；需显式 --update-lock`);
  }
  return {
    ok: true,
    packaged: false,
    anchor_path: ANCHOR_RELATIVE,
    anchor_sha256: built.anchorSha256,
    app_manifest_path: APP_MANIFEST_RELATIVE,
    app_manifest_sha256: built.appManifestSha256,
    file_count: built.appManifest.file_count,
    total_bytes: built.appManifest.total_bytes,
    targets: built.anchor.targets.map((item) => ({ platform: item.platform, arch: item.arch })),
  };
}

function writeSourceResourceTrust(root = REPO_ROOT) {
  const projectRoot = path.resolve(root);
  const built = buildSourceResourceTrust(projectRoot);
  const appTarget = path.join(projectRoot, ...APP_MANIFEST_RELATIVE.split("/"));
  const anchorTarget = path.join(projectRoot, ...ANCHOR_RELATIVE.split("/"));
  atomicReplaceTrackedFile({
    root: projectRoot,
    target: appTarget,
    bytes: built.appManifestBytes,
    verify: () => fs.readFileSync(appTarget).equals(built.appManifestBytes),
  });
  atomicReplaceTrackedFile({
    root: projectRoot,
    target: anchorTarget,
    bytes: built.anchorBytes,
    verify: () => verifySourceResourceTrust(projectRoot),
  });
  return verifySourceResourceTrust(projectRoot);
}

function parseArgs(argv) {
  if (argv.length === 0) return { updateLock: false };
  if (argv.length === 1 && argv[0] === "--update-lock") return { updateLock: true };
  throw new Error("仅支持无参数只读验证，或显式 --update-lock");
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.updateLock
      ? writeSourceResourceTrust(REPO_ROOT)
      : verifySourceResourceTrust(REPO_ROOT);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ANCHOR_RELATIVE,
  APP_MANIFEST_RELATIVE,
  RESOURCE_ROOTS,
  SHA256_RE,
  buildSourceResourceTrust,
  canonicalBytes,
  parseArgs,
  sha256Bytes,
  verifySourceResourceTrust,
  writeSourceResourceTrust,
};
