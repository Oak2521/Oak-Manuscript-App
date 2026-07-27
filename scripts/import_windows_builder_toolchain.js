"use strict";

// This is an explicit, one-shot import command.  The normal build and
// verification commands must never call it, regenerate manifest.json, or turn
// an untrusted directory into a trusted toolchain merely by inventorying it.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { compareUtf16 } = require("./deterministic_compare");
const {
  LOCK_RELATIVE,
  SOURCE_ARCHIVES,
  TARGET_ARCH,
  TOOLCHAIN_RELATIVE,
} = require("./builder_toolchain_contract");
const { ensureBuildDirectory } = require("./run_electron_builder");
const {
  BUILDER_VERSION,
  verifyWindowsToolchain,
} = require("./verify_builder_toolchain");

const PROJECT_ROOT = path.resolve(__dirname, "..");

// electron-winstaller is locked by package-lock.json.  Pinning both the host
// executable and its load-time DLL prevents an altered local extractor from
// becoming part of the trust bootstrap.
const EXTRACTOR_FILES = Object.freeze([
  Object.freeze({
    relative: "node_modules/electron-winstaller/vendor/7z.exe",
    sha256: "c7245e21a7553d9e52d434002a401c77a7ca7d0f245f2311b0ddf16f8f946c6f",
  }),
  Object.freeze({
    relative: "node_modules/electron-winstaller/vendor/7z.dll",
    sha256: "9ed007aa82e440ceb39a6e105bb1d602a9bc59a4946267ba8de2f220aa15bc06",
  }),
]);

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 50_000;
const MAX_LIST_OUTPUT_BYTES = 32 * 1024 * 1024;

function sha256File(target) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(target));
  return hash.digest("hex");
}

function pathInside(root, target, { allowRoot = false } = {}) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (allowRoot && relative === "") ||
    (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInside(root, target, label, options) {
  if (!pathInside(root, target, options)) {
    throw new Error(`${label} 必须位于项目内受控目录：${target}`);
  }
}

function statRegularFile(target, label) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.nlink !== 1) {
    throw new Error(`${label} 必须是非空、单链接普通文件且不得为链接/reparse：${target}`);
  }
  return stat;
}

function statDirectory(target, label) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} 必须是普通目录且不得为链接：${target}`);
  }
  return stat;
}

function assertSafeExistingPathChain(root, target, label) {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  if (!pathInside(absoluteRoot, absoluteTarget, { allowRoot: true })) {
    throw new Error(`${label} 路径逃逸项目根：${absoluteTarget}`);
  }
  let cursor = absoluteRoot;
  for (const segment of path.relative(absoluteRoot, absoluteTarget).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat) throw new Error(`${label} 路径链缺失：${cursor}`);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} 路径链含符号链接、junction 或 Node 可识别 reparse：${cursor}`);
    }
  }
  const realRoot = fs.realpathSync.native(absoluteRoot);
  const realTarget = fs.realpathSync.native(absoluteTarget);
  if (!pathInside(realRoot, realTarget, { allowRoot: true })) {
    throw new Error(`${label} 真实路径逃逸项目根：${absoluteTarget}`);
  }
}

function validateArchiveRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) {
    throw new Error(`归档条目路径非法：${String(value)}`);
  }
  if (value !== value.normalize("NFC") || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`归档条目路径含非常规 Unicode 或控制字符：${value}`);
  }
  let canonical = value.replace(/\\/gu, "/");
  while (canonical.endsWith("/")) canonical = canonical.slice(0, -1);
  if (canonical.length === 0 || canonical.startsWith("/") ||
      path.win32.isAbsolute(value) || path.posix.isAbsolute(canonical) ||
      /^[a-zA-Z]:/u.test(canonical)) {
    throw new Error(`归档条目不得使用绝对路径：${value}`);
  }
  const segments = canonical.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`归档条目发生路径逃逸或含空段：${value}`);
    }
    if (segment.length > 255 || /[<>:"|?*]/u.test(segment) || /[. ]$/u.test(segment)) {
      throw new Error(`归档条目不兼容安全的 Windows 文件名：${value}`);
    }
    const base = segment.split(".", 1)[0].toUpperCase();
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base)) {
      throw new Error(`归档条目使用 Windows 保留名称：${value}`);
    }
  }
  if (path.posix.normalize(canonical) !== canonical) {
    throw new Error(`归档条目路径未规范化：${value}`);
  }
  return canonical;
}

