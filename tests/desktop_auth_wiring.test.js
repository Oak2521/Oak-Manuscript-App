"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(ROOT, "electron/main.js"), "utf8");
const preload = fs.readFileSync(path.join(ROOT, "electron/preload.js"), "utf8");
const renderer = fs.readFileSync(path.join(ROOT, "renderer/app.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("desktop auth is gated by trusted config and OS encryption before any production client exists", () => {
  const configuredAt = main.indexOf('if (config.status === "configured")');
  assert.ok(configuredAt >= 0);
  assert.ok(main.indexOf("safeStorage.isEncryptionAvailable()", configuredAt) > configuredAt);
  assert.ok(main.indexOf("new EncryptedAuthStore", configuredAt) > configuredAt);
  assert.ok(main.indexOf("new AuthHttpClient", configuredAt) > configuredAt);
  assert.ok(main.indexOf("new SyncHttpClient", configuredAt) > configuredAt);
  assert.match(main, /production endpoints pending; login and sync transport disabled/);
});

test("Windows second-instance and macOS open-url callbacks share one strict provider boundary", () => {
  assert.match(main, /app\.on\("second-instance"[\s\S]*?authCallbackFromArgs\(argv\)/);
  assert.match(main, /app\.on\("open-url"[\s\S]*?consumeAuthCallback\(url\)/);
  assert.match(main, /providers\.authProvider\.handleCallback\(url\)/);
  assert.deepEqual(packageJson.build.protocols, [{ name: "Oak Manuscript Auth Callback", schemes: ["oak-manuscript-auth"] }]);
});

test("renderer receives only auth status and fixed queue actions, never tokens or verifier", () => {
  assert.match(preload, /provider:auth-changed/);
  assert.match(preload, /provider:sync-send/);
  for (const forbidden of ["access_token", "refresh_token", "code_verifier"]) {
    assert.equal(preload.includes(forbidden), false, forbidden);
    assert.equal(renderer.includes(forbidden), false, forbidden);
  }
  assert.match(renderer, /发送到网站/);
  assert.match(renderer, /确认重试并发送/);
});
