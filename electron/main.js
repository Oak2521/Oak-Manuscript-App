// Electron 主进程：窗口、IPC 白名单、安全基线（方案 §12.3）、冒烟模式。

"use strict";

const path = require("path");
const fs = require("fs");
const {
  app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell, session, utilityProcess,
} = require("electron");

const pathPolicy = require("./path-policy");
const bridge = require("./python-bridge");
const providers = require("./providers");
const { registerAIIpc } = require("./ai-ipc");
const { AIRequestCoordinator } = require("./ai-request");
const { BoundedAIHttpClient } = require("./ai-http-client");
const { AITransportRouter } = require("./ai-transport-router");
const { createOpenAICompatibleAdapters } = require("./ai-openai-compatible-adapter");
const { registerAccountSyncIpc } = require("./account-sync-ipc");
const { createAceUtilityRunner } = require("./ace-utility-runner");
const { registerExternalValidationIpc } = require("./external-validation-ipc");
const { registerP0Ipc } = require("./p0-ipc");
const { registerCoreIpc } = require("./core-ipc");
const { registerStandardsIpc } = require("./standards-ipc");
const { StandardsProvider } = require("./standards-provider");
const { EncryptedSyncStore } = require("./sync-store");
const { EncryptedAISettingsStore } = require("./ai-settings-store");
const { EncryptedAuthStore } = require("./encrypted-auth-store");
const { loadDesktopAuthConfig } = require("./desktop-auth-config");
const { AuthHttpClient } = require("./auth-http-client");
const { DesktopAuthProvider } = require("./desktop-auth-provider");
const { loadDesktopLicenseConfig } = require("./desktop-license-config");
const { loadDesktopStandardsUpdateConfig } = require("./desktop-standards-update-config");
const { ProductionLicenseProvider } = require("./license-entitlement");
const { LicenseHttpClient } = require("./license-http-client");
const { StandardsUpdateHttpClient } = require("./standards-update-http-client");
const { EncryptedLicenseStore } = require("./license-store");
const { SyncHttpClient } = require("./sync-http-client");
const { SyncTransportCoordinator } = require("./sync-transport-coordinator");
const { createStandardBoundCore } = require("./standard-bound-core");
const { readCoreCommandResult, toFailureResponse } = require("./core-result");
const { createPdfPreview } = require("./pdf-preview");
const { verifyPackagedResourceTrust } = require("./resource-trust");
const RESOURCE_TRUST_ANCHOR = require("./resource-trust-anchor.json");
const {
  applyOfflineChromiumPolicy,
  installOfflineRequestBlocker,
} = require("./offline-policy");
const {
  APP_ENTRY_URL,
  installAppProtocol,
  registerAppSchemeAsPrivileged,
} = require("./app-protocol");

const SYNC_RECOVERY_SMOKE = process.argv.includes("--smoke-sync-recovery");
const SMOKE = process.argv.includes("--smoke") || SYNC_RECOVERY_SMOKE;
const ALLOWED_EXTERNAL_HOSTS = new Set(["oakbylake.com", "www.oakbylake.com"]);

// 必须发生在 app ready 之前；正常启动和 smoke 使用同一默认离线基线。
registerAppSchemeAsPrivileged(protocol);
applyOfflineChromiumPolicy(app.commandLine);
// 自动化 smoke 验证稿件功能，不应被无 GPU/驱动的隔离构建会话阻断。
// 正常用户启动不进入此分支，仍保留 Electron 默认硬件加速行为。
if (SMOKE) app.disableHardwareAcceleration();


let mainWindow = null;
let standardsProvider = null;
let standardBoundCore = null;
let syncCoordinator = null;
let authReady = false;
const pendingAuthCallbacks = [];

function authCallbackFromArgs(argv) {
  if (!Array.isArray(argv)) return null;
  return argv.find((value) => typeof value === "string" && value.startsWith("oak-manuscript-auth://")) || null;
}

