"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../renderer/index.html"), "utf8");
const app = fs.readFileSync(path.resolve(__dirname, "../renderer/app.js"), "utf8");
const preload = fs.readFileSync(path.resolve(__dirname, "../electron/preload.js"), "utf8");
const main = fs.readFileSync(path.resolve(__dirname, "../electron/main.js"), "utf8");

test("settings page exposes the three approved AI modes and six provider families", () => {
  for (const mode of ["off", "oak", "byo"]) {
    assert.match(html, new RegExp(`name=["']ai-mode["'][^>]*value=["']${mode}["']`));
  }
  for (const provider of ["openai", "anthropic", "google", "openai_compatible", "ollama", "lm_studio"]) {
    assert.match(html, new RegExp(`value=["']${provider}["']`));
  }
  for (const id of [
    "ai-status-text", "ai-provider-select", "ai-model-input", "ai-base-url-input",
    "ai-credential-input", "btn-save-ai-settings", "btn-clear-ai-credential",
    "ai-request-dialog", "ai-plan-request-json", "ai-plan-sends",
    "ai-plan-does-not-send", "btn-confirm-ai-request", "ai-suggestion-text",
    "ai-suggestion-review-status", "btn-accept-ai-suggestion", "btn-reject-ai-suggestion",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /不能静默写回稿件/);
  assert.match(html, /不会在失败时自动切换到湖岸 AI/);
  assert.match(html, /保存设置不会联网/);
  assert.match(app, /\["openai", "anthropic", "google"\]\.includes\(provider\)/);
  assert.match(app, /input\.disabled = fixedCloud/);
});

test("credential crosses one fixed IPC and is never populated or rendered from status", () => {
  assert.match(html, /id="ai-credential-input" type="password"/);
  assert.match(preload, /configureAi: \(config\) => ipcRenderer\.invoke\("provider:ai-configure", config\)/);
  assert.match(preload, /clearAiCredential: \(\) => ipcRenderer\.invoke\("provider:ai-clear-credential"\)/);
  assert.match(preload, /provider:ai-plan-suggestion/);
  assert.match(preload, /provider:ai-confirm-suggestion/);
  assert.match(preload, /provider:ai-cancel-suggestion/);
  assert.match(preload, /provider:ai-review-suggestion/);
  const renderer = app.slice(app.indexOf("function renderAiSettings()"),
    app.indexOf("async function refreshAiStatus()"));
  assert.match(renderer, /ai-credential-input"\)\.value = ""/);
  assert.match(renderer, /ai-status-text"\)\.textContent/);
  assert.doesNotMatch(renderer, /credential[^\n]*textContent/);
  assert.doesNotMatch(renderer, /innerHTML/);
});

test("main process owns OS-encrypted AI persistence and enables only the compatible transport family", () => {
  assert.match(main, /new EncryptedAISettingsStore/);
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /safeStorage\.decryptString/);
  assert.match(main, /registerAIIpc/);
  assert.match(main, /new AIRequestCoordinator/);
  assert.match(main, /reviewSink:[\s\S]*?"--status", "accepted"/);
  assert.match(main, /new AITransportRouter/);
  assert.match(main, /new BoundedAIHttpClient/);
  assert.match(main, /createOpenAICompatibleAdapters/);
  assert.match(main, /configureTransport\(aiTransport\)/);
  assert.match(main, /transport: aiTransport/);
  assert.match(main, /\{ ok: _ok, \.\.\.context \} = data/);
  assert.match(main, /OpenAI-compatible transport available/);
  assert.doesNotMatch(main, /transport: null/);
  assert.doesNotMatch(main, /provider:ai-(?:request|complete|stream)/);
});

test("AI request preview and suggestion use text-only rendering and disable unavailable transport", () => {
  const start = app.indexOf("function renderAiRequestPlan(plan)");
  const end = app.indexOf("function updateAiEndpointInput", start);
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const renderer = app.slice(start, end);
  assert.match(renderer, /ai-plan-request-json"\)\.textContent = JSON\.stringify/);
  assert.match(renderer, /confirm\.disabled = !plan\.transport_available/);
  assert.match(renderer, /replaceTextList/);
  assert.doesNotMatch(renderer, /innerHTML/);
  assert.match(app, /ai-suggestion-text"\)\.textContent = response\.suggestion\.text/);
  assert.match(app, /重新生成发送预览（不发送）/);
  assert.match(app, /重新生成预览本身不会联网/);
  assert.match(app, /aiRetryRequest/);
  assert.match(app, /reviewAiSuggestion\("accepted"\)/);
  assert.match(app, /reviewAiSuggestion\("rejected"\)/);
  assert.match(app, /问题状态已标记为接受，但建议未写入稿件或项目文件/);
  assert.match(app, /规则问题状态和稿件均未改变/);
  assert.match(html, /OpenAI-compatible 自定义接口、Ollama 和 LM Studio 已接入/);
  assert.doesNotMatch(html, /on(?:click|change|submit)=/i);
});
