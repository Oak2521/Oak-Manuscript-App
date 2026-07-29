"use strict";

const { toFailureResponse } = require("./core-result");
const { AIProviderError } = require("./ai-provider");

function ok(data = {}) { return { ok: true, ...data }; }
function fail(error) { return toFailureResponse(error); }
function safeFail(error) {
  return fail(error instanceof TypeError || error instanceof AIProviderError
    ? error
    : new Error("AI 设置操作失败；配置未更改"));
}

function registerAIIpc({ ipcMain, aiProvider, licenseProvider } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function" ||
      !aiProvider || typeof aiProvider.status !== "function" ||
      typeof aiProvider.configure !== "function" || typeof aiProvider.clearCredential !== "function" ||
      !licenseProvider || typeof licenseProvider.status !== "function") {
    throw new TypeError("AI IPC 依赖非法");
  }
  ipcMain.handle("provider:ai-status", () => {
    try { return ok({ status: aiProvider.status(licenseProvider.status()) }); }
    catch (error) { return safeFail(error); }
  });
  ipcMain.handle("provider:ai-configure", (_event, payload = {}) => {
    try { return ok({ status: aiProvider.configure(payload, licenseProvider.status()) }); }
    catch (error) { return safeFail(error); }
  });
  ipcMain.handle("provider:ai-clear-credential", () => {
    try {
      aiProvider.clearCredential();
      return ok({ status: aiProvider.status(licenseProvider.status()) });
    }
    catch (error) { return safeFail(error); }
  });
}

module.exports = { registerAIIpc };
