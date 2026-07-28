// Electron 主进程：窗口、IPC 白名单、安全基线（方案 §12.3）、冒烟模式。

"use strict";

const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog, ipcMain, shell, session, utilityProcess } = require("electron");

const pathPolicy = require("./path-policy");
const bridge = require("./python-bridge");
const providers = require("./providers");
const { registerAccountSyncIpc } = require("./account-sync-ipc");
const { createAceUtilityRunner } = require("./ace-utility-runner");
const { registerExternalValidationIpc } = require("./external-validation-ipc");
const { registerP0Ipc } = require("./p0-ipc");
const { registerCoreIpc } = require("./core-ipc");
const { registerStandardsIpc } = require("./standards-ipc");
const { StandardsProvider } = require("./standards-provider");
const { createStandardBoundCore } = require("./standard-bound-core");
const { readCoreCommandResult, toFailureResponse } = require("./core-result");
const { createPdfPreview } = require("./pdf-preview");
const { verifyPackagedResourceTrust } = require("./resource-trust");
const RESOURCE_TRUST_ANCHOR = require("./resource-trust-anchor.json");
const {
  applyOfflineChromiumPolicy,
  installOfflineRequestBlocker,
} = require("./offline-policy");

const SMOKE = process.argv.includes("--smoke");
const ALLOWED_EXTERNAL_HOSTS = new Set(["oakbylake.com", "www.oakbylake.com"]);

// 必须发生在 app ready 之前；正常启动和 smoke 使用同一默认离线基线。
applyOfflineChromiumPolicy(app.commandLine);


let mainWindow = null;
let standardsProvider = null;
let standardBoundCore = null;

// ---------- 工具 ----------

function assertString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`参数非法：${name}`);
  return value;
}

function assertProjectDir(dir) {
  assertString(dir, "project");
  if (!path.isAbsolute(dir)) throw new Error("项目路径必须是绝对路径");
  if (!pathPolicy.looksLikeProject(dir)) throw new Error("该目录不是湖岸稿件项目");
  return dir;
}

function ok(data) {
  return { ok: true, ...data };
}

function fail(err) {
  return toFailureResponse(err);
}

async function core(args) {
  if (standardBoundCore === null) throw new Error("标准库验签边界尚未初始化");
  let resultPromise;
  if (args[0] === "create") {
    resultPromise = standardBoundCore.runNewProject(args);
  } else {
    const projectIndex = args.indexOf("--project");
    if (projectIndex < 0 || projectIndex + 1 >= args.length) {
      throw new Error("标准绑定核心命令缺少项目路径");
    }
    const project = assertProjectDir(args[projectIndex + 1]);
    resultPromise = standardBoundCore.runProject(project, args);
  }
  const data = await readCoreCommandResult(args[0], resultPromise);
  return { data };
}

// ---------- IPC：对话框 ----------

ipcMain.handle("dialog:pick-manuscript", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "选择稿件文件",
    filters: [
      { name: "支持的稿件", extensions: ["docx", "md", "txt", "epub"] },
    ],
    properties: ["openFile"],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("dialog:pick-project-dir", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "选择项目保存位置（空目录）",
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("dialog:pick-existing-project", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "打开已有项目（选择项目目录）",
    properties: ["openDirectory"],
  });
  if (r.canceled) return null;
  return pathPolicy.looksLikeProject(r.filePaths[0]) ? r.filePaths[0] : { invalid: true };
});

