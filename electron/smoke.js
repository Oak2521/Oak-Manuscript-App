// UI 闭环冒烟（阶段 2 完成标准）：匿名 DOCX 与 EPUB 均在真实 UI 逻辑中
// 走完 创建 → 引用体例集中确认 → 检查 → 自动修复 → 复检 → 导出 → PDF 样张 → 完整性验证。
// 通过 executeJavaScript 调用渲染端 actions —— 与用户点击按钮完全相同的代码路径与 IPC。

"use strict";

const path = require("path");
const fs = require("fs");

const { serializeStandardIdentity } = require("./python-invocation");

const PACKAGED_OUTPUT_ENV = "OAK_SMOKE_OUTPUT_ROOT";
const EXPECTED_VERSION_ENV = "OAK_EXPECTED_APP_VERSION";
const EXPECT_PACKAGED_ENV = "OAK_EXPECT_PACKAGED";
const DEFAULT_EXPECTED_APP_VERSION = "0.1.0-alpha.8";

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

function assertSmokeIdentity(
  info,
  {
    expectedVersion = DEFAULT_EXPECTED_APP_VERSION,
    requirePackaged = false,
    expectedPackaged = requirePackaged ? true : null,
  } = {},
) {
  assert(info && info.ok === true, "appInfo IPC 应成功返回应用身份");
  serializeStandardIdentity(info.standardIdentity);
  const identity = info.standardIdentity;
  assert(
    info.rulepack === `${identity.name} ${identity.version}`,
    "appInfo 的规则包显示值必须由完整标准身份派生",
  );
  const release = info.standardsRelease;
  assert(
    release && release.bundle_id === identity.bundle_id
      && release.release_sequence === identity.release_sequence
      && release.manifest_sha256 === identity.manifest_sha256
      && release.rulepack_name === identity.name
      && release.rulepack_version === identity.version,
    "appInfo 的标准发布信息必须与完整标准身份一致",
  );
  assert(
    info.appVersion === expectedVersion,
    `应用版本应为 ${expectedVersion}，实际为 ${String(info && info.appVersion)}`,
  );
  if (requirePackaged) {
    assert(info.packaged === true, "打包版冒烟必须证明 app.isPackaged=true");
  }
  if (typeof expectedPackaged === "boolean") {
    assert(
      info.packaged === expectedPackaged,
      `冒烟 app.isPackaged 应为 ${String(expectedPackaged)}，实际为 ${String(info.packaged)}`,
    );
  }
  return info;
}

function assertSameStandardIdentity(actual, expected, label) {
  let actualCanonical;
  let expectedCanonical;
  try {
    actualCanonical = serializeStandardIdentity(actual);
    expectedCanonical = serializeStandardIdentity(expected);
  } catch (error) {
    throw new Error(`冒烟断言失败：${label}必须包含完整且规范的标准身份`, { cause: error });
  }
  assert(actualCanonical === expectedCanonical, `${label}与预期标准身份不一致`);
  return actual;
}

function readSmokeJson(file, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`冒烟断言失败：无法读取${label}：${String(err && err.message || err)}`);
  }
  assert(value && typeof value === "object" && !Array.isArray(value), `${label}必须是 JSON 对象`);
  return value;
}

function resolveProjectResult(projectDir, relativeFile) {
  assert(
    typeof relativeFile === "string" && relativeFile.trim() !== "",
    "检查记录必须包含结果文件路径",
  );
  const root = path.resolve(projectDir);
  const target = path.resolve(root, relativeFile);
  const relative = path.relative(root, target);
  assert(
    relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative),
    "检查结果文件必须位于冒烟项目目录内",
  );
  return target;
}

