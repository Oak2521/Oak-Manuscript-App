"use strict";

const path = require("node:path");
const { toFailureResponse } = require("./core-result");
const { AIProviderError } = require("./ai-provider");
const { AIRequestError } = require("./ai-request");

function ok(data = {}) { return { ok: true, ...data }; }
function fail(error) { return toFailureResponse(error); }
function safeFail(error) {
  return fail(error instanceof TypeError || error instanceof AIProviderError ||
      error instanceof AIRequestError
    ? error
    : new Error("AI 操作失败；没有发送内容，也没有修改稿件或配置"));
}

function exactPayload(payload, keys, label) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).length !== keys.length || keys.some((key) => !(key in payload))) {
    throw new TypeError(`${label} 字段非法`);
  }
  return payload;
}

function safeProject(project, pathPolicy) {
  if (typeof project !== "string" || !path.isAbsolute(project) ||
      !pathPolicy.looksLikeProject(project)) {
    throw new TypeError("AI 项目路径非法");
  }
  return project;
}

function registerAIIpc({ ipcMain, aiProvider, licenseProvider, aiRequests, pathPolicy } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function" ||
      !aiProvider || typeof aiProvider.status !== "function" ||
      typeof aiProvider.configure !== "function" || typeof aiProvider.clearCredential !== "function" ||
      !licenseProvider || typeof licenseProvider.status !== "function" ||
      !aiRequests || typeof aiRequests.planIssueSuggestion !== "function" ||
      typeof aiRequests.confirmSuggestion !== "function" ||
      typeof aiRequests.cancelSuggestion !== "function" || typeof aiRequests.clear !== "function" ||
      !pathPolicy || typeof pathPolicy.looksLikeProject !== "function") {
    throw new TypeError("AI IPC 依赖非法");
  }
  ipcMain.handle("provider:ai-status", () => {
    try { return ok({ status: aiProvider.status(licenseProvider.status()) }); }
    catch (error) { return safeFail(error); }
  });
  ipcMain.handle("provider:ai-configure", (_event, payload = {}) => {
    try {
      const status = aiProvider.configure(payload, licenseProvider.status());
      aiRequests.clear();
      return ok({ status });
    }
    catch (error) { return safeFail(error); }
  });
  ipcMain.handle("provider:ai-clear-credential", () => {
    try {
      aiProvider.clearCredential();
      aiRequests.clear();
      return ok({ status: aiProvider.status(licenseProvider.status()) });
    }
    catch (error) { return safeFail(error); }
  });
  ipcMain.handle("provider:ai-plan-suggestion", async (_event, payload = {}) => {
    try {
      exactPayload(payload, ["project", "issueId", "instruction"], "AI 预览");
      const plan = await aiRequests.planIssueSuggestion({
        project: safeProject(payload.project, pathPolicy),
        issueId: payload.issueId,
        instruction: payload.instruction,
      });
      return ok({ plan });
    } catch (error) { return safeFail(error); }
  });
  ipcMain.handle("provider:ai-confirm-suggestion", async (_event, payload = {}) => {
    try {
      exactPayload(payload, ["planId"], "AI 确认");
      return ok({ suggestion: await aiRequests.confirmSuggestion(payload.planId) });
    } catch (error) { return safeFail(error); }
  });
  ipcMain.handle("provider:ai-cancel-suggestion", (_event, payload = {}) => {
    try {
      exactPayload(payload, ["planId"], "AI 取消");
      return ok(aiRequests.cancelSuggestion(payload.planId));
    } catch (error) { return safeFail(error); }
  });
}

module.exports = { exactPayload, registerAIIpc, safeProject };
