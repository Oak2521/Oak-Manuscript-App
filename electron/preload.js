// 预加载：只暴露白名单方法（方案 §12.3）。渲染进程无 Node 权限。

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const api = {
  // 对话框
  pickManuscript: () => ipcRenderer.invoke("dialog:pick-manuscript"),
  pickProjectDir: () => ipcRenderer.invoke("dialog:pick-project-dir"),
  pickExistingProject: () => ipcRenderer.invoke("dialog:pick-existing-project"),
  pickExportDir: () => ipcRenderer.invoke("dialog:pick-export-dir"),

  // 核心闭环
  createProject: (opts) => ipcRenderer.invoke("core:create", opts),
  planCitation: (project, citation) =>
    ipcRenderer.invoke("core:plan-citation", { project, citation }),
  check: (project, kind, options = {}) => ipcRenderer.invoke("core:check", {
    project,
    kind,
    citation: options && options.citation,
    citationPlanId: options && options.citationPlanId,
  }),
  planFixes: (project) => ipcRenderer.invoke("core:plan-fixes", { project }),
  applyFixPlan: (project, planId) =>
    ipcRenderer.invoke("core:apply-fix-plan", { project, planId }),
  listCheckpoints: (project) => ipcRenderer.invoke("core:list-checkpoints", { project }),
  restoreCheckpoint: (project, checkpointId) =>
    ipcRenderer.invoke("core:restore-checkpoint", { project, checkpointId }),
  exportAll: (project, outDir) => ipcRenderer.invoke("core:export", { project, outDir }),
  verify: (project) => ipcRenderer.invoke("core:verify", { project }),
  setIssueStatus: (project, id, status) =>
    ipcRenderer.invoke("core:issue", { project, id, status }),
  runExternal: (project) => ipcRenderer.invoke("core:external", { project }),

  // 资源
  listSamples: () => ipcRenderer.invoke("app:list-samples"),
  getStandards: () => ipcRenderer.invoke("standards:list"),
  standardsStatus: () => ipcRenderer.invoke("standards:status"),
  installStandardUpdate: () => ipcRenderer.invoke("standards:install-local"),
  rollbackStandardDefault: () => ipcRenderer.invoke("standards:rollback-global"),
  projectStandardStatus: (project) =>
    ipcRenderer.invoke("standards:project-status", { project }),
  planProjectStandardChange: (project) =>
    ipcRenderer.invoke("standards:plan-project-change", { project }),
  applyProjectStandardChange: (project, planId) =>
    ipcRenderer.invoke("standards:apply-project-change", { project, planId }),
  exportPdf: (project) => ipcRenderer.invoke("report:pdf", { project }),
  openExports: (project) => ipcRenderer.invoke("app:open-exports", { project }),

  // Provider 占位
  authStatus: () => ipcRenderer.invoke("provider:auth-status"),
  syncPreference: (value) => ipcRenderer.invoke("provider:sync-preference", { value }),
  licenseStatus: () => ipcRenderer.invoke("provider:license-status"),
  openEvaluation: () => ipcRenderer.invoke("provider:open-evaluation"),
  appInfo: () => ipcRenderer.invoke("app:info"),
};

contextBridge.exposeInMainWorld("oak", api);
