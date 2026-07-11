// UI 闭环冒烟（阶段 2 完成标准）：匿名 DOCX 与 EPUB 均在真实 UI 逻辑中
// 走完 创建 → 检查 → 自动修复 → 复检 → 导出 → PDF 样张 → 完整性验证。
// 通过 executeJavaScript 调用渲染端 actions —— 与用户点击按钮完全相同的代码路径与 IPC。

"use strict";

const path = require("path");
const fs = require("fs");

const SCENARIOS = [
  {
    name: "DOCX（论文缺陷样本）",
    sample: "paper_needs_review.docx",
    dir: "ui-smoke-docx",
    type: "paper",
    expectError: true,     // REF-002 为 error，修复后仍在
    expectFixes: true,
  },
  {
    name: "EPUB（电子书缺陷样本）",
    sample: "epub_needs_review.epub",
    dir: "ui-smoke-epub",
    type: "ebook",
    expectError: true,     // OPF/NAV 为 error，修复后仍在
    expectFixes: true,
  },
];

function assert(cond, msg) {
  if (!cond) throw new Error(`冒烟断言失败：${msg}`);
}

function rmrf(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const p = path.join(entry.parentPath || entry.path, entry.name);
    try { fs.chmodSync(p, 0o666); } catch {}
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

async function waitForReady(wc) {
  for (let i = 0; i < 100; i++) {
    const ready = await wc.executeJavaScript("Boolean(window.__oakActions)");
    if (ready) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("渲染端未就绪");
}

async function runSmoke(win, pathPolicy) {
  const { app } = require("electron");
  const os = require("os");
  const wc = win.webContents;
  // 打包版冒烟写系统临时目录（resources 只读）；开发版写 out/
  const outRoot = app.isPackaged
    ? path.join(os.tmpdir(), "oak-manuscript-smoke")
    : path.join(pathPolicy.repoRoot(), "out");
  await new Promise((resolve) => {
    if (!wc.isLoading()) resolve();
    else wc.once("did-finish-load", resolve);
  });
  await waitForReady(wc);
  const js = (code) => wc.executeJavaScript(code);

  for (const sc of SCENARIOS) {
    const projectDir = path.join(outRoot, sc.dir);
    rmrf(projectDir);
    console.log(`[smoke] ${sc.name} → ${projectDir}`);

    await js(`__oakActions.chooseSample(${JSON.stringify(sc.sample)})`);
    await js(`__oakActions.setProjectDir(${JSON.stringify(projectDir)})`);
    await js(`__oakActions.configure({ type: ${JSON.stringify(sc.type)} })`);

    const check = await js("__oakActions.startCheck()");
    assert(check.issueCount > 0, `${sc.name}：应检出问题`);
    assert(check.page === "issues", `${sc.name}：应停在问题页`);
    console.log(`[smoke]   check：${check.issueCount} 项，状态「${check.statusLevel}」`);

    const fix = await js("__oakActions.autoFix()");
    if (sc.expectFixes) assert(fix.applied > 0, `${sc.name}：白名单修复应有作用`);
    assert(fix.after.issueCount < check.issueCount, `${sc.name}：复检后问题应减少`);
    console.log(`[smoke]   fix：修复 ${fix.applied} 项，复检剩 ${fix.after.issueCount} 项`);

    const exp = await js("__oakActions.doExport()");
    assert(exp.files.length >= 4, `${sc.name}：导出应含修订稿与三种报告`);
    for (const f of exp.files) assert(fs.existsSync(f), `导出文件缺失：${f}`);

    const pdf = await js("__oakActions.makePdf()");
    assert(fs.existsSync(pdf.path), `${sc.name}：PDF 样张未生成`);
    const pdfHead = fs.readFileSync(pdf.path).subarray(0, 5).toString("latin1");
    assert(pdfHead === "%PDF-", `${sc.name}：PDF 样张格式非法`);

    const verify = await js("__oakActions.verify()");
    assert(verify.ok === true, `${sc.name}：完整性验证未通过：${(verify.problems || []).join("；")}`);
    console.log(`[smoke]   export ${exp.files.length} 文件 + PDF 样张；verify 通过`);
  }

  // 占位纪律抽查：登录状态为「即将开放」，同步偏好默认 never_asked
  const auth = await js("window.oak.authStatus()");
  assert(auth.state === "coming_soon" && auth.loggedIn === false, "AuthProvider 应为占位状态");
  const sync = await js("window.oak.syncPreference()");
  assert(sync.preference === "never_asked", "SyncProvider 默认偏好应为 never_asked");
  console.log("[smoke] Provider 占位纪律检查通过");
}

module.exports = { runSmoke };
