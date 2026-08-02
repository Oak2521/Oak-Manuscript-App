"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const {
  CORE_BOOTSTRAP,
  PythonCoreProcessProcessor,
} = require("../web/python-core-process-processor");

function request(overrides = {}) {
  const document = {
    format: "txt",
    manuscript_type: "paper",
    check_config: "full",
    citation_style: "default",
    size_bytes: 6,
    ...(overrides.document || {}),
  };
  return {
    schema_version: "1.0",
    request_type: "oak_manuscript_isolated_processing_request",
    document,
    bytes: Buffer.from("secret"),
    ...overrides,
    document,
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(__dirname, "worker-process-"));
  const pythonExecutable = path.join(root, "python.exe");
  const coreDir = path.join(root, "core");
  const scratchRoot = path.join(root, "scratch");
  fs.writeFileSync(pythonExecutable, "fixed-runtime");
  fs.mkdirSync(coreDir);
  fs.mkdirSync(scratchRoot);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, pythonExecutable, coreDir, scratchRoot };
}

function childResult(value, code = 0, { beforeClose, outputBytes } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  queueMicrotask(() => {
    if (typeof beforeClose === "function") beforeClose();
    child.stdout.write(outputBytes || Buffer.from(JSON.stringify(value), "utf8"));
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code, null);
  });
  return child;
}

test("fixed isolated Python process receives only bounded document settings and a private scratch file", async (t) => {
  const paths = fixture(t);
  const calls = [];
  const processor = new PythonCoreProcessProcessor({
    ...paths,
    sourceEnvironment: {
      PATH: "fixed-path",
      SUPABASE_SERVICE_ROLE_KEY: "must-strip",
      HTTPS_PROXY: "must-strip",
      OPENAI_API_KEY: "must-strip",
      OAK_STANDARDS_STORE: "must-strip",
      PYTHONPATH: "must-strip",
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return childResult({ ok: true, check_id: "check-0001", issues: [] }, 1);
    },
  });

  assert.equal(processor.execution_boundary, "isolated_process");
  const result = await processor.execute(request());
  assert.equal(result.media_type, "application/json");
  assert.deepEqual(JSON.parse(result.bytes.toString("utf8")), {
    ok: true, check_id: "check-0001", issues: [],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls.every((call) => call.command === paths.pythonExecutable), true);
  assert.equal(calls.every((call) => call.options.shell === false && call.options.windowsHide === true), true);
  assert.deepEqual(calls[0].args.slice(0, 8),
    ["-I", "-B", "-S", "-X", "utf8", "-c", CORE_BOOTSTRAP, paths.coreDir]);
  assert.equal(calls[0].args.includes("web-check"), true);
  assert.equal(calls[0].args.includes("secret"), false);
  const inputPath = calls[0].args[calls[0].args.indexOf("--input") + 1];
  assert.equal(path.dirname(inputPath), calls[0].options.cwd);
  assert.equal(calls[0].options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(calls[0].options.env.HTTPS_PROXY, undefined);
  assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined);
  assert.equal(calls[0].options.env.OAK_STANDARDS_STORE, undefined);
  assert.equal(calls[0].options.env.PYTHONPATH, undefined);
  assert.equal(calls[0].options.env.PATH, path.dirname(paths.pythonExecutable));
  assert.equal(calls[0].options.env.TEMP, calls[0].options.cwd);
  assert.deepEqual(fs.readdirSync(paths.scratchRoot), []);
});

test("upload inspection uses the fixed Python boundary before storage and returns content-free counts", async (t) => {
  const paths = fixture(t);
  const calls = [];
  const processor = new PythonCoreProcessProcessor({
    ...paths,
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return childResult({
        ok: true,
        schema_version: "1.0",
        inspection_type: "oak_manuscript_web_upload_inspection",
        format: "txt",
        size_bytes: 6,
        package_members: 0,
        expanded_bytes: 6,
      });
    },
  });
  const result = await processor.inspect({
    ...request(),
    request_type: "oak_manuscript_upload_inspection_request",
  });
  assert.equal(processor.max_inspection_ms, processor.max_execution_ms);
  assert.equal(result.inspection_type, "oak_manuscript_web_upload_inspection");
  assert.equal(calls[0].args.includes("web-inspect"), true);
  assert.equal(calls[0].args.includes("web-check"), false);
  assert.equal(calls[0].args.includes("secret"), false);
  assert.deepEqual(fs.readdirSync(paths.scratchRoot), []);
});

test("source mutation and subprocess output overflow fail closed and clean the private scratch", async (t) => {
  const first = fixture(t);
  let inputPath = null;
  const mutating = new PythonCoreProcessProcessor({
    ...first,
    spawnImpl(_command, args) {
      inputPath = args[args.indexOf("--input") + 1];
      return childResult({ ok: true, issues: [] }, 0, {
        beforeClose: () => fs.writeFileSync(inputPath, "changed"),
      });
    },
  });
  await assert.rejects(mutating.execute(request()), /改变了输入文件/);
  assert.deepEqual(fs.readdirSync(first.scratchRoot), []);

  const second = fixture(t);
  const children = [];
  const overflowing = new PythonCoreProcessProcessor({
    ...second,
    maxOutputBytes: 1024,
    spawnImpl() {
      const child = childResult({}, 0, { outputBytes: Buffer.alloc(1025, 0x61) });
      children.push(child);
      return child;
    },
  });
  await assert.rejects(overflowing.execute(request()), /输出超限/);
  assert.equal(children[0].killed, true);
  assert.deepEqual(fs.readdirSync(second.scratchRoot), []);
});

test("request fields and deployment paths are exact before any subprocess starts", async (t) => {
  const paths = fixture(t);
  let spawned = false;
  const processor = new PythonCoreProcessProcessor({
    ...paths,
    spawnImpl() { spawned = true; throw new Error("must not spawn"); },
  });
  await assert.rejects(processor.execute({ ...request(), owner_key: "account:secret" }), /字段集合/);
  await assert.rejects(processor.execute(request({ document: { size_bytes: 7 } })), /值非法/);
  assert.equal(spawned, false);
  assert.throws(() => new PythonCoreProcessProcessor({
    pythonExecutable: "python", coreDir: paths.coreDir, scratchRoot: paths.scratchRoot,
  }), /绝对路径/);
});
