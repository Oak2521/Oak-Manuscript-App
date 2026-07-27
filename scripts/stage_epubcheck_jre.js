"use strict";

// 使用本机已安装的 Temurin JDK 21，以 jdeps + jlink 生成仅供 EpubCheck
// 使用的 Windows x64 运行时。脚本不下载任何内容，所有中间与最终产物均位于仓库内。

const crypto = require("crypto");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { compareUtf16 } = require("./deterministic_compare");
const { windowsExecutableArch } = require("./electron_dist");
const { verifyDistribution } = require("./epubcheck_distribution");

const REPO_ROOT = path.resolve(__dirname, "..");
const EPUBCHECK_VERSION = "5.3.0";
const JRE_SCHEMA_VERSION = "1.0";
const REQUIRED_JAVA_FEATURE = 21;
const REQUIRED_JAVA_VERSION = "21.0.11";
const REQUIRED_JAVA_RUNTIME_VERSION = "21.0.11+10-LTS";
const REQUIRED_IMPLEMENTOR_VERSION = "Temurin-21.0.11+10";
const TARGET_PLATFORM = "win32";
const TARGET_ARCH = "x64";
const JLINK_MODULE_POLICY = "fixed-conservative-java-se";
const JLINK_REQUESTED_MODULES = Object.freeze([
  "java.se",
  "jdk.unsupported",
  "jdk.xml.dom",
]);
const RUNTIME_LOCK_RELATIVE = "config/tool-manifests/jre-win32-x64.json";
const JAVA_INJECTION_ENV = new Set([
  "CLASSPATH",
  "JAVA_TOOL_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "_JAVA_OPTIONS",
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

function parseReleaseFile(content) {
  const result = {};
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z0-9_]+)="([^"]*)"$/.exec(line);
    if (!match) throw new Error(`JDK release 文件含无法审计的行：${rawLine}`);
    result[match[1]] = match[2];
  }
  return result;
}

function javaFeature(version) {
  // `java --version` starts with `openjdk 21...`, while jdeps/jlink start
  // directly with `21...`. Parse only the first line so a build date cannot
  // accidentally satisfy the feature-version gate.
  const firstLine = String(version).trim().split(/\r?\n/, 1)[0];
  const match = /^(?:openjdk\s+)?(\d+)(?:\.|\s|$)/i.exec(firstLine);
  return match ? Number(match[1]) : null;
}

function validateSourceJdkRelease(release, { platform = process.platform, arch = process.arch } = {}) {
  const errors = [];
  if (platform !== TARGET_PLATFORM || arch !== TARGET_ARCH) {
    errors.push(`只能在 Windows x64 主机生成 Windows x64 JRE，当前 ${platform}-${arch}`);
  }
  if (release.IMPLEMENTOR !== "Eclipse Adoptium") {
    errors.push(`JDK IMPLEMENTOR 必须是 Eclipse Adoptium，实际 ${String(release.IMPLEMENTOR)}`);
  }
  if (release.IMPLEMENTOR_VERSION !== REQUIRED_IMPLEMENTOR_VERSION) {
    errors.push(`JDK IMPLEMENTOR_VERSION 必须是 ${REQUIRED_IMPLEMENTOR_VERSION}，实际 ${String(release.IMPLEMENTOR_VERSION)}`);
  }
  if (release.JAVA_VERSION !== REQUIRED_JAVA_VERSION ||
      release.JAVA_RUNTIME_VERSION !== REQUIRED_JAVA_RUNTIME_VERSION) {
    errors.push(
      `JDK 版本必须是 ${REQUIRED_JAVA_VERSION} / ${REQUIRED_JAVA_RUNTIME_VERSION}`
      + `，实际 ${String(release.JAVA_VERSION)} / ${String(release.JAVA_RUNTIME_VERSION)}`,
    );
  }
  if (release.OS_NAME !== "Windows") {
    errors.push(`JDK OS_NAME 必须是 Windows，实际 ${String(release.OS_NAME)}`);
  }
  if (!new Set(["x86_64", "amd64"]).has(String(release.OS_ARCH).toLowerCase())) {
    errors.push(`JDK OS_ARCH 必须是 x86_64，实际 ${String(release.OS_ARCH)}`);
  }
  if (release.IMAGE_TYPE !== "JDK") {
    errors.push(`jlink 源必须是完整 JDK，IMAGE_TYPE 实际 ${String(release.IMAGE_TYPE)}`);
  }
  if (errors.length) throw new Error(errors.join("；"));
  return release;
}

