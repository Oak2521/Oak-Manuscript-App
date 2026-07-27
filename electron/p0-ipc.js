// P0 IPC：集中确认后的批量修复与检查点恢复。
// 本模块独立可测；渲染端不能传入任意 CLI 参数。

"use strict";

const path = require("path");
const { readCoreResult, toFailureResponse } = require("./core-result");

function ok(data) {
  return { ok: true, ...data };
}

function fail(err) {
  return toFailureResponse(err);
}

function assertProjectDir(project, pathPolicy) {
  if (typeof project !== "string" || !project.trim() || !path.isAbsolute(project)) {
    throw new Error("参数非法：project");
  }
  if (!pathPolicy.looksLikeProject(project)) throw new Error("该目录不是湖岸稿件项目");
  return project;
}

function assertOpaqueId(value, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`参数非法：${name}`);
  }
  return value;
}

function registerP0Ipc({ ipcMain, bridge, pathPolicy }) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("ipcMain 非法");

  ipcMain.handle("core:plan-fixes", async (_event, payload = {}) => {
    try {
      const project = assertProjectDir(payload.project, pathPolicy);
      const result = await readCoreResult(bridge.planFixes(project));
      return ok({ result });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("core:apply-fix-plan", async (_event, payload = {}) => {
    try {
      const project = assertProjectDir(payload.project, pathPolicy);
      const planId = assertOpaqueId(payload.planId, "planId");
      const result = await readCoreResult(bridge.applyFixPlan(project, planId));
      return ok({ result });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("core:list-checkpoints", async (_event, payload = {}) => {
    try {
      const project = assertProjectDir(payload.project, pathPolicy);
      const result = await readCoreResult(bridge.listCheckpoints(project));
      return ok({ result });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("core:restore-checkpoint", async (_event, payload = {}) => {
    try {
      const project = assertProjectDir(payload.project, pathPolicy);
      const checkpointId = assertOpaqueId(payload.checkpointId, "checkpointId");
      const result = await readCoreResult(bridge.restoreCheckpoint(project, checkpointId));
      return ok({ result });
    } catch (err) {
      return fail(err);
    }
  });
}

module.exports = {
  registerP0Ipc,
  assertProjectDir,
  assertOpaqueId,
};
