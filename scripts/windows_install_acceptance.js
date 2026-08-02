"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { UUID } = require("builder-util-runtime");

const { verifyReleaseEvidence } = require("./release_artifact_manifest");
const {
  DEFAULT_TIMEOUT_MS,
  FAIL_MARKER,
  PASS_MARKER,
  PRODUCT_EXE,
  createSmokeEnvironment,
  ensureLocalDirectory,
  isInside,
  smokeArguments,
  verifyWindowsX64Executable,
} = require("./run_packaged_smoke");
const { readSafeRegularFile } = require("./safe_tracked_file");
const { parseJsonStrict } = require("./strict_json");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SCHEMA_VERSION = 1;
const PREVIOUS_VERSION = "0.1.0-alpha.12";
const PRODUCT = "湖岸稿件 Oak Manuscript";
const APP_ID = "com.oakbylake.manuscript";
const ELECTRON_BUILDER_NS_UUID = UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3");
const APP_GUID = UUID.v5(APP_ID, ELECTRON_BUILDER_NS_UUID);
const UNINSTALL_EXE = `Uninstall ${PRODUCT}.exe`;
const MANIFEST_NAME = "release-manifest-win32-x64.json";
const CHECKSUM_NAME = "SHA256SUMS.txt";
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const UNINSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{7,63}$/u;
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const HASH_RE = /^[0-9a-f]{64}$/u;
const MUTATION_EFFECTS = Object.freeze([
  "HKCU registry",
  "Desktop shortcut",
  "Start Menu shortcut",
  "project-local install directory",
]);
const REQUIRED_PHASES = Object.freeze([
  "install_previous",
  "smoke_previous",
  "upgrade_current",
  "smoke_current",
  "persistence_after_upgrade",
  "downgrade_probe",
  "smoke_after_downgrade_probe",
  "uninstall_current",
  "post_uninstall",
]);
const UNSAFE_ENV_NAMES = new Set([
  "appdata",
  "home",
  "localappdata",
  "sslkeylogfile",
  "temp",
  "tmp",
  "tmpdir",
  "userprofile",
  "xdg_cache_home",
  "xdg_config_home",
  "xdg_data_home",
]);

function comparablePath(value, hostPlatform = process.platform) {
  const normalized = path.normalize(value);
  return hostPlatform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertInside(root, target, label, { allowEqual = false } = {}) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if ((!allowEqual && relative === "") || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须${allowEqual ? "位于" : "严格位于"}项目目录内：${target}`);
  }
}

function safeFile(root, target, label) {
  const projectRoot = path.resolve(root);
  const absolute = path.resolve(target);
  assertInside(projectRoot, absolute, label);
  const record = readSafeRegularFile(projectRoot, absolute, label);
  if (record.stat.nlink !== 1n || record.stat.size <= 0n) {
    throw new Error(`${label} 必须是非空、单链接普通文件：${absolute}`);
  }
  return { absolute, ...record };
}

function hashSafeFile(root, target, label) {
  const record = safeFile(root, target, label);
  return {
    path: record.absolute,
    size_bytes: Number(record.stat.size),
    sha256: crypto.createHash("sha256").update(record.bytes).digest("hex"),
  };
}

function verifyWindowsInstallerExecutable(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Windows 安装器不存在：${target}`);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 128) {
    throw new Error(`Windows 安装器不是安全的非空常规文件：${target}`);
  }
  const handle = fs.openSync(target, "r");
  try {
    const dos = Buffer.alloc(64);
    if (fs.readSync(handle, dos, 0, dos.length, 0) !== dos.length || dos.toString("ascii", 0, 2) !== "MZ") {
      throw new Error(`Windows 安装器缺少 DOS MZ 文件头：${target}`);
    }
    const peOffset = dos.readUInt32LE(0x3c);
    if (peOffset < 64 || peOffset > stat.size - 26) throw new Error(`Windows 安装器 PE 头偏移非法：${target}`);
    const pe = Buffer.alloc(26);
    if (fs.readSync(handle, pe, 0, pe.length, peOffset) !== pe.length ||
        !pe.subarray(0, 4).equals(Buffer.from("PE\0\0", "binary"))) {
      throw new Error(`Windows 安装器缺少有效 PE 签名：${target}`);
    }
    const machine = pe.readUInt16LE(4);
    const magic = pe.readUInt16LE(24);
    const identity = machine === 0x014c && magic === 0x010b
      ? { launcher_arch: "x86", format: "PE32", size: stat.size }
      : machine === 0x8664 && magic === 0x020b
        ? { launcher_arch: "x64", format: "PE32+", size: stat.size }
        : null;
    if (!identity) {
      throw new Error(
        `Windows 安装器必须为 x86 PE32 或 x64 PE32+；machine=0x${machine.toString(16)}`
        + `，magic=0x${magic.toString(16)}`,
      );
    }
    return identity;
  } finally {
    fs.closeSync(handle);
  }
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((item, index) => item !== wanted[index])) {
    throw new Error(`${label} 字段集合不严格匹配：${actual.join(", ")}`);
  }
}

