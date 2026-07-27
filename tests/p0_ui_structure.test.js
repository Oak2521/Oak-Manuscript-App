"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "renderer", "styles.css"), "utf8");

test("UI contains one scrollable batch confirmation surface with complete preview fields", () => {
  for (const id of [
    "fix-plan-dialog",
    "fix-plan-items",
    "fix-plan-count",
    "btn-cancel-fix-plan",
    "btn-confirm-fix-plan",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /确认批量修复/);
  assert.match(html, /修改前/);
  assert.match(html, /修改后/);
  assert.doesNotMatch(app, /window\.oak\.fix\s*\(/, "renderer must not retain the direct-fix bypass");
});

test("UI exposes checkpoint list, undo-last and restore-selected actions", () => {
  for (const id of [
    "checkpoint-dialog",
    "checkpoint-list",
    "btn-undo-last-fix",
    "btn-restore-checkpoint",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /撤销上一次批量修复/);
  assert.match(html, /恢复选定检查点/);
});

test("UI marks unrestorable checkpoints, shows the reason and prevents selection", () => {
  assert.match(app, /radio\.disabled\s*=\s*!cp\.canRestore/);
  assert.match(app, /不可恢复/);
  assert.match(app, /cp\.validationErrors/);
  assert.match(app, /if\s*\(cp\.canRestore\)\s*\{[\s\S]*?radio\.addEventListener\("change"/);
  assert.match(styles, /\.checkpoint-option\.unrestorable/);
  assert.match(styles, /cursor:\s*not-allowed/);
});

test("UI exposes a complete project standard diff before one explicit apply", () => {
  for (const id of [
    "project-standard-text",
    "btn-project-standard-change",
    "rulepack-upgrade-dialog",
    "rulepack-upgrade-summary",
    "rulepack-upgrade-release",
    "rulepack-upgrade-rules",
    "rulepack-upgrade-standards",
    "rulepack-upgrade-citation",
    "btn-cancel-rulepack-upgrade",
    "btn-confirm-rulepack-upgrade",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /已有项目不会静默改变/);
  assert.match(app, /window\.oak\.planProjectStandardChange/);
  assert.match(app, /window\.oak\.applyProjectStandardChange/);
  assert.match(app, /\.textContent\s*=/);
  assert.doesNotMatch(app, /rulepack-upgrade[^\n]*innerHTML/);
});
