"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { compareUtf16 } = require("./deterministic_compare");
const { ensureSafeDirectoryChain, readSafeRegularFile } = require("./safe_tracked_file");
const { parseJsonStrict } = require("./strict_json");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CHECKSUM_FILENAME = "SHA256SUMS.txt";
const MANIFEST_FILENAME = "release-manifest-win32-x64.json";
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;
const ZIP_TAIL_BYTES = 65_557;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const ARTIFACT_FAMILY_RE = /^Oak-Manuscript-.+-Windows-x64\.(?:exe|zip)$/u;

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

function sameIdentity(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs && left.nlink === right.nlink;
}

function parseStrictFile(root, target, label) {
  const record = readSafeRegularFile(root, target, label);
  return parseJsonStrict(record.bytes.toString("utf8"), label);
}

function readProjectMetadata(root) {
  const projectRoot = path.resolve(root);
  const packageJson = parseStrictFile(projectRoot, path.join(projectRoot, "package.json"), "package.json");
  const packageLock = parseStrictFile(
    projectRoot,
    path.join(projectRoot, "package-lock.json"),
    "package-lock.json",
  );
  if (packageJson.name !== "oak-manuscript" ||
      packageJson.productName !== "湖岸稿件 Oak Manuscript" ||
      packageJson?.build?.appId !== "com.oakbylake.manuscript" ||
      typeof packageJson.version !== "string" || !VERSION_RE.test(packageJson.version)) {
    throw new Error("package.json 的应用身份或版本非法");
  }
  if (packageLock.name !== packageJson.name || packageLock.version !== packageJson.version ||
      packageLock?.packages?.[""]?.name !== packageJson.name ||
      packageLock?.packages?.[""]?.version !== packageJson.version) {
    throw new Error("package.json、package-lock.json 与根包版本不一致");
  }
  return {
    name: packageJson.name,
    product: packageJson.productName,
    appId: packageJson.build.appId,
    version: packageJson.version,
  };
}

function expectedArtifacts(version) {
  const prefix = `Oak-Manuscript-${version}-Windows-x64`;
  return [
    { filename: `${prefix}.exe`, kind: "nsis" },
    { filename: `${prefix}.zip`, kind: "zip" },
  ];
}

