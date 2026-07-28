"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const path = require("node:path");

const { createAceUtilityRunner } = require("../electron/ace-utility-runner");

const PROJECT = path.resolve("out", "test-tmp", "ace-utility-project");
const ENTRY = path.resolve("tools", "ace", "ace.js");
const EPUB = path.join(PROJECT, "working", "book.epub");
const OUTPUT = path.join(PROJECT, "reports", "ace");
const CHROME = path.resolve("out", "test-tmp", "chrome.exe");

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
  }

  kill() { this.killed = true; }
}

function fixture(overrides = {}) {
  const child = new FakeChild();
  const calls = [];
  const fileSnapshots = [];
  const directorySnapshots = [];
  const browserProfile = { target: path.resolve("out", "test-tmp", "oak-ace-chrome-fixture"), identity: "profile" };
  let browserProfileRemoved = false;
  let browserStopped = false;
  const pathPolicy = {
    toolsDir: () => path.resolve("tools"),
    assertSafeExistingProjectFile(project, target, options) {
      assert.equal(project, PROJECT);
      assert.equal(target, EPUB);
      assert.deepEqual(options, { expectedParentRelative: "working" });
      const snapshot = { kind: "project-file", target };
      fileSnapshots.push(snapshot);
      return snapshot;
    },
    assertSafeExistingProjectFileUnchanged(snapshot) {
      assert.equal(snapshot, fileSnapshots[0]);
    },
    assertSafeProjectDirectory(project, target, options) {
      assert.equal(project, PROJECT);
      assert.equal(target, OUTPUT);
      assert.deepEqual(options, { expectedParentRelative: "reports" });
      const snapshot = { kind: "project-directory", target };
      directorySnapshots.push(snapshot);
      return snapshot;
    },
    assertSafeProjectDirectoryUnchanged(snapshot) {
      assert.equal(snapshot, directorySnapshots[0]);
    },
  };
  const runner = createAceUtilityRunner({
    utilityProcess: {
      fork(modulePath, args, options) {
        calls.push({ modulePath, args, options });
        return child;
      },
    },
    pathPolicy,
    inspectExternalFile(target) {
      return { target, identity: `identity:${target}` };
    },
    assertExternalFileUnchanged(snapshot) {
      assert.match(snapshot.identity, /^identity:/);
    },
    timeoutMs: 1000,
    prepareBrowserProfile() { return browserProfile; },
    async removeBrowserProfile(snapshot) {
      assert.equal(snapshot, browserProfile);
      browserProfileRemoved = true;
    },
    chromeController: {
      async launch({ chrome, profile }) {
        assert.equal(chrome, CHROME);
        assert.equal(profile, browserProfile.target);
        return {
          endpoint: "ws://127.0.0.1:45678/devtools/browser/fixture-id",
          async stop() { browserStopped = true; },
        };
      },
    },
    ...overrides,
  });
  return {
    runner, child, calls, browserProfile,
    wasBrowserProfileRemoved: () => browserProfileRemoved,
    wasBrowserStopped: () => browserStopped,
  };
}

test("Ace utility helper uses one fixed module, argument vector and injection-free environment", async () => {
  const {
    runner, child, calls, browserProfile, wasBrowserProfileRemoved, wasBrowserStopped,
  } = fixture();
  const promise = runner.run({
    project: PROJECT,
    request: { entry: ENTRY, chrome: CHROME, epub: EPUB, out_dir: OUTPUT },
    environment: {
      PATH: "C:/Windows",
      NODE_OPTIONS: "--require C:/evil.js",
      ELECTRON_RUN_AS_NODE: "1",
      PUPPETEER_EXECUTABLE_PATH: "C:/evil-chrome.exe",
      OAK_PRIVATE: "secret",
      ACE_TIMEOUT_INITIAL: "1",
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  child.emit("spawn");
  child.emit("exit", 0);
  const result = await promise;

  assert.deepEqual(result, { exitCode: 0, runtime: "electron_utility_process" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].modulePath, ENTRY);
  assert.deepEqual(calls[0].args, ["-f", "-o", OUTPUT, EPUB]);
  assert.equal(calls[0].options.env.PATH, "C:/Windows");
  assert.equal(calls[0].options.env.PUPPETEER_EXECUTABLE_PATH, CHROME);
  assert.equal(calls[0].options.env.ACE_TIMEOUT_INITIAL, "30000");
  assert.equal(calls[0].options.env.OAK_ACE_BROWSER_PROFILE_ROOT, browserProfile.target);
  assert.equal(
    calls[0].options.env.OAK_ACE_BROWSER_WS_ENDPOINT,
    "ws://127.0.0.1:45678/devtools/browser/fixture-id",
  );
  assert.equal(wasBrowserStopped(), true);
  assert.equal(wasBrowserProfileRemoved(), true);
  for (const forbidden of ["NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "OAK_PRIVATE"]) {
    assert.equal(Object.hasOwn(calls[0].options.env, forbidden), false);
  }
  assert.equal(calls[0].options.stdio, "pipe");
  assert.deepEqual(calls[0].options.execArgv, []);
  assert.equal(calls[0].options.allowLoadingUnsignedLibraries, false);
});

test("Ace utility helper exposes only bounded local diagnostics to a trusted observer", async () => {
  let observed = null;
  const { runner, child } = fixture({ onOutput: (value) => { observed = value; } });
  const promise = runner.run({
    project: PROJECT,
    request: { entry: ENTRY, chrome: CHROME, epub: EPUB, out_dir: OUTPUT },
  });
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.write("progress");
  child.stderr.write("diagnostic");
  child.emit("exit", 1);
  assert.deepEqual(await promise, { exitCode: 1, runtime: "electron_utility_process" });
  assert.deepEqual(observed, { stdout: "progress", stderr: "diagnostic" });
});

test("Ace utility helper rejects any module or project-path substitution before fork", async () => {
  const { runner, calls } = fixture();
  await assert.rejects(
    runner.run({
      project: PROJECT,
      request: {
        entry: path.resolve("attacker.js"), chrome: CHROME, epub: EPUB, out_dir: OUTPUT,
      },
    }),
    /固定入口/,
  );
  await assert.rejects(
    runner.run({
      project: PROJECT,
      request: {
        entry: ENTRY, chrome: CHROME, epub: path.resolve("outside.epub"), out_dir: OUTPUT,
      },
    }),
  );
  assert.equal(calls.length, 0);
});

test("Ace utility helper fails closed on timeout and bounded-output overflow", async () => {
  const timeoutFixture = fixture();
  const timed = timeoutFixture.runner.run({
    project: PROJECT,
    request: { entry: ENTRY, chrome: CHROME, epub: EPUB, out_dir: OUTPUT },
  });
  await new Promise((resolve) => setImmediate(resolve));
  timeoutFixture.child.emit("spawn");
  await assert.rejects(timed, /超时/);
  assert.equal(timeoutFixture.child.killed, true);

  const overflowFixture = fixture();
  const overflow = overflowFixture.runner.run({
    project: PROJECT,
    request: { entry: ENTRY, chrome: CHROME, epub: EPUB, out_dir: OUTPUT },
  });
  await new Promise((resolve) => setImmediate(resolve));
  overflowFixture.child.emit("spawn");
  overflowFixture.child.stdout.write(Buffer.alloc(70 * 1024));
  await assert.rejects(overflow, /输出超过/);
  assert.equal(overflowFixture.child.killed, true);
});
