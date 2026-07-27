// P0 IPC：集中确认后的批量修复与检查点恢复。
// 本模块独立可测；渲染端不能传入任意 CLI 参数。

"use strict";

const path = require("path");

function ok(data) {
  return { ok: true, ...data };
}

function fail(err) {
  return { ok: false, error: String((err && err.message) || err) };
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

async function readCoreResult(resultPromise) {
  const { code, json, stderr } = await resultPromise;
  if (json === null || json === undefined) throw new Error(stderr || "核心无输出");
  const failedJson = json && typeof json === "object" && json.ok === false;
  // AD-002：0=成功，1=发现未处理问题但仍有有效 JSON，2=运行错误。
  // 保留 code 1 的可消费结果；其他非零退出码一律不能被外层包装成成功。
  const failedExit = Number.isInteger(code) && code !== 0 && code !== 1;
  if (failedJson || failedExit) {
    const detail = json && typeof json === "object" && (json.error || json.message);
    throw new Error(String(detail || stderr || `检查核心运行失败（退出码 ${code}）`));
  }
  return json;
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