function parseSemver(value, label) {
  const match = typeof value === "string" ? value.match(VERSION_RE) : null;
  if (!match) throw new Error(`${label} 不是合法 SemVer：${value}`);
  const prerelease = match[4] === undefined ? null : match[4].split(".");
  if (prerelease?.some((item) => /^\d+$/u.test(item) && item.length > 1 && item.startsWith("0"))) {
    throw new Error(`${label} 不是合法 SemVer：${value}`);
  }
  return {
    raw: value,
    core: match.slice(1, 4),
    prerelease,
  };
}

function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue, "左版本");
  const right = parseSemver(rightValue, "右版本");
  for (let index = 0; index < 3; index += 1) {
    const compared = compareNumericIdentifiers(left.core[index], right.core[index]);
    if (compared !== 0) return compared;
  }
  if (left.prerelease === null || right.prerelease === null) {
    if (left.prerelease === right.prerelease) return 0;
    return left.prerelease === null ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const l = left.prerelease[index];
    const r = right.prerelease[index];
    if (l === undefined || r === undefined) return l === undefined ? -1 : 1;
    if (l === r) continue;
    const lNumeric = /^\d+$/u.test(l);
    const rNumeric = /^\d+$/u.test(r);
    if (lNumeric && rNumeric) return compareNumericIdentifiers(l, r);
    if (lNumeric !== rNumeric) return lNumeric ? -1 : 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

function validateReleaseManifest(manifest, { expectedVersion, label }) {
  if (!manifest || ![1, 2].includes(manifest.schema_version)) {
    throw new Error(`${label} schema_version 不受支持`);
  }
  const topKeys = ["schema_version", "product", "app_id", "version", "target", "artifacts", "sha256sums"];
  if (manifest.schema_version === 2) topKeys.push("packaged_smoke");
  exactKeys(manifest, topKeys, label);
  exactKeys(manifest.target, ["platform", "arch"], `${label}.target`);
  exactKeys(manifest.sha256sums, ["filename", "sha256"], `${label}.sha256sums`);
  if (manifest.product !== PRODUCT || manifest.app_id !== APP_ID ||
      manifest.version !== expectedVersion || manifest.target.platform !== "win32" ||
      manifest.target.arch !== "x64" || manifest.sha256sums.filename !== CHECKSUM_NAME ||
      !HASH_RE.test(manifest.sha256sums.sha256)) {
    throw new Error(`${label} 身份、版本或目标不匹配`);
  }
  if (manifest.schema_version === 2) {
    exactKeys(
      manifest.packaged_smoke,
      ["filename", "size_bytes", "sha256", "executable_sha256", "output_tree_sha256"],
      `${label}.packaged_smoke`,
    );
    if (manifest.packaged_smoke.filename !== "packaged-smoke-evidence-win32-x64.json" ||
        !Number.isSafeInteger(manifest.packaged_smoke.size_bytes) ||
        manifest.packaged_smoke.size_bytes <= 0 ||
        ![manifest.packaged_smoke.sha256, manifest.packaged_smoke.executable_sha256,
          manifest.packaged_smoke.output_tree_sha256].every((item) => HASH_RE.test(item))) {
      throw new Error(`${label} packaged_smoke 绑定非法`);
    }
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 2) {
    throw new Error(`${label} 必须恰好包含 NSIS 与 ZIP 两项制品`);
  }
  const kinds = new Set();
  for (const [index, artifact] of manifest.artifacts.entries()) {
    exactKeys(artifact, ["filename", "kind", "size_bytes", "sha256"], `${label}.artifacts[${index}]`);
    if (!["nsis", "zip"].includes(artifact.kind) || kinds.has(artifact.kind) ||
        !Number.isSafeInteger(artifact.size_bytes) || artifact.size_bytes <= 0 ||
        !HASH_RE.test(artifact.sha256) || path.basename(artifact.filename) !== artifact.filename) {
      throw new Error(`${label} 制品记录非法或重复：${artifact.filename}`);
    }
    const expected = `Oak-Manuscript-${expectedVersion}-Windows-x64.${artifact.kind === "nsis" ? "exe" : "zip"}`;
    if (artifact.filename !== expected) throw new Error(`${label} 制品名不匹配：${artifact.filename}`);
    kinds.add(artifact.kind);
  }
  return manifest;
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function verifyArchivedRelease({ root = PROJECT_ROOT, version = PREVIOUS_VERSION } = {}) {
  const projectRoot = path.resolve(root);
  const archiveRoot = path.join(projectRoot, "release", "archive", version);
  assertInside(projectRoot, archiveRoot, "旧版归档目录");
  const manifestRecord = safeFile(projectRoot, path.join(archiveRoot, MANIFEST_NAME), "旧版发布 manifest");
  const manifest = validateReleaseManifest(
    parseJsonStrict(manifestRecord.bytes.toString("utf8"), "旧版发布 manifest"),
    { expectedVersion: version, label: "旧版发布 manifest" },
  );
  if (!manifestRecord.bytes.equals(canonicalJson(manifest))) throw new Error("旧版发布 manifest 不是 canonical UTF-8/LF");
  const sums = safeFile(projectRoot, path.join(archiveRoot, CHECKSUM_NAME), "旧版 SHA256SUMS");
  const expectedSums = Buffer.from(
    `${manifest.artifacts.map((item) => `${item.sha256}  ${item.filename}`).join("\n")}\n`,
    "utf8",
  );
  if (!sums.bytes.equals(expectedSums) || crypto.createHash("sha256").update(sums.bytes).digest("hex") !== manifest.sha256sums.sha256) {
    throw new Error("旧版 SHA256SUMS 与 manifest 不一致");
  }
  for (const artifact of manifest.artifacts) {
    const actual = hashSafeFile(projectRoot, path.join(archiveRoot, artifact.filename), `旧版制品 ${artifact.filename}`);
    if (actual.size_bytes !== artifact.size_bytes || actual.sha256 !== artifact.sha256) {
      throw new Error(`旧版制品哈希或大小不匹配：${artifact.filename}`);
    }
    if (artifact.kind === "nsis") verifyWindowsInstallerExecutable(actual.path);
  }
  return JSON.parse(JSON.stringify(manifest));
}

function artifactByKind(manifest, kind, baseDir) {
  const artifact = manifest.artifacts.find((item) => item.kind === kind);
  if (!artifact) throw new Error(`发布 manifest 缺少 ${kind} 制品`);
  return { ...artifact, version: manifest.version, path: path.join(baseDir, artifact.filename) };
}

function createPreflightPlan({
  root = PROJECT_ROOT,
  hostPlatform = process.platform,
  hostArch = process.arch,
  previousVersion = PREVIOUS_VERSION,
  verifyCurrent = verifyReleaseEvidence,
  verifyPrevious = verifyArchivedRelease,
} = {}) {
  if (hostPlatform !== "win32" || hostArch !== "x64") {
    throw new Error(`Windows 安装验收只接受 win32/x64 主机；当前为 ${hostPlatform}/${hostArch}`);
  }
  const projectRoot = path.resolve(root);
  const rootStat = fs.lstatSync(projectRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`项目根目录不安全：${projectRoot}`);
  const currentManifest = validateReleaseManifest(
    verifyCurrent({ root: projectRoot, platform: "win32", arch: "x64" }),
    { expectedVersion: require(path.join(projectRoot, "package.json")).version, label: "当前发布 manifest" },
  );
  const previousManifest = validateReleaseManifest(
    verifyPrevious({ root: projectRoot, version: previousVersion }),
    { expectedVersion: previousVersion, label: "旧版发布 manifest" },
  );
  if (compareSemver(previousManifest.version, currentManifest.version) >= 0) {
    throw new Error(`旧版 ${previousManifest.version} 必须严格早于当前版 ${currentManifest.version}`);
  }
  const current = artifactByKind(currentManifest, "nsis", path.join(projectRoot, "release"));
  const previous = artifactByKind(previousManifest, "nsis", path.join(projectRoot, "release", "archive", previousVersion));
  for (const [label, artifact] of [["当前安装器", current], ["旧版安装器", previous]]) {
    assertInside(projectRoot, artifact.path, label);
    verifyWindowsInstallerExecutable(artifact.path);
  }
  return {
    schema_version: SCHEMA_VERSION,
    mode: "preflight",
    product: PRODUCT,
    app_id: APP_ID,
    host: { platform: hostPlatform, arch: hostArch },
    current,
    previous,
    lifecycle: [...REQUIRED_PHASES],
    mutation_gate: {
      authorized: false,
      required_flag: "--allow-system-mutation",
      effects: [...MUTATION_EFFECTS],
    },
    ready_for_authorized_run: true,
  };
}

function validateRunId(value) {
  if (typeof value !== "string" || !RUN_ID_RE.test(value)) throw new Error(`安装验收运行 ID 非法：${value}`);
  return value;
}

function createRunId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}`;
}

function installPaths(root, runId) {
  const projectRoot = path.resolve(root);
  const id = validateRunId(runId);
  const acceptanceRoot = path.join(projectRoot, "out", "install-acceptance");
  const runRoot = path.join(acceptanceRoot, "runs", id);
  const installDir = path.join(acceptanceRoot, "installations", id);
  const paths = {
    projectRoot,
    acceptanceRoot,
    runRoot,
    installDir,
    executable: path.join(installDir, PRODUCT_EXE),
    uninstaller: path.join(installDir, UNINSTALL_EXE),
    persistenceRoot: path.join(runRoot, "persistent-user-data"),
    persistenceSentinel: path.join(runRoot, "persistent-user-data", "acceptance-sentinel.json"),
    processTemp: path.join(runRoot, "installer-temp"),
    evidenceFile: path.join(runRoot, "windows-install-acceptance-v1.json"),
  };
  for (const [label, target] of Object.entries(paths)) {
    if (label === "projectRoot") continue;
    assertInside(projectRoot, target, label);
  }
  return paths;
}

function createInstallerEnvironment(paths, inherited = process.env) {
  const result = {};
  for (const [name, value] of Object.entries(inherited)) {
    const lower = name.toLowerCase();
    if (lower.startsWith("oak_") || lower.startsWith("electron_") ||
        lower.startsWith("node_") || lower.startsWith("python") ||
        lower.startsWith("java_") || lower.startsWith("jdk_java_") ||
        lower.includes("proxy") || UNSAFE_ENV_NAMES.has(lower)) continue;
    result[name] = value;
  }
  return {
    ...result,
    TEMP: paths.processTemp,
    TMP: paths.processTemp,
    TMPDIR: paths.processTemp,
  };
}

function smokePaths(paths, phase) {
  if (!/^[a-z][a-z0-9_]{2,63}$/u.test(phase)) throw new Error(`冒烟阶段名非法：${phase}`);
  const root = path.join(paths.runRoot, "smoke", phase);
  const result = {
    projectRoot: paths.projectRoot,
    executable: paths.executable,
    outRoot: path.join(paths.projectRoot, "out"),
    smokeRoot: root,
    projectOutput: path.join(root, "projects"),
    temp: path.join(root, "tmp"),
    userData: paths.persistenceRoot,
    diskCache: path.join(root, "electron-cache"),
    home: path.join(root, "home"),
    appData: path.join(root, "home", "AppData", "Roaming"),
    localAppData: path.join(root, "home", "AppData", "Local"),
    xdgCache: path.join(root, "xdg-cache"),
    xdgConfig: path.join(root, "xdg-config"),
    xdgData: path.join(root, "xdg-data"),
    crashDumps: path.join(root, "crash-dumps"),
  };
  for (const [label, target] of Object.entries(result)) {
    if (["projectRoot", "executable", "outRoot"].includes(label)) continue;
    assertInside(paths.runRoot, target, `冒烟 ${label}`);
  }
  return result;
}

function sanitizeProcessRecord(result) {
  if (!result || typeof result !== "object") throw new Error("子进程未返回结果对象");
  return {
    status: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal || null,
    error: result.error ? { code: result.error.code || null, message: String(result.error.message || result.error) } : null,
    stdout_tail: String(result.stdout || "").slice(-4000),
    stderr_tail: String(result.stderr || "").slice(-4000),
  };
}

function assertSuccessfulProcess(record, label) {
  if (record.error) throw new Error(`${label} 无法启动：${record.error.message}`);
  if (record.signal) throw new Error(`${label} 被信号 ${record.signal} 终止`);
  if (record.status !== 0) throw new Error(`${label} 退出码为 ${String(record.status)}`);
}

function validateDowngradeProbeProcess(result) {
  const record = sanitizeProcessRecord(result);
  if (record.error) throw new Error(`旧版回装探测无法启动：${record.error.message}`);
  if (record.signal) throw new Error(`旧版回装探测被信号 ${record.signal} 终止`);
  if (!Number.isInteger(record.status)) throw new Error("旧版回装探测没有可判定的退出状态");
  return record;
}

function runHidden(spawn, command, args, { cwd, env, timeoutMs, label }) {
  const result = spawn(command, args, {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const record = sanitizeProcessRecord(result);
  assertSuccessfulProcess(record, label);
  return record;
}

function registryExecutable(inheritedEnv = process.env) {
  const windowsRoot = inheritedEnv.SystemRoot || inheritedEnv.WINDIR;
  if (typeof windowsRoot !== "string" || !path.win32.isAbsolute(windowsRoot)) {
    throw new Error("Windows 集成探针缺少绝对 SystemRoot/WINDIR");
  }
  return path.win32.join(windowsRoot, "System32", "reg.exe");
}

function registryQuery(spawn, regExe, key, value, { cwd, env }) {
  const result = spawn(regExe, ["query", key, "/v", value], {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const record = sanitizeProcessRecord(result);
  if (record.error || record.signal || ![0, 1].includes(record.status)) {
    throw new Error(`注册表查询异常：${key} /v ${value}`);
  }
  if (record.status === 1) return null;
  const match = record.stdout_tail.match(/\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/imu);
  if (!match) throw new Error(`注册表查询缺少字符串值：${key} /v ${value}`);
  return match[1];
}

function shortcutStatus(target) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return false;
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`快捷方式不是安全普通文件：${target}`);
  return true;
}

function probeWindowsIntegration({
  root,
  installDir,
  expectedPresent,
  expectedVersion = null,
  spawn = spawnSync,
  inheritedEnv = process.env,
} = {}) {
  if (typeof expectedPresent !== "boolean") throw new Error("Windows 集成探针必须声明 expectedPresent");
  if (expectedPresent && (typeof expectedVersion !== "string" || !VERSION_RE.test(expectedVersion))) {
    throw new Error("Windows 集成探针必须提供期望版本");
  }
  const projectRoot = path.resolve(root);
  assertInside(projectRoot, installDir, "集成探针安装目录");
  const env = createInstallerEnvironment({ processTemp: path.join(projectRoot, "out", "install-acceptance", "probe-temp") }, inheritedEnv);
  const regExe = registryExecutable(inheritedEnv);
  const appKey = `HKCU\\Software\\${APP_GUID}`;
  const uninstallKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_GUID}`;
  const shellKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders";
  const installedLocation = registryQuery(spawn, regExe, appKey, "InstallLocation", { cwd: projectRoot, env });
  const displayVersion = registryQuery(spawn, regExe, uninstallKey, "DisplayVersion", { cwd: projectRoot, env });
  const desktopRoot = registryQuery(spawn, regExe, shellKey, "Desktop", { cwd: projectRoot, env });
  const startMenuRoot = registryQuery(spawn, regExe, shellKey, "Start Menu", { cwd: projectRoot, env });
  if (!desktopRoot || !path.win32.isAbsolute(desktopRoot) || !startMenuRoot || !path.win32.isAbsolute(startMenuRoot)) {
    throw new Error("无法解析当前用户 Desktop/Start Menu 目录");
  }
  const desktopShortcut = path.win32.join(desktopRoot, `${PRODUCT}.lnk`);
  const startMenuShortcut = path.win32.join(startMenuRoot, "Programs", `${PRODUCT}.lnk`);
  const desktopPresent = shortcutStatus(desktopShortcut);
  const startMenuPresent = shortcutStatus(startMenuShortcut);
  if (expectedPresent) {
    if (installedLocation === null || comparablePath(installedLocation, "win32") !== comparablePath(installDir, "win32")) {
      throw new Error("安装注册表 InstallLocation 缺失或不匹配");
    }
    if (displayVersion !== expectedVersion) throw new Error(`卸载注册表版本应为 ${expectedVersion}，实际为 ${displayVersion}`);
    if (!desktopPresent || !startMenuPresent) throw new Error("安装后 Desktop 或 Start Menu 快捷方式缺失");
  } else if (installedLocation !== null || displayVersion !== null || desktopPresent || startMenuPresent) {
    throw new Error("卸载后仍残留注册表或快捷方式");
  }
  return {
    registry_install_location: installedLocation !== null,
    registry_display_version: displayVersion,
    desktop_shortcut: desktopPresent,
    start_menu_shortcut: startMenuPresent,
  };
}