ipcMain.handle("dialog:pick-export-dir", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "选择导出目录",
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- IPC：核心闭环 ----------

// 所有参数在独立模块中按固定白名单收窄；core() 会让 plan-citation/check
// 与其他已有项目命令一样，先验签项目固定的标准包，再启动 Python。
registerCoreIpc({ ipcMain, runCore: core, pathPolicy });

// P0：预览计划、一次确认后应用、检查点列表与恢复。
// 未保留无 planId 的 core:fix 通道，避免渲染端绕过集中确认。
const standardBoundP0Bridge = Object.freeze({
  planFixes(project) {
    if (standardBoundCore === null) throw new Error("标准库验签边界尚未初始化");
    return standardBoundCore.runProject(project, ["plan-fixes", "--project", project]);
  },
  applyFixPlan(project, planId) {
    if (standardBoundCore === null) throw new Error("标准库验签边界尚未初始化");
    return standardBoundCore.runProject(project, [
      "fix", "--project", project, "--plan-id", planId,
    ]);
  },
  listCheckpoints(project) {
    if (standardBoundCore === null) throw new Error("标准库验签边界尚未初始化");
    return standardBoundCore.runProject(project, ["list-checkpoints", "--project", project]);
  },
  restoreCheckpoint(project, checkpointId) {
    if (standardBoundCore === null) throw new Error("标准库验签边界尚未初始化");
    return standardBoundCore.runProject(project, [
      "restore-checkpoint", "--project", project, "--checkpoint-id", checkpointId,
    ]);
  },
});
registerP0Ipc({ ipcMain, bridge: standardBoundP0Bridge, pathPolicy });

registerAccountSyncIpc({
  ipcMain,
  pathPolicy,
  authProvider: providers.authProvider,
  licenseProvider: providers.licenseProvider,
  syncProvider: providers.syncProvider,
  syncRecordSource: async (project, event, includeIssues) => {
    const { data } = await core(["sync-source", "--project", project, "--event", event]);
    const platform = process.platform === "win32" || process.platform === "darwin"
      ? process.platform
      : null;
    if (platform === null) throw new Error("当前平台尚未进入同步契约支持范围");
    return providers.buildSyncRecordV1({ ...data, platform }, { includeIssues });
  },
});

registerExternalValidationIpc({
  ipcMain,
  pathPolicy,
  runCore: core,
  aceRunner: createAceUtilityRunner({
    utilityProcess,
    pathPolicy,
    onOutput: SMOKE ? ({ stdout, stderr }) => {
      const diagnostic = `${stdout}\n${stderr}`.trim();
      if (diagnostic) console.error(`[ace-helper] ${diagnostic}`);
    } : null,
  }),
  onHelperError: SMOKE ? (error) => {
    console.error(`[ace-helper-error] ${String(error && error.message || error)}`);
  } : null,
});

ipcMain.handle("core:export", async (_e, { project, outDir }) => {
  try {
    assertProjectDir(project);
    const args = ["export", "--project", project];
    if (outDir) args.push("--out", assertString(outDir, "outDir"));
    const { data } = await core(args);
    return ok({ result: data });
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle("core:verify", async (_e, { project }) => {
  try {
    assertProjectDir(project);
    const { data } = await core(["verify", "--project", project]);
    return ok({ result: data });
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle("core:issue", async (_e, { project, id, status }) => {
  try {
    assertProjectDir(project);
    assertString(id, "id");
    if (!["open", "accepted", "rejected", "resolved"].includes(status)) {
      throw new Error("非法的问题状态");
    }
    const { data } = await core(["issue", "--project", project, "--id", id, "--status", status]);
    return ok({ result: data });
  } catch (err) {
    return fail(err);
  }
});

// ---------- IPC：资源与报告 ----------

ipcMain.handle("app:list-samples", () => {
  try {
    const dir = pathPolicy.samplesDir();
    const files = fs.readdirSync(dir)
      .filter((f) => /\.(docx|md|txt|epub)$/i.test(f))
      .map((f) => ({ name: f, path: path.join(dir, f) }));
    return ok({ samples: files });
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle("report:pdf", async (_e, { project }) => {
  try {
    assertProjectDir(project);
    if (standardBoundCore === null) throw new Error("标准库验签边界尚未初始化");
    await standardBoundCore.verifiedProjectStatus(project);
    const target = await createPdfPreview({
      BrowserWindow,
      session,
      pathPolicy,
      project,
    });
    return ok({ path: target });
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle("app:open-exports", (_e, { project }) => {
  try {
    assertProjectDir(project);
    const dir = path.join(project, "exports");
    if (!pathPolicy.isWithin(project, dir)) throw new Error("路径越界");
    shell.openPath(dir);
    return ok({});
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle("app:info", async () => {
  try {
    if (standardsProvider === null) throw new Error("标准库尚未初始化");
    const listing = await standardsProvider.listStandards();
    const standardIdentity = await standardsProvider.verifiedActiveIdentity();
    const release = listing.release;
    if (release.bundle_id !== standardIdentity.bundle_id ||
        release.release_sequence !== standardIdentity.release_sequence ||
        release.manifest_sha256 !== standardIdentity.manifest_sha256 ||
        release.rulepack_name !== standardIdentity.name ||
        release.rulepack_version !== standardIdentity.version) {
      throw new Error("标准库身份在读取期间发生变化，请重试");
    }
    return ok({
      appVersion: app.getVersion(),
      rulepack: `${standardIdentity.name} ${standardIdentity.version}`,
      standardIdentity,
      standardsRelease: release,
      packaged: app.isPackaged,
    });
  } catch (err) {
    return fail(err);
  }
});

// ---------- IPC：用户主动打开出版评估页 ----------
ipcMain.handle("provider:open-evaluation", () => {
  const url = providers.EvaluationProvider.evaluationUrl();
  const host = new URL(url).hostname;
  if (url.startsWith("https://") && ALLOWED_EXTERNAL_HOSTS.has(host)) {
    shell.openExternal(url);
    return ok({ opened: url });
  }
  return fail(new Error("外部链接不在白名单内"));
});

// ---------- 窗口与安全 ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: !SMOKE,
    title: "湖岸稿件 Oak Manuscript",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // 禁止任意导航与新窗口（§12.3）
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault());

  mainWindow.loadFile(path.join(pathPolicy.repoRoot(), "renderer", "index.html"));
}

console.log("[main] module loaded, smoke =", SMOKE);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

app.whenReady().then(async () => {
  console.log("[main] app ready");
  if (app.isPackaged) {
    try {
      verifyPackagedResourceTrust({
        root: pathPolicy.resourcesRoot(),
        platform: process.platform,
        arch: process.arch,
        anchor: RESOURCE_TRUST_ANCHOR,
      });
      console.log("[resources] packaged trust root verified");
    } catch (error) {
      console.error("[resources] packaged trust root failed:", error && error.message);
      app.exit(1);
      return;
    }
  }
  const standardsStoreRoot = path.join(app.getPath("userData"), "standards");
  bridge.configureStandardsStoreRoot(standardsStoreRoot);
  standardsProvider = new StandardsProvider({
    rootDir: standardsStoreRoot,
    configDir: pathPolicy.configDir(),
    appVersion: app.getVersion(),
  });
  standardBoundCore = createStandardBoundCore({ bridge, provider: standardsProvider });
  registerStandardsIpc({
    ipcMain,
    dialog,
    getWindow: () => mainWindow,
    provider: standardsProvider,
    boundCore: standardBoundCore,
    pathPolicy,
  });
  try {
    await standardsProvider.initialize();
    console.log("[standards] active release verified");
  } catch (error) {
    // Keep the UI available to explain the fail-closed state. The same store
    // root is still injected into Python, so checks cannot silently fall back.
    console.error("[standards] initialization failed:", error && error.message);
  }
  installOfflineRequestBlocker(session.defaultSession.webRequest);
  // CSP：仅允许自身资源（renderer 亦有 meta CSP 双保险）
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
        ],
      },
    });
  });
  createWindow();
  console.log("[main] window created");
  if (SMOKE) {
    const { runSmoke } = require("./smoke");
    try {
      await runSmoke(mainWindow, pathPolicy);
      console.log("SMOKE-RESULT: PASS");
      app.exit(0);
    } catch (err) {
      console.error("SMOKE-RESULT: FAIL", err && err.message);
      app.exit(1);
    }
  }
});
}

app.on("window-all-closed", () => app.quit());