function assertInside(root, target, label) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须严格位于项目目录内：${target}`);
  }
}

function comparablePath(value) {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function safeArtifactRecord(root, target, label) {
  const projectRoot = path.resolve(root);
  const absolute = path.resolve(target);
  assertInside(projectRoot, absolute, label);
  ensureSafeDirectoryChain(projectRoot, path.dirname(absolute), { label: `${label} 父目录` });
  const before = fs.lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  if (!before) throw new Error(`${label} 缺失：${absolute}`);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
      before.size <= 0n || before.size > BigInt(MAX_ARTIFACT_BYTES)) {
    throw new Error(
      `${label} 必须是非空、单链接且不超过 ${MAX_ARTIFACT_BYTES} 字节的普通文件：${absolute}`,
    );
  }
  const expectedReal = path.join(fs.realpathSync.native(projectRoot), path.relative(projectRoot, absolute));
  if (comparablePath(fs.realpathSync.native(absolute)) !== comparablePath(expectedReal)) {
    throw new Error(`${label} 经过链接或 reparse 重定向：${absolute}`);
  }

  const descriptor = fs.openSync(absolute, "r");
  const hash = crypto.createHash("sha256");
  const firstChunks = [];
  let firstBytes = 0;
  let tail = Buffer.alloc(0);
  let total = 0;
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(before, opened)) throw new Error(`${label} 在打开时发生身份变化：${absolute}`);
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      const chunk = Buffer.from(buffer.subarray(0, count));
      hash.update(chunk);
      total += count;
      if (firstBytes < 4096) {
        const take = Math.min(4096 - firstBytes, chunk.length);
        firstChunks.push(Buffer.from(chunk.subarray(0, take)));
        firstBytes += take;
      }
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > ZIP_TAIL_BYTES) tail = tail.subarray(tail.length - ZIP_TAIL_BYTES);
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
    if (!sameIdentity(before, after) || !sameIdentity(before, current) || BigInt(total) !== before.size) {
      throw new Error(`${label} 在哈希期间发生变化：${absolute}`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return {
    filename: path.basename(absolute),
    sizeBytes: total,
    sha256: hash.digest("hex"),
    first: Buffer.concat(firstChunks),
    tail,
  };
}

function validatePe(record) {
  if (record.first.length < 132 || record.first.toString("ascii", 0, 2) !== "MZ") {
    throw new Error(`发布 NSIS EXE 缺少 DOS MZ 结构：${record.filename}`);
  }
  const peOffset = record.first.readUInt32LE(0x3c);
  if (peOffset < 64 || peOffset > record.first.length - 4 ||
      !record.first.subarray(peOffset, peOffset + 4).equals(Buffer.from("PE\0\0", "binary"))) {
    throw new Error(`发布 NSIS EXE 缺少有效 PE 结构：${record.filename}`);
  }
}

function validateZip(record) {
  const header = record.first.subarray(0, 4);
  const validHeader = ["PK\x03\x04", "PK\x05\x06", "PK\x07\x08"]
    .some((value) => header.equals(Buffer.from(value, "binary")));
  if (!validHeader || record.tail.lastIndexOf(Buffer.from("PK\x05\x06", "binary")) < 0) {
    throw new Error(`发布 ZIP 缺少合法头部或中央目录结束结构：${record.filename}`);
  }
}

function collectArtifacts(root, metadata) {
  const projectRoot = path.resolve(root);
  const releaseDir = path.join(projectRoot, "release");
  ensureSafeDirectoryChain(projectRoot, releaseDir, { create: true, label: "发布目录" });
  const expected = expectedArtifacts(metadata.version);
  const allowed = new Set(expected.map((item) => item.filename));
  for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
    if (ARTIFACT_FAMILY_RE.test(entry.name) && !allowed.has(entry.name)) {
      throw new Error(`发布目录含同系列旧版本或未知制品，拒绝生成证据：${entry.name}`);
    }
  }
  return expected.map((item) => {
    const label = item.kind === "nsis" ? "发布 NSIS EXE" : "发布 ZIP";
    const record = safeArtifactRecord(projectRoot, path.join(releaseDir, item.filename), label);
    if (item.kind === "nsis") validatePe(record);
    else validateZip(record);
    return {
      filename: item.filename,
      kind: item.kind,
      size_bytes: record.sizeBytes,
      sha256: record.sha256,
    };
  });
}

function checksumBytes(artifacts) {
  return Buffer.from(
    `${artifacts.map((item) => `${item.sha256}  ${item.filename}`).join("\n")}\n`,
    "utf8",
  );
}

function manifestFor(metadata, artifacts, sumsBytes) {
  return {
    schema_version: 1,
    product: metadata.product,
    app_id: metadata.appId,
    version: metadata.version,
    target: { platform: "win32", arch: "x64" },
    artifacts,
    sha256sums: { filename: CHECKSUM_FILENAME, sha256: sha256(sumsBytes) },
  };
}

function manifestBytes(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function writeExclusiveAndSync(target, bytes) {
  const descriptor = fs.openSync(target, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (!Number.isSafeInteger(written) || written <= 0) {
        throw new Error(`发布证据候选写入未取得进展：${target}`);
      }
      offset += written;
    }
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function recordsMatch(left, right) {
  return (left === null && right === null) || Boolean(
    left && right && sameIdentity(left.stat, right.stat) && left.bytes.equals(right.bytes),
  );
}

function unlinkKnown(root, target, label) {
  const record = readSafeRegularFile(root, target, label, { allowMissing: true });
  if (record) fs.unlinkSync(target);
}

function commitEvidencePair({ root, items, verify, rename = fs.renameSync, beforeCommit = null }) {
  const projectRoot = path.resolve(root);
  const releaseDir = ensureSafeDirectoryChain(projectRoot, path.join(projectRoot, "release"), {
    create: true,
    label: "发布目录",
  });
  const previous = items.map((item) => readSafeRegularFile(
    projectRoot,
    item.target,
    `现有发布证据 ${path.basename(item.target)}`,
    { allowMissing: true },
  ));
  const transaction = fs.mkdtempSync(path.join(releaseDir, ".release-evidence-txn-"));
  ensureSafeDirectoryChain(projectRoot, transaction, { label: "发布证据事务目录" });
  const staged = items.map((item, index) => ({
    ...item,
    candidate: path.join(transaction, `candidate-${index}`),
    backup: path.join(transaction, `previous-${index}`),
  }));
  const committed = [];
  try {
    for (let index = 0; index < staged.length; index += 1) {
      writeExclusiveAndSync(staged[index].candidate, staged[index].bytes);
      if (previous[index]) writeExclusiveAndSync(staged[index].backup, previous[index].bytes);
    }
    if (beforeCommit) beforeCommit({ transaction, staged });
    for (let index = 0; index < staged.length; index += 1) {
      const current = readSafeRegularFile(
        projectRoot,
        staged[index].target,
        `提交前发布证据 ${path.basename(staged[index].target)}`,
        { allowMissing: true },
      );
      if (!recordsMatch(previous[index], current)) {
        throw new Error(`发布证据在提交前发生并发变化：${path.basename(staged[index].target)}`);
      }
    }
    for (let index = 0; index < staged.length; index += 1) {
      rename(staged[index].candidate, staged[index].target);
      committed.push(index);
    }
    verify();
    for (let index = 0; index < staged.length; index += 1) {
      if (previous[index]) unlinkKnown(projectRoot, staged[index].backup, "发布证据成功备份");
    }
    fs.rmdirSync(transaction);
  } catch (error) {
    const rollbackErrors = [];
    for (const index of [...committed].reverse()) {
      try {
        if (previous[index]) rename(staged[index].backup, staged[index].target);
        else rename(staged[index].target, staged[index].candidate);
      } catch (rollbackError) {
        rollbackErrors.push(`${path.basename(staged[index].target)}: ${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `发布证据提交失败：${error.message}；事务回滚也失败：${rollbackErrors.join("；")}`
        + `；证据保留于 ${transaction}`,
        { cause: error },
      );
    }
    const cleanupErrors = [];
    for (const item of staged) {
      for (const [target, label] of [[item.candidate, "回滚候选"], [item.backup, "回滚备份"]]) {
        try { unlinkKnown(projectRoot, target, label); } catch (cleanupError) { cleanupErrors.push(cleanupError.message); }
      }
    }
    try { fs.rmdirSync(transaction); } catch (cleanupError) { cleanupErrors.push(cleanupError.message); }
    if (cleanupErrors.length > 0) {
      throw new Error(
        `发布证据提交失败：${error.message}；旧状态已恢复，但事务清理失败：`
        + `${cleanupErrors.join("；")}；证据保留于 ${transaction}`,
        { cause: error },
      );
    }
    throw error;
  }
}

