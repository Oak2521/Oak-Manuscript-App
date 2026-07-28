"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const {
  EXPECTED_VERSION_ENV,
  EXPECT_PACKAGED_ENV,
  PASS_MARKER,
  PRODUCT_EXE,
  SYNC_RECOVERY_PASS_MARKER,
  createSmokeEnvironment,
  getSmokePaths,
  readExpectedAppVersion,
  runPackagedSmoke,
  smokeArguments,
  syncRecoveryArguments,
  verifyWindowsX64Executable,
} = require("../scripts/run_packaged_smoke");
const {
  getSourceSmokePaths,
  runSourceSmoke,
} = require("../scripts/run_source_smoke");
const {
  DEFAULT_EXPECTED_APP_VERSION,
  PACKAGED_OUTPUT_ENV,
  assertCoreIdentityFromProject,
  assertSmokeIdentity,
  resolveSmokeOutputRoot,
  safeRemoveSmokeTree,
} = require("../electron/smoke");

const REPO_ROOT = path.resolve(__dirname, "..");
const TEST_OUTPUT_ROOT = path.join(REPO_ROOT, "out", "test-fixtures");
const TEST_SMOKE_RUN_ID = "test-run";
const TEST_STANDARD_IDENTITY = Object.freeze({
  bundle_id: "oak-standards",
  manifest_sha256: "b".repeat(64),
  name: "oak-rules",
  pinned: true,
  release_sequence: 1,
  sha256: "a".repeat(64),
  version: "1.0.0",
});

function testAppInfo({
  appVersion = DEFAULT_EXPECTED_APP_VERSION,
  packaged = false,
  standardIdentity = TEST_STANDARD_IDENTITY,
  rulepack = `${standardIdentity.name} ${standardIdentity.version}`,
  standardsRelease = {
    bundle_id: standardIdentity.bundle_id,
    release_sequence: standardIdentity.release_sequence,
    manifest_sha256: standardIdentity.manifest_sha256,
    rulepack_name: standardIdentity.name,
    rulepack_version: standardIdentity.version,
  },
} = {}) {
  return {
    ok: true,
    appVersion,
    packaged,
    standardIdentity,
    rulepack,
    standardsRelease,
  };
}

