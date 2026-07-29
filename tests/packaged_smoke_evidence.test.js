"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  EVIDENCE_FILENAME,
  buildPackagedSmokeEvidence,
  parseArgs,
  verifyPackagedSmokeEvidence,
  writePackagedSmokeEvidence,
} = require("../scripts/packaged_smoke_evidence");

const REPO_ROOT = path.resolve(__dirname, "..");
const VERSION = "9.8.7-alpha.1";
const PRODUCT_EXE = "湖岸稿件 Oak Manuscript.exe";

function makeRoot(t) {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "packaged-smoke-evidence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, bytes) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return target;
}

function fixture(t) {
  const root = makeRoot(t);
  write(root, "package.json", `${JSON.stringify({
    name: "oak-manuscript",
    productName: "湖岸稿件 Oak Manuscript",
    version: VERSION,
    build: { appId: "com.oakbylake.manuscript" },
  }, null, 2)}\n`);
  const executable = write(root, `release/win-unpacked/${PRODUCT_EXE}`, Buffer.alloc(4096, 7));
  const runId = "fixture-run";
  const outputRoot = path.join(root, "out", "packaged-smoke", "runs", runId, "projects");
  write(root, `out/packaged-smoke/runs/${runId}/projects/ui-smoke-docx/project.json`, "{\"ok\":true}\n");
  write(root, `out/packaged-smoke/runs/${runId}/projects/ui-smoke-epub/report.txt`, "checked\n");
  return {
    root,
    executable,
    outputRoot,
    runId,
    result: {
      executable,
      expectedVersion: VERSION,
      runId,
      outputRoot,
      stdout: "diagnostic\nSMOKE-RESULT: PASS\n",
      stderr: "",
      syncRecoveryStdout: "SYNC-RECOVERY-RESULT: PASS\n",
      syncRecoveryStderr: "",
    },
  };
}

test("packaged smoke evidence CLI has one fixed verification action", () => {
  assert.deepEqual(parseArgs(["--verify", "--platform", "win32", "--arch", "x64"]), {
    platform: "win32",
    arch: "x64",
    requireOutputTree: false,
  });
  assert.deepEqual(parseArgs(["--verify-live", "--platform", "win32", "--arch", "x64"]), {
    platform: "win32",
    arch: "x64",
    requireOutputTree: true,
  });
  assert.throws(() => parseArgs([]), /必须且只能指定一个操作/);
  assert.throws(() => parseArgs(["--verify", "--verify-live"]), /必须且只能指定一个操作/);
  assert.throws(
    () => parseArgs(["--verify", "--platform", "darwin", "--arch", "x64"]),
    /只接受 win32\/x64/,
  );
});

test("canonical evidence binds the packaged executable, output tree, and both process markers", (t) => {
  const data = fixture(t);
  const built = buildPackagedSmokeEvidence({ root: data.root, smokeResult: data.result });
  assert.equal(built.schema_version, 1);
  assert.equal(built.version, VERSION);
  assert.equal(built.executable.path, `release/win-unpacked/${PRODUCT_EXE}`);
  assert.equal(built.executable.size_bytes, 4096);
  assert.match(built.executable.sha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(built.run, {
    run_id: data.runId,
    external_validation_required: true,
    sync_recovery_required: true,
    primary_marker_count: 1,
    recovery_marker_count: 1,
    primary_stdout_sha256: built.run.primary_stdout_sha256,
    primary_stderr_sha256: built.run.primary_stderr_sha256,
    recovery_stdout_sha256: built.run.recovery_stdout_sha256,
    recovery_stderr_sha256: built.run.recovery_stderr_sha256,
  });
  assert.equal(built.output_tree.path, `out/packaged-smoke/runs/${data.runId}/projects`);
  assert.equal(built.output_tree.file_count, 2);
  assert.equal(built.output_tree.total_bytes, 20);
  assert.match(built.output_tree.sha256, /^[a-f0-9]{64}$/u);

  const written = writePackagedSmokeEvidence({ root: data.root, smokeResult: data.result });
  assert.deepEqual(written, built);
  const evidencePath = path.join(data.root, "release", EVIDENCE_FILENAME);
  assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, "utf8")), built);
  assert.deepEqual(verifyPackagedSmokeEvidence({ root: data.root, requireOutputTree: true }), built);
  assert.equal(fs.statSync(evidencePath).nlink, 1);
});

test("live verification detects output drift while release verification remains self-contained", (t) => {
  const data = fixture(t);
  writePackagedSmokeEvidence({ root: data.root, smokeResult: data.result });
  fs.appendFileSync(path.join(data.outputRoot, "ui-smoke-epub", "report.txt"), "changed\n");
  assert.throws(
    () => verifyPackagedSmokeEvidence({ root: data.root, requireOutputTree: true }),
    /输出树.*不一致/,
  );
  assert.equal(verifyPackagedSmokeEvidence({ root: data.root }).version, VERSION);

  fs.appendFileSync(data.executable, "changed");
  assert.throws(() => verifyPackagedSmokeEvidence({ root: data.root }), /EXE.*不一致/);
});

test("writer rejects forged markers, stale bindings, and linked output files", (t) => {
  const forged = fixture(t);
  assert.throws(
    () => writePackagedSmokeEvidence({
      root: forged.root,
      smokeResult: { ...forged.result, stdout: "SMOKE-RESULT: PASS\nSMOKE-RESULT: PASS\n" },
    }),
    /唯一成功标志/,
  );
  assert.throws(
    () => writePackagedSmokeEvidence({
      root: forged.root,
      smokeResult: { ...forged.result, expectedVersion: "9.8.7-alpha.0" },
    }),
    /版本.*不一致/,
  );
  assert.throws(
    () => writePackagedSmokeEvidence({
      root: forged.root,
      smokeResult: { ...forged.result, outputRoot: path.join(forged.root, "outside") },
    }),
    /输出目录.*不匹配/,
  );

  const linked = fixture(t);
  const source = path.join(linked.outputRoot, "ui-smoke-epub", "report.txt");
  fs.linkSync(source, path.join(linked.outputRoot, "linked.txt"));
  assert.throws(
    () => writePackagedSmokeEvidence({ root: linked.root, smokeResult: linked.result }),
    /单链接/,
  );
});

test("output inventory permits only the known project write lock hidden filename", (t) => {
  const data = fixture(t);
  fs.writeFileSync(path.join(data.outputRoot, "ui-smoke-docx", ".oak-project-write.lock"), "released\n");
  const evidence = writePackagedSmokeEvidence({ root: data.root, smokeResult: data.result });
  assert.equal(evidence.output_tree.file_count, 3);

  fs.writeFileSync(path.join(data.outputRoot, "ui-smoke-docx", ".unexpected"), "hidden\n");
  assert.throws(
    () => writePackagedSmokeEvidence({ root: data.root, smokeResult: data.result }),
    /非法名称：\.unexpected/,
  );
});

test("strict verification rejects evidence schema and canonical-byte tampering", (t) => {
  const data = fixture(t);
  writePackagedSmokeEvidence({ root: data.root, smokeResult: data.result });
  const evidencePath = path.join(data.root, "release", EVIDENCE_FILENAME);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  evidence.untrusted = true;
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  assert.throws(() => verifyPackagedSmokeEvidence({ root: data.root }), /字段集合/);

  delete evidence.untrusted;
  fs.writeFileSync(evidencePath, JSON.stringify(evidence));
  assert.throws(() => verifyPackagedSmokeEvidence({ root: data.root }), /canonical/);
});
