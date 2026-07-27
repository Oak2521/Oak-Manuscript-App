"use strict";

const { readCoreResult, toFailureResponse } = require("./core-result");
const { assertOpaqueId, assertProjectDir } = require("./p0-ipc");
const { sameIdentity } = require("./standard-bound-core");

function ok(data = {}) {
  return { ok: true, ...data };
}

function summarizeChanges(items) {
  const shown = items.slice(0, 12).map((item) => `• ${item}`).join("\n");
  return items.length > 12 ? `${shown}\n• 另有 ${items.length - 12} 项…` : shown;
}

function registerStandardsIpc({
  ipcMain,
  dialog,
  getWindow,
  provider,
  boundCore,
  pathPolicy,
}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("ipcMain 非法");
  if (!dialog || typeof dialog.showOpenDialog !== "function" ||
      typeof dialog.showMessageBox !== "function") throw new TypeError("dialog 非法");
  if (!provider) throw new TypeError("StandardsProvider 非法");
  if (!boundCore || typeof boundCore.verifiedProjectStatus !== "function" ||
      typeof boundCore.runProject !== "function") throw new TypeError("标准绑定核心非法");
  if (!pathPolicy || typeof pathPolicy.looksLikeProject !== "function") {
    throw new TypeError("项目路径策略非法");
  }

  ipcMain.handle("standards:status", async () => {
    try {
      return ok({ status: await provider.verifiedStatus() });
    } catch (error) {
      return toFailureResponse(error);
    }
  });

  ipcMain.handle("standards:list", async () => {
    try {
      const listing = await provider.listStandards();
      return ok({ ...listing, status: provider.status() });
    } catch (error) {
      return toFailureResponse(error);
    }
  });

  ipcMain.handle("standards:install-local", async () => {
    try {
      const status = await provider.verifiedStatus();
      if (!status.local_signed_import_enabled) {
        const error = new Error("正式发布签名公钥尚未配置，本版本不能导入标准更新包");
        error.code = "TRUST_ROOT_UNCONFIGURED";
        throw error;
      }
      const picked = await dialog.showOpenDialog(getWindow(), {
        title: "选择湖岸签名标准更新包",
        filters: [{ name: "湖岸标准更新包", extensions: ["oakstd"] }],
        properties: ["openFile"],
      });
      if (picked.canceled || picked.filePaths.length !== 1) return ok({ canceled: true });
      const preview = await provider.previewPackage(picked.filePaths[0]);
      const confirmation = await dialog.showMessageBox(getWindow(), {
        type: "warning",
        title: "确认安装标准更新",
        message: `安装标准与规则包 ${preview.version}（序列 ${preview.release_sequence}）？`,
        detail: `${summarizeChanges(preview.change_summary)}\n\n`
          + "安装后，新建项目自动使用此版本；已有项目继续固定原版本，须另行查看差异并确认升级。",
        buttons: ["安装更新", "取消"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (confirmation.response !== 0) return ok({ canceled: true, preview });
      const result = await provider.importPackage(picked.filePaths[0], preview);
      return ok({ canceled: false, result });
    } catch (error) {
      return toFailureResponse(error);
    }
  });

  ipcMain.handle("standards:rollback-global", async () => {
    try {
      const preview = await provider.previewRollback();
      const confirmation = await dialog.showMessageBox(getWindow(), {
        type: "warning",
        title: "确认切换默认标准版本",
        message: `将新建项目默认标准从 ${preview.active.version} 切换到 ${preview.target.version}？`,
        detail: "此操作只切换今后新建项目的默认版本；已有项目仍固定原版本，不会静默改变检查结果。防降级高水位不会降低。",
        buttons: ["确认切换", "取消"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (confirmation.response !== 0) return ok({ canceled: true, preview });
      const result = await provider.rollback(preview);
      return ok({ canceled: false, result });
    } catch (error) {
      return toFailureResponse(error);
    }
  });

  ipcMain.handle("standards:project-status", async (_event, payload = {}) => {
    try {
      const project = assertProjectDir(payload.project, pathPolicy);
      const projectStatus = await boundCore.verifiedProjectStatus(project, {
        allowMigrationSource: true,
      });
      const activeIdentity = await provider.verifiedActiveIdentity();
      return ok({
        project: projectStatus.status.project,
        project_identity: projectStatus.identity,
        stored_identity: projectStatus.status.stored_identity,
        legacy_migratable: projectStatus.status.legacy_migratable === true,
        active_identity: activeIdentity,
        differs: !sameIdentity(projectStatus.identity, activeIdentity),
      });
    } catch (error) {
      return toFailureResponse(error);
    }
  });

  ipcMain.handle("standards:plan-project-change", async (_event, payload = {}) => {
    try {
      const project = assertProjectDir(payload.project, pathPolicy);
      const target = await provider.verifiedActiveIdentity();
      const result = await readCoreResult(boundCore.runProject(project, [
        "plan-rulepack-upgrade",
        "--project", project,
        "--to-manifest-sha256", target.manifest_sha256,
      ], { allowMigrationSource: true }));
      return ok({ result });
    } catch (error) {
      return toFailureResponse(error);
    }
  });

  ipcMain.handle("standards:apply-project-change", async (_event, payload = {}) => {
    try {
      const project = assertProjectDir(payload.project, pathPolicy);
      const planId = assertOpaqueId(payload.planId, "planId");
      const target = await provider.verifiedActiveIdentity();
      const result = await readCoreResult(boundCore.runProject(project, [
        "upgrade-rulepack",
        "--project", project,
        "--to-manifest-sha256", target.manifest_sha256,
        "--plan-id", planId,
      ], { allowMigrationSource: true }));
      return ok({ result });
    } catch (error) {
      return toFailureResponse(error);
    }
  });
}

module.exports = { registerStandardsIpc, summarizeChanges };
