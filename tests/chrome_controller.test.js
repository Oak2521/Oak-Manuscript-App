"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const {
  SECURITY_ARGS,
  createChromeController,
  parseEndpoint,
  sanitizedChromeEnvironment,
} = require("../electron/chrome-controller");

const OUTPUT = path.resolve(__dirname, "../out/test-tmp/chrome-controller");

class FakeChrome extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.signalCode = null;
  }
  kill() {
    this.exitCode = 0;
    this.emit("exit", 0, null);
    return true;
  }
}

test("Chrome controller launches one fixed hidden loopback session and stops its exact child", async (t) => {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(OUTPUT, "profile-"));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const chrome = path.join(OUTPUT, "chrome.exe");
  fs.writeFileSync(chrome, "fixture\n");
  let invocation = null;
  const child = new FakeChrome();
  const controller = createChromeController({
    spawnImpl(command, args, options) {
      invocation = { command, args, options };
      fs.writeFileSync(
        path.join(profile, "DevToolsActivePort"),
        "45678\n/devtools/browser/fixture-id\n",
      );
      return child;
    },
  });
  const session = await controller.launch({
    chrome,
    profile,
    environment: { PATH: "C:/Windows", NODE_OPTIONS: "--require evil.js" },
  });
  assert.equal(session.endpoint, "ws://127.0.0.1:45678/devtools/browser/fixture-id");
  assert.equal(invocation.command, chrome);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.stdio, "ignore");
  assert.equal(invocation.options.env.PATH, "C:/Windows");
  assert.equal(Object.hasOwn(invocation.options.env, "NODE_OPTIONS"), false);
  assert.ok(invocation.args.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(invocation.args.includes(`--user-data-dir=${profile}`));
  for (const argument of SECURITY_ARGS) assert.ok(invocation.args.includes(argument));
  await session.stop();
  assert.equal(child.exitCode, 0);
});

test("Chrome controller accepts only a strict loopback DevTools endpoint and strips proxies", () => {
  assert.equal(
    parseEndpoint("9222\n/devtools/browser/12345678-abcd\n"),
    "ws://127.0.0.1:9222/devtools/browser/12345678-abcd",
  );
  for (const invalid of [
    "0\n/devtools/browser/12345678\n",
    "70000\n/devtools/browser/12345678\n",
    "9222\n/devtools/page/12345678\n",
    "9222\n/devtools/browser/../../escape\n",
  ]) assert.throws(() => parseEndpoint(invalid), /非法/);
  const env = sanitizedChromeEnvironment({
    PATH: "kept",
    HTTPS_PROXY: "http://proxy.invalid",
    CHROME_LOG_FILE: "outside.log",
    OAK_PRIVATE: "secret",
  });
  assert.deepEqual(env, { PATH: "kept" });
});
