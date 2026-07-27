// PDF 审阅样张：禁用报告脚本，并通过真实路径策略原子写入项目 exports。

"use strict";

const path = require("path");
const { installOfflineRequestBlocker } = require("./offline-policy");

const PDF_SESSION_PARTITION = "oak-pdf-preview";
const PDF_REPORT_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "script-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function preparePdfSession(sessionModule) {
  if (!sessionModule || typeof sessionModule.fromPartition !== "function") {
    throw new TypeError("Electron session 不可用");
  }
  // 非 persist partition：PDF 专用、内存态，不放宽 defaultSession 的主 UI CSP。
  const pdfSession = sessionModule.fromPartition(PDF_SESSION_PARTITION, { cache: false });
  installOfflineRequestBlocker(pdfSession.webRequest);
  pdfSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [PDF_REPORT_CSP],
      },
    });
  });
  return pdfSession;
}

async function createPdfPreview({ BrowserWindow, session, pathPolicy, project }) {
  if (typeof BrowserWindow !== "function") throw new TypeError("BrowserWindow 非法");
  if (!pathPolicy) throw new TypeError("pathPolicy 非法");

  const html = path.join(project, "exports", "report.html");
  const htmlSnapshot = pathPolicy.assertSafeExistingProjectFile(project, html, {
    expectedParentRelative: "exports",
  });
  const pdfSession = preparePdfSession(session);

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      session: pdfSession,
    },
  });
  const denyNavigation = (event) => event.preventDefault();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", denyNavigation);
  win.webContents.on("will-redirect", denyNavigation);

  try {
    await win.loadFile(html);
    pathPolicy.assertSafeExistingProjectFileUnchanged(htmlSnapshot);
    // 审阅样张：最多 16 页（方案 §5.5）
    const pdf = await win.webContents.printToPDF({ pageRanges: "1-16", printBackground: true });
    const target = path.join(project, "exports", "report_preview.pdf");
    return pathPolicy.writeProjectFileAtomicSync(project, target, pdf, {
      expectedParentRelative: "exports",
    });
  } finally {
    win.destroy();
  }
}

module.exports = {
  PDF_REPORT_CSP,
  PDF_SESSION_PARTITION,
  createPdfPreview,
  preparePdfSession,
};
