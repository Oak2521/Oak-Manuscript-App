// Electron 主进程：窗口、IPC 白名单、安全基线（方案 §12.3）、冒烟模式。

"use strict";

const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog, ipcMain, shell, session } = require("electron");

const pathPolicy = require("./path-policy");
const bridge = require("./python-bridge");
const providers = require("./providers");
const { registerP0Ipc } = require("./p0-ipc");
const { readCoreCommandResult, toFailureResponse } = require("./core-result");
const { createPdfPreview } = require("./pdf-preview");
const {
  applyOfflineChromiumPolicy,
  installOfflineRequestBlocker,
} = require("./offline-policy");

const SMOKE = process.argv.includes("--smoke");
const ALLOWED_EXTERNAL_HOSTS = new Set(["oakbylake.com", "www.oakbylake.com"]);

// 必须发生在 app ready 之前；正常启动和 smoke 使用同一默认离线基线。
applyOfflineChromiumPolicy(app.commandLine);


let mainWindow = null;

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
  const data = await readCoreCommandResult(args[0], bridge.runCore(args));
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

ipcMain.handle("core:create", async (_e, opts) => {
  try {
    const input = assertString(opts.input, "input");
    const projectDir = assertString(opts.projectDir, "projectDir");
    const type = ["paper", "print_book", "ebook"].includes(opts.type) ? opts.type : "paper";
    const language = ["auto", "zh", "en", "mixed"].includes(opts.language) ? opts.language : "auto";
    const citations = ["default", "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none"];
    const citation = citations.includes(opts.citation) ? opts.citation : "default";
    const args = [
      "create", "--input", input, "--project", projectDir,
      "--type", type, "--language", language, "--citation", citation,
    ];
    if (opts.epubPreview) args.push("--epub-preview");
    const { data } = await core(args);
    return ok({ result: data });
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle("core:check", async (_e, { project, kind }) => {
  try {
    assertProjectDir(project);
    const cmd = kind === "recheck" ? "recheck" : "check";
    const { data } = await core([cmd, "--project", project]);
    return ok({ result: data });
  } catch (err) {
    return fail(err);
  }
});

// P0：预览计划、一次确认后应用、检查点列表与恢复。
// 未保留无 planId 的 core:fix 通道，避免渲染端绕过集中确认。
registerP0Ipc({ ipcMain, bridge, pathPolicy });

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

ipcMain.handle("core:external", async (_e, { project }) => {
  try {
    assertProjectDir(project);
    const { data } = await core(["external", "--project", project]);
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

ipcMain.handle("app:standards", () => {
  try {
    const file = path.join(pathPolicy.configDir(), "standards.json");
    return ok({ standards: JSON.parse(fs.readFileSync(file, "utf-8")).standards });
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle("report:pdf", async (_e, { project }) => {
  try {
    assertProjectDir(project);
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

ipcMain.handle("app:info", () => {
  return ok({
    appVersion: app.getVersion(),
    rulepack: `${providers.StandardsProvider.packName} ${providers.StandardsProvider.packVersion}`,
    packaged: app.isPackaged,
  });
});

// ---------- IPC：Provider 占位 ----------

ipcMain.handle("provider:auth-status", () => ok(providers.AuthProvider.status()));
ipcMain.handle("provider:license-status", () => ok(providers.LicenseProvider.status()));
ipcMain.handle("provider:sync-preference", (_e, { value }) => {
  if (value !== undefined) providers.SyncProvider.setPreference(value);
  return ok({ preference: providers.SyncProvider.getPreference() });
});
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

app.whenReady().then(async () => {
  console.log("[main] app ready");
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

app.on("window-all-closed", () => app.quit());