function runInstalledSmoke({ paths, phase, expectedVersion, spawn, inheritedEnv, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  verifyWindowsX64Executable(paths.executable);
  const executableReal = fs.realpathSync.native(paths.executable);
  const rootReal = fs.realpathSync.native(paths.projectRoot);
  if (!isInside(rootReal, executableReal)) throw new Error(`已安装 EXE 真实路径逃逸项目：${paths.executable}`);
  const dirs = smokePaths(paths, phase);
  for (const [name, target] of Object.entries(dirs)) {
    if (["projectRoot", "executable", "outRoot"].includes(name)) continue;
    ensureLocalDirectory(paths.projectRoot, target);
  }
  const result = spawn(paths.executable, smokeArguments(dirs), {
    cwd: paths.projectRoot,
    env: createSmokeEnvironment(dirs, inheritedEnv, expectedVersion, {
      expectedPackaged: "1",
      externalValidation: true,
    }),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const record = sanitizeProcessRecord(result);
  assertSuccessfulProcess(record, `${phase} 已安装应用冒烟`);
  const combined = `${record.stdout_tail}\n${record.stderr_tail}`;
  const passLines = combined.split(/\r?\n/u).filter((line) => line.trim() === PASS_MARKER).length;
  if (combined.includes(FAIL_MARKER) || passLines !== 1) throw new Error(`${phase} 冒烟缺少唯一成功标志 ${PASS_MARKER}`);
  return { ...record, expected_version: expectedVersion, executable: paths.executable };
}

function writeEvidence(paths, evidence) {
  ensureLocalDirectory(paths.projectRoot, paths.runRoot);
  const bytes = canonicalJson(evidence);
  const temp = `${paths.evidenceFile}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temp, bytes, { flag: "wx", mode: 0o600 });
  fs.renameSync(temp, paths.evidenceFile);
  return paths.evidenceFile;
}

function readSentinel(paths, tokenHash) {
  const record = safeFile(paths.projectRoot, paths.persistenceSentinel, "持久化哨兵");
  const value = parseJsonStrict(record.bytes.toString("utf8"), "持久化哨兵");
  exactKeys(value, ["schema_version", "token_sha256"], "持久化哨兵");
  if (value.schema_version !== 1 || value.token_sha256 !== tokenHash) throw new Error("持久化哨兵内容漂移");
}

function validDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validateWindowsInstallEvidence(evidence, { root = PROJECT_ROOT } = {}) {
  exactKeys(
    evidence,
    ["schema_version", "run_id", "product", "app_id", "started_at", "completed_at", "status", "plan", "paths", "phases", "failure"],
    "Windows 安装验收证据",
  );
  if (evidence.schema_version !== SCHEMA_VERSION || evidence.product !== PRODUCT || evidence.app_id !== APP_ID ||
      !RUN_ID_RE.test(evidence.run_id) || !validDateTime(evidence.started_at) || !validDateTime(evidence.completed_at) ||
      !["pass", "fail"].includes(evidence.status)) {
    throw new Error("Windows 安装验收证据身份、时间或状态非法");
  }
  const expectedPaths = installPaths(root, evidence.run_id);
  exactKeys(evidence.paths, ["install_dir", "evidence_file", "persistence_root"], "Windows 安装验收证据.paths");
  for (const [key, expected] of [
    ["install_dir", expectedPaths.installDir],
    ["evidence_file", expectedPaths.evidenceFile],
    ["persistence_root", expectedPaths.persistenceRoot],
  ]) {
    if (comparablePath(evidence.paths[key], "win32") !== comparablePath(expected, "win32")) {
      throw new Error(`Windows 安装验收证据路径不匹配：${key}`);
    }
  }
  exactKeys(
    evidence.plan,
    ["schema_version", "mode", "product", "app_id", "host", "current", "previous", "lifecycle", "mutation_gate", "ready_for_authorized_run"],
    "Windows 安装验收证据.plan",
  );
  exactKeys(evidence.plan.host, ["platform", "arch"], "Windows 安装验收证据.plan.host");
  exactKeys(evidence.plan.mutation_gate, ["authorized", "required_flag", "effects"], "Windows 安装验收证据.plan.mutation_gate");
  if (evidence.plan.schema_version !== SCHEMA_VERSION || evidence.plan.mode !== "authorized-run" ||
      evidence.plan.product !== PRODUCT || evidence.plan.app_id !== APP_ID ||
      evidence.plan.host.platform !== "win32" || evidence.plan.host.arch !== "x64" ||
      evidence.plan.mutation_gate.authorized !== true ||
      evidence.plan.mutation_gate.required_flag !== "--allow-system-mutation" ||
      evidence.plan.ready_for_authorized_run !== true ||
      JSON.stringify(evidence.plan.mutation_gate.effects) !== JSON.stringify(MUTATION_EFFECTS) ||
      JSON.stringify(evidence.plan.lifecycle) !== JSON.stringify(REQUIRED_PHASES)) {
    throw new Error("Windows 安装验收证据 plan 非法或不完整");
  }
  const projectRoot = path.resolve(root);
  const packageVersion = require(path.join(projectRoot, "package.json")).version;
  for (const [label, artifact, expectedVersion, expectedParent] of [
    ["current", evidence.plan.current, packageVersion, path.join(projectRoot, "release")],
    ["previous", evidence.plan.previous, PREVIOUS_VERSION, path.join(projectRoot, "release", "archive", PREVIOUS_VERSION)],
  ]) {
    exactKeys(artifact, ["filename", "kind", "size_bytes", "sha256", "version", "path"], `Windows 安装验收证据.plan.${label}`);
    if (artifact.kind !== "nsis" || !VERSION_RE.test(artifact.version) || !Number.isSafeInteger(artifact.size_bytes) ||
        artifact.size_bytes <= 0 || !HASH_RE.test(artifact.sha256) || path.basename(artifact.filename) !== artifact.filename) {
      throw new Error(`Windows 安装验收证据 ${label} 制品非法`);
    }
    const expectedFilename = `Oak-Manuscript-${expectedVersion}-Windows-x64.exe`;
    const expectedPath = path.join(expectedParent, expectedFilename);
    if (artifact.version !== expectedVersion || artifact.filename !== expectedFilename ||
        comparablePath(artifact.path, "win32") !== comparablePath(expectedPath, "win32")) {
      throw new Error(`Windows 安装验收证据 ${label} 制品版本、名称或路径不匹配`);
    }
    const actual = hashSafeFile(projectRoot, expectedPath, `Windows 安装验收证据 ${label} 制品`);
    if (actual.size_bytes !== artifact.size_bytes || actual.sha256 !== artifact.sha256) {
      throw new Error(`Windows 安装验收证据 ${label} 制品哈希或大小不匹配`);
    }
    verifyWindowsInstallerExecutable(expectedPath);
  }
  if (compareSemver(evidence.plan.previous.version, evidence.plan.current.version) >= 0) {
    throw new Error("Windows 安装验收证据的旧版不早于当前版");
  }
  if (!Array.isArray(evidence.phases) || evidence.phases.length === 0) throw new Error("Windows 安装验收证据没有阶段记录");
  for (const [index, phase] of evidence.phases.entries()) {
    exactKeys(phase, ["name", "started_at", "completed_at", "status", "details", "error"], `Windows 安装验收阶段 ${index}`);
    if (!validDateTime(phase.started_at) || !validDateTime(phase.completed_at) || !["pass", "fail"].includes(phase.status) ||
        (phase.status === "pass" && phase.error !== null) ||
        (phase.status === "fail" && (typeof phase.error !== "string" || phase.error.length === 0))) {
      throw new Error(`Windows 安装验收阶段 ${index} 非法`);
    }
  }
  const names = evidence.phases.map((phase) => phase.name);
  if (evidence.status === "pass") {
    if (evidence.failure !== null || JSON.stringify(names) !== JSON.stringify(REQUIRED_PHASES) ||
        evidence.phases.some((phase) => phase.status !== "pass")) {
      throw new Error("Windows 安装验收 PASS 证据缺相、乱序或含失败");
    }
  } else {
    if (typeof evidence.failure !== "string" || evidence.failure.length === 0 ||
        !evidence.phases.some((phase) => phase.status === "fail")) {
      throw new Error("Windows 安装验收 FAIL 证据缺少失败原因或失败阶段");
    }
    const nonCleanup = names.filter((name) => name !== "cleanup_uninstall");
    if (nonCleanup.some((name, index) => name !== REQUIRED_PHASES[index]) ||
        names.filter((name) => name === "cleanup_uninstall").length > 1 ||
        (names.includes("cleanup_uninstall") && names.at(-1) !== "cleanup_uninstall")) {
      throw new Error("Windows 安装验收 FAIL 阶段顺序非法");
    }
  }
  return evidence;
}

function verifyWindowsInstallEvidence({ root = PROJECT_ROOT, runId } = {}) {
  const paths = installPaths(root, runId);
  const record = safeFile(root, paths.evidenceFile, "Windows 安装验收证据文件");
  const evidence = parseJsonStrict(record.bytes.toString("utf8"), "Windows 安装验收证据文件");
  validateWindowsInstallEvidence(evidence, { root });
  if (!record.bytes.equals(canonicalJson(evidence))) throw new Error("Windows 安装验收证据不是 canonical UTF-8/LF");
  return JSON.parse(record.bytes.toString("utf8"));
}

function runWindowsInstallAcceptance({
  root = PROJECT_ROOT,
  allowSystemMutation = false,
  hostPlatform = process.platform,
  hostArch = process.arch,
  inheritedEnv = process.env,
  spawn = spawnSync,
  runId = createRunId(),
  now = () => new Date().toISOString(),
  preflight = createPreflightPlan,
  integrationProbe = probeWindowsIntegration,
} = {}) {
  const plan = preflight({ root, hostPlatform, hostArch });
  if (allowSystemMutation !== true) {
    throw new Error("拒绝启动安装器：必须显式提供 --allow-system-mutation；默认预检不产生系统写入");
  }
  const paths = installPaths(root, runId);
  for (const target of [paths.runRoot, paths.installDir, paths.persistenceRoot, paths.processTemp]) {
    ensureLocalDirectory(paths.projectRoot, target);
  }
  if (fs.readdirSync(paths.installDir).length !== 0) throw new Error(`安装目录必须为空：${paths.installDir}`);
  const evidence = {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    product: PRODUCT,
    app_id: APP_ID,
    started_at: now(),
    completed_at: null,
    status: "running",
    plan: { ...plan, mode: "authorized-run", mutation_gate: { ...plan.mutation_gate, authorized: true } },
    paths: {
      install_dir: paths.installDir,
      evidence_file: paths.evidenceFile,
      persistence_root: paths.persistenceRoot,
    },
    phases: [],
    failure: null,
  };
  let installStarted = false;
  let uninstallCompleted = false;
  const recordPhase = (name, operation) => {
    if (!REQUIRED_PHASES.includes(name) && name !== "cleanup_uninstall") throw new Error(`未知验收阶段：${name}`);
    const phaseRecord = { name, started_at: now(), completed_at: null, status: "running", details: null, error: null };
    evidence.phases.push(phaseRecord);
    try {
      phaseRecord.details = operation();
      phaseRecord.status = "pass";
      return phaseRecord.details;
    } catch (error) {
      phaseRecord.status = "fail";
      phaseRecord.error = String(error.message || error);
      throw error;
    } finally {
      phaseRecord.completed_at = now();
    }
  };
  const installArgs = ["/S", "/currentuser", `/D=${paths.installDir}`];
  const processEnv = createInstallerEnvironment(paths, inheritedEnv);
  let tokenHash = null;
  try {
    recordPhase("install_previous", () => {
      installStarted = true;
      const record = runHidden(spawn, plan.previous.path, installArgs, {
        cwd: paths.projectRoot, env: processEnv, timeoutMs: INSTALL_TIMEOUT_MS, label: "旧版安装器",
      });
      verifyWindowsX64Executable(paths.executable);
      verifyWindowsInstallerExecutable(paths.uninstaller);
      return {
        process: record,
        installed_executable: paths.executable,
        integration: integrationProbe({
          root: paths.projectRoot,
          installDir: paths.installDir,
          expectedPresent: true,
          expectedVersion: plan.previous.version,
          spawn,
          inheritedEnv,
        }),
      };
    });
    recordPhase("smoke_previous", () => runInstalledSmoke({
      paths, phase: "smoke_previous", expectedVersion: plan.previous.version, spawn, inheritedEnv,
    }));
    ensureLocalDirectory(paths.projectRoot, paths.persistenceRoot);
    tokenHash = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
    fs.writeFileSync(paths.persistenceSentinel, canonicalJson({ schema_version: 1, token_sha256: tokenHash }), { flag: "wx", mode: 0o600 });
    recordPhase("upgrade_current", () => {
      const record = runHidden(spawn, plan.current.path, installArgs, {
        cwd: paths.projectRoot, env: processEnv, timeoutMs: INSTALL_TIMEOUT_MS, label: "当前版升级安装器",
      });
      verifyWindowsX64Executable(paths.executable);
      return {
        process: record,
        integration: integrationProbe({
          root: paths.projectRoot,
          installDir: paths.installDir,
          expectedPresent: true,
          expectedVersion: plan.current.version,
          spawn,
          inheritedEnv,
        }),
      };
    });
    recordPhase("smoke_current", () => runInstalledSmoke({
      paths, phase: "smoke_current", expectedVersion: plan.current.version, spawn, inheritedEnv,
    }));
    recordPhase("persistence_after_upgrade", () => {
      readSentinel(paths, tokenHash);
      return { preserved: true, sentinel_sha256: tokenHash };
    });
    recordPhase("downgrade_probe", () => {
      const result = spawn(plan.previous.path, installArgs, {
        cwd: paths.projectRoot,
        env: processEnv,
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: INSTALL_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: MAX_OUTPUT_BYTES,
      });
      return { process: validateDowngradeProbeProcess(result), policy: "installed version must remain current" };
    });
    recordPhase("smoke_after_downgrade_probe", () => ({
      smoke: runInstalledSmoke({
        paths, phase: "smoke_after_downgrade_probe", expectedVersion: plan.current.version, spawn, inheritedEnv,
      }),
      integration: integrationProbe({
        root: paths.projectRoot,
        installDir: paths.installDir,
        expectedPresent: true,
        expectedVersion: plan.current.version,
        spawn,
        inheritedEnv,
      }),
    }));
    recordPhase("uninstall_current", () => {
      verifyWindowsInstallerExecutable(paths.uninstaller);
      const record = runHidden(spawn, paths.uninstaller, ["/S", "/currentuser", `_?=${paths.installDir}`], {
        cwd: paths.projectRoot, env: processEnv, timeoutMs: UNINSTALL_TIMEOUT_MS, label: "当前版卸载器",
      });
      return { process: record };
    });
    recordPhase("post_uninstall", () => {
      if (fs.existsSync(paths.executable) || fs.existsSync(paths.uninstaller)) throw new Error("卸载后仍残留主程序或卸载器");
      readSentinel(paths, tokenHash);
      const result = {
        binaries_removed: true,
        user_data_preserved: true,
        integration: integrationProbe({
          root: paths.projectRoot,
          installDir: paths.installDir,
          expectedPresent: false,
          expectedVersion: null,
          spawn,
          inheritedEnv,
        }),
      };
      uninstallCompleted = true;
      return result;
    });
    const names = evidence.phases.map((phase) => phase.name);
    if (JSON.stringify(names) !== JSON.stringify(REQUIRED_PHASES) || evidence.phases.some((phase) => phase.status !== "pass")) {
      throw new Error("安装生命周期证据不完整");
    }
    evidence.status = "pass";
  } catch (error) {
    evidence.status = "fail";
    evidence.failure = String(error.message || error);
    if (installStarted && !uninstallCompleted && fs.existsSync(paths.uninstaller)) {
      try {
        recordPhase("cleanup_uninstall", () => ({
          process: runHidden(spawn, paths.uninstaller, ["/S", "/currentuser", `_?=${paths.installDir}`], {
            cwd: paths.projectRoot, env: processEnv, timeoutMs: UNINSTALL_TIMEOUT_MS, label: "失败清理卸载器",
          }),
        }));
      } catch (cleanupError) {
        evidence.failure += `；清理卸载也失败：${cleanupError.message}`;
      }
    }
  } finally {
    evidence.completed_at = now();
    validateWindowsInstallEvidence(evidence, { root: paths.projectRoot });
    writeEvidence(paths, evidence);
  }
  return evidence;
}

function parseArgs(argv) {
  let allowSystemMutation = false;
  let run = false;
  for (const arg of argv) {
    if (arg === "--run") {
      if (run) throw new Error("重复参数：--run");
      run = true;
    } else if (arg === "--allow-system-mutation") {
      if (allowSystemMutation) throw new Error("重复参数：--allow-system-mutation");
      allowSystemMutation = true;
    } else throw new Error(`未知参数：${arg}`);
  }
  if (allowSystemMutation && !run) throw new Error("--allow-system-mutation 只能与 --run 同时使用");
  if (run && !allowSystemMutation) throw new Error("--run 缺少 --allow-system-mutation，拒绝启动安装器");
  return { run, allowSystemMutation };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = args.run
      ? runWindowsInstallAcceptance({ allowSystemMutation: args.allowSystemMutation })
      : createPreflightPlan();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (args.run && result.status !== "pass") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  APP_ID,
  APP_GUID,
  CHECKSUM_NAME,
  MANIFEST_NAME,
  PREVIOUS_VERSION,
  PRODUCT,
  REQUIRED_PHASES,
  SCHEMA_VERSION,
  UNINSTALL_EXE,
  artifactByKind,
  compareSemver,
  createInstallerEnvironment,
  createPreflightPlan,
  createRunId,
  installPaths,
  parseArgs,
  probeWindowsIntegration,
  registryExecutable,
  runInstalledSmoke,
  runWindowsInstallAcceptance,
  smokePaths,
  validateReleaseManifest,
  validateRunId,
  validateDowngradeProbeProcess,
  validateWindowsInstallEvidence,
  verifyWindowsInstallerExecutable,
  verifyArchivedRelease,
  verifyWindowsInstallEvidence,
};
