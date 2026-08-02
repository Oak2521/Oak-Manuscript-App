// 外部验证 IPC：Renderer 只提交项目路径；Ace 模块、参数、环境、状态与
// 退出码均由受信任主进程和 Python 两阶段计划决定。

"use strict";

const path = require("node:path");
const { toFailureResponse } = require("./core-result");

const PLAN_ID_RE = /^external-plan-[0-9a-f]{64}$/;

function assertProject(project, pathPolicy) {
  if (typeof project !== "string" || !path.isAbsolute(project) ||
      !pathPolicy || typeof pathPolicy.looksLikeProject !== "function" ||
      !pathPolicy.looksLikeProject(project)) {
    throw new Error("该目录不是湖岸稿件项目");
  }
  return path.resolve(project);
}

function registerExternalValidationIpc({
  ipcMain, runCore, pathPolicy, aceRunner, onHelperError = null,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("ipcMain 非法");
  if (typeof runCore !== "function") throw new TypeError("外部验证核心非法");
  if (!aceRunner || typeof aceRunner.run !== "function") throw new TypeError("Ace runner 非法");
  if (onHelperError !== null && typeof onHelperError !== "function") {
    throw new TypeError("Ace helper error observer 非法");
  }

  ipcMain.handle("core:external", async (_event, payload = {}) => {
    try {
      const project = assertProject(payload.project, pathPolicy);
      const { data: planned } = await runCore(["external-plan", "--project", project]);
      const plan = planned && planned.plan;
      if (!plan || typeof plan !== "object" || !PLAN_ID_RE.test(plan.plan_id)) {
        throw new Error("外部验证计划非法");
      }

      let exitCode = null;
      if (plan.ace_request !== null) {
        await runCore([
          "external-prepare", "--project", project, "--plan-id", plan.plan_id,
        ]);
        try {
          const helper = await aceRunner.run({ project, request: plan.ace_request });
          if (helper && Number.isInteger(helper.exitCode) &&
              helper.exitCode >= 0 && helper.exitCode <= 255) {
            exitCode = helper.exitCode;
          }
        } catch (error) {
          if (onHelperError !== null) {
            try { onHelperError(error); } catch { /* 诊断观察者不得改变业务状态 */ }
          }
          // Python finalize 仍会运行 EpubCheck，并把缺失 helper 证据如实记为 not_run。
        }
      }

      const finalize = [
        "external-finalize", "--project", project, "--plan-id", plan.plan_id,
      ];
      if (exitCode !== null) finalize.push("--ace-exit-code", String(exitCode));
      const { data } = await runCore(finalize);
      return { ok: true, result: data };
    } catch (error) {
      return toFailureResponse(error);
    }
  });
}

module.exports = { PLAN_ID_RE, registerExternalValidationIpc };
