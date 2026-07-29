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

test("citation checks require one explicit resolver confirmation with all six user choices", () => {
  for (const id of [
    "citation-resolution-dialog",
    "citation-resolution-style",
    "citation-resolution-reason",
    "citation-resolution-confidence",
    "citation-resolution-version",
    "citation-resolution-low-confidence",
    "citation-resolution-select",
    "btn-cancel-citation-resolution",
    "btn-confirm-citation-resolution",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  const dialogStart = html.indexOf('<dialog id="citation-resolution-dialog"');
  const dialogEnd = html.indexOf("</dialog>", dialogStart);
  assert.notEqual(dialogStart, -1);
  assert.notEqual(dialogEnd, -1);
  const dialog = html.slice(dialogStart, dialogEnd);
  const choices = [...dialog.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(choices, [
    "default",
    "gbt7714-2025",
    "apa-7",
    "chicago-18-nb",
    "chicago-18-ad",
    "none",
  ]);
  assert.match(dialog, /取消不会写入任何检查结果/);
  assert.match(dialog, /仅做结构与一致性检查/);

  const start = app.slice(app.indexOf("async startCheck()"), app.indexOf("async autoFix()"));
  assert.match(start, /return this\.prepareCitationPlan\("check", state\.settings\.citation\)/);
  assert.doesNotMatch(start, /window\.oak\.check\s*\(/, "startCheck must stop at confirmation");
  assert.match(app, /window\.oak\.planCitation\(state\.project, citation\)/);

  const confirm = app.slice(
    app.indexOf("async confirmCitationResolution()"),
    app.indexOf("async startCheck()"),
  );
  assert.match(confirm, /window\.oak\.check\(state\.project, plan\.kind, \{/);
  assert.match(confirm, /citation:\s*plan\.citation/);
  assert.match(confirm, /citationPlanId:\s*plan\.planId/);

  const cancel = app.slice(
    app.indexOf("cancelCitationResolution()"),
    app.indexOf("async confirmCitationResolution()"),
  );
  assert.doesNotMatch(cancel, /window\.oak\.check\s*\(/, "cancel must not write check results");
  assert.match(app, /actions\.requestCitationRecheck\(\)/);
});

test("citation resolution is rendered as structured safe text on the results page", () => {
  for (const id of [
    "citation-result-card",
    "citation-result-style",
    "citation-result-reason",
    "citation-result-confidence",
    "citation-result-version",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(app, /input\.mode !== undefined \? input\.mode : input\.check_mode/);
  assert.match(app, /resolver\s*\? nonemptyString\(resolver\.version\)/);
  assert.match(app, /renderCitationResolutionFields\("citation-result", state\.citationResolution\)/);
  assert.match(app, /\$\(`#\$\{prefix\}-reason`\)\.textContent/);
  assert.doesNotMatch(app, /citation-(?:resolution|result)[^\n]*innerHTML/);
  assert.match(styles, /\.citation-resolution-card/);
  assert.match(styles, /\.citation-resolution-modal/);
});

test("selecting a new manuscript or project directory cannot reuse the previous project session", () => {
  const reset = app.slice(
    app.indexOf("function resetCurrentProject"),
    app.indexOf("// ---------- actions"),
  );
  for (const field of [
    "project",
    "lastCheck",
    "citationResolution",
    "citationPlan",
    "fixPlan",
    "checkpoints",
    "rulepackUpgradePlan",
  ]) {
    assert.match(reset, new RegExp(`state\\.${field}\\s*=`));
  }
  const choose = app.slice(app.indexOf("chooseFilePath(file)"), app.indexOf("async showSamples()"));
  assert.match(choose, /state\.file !== file[\s\S]*resetCurrentProject\(\{ clearProjectDir: true \}\)/);
  const setDir = app.slice(app.indexOf("setProjectDir(dir)"), app.indexOf("async openExistingDialog()"));
  assert.match(setDir, /state\.projectDir !== dir[\s\S]*resetCurrentProject\(\)/);
});

test("account entries and sync preview expose explicit, non-blocking choices with safe rendering", () => {
  for (const id of [
    "btn-login",
    "btn-login2",
    "auth-status-text",
    "license-status-text",
    "btn-refresh-license",
    "sync-preview-dialog",
    "sync-preview-fields",
    "btn-sync-once",
    "btn-sync-ask-each-time",
    "btn-sync-not-now",
    "btn-sync-never-project",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /登录不等于同意同步/);
  assert.match(html, /稿件、正文、标题、摘要、文件名、路径和哈希/);
  assert.match(app, /window\.oak\.syncPreview\(state\.project, "export", false\)/);
  assert.match(app, /sync-preview-fields[\s\S]*replaceChildren/);
  assert.doesNotMatch(app, /sync-preview[^\n]*innerHTML/);
  assert.match(app, /window\.oak\.syncConfirm\(preview\.record\.idempotency_id, choice\)/);
  assert.match(app, /window\.oak\.refreshLicense\(\)/);
  const authToggle = app.slice(app.indexOf("async function toggleAccountAuth()"), app.indexOf("function renderAccountStatus()"));
  assert.match(authToggle, /window\.oak\.logout\(\)[\s\S]*await refreshAccountStatus\(\)/,
    "logout must re-derive license and AI state instead of rendering the previous account's Pro status");
});