function assertCoreIdentityFromProject(
  projectDir,
  {
    expectedVersion = DEFAULT_EXPECTED_APP_VERSION,
    expectedStandardIdentity,
  } = {},
) {
  const manifest = readSmokeJson(path.join(projectDir, "project.json"), "项目清单");
  assert(
    manifest.app_version === expectedVersion,
    `Python core 创建项目的版本应为 ${expectedVersion}，实际为 ${String(manifest.app_version)}`,
  );
  assert(Array.isArray(manifest.checks) && manifest.checks.length > 0, "实际检查后项目清单应包含检查记录");

  const check = manifest.checks[manifest.checks.length - 1];
  assert(check && typeof check === "object", "最新检查记录必须是对象");
  const reportFile = resolveProjectResult(projectDir, check.result_file);
  const report = readSmokeJson(reportFile, "检查结果");
  assert(
    report.app_version === expectedVersion,
    `Python core 检查报告的版本应为 ${expectedVersion}，实际为 ${String(report.app_version)}`,
  );
  assert(report.check_id === check.check_id, "检查报告 check_id 必须与项目清单一致");

  const manifestRulepack = manifest.rulepack;
  const checkRulepack = check.rulepack;
  const reportRulepack = report.rulepack;
  assertSameStandardIdentity(manifestRulepack, reportRulepack, "项目清单标准身份");
  assertSameStandardIdentity(checkRulepack, reportRulepack, "检查记录标准身份");
  assert(check.rulepack_version === manifestRulepack.version,
    "检查记录的兼容版本字段必须与完整标准身份一致");

  const rulepack = `${reportRulepack.name} ${reportRulepack.version}`;
  if (expectedStandardIdentity !== undefined) {
    assertSameStandardIdentity(
      reportRulepack,
      expectedStandardIdentity,
      "Python core 实际标准身份",
    );
  }
  return {
    coreVersion: report.app_version,
    rulepack,
    standardIdentity: reportRulepack,
    checkId: report.check_id,
  };
}

function safeRemoveSmokeTree(outputRoot, target) {
  const root = path.resolve(outputRoot);
  const candidate = path.resolve(target);
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`冒烟清理目标必须严格位于受控输出根内：${candidate}`);
  }
  const targetStat = fs.lstatSync(candidate, { throwIfNoEntry: false });
  if (!targetStat) return;
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error(`冒烟清理目标不是安全目录：${candidate}`);
  }
  const realRoot = fs.realpathSync.native(root);
  const realTarget = fs.realpathSync.native(candidate);
  const realRelative = path.relative(realRoot, realTarget);
  if (realRelative === "" || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error(`冒烟清理目标真实路径逃逸输出根：${candidate}`);
  }

  const files = [];
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const item = path.join(directory, entry.name);
      const stat = fs.lstatSync(item);
      if (stat.isSymbolicLink()) {
        throw new Error(`冒烟旧项目含链接或目录联接，拒绝清理：${item}`);
      }
      if (stat.isDirectory()) {
        const itemReal = fs.realpathSync.native(item);
        const itemRelative = path.relative(realTarget, itemReal);
        if (itemRelative.startsWith("..") || path.isAbsolute(itemRelative)) {
          throw new Error(`冒烟旧项目目录真实路径逃逸：${item}`);
        }
        inspect(item);
      } else if (stat.isFile() && stat.nlink === 1) {
        files.push(item);
      } else {
        throw new Error(`冒烟旧项目含硬链接或非常规文件，拒绝清理：${item}`);
      }
    }
  }
  inspect(candidate);
  for (const file of files) {
    try { fs.chmodSync(file, 0o666); } catch {}
  }
  fs.rmSync(candidate, { recursive: true, force: true });
}

