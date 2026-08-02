"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "electron", "main.js"),
  "utf8",
);

test("main routes every business core command through the verified standard binding", () => {
  assert.match(source, /createStandardBoundCore/);
  assert.match(source, /standardBoundCore\.runNewProject\(args\)/);
  assert.match(source, /standardBoundCore\.runProject\(project, args\)/);
  assert.doesNotMatch(
    source,
    /readCoreCommandResult\(args\[0\],\s*bridge\.runCore\(args\)\)/,
    "main must not retain the unverified direct Python path",
  );
});

test("P0 commands, standards IPC, and PDF use the same verified project gate", () => {
  assert.match(source, /registerP0Ipc\(\{\s*ipcMain,\s*bridge:\s*standardBoundP0Bridge/);
  assert.match(source, /registerStandardsIpc\(\{[\s\S]*?boundCore:\s*standardBoundCore/);
  assert.match(source, /registerStandardsIpc\(\{[\s\S]*?pathPolicy/);
  assert.match(
    source,
    /ipcMain\.handle\("report:pdf"[\s\S]*?verifiedProjectStatus\(project\)[\s\S]*?createPdfPreview/,
  );
});

test("desktop startup takes Electron's single-instance lock before opening a window", () => {
  const lockAt = source.indexOf("app.requestSingleInstanceLock()");
  const readyAt = source.indexOf("app.whenReady()");
  const windowAt = source.indexOf("createWindow();");
  assert.ok(lockAt >= 0 && lockAt < readyAt && readyAt < windowAt);
  assert.match(source, /app\.on\("second-instance"/);
});

test("app info returns a freshly verified full standard identity", () => {
  assert.match(
    source,
    /ipcMain\.handle\("app:info"[\s\S]*?verifiedActiveIdentity\(\)[\s\S]*?standardIdentity/,
  );
  assert.match(source, /release\.manifest_sha256 !== standardIdentity\.manifest_sha256/);
  assert.match(source, /rulepack:\s*`\$\{standardIdentity\.name\} \$\{standardIdentity\.version\}`/);
});
