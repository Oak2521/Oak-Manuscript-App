"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  APP_ID,
  APP_GUID,
  PREVIOUS_VERSION,
  PRODUCT,
  REQUIRED_PHASES,
  UNINSTALL_EXE,
  compareSemver,
  createPreflightPlan,
  installPaths,
  parseArgs,
  runWindowsInstallAcceptance,
  validateReleaseManifest,
  validateRunId,
  validateDowngradeProbeProcess,
  validateWindowsInstallEvidence,
  verifyArchivedRelease,
  verifyWindowsInstallEvidence,
  verifyWindowsInstallerExecutable,
} = require("../scripts/windows_install_acceptance");
const { PASS_MARKER, PRODUCT_EXE } = require("../scripts/run_packaged_smoke");

const TEST_ROOT = path.join(__dirname, "..", "out", "node-tests");
const CURRENT_VERSION = require("../package.json").version;

function makeRoot(t) {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(TEST_ROOT, "install-acceptance-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFakePe(target, { machine = 0x8664, magic = 0x020b } = {}) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const bytes = Buffer.alloc(256);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80, "binary");
  bytes.writeUInt16LE(machine, 0x84);
  bytes.writeUInt16LE(magic, 0x98);
  fs.writeFileSync(target, bytes);
  return bytes;
}

function manifest(version) {
  return {
    schema_version: 1,
    product: PRODUCT,
    app_id: APP_ID,
    version,
    target: { platform: "win32", arch: "x64" },
    artifacts: [
      {
        filename: `Oak-Manuscript-${version}-Windows-x64.exe`,
        kind: "nsis",
        size_bytes: 256,
        sha256: "a".repeat(64),
      },
      {
        filename: `Oak-Manuscript-${version}-Windows-x64.zip`,
        kind: "zip",
        size_bytes: 128,
        sha256: "b".repeat(64),
      },
    ],
    sha256sums: { filename: "SHA256SUMS.txt", sha256: "c".repeat(64) },
  };
}

function fixturePreflight(t) {
  const root = makeRoot(t);
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ version: CURRENT_VERSION })}\n`);
  const currentInstaller = path.join(root, "release", `Oak-Manuscript-${CURRENT_VERSION}-Windows-x64.exe`);
  const previousInstaller = path.join(
    root,
    "release",
    "archive",
    PREVIOUS_VERSION,
    `Oak-Manuscript-${PREVIOUS_VERSION}-Windows-x64.exe`,
  );
  const currentBytes = writeFakePe(currentInstaller);
  const previousBytes = writeFakePe(previousInstaller);
  const currentManifest = manifest(CURRENT_VERSION);
  const previousManifest = manifest(PREVIOUS_VERSION);
  currentManifest.artifacts[0].sha256 = require("node:crypto").createHash("sha256").update(currentBytes).digest("hex");
  previousManifest.artifacts[0].sha256 = require("node:crypto").createHash("sha256").update(previousBytes).digest("hex");
  const plan = createPreflightPlan({
    root,
    hostPlatform: "win32",
    hostArch: "x64",
    verifyCurrent: () => currentManifest,
    verifyPrevious: () => previousManifest,
  });
  return { root, plan };
}

test("SemVer comparison orders prereleases without lexical alpha.10/alpha.9 errors", () => {
  assert.equal(APP_GUID, "1cf38d60-9ebb-5f06-9cae-915c1a0bee9b");
  assert.equal(compareSemver("0.1.0-alpha.9", "0.1.0-alpha.10"), -1);
  assert.equal(compareSemver("0.1.0-alpha.13", "0.1.0-alpha.13"), 0);
  assert.equal(compareSemver("0.1.0-alpha.13", "0.1.0"), -1);
  assert.equal(compareSemver("0.2.0", "0.1.99"), 1);
  assert.equal(compareSemver("1.0.0-alpha-beta", "1.0.0-alpha"), 1);
  assert.equal(compareSemver("9007199254740993.0.0", "9007199254740992.0.0"), 1);
  assert.throws(() => compareSemver("1.0.0-01", "1.0.0-1"), /合法 SemVer/);
  assert.throws(() => compareSemver("v1", "1.0.0"), /合法 SemVer/);
});

test("downgrade probe requires the old installer process to complete but allows a policy exit code", () => {
  assert.equal(validateDowngradeProbeProcess({ status: 17, signal: null, stdout: "blocked", stderr: "" }).status, 17);
  assert.throws(
    () => validateDowngradeProbeProcess({ status: null, signal: null, error: new Error("spawn denied") }),
    /无法启动/,
  );
  assert.throws(
    () => validateDowngradeProbeProcess({ status: null, signal: "SIGKILL", stdout: "", stderr: "" }),
    /被信号/,
  );
});

test("installer gate accepts an x86 NSIS bootstrap while the app smoke gate remains x64-specific", (t) => {
  const root = makeRoot(t);
  const x86 = path.join(root, "installer-x86.exe");
  writeFakePe(x86, { machine: 0x014c, magic: 0x010b });
  assert.deepEqual(verifyWindowsInstallerExecutable(x86), {
    launcher_arch: "x86",
    format: "PE32",
    size: 256,
  });
  const arm = path.join(root, "installer-arm64.exe");
  writeFakePe(arm, { machine: 0xaa64, magic: 0x020b });
  assert.throws(() => verifyWindowsInstallerExecutable(arm), /必须为 x86 PE32 或 x64 PE32\+/);
});

test("preflight binds exact current and previous installers and remains read-only", (t) => {
  const { root, plan } = fixturePreflight(t);
  assert.equal(plan.ready_for_authorized_run, true);
  assert.equal(plan.mutation_gate.authorized, false);
  assert.equal(plan.current.version, CURRENT_VERSION);
  assert.equal(plan.previous.version, PREVIOUS_VERSION);
  assert.deepEqual(plan.lifecycle, REQUIRED_PHASES);
  assert.equal(fs.existsSync(path.join(root, "out")), false, "preflight must not create output directories");
  assert.throws(
    () => createPreflightPlan({
      root,
      hostPlatform: "darwin",
      hostArch: "arm64",
      verifyCurrent: () => { throw new Error("must not hash"); },
      verifyPrevious: () => { throw new Error("must not hash"); },
    }),
    /只接受 win32\/x64/,
  );
});

test("preflight rejects a previous version that is not strictly older", (t) => {
  const { root } = fixturePreflight(t);
  const sameInstaller = path.join(root, "release", "archive", CURRENT_VERSION, `Oak-Manuscript-${CURRENT_VERSION}-Windows-x64.exe`);
  writeFakePe(sameInstaller);
  assert.throws(
    () => createPreflightPlan({
      root,
      previousVersion: CURRENT_VERSION,
      hostPlatform: "win32",
      hostArch: "x64",
      verifyCurrent: () => manifest(CURRENT_VERSION),
      verifyPrevious: () => manifest(CURRENT_VERSION),
    }),
    /必须严格早于/,
  );
});

test("manifest schema is exact and rejects unknown fields, duplicate kinds and name drift", () => {
  assert.doesNotThrow(() => validateReleaseManifest(manifest(CURRENT_VERSION), {
    expectedVersion: CURRENT_VERSION,
    label: "fixture",
  }));
  const unknown = manifest(CURRENT_VERSION);
  unknown.extra = true;
  assert.throws(() => validateReleaseManifest(unknown, {
    expectedVersion: CURRENT_VERSION,
    label: "fixture",
  }), /字段集合不严格匹配/);
  const duplicate = manifest(CURRENT_VERSION);
  duplicate.artifacts[1].kind = "nsis";
  assert.throws(() => validateReleaseManifest(duplicate, {
    expectedVersion: CURRENT_VERSION,
    label: "fixture",
  }), /非法或重复/);
  const renamed = manifest(CURRENT_VERSION);
  renamed.artifacts[0].filename = "renamed.exe";
  assert.throws(() => validateReleaseManifest(renamed, {
    expectedVersion: CURRENT_VERSION,
    label: "fixture",
  }), /制品名不匹配/);
});

test("archived release verifier binds canonical manifest, checksums, bytes and PE identity", (t) => {
  const root = makeRoot(t);
  const archive = path.join(root, "release", "archive", PREVIOUS_VERSION);
  fs.mkdirSync(archive, { recursive: true });
  const exeName = `Oak-Manuscript-${PREVIOUS_VERSION}-Windows-x64.exe`;
  const zipName = `Oak-Manuscript-${PREVIOUS_VERSION}-Windows-x64.zip`;
  const exe = writeFakePe(path.join(archive, exeName));
  const zip = Buffer.from("fixture zip bytes\n");
  fs.writeFileSync(path.join(archive, zipName), zip);
  const value = manifest(PREVIOUS_VERSION);
  value.artifacts[0].size_bytes = exe.length;
  value.artifacts[0].sha256 = require("node:crypto").createHash("sha256").update(exe).digest("hex");
  value.artifacts[1].size_bytes = zip.length;
  value.artifacts[1].sha256 = require("node:crypto").createHash("sha256").update(zip).digest("hex");
  const sums = Buffer.from(`${value.artifacts.map((item) => `${item.sha256}  ${item.filename}`).join("\n")}\n`);
  value.sha256sums.sha256 = require("node:crypto").createHash("sha256").update(sums).digest("hex");
  fs.writeFileSync(path.join(archive, "release-manifest-win32-x64.json"), `${JSON.stringify(value, null, 2)}\n`);
  fs.writeFileSync(path.join(archive, "SHA256SUMS.txt"), sums);
  assert.equal(verifyArchivedRelease({ root }).version, PREVIOUS_VERSION);
  fs.appendFileSync(path.join(archive, exeName), "tamper");
  assert.throws(() => verifyArchivedRelease({ root }), /哈希或大小不匹配/);
});

test("CLI parser makes mutation a two-key gate", () => {
  assert.deepEqual(parseArgs([]), { run: false, allowSystemMutation: false });
  assert.deepEqual(parseArgs(["--run", "--allow-system-mutation"]), { run: true, allowSystemMutation: true });
  assert.throws(() => parseArgs(["--run"]), /缺少 --allow-system-mutation/);
  assert.throws(() => parseArgs(["--allow-system-mutation"]), /只能与 --run/);
  assert.throws(() => parseArgs(["--unknown"]), /未知参数/);
});

test("runner refuses mutation before making directories or spawning", (t) => {
  const root = makeRoot(t);
  let spawned = false;
  assert.throws(() => runWindowsInstallAcceptance({
    root,
    allowSystemMutation: false,
    hostPlatform: "win32",
    hostArch: "x64",
    preflight: () => ({ ready_for_authorized_run: true }),
    spawn() { spawned = true; throw new Error("must not spawn"); },
  }), /必须显式提供 --allow-system-mutation/);
  assert.equal(spawned, false);
  assert.equal(fs.existsSync(path.join(root, "out")), false);
});

test("authorized runner records the exact install-upgrade-downgrade-uninstall lifecycle", (t) => {
  const { root, plan } = fixturePreflight(t);
  const runId = "fixture-run-0001";
  const paths = installPaths(root, runId);
  let installedVersion = null;
  const invocations = [];
  function spawn(command, args, options) {
    invocations.push({ command, args, options });
    if (command === plan.previous.path || command === plan.current.path) {
      if (command === plan.previous.path && installedVersion === plan.current.version) {
        // Simulate a correctly protected installer: it returns success but leaves the newer app intact.
        return { status: 0, signal: null, stdout: "downgrade blocked\n", stderr: "" };
      }
      installedVersion = command === plan.previous.path ? plan.previous.version : plan.current.version;
      writeFakePe(paths.executable);
      writeFakePe(paths.uninstaller);
      return { status: 0, signal: null, stdout: "installed\n", stderr: "" };
    }
    if (command === paths.executable) {
      const expected = options.env.OAK_EXPECTED_APP_VERSION;
      return installedVersion === expected
        ? { status: 0, signal: null, stdout: `${PASS_MARKER}\n`, stderr: "" }
        : { status: 9, signal: null, stdout: "", stderr: `expected ${expected}, got ${installedVersion}` };
    }
    if (command === paths.uninstaller) {
      fs.rmSync(paths.executable, { force: true });
      fs.rmSync(paths.uninstaller, { force: true });
      installedVersion = null;
      return { status: 0, signal: null, stdout: "uninstalled\n", stderr: "" };
    }
    throw new Error(`unexpected command ${command}`);
  }
  let tick = 0;
  const integrationCalls = [];
  const evidence = runWindowsInstallAcceptance({
    root,
    allowSystemMutation: true,
    hostPlatform: "win32",
    hostArch: "x64",
    runId,
    preflight: () => plan,
    spawn,
    integrationProbe(options) {
      integrationCalls.push({ present: options.expectedPresent, version: options.expectedVersion });
      return {
        registry_install_location: options.expectedPresent,
        registry_display_version: options.expectedPresent ? options.expectedVersion : null,
        desktop_shortcut: options.expectedPresent,
        start_menu_shortcut: options.expectedPresent,
      };
    },
    inheritedEnv: { SAFE_VALUE: "kept", NODE_OPTIONS: "--require=evil" },
    now: () => `2026-07-28T00:00:${String(tick++).padStart(2, "0")}.000Z`,
  });
  assert.equal(evidence.status, "pass");
  assert.deepEqual(evidence.phases.map((item) => item.name), REQUIRED_PHASES);
  assert.equal(evidence.phases.every((item) => item.status === "pass"), true);
  assert.equal(evidence.plan.mutation_gate.authorized, true);
  assert.equal(fs.existsSync(paths.evidenceFile), true);
  assert.equal(JSON.parse(fs.readFileSync(paths.evidenceFile, "utf8")).status, "pass");
  assert.equal(validateWindowsInstallEvidence(evidence, { root }).status, "pass");
  assert.equal(verifyWindowsInstallEvidence({ root, runId }).status, "pass");
  const tamperedArtifact = structuredClone(evidence);
  tamperedArtifact.plan.current.sha256 = "0".repeat(64);
  assert.throws(() => validateWindowsInstallEvidence(tamperedArtifact, { root }), /哈希或大小不匹配/);
  assert.equal(fs.existsSync(paths.persistenceSentinel), true, "uninstall must preserve app data evidence");
  assert.deepEqual(integrationCalls, [
    { present: true, version: PREVIOUS_VERSION },
    { present: true, version: CURRENT_VERSION },
    { present: true, version: CURRENT_VERSION },
    { present: false, version: null },
  ]);
  assert.equal(invocations.every((item) => item.options.windowsHide === true && item.options.shell === false), true);
  const installers = invocations.filter((item) => item.command === plan.previous.path || item.command === plan.current.path);
  for (const invocation of installers) {
    assert.equal(invocation.options.env.TEMP, paths.processTemp);
    assert.equal(invocation.options.env.TMP, paths.processTemp);
    assert.equal(Object.hasOwn(invocation.options.env, "NODE_OPTIONS"), false);
  }
  assert.deepEqual(installers.map((item) => item.args), [
    ["/S", "/currentuser", `/D=${paths.installDir}`],
    ["/S", "/currentuser", `/D=${paths.installDir}`],
    ["/S", "/currentuser", `/D=${paths.installDir}`],
  ]);
  const incomplete = JSON.parse(fs.readFileSync(paths.evidenceFile, "utf8"));
  incomplete.phases.pop();
  fs.writeFileSync(paths.evidenceFile, `${JSON.stringify(incomplete, null, 2)}\n`);
  assert.throws(() => verifyWindowsInstallEvidence({ root, runId }), /PASS 证据缺相/);
});

test("runner fails closed when downgrade replaces the current version and still attempts cleanup", (t) => {
  const { root, plan } = fixturePreflight(t);
  const runId = "fixture-run-0002";
  const paths = installPaths(root, runId);
  let installedVersion = null;
  let cleanupCalls = 0;
  function spawn(command, args, options) {
    if (command === plan.previous.path || command === plan.current.path) {
      installedVersion = command === plan.previous.path ? plan.previous.version : plan.current.version;
      writeFakePe(paths.executable);
      writeFakePe(paths.uninstaller);
      return { status: 0, signal: null, stdout: "installed\n", stderr: "" };
    }
    if (command === paths.executable) {
      return installedVersion === options.env.OAK_EXPECTED_APP_VERSION
        ? { status: 0, signal: null, stdout: `${PASS_MARKER}\n`, stderr: "" }
        : { status: 17, signal: null, stdout: "", stderr: "downgraded" };
    }
    if (command === paths.uninstaller) {
      cleanupCalls += 1;
      fs.rmSync(paths.executable, { force: true });
      fs.rmSync(paths.uninstaller, { force: true });
      return { status: 0, signal: null, stdout: "cleanup\n", stderr: "" };
    }
    throw new Error("unexpected command");
  }
  const evidence = runWindowsInstallAcceptance({
    root,
    allowSystemMutation: true,
    hostPlatform: "win32",
    hostArch: "x64",
    runId,
    preflight: () => plan,
    spawn,
    integrationProbe(options) {
      return {
        registry_install_location: options.expectedPresent,
        registry_display_version: options.expectedVersion,
        desktop_shortcut: options.expectedPresent,
        start_menu_shortcut: options.expectedPresent,
      };
    },
  });
  assert.equal(evidence.status, "fail");
  assert.match(evidence.failure, /退出码为 17/);
  assert.equal(evidence.phases.some((item) => item.name === "smoke_after_downgrade_probe" && item.status === "fail"), true);
  assert.equal(evidence.phases.some((item) => item.name === "cleanup_uninstall"), true);
  assert.equal(cleanupCalls, 1);
  assert.equal(JSON.parse(fs.readFileSync(paths.evidenceFile, "utf8")).status, "fail");
});

test("run IDs and controlled paths reject traversal", (t) => {
  const root = makeRoot(t);
  assert.equal(validateRunId("valid-run-0001"), "valid-run-0001");
  for (const invalid of ["short", "../escape", "run_with_underscore", path.join(os.tmpdir(), "absolute")]) {
    assert.throws(() => validateRunId(invalid), /运行 ID 非法/);
  }
  const paths = installPaths(root, "valid-run-0001");
  assert.equal(path.relative(root, paths.installDir).startsWith(".."), false);
  assert.equal(path.relative(root, paths.evidenceFile).startsWith(".."), false);
  assert.equal(path.basename(paths.uninstaller), UNINSTALL_EXE);
  assert.equal(path.basename(paths.executable), PRODUCT_EXE);
});
