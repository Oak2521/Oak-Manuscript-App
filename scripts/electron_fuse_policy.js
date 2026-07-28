"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getCurrentFuseWire } = require("@electron/fuses");
const { ensureSafeDirectoryChain } = require("./safe_tracked_file");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENABLE = "1".charCodeAt(0);
const DISABLE = "0".charCodeAt(0);
const REMOVED = "r".charCodeAt(0);
const INHERIT = 0x90;

// RunAsNode 暂时保留给当前 Ace 外部验证入口；它是明确 blocker，不能被
// ASAR/fuse 加固掩盖。其余已知 fuse 全部显式固定，避免 Electron 默认值漂移。
const EXPECTED_FUSE_CONFIG = Object.freeze({
  runAsNode: true,
  enableCookieEncryption: true,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  loadBrowserProcessSpecificV8Snapshot: false,
  grantFileProtocolExtraPrivileges: false,
  resetAdHocDarwinSignature: false,
});

const KNOWN_FUSES = Object.freeze([
  [0, "RunAsNode", true],
  [1, "EnableCookieEncryption", true],
  [2, "EnableNodeOptionsEnvironmentVariable", false],
  [3, "EnableNodeCliInspectArguments", false],
  [4, "EnableEmbeddedAsarIntegrityValidation", true],
  [5, "OnlyLoadAppFromAsar", true],
  [6, "LoadBrowserProcessSpecificV8Snapshot", false],
  [7, "GrantFileProtocolExtraPrivileges", false],
]);

class FusePolicyError extends Error {
  constructor(message, report = null) {
    super(message);
    this.name = "FusePolicyError";
    this.report = report;
  }
}

function exactObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FusePolicyError(`${label} 必须是对象`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(exactObject(value, label)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new FusePolicyError(`${label} 字段集合不严格匹配`);
  }
}

function verifyBuilderFuseConfiguration(build) {
  exactObject(build, "build");
  if (build.asar !== true) throw new FusePolicyError("正式打包必须显式启用 ASAR");
  if (build.disableAsarIntegrity !== false) {
    throw new FusePolicyError("正式打包不得关闭 ASAR 完整性元数据");
  }
  const actual = exactObject(build.electronFuses, "build.electronFuses");
  exactKeys(actual, Object.keys(EXPECTED_FUSE_CONFIG), "build.electronFuses");
  for (const [key, expected] of Object.entries(EXPECTED_FUSE_CONFIG)) {
    if (actual[key] !== expected) {
      throw new FusePolicyError(`build.electronFuses.${key} 不符合固定策略`);
    }
  }
  return {
    ok: true,
    policy_version: "1.0",
    asar: true,
    embedded_asar_integrity: true,
    only_load_app_from_asar: true,
    run_as_node_temporary: true,
  };
}

function normalizeReleaseTier(value) {
  if (!new Set(["alpha", "sale"]).has(value)) {
    throw new FusePolicyError("releaseTier 必须是 alpha 或 sale");
  }
  return value;
}

function verifyFuseWire(wire, { releaseTier = "sale" } = {}) {
  normalizeReleaseTier(releaseTier);
  exactObject(wire, "Electron fuse wire");
  if (wire.version !== "1") throw new FusePolicyError("Electron fuse wire 版本不是 v1");
  const knownIndices = new Set(KNOWN_FUSES.map(([index]) => String(index)));
  const report = {
    ok: true,
    policy_version: "1.0",
    fuse_wire_version: wire.version,
    known_fuses: [],
    unknown_fuses: [],
    blockers: [],
    fully_known: true,
  };
  for (const [index, name, enabled] of KNOWN_FUSES) {
    const expected = enabled ? ENABLE : DISABLE;
    const actual = wire[index];
    report.known_fuses.push({ index, name, enabled, state: actual ?? null });
    if (actual === undefined) {
      throw new FusePolicyError(`Electron fuse 缺失：${name}`, report);
    }
    if (actual === INHERIT || actual === REMOVED || actual !== expected) {
      throw new FusePolicyError(
        `Electron fuse ${name} 状态不符合固定策略：${String(actual)}`,
        report,
      );
    }
  }
  for (const [key, state] of Object.entries(wire)) {
    if (key === "version" || knownIndices.has(key)) continue;
    if (!/^\d+$/u.test(key) || !Number.isSafeInteger(state)) {
      throw new FusePolicyError(`Electron fuse wire 含非法字段：${key}`, report);
    }
    report.unknown_fuses.push({ index: Number(key), state });
  }
  report.unknown_fuses.sort((left, right) => left.index - right.index);
  if (report.unknown_fuses.length > 0) {
    report.fully_known = false;
    report.blockers.push({
      code: "ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING",
      message: "目标 Electron 含本地 @electron/fuses 尚未识别的 fuse；正式发布前必须更新并逐项固定",
    });
    if (releaseTier === "sale") {
      report.ok = false;
      throw new FusePolicyError(
        `sale 门禁失败：${report.blockers[0].code} — ${report.blockers[0].message}`,
        report,
      );
    }
  }
  return report;
}