function parseModuleList(value) {
  // jdeps may print localized split-package warnings before its final module
  // line.  Accept only complete JDK-module lines and ignore all other output;
  // this also handles `java --list-modules`, which emits one `name@version`
  // record per line.
  const modules = [];
  for (const rawLine of String(value).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const items = line.split(",").map((item) => item.trim()).filter(Boolean);
    if (items.length === 0 || items.some(
      (item) => !/^(?:java|jdk)\.[a-zA-Z0-9_.]+(?:@[^\s,]+)?$/.test(item),
    )) continue;
    modules.push(...items.map((item) => item.split("@")[0]));
  }
  const unique = [...new Set(modules)].sort(compareUtf16);
  if (unique.length === 0) {
    throw new Error(`无法解析 Java 模块列表：${String(value).slice(0, 200)}`);
  }
  return unique;
}

function cleanJavaEnvironment(source = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (!JAVA_INJECTION_ENV.has(key.toUpperCase())) result[key] = value;
  }
  return result;
}

function executableName(name, platform = process.platform) {
  return platform === "win32" ? `${name}.exe` : name;
}

function candidateJdkHomes({ explicit, env = process.env, platform = process.platform } = {}) {
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  if (env.JAVA_HOME) candidates.push(path.resolve(env.JAVA_HOME));
  for (const segment of String(env.Path || env.PATH || "").split(path.delimiter)) {
    if (!segment) continue;
    const bin = path.resolve(segment.replace(/^"|"$/g, ""));
    if (fs.existsSync(path.join(bin, executableName("jdeps", platform)))) {
      candidates.push(path.dirname(bin));
    }
  }
  return [...new Set(candidates.map((item) => path.normalize(item)))];
}

function resolveJdkHome(options = {}) {
  const platform = options.platform || process.platform;
  for (const candidate of candidateJdkHomes({ ...options, platform })) {
    const required = [
      path.join(candidate, "release"),
      path.join(candidate, "NOTICE"),
      path.join(candidate, "bin", executableName("java", platform)),
      path.join(candidate, "bin", executableName("jdeps", platform)),
      path.join(candidate, "bin", executableName("jlink", platform)),
      path.join(candidate, "jmods", "java.base.jmod"),
      path.join(candidate, "legal", "java.base", "LICENSE"),
    ];
    if (required.every((target) => fs.statSync(target, { throwIfNoEntry: false })?.isFile())) {
      return candidate;
    }
  }
  throw new Error("未找到带 java/jdeps/jlink/jmods/许可证材料的本机 Temurin JDK 21；脚本不会联网下载");
}