async function waitForReady(wc) {
  for (let i = 0; i < 100; i++) {
    const ready = await wc.executeJavaScript("Boolean(window.__oakActions)");
    if (ready) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("渲染端未就绪");
}

function resolveSmokeOutputRoot({
  packaged,
  repoRoot,
  env = process.env,
} = {}) {
  const injected = env[PACKAGED_OUTPUT_ENV];
  if (typeof injected !== "string" || injected.trim() === "") {
    throw new Error(
      `${packaged ? "打包版" : "源码"}冒烟必须由受控包装器注入 ${PACKAGED_OUTPUT_ENV}；拒绝回退未验证目录`,
    );
  }
  if (!path.isAbsolute(injected)) {
    throw new Error(`${PACKAGED_OUTPUT_ENV} 必须是绝对路径`);
  }
  const resolved = path.resolve(injected);
  if (resolved === path.parse(resolved).root) {
    throw new Error(`${PACKAGED_OUTPUT_ENV} 不得指向磁盘根目录`);
  }
  return resolved;
}

async function runSmoke(win, pathPolicy) {
  const { app } = require("electron");
  const wc = win.webContents;
  // 源码和打包 smoke 都只接受包装器预先验证并注入的绝对输出根。
  const outRoot = resolveSmokeOutputRoot({
    packaged: app.isPackaged,
    repoRoot: pathPolicy.repoRoot(),
  });
  const outStat = fs.lstatSync(outRoot, { throwIfNoEntry: false });
  if (!outStat?.isDirectory() || outStat.isSymbolicLink()) {
    throw new Error(`受控冒烟输出根缺失或不安全：${outRoot}`);
  }
  await new Promise((resolve) => {
    if (!wc.isLoading()) resolve();
    else wc.once("did-finish-load", resolve);
  });
  await waitForReady(wc);
  const js = (code) => wc.executeJavaScript(code);

  const expectedVersion = process.env[EXPECTED_VERSION_ENV] || DEFAULT_EXPECTED_APP_VERSION;
  const requirePackaged = process.env[EXPECT_PACKAGED_ENV] === "1";
  const expectedPackaged = process.env[EXPECT_PACKAGED_ENV] === "1"
    ? true
    : process.env[EXPECT_PACKAGED_ENV] === "0" ? false : null;
  if (app.isPackaged) {
    assert(
      process.env[EXPECTED_VERSION_ENV] === expectedVersion,
      `打包版冒烟缺少 ${EXPECTED_VERSION_ENV}`,
    );
    assert(
      process.env[EXPECT_PACKAGED_ENV] === "1",
      `打包版冒烟缺少 ${EXPECT_PACKAGED_ENV}=1`,
    );
  }
  const appInfo = await js("window.oak.appInfo()");
  assertSmokeIdentity(appInfo, { expectedVersion, requirePackaged, expectedPackaged });
  console.log(
    `[smoke] 应用身份：version=${appInfo.appVersion}，packaged=${String(appInfo.packaged)}`,
  );

  for (const sc of SCENARIOS) {
    const projectDir = path.join(outRoot, sc.dir);
    safeRemoveSmokeTree(outRoot, projectDir);
    console.log(`[smoke] ${sc.name} → ${projectDir}`);

    await js(`__oakActions.chooseSample(${JSON.stringify(sc.sample)})`);
    await js(`__oakActions.setProjectDir(${JSON.stringify(projectDir)})`);
    await js(`__oakActions.configure({ type: ${JSON.stringify(sc.type)} })`);

    const citationPlan = await js("__oakActions.startCheck()");
    assert(
      citationPlan.awaitingCitationConfirmation === true
        && typeof citationPlan.planId === "string"
        && citationPlan.planId.startsWith("citation-plan-"),
      `${sc.name}：首次检查前必须生成待确认的引用体例计划`,
    );
    assert(
      citationPlan.citationResolution
        && citationPlan.citationResolution.requestedStyle === "default",
      `${sc.name}：默认引用体例计划必须显示完整解析结果`,
    );
    const pendingCitation = await js("__oakActions.getState()");
    assert(
      pendingCitation.awaitingCitationConfirmation === true
        && pendingCitation.citationPlan === citationPlan.planId,
      `${sc.name}：引用体例确认前不得提前运行检查`,
    );
    const check = await js("__oakActions.confirmCitationResolution()");
    const confirmedCitation = await js("__oakActions.getState()");
    assert(
      confirmedCitation.awaitingCitationConfirmation === false
        && confirmedCitation.citationPlan === null,
      `${sc.name}：确认后必须清除待处理引用计划`,
    );
    assert(check.issueCount > 0, `${sc.name}：应检出问题`);
    assert(check.page === "issues", `${sc.name}：应停在问题页`);
    assertSameStandardIdentity(
      check.rulepack,
      appInfo.standardIdentity,
      `${sc.name} 初次检查 IPC 标准身份`,
    );
    console.log(`[smoke]   check：${check.issueCount} 项，状态「${check.statusLevel}」`);
    const coreIdentity = assertCoreIdentityFromProject(projectDir, {
      expectedVersion,
      expectedStandardIdentity: appInfo.standardIdentity,
    });
    console.log(
      `[smoke]   Python core 身份：version=${coreIdentity.coreVersion}，rulepack=${coreIdentity.rulepack}`,
    );

    const firstPlan = await js("__oakActions.autoFix()");
    if (sc.expectFixes) assert(firstPlan.count > 0, `${sc.name}：批量计划应列出白名单修复`);
    if (firstPlan.count > 0) {
      const cancelled = await js("__oakActions.cancelFixPlan()");
      assert(cancelled === true, `${sc.name}：应能取消批量计划`);
      const afterCancel = await js("__oakActions.recheck()");
      assert(afterCancel.issueCount === check.issueCount, `${sc.name}：取消计划不得写入修复`);
    }
    const plan = await js("__oakActions.autoFix()");
    if (sc.expectFixes) assert(plan.count === firstPlan.count, `${sc.name}：取消后再次预览应得到同样数量`);
    let fix = plan.count > 0
      ? await js("__oakActions.confirmFixPlan()")
      : { applied: 0, after: { issueCount: check.issueCount } };
    if (sc.expectFixes) assert(fix.applied > 0, `${sc.name}：确认后白名单修复应有作用`);
    assert(fix.after.issueCount < check.issueCount, `${sc.name}：复检后问题应减少`);
    if (sc.expectFixes) {
      const checkpointView = await js("__oakActions.openCheckpoints()");
      assert(checkpointView.count > 0, `${sc.name}：修复后应列出检查点`);
      const undone = await js("__oakActions.undoLastFix()");
      assert(undone.after.issueCount === check.issueCount, `${sc.name}：撤销后应恢复修复前问题集`);
      const replayPlan = await js("__oakActions.autoFix()");
      assert(replayPlan.count === plan.count, `${sc.name}：撤销后应可重新生成完整批次`);
      fix = await js("__oakActions.confirmFixPlan()");
      assert(fix.after.issueCount < check.issueCount, `${sc.name}：重新确认后问题应再次减少`);
    }
    assertSameStandardIdentity(
      fix.after.rulepack,
      appInfo.standardIdentity,
      `${sc.name} 最终复检 IPC 标准身份`,
    );
    console.log(`[smoke]   plan：集中确认 ${plan.count} 项；fix：修复 ${fix.applied} 项，复检剩 ${fix.after.issueCount} 项`);

    const finalCoreIdentity = assertCoreIdentityFromProject(projectDir, {
      expectedVersion,
      expectedStandardIdentity: appInfo.standardIdentity,
    });
    assert(
      finalCoreIdentity.checkId !== coreIdentity.checkId,
      `${sc.name}：自动修复闭环必须生成新的复检记录`,
    );

    const exp = await js("__oakActions.doExport()");
    assert(exp.files.length >= 4, `${sc.name}：导出应含修订稿与三种报告`);
    for (const f of exp.files) assert(fs.existsSync(f), `导出文件缺失：${f}`);
    const exportedReports = exp.files.filter((file) => path.basename(file) === "report.json");
    assert(exportedReports.length === 1, `${sc.name}：导出必须且只能包含一个 report.json`);
    const exportedReport = readSmokeJson(exportedReports[0], "导出报告");
    assertSameStandardIdentity(
      exportedReport.rulepack,
      appInfo.standardIdentity,
      `${sc.name} 导出报告标准身份`,
    );
    assertSameStandardIdentity(
      exportedReport.check?.rulepack,
      appInfo.standardIdentity,
      `${sc.name} 导出报告内嵌检查标准身份`,
    );

    const pdf = await js("__oakActions.makePdf()");
    assert(fs.existsSync(pdf.path), `${sc.name}：PDF 样张未生成`);
    const pdfHead = fs.readFileSync(pdf.path).subarray(0, 5).toString("latin1");
    assert(pdfHead === "%PDF-", `${sc.name}：PDF 样张格式非法`);

    const verify = await js("__oakActions.verify()");
    assert(verify.ok === true, `${sc.name}：完整性验证未通过：${(verify.problems || []).join("；")}`);
    console.log(`[smoke]   export ${exp.files.length} 文件 + PDF 样张；verify 通过`);
  }

  // 离线账号/订阅/同步纪律：生产未配置、未登录、默认不询问且队列为空。
  const auth = await js("window.oak.authStatus()");
  assert(
    auth.state === "signed_out" && auth.loggedIn === false &&
      auth.productionConfigured === false && auth.authMode === "system_browser_pkce",
    "AuthProvider 应为未配置的系统浏览器 PKCE 离线状态",
  );
  const license = await js("window.oak.licenseStatus()");
  assert(
    license.tier === "free" && license.localProjectsLocked === false,
    "LicenseProvider 默认应为不锁本地文件的 Free 状态",
  );
  const sync = await js("window.oak.syncPreference()");
  assert(sync.preference === "never_asked", "SyncProvider 默认偏好应为 never_asked");
  const queue = await js("window.oak.syncQueue()");
  assert(Array.isArray(queue.items) && queue.items.length === 0, "未登录状态同步队列必须为空");
  console.log("[smoke] 离线账号、Free 权益与未授权同步纪律检查通过");
}

module.exports = {
  DEFAULT_EXPECTED_APP_VERSION,
  EXPECTED_VERSION_ENV,
  EXPECT_PACKAGED_ENV,
  PACKAGED_OUTPUT_ENV,
  assertCoreIdentityFromProject,
  assertSmokeIdentity,
  resolveSmokeOutputRoot,
  runSmoke,
  safeRemoveSmokeTree,
};