async function consumeAuthCallback(url) {
  try {
    await providers.authProvider.handleCallback(url);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("provider:auth-changed");
  } catch (error) {
    console.error("[auth] callback rejected:", error && error.message);
  }
}

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
  getSyncCoordinator: () => syncCoordinator,
  syncRecordSource: async (project, event, includeIssues) => {
    const { data } = await core(["sync-source", "--project", project, "--event", event]);
    const platform = process.platform === "win32" || process.platform === "darwin"
      ? process.platform
      : null;
    if (platform === null) throw new Error("当前平台尚未进入同步契约支持范围");
    return providers.buildSyncRecordV1({ ...data, platform }, { includeIssues });
  },
});

const aiTransport = new AITransportRouter({
  httpClient: new BoundedAIHttpClient(),
  adapters: createOpenAICompatibleAdapters(),
});
providers.aiProvider.configureTransport(aiTransport);

const aiRequests = new AIRequestCoordinator({
  aiProvider: providers.aiProvider,
  licenseProvider: providers.licenseProvider,
  contextSource: async (project, issueId) => {
    const { data } = await core([
      "ai-context", "--project", project, "--issue-id", issueId,
    ]);
    if (!data || data.ok !== true) throw new Error("AI 上下文核心结果非法");
    const { ok: _ok, ...context } = data;
    return context;
  },
  reviewSink: async ({ project, issueId }) => {
    await core(["issue", "--project", project, "--id", issueId, "--status", "accepted"]);
  },
  // Only the explicitly supported OpenAI-compatible family is enabled. Official
  // cloud providers remain unavailable until their current protocols are verified.
  transport: aiTransport,
});

