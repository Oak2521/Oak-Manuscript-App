"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { compareUtf16 } = require("./deterministic_compare");
const {
  atomicReplaceTrackedFile,
  ensureSafeDirectoryChain,
  readSafeRegularFile,
} = require("./safe_tracked_file");
const { parseJsonStrict } = require("./strict_json");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const EVIDENCE_FILENAME = "packaged-smoke-evidence-win32-x64.json";
const PRODUCT = "湖岸稿件 Oak Manuscript";
const APP_ID = "com.oakbylake.manuscript";
const PRODUCT_EXE = "湖岸稿件 Oak Manuscript.exe";
const PASS_MARKER = "SMOKE-RESULT: PASS";
const FAIL_MARKER = "SMOKE-RESULT: FAIL";
const RECOVERY_PASS_MARKER = "SYNC-RECOVERY-RESULT: PASS";
const RECOVERY_FAIL_MARKER = "SYNC-RECOVERY-RESULT: FAIL";
const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const HASH_RE = /^[a-f0-9]{64}$/u;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TREE_FILES = 10_000;
const MAX_TREE_BYTES = 1024 * 1024 * 1024;
const MAX_TREE_DEPTH = 32;
const PROJECT_WRITE_LOCK_FILENAME = ".oak-project-write.lock";
const READ_CHUNK_BYTES = 1024 * 1024;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  const actual = Object.keys(value).sort(compareUtf16);
  const expected = [...keys].sort(compareUtf16);
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} 字段集合不严格匹配；实际 ${actual.join(", ")}`);
  }
}

function isInside(root, target, { allowEqual = false } = {}) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === "") return allowEqual;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function comparablePath(value) {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameIdentity(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs && left.nlink === right.nlink;
}

function safeFileDigest(root, target, label = "证据文件") {
  const projectRoot = path.resolve(root);
  const absolute = path.resolve(target);
  if (!isInside(projectRoot, absolute)) throw new Error(`${label} 路径逃逸项目：${absolute}`);
  ensureSafeDirectoryChain(projectRoot, path.dirname(absolute), { label: `${label} 父目录` });
  const before = fs.lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  if (!before) throw new Error(`${label} 缺失：${absolute}`);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
      before.size > BigInt(MAX_FILE_BYTES)) {
    throw new Error(`${label} 必须是单链接普通文件且不得超过 ${MAX_FILE_BYTES} 字节：${absolute}`);
  }
  const expectedReal = path.join(
    fs.realpathSync.native(projectRoot),
    path.relative(projectRoot, absolute),
  );
  if (comparablePath(fs.realpathSync.native(absolute)) !== comparablePath(expectedReal)) {
    throw new Error(`${label} 经过链接或 reparse 重定向：${absolute}`);
  }

  const descriptor = fs.openSync(absolute, "r");
  const hash = crypto.createHash("sha256");
  let total = 0;
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(before, opened)) throw new Error(`${label} 打开时身份变化：${absolute}`);
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      total += count;
      if (total > MAX_FILE_BYTES) throw new Error(`${label} 读取时超过容量上限：${absolute}`);
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
    if (!sameIdentity(before, after) || !sameIdentity(before, current) || BigInt(total) !== before.size) {
      throw new Error(`${label} 哈希期间身份变化：${absolute}`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return { path: absolute, size_bytes: total, sha256: hash.digest("hex") };
}

function relativePortable(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) ||
      /[\u0000-\u001f\u007f]/u.test(relative)) {
    throw new Error(`证据相对路径非法：${relative}`);
  }
  return relative.split(path.sep).join("/");
}

function inventoryOutputTree(root, target) {
  const projectRoot = path.resolve(root);
  const treeRoot = ensureSafeDirectoryChain(projectRoot, path.resolve(target), {
    label: "packaged smoke 输出树",
  });
  const records = [];
  let totalBytes = 0;

  function walk(directory, depth) {
    if (depth > MAX_TREE_DEPTH) throw new Error(`packaged smoke 输出树超过 ${MAX_TREE_DEPTH} 层`);
    ensureSafeDirectoryChain(projectRoot, directory, { label: "packaged smoke 输出目录" });
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf16(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute, { bigint: true });
      const allowedProjectLock = entry.name === PROJECT_WRITE_LOCK_FILENAME && stat.isFile();
      if (/[\u0000-\u001f\u007f]/u.test(entry.name) ||
          (entry.name.startsWith(".") && !allowedProjectLock)) {
        throw new Error(`packaged smoke 输出树含非法名称：${entry.name}`);
      }
      if (stat.isSymbolicLink()) throw new Error(`packaged smoke 输出树含链接/reparse：${absolute}`);
      if (stat.isDirectory()) {
        walk(absolute, depth + 1);
        continue;
      }
      if (!stat.isFile()) throw new Error(`packaged smoke 输出树含非常规文件：${absolute}`);
      const digest = safeFileDigest(projectRoot, absolute, "packaged smoke 输出文件");
      records.push({
        path: relativePortable(treeRoot, absolute),
        size_bytes: digest.size_bytes,
        sha256: digest.sha256,
      });
      totalBytes += digest.size_bytes;
      if (records.length > MAX_TREE_FILES || totalBytes > MAX_TREE_BYTES) {
        throw new Error("packaged smoke 输出树超过文件数或容量上限");
      }
    }
  }

  walk(treeRoot, 0);
  if (records.length === 0) throw new Error("packaged smoke 输出树不得为空");
  return {
    file_count: records.length,
    total_bytes: totalBytes,
    sha256: sha256(Buffer.from(`${JSON.stringify(records)}\n`, "utf8")),
  };
}

function readMetadata(root) {
  const projectRoot = path.resolve(root);
  const record = readSafeRegularFile(projectRoot, path.join(projectRoot, "package.json"), "package.json");
  const value = parseJsonStrict(record.bytes.toString("utf8"), "package.json");
  if (value.name !== "oak-manuscript" || value.productName !== PRODUCT ||
      value?.build?.appId !== APP_ID || typeof value.version !== "string" ||
      !VERSION_RE.test(value.version)) {
    throw new Error("package.json 应用身份或版本非法");
  }
  return { version: value.version };
}

function markerCount(output, passMarker, failMarker, label) {
  if (typeof output !== "string") throw new Error(`${label} 输出必须是字符串`);
  const count = output.split(/\r?\n/u).filter((line) => line.trim() === passMarker).length;
  if (output.includes(failMarker) || count !== 1) {
    throw new Error(`${label} 必须包含唯一成功标志 ${passMarker}`);
  }
  return count;
}

function buildPackagedSmokeEvidence({ root = PROJECT_ROOT, smokeResult } = {}) {
  if (!smokeResult || typeof smokeResult !== "object" || Array.isArray(smokeResult)) {
    throw new Error("packaged smoke 结果缺失");
  }
  const projectRoot = path.resolve(root);
  const metadata = readMetadata(projectRoot);
  if (smokeResult.expectedVersion !== metadata.version) {
    throw new Error(`packaged smoke 版本与 package.json 不一致：${String(smokeResult.expectedVersion)}`);
  }
  if (typeof smokeResult.runId !== "string" || !RUN_ID_RE.test(smokeResult.runId)) {
    throw new Error(`packaged smoke 运行 ID 非法：${String(smokeResult.runId)}`);
  }
  const expectedExecutable = path.join(projectRoot, "release", "win-unpacked", PRODUCT_EXE);
  const expectedOutput = path.join(
    projectRoot,
    "out",
    "packaged-smoke",
    "runs",
    smokeResult.runId,
    "projects",
  );
  if (path.resolve(smokeResult.executable || "") !== expectedExecutable) {
    throw new Error("packaged smoke EXE 路径与固定产品路径不匹配");
  }
  if (path.resolve(smokeResult.outputRoot || "") !== expectedOutput) {
    throw new Error("packaged smoke 输出目录与运行 ID 不匹配");
  }
  const primaryOutput = `${smokeResult.stdout || ""}\n${smokeResult.stderr || ""}`;
  const recoveryOutput = `${smokeResult.syncRecoveryStdout || ""}\n${smokeResult.syncRecoveryStderr || ""}`;
  const primaryMarkerCount = markerCount(primaryOutput, PASS_MARKER, FAIL_MARKER, "主冒烟");
  const recoveryMarkerCount = markerCount(
    recoveryOutput,
    RECOVERY_PASS_MARKER,
    RECOVERY_FAIL_MARKER,
    "重启恢复冒烟",
  );
  const executable = safeFileDigest(projectRoot, expectedExecutable, "packaged smoke EXE");
  if (smokeResult.executableDigest &&
      (smokeResult.executableDigest.size_bytes !== executable.size_bytes ||
       smokeResult.executableDigest.sha256 !== executable.sha256)) {
    throw new Error("packaged smoke EXE 与运行期间固定摘要不一致");
  }
  const tree = inventoryOutputTree(projectRoot, expectedOutput);
  return {
    schema_version: 1,
    product: PRODUCT,
    app_id: APP_ID,
    version: metadata.version,
    target: { platform: "win32", arch: "x64" },
    executable: {
      path: relativePortable(projectRoot, expectedExecutable),
      size_bytes: executable.size_bytes,
      sha256: executable.sha256,
    },
    run: {
      run_id: smokeResult.runId,
      external_validation_required: true,
      sync_recovery_required: true,
      primary_marker_count: primaryMarkerCount,
      recovery_marker_count: recoveryMarkerCount,
      primary_stdout_sha256: sha256(Buffer.from(smokeResult.stdout || "", "utf8")),
      primary_stderr_sha256: sha256(Buffer.from(smokeResult.stderr || "", "utf8")),
      recovery_stdout_sha256: sha256(Buffer.from(smokeResult.syncRecoveryStdout || "", "utf8")),
      recovery_stderr_sha256: sha256(Buffer.from(smokeResult.syncRecoveryStderr || "", "utf8")),
    },
    output_tree: {
      path: relativePortable(projectRoot, expectedOutput),
      file_count: tree.file_count,
      total_bytes: tree.total_bytes,
      sha256: tree.sha256,
    },
  };
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validateEvidence(value, { root, requireOutputTree }) {
  exactKeys(
    value,
    ["schema_version", "product", "app_id", "version", "target", "executable", "run", "output_tree"],
    "packaged smoke evidence",
  );
  exactKeys(value.target, ["platform", "arch"], "packaged smoke evidence.target");
  exactKeys(value.executable, ["path", "size_bytes", "sha256"], "packaged smoke evidence.executable");
  exactKeys(value.run, [
    "run_id",
    "external_validation_required",
    "sync_recovery_required",
    "primary_marker_count",
    "recovery_marker_count",
    "primary_stdout_sha256",
    "primary_stderr_sha256",
    "recovery_stdout_sha256",
    "recovery_stderr_sha256",
  ], "packaged smoke evidence.run");
  exactKeys(value.output_tree, ["path", "file_count", "total_bytes", "sha256"], "packaged smoke evidence.output_tree");

  const projectRoot = path.resolve(root);
  const metadata = readMetadata(projectRoot);
  const expectedExecutableRelative = `release/win-unpacked/${PRODUCT_EXE}`;
  if (value.schema_version !== 1 || value.product !== PRODUCT || value.app_id !== APP_ID ||
      value.version !== metadata.version || value.target.platform !== "win32" ||
      value.target.arch !== "x64" || value.executable.path !== expectedExecutableRelative ||
      !Number.isSafeInteger(value.executable.size_bytes) || value.executable.size_bytes <= 0 ||
      !HASH_RE.test(value.executable.sha256)) {
    throw new Error("packaged smoke evidence 顶层身份、版本、目标或 EXE 记录非法");
  }
  if (typeof value.run.run_id !== "string" || !RUN_ID_RE.test(value.run.run_id) ||
      value.run.external_validation_required !== true || value.run.sync_recovery_required !== true ||
      value.run.primary_marker_count !== 1 || value.run.recovery_marker_count !== 1 ||
      ![value.run.primary_stdout_sha256, value.run.primary_stderr_sha256,
        value.run.recovery_stdout_sha256, value.run.recovery_stderr_sha256].every((item) => HASH_RE.test(item))) {
    throw new Error("packaged smoke evidence 运行记录非法");
  }
  const expectedOutputRelative = `out/packaged-smoke/runs/${value.run.run_id}/projects`;
  if (value.output_tree.path !== expectedOutputRelative ||
      !Number.isSafeInteger(value.output_tree.file_count) || value.output_tree.file_count <= 0 ||
      !Number.isSafeInteger(value.output_tree.total_bytes) || value.output_tree.total_bytes < 0 ||
      !HASH_RE.test(value.output_tree.sha256)) {
    throw new Error("packaged smoke evidence 输出树记录非法");
  }
  const executable = safeFileDigest(
    projectRoot,
    path.join(projectRoot, ...value.executable.path.split("/")),
    "packaged smoke EXE",
  );
  if (executable.size_bytes !== value.executable.size_bytes || executable.sha256 !== value.executable.sha256) {
    throw new Error("packaged smoke evidence 与当前 EXE 摘要不一致");
  }
  if (requireOutputTree) {
    const tree = inventoryOutputTree(
      projectRoot,
      path.join(projectRoot, ...value.output_tree.path.split("/")),
    );
    if (tree.file_count !== value.output_tree.file_count ||
        tree.total_bytes !== value.output_tree.total_bytes || tree.sha256 !== value.output_tree.sha256) {
      throw new Error("packaged smoke evidence 与当前输出树摘要不一致");
    }
  }
  return value;
}

function verifyPackagedSmokeEvidence({
  root = PROJECT_ROOT,
  platform = "win32",
  arch = "x64",
  requireOutputTree = false,
} = {}) {
  if (platform !== "win32" || arch !== "x64") throw new Error("packaged smoke evidence 只接受 win32/x64");
  if (typeof requireOutputTree !== "boolean") throw new Error("requireOutputTree 必须是布尔值");
  const projectRoot = path.resolve(root);
  const target = path.join(projectRoot, "release", EVIDENCE_FILENAME);
  const record = readSafeRegularFile(projectRoot, target, "packaged smoke evidence");
  const value = parseJsonStrict(record.bytes.toString("utf8"), "packaged smoke evidence");
  validateEvidence(value, { root: projectRoot, requireOutputTree });
  if (!record.bytes.equals(canonicalBytes(value))) {
    throw new Error("packaged smoke evidence 不是 canonical UTF-8/LF JSON");
  }
  return JSON.parse(record.bytes.toString("utf8"));
}

function writePackagedSmokeEvidence({ root = PROJECT_ROOT, smokeResult } = {}) {
  const projectRoot = path.resolve(root);
  const evidence = buildPackagedSmokeEvidence({ root: projectRoot, smokeResult });
  const target = path.join(projectRoot, "release", EVIDENCE_FILENAME);
  atomicReplaceTrackedFile({
    root: projectRoot,
    target,
    bytes: canonicalBytes(evidence),
    verify: () => verifyPackagedSmokeEvidence({ root: projectRoot, requireOutputTree: true }),
  });
  return verifyPackagedSmokeEvidence({ root: projectRoot, requireOutputTree: true });
}

function parseArgs(argv) {
  const actions = [];
  let platform = null;
  let arch = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--verify", "--verify-live"].includes(arg)) actions.push(arg);
    else if (arg === "--platform" || arg === "--arch") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 缺少值`);
      if (arg === "--platform") {
        if (platform !== null) throw new Error("重复参数：--platform");
        platform = value;
      } else {
        if (arch !== null) throw new Error("重复参数：--arch");
        arch = value;
      }
      index += 1;
    } else throw new Error(`未知参数：${arg}`);
  }
  if (actions.length !== 1) throw new Error("必须且只能指定一个操作：--verify 或 --verify-live");
  if (platform !== "win32" || arch !== "x64") throw new Error("packaged smoke evidence 只接受 win32/x64");
  return { platform, arch, requireOutputTree: actions[0] === "--verify-live" };
}

if (require.main === module) {
  try {
    const result = verifyPackagedSmokeEvidence(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  EVIDENCE_FILENAME,
  buildPackagedSmokeEvidence,
  canonicalBytes,
  inventoryOutputTree,
  parseArgs,
  safeFileDigest,
  verifyPackagedSmokeEvidence,
  writePackagedSmokeEvidence,
};