function runChecked(executable, args, { cwd = REPO_ROOT, env = process.env, timeout = 120000 } = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    env: cleanJavaEnvironment(env),
    encoding: "utf8",
    timeout,
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${path.basename(executable)} 执行失败：status=${String(result.status)}`
      + `；stdout=${result.stdout?.trim() || "<empty>"}`
      + `；stderr=${result.stderr?.trim() || result.error?.message || "<empty>"}`,
    );
  }
  return result;
}

function listFiles(root, { exclude = new Set() } = {}) {
  const records = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf16(left.name, right.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error(`JRE 阶段产物不得包含符号链接：${relative}`);
      if (stat.isDirectory()) visit(target);
      else if (stat.isFile()) {
        if (!exclude.has(relative)) {
          records.push({
            path: relative,
            size_bytes: stat.size,
            sha256: sha256File(target),
          });
        }
      } else {
        throw new Error(`JRE 阶段产物含不支持的文件类型：${relative}`);
      }
    }
  }
  visit(root);
  return records.sort((left, right) => compareUtf16(left.path, right.path));
}

function requireContained(projectRoot, target, label) {
  const base = path.resolve(projectRoot);
  const resolved = path.resolve(target);
  const relative = path.relative(base, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须位于项目目录内：${resolved}`);
  }
  const realBase = fs.realpathSync.native(base);
  let cursor = base;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} 路径祖先不得为符号链接或 junction：${cursor}`);
    }
  }
  let existing = resolved;
  while (!fs.lstatSync(existing, { throwIfNoEntry: false })) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`${label} 无可验证的已存在祖先：${resolved}`);
    existing = parent;
  }
  const realExisting = fs.realpathSync.native(existing);
  const realRelative = path.relative(realBase, realExisting);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error(`${label} 的真实路径逃逸项目目录：${resolved}`);
  }
  return resolved;
}

function probeEpubCheckCase(
  java,
  jar,
  sample,
  report,
  expectedVersion,
  { label, expectedStatus, expectErrors },
) {
  const result = spawnSync(
    java,
    ["-jar", jar, "--json", report, sample],
    {
      cwd: REPO_ROOT,
      env: cleanJavaEnvironment(),
      encoding: "utf8",
      timeout: 120000,
      windowsHide: true,
      shell: false,
    },
  );
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(report, "utf8"));
  } catch {
    data = null;
  }
  const checker = data?.checker;
  const validCounts = checker &&
    Number.isInteger(checker.nFatal) && checker.nFatal >= 0 &&
    Number.isInteger(checker.nError) && checker.nError >= 0 &&
    Number.isInteger(checker.nWarning) && checker.nWarning >= 0;
  const hasErrors = validCounts && checker.nFatal + checker.nError > 0;
  if (result.error || result.status !== expectedStatus || !validCounts ||
      checker.checkerVersion !== expectedVersion || hasErrors !== expectErrors) {
    throw new Error(
      `捆绑 JRE 的 EpubCheck ${label}探针非法：status=${String(result.status)}`
      + `；checker=${JSON.stringify(checker)}`
      + `；stderr=${result.stderr?.trim() || result.error?.message || "<empty>"}`,
    );
  }
  return {
    status: result.status,
    checker_version: checker.checkerVersion,
    n_fatal: checker.nFatal,
    n_error: checker.nError,
    n_warning: checker.nWarning,
  };
}

function probeEpubCheck(java, epubcheckDir, sample, defectSample, probeRoot, expectedVersion) {
  fs.mkdirSync(probeRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(probeRoot, "epubcheck-jre-"));
  try {
    const jar = path.join(epubcheckDir, "epubcheck.jar");
    const good = probeEpubCheckCase(
      java,
      jar,
      sample,
      path.join(directory, "good.json"),
      expectedVersion,
      { label: "通过样本", expectedStatus: 0, expectErrors: false },
    );
    const defect = probeEpubCheckCase(
      java,
      jar,
      defectSample,
      path.join(directory, "defect.json"),
      expectedVersion,
      { label: "缺陷样本", expectedStatus: 1, expectErrors: true },
    );
    return {
      good,
      defect,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function atomicInstall(staged, destination) {
  const backup = `${destination}.backup-${process.pid}-${Date.now()}`;
  let backedUp = false;
  try {
    if (fs.existsSync(destination)) {
      fs.renameSync(destination, backup);
      backedUp = true;
    }
    fs.renameSync(staged, destination);
    if (backedUp) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(destination) && backedUp && fs.existsSync(backup)) {
      fs.renameSync(backup, destination);
    }
    throw error;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareUtf16).map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function treeInventoryDigest(root) {
  const files = listFiles(root);
  const digest = crypto.createHash("sha256");
  for (const item of files) {
    digest.update(item.path, "utf8");
    digest.update("\0");
    digest.update(String(item.size_bytes), "ascii");
    digest.update("\0");
    digest.update(item.sha256, "ascii");
    digest.update("\n");
  }
  return {
    file_count: files.length,
    total_bytes: files.reduce((sum, item) => sum + item.size_bytes, 0),
    sha256: digest.digest("hex"),
  };
}

function runtimeLockBase({
  release,
  releasePath,
  java,
  jdeps,
  jlink,
  jdkHome,
  distributionManifest,
}) {
  const sourceTree = treeInventoryDigest(jdkHome);
  return {
    schema_version: "1.0",
    lock_type: "oak-jre-runtime",
    target: { platform: TARGET_PLATFORM, arch: TARGET_ARCH },
    runtime: {
      distribution: "Temurin",
      vendor: release.IMPLEMENTOR,
      implementor_version: release.IMPLEMENTOR_VERSION,
      java_version: release.JAVA_VERSION,
      java_runtime_version: release.JAVA_RUNTIME_VERSION,
      feature_version: REQUIRED_JAVA_FEATURE,
    },
    source_jdk: {
      release_sha256: sha256File(releasePath),
      java_sha256: sha256File(java),
      jdeps_sha256: sha256File(jdeps),
      jlink_sha256: sha256File(jlink),
      tree_file_count: sourceTree.file_count,
      tree_total_bytes: sourceTree.total_bytes,
      tree_sha256: sourceTree.sha256,
    },
    epubcheck_distribution_manifest_sha256: sha256File(distributionManifest),
    formal_source_provenance_audit_required: true,
  };
}

function runtimeLockTarget(root) {
  return requireContained(
    root,
    path.join(root, ...RUNTIME_LOCK_RELATIVE.split("/")),
    "JRE 受版本控制锁",
  );
}

function readRuntimeLock(root) {
  const target = runtimeLockTarget(root);
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
    throw new Error(
      `JRE 受版本控制锁缺失：${RUNTIME_LOCK_RELATIVE}。`
      + "只有审计升级时才可显式使用 --update-lock。",
    );
  }
  try {
    return { target, lock: JSON.parse(fs.readFileSync(target, "utf8")) };
  } catch (error) {
    throw new Error(`JRE 受版本控制锁无法解析：${error.message}`);
  }
}

function assertRuntimeLockMatches(actual, expected, { includeRuntimeManifest }) {
  const comparable = includeRuntimeManifest
    ? actual
    : Object.fromEntries(Object.entries(actual).filter(([key]) => key !== "runtime_manifest_sha256"));
  const expectedComparable = includeRuntimeManifest
    ? expected
    : Object.fromEntries(Object.entries(expected).filter(([key]) => key !== "runtime_manifest_sha256"));
  if (JSON.stringify(canonicalJson(comparable)) !== JSON.stringify(canonicalJson(expectedComparable))) {
    throw new Error(
      includeRuntimeManifest
        ? "JRE 阶段产物与受版本控制锁不一致"
        : "源 JDK 或 EpubCheck 分发与受版本控制锁不一致；拒绝执行构建工具",
    );
  }
}

function commitRuntimeAndLockTransaction({
  staged,
  destination,
  lockTarget,
  lock,
  operations = fs,
}) {
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const runtimeBackup = `${destination}.previous-${suffix}`;
  const lockStage = `${lockTarget}.stage-${suffix}`;
  const lockBackup = `${lockTarget}.previous-${suffix}`;
  const lockText = `${JSON.stringify(lock, null, 2)}\n`;
  const stagedStat = operations.lstatSync(staged, { throwIfNoEntry: false });
  const destinationStat = operations.lstatSync(destination, { throwIfNoEntry: false });
  const lockStat = operations.lstatSync(lockTarget, { throwIfNoEntry: false });
  if (!stagedStat || !stagedStat.isDirectory() || stagedStat.isSymbolicLink()) {
    throw new Error(`JRE 候选目录缺失或不安全：${staged}`);
  }
  if (destinationStat &&
      (!destinationStat.isDirectory() || destinationStat.isSymbolicLink())) {
    throw new Error(`JRE 目标必须是普通目录：${destination}`);
  }
  if (lockStat && (!lockStat.isFile() || lockStat.isSymbolicLink())) {
    throw new Error(`JRE 受版本控制锁必须是普通文件：${lockTarget}`);
  }
  const hadDestination = Boolean(destinationStat);
  const hadLock = Boolean(lockStat);
  let runtimeBackedUp = false;
  let runtimeInstalled = false;
  let lockBackedUp = false;
  let lockInstalled = false;
  let committed = false;

  try {
    operations.mkdirSync(path.dirname(lockTarget), { recursive: true });
    operations.writeFileSync(lockStage, lockText, { encoding: "utf8", flag: "wx" });
    const candidateText = operations.readFileSync(lockStage, "utf8");
    let candidate;
    try {
      candidate = JSON.parse(candidateText);
    } catch (error) {
      throw new Error(`JRE 候选锁无法解析：${error.message}`);
    }
    if (candidateText !== lockText ||
        JSON.stringify(canonicalJson(candidate)) !== JSON.stringify(canonicalJson(lock))) {
      throw new Error("JRE 候选锁写入后校验不一致");
    }

    // The tracked lock remains untouched until the staged runtime has been
    // installed. If this directory swap fails, only the runtime backup needs
    // restoration and the old lock bytes never move.
    if (hadDestination) {
      operations.renameSync(destination, runtimeBackup);
      runtimeBackedUp = true;
    }
    operations.renameSync(staged, destination);
    runtimeInstalled = true;

    // Commit the lock only after the runtime swap. Keep both old identities
    // available until both renames succeed so a lock failure can restore the
    // exact previous lock bytes and the exact previous runtime directory.
    if (hadLock) {
      operations.renameSync(lockTarget, lockBackup);
      lockBackedUp = true;
    }
    operations.renameSync(lockStage, lockTarget);
    lockInstalled = true;
    committed = true;
  } catch (error) {
    const rollbackErrors = [];
    const rollback = (label, action) => {
      try {
        action();
      } catch (rollbackError) {
        rollbackErrors.push(`${label}：${rollbackError.message}`);
      }
    };

    if (lockInstalled && operations.existsSync(lockTarget)) {
      rollback("无法撤回未提交的新 JRE 锁", () => {
        operations.renameSync(lockTarget, lockStage);
      });
    }
    if (lockBackedUp && operations.existsSync(lockBackup) &&
        !operations.existsSync(lockTarget)) {
      rollback("无法恢复旧 JRE 锁", () => {
        operations.renameSync(lockBackup, lockTarget);
      });
    }
    if (runtimeInstalled && operations.existsSync(destination)) {
      rollback("无法撤回未提交的新 JRE", () => {
        operations.renameSync(destination, staged);
      });
    }
    if (runtimeBackedUp && operations.existsSync(runtimeBackup) &&
        !operations.existsSync(destination)) {
      rollback("无法恢复旧 JRE", () => {
        operations.renameSync(runtimeBackup, destination);
      });
    }
    if (operations.existsSync(lockStage)) {
      rollback("无法清理未提交的 JRE 候选锁", () => {
        operations.rmSync(lockStage, { force: true });
      });
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${error.message}；JRE/lock 事务回滚失败：${rollbackErrors.join("；")}`);
    }
    throw error;
  } finally {
    if (committed) {
      // Cleanup happens only after both identities are committed. A cleanup
      // failure must not turn a consistent new runtime/lock pair into a
      // partial rollback; stale backups remain recoverable and unreferenced.
      for (const [target, options] of [
        [runtimeBackup, { recursive: true, force: true }],
        [lockBackup, { force: true }],
        [lockStage, { force: true }],
      ]) {
        if (!operations.existsSync(target)) continue;
        try {
          operations.rmSync(target, options);
        } catch {
          // Best-effort post-commit cleanup.
        }
      }
    }
  }
  return { destination, lockTarget };
}

