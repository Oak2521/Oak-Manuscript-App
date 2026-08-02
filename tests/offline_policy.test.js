"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  BLOCKED_NETWORK_PATTERNS,
  OFFLINE_CHROMIUM_SWITCHES,
  applyOfflineChromiumPolicy,
  installOfflineRequestBlocker,
} = require("../electron/offline-policy");

const REPO_ROOT = path.resolve(__dirname, "..");

test("normal Electron startup applies the fixed offline switches before app ready", () => {
  const appended = [];
  applyOfflineChromiumPolicy({ appendSwitch(name) { appended.push(name); } });
  assert.deepEqual(appended, [...OFFLINE_CHROMIUM_SWITCHES]);
  for (const required of [
    "disable-background-networking",
    "disable-component-update",
    "disable-domain-reliability",
    "disable-sync",
    "no-pings",
  ]) assert.equal(appended.includes(required), true, required);

  const source = fs.readFileSync(path.join(REPO_ROOT, "electron", "main.js"), "utf8");
  const policyAt = source.indexOf("applyOfflineChromiumPolicy(app.commandLine)");
  const readyAt = source.indexOf("app.whenReady()");
  const requestBlockerAt = source.indexOf(
    "installOfflineRequestBlocker(session.defaultSession.webRequest)",
  );
  const windowAt = source.indexOf("createWindow();");
  assert.ok(policyAt >= 0 && policyAt < readyAt);
  assert.ok(requestBlockerAt > readyAt && requestBlockerAt < windowAt);
});

test("smoke disables hardware acceleration before ready without changing normal startup", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, "electron", "main.js"), "utf8");
  const smokeDefinition = source.indexOf('const SMOKE = process.argv.includes("--smoke")');
  const disable = source.indexOf("if (SMOKE) app.disableHardwareAcceleration()");
  const ready = source.indexOf("app.whenReady()");
  assert.ok(smokeDefinition >= 0);
  assert.ok(disable > smokeDefinition && disable < ready);
  assert.equal(source.includes("app.disableHardwareAcceleration();\nif (!SMOKE)"), false);
});

test("default Electron session cancels every network-scheme request", () => {
  let filter = null;
  let listener = null;
  installOfflineRequestBlocker({
    onBeforeRequest(nextFilter, nextListener) {
      filter = nextFilter;
      listener = nextListener;
    },
  });
  assert.deepEqual(filter, { urls: [...BLOCKED_NETWORK_PATTERNS] });
  for (const url of [
    "https://example.invalid/path",
    "http://127.0.0.1:12345/observe",
    "wss://example.invalid/socket",
    "ftp://example.invalid/file",
  ]) {
    let decision = null;
    listener({ url }, (value) => { decision = value; });
    assert.deepEqual(decision, { cancel: true }, url);
  }
});