function validateManifestSchema(manifest, metadata, artifacts, sumsBytes) {
  exactKeys(
    manifest,
    ["schema_version", "product", "app_id", "version", "target", "artifacts", "sha256sums"],
    "发布 manifest",
  );
  exactKeys(manifest.target, ["platform", "arch"], "发布 manifest.target");
  exactKeys(manifest.sha256sums, ["filename", "sha256"], "发布 manifest.sha256sums");
  if (manifest.schema_version !== 1 || manifest.product !== metadata.product ||
      manifest.app_id !== metadata.appId || manifest.version !== metadata.version ||
      manifest.target.platform !== "win32" || manifest.target.arch !== "x64" ||
      manifest.sha256sums.filename !== CHECKSUM_FILENAME ||
      manifest.sha256sums.sha256 !== sha256(sumsBytes)) {
    throw new Error("发布 manifest 顶层身份或 SHA256SUMS 绑定不一致");
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== artifacts.length) {
    throw new Error("发布 manifest 制品集合不完整");
  }
  for (let index = 0; index < artifacts.length; index += 1) {
    exactKeys(manifest.artifacts[index], ["filename", "kind", "size_bytes", "sha256"], `制品 ${index}`);
    if (JSON.stringify(manifest.artifacts[index]) !== JSON.stringify(artifacts[index])) {
      throw new Error(`发布 manifest 制品记录不匹配：${artifacts[index].filename}`);
    }
  }
}

