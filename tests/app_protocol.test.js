"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  APP_ENTRY_URL,
  APP_SCHEME,
  createAppProtocolHandler,
  registerAppSchemeAsPrivileged,
  resolveAppResource,
} = require("../electron/app-protocol");

test("app protocol is registered as a standard secure scheme without CSP bypass", () => {
  const calls = [];
  registerAppSchemeAsPrivileged({
    registerSchemesAsPrivileged(value) { calls.push(value); },
  });
  assert.equal(APP_ENTRY_URL, `${APP_SCHEME}://renderer/index.html`);
  assert.deepEqual(calls, [[{
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  }]]);
});

test("app protocol resolves only four fixed renderer assets", () => {
  const root = path.resolve("D:/fixture/resources/app.asar/renderer");
  assert.deepEqual(resolveAppResource(APP_ENTRY_URL, root), {
    target: path.join(root, "index.html"),
    contentType: "text/html; charset=utf-8",
  });
  for (const name of ["styles.css", "p0-ui-model.js", "app.js"]) {
    assert.equal(resolveAppResource(`${APP_SCHEME}://renderer/${name}`, root).target,
      path.join(root, name));
  }
  for (const url of [
    `${APP_SCHEME}://renderer/../electron/main.js`,
    `${APP_SCHEME}://renderer/%2e%2e/electron/main.js`,
    `${APP_SCHEME}://renderer/index.html?read=electron/main.js`,
    `${APP_SCHEME}://renderer/not-listed.js`,
    `${APP_SCHEME}://other/index.html`,
    "file:///renderer/index.html",
  ]) assert.throws(() => resolveAppResource(url, root), /拒绝|不受支持/);
});

test("app protocol handler returns allowlisted bytes and never reads rejected paths", async () => {
  const reads = [];
  const handler = createAppProtocolHandler({
    rendererRoot: path.resolve("D:/fixture/resources/app.asar/renderer"),
    async readFile(target) {
      reads.push(target);
      return Buffer.from("<h1>湖岸稿件</h1>", "utf8");
    },
  });
  const ok = await handler({ url: APP_ENTRY_URL });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await ok.text(), "<h1>湖岸稿件</h1>");
  assert.equal(reads.length, 1);

  const denied = await handler({ url: `${APP_SCHEME}://renderer/../electron/main.js` });
  assert.equal(denied.status, 404);
  assert.equal(reads.length, 1);
});

test("main registers the privileged scheme before ready and installs its handler before the window", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../electron/main.js"), "utf8");
  const privilegedAt = source.indexOf("registerAppSchemeAsPrivileged(protocol)");
  const readyAt = source.indexOf("app.whenReady()");
  const installAt = source.indexOf("installAppProtocol(");
  const windowAt = source.indexOf("createWindow();");
  assert.ok(privilegedAt >= 0 && privilegedAt < readyAt);
  assert.ok(installAt > readyAt && installAt < windowAt);
  assert.match(source, /mainWindow\.loadURL\(APP_ENTRY_URL\)/);
  assert.doesNotMatch(source, /mainWindow\.loadFile\(path\.join\(pathPolicy\.repoRoot\(\)/);
});