function parse7zTechnicalListing(output) {
  if (typeof output !== "string") throw new TypeError("7z 技术清单必须是字符串");
  const lines = output.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  const separator = lines.findIndex((line) => /^-{5,}\s*$/u.test(line));
  if (separator < 0) throw new Error("7z 技术清单缺少归档条目分隔线");
  const records = [];
  let current = null;
  function flush() {
    if (current && Object.keys(current).length > 0) records.push(current);
    current = null;
  }
  for (const line of lines.slice(separator + 1)) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    const split = line.indexOf(" = ");
    if (split <= 0) throw new Error(`7z 技术清单含无法识别的字段：${line}`);
    if (!current) current = Object.create(null);
    const key = line.slice(0, split);
    const value = line.slice(split + 3);
    if (Object.hasOwn(current, key)) {
      throw new Error(`7z 技术清单条目含重复字段：${key}`);
    }
    current[key] = value;
  }
  flush();
  if (records.length === 0) throw new Error("7z 技术清单没有归档条目");
  return records;
}

function validateArchiveEntries(records) {
  if (!Array.isArray(records) || records.length === 0 ||
      records.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error("归档条目数量为空或超过安全上限");
  }
  const entries = [];
  const collisionKeys = new Set();
  let totalBytes = 0;
  for (const record of records) {
    const relative = validateArchiveRelativePath(record?.Path);
    const attributes = record.Attributes ?? "";
    const mode = record.Mode ?? "";
    const forbiddenLinkField = [
      "Symbolic Link",
      "Hard Link",
      "Reparse Point",
      "Alternate Stream",
    ].find((field) => Object.hasOwn(record, field));
    if (forbiddenLinkField || record.Anti === "+" || record.Encrypted === "+" ||
        /^l/u.test(mode) || /(?:^|\s)l[rwx-]{9}(?:\s|$)/u.test(attributes) ||
        /(?:^|[_\s])L(?:$|[_\s])/u.test(attributes)) {
      throw new Error(
        `归档条目不得为链接、重解析点、备用流、反条目或加密条目：${relative}`,
      );
    }
    const directory = record.Folder === "+" || /^D/u.test(attributes);
    if (record.Folder != null && record.Folder !== "+" && record.Folder !== "-") {
      throw new Error(`归档条目 Folder 字段非法：${relative}`);
    }
    let sizeBytes = 0;
    if (!directory) {
      if (!/^(0|[1-9][0-9]*)$/u.test(record.Size ?? "")) {
        throw new Error(`归档普通文件缺少合法大小：${relative}`);
      }
      sizeBytes = Number(record.Size);
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
        throw new Error(`归档普通文件大小超出安全整数范围：${relative}`);
      }
      totalBytes += sizeBytes;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_EXTRACTED_BYTES) {
        throw new Error("归档解压总大小超过安全上限");
      }
    }
    const collisionKey = relative.normalize("NFC").toLowerCase();
    if (collisionKeys.has(collisionKey)) {
      throw new Error(`归档含 Windows 大小写或 Unicode 冲突路径：${relative}`);
    }
    collisionKeys.add(collisionKey);
    entries.push({ path: relative, directory, size_bytes: sizeBytes });
  }
  return entries.sort((left, right) => compareUtf16(left.path, right.path));
}