function verifyReleaseEvidence({ root = PROJECT_ROOT, platform = "win32", arch = "x64" } = {}) {
  if (platform !== "win32" || arch !== "x64") throw new Error("发布证据目前只接受 win32/x64");
  const projectRoot = path.resolve(root);
  const metadata = readProjectMetadata(projectRoot);
  const artifacts = collectArtifacts(projectRoot, metadata);
  const expectedSums = checksumBytes(artifacts);
  const releaseDir = path.join(projectRoot, "release");
  const sumsRecord = readSafeRegularFile(
    projectRoot,
    path.join(releaseDir, CHECKSUM_FILENAME),
    "SHA256SUMS",
  );
  if (!sumsRecord.bytes.equals(expectedSums)) throw new Error("SHA256SUMS 与当前制品集合不一致");
  const manifestRecord = readSafeRegularFile(
    projectRoot,
    path.join(releaseDir, MANIFEST_FILENAME),
    "发布 manifest",
  );
  const manifest = parseJsonStrict(manifestRecord.bytes.toString("utf8"), "发布 manifest");
  validateManifestSchema(manifest, metadata, artifacts, sumsRecord.bytes);
  if (!manifestRecord.bytes.equals(manifestBytes(manifest))) {
    throw new Error("发布 manifest 不是 canonical UTF-8/LF 序列化");
  }
  // Strict parsing and exact-schema validation happen above. Return an
  // ordinary JSON object so programmatic callers do not inherit the parser's
  // deliberately null-prototype trust boundary objects.
  return JSON.parse(manifestRecord.bytes.toString("utf8"));
}

function generateReleaseEvidence({
  root = PROJECT_ROOT,
  platform = "win32",
  arch = "x64",
  rename = fs.renameSync,
  beforeCommit = null,
} = {}) {
  if (platform !== "win32" || arch !== "x64") throw new Error("发布证据目前只接受 win32/x64");
  const projectRoot = path.resolve(root);
  const metadata = readProjectMetadata(projectRoot);
  const artifacts = collectArtifacts(projectRoot, metadata);
  const sums = checksumBytes(artifacts);
  const manifest = manifestFor(metadata, artifacts, sums);
  const releaseDir = path.join(projectRoot, "release");
  commitEvidencePair({
    root: projectRoot,
    rename,
    beforeCommit,
    items: [
      { target: path.join(releaseDir, CHECKSUM_FILENAME), bytes: sums },
      { target: path.join(releaseDir, MANIFEST_FILENAME), bytes: manifestBytes(manifest) },
    ],
    verify: () => verifyReleaseEvidence({ root: projectRoot, platform, arch }),
  });
  return verifyReleaseEvidence({ root: projectRoot, platform, arch });
}

function clearReleaseEvidence({ root = PROJECT_ROOT, platform = "win32", arch = "x64" } = {}) {
  if (platform !== "win32" || arch !== "x64") throw new Error("发布证据目前只接受 win32/x64");
  const projectRoot = path.resolve(root);
  const releaseDir = ensureSafeDirectoryChain(projectRoot, path.join(projectRoot, "release"), {
    create: true,
    label: "发布目录",
  });
  const targets = [CHECKSUM_FILENAME, MANIFEST_FILENAME].map((filename) => ({
    filename,
    target: path.join(releaseDir, filename),
  }));
  const records = targets.map((item) => readSafeRegularFile(
    projectRoot,
    item.target,
    `待清除发布证据 ${item.filename}`,
    { allowMissing: true },
  ));
  const removed = [];
  for (let index = 0; index < targets.length; index += 1) {
    if (!records[index]) continue;
    const current = readSafeRegularFile(projectRoot, targets[index].target, `清除前发布证据 ${targets[index].filename}`);
    if (!recordsMatch(records[index], current)) {
      throw new Error(`发布证据在清除前发生并发变化：${targets[index].filename}`);
    }
    fs.unlinkSync(targets[index].target);
    removed.push(targets[index].filename);
  }
  return { releaseDir, removed };
}

function parseArgs(argv) {
  const actions = [];
  let platform = null;
  let arch = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--generate", "--verify", "--clear"].includes(arg)) actions.push(arg.slice(2));
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
  if (actions.length !== 1) throw new Error("必须且只能指定一个操作：--generate、--verify 或 --clear");
  if (platform !== "win32" || arch !== "x64") throw new Error("发布证据目前只接受 win32/x64");
  return { action: actions[0], platform, arch };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    let result;
    if (options.action === "generate") result = generateReleaseEvidence(options);
    else if (options.action === "verify") result = verifyReleaseEvidence(options);
    else result = clearReleaseEvidence(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CHECKSUM_FILENAME,
  MANIFEST_FILENAME,
  clearReleaseEvidence,
  collectArtifacts,
  generateReleaseEvidence,
  parseArgs,
  verifyReleaseEvidence,
};