function makeRoot(t) {
  fs.mkdirSync(TEST_OUTPUT_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(TEST_OUTPUT_ROOT, "packaged-smoke-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFakePe(target, { machine = 0x8664, magic = 0x020b } = {}) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const data = Buffer.alloc(256);
  data.write("MZ", 0, "ascii");
  data.writeUInt32LE(0x80, 0x3c);
  data.write("PE\0\0", 0x80, "binary");
  data.writeUInt16LE(machine, 0x84);
  data.writeUInt16LE(magic, 0x98);
  fs.writeFileSync(target, data);
}

function prepareExecutable(t) {
  const root = makeRoot(t);
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ version: DEFAULT_EXPECTED_APP_VERSION }, null, 2)}\n`,
  );
  const executable = path.join(root, "release", "win-unpacked", PRODUCT_EXE);
  writeFakePe(executable);
  return { root, executable };
}

test("smoke identity rejects a stale app version and a non-packaged binary", () => {
  assert.equal(DEFAULT_EXPECTED_APP_VERSION, require("../package.json").version);
  assert.doesNotThrow(() => assertSmokeIdentity(testAppInfo(), {
    expectedVersion: DEFAULT_EXPECTED_APP_VERSION,
    expectedPackaged: false,
  }));
  assert.doesNotThrow(() => assertSmokeIdentity(testAppInfo({ packaged: true }), {
    expectedVersion: DEFAULT_EXPECTED_APP_VERSION,
    requirePackaged: true,
  }));
  assert.throws(
    () => assertSmokeIdentity(testAppInfo({
      appVersion: "0.1.0-alpha.1",
      packaged: true,
    }), {
      expectedVersion: DEFAULT_EXPECTED_APP_VERSION,
      requirePackaged: true,
    }),
    new RegExp(`应用版本应为 ${DEFAULT_EXPECTED_APP_VERSION.replaceAll(".", "\\.")}，实际为 0\\.1\\.0-alpha\\.1`),
  );
  assert.throws(
    () => assertSmokeIdentity(testAppInfo(), {
      expectedVersion: DEFAULT_EXPECTED_APP_VERSION,
      requirePackaged: true,
    }),
    /app\.isPackaged=true/,
  );
  assert.throws(
    () => assertSmokeIdentity(testAppInfo({ packaged: true }), {
      expectedVersion: DEFAULT_EXPECTED_APP_VERSION,
      expectedPackaged: false,
    }),
    /app\.isPackaged 应为 false/,
  );
  assert.throws(
    () => assertSmokeIdentity(testAppInfo({ rulepack: "oak-rules 9.9.9" })),
    /显示值必须由完整标准身份派生/,
  );
  assert.throws(
    () => assertSmokeIdentity(testAppInfo({
      standardsRelease: {
        bundle_id: TEST_STANDARD_IDENTITY.bundle_id,
        release_sequence: 2,
        manifest_sha256: TEST_STANDARD_IDENTITY.manifest_sha256,
        rulepack_name: TEST_STANDARD_IDENTITY.name,
        rulepack_version: TEST_STANDARD_IDENTITY.version,
      },
    })),
    /标准发布信息必须与完整标准身份一致/,
  );
});

test("smoke reads the actual create/check artifacts and proves Python core plus rulepack identity", (t) => {
  const root = makeRoot(t);
  const reports = path.join(root, "reports");
  fs.mkdirSync(reports);
  const manifest = {
    app_version: DEFAULT_EXPECTED_APP_VERSION,
    rulepack: { ...TEST_STANDARD_IDENTITY },
    checks: [{
      check_id: "check-0001",
      rulepack_version: "1.0.0",
      rulepack: { ...TEST_STANDARD_IDENTITY },
      result_file: "reports/check-0001.json",
    }],
  };
  const report = {
    app_version: DEFAULT_EXPECTED_APP_VERSION,
    check_id: "check-0001",
    rulepack: { ...TEST_STANDARD_IDENTITY },
  };
  const manifestFile = path.join(root, "project.json");
  const reportFile = path.join(reports, "check-0001.json");
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  assert.deepEqual(assertCoreIdentityFromProject(root, {
    expectedVersion: DEFAULT_EXPECTED_APP_VERSION,
    expectedStandardIdentity: TEST_STANDARD_IDENTITY,
  }), {
    coreVersion: DEFAULT_EXPECTED_APP_VERSION,
    rulepack: "oak-rules 1.0.0",
    standardIdentity: TEST_STANDARD_IDENTITY,
    checkId: "check-0001",
  });

  manifest.app_version = "0.1.0-alpha.1";
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(
    () => assertCoreIdentityFromProject(root, {
      expectedVersion: DEFAULT_EXPECTED_APP_VERSION,
      expectedStandardIdentity: TEST_STANDARD_IDENTITY,
    }),
    new RegExp(`Python core 创建项目的版本应为 ${DEFAULT_EXPECTED_APP_VERSION.replaceAll(".", "\\.")}，实际为 0\\.1\\.0-alpha\\.1`),
  );

  manifest.app_version = DEFAULT_EXPECTED_APP_VERSION;
  manifest.checks[0].result_file = "../outside.json";
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(
    () => assertCoreIdentityFromProject(root, {
      expectedVersion: DEFAULT_EXPECTED_APP_VERSION,
      expectedStandardIdentity: TEST_STANDARD_IDENTITY,
    }),
    /检查结果文件必须位于冒烟项目目录内/,
  );

  manifest.checks[0].result_file = "reports/check-0001.json";
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  report.app_version = "0.1.0-alpha.1";
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  assert.throws(
    () => assertCoreIdentityFromProject(root, {
      expectedVersion: DEFAULT_EXPECTED_APP_VERSION,
      expectedStandardIdentity: TEST_STANDARD_IDENTITY,
    }),
    new RegExp(`Python core 检查报告的版本应为 ${DEFAULT_EXPECTED_APP_VERSION.replaceAll(".", "\\.")}，实际为 0\\.1\\.0-alpha\\.1`),
  );

  report.app_version = DEFAULT_EXPECTED_APP_VERSION;
  report.rulepack.version = "1.0.1";
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  assert.throws(
    () => assertCoreIdentityFromProject(root, {
      expectedVersion: DEFAULT_EXPECTED_APP_VERSION,
      expectedStandardIdentity: TEST_STANDARD_IDENTITY,
    }),
    /项目清单标准身份与预期标准身份不一致/,
  );

  const sameVersionDrifts = [
    ["payload sha256", (identity) => { identity.sha256 = "c".repeat(64); }],
    ["manifest sha256", (identity) => { identity.manifest_sha256 = "d".repeat(64); }],
    ["release_sequence", (identity) => { identity.release_sequence = 2; }],
    ["pinned", (identity) => { identity.pinned = false; }],
  ];
  for (const [label, mutate] of sameVersionDrifts) {
    report.rulepack = { ...TEST_STANDARD_IDENTITY };
    mutate(report.rulepack);
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    assert.throws(
      () => assertCoreIdentityFromProject(root, {
        expectedVersion: DEFAULT_EXPECTED_APP_VERSION,
        expectedStandardIdentity: TEST_STANDARD_IDENTITY,
      }),
      /标准身份/,
      `name/version 不变时，${label} 漂移也必须失败`,
    );
  }
});

test("real UI smoke confirms the citation plan before asserting check results", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, "electron", "smoke.js"), "utf8");
  const start = source.indexOf('const citationPlan = await js("__oakActions.startCheck()")');
  const confirm = source.indexOf('const check = await js("__oakActions.confirmCitationResolution()")');
  const assertIssues = source.indexOf("assert(check.issueCount > 0");
  assert.ok(start >= 0, "smoke must create the citation confirmation plan");
  assert.ok(confirm > start, "smoke must explicitly confirm the citation plan");
  assert.ok(assertIssues > confirm, "smoke may inspect issues only after confirmation");
});

test("packaged smoke requires an injected absolute output root and never falls back to temp", () => {
  assert.throws(
    () => resolveSmokeOutputRoot({ packaged: true, repoRoot: "C:\\repo", env: {} }),
    new RegExp(PACKAGED_OUTPUT_ENV),
  );
  assert.throws(
    () => resolveSmokeOutputRoot({
      packaged: true,
      repoRoot: "C:\\repo",
      env: { [PACKAGED_OUTPUT_ENV]: "relative/out" },
    }),
    /必须是绝对路径/,
  );
  assert.throws(
    () => resolveSmokeOutputRoot({
      packaged: false,
      repoRoot: path.resolve("fixture"),
      env: {},
    }),
    new RegExp(PACKAGED_OUTPUT_ENV),
  );
  const sourceOutput = path.resolve("fixture", "out", "source-smoke", "projects");
  assert.equal(resolveSmokeOutputRoot({
    packaged: false,
    repoRoot: path.resolve("fixture"),
    env: { [PACKAGED_OUTPUT_ENV]: sourceOutput },
  }), sourceOutput);
});

test("each smoke run receives an isolated user-data and standards-store root", (t) => {
  const { root } = prepareExecutable(t);
  const electronExecutable = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  fs.mkdirSync(path.dirname(electronExecutable), { recursive: true });
  fs.writeFileSync(electronExecutable, "source smoke fixture\n");

  const packagedA = getSmokePaths(root, "run-a");
  const packagedB = getSmokePaths(root, "run-b");
  const sourceA = getSourceSmokePaths(root, electronExecutable, "run-a");
  const sourceB = getSourceSmokePaths(root, electronExecutable, "run-b");
  assert.notEqual(packagedA.userData, packagedB.userData);
  assert.notEqual(sourceA.userData, sourceB.userData);
  assert.notEqual(packagedA.smokeRoot, sourceA.smokeRoot);
  assert.match(packagedA.userData, /packaged-smoke[\\/]runs[\\/]run-a/);
  assert.match(sourceA.userData, /source-smoke[\\/]runs[\\/]run-a/);
  assert.throws(() => getSmokePaths(root, "../escape"), /运行 ID 非法/);
  assert.throws(
    () => getSourceSmokePaths(root, electronExecutable, "run_a"),
    /运行 ID 非法/,
  );
});

test("smoke cleanup rejects links before touching their external sentinel", (t) => {
  const root = makeRoot(t);
  const outputRoot = path.join(root, "out", "source-smoke", "projects");
  const project = path.join(outputRoot, "ui-smoke-docx");
  const outside = path.join(root, "outside");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(outside);
  const sentinel = path.join(outside, "sentinel.txt");
  fs.writeFileSync(sentinel, "unchanged\n");
  const link = path.join(project, "escaped");
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`当前主机不能创建测试 junction/symlink：${error.code}`);
      return;
    }
    throw error;
  }
  assert.throws(
    () => safeRemoveSmokeTree(outputRoot, project),
    /链接|联接|逃逸/,
  );
  assert.equal(fs.readFileSync(sentinel, "utf8"), "unchanged\n");
  assert.equal(fs.existsSync(project), true);
});

test("PE gate accepts only a regular Windows x64 PE32+ executable", (t) => {
  const { root, executable } = prepareExecutable(t);
  assert.deepEqual(verifyWindowsX64Executable(executable), {
    arch: "x64",
    format: "PE32+",
    size: 256,
  });

  const x86 = path.join(root, "x86.exe");
  writeFakePe(x86, { machine: 0x014c, magic: 0x010b });
  assert.throws(() => verifyWindowsX64Executable(x86), /必须为 Windows x64 PE32\+/);

  const invalid = path.join(root, "invalid.exe");
  fs.writeFileSync(invalid, Buffer.alloc(256));
  assert.throws(() => verifyWindowsX64Executable(invalid), /缺少 DOS MZ/);
  assert.throws(
    () => verifyWindowsX64Executable(path.join(root, "missing.exe")),
    /打包 EXE 不存在/,
  );
});

test("smoke environment removes inherited injection and keeps every writable location under repo/out", (t) => {
  const { root } = prepareExecutable(t);
  const paths = getSmokePaths(root);
  const env = createSmokeEnvironment(paths, {
    SAFE_VALUE: "kept",
    OAK_SMOKE_OUTPUT_ROOT: "C:\\escape",
    OAK_APP_PACKAGED: "attacker",
    OAK_EXPECTED_APP_VERSION: "0.1.0-alpha.1",
    OAK_EXPECT_PACKAGED: "0",
    OAK_SMOKE_EXTERNAL_VALIDATION: "1",
    ELECTRON_RUN_AS_NODE: "1",
    electron_log_file: "C:\\outside.log",
    NODE_OPTIONS: "--require=evil.js",
    ELECTRON_DISABLE_SANDBOX: "1",
    PYTHONPATH: "C:\\evil",
    JAVA_TOOL_OPTIONS: "-javaagent:evil.jar",
    HTTPS_PROXY: "http://proxy.invalid",
    SSLKEYLOGFILE: "C:\\outside.keys",
  }, DEFAULT_EXPECTED_APP_VERSION);

  assert.equal(env.SAFE_VALUE, "kept");
  assert.equal(env.OAK_SMOKE_OUTPUT_ROOT, paths.projectOutput);
  assert.equal(env[EXPECTED_VERSION_ENV], DEFAULT_EXPECTED_APP_VERSION);
  assert.equal(env[EXPECT_PACKAGED_ENV], "1");
  assert.equal(Object.hasOwn(env, "OAK_SMOKE_EXTERNAL_VALIDATION"), false);
  for (const forbidden of [
    "OAK_APP_PACKAGED",
    "ELECTRON_RUN_AS_NODE",
    "electron_log_file",
    "NODE_OPTIONS",
    "ELECTRON_DISABLE_SANDBOX",
    "PYTHONPATH",
    "JAVA_TOOL_OPTIONS",
    "HTTPS_PROXY",
    "SSLKEYLOGFILE",
  ]) assert.equal(Object.hasOwn(env, forbidden), false, `${forbidden} must be removed`);

  for (const name of [
    "OAK_SMOKE_OUTPUT_ROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
  ]) {
    const relative = path.relative(paths.outRoot, env[name]);
    assert.equal(relative.startsWith("..") || path.isAbsolute(relative), false, name);
  }
  assert.equal(env.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(env.PYTHONNOUSERSITE, "1");
  assert.equal(env.PYTHONUTF8, "1");
});

test("packaged runner launches the fixed executable hidden and accepts exit 0 plus PASS marker", (t) => {
  const { root, executable } = prepareExecutable(t);
  const invocations = [];
  const result = runPackagedSmoke({
    root,
    runId: TEST_SMOKE_RUN_ID,
    hostPlatform: "win32",
    inheritedEnv: { SAFE_VALUE: "yes", NODE_OPTIONS: "--require=evil.js" },
    spawn(command, args, options) {
      invocations.push({ command, args, options });
      const marker = args.includes("--smoke-sync-recovery") ? SYNC_RECOVERY_PASS_MARKER : PASS_MARKER;
      return { status: 0, signal: null, stdout: `[app]\n${marker}\n`, stderr: "" };
    },
  });

  const paths = getSmokePaths(root, TEST_SMOKE_RUN_ID);
  assert.equal(result.ok, true);
  assert.equal(result.expectedVersion, DEFAULT_EXPECTED_APP_VERSION);
  assert.equal(result.executable, executable);
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].command, executable);
  assert.deepEqual(invocations[0].args, smokeArguments(paths));
  assert.deepEqual(invocations[1].args, syncRecoveryArguments(paths));
  assert.equal(invocations[0].options.cwd, root);
  assert.equal(invocations[0].options.windowsHide, true);
  assert.equal(invocations[0].options.shell, false);
  assert.equal(invocations[0].options.env.OAK_SMOKE_OUTPUT_ROOT, paths.projectOutput);
  assert.equal(invocations[0].options.env[EXPECTED_VERSION_ENV], readExpectedAppVersion(root));
  assert.equal(invocations[0].options.env[EXPECT_PACKAGED_ENV], "1");
  assert.equal(invocations[0].options.env.OAK_SMOKE_EXTERNAL_VALIDATION, "1");
  assert.equal(Object.hasOwn(invocations[1].options.env, "OAK_SMOKE_EXTERNAL_VALIDATION"), false);
  assert.equal(Object.hasOwn(invocations[0].options.env, "NODE_OPTIONS"), false);
  assert.equal(invocations[0].args.includes("--disable-background-networking"), true);
  assert.equal(invocations[0].args.some((arg) => arg.startsWith("--user-data-dir=")), true);
});

test("source smoke keeps every writable Electron path inside repo/out and launches hidden", (t) => {
  assert.equal(require("../package.json").scripts.smoke, "node scripts/run_source_smoke.js");
  const { root } = prepareExecutable(t);
  const electronExecutable = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  fs.mkdirSync(path.dirname(electronExecutable), { recursive: true });
  fs.writeFileSync(electronExecutable, "source smoke fixture\n");
  const invocations = [];
  const result = runSourceSmoke({
    root,
    electronExecutable,
    runId: TEST_SMOKE_RUN_ID,
    inheritedEnv: {
      SAFE_VALUE: "kept",
      ELECTRON_RUN_AS_NODE: "1",
      HTTPS_PROXY: "http://proxy.invalid",
      NODE_OPTIONS: "--require=evil.js",
      OAK_SMOKE_EXTERNAL_VALIDATION: "1",
    },
    spawn(command, args, options) {
      invocations.push({ command, args, options });
      const marker = args.includes("--smoke-sync-recovery") ? SYNC_RECOVERY_PASS_MARKER : PASS_MARKER;
      return { status: 0, signal: null, stdout: `${marker}\n`, stderr: "" };
    },
  });
  const paths = getSourceSmokePaths(root, electronExecutable, TEST_SMOKE_RUN_ID);
  assert.equal(result.ok, true);
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].command, electronExecutable);
  assert.deepEqual(invocations[0].args, [root, ...smokeArguments(paths)]);
  assert.deepEqual(invocations[1].args, [root, ...syncRecoveryArguments(paths)]);
  assert.equal(invocations[0].options.windowsHide, true);
  assert.equal(invocations[0].options.shell, false);
  assert.equal(invocations[0].options.env[EXPECT_PACKAGED_ENV], "0");
  assert.equal(invocations[0].options.env.OAK_SMOKE_OUTPUT_ROOT, paths.projectOutput);
  assert.equal(invocations[0].options.env.OAK_SMOKE_EXTERNAL_VALIDATION, "1");
  assert.equal(Object.hasOwn(invocations[1].options.env, "OAK_SMOKE_EXTERNAL_VALIDATION"), false);
  assert.equal(Object.hasOwn(invocations[0].options.env, "ELECTRON_RUN_AS_NODE"), false);
  assert.equal(Object.hasOwn(invocations[0].options.env, "HTTPS_PROXY"), false);
  assert.equal(Object.hasOwn(invocations[0].options.env, "NODE_OPTIONS"), false);
  for (const name of [
    "OAK_SMOKE_OUTPUT_ROOT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE",
    "APPDATA", "LOCALAPPDATA", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
  ]) {
    const relative = path.relative(paths.outRoot, invocations[0].options.env[name]);
    assert.equal(relative.startsWith("..") || path.isAbsolute(relative), false, name);
  }
  for (const argument of smokeArguments(paths)) assert.equal(invocations[0].args.includes(argument), true);
});

test("packaged runner fails closed on missing marker, nonzero exit, timeout, signal, or missing EXE", (t) => {
  const { root } = prepareExecutable(t);
  const invoke = (processResult) => runPackagedSmoke({
    root,
    hostPlatform: "win32",
    spawn() { return processResult; },
  });

  assert.throws(
    () => invoke({ status: 0, signal: null, stdout: "done", stderr: "" }),
    /缺少唯一成功标志/,
  );
  assert.throws(
    () => invoke({ status: 0, signal: null, stdout: `${PASS_MARKER}\n${PASS_MARKER}\n`, stderr: "" }),
    /缺少唯一成功标志/,
  );
  assert.throws(
    () => invoke({ status: 0, signal: null, stdout: `${PASS_MARKER} forged`, stderr: "" }),
    /缺少唯一成功标志/,
  );
  assert.throws(
    () => invoke({ status: 7, signal: null, stdout: PASS_MARKER, stderr: "boom" }),
    /退出码为 7/,
  );
  assert.throws(
    () => invoke({ status: null, signal: null, stdout: "", stderr: "", error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) }),
    /冒烟超时/,
  );
  assert.throws(
    () => invoke({ status: null, signal: "SIGKILL", stdout: "", stderr: "" }),
    /被信号 SIGKILL 终止/,
  );
  let calls = 0;
  assert.throws(
    () => runPackagedSmoke({
      root,
      hostPlatform: "win32",
      spawn() {
        calls += 1;
        return calls === 1
          ? { status: 0, signal: null, stdout: `${PASS_MARKER}\n`, stderr: "" }
          : { status: 0, signal: null, stdout: "recovery missing", stderr: "" };
      },
    }),
    /同步队列重启恢复冒烟缺少唯一成功标志/,
  );

  const missingRoot = makeRoot(t);
  assert.throws(
    () => runPackagedSmoke({ root: missingRoot, hostPlatform: "win32", spawn() { throw new Error("must not spawn"); } }),
    /打包 EXE 不存在/,
  );
});

test("packaged runner rejects non-Windows hosts and invalid timeout before launch", (t) => {
  const { root } = prepareExecutable(t);
  assert.throws(
    () => runPackagedSmoke({ root, hostPlatform: "darwin" }),
    /只能在 win32 主机执行/,
  );
  assert.throws(
    () => runPackagedSmoke({ root, hostPlatform: "win32", timeoutMs: 0 }),
    /超时值非法/,
  );
});