function validateSourceArchives(archiveDirectory, { hashFile = sha256File } = {}) {
  const archiveRoot = path.resolve(archiveDirectory);
  if (archiveRoot.startsWith("\\\\")) {
    throw new Error(`原始归档目录不得使用 UNC 或设备路径（含直接网络共享写法）：${archiveRoot}`);
  }
  statDirectory(archiveRoot, "原始归档目录");
  const actualNames = new Set(fs.readdirSync(archiveRoot));
  const expectedNames = new Set(SOURCE_ARCHIVES.map((item) => item.name));
  for (const entry of actualNames) {
    if (/\.7z$/iu.test(entry) && !expectedNames.has(entry)) {
      throw new Error(`原始归档目录含未授权的 .7z 文件：${entry}`);
    }
  }
  const verified = [];
  for (const spec of SOURCE_ARCHIVES) {
    if (!actualNames.has(spec.name)) throw new Error(`缺少固定原始归档：${spec.name}`);
    const target = path.join(archiveRoot, spec.name);
    assertInside(archiveRoot, target, "原始归档");
    const stat = statRegularFile(target, `原始归档 ${spec.name}`);
    if (stat.size > MAX_ARCHIVE_BYTES) {
      throw new Error(`原始归档超过安全大小上限：${spec.name}`);
    }
    const actualHash = hashFile(target).toLowerCase();
    if (actualHash !== spec.sha256) {
      throw new Error(
        `原始归档 SHA256 不匹配：${spec.name}；预期 ${spec.sha256}，实际 ${actualHash}`,
      );
    }
    verified.push({ ...spec, target, size_bytes: stat.size });
  }
  return verified;
}

function verifyPinnedExtractor(root = PROJECT_ROOT, { hashFile = sha256File } = {}) {
  const projectRoot = path.resolve(root);
  for (const spec of EXTRACTOR_FILES) {
    const target = path.join(projectRoot, ...spec.relative.split("/"));
    assertInside(projectRoot, target, "7z 解压器");
    statRegularFile(target, `7z 解压器组件 ${spec.relative}`);
    const actualHash = hashFile(target).toLowerCase();
    if (actualHash !== spec.sha256) {
      throw new Error(
        `7z 解压器组件 SHA256 不匹配：${spec.relative}；`
        + `预期 ${spec.sha256}，实际 ${actualHash}`,
      );
    }
  }
  return path.join(projectRoot, ...EXTRACTOR_FILES[0].relative.split("/"));
}

function run7z(executable, args) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    maxBuffer: MAX_LIST_OUTPUT_BYTES,
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`7z 被信号 ${result.signal} 终止`);
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
    throw new Error(`7z 执行失败（退出码 ${result.status}）：${detail}`);
  }
  return result.stdout ?? "";
}

function actualExtractedFiles(root) {
  const extractRoot = path.resolve(root);
  statDirectory(extractRoot, "归档解压目录");
  const realRoot = fs.realpathSync.native(extractRoot);
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf16(left.name, right.name))) {
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      const relative = validateArchiveRelativePath(
        path.relative(extractRoot, target).split(path.sep).join("/"),
      );
      if (stat.isSymbolicLink()) throw new Error(`解压结果含符号链接或 junction：${relative}`);
      const realTarget = fs.realpathSync.native(target);
      if (!pathInside(realRoot, realTarget)) {
        throw new Error(`解压结果真实路径逃逸 staging：${relative}`);
      }
      if (stat.isDirectory()) visit(target);
      else if (stat.isFile()) {
        if (stat.nlink > 1) throw new Error(`解压结果含硬链接：${relative}`);
        files.push({ path: relative, size_bytes: stat.size, target });
      } else throw new Error(`解压结果含非常规文件类型：${relative}`);
    }
  }
  visit(extractRoot);
  return files.sort((left, right) => compareUtf16(left.path, right.path));
}

