"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "renderer", "index.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "renderer", "app.js"), "utf8");

test("standards page exposes review and source-verification status separately", () => {
  assert.match(html, /id="standards-governance-text"/);
  assert.match(html, /<th>来源核验<\/th>/);
  assert.match(app, /active:\s*"规则已启用"/);
  assert.match(app, /verified:\s*"已核验"/);
  assert.match(app, /pending:\s*"待核验"/);
  assert.match(app, /unavailable:\s*"来源未取得"/);
});

test("standards governance disclosure is text-only and never claims completeness while gate is open", () => {
  const start = app.indexOf("function renderStandardsGovernanceSummary");
  const end = app.indexOf("async function renderStandardsPage", start);
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const renderer = app.slice(start, end);

  assert.match(renderer, /governance_gate_satisfied/);
  assert.match(renderer, /标准治理门禁未完成/);
  assert.match(renderer, /不能将当前标准库描述为“完整”/);
  assert.match(renderer, /textContent/);
  assert.doesNotMatch(renderer, /innerHTML/);
});