registerAIIpc({
  ipcMain,
  aiProvider: providers.aiProvider,
  licenseProvider: providers.licenseProvider,
  aiRequests,
  pathPolicy,
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

  mainWindow.loadURL(APP_ENTRY_URL).catch((error) => {
    console.error("[renderer] app protocol load failed:", error && error.message);
  });
}

console.log("[main] module loaded, smoke =", SMOKE);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const callback = authCallbackFromArgs(argv);
    if (callback) {
      if (authReady) void consumeAuthCallback(callback);
      else pendingAuthCallbacks.push(callback);
    }
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (authReady) void consumeAuthCallback(url);
  else pendingAuthCallbacks.push(url);
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
  try {
    const config = loadDesktopAuthConfig(pathPolicy.configDir());
    let desktopAuth;
    if (config.status === "configured") {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统安全存储不可用");
      const authStore = new EncryptedAuthStore({
        rootDir: path.join(app.getPath("userData"), "auth"),
        protect: (plaintext) => safeStorage.encryptString(plaintext),
        unprotect: (ciphertext) => safeStorage.decryptString(ciphertext),
      });
      const authClient = new AuthHttpClient({ config });
      desktopAuth = new DesktopAuthProvider({
        config, store: authStore, client: authClient,
        openExternal: (url) => shell.openExternal(url),
      });
      syncCoordinator = new SyncTransportCoordinator({
        syncProvider: providers.syncProvider,
        authProvider: desktopAuth,
        accessTokenProvider: (binding) => desktopAuth.accessToken(binding),
        transport: new SyncHttpClient({ apiOrigin: config.api_origin }),
      });
      console.log("[auth] encrypted PKCE session ready; network remains user-triggered");
    } else {
      desktopAuth = new DesktopAuthProvider({ config });
      console.log("[auth] production endpoints pending; login and sync transport disabled");
    }
    providers.authProvider.configureProduction(desktopAuth);
  } catch (error) {
    syncCoordinator = null;
    console.error("[auth] production account boundary unavailable:", error && error.message);
  }
  try {
    const licenseConfig = loadDesktopLicenseConfig(pathPolicy.configDir());
    if (licenseConfig.status === "configured") {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统安全存储不可用");
      const licenseStore = new EncryptedLicenseStore({
        rootDir: path.join(app.getPath("userData"), "license"),
        protect: (plaintext) => safeStorage.encryptString(plaintext),
        unprotect: (ciphertext) => safeStorage.decryptString(ciphertext),
      });
      providers.licenseProvider.configureProduction(new ProductionLicenseProvider({
        config: licenseConfig,
        store: licenseStore,
        client: new LicenseHttpClient({ endpoint: licenseConfig.entitlement_endpoint }),
        accessTokenProvider: (binding) => providers.authProvider.accessToken(binding),
        authStatusProvider: () => providers.authProvider.status(),
      }));
      console.log("[license] signed encrypted entitlement cache ready; refresh remains user-triggered");
    } else {
      console.log("[license] production endpoint and signing keys pending; local Free fallback retained");
    }
  } catch (error) {
    console.error("[license] production entitlement boundary unavailable:", error && error.message);
  }
  authReady = true;
  const startupCallback = authCallbackFromArgs(process.argv);
  if (startupCallback) pendingAuthCallbacks.push(startupCallback);
  while (pendingAuthCallbacks.length) await consumeAuthCallback(pendingAuthCallbacks.shift());
  installAppProtocol(protocol, path.join(pathPolicy.repoRoot(), "renderer"));
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统安全存储不可用");
    }
    providers.syncProvider.configurePersistence(new EncryptedSyncStore({
      rootDir: path.join(app.getPath("userData"), "sync"),
      protect: (plaintext) => safeStorage.encryptString(plaintext),
      unprotect: (ciphertext) => safeStorage.decryptString(ciphertext),
    }));
    console.log("[sync] encrypted local queue ready; transport disabled");
  } catch (error) {
    providers.syncProvider.disablePersistence(error);
    // Sync remains fail-closed while all local manuscript functions stay available.
    console.error("[sync] encrypted local queue unavailable:", error && error.message);
  }
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统安全存储不可用");
    providers.aiProvider.configurePersistence(new EncryptedAISettingsStore({
      rootDir: path.join(app.getPath("userData"), "ai"),
      protect: (plaintext) => safeStorage.encryptString(plaintext),
      unprotect: (ciphertext) => safeStorage.decryptString(ciphertext),
    }));
    console.log("[ai] encrypted local settings ready; OpenAI-compatible transport available");
  } catch (error) {
    providers.aiProvider.disablePersistence();
    console.error("[ai] encrypted local settings unavailable:", error && error.message);
  }
  if (SYNC_RECOVERY_SMOKE) {
    try {
      const persistence = providers.syncProvider.persistenceStatus();
      const items = providers.syncProvider.listQueue({
        state: "authenticated",
        loggedIn: true,
        accountId: "smoke-account",
      });
      if (persistence.state !== "ready" || persistence.encrypted !== true || items.length !== 1 ||
          items[0].state !== "pending_transport" || items[0].payload.project_id !== "0000000000000001" ||
          items[0].payload.run_id !== "check-9001" || items[0].payload.versions.app !== app.getVersion()) {
        throw new Error("加密同步队列重启恢复证据不完整或身份不一致");
      }
      console.log("SYNC-RECOVERY-RESULT: PASS");
      app.exit(0);
    } catch (error) {
      console.error("SYNC-RECOVERY-RESULT: FAIL", error && error.message);
      app.exit(1);
    }
    return;
  }
  const standardsStoreRoot = path.join(app.getPath("userData"), "standards");
  bridge.configureStandardsStoreRoot(standardsStoreRoot);
  let standardsUpdateClient = null;
  try {
    const standardsUpdateConfig = loadDesktopStandardsUpdateConfig(pathPolicy.configDir());
    if (standardsUpdateConfig.status === "configured") {
      standardsUpdateClient = new StandardsUpdateHttpClient({
        endpoint: standardsUpdateConfig.update_endpoint,
      });
      console.log("[standards] signed update transport ready; checks remain user-triggered");
    } else {
      console.log("[standards] online update endpoint pending; offline standards remain available");
    }
  } catch (error) {
    // Invalid or partial configuration must never weaken bundled/local verification.
    console.error("[standards] online update transport unavailable:", error && error.message);
  }
  standardsProvider = new StandardsProvider({
    rootDir: standardsStoreRoot,
    configDir: pathPolicy.configDir(),
    appVersion: app.getVersion(),
    updateClient: standardsUpdateClient,
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