function verifyExtractedTree(root, entries) {
  const expected = new Map(
    entries.filter((entry) => !entry.directory).map((entry) => [entry.path, entry]),
  );
  const actual = actualExtractedFiles(root);
  for (const item of actual) {
    const listed = expected.get(item.path);
    if (!listed) throw new Error(`解压结果含清单外文件：${item.path}`);
    if (listed.size_bytes !== item.size_bytes) {
      throw new Error(`解压文件大小与 7z 技术清单不符：${item.path}`);
    }
    expected.delete(item.path);
  }
  if (expected.size > 0) {
    throw new Error(`解压结果缺少 7z 技术清单文件：${[...expected.keys()][0]}`);
  }
  return actual;
}

function inspectAndExtractArchive({
  archive,
  destination,
  expectedSha256,
  extractor,
  execute7z = run7z,
}) {
  if (fs.existsSync(destination)) throw new Error(`归档解压目录必须预先不存在：${destination}`);
  const listing = execute7z(extractor, ["l", "-slt", "-sccUTF-8", archive]);
  const entries = validateArchiveEntries(parse7zTechnicalListing(listing));
  fs.mkdirSync(destination);
  execute7z(extractor, [
    "x",
    "-y",
    "-bd",
    "-bb0",
    "-sccUTF-8",
    `-o${destination}`,
    archive,
  ]);
  const actualHash = sha256File(archive);
  if (actualHash !== expectedSha256) {
    throw new Error(`staging 内归档在检查与解压之间发生变化：${path.basename(archive)}`);
  }
  verifyExtractedTree(destination, entries);
  return entries;
}

function copyDirectorySafe(source, destination, sourceRoot = source) {
  const sourceBase = path.resolve(sourceRoot);
  const current = path.resolve(source);
  statDirectory(current, "待组装目录");
  const realSourceBase = fs.realpathSync.native(sourceBase);
  const realCurrent = fs.realpathSync.native(current);
  if (realCurrent !== realSourceBase && !pathInside(realSourceBase, realCurrent)) {
    throw new Error(`待组装目录真实路径逃逸：${source}`);
  }
  if (fs.existsSync(destination)) throw new Error(`组装目标已存在：${destination}`);
  fs.mkdirSync(destination);
  for (const entry of fs.readdirSync(current, { withFileTypes: true })
    .sort((left, right) => compareUtf16(left.name, right.name))) {
    const from = path.join(current, entry.name);
    const to = path.join(destination, entry.name);
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw new Error(`待组装来源含链接：${from}`);
    const realFrom = fs.realpathSync.native(from);
    if (!pathInside(realSourceBase, realFrom)) throw new Error(`待组装来源真实路径逃逸：${from}`);
    if (stat.isDirectory()) copyDirectorySafe(from, to, sourceBase);
    else if (stat.isFile()) {
      if (stat.nlink > 1) throw new Error(`待组装来源含硬链接：${from}`);
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    } else throw new Error(`待组装来源含非常规文件：${from}`);
  }
}

function copyDirectoryContentsSafe(source, destination) {
  statDirectory(source, "待合并目录");
  statDirectory(destination, "组装目标目录");
  const sourceRoot = path.resolve(source);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })
    .sort((left, right) => compareUtf16(left.name, right.name))) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw new Error(`待组装来源含链接：${from}`);
    if (fs.existsSync(to)) throw new Error(`Windows kit 与工具链目标发生路径冲突：${entry.name}`);
    if (stat.isDirectory()) copyDirectorySafe(from, to, sourceRoot);
    else if (stat.isFile()) {
      if (stat.nlink > 1) throw new Error(`待组装来源含硬链接：${from}`);
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    } else throw new Error(`待组装来源含非常规文件：${from}`);
  }
}

function requirePayloadFile(root, relative) {
  const target = path.join(root, ...relative.split("/"));
  assertInside(root, target, "归档载荷文件");
  statRegularFile(target, `归档载荷 ${relative}`);
  return target;
}