function sameIdentity(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs && left.nlink === right.nlink;
}

function normalized(value) {
  const result = path.normalize(value);
  return process.platform === "win32" ? result.toLowerCase() : result;
}

function assertInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new FusePolicyError(`打包可执行文件必须位于项目目录内：${target}`);
  }
}

async function verifyPackagedFuseBinary(executable, {
  root = PROJECT_ROOT,
  releaseTier = "sale",
  readWire = getCurrentFuseWire,
} = {}) {
  const projectRoot = path.resolve(root);
  const absolute = path.resolve(executable);
  assertInside(projectRoot, absolute);
  ensureSafeDirectoryChain(projectRoot, path.dirname(absolute), {
    label: "打包可执行文件父目录",
  });
  const before = fs.lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  if (!before || !before.isFile() || before.isSymbolicLink() ||
      before.size <= 0n || before.nlink !== 1n) {
    throw new FusePolicyError("打包可执行文件必须是非空、单链接常规文件且不得为链接或硬链接");
  }
  const expectedReal = path.join(
    fs.realpathSync.native(projectRoot),
    path.relative(projectRoot, absolute),
  );
  if (normalized(fs.realpathSync.native(absolute)) !== normalized(expectedReal)) {
    throw new FusePolicyError("打包可执行文件经过链接或 reparse 重定向");
  }
  const wire = await readWire(absolute);
  const after = fs.lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  if (!sameIdentity(before, after)) {
    throw new FusePolicyError("打包可执行文件在 fuse 读取期间发生身份变化");
  }
  return {
    executable: path.relative(projectRoot, absolute).split(path.sep).join("/"),
    ...verifyFuseWire(wire, { releaseTier }),
  };
}

function parseArgs(argv) {
  let binary = null;
  let releaseTier = "auto";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--binary") binary = argv[++index];
    else if (arg === "--release-tier") releaseTier = argv[++index];
    else throw new FusePolicyError(`未知参数：${arg}`);
  }
  if (!new Set(["auto", "alpha", "sale"]).has(releaseTier)) {
    throw new FusePolicyError("--release-tier 必须是 auto、alpha 或 sale");
  }
  return { binary, releaseTier };
}

function tierFromPackage(version, requested) {
  if (requested !== "auto") return requested;
  return String(version).includes("-") ? "alpha" : "sale";
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const packageJson = require(path.join(PROJECT_ROOT, "package.json"));
  const config = verifyBuilderFuseConfiguration(packageJson.build);
  const releaseTier = tierFromPackage(packageJson.version, args.releaseTier);
  const result = args.binary
    ? await verifyPackagedFuseBinary(args.binary, { root: PROJECT_ROOT, releaseTier })
    : config;
  process.stdout.write(`${JSON.stringify({ ...result, release_tier: releaseTier }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    const payload = error instanceof FusePolicyError && error.report
      ? { ok: false, error: error.message, report: error.report }
      : { ok: false, error: String(error.message || error) };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_FUSE_CONFIG,
  KNOWN_FUSES,
  FusePolicyError,
  parseArgs,
  tierFromPackage,
  verifyBuilderFuseConfiguration,
  verifyFuseWire,
  verifyPackagedFuseBinary,
};
