"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "..", "renderer", "app.js"),
  "utf8",
);

test("user-controlled export paths are rendered only through textContent", () => {
  assert.match(APP_SOURCE, /item\.textContent = String\(filePath\)/);
  assert.match(APP_SOURCE, /list\.replaceChildren\(\.\.\.items\)/);
  assert.doesNotMatch(APP_SOURCE, /innerHTML[^\n]*(?:\$\{\s*f\s*\}|\$\{\s*r\.path\s*\})/);
});

test("account sync queue is rebuilt with text nodes and never renders internal account ids", () => {
  const start = APP_SOURCE.indexOf("function renderSyncQueue()");
  const end = APP_SOURCE.indexOf("async function refreshSyncQueue()", start);
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const queueRenderer = APP_SOURCE.slice(start, end);
  assert.match(queueRenderer, /meta\.textContent = `\$\{item\.payload\.event\}/);
  assert.match(queueRenderer, /root\.replaceChildren\(\.\.\.children\)/);
  assert.doesNotMatch(queueRenderer, /item\.account_id/);
  assert.doesNotMatch(queueRenderer, /innerHTML/);
});

test("renderer CSP blocks active embedded content and contains no inline styles", () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, "..", "renderer", "index.html"),
    "utf8",
  );
  for (const directive of [
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ]) assert.match(html, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(APP_SOURCE, /\sstyle\s*=/i);
});