function requirePayloadDirectory(root, relative, { nonEmpty = false } = {}) {
  const target = path.join(root, ...relative.split("/"));
  assertInside(root, target, "归档载荷目录");
  statDirectory(target, `归档载荷 ${relative}`);
  if (nonEmpty && fs.readdirSync(target).length === 0) {
    throw new Error(`归档载荷目录为空：${relative}`);
  }
  return target;
}

function inventoryToolchain(toolchain) {
  return actualExtractedFiles(toolchain)
    .filter((item) => item.path !== "manifest.json")
    .map((item) => ({
      path: item.path,
      size_bytes: item.size_bytes,
      sha256: sha256File(item.target),
    }));
}

function writeDeterministicManifest(toolchain, sourceArchives) {
  const files = inventoryToolchain(toolchain);
  const manifest = {
    schema_version: "1.0",
    host_platform: "win32",
    host_arch: TARGET_ARCH,
    electron_builder_version: BUILDER_VERSION,
    source_archives: SOURCE_ARCHIVES.map((spec) => {
      const imported = sourceArchives.find((item) => item.name === spec.name);
      if (!imported || imported.sha256 !== spec.sha256 ||
          !Number.isSafeInteger(imported.size_bytes) || imported.size_bytes <= 0) {
        throw new Error(`生成 manifest 时缺少已验证来源归档：${spec.name}`);
      }
      return {
        name: spec.name,
        size_bytes: imported.size_bytes,
        sha256: spec.sha256,
      };
    }),
    file_count: files.length,
    total_bytes: files.reduce((sum, item) => sum + item.size_bytes, 0),
    files,
  };
  fs.writeFileSync(
    path.join(toolchain, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return manifest;
}

function writeTrackedLock(candidateProjectRoot, toolchain, manifest) {
  const lockTarget = path.join(candidateProjectRoot, ...LOCK_RELATIVE.split("/"));
  if (fs.existsSync(lockTarget)) throw new Error(`候选 tracked lock 必须预先不存在：${lockTarget}`);
  const manifestTarget = path.join(toolchain, "manifest.json");
  const manifestStat = statRegularFile(manifestTarget, "候选工具链 manifest.json");
  const lock = {
    schema_version: "1.0",
    host_platform: "win32",
    host_arch: TARGET_ARCH,
    electron_builder_version: BUILDER_VERSION,
    source_archives: manifest.source_archives,
    tool_manifest: {
      path: `${TOOLCHAIN_RELATIVE}/manifest.json`,
      size_bytes: manifestStat.size,
      sha256: sha256File(manifestTarget),
    },
    file_count: manifest.file_count,
    total_bytes: manifest.total_bytes,
    files: manifest.files,
  };
  fs.mkdirSync(path.dirname(lockTarget), { recursive: true });
  fs.writeFileSync(lockTarget, `${JSON.stringify(lock, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { lock, lockTarget };
}

function prepareCandidateLock({
  projectRoot,
  candidateProjectRoot,
  toolchain,
  manifest,
  updateLock,
}) {
  if (updateLock) return writeTrackedLock(candidateProjectRoot, toolchain, manifest);
  const existing = path.join(projectRoot, ...LOCK_RELATIVE.split("/"));
  statRegularFile(
    existing,
    `现有 tracked lock；首次导入须显式传入 --update-lock (${LOCK_RELATIVE})`,
  );
  const candidate = path.join(candidateProjectRoot, ...LOCK_RELATIVE.split("/"));
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  fs.copyFileSync(existing, candidate, fs.constants.COPYFILE_EXCL);
  return { lock: null, lockTarget: candidate };
}

function assembleWindowsToolchain({
  candidateProjectRoot,
  nsisRoot,
  nsisResourcesRoot,
  winCodeSignRoot,
  sourceArchives,
}) {
  const candidateRoot = path.resolve(candidateProjectRoot);
  if (fs.existsSync(candidateRoot)) {
    throw new Error(`候选项目根必须预先不存在：${candidateRoot}`);
  }
  requirePayloadFile(nsisRoot, "Bin/makensis.exe");
  requirePayloadFile(nsisRoot, "elevate.exe");
  for (const relative of ["Include", "Stubs", "Contrib"]) {
    requirePayloadDirectory(nsisRoot, relative, { nonEmpty: true });
  }
  requirePayloadDirectory(nsisResourcesRoot, "plugins", { nonEmpty: true });
  const rceditX64 = requirePayloadFile(winCodeSignRoot, "rcedit-x64.exe");
  const rceditX86 = requirePayloadFile(winCodeSignRoot, "rcedit-ia32.exe");
  const windowsKit = requirePayloadDirectory(winCodeSignRoot, "windows-10/x64", {
    nonEmpty: true,
  });
  requirePayloadFile(winCodeSignRoot, "windows-10/x64/signtool.exe");

  const toolchain = path.join(candidateRoot, ...TOOLCHAIN_RELATIVE.split("/"));
  fs.mkdirSync(toolchain, { recursive: true });
  copyDirectorySafe(nsisRoot, path.join(toolchain, "nsis"));
  copyDirectorySafe(nsisResourcesRoot, path.join(toolchain, "nsis-resources"));
  const rcedit = path.join(toolchain, "rcedit");
  fs.mkdirSync(rcedit);
  fs.copyFileSync(rceditX64, path.join(rcedit, "rcedit-x64.exe"), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(rceditX86, path.join(rcedit, "rcedit-x86.exe"), fs.constants.COPYFILE_EXCL);
  // Keep signtool's adjacent Windows Kit DLLs next to the pinned SIGNTOOL_PATH,
  // rather than copying only the executable and creating a latent runtime fault.
  copyDirectoryContentsSafe(windowsKit, toolchain);
  const manifest = writeDeterministicManifest(toolchain, sourceArchives);
  return { candidateProjectRoot: candidateRoot, toolchain, manifest };
}

function transactionalInstall({
  root,
  candidateProjectRoot,
  transactionRoot,
  updateLock = false,
  verify = verifyWindowsToolchain,
  rename = fs.renameSync,
}) {
  const projectRoot = path.resolve(root);
  const transaction = path.resolve(transactionRoot);
  const candidateRoot = path.resolve(candidateProjectRoot);
  assertInside(projectRoot, transaction, "工具链事务目录");
  assertInside(transaction, candidateRoot, "候选项目根");
  statDirectory(transaction, "工具链事务目录");
  const candidate = path.join(candidateRoot, ...TOOLCHAIN_RELATIVE.split("/"));
  const candidateLock = path.join(candidateRoot, ...LOCK_RELATIVE.split("/"));
  statDirectory(candidate, "候选 Windows 工具链");
  statRegularFile(candidateLock, "候选 Windows 工具链 tracked lock");
  verify(candidateRoot, TARGET_ARCH);

  const destinationParent = path.join(projectRoot, "tools", "electron-builder");
  ensureBuildDirectory(projectRoot, destinationParent, "Windows 工具链父目录");
  const destination = path.join(destinationParent, `win32-${TARGET_ARCH}`);
  const backup = path.join(transaction, "previous-toolchain");
  const lockDestination = path.join(projectRoot, ...LOCK_RELATIVE.split("/"));
  const lockBackup = path.join(transaction, "previous-lock.json");
  ensureBuildDirectory(projectRoot, path.dirname(lockDestination), "Windows 工具链 lock 父目录");
  if (fs.existsSync(backup)) throw new Error(`事务备份路径必须预先不存在：${backup}`);
  if (fs.existsSync(lockBackup)) throw new Error(`事务 lock 备份路径必须预先不存在：${lockBackup}`);
  const previous = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (previous && (!previous.isDirectory() || previous.isSymbolicLink())) {
    throw new Error(`现有 Windows 工具链不是安全普通目录：${destination}`);
  }
  const previousLock = fs.lstatSync(lockDestination, { throwIfNoEntry: false });
  if (previousLock && (!previousLock.isFile() || previousLock.isSymbolicLink() ||
      previousLock.size <= 0 || previousLock.nlink !== 1)) {
    throw new Error(`现有 Windows 工具链 tracked lock 不是安全普通文件：${lockDestination}`);
  }
  if (!updateLock && !previousLock) {
    throw new Error(`缺少 tracked lock，且未显式授权 --update-lock：${LOCK_RELATIVE}`);
  }
  if (previous) {
    assertSafeExistingPathChain(projectRoot, destination, "现有 Windows 工具链");
    // Refuse to move and later delete an old tree until every nested entry has
    // been classified without following links and every file is single-linked.
    actualExtractedFiles(destination);
  }
  if (previousLock) {
    assertSafeExistingPathChain(projectRoot, lockDestination, "现有 Windows 工具链 tracked lock");
  }

  let previousMoved = false;
  let candidateMoved = false;
  let previousLockMoved = false;
  let candidateLockMoved = false;
  try {
    if (previous) {
      rename(destination, backup);
      previousMoved = true;
    }
    if (updateLock && previousLock) {
      rename(lockDestination, lockBackup);
      previousLockMoved = true;
    }
    rename(candidate, destination);
    candidateMoved = true;
    if (updateLock) {
      rename(candidateLock, lockDestination);
      candidateLockMoved = true;
    }
    verify(projectRoot, TARGET_ARCH);
    return { destination, lockDestination, replaced: previousMoved, lockUpdated: updateLock };
  } catch (error) {
    const rollbackErrors = [];
    if (candidateLockMoved) {
      try {
        rename(lockDestination, candidateLock);
        candidateLockMoved = false;
      } catch (rollbackError) {
        rollbackErrors.push(`无法移回失败候选 lock：${rollbackError.message}`);
      }
    }
    if (candidateMoved) {
      try {
        rename(destination, candidate);
        candidateMoved = false;
      } catch (rollbackError) {
        rollbackErrors.push(`无法移回失败候选：${rollbackError.message}`);
      }
    }
    if (previousLockMoved && !candidateLockMoved) {
      try {
        rename(lockBackup, lockDestination);
        previousLockMoved = false;
      } catch (rollbackError) {
        rollbackErrors.push(`无法恢复旧 tracked lock：${rollbackError.message}`);
      }
    }
    if (previousMoved && !candidateMoved) {
      try {
        rename(backup, destination);
        previousMoved = false;
      } catch (rollbackError) {
        rollbackErrors.push(`无法恢复旧工具链：${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Windows 工具链换入失败：${error.message}；事务回滚也失败：`
        + rollbackErrors.join("；"),
        { cause: error },
      );
    }
    throw error;
  }
}

function importWindowsBuilderToolchain({
  root = PROJECT_ROOT,
  archiveDirectory,
  updateLock = false,
  resolveExtractor = verifyPinnedExtractor,
  execute7z = run7z,
  verify = verifyWindowsToolchain,
  hostPlatform = process.platform,
  hostArch = process.arch,
} = {}) {
  if (hostPlatform !== "win32" || hostArch !== "x64") {
    throw new Error(`Windows x64 工具链只能在 win32/x64 主机导入；当前 ${hostPlatform}/${hostArch}`);
  }
  if (typeof archiveDirectory !== "string" || archiveDirectory.length === 0) {
    throw new Error("必须显式提供含三份固定原始归档的 --archive-dir");
  }
  const projectRoot = path.resolve(root);
  const verifiedSources = validateSourceArchives(archiveDirectory);
  const tempParent = path.join(projectRoot, "out", "tmp");
  ensureBuildDirectory(projectRoot, tempParent, "工具链导入 staging 父目录");
  const transactionRoot = fs.mkdtempSync(path.join(tempParent, "builder-toolchain-import-"));
  assertInside(projectRoot, transactionRoot, "工具链导入 staging");
  let completed = false;
  try {
    const extractor = resolveExtractor(projectRoot);
    const stagedArchives = path.join(transactionRoot, "archives");
    const extracted = path.join(transactionRoot, "extracted");
    fs.mkdirSync(stagedArchives);
    fs.mkdirSync(extracted);
    const stagedSources = verifiedSources.map((source) => {
      const target = path.join(stagedArchives, source.name);
      fs.copyFileSync(source.target, target, fs.constants.COPYFILE_EXCL);
      const copiedHash = sha256File(target);
      if (copiedHash !== source.sha256) {
        throw new Error(`复制到 staging 后归档 SHA256 不匹配：${source.name}`);
      }
      return { ...source, target };
    });
    const extractedById = Object.create(null);
    for (const source of stagedSources) {
      const destination = path.join(extracted, source.id);
      inspectAndExtractArchive({
        archive: source.target,
        destination,
        expectedSha256: source.sha256,
        extractor,
        execute7z,
      });
      extractedById[source.id] = destination;
    }
    const candidateProjectRoot = path.join(transactionRoot, "candidate-project");
    const assembled = assembleWindowsToolchain({
      candidateProjectRoot,
      nsisRoot: extractedById.nsis,
      nsisResourcesRoot: extractedById.nsisResources,
      winCodeSignRoot: extractedById.winCodeSign,
      sourceArchives: stagedSources,
    });
    prepareCandidateLock({
      projectRoot,
      candidateProjectRoot,
      toolchain: assembled.toolchain,
      manifest: assembled.manifest,
      updateLock,
    });
    const installed = transactionalInstall({
      root: projectRoot,
      candidateProjectRoot,
      transactionRoot,
      updateLock,
      verify,
    });
    completed = true;
    return {
      destination: installed.destination,
      replaced: installed.replaced,
      lockUpdated: installed.lockUpdated,
      manifest: assembled.manifest,
    };
  } finally {
    const unresolvedBackup = fs.existsSync(path.join(transactionRoot, "previous-toolchain")) ||
      fs.existsSync(path.join(transactionRoot, "previous-lock.json"));
    if (pathInside(projectRoot, transactionRoot) && (completed || !unresolvedBackup)) {
      fs.rmSync(transactionRoot, { recursive: true, force: true });
    }
  }
}

function parseArgs(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return { help: true };
  }
  if ((argv.length !== 2 && argv.length !== 3) || argv[0] !== "--archive-dir" || !argv[1] ||
      (argv.length === 3 && argv[2] !== "--update-lock")) {
    throw new Error(
      "用法：node scripts/import_windows_builder_toolchain.js --archive-dir <固定归档目录> [--update-lock]",
    );
  }
  return { help: false, archiveDirectory: argv[1], updateLock: argv[2] === "--update-lock" };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(
        "node scripts/import_windows_builder_toolchain.js --archive-dir <固定归档目录> [--update-lock]\n",
      );
    } else {
      const result = importWindowsBuilderToolchain(args);
      process.stdout.write(`${JSON.stringify({
        destination: result.destination,
        replaced: result.replaced,
        lock_updated: result.lockUpdated,
        source_archives: result.manifest.source_archives,
        file_count: result.manifest.file_count,
        total_bytes: result.manifest.total_bytes,
      }, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXTRACTOR_FILES,
  SOURCE_ARCHIVES,
  assertSafeExistingPathChain,
  assembleWindowsToolchain,
  importWindowsBuilderToolchain,
  inspectAndExtractArchive,
  parse7zTechnicalListing,
  parseArgs,
  prepareCandidateLock,
  run7z,
  transactionalInstall,
  validateArchiveEntries,
  validateArchiveRelativePath,
  validateSourceArchives,
  verifyExtractedTree,
  verifyPinnedExtractor,
  writeDeterministicManifest,
  writeTrackedLock,
};
