"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "renderer", "index.html"), "utf8");
const APP = fs.readFileSync(path.join(ROOT, "renderer", "app.js"), "utf8");
const { normalizeFormatCoverage } = require("../renderer/format-coverage-model");

function fixture(overrides = {}) {
  return {
    schema_version: "1.0",
    format: "md",
    status: "limited",
    rule_ids: ["MD-STRUCT-001", "TEXT-EMPTY-001", "TEXT-SPACE-001"],
    auto_fixable_rule_ids: [],
    excluded_contexts: ["fenced_code", "inline_code", "table", "hard_break", "layout_sensitive"],
    not_checked: ["semantic_rewriting", "full_markdown_conformance", "external_standard_completeness"],
    disclosure: "Markdown 已运行 3 条确定性规则；没有发现问题不能代表全面审查。",
    ...overrides,
  };
}

test("results page exposes a dedicated format coverage matrix", () => {
  for (const id of [
    "format-coverage-card",
    "format-coverage-summary",
    "format-coverage-rules",
    "format-coverage-excluded",
    "format-coverage-not-checked",
    "format-coverage-autofix",
  ]) assert.match(HTML, new RegExp(`id=["']${id}["']`));
  assert.match(HTML, /format-coverage-model\.js/);
  assert.match(APP, /OakFormatCoverage/);
  assert.match(APP, /\.textContent\s*=/, "coverage text must use textContent rather than HTML injection");
});

test("coverage model renders exact bounded labels without manuscript content", () => {
  const normalized = normalizeFormatCoverage(fixture());
  assert.equal(normalized.formatLabel, "Markdown");
  assert.equal(normalized.statusLabel, "有限覆盖");
  assert.equal(normalized.ruleCount, 3);
  assert.equal(normalized.autoFixLabel, "本格式没有自动修复规则");
  assert.match(normalized.excludedLabel, /围栏代码/);
  assert.match(normalized.notCheckedLabel, /语义改写/);
  assert.match(normalized.summary, /不能代表全面审查/);
});

test("coverage model rejects unknown fields, unsafe rule ids, and unbounded disclosure", () => {
  assert.throws(() => normalizeFormatCoverage(fixture({ extra: true })), /字段/);
  assert.throws(() => normalizeFormatCoverage(fixture({ rule_ids: ["正文内容"] })), /rule_ids/);
  assert.throws(() => normalizeFormatCoverage(fixture({ disclosure: "x".repeat(513) })), /disclosure/);
  assert.throws(() => normalizeFormatCoverage(fixture({ excluded_contexts: ["unknown"] })), /excluded_contexts/);
});