function stageEpubCheckJre({
  projectRoot = REPO_ROOT,
  jdkHome = null,
  destination = null,
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  updateLock = false,
} = {}) {
  const root = path.resolve(projectRoot);
  validateSourceJdkRelease({
    IMPLEMENTOR: "Eclipse Adoptium",
    IMPLEMENTOR_VERSION: REQUIRED_IMPLEMENTOR_VERSION,
    JAVA_VERSION: REQUIRED_JAVA_VERSION,
    JAVA_RUNTIME_VERSION: REQUIRED_JAVA_RUNTIME_VERSION,
    OS_NAME: "Windows",
    OS_ARCH: "x86_64",
    IMAGE_TYPE: "JDK",
  }, { platform, arch });

  const resolvedJdk = resolveJdkHome({ explicit: jdkHome, env, platform });
  const jdkStat = fs.lstatSync(resolvedJdk);
  if (!jdkStat.isDirectory() || jdkStat.isSymbolicLink()) {
    throw new Error(`源 Temurin JDK 目录不安全：${resolvedJdk}`);
  }
  const releasePath = path.join(resolvedJdk, "release");
  const noticePath = path.join(resolvedJdk, "NOTICE");
  const releaseText = fs.readFileSync(releasePath, "utf8");
  const release = validateSourceJdkRelease(parseReleaseFile(releaseText), { platform, arch });
  const java = path.join(resolvedJdk, "bin", executableName("java", platform));
  const jdeps = path.join(resolvedJdk, "bin", executableName("jdeps", platform));
  const jlink = path.join(resolvedJdk, "bin", executableName("jlink", platform));
  const distributionGate = verifyDistribution(root);
  const sourceLock = runtimeLockBase({
    release,
    releasePath,
    java,
    jdeps,
    jlink,
    jdkHome: resolvedJdk,
    distributionManifest: distributionGate.manifestTarget,
  });
  if (!updateLock) {
    const currentLock = readRuntimeLock(root).lock;
    assertRuntimeLockMatches(currentLock, sourceLock, { includeRuntimeManifest: false });
  }
  if (windowsExecutableArch(java) !== TARGET_ARCH) {
    throw new Error("源 Temurin java.exe 不是 Windows x64 PE");
  }
  for (const tool of [java, jdeps, jlink]) {
    const version = runChecked(tool, ["--version"], { env }).stdout.trim();
    if (javaFeature(version) !== REQUIRED_JAVA_FEATURE) {
      throw new Error(`${path.basename(tool)} 版本必须属于 Java 21，实际 ${version}`);
    }
  }

  const epubcheckDir = requireContained(root, distributionGate.distribution, "EpubCheck 目录");
  const jar = requireContained(root, distributionGate.entry, "EpubCheck JAR");
  const lib = path.join(epubcheckDir, "lib", "*");
  const sample = requireContained(root, path.join(root, "samples", "epub_good.epub"), "探针样本");
  const defectSample = requireContained(
    root,
    path.join(root, "samples", "epub_needs_review.epub"),
    "缺陷探针样本",
  );
  for (const required of [jar, sample, defectSample]) {
    if (!fs.statSync(required, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`JRE 阶段化缺少输入文件：${path.relative(root, required)}`);
    }
  }

  const jdepsResult = runChecked(jdeps, [
    "--multi-release", String(REQUIRED_JAVA_FEATURE),
    "--ignore-missing-deps",
    "--print-module-deps",
    "--class-path", lib,
    jar,
  ], { env });
  const jdepsModules = parseModuleList(jdepsResult.stdout);
  const toolsRoot = requireContained(root, path.join(root, "tools"), "JRE 输出目录");
  fs.mkdirSync(toolsRoot, { recursive: true });
  const finalDestination = requireContained(
    root,
    destination || path.join(toolsRoot, "jre-win32-x64"),
    "JRE 最终目录",
  );
  const stageContainer = fs.mkdtempSync(path.join(toolsRoot, ".jre-win32-x64-stage-"));
  const staged = path.join(stageContainer, "runtime");

  const jlinkOptions = [
    "--module-path", path.join(resolvedJdk, "jmods"),
    "--add-modules", JLINK_REQUESTED_MODULES.join(","),
    "--output", staged,
    "--strip-debug",
    "--no-header-files",
    "--no-man-pages",
    "--compress=2",
  ];
  try {
    runChecked(jlink, jlinkOptions, { env, timeout: 180000 });
    fs.copyFileSync(noticePath, path.join(staged, "NOTICE"));
    fs.writeFileSync(path.join(staged, "SOURCE_JDK_RELEASE.txt"), releaseText, "utf8");

    const stagedJava = path.join(staged, "bin", "java.exe");
    if (windowsExecutableArch(stagedJava) !== TARGET_ARCH) {
      throw new Error("jlink 生成的 java.exe 不是 Windows x64 PE");
    }
    const actualModules = parseModuleList(
      runChecked(stagedJava, ["--list-modules"], { env }).stdout,
    );
    for (const moduleName of jdepsModules) {
      if (!actualModules.includes(moduleName)) {
        throw new Error(`jlink 运行时漏掉 jdeps 模块：${moduleName}`);
      }
    }
    for (const moduleName of JLINK_REQUESTED_MODULES) {
      if (!actualModules.includes(moduleName)) {
        throw new Error(`jlink 运行时漏掉固定保守模块：${moduleName}`);
      }
    }
    const probe = probeEpubCheck(
      stagedJava,
      epubcheckDir,
      sample,
      defectSample,
      path.join(root, "out"),
      EPUBCHECK_VERSION,
    );

    const licenseMaterials = listFiles(staged)
      .map((item) => item.path)
      .filter((relative) => relative === "NOTICE" || relative.startsWith("legal/"));
    for (const required of ["NOTICE", "legal/java.base/LICENSE"]) {
      if (!licenseMaterials.includes(required)) {
        throw new Error(`jlink 运行时缺少许可证材料：${required}`);
      }
    }
    const notices = [
      "# Temurin JRE third-party notices",
      "",
      `Distribution: ${release.IMPLEMENTOR_VERSION}`,
      `Java runtime: ${release.JAVA_RUNTIME_VERSION}`,
      "Source: the locally installed Eclipse Adoptium Temurin JDK recorded in SOURCE_JDK_RELEASE.txt.",
      "License materials: NOTICE and the complete legal/ directory produced by jlink.",
      "Purpose: minimal local runtime for EpubCheck 5.3.0.",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(staged, "THIRD_PARTY_NOTICES.md"), notices, "utf8");

    const finalLicenseMaterials = [
      "NOTICE",
      "SOURCE_JDK_RELEASE.txt",
      "THIRD_PARTY_NOTICES.md",
      ...licenseMaterials.filter((item) => item !== "NOTICE"),
    ].sort(compareUtf16);
    const files = listFiles(staged, { exclude: new Set(["manifest.json"]) });
    const manifest = {
      schema_version: JRE_SCHEMA_VERSION,
      runtime: {
        distribution: "Temurin",
        vendor: release.IMPLEMENTOR,
        implementor_version: release.IMPLEMENTOR_VERSION,
        java_version: release.JAVA_VERSION,
        java_runtime_version: release.JAVA_RUNTIME_VERSION,
        feature_version: REQUIRED_JAVA_FEATURE,
      },
      target: { platform: TARGET_PLATFORM, arch: TARGET_ARCH },
      entry: "bin/java.exe",
      module_policy: JLINK_MODULE_POLICY,
      requested_modules: [...JLINK_REQUESTED_MODULES],
      modules: actualModules,
      jdeps_modules: jdepsModules,
      jlink_options: jlinkOptions.map((item) => (
        item === staged ? "<staging-output>" :
          item === path.join(resolvedJdk, "jmods") ? "<source-jdk>/jmods" : item
      )),
      source_jdk: {
        release_file: "SOURCE_JDK_RELEASE.txt",
        release_sha256: sha256File(path.join(staged, "SOURCE_JDK_RELEASE.txt")),
        notice_file: "NOTICE",
        notice_sha256: sha256File(path.join(staged, "NOTICE")),
      },
      epubcheck_probe: {
        version: EPUBCHECK_VERSION,
        jar_sha256: sha256File(jar),
        distribution_manifest: path.relative(root, distributionGate.manifestTarget)
          .split(path.sep).join("/"),
        distribution_manifest_sha256: sha256File(distributionGate.manifestTarget),
        sample: "samples/epub_good.epub",
        sample_sha256: sha256File(sample),
        ...probe.good,
        defect_sample: "samples/epub_needs_review.epub",
        defect_sample_sha256: sha256File(defectSample),
        defect: probe.defect,
      },
      license_materials: finalLicenseMaterials,
      file_count: files.length,
      total_bytes: files.reduce((sum, item) => sum + item.size_bytes, 0),
      files,
    };
    const runtimeManifestPath = path.join(staged, "manifest.json");
    fs.writeFileSync(
      runtimeManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    const expectedLock = {
      ...sourceLock,
      runtime_manifest_sha256: sha256File(runtimeManifestPath),
    };
    if (updateLock) {
      commitRuntimeAndLockTransaction({
        staged,
        destination: finalDestination,
        lockTarget: runtimeLockTarget(root),
        lock: expectedLock,
      });
    } else {
      const currentLock = readRuntimeLock(root).lock;
      assertRuntimeLockMatches(currentLock, expectedLock, { includeRuntimeManifest: true });
      atomicInstall(staged, finalDestination);
    }
    fs.rmSync(stageContainer, { recursive: true, force: true });
    return { destination: finalDestination, manifest };
  } catch (error) {
    fs.rmSync(stageContainer, { recursive: true, force: true });
    throw error;
  }
}

function parseArgs(argv) {
  const result = { jdkHome: null, updateLock: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--jdk-home") result.jdkHome = argv[++index];
    else if (argv[index] === "--update-lock") result.updateLock = true;
    else throw new Error(`未知参数：${argv[index]}`);
  }
  return result;
}

if (require.main === module) {
  try {
    const result = stageEpubCheckJre(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({
      ok: true,
      destination: path.relative(REPO_ROOT, result.destination).split(path.sep).join("/"),
      java_version: result.manifest.runtime.java_version,
      modules: result.manifest.modules,
      file_count: result.manifest.file_count,
      total_bytes: result.manifest.total_bytes,
      epubcheck_probe: result.manifest.epubcheck_probe,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  JRE_SCHEMA_VERSION,
  JLINK_MODULE_POLICY,
  JLINK_REQUESTED_MODULES,
  RUNTIME_LOCK_RELATIVE,
  REQUIRED_IMPLEMENTOR_VERSION,
  REQUIRED_JAVA_FEATURE,
  REQUIRED_JAVA_RUNTIME_VERSION,
  REQUIRED_JAVA_VERSION,
  cleanJavaEnvironment,
  commitRuntimeAndLockTransaction,
  javaFeature,
  listFiles,
  parseModuleList,
  parseReleaseFile,
  requireContained,
  resolveJdkHome,
  runtimeLockBase,
  treeInventoryDigest,
  stageEpubCheckJre,
  validateSourceJdkRelease,
};
