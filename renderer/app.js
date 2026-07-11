// 渲染端逻辑：七页流程。UI 按钮与冒烟测试共用同一组 actions（真实 IPC → 真实核心）。

"use strict";

const state = {
  file: null,
  projectDir: null,
  project: null,          // 已创建项目的目录
  settings: { type: "paper", language: "auto", citation: "default", epubPreview: false },
  lastCheck: null,        // check/recheck 的 JSON 输出
  selectedIssue: null,
  filter: "pending",
  exportFiles: [],
  pdfPath: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg, ms = 2600) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), ms);
}

function showPage(id) {
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${id}`));
  $$(".step").forEach((s) => s.classList.toggle("active", s.dataset.page === id));
  state.page = id;
}

function enableStep(id) {
  const btn = $$(".step").find((s) => s.dataset.page === id);
  if (btn) btn.disabled = false;
}

function unwrap(resp) {
  if (!resp || resp.ok === false) throw new Error((resp && resp.error) || "操作失败");
  return resp;
}

// ---------- 进度页 ----------

const STAGES = ["创建项目（复制只读原稿）", "读取稿件", "运行规则检查", "整理结果"];
function renderStages(done) {
  $("#progress-stages").innerHTML = STAGES.map((s, i) => {
    const cls = i < done ? "done" : i === done ? "doing" : "";
    return `<li class="${cls}">${s}</li>`;
  }).join("");
}

// ---------- 问题页 ----------

function pendingCounts(issues) {
  const c = { error: 0, warning: 0, suggestion: 0 };
  for (const i of issues) if (i.status === "open" || i.status === "accepted") c[i.severity]++;
  return c;
}

function locText(issue) {
  const loc = issue.location || {};
  if (loc.resource) return loc.resource;
  if (loc.part === "footnotes") return `脚注 ${loc.note_id}`;
  if (loc.paragraph != null) return `正文第 ${loc.paragraph} 段`;
  return "文档";
}

function filteredIssues() {
  const issues = (state.lastCheck && state.lastCheck.issues) || [];
  switch (state.filter) {
    case "pending": return issues.filter((i) => i.status === "open" || i.status === "accepted");
    case "done": return issues.filter((i) => i.status === "resolved" || i.status === "rejected");
    default: return issues.filter((i) => i.severity === state.filter &&
      (i.status === "open" || i.status === "accepted"));
  }
}

function renderIssues() {
  const check = state.lastCheck;
  if (!check) return;
  $("#status-level").textContent =
    `${check.status_level}（仅代表技术与规范准备程度，不评价学术质量、文学价值或出版可行性）`;
  $("#citation-note").textContent = check.citation_note || "";
  const c = pendingCounts(check.issues);
  $("#issues-title").textContent =
    `检查结果：必须处理 ${c.error} ｜ 建议处理 ${c.warning} ｜ 可选改进 ${c.suggestion}`;

  const list = $("#issue-list");
  const items = filteredIssues();
  list.innerHTML = items.length ? "" : '<li class="muted" style="cursor:default">（本组没有问题）</li>';
  for (const issue of items) {
    const li = document.createElement("li");
    li.className = `sev-${issue.severity}` +
      (issue.status === "resolved" || issue.status === "rejected" ? " st-done" : "") +
      (state.selectedIssue === issue.issue_id ? " selected" : "");
    li.innerHTML =
      `<div class="issue-line1"><span class="issue-title"></span><span class="issue-loc"></span></div>` +
      `<div class="issue-preview"></div>`;
    li.querySelector(".issue-title").textContent =
      `${issue.title}${issue.auto_fixable ? " ⚙" : ""}${issue.status === "rejected" ? "（已拒绝）" : issue.status === "resolved" ? "（已解决）" : ""}`;
    li.querySelector(".issue-loc").textContent = locText(issue);
    li.querySelector(".issue-preview").textContent = issue.preview || "";
    li.addEventListener("click", () => { state.selectedIssue = issue.issue_id; renderIssues(); renderDetail(issue); });
    list.appendChild(li);
  }
}

const SEV_LABEL = { error: "必须处理", warning: "建议处理", suggestion: "可选改进" };

function renderDetail(issue) {
  const el = $("#issue-detail");
  if (!issue) { el.innerHTML = '<p class="muted">从左侧选择一条问题查看详情。</p>'; return; }
  el.innerHTML = `
    <span class="detail-sev ${issue.severity}">${SEV_LABEL[issue.severity]}</span>
    <h2 style="margin:8px 0"></h2>
    <div class="muted"></div>
    <div class="detail-block"><h4>原文预览</h4><div class="preview-box"></div></div>
    <div class="detail-block"><h4>问题解释</h4><p class="expl"></p></div>
    <div class="detail-block"><h4>参考标准</h4><p class="refs muted"></p></div>
    <div class="detail-block"><h4>修复方式</h4><p class="fix muted"></p></div>
    <div class="detail-actions">
      <button class="primary" data-act="accepted">接受</button>
      <button data-act="rejected">拒绝</button>
      <button data-act="open" class="ghost">暂不处理</button>
    </div>`;
  el.querySelector("h2").textContent = issue.title;
  el.querySelector(".muted").textContent =
    `${issue.rule_id} ｜ ${locText(issue)} ｜ 置信度：${issue.confidence} ｜ 状态：${issue.status}`;
  el.querySelector(".preview-box").textContent = issue.preview || "（无）";
  el.querySelector(".expl").textContent = issue.explanation;
  el.querySelector(".refs").textContent = (issue.standard_refs || []).join("、") + "（详见「标准与设置」页）";
  el.querySelector(".fix").textContent = issue.auto_fixable
    ? "白名单机械修复：可用「自动修复」一键处理，修复前自动创建检查点，可撤销。"
    : "需要您人工判断与修改，工具不自动改动。";
  el.querySelectorAll("[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => actions.issueAction(issue.issue_id, btn.dataset.act)));
}

// ---------- actions（UI 与冒烟共用） ----------

const actions = {
  async chooseOwnFile() {
    const file = await window.oak.pickManuscript();
    if (file) this.chooseFilePath(file);
  },

  chooseFilePath(file) {
    state.file = file;
    $("#chosen-file").textContent = file;
    enableStep("project");
    showPage("project");
    updateCreateButton();
  },

  async showSamples() {
    const r = unwrap(await window.oak.listSamples());
    const box = $("#sample-buttons");
    box.innerHTML = "";
    for (const s of r.samples) {
      const b = document.createElement("button");
      b.textContent = s.name;
      b.addEventListener("click", () => this.chooseFilePath(s.path));
      box.appendChild(b);
    }
    $("#sample-list").classList.remove("hidden");
  },

  async chooseSample(name) {
    const r = unwrap(await window.oak.listSamples());
    const hit = r.samples.find((s) => s.name === name);
    if (!hit) throw new Error(`样本不存在：${name}`);
    this.chooseFilePath(hit.path);
    return hit.path;
  },

  async pickProjectDir() {
    const dir = await window.oak.pickProjectDir();
    if (dir) this.setProjectDir(dir);
  },

  setProjectDir(dir) {
    state.projectDir = dir;
    $("#chosen-dir").textContent = dir;
    updateCreateButton();
  },

  async openExistingDialog() {
    const r = await window.oak.pickExistingProject();
    if (!r) return;
    if (r.invalid) { toast("该目录不是湖岸稿件项目（缺少 project.json）"); return; }
    await this.openExisting(r);
  },

  async openExisting(dir) {
    state.project = dir;
    enableStep("progress"); enableStep("issues"); enableStep("export");
    showPage("progress"); renderStages(2);
    const chk = unwrap(await window.oak.check(dir, "recheck"));
    state.lastCheck = chk.result;
    renderStages(STAGES.length);
    showPage("issues"); renderIssues(); renderDetail(null);
  },

  configure(opts) {
    Object.assign(state.settings, opts || {});
    const radio = document.querySelector(`input[name="mtype"][value="${state.settings.type}"]`);
    if (radio) radio.checked = true;
    $("#citation-select").value = state.settings.citation;
    $("#language-select").value = state.settings.language;
    $("#epub-preview-check").checked = !!state.settings.epubPreview;
  },

  readSettingsFromUi() {
    state.settings.type = document.querySelector('input[name="mtype"]:checked').value;
    state.settings.citation = $("#citation-select").value;
    state.settings.language = $("#language-select").value;
    state.settings.epubPreview = $("#epub-preview-check").checked;
  },

  async startCheck() {
    if (!state.file || !state.projectDir) throw new Error("请先选择稿件与项目目录");
    enableStep("progress");
    showPage("progress");
    renderStages(0);
    const created = unwrap(await window.oak.createProject({
      input: state.file, projectDir: state.projectDir,
      type: state.settings.type, language: state.settings.language,
      citation: state.settings.citation, epubPreview: state.settings.epubPreview,
    }));
    state.project = created.result.project;
    renderStages(2);
    const chk = unwrap(await window.oak.check(state.project, "check"));
    state.lastCheck = chk.result;
    renderStages(STAGES.length);
    enableStep("issues"); enableStep("export");
    showPage("issues");
    state.filter = "pending"; state.selectedIssue = null;
    renderIssues(); renderDetail(null);
    return { statusLevel: chk.result.status_level, issueCount: chk.result.issues.length, page: state.page };
  },

  async autoFix() {
    const fx = unwrap(await window.oak.fix(state.project));
    const applied = fx.result.applied_count || 0;
    if (applied > 0) toast(`已自动修复 ${applied} 项（检查点 ${fx.result.checkpoint_id}），正在复检…`);
    else toast("没有可自动修复的问题");
    const after = await this.recheck();
    return { applied, after };
  },

  async recheck() {
    const chk = unwrap(await window.oak.check(state.project, "recheck"));
    state.lastCheck = chk.result;
    renderIssues(); renderDetail(null);
    return { statusLevel: chk.result.status_level, issueCount: chk.result.issues.length };
  },

  async issueAction(issueId, status) {
    unwrap(await window.oak.setIssueStatus(state.project, issueId, status));
    const issue = state.lastCheck.issues.find((i) => i.issue_id === issueId);
    if (issue) issue.status = status;
    renderIssues();
    renderDetail(issue);
    toast(status === "accepted" ? "已接受（可用自动修复或人工处理）"
      : status === "rejected" ? "已拒绝：复检后不再提醒此问题" : "已标记为暂不处理");
  },

  async doExport(outDir) {
    const r = unwrap(await window.oak.exportAll(state.project, outDir || undefined));
    state.exportFiles = r.result.files;
    $("#export-files").innerHTML = state.exportFiles.map((f) => `<li>${f}</li>`).join("");
    $("#btn-export-pdf").disabled = false;
    $("#btn-open-folder").disabled = false;
    renderExportSummary();
    toast(`已导出 ${state.exportFiles.length} 个文件。原稿未被修改。`);
    return { files: state.exportFiles };
  },

  async makePdf() {
    const r = unwrap(await window.oak.exportPdf(state.project));
    state.pdfPath = r.path;
    $("#export-files").innerHTML += `<li>${r.path}</li>`;
    toast("PDF 审阅样张已生成（最多 16 页，仅供审阅，非印前文件）");
    return { path: r.path };
  },

  async verify() {
    const r = unwrap(await window.oak.verify(state.project));
    const v = r.result;
    $("#verify-result").textContent = v.ok
      ? `完整性验证通过：原稿 SHA-256 未变（${v.source_sha256.slice(0, 16)}…）`
      : `发现问题：${v.problems.join("；")}`;
    return v;
  },

  getState() {
    return {
      page: state.page, project: state.project,
      issues: state.lastCheck ? state.lastCheck.issues.length : 0,
      statusLevel: state.lastCheck ? state.lastCheck.status_level : null,
      exports: state.exportFiles.length,
    };
  },
};

function updateCreateButton() {
  $("#btn-to-target").disabled = !(state.file && state.projectDir);
}

function renderExportSummary() {
  const check = state.lastCheck;
  if (!check) return;
  const c = pendingCounts(check.issues);
  const done = check.issues.filter((i) => i.status === "resolved").length;
  const rejected = check.issues.filter((i) => i.status === "rejected").length;
  $("#export-summary").innerHTML =
    `<strong>原稿未被修改。</strong>` +
    `<p>已解决 ${done} 项，已拒绝 ${rejected} 项；未处理：必须处理 ${c.error}、建议处理 ${c.warning}、可选改进 ${c.suggestion}。` +
    `外部验证（EpubCheck / Ace）：未运行。导出文件保存在项目 exports/ 目录。</p>`;
}

// ---------- 标准与设置页 ----------

async function renderStandardsPage() {
  try {
    const r = unwrap(await window.oak.getStandards());
    const tbody = $("#standards-table tbody");
    tbody.innerHTML = "";
    for (const s of r.standards) {
      const tr = document.createElement("tr");
      const typeLabel = { official: "官方标准", oak_interpretation: "湖岸解释", technical_spec: "技术规范" }[s.source_type] || s.source_type;
      for (const text of [s.title, typeLabel, s.version, s.scope]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    const info = unwrap(await window.oak.appInfo());
    $("#rulepack-info").textContent = `规则包：${info.rulepack} ｜ APP 版本：${info.appVersion}`;
    $("#app-meta").textContent = `规则包 ${info.rulepack}`;
  } catch (err) {
    toast(String(err.message || err));
  }
}

async function loginPlaceholder() {
  const r = unwrap(await window.oak.authStatus());
  toast(`${r.message}（登录永不强制，未登录不影响任何功能）`, 3200);
}

// ---------- 绑定 ----------

document.addEventListener("DOMContentLoaded", () => {
  $$(".step").forEach((btn) =>
    btn.addEventListener("click", () => { if (!btn.disabled) showPage(btn.dataset.page); }));

  $("#btn-own-file").addEventListener("click", () => actions.chooseOwnFile());
  $("#btn-sample").addEventListener("click", () => actions.showSamples());
  $("#btn-open-project").addEventListener("click", () => actions.openExistingDialog());
  $("#btn-pick-dir").addEventListener("click", () => actions.pickProjectDir());
  $("#btn-to-target").addEventListener("click", () => { enableStep("target"); showPage("target"); });
  $("#btn-start-check").addEventListener("click", async () => {
    actions.readSettingsFromUi();
    try { await actions.startCheck(); } catch (err) { toast(String(err.message || err), 5000); showPage("target"); }
  });
  $("#btn-autofix").addEventListener("click", () => actions.autoFix().catch((e) => toast(String(e.message || e))));
  $("#btn-recheck").addEventListener("click", () => actions.recheck().catch((e) => toast(String(e.message || e))));
  $("#btn-external").addEventListener("click", async () => {
    toast("正在运行外部验证（EpubCheck / Ace），可能需要数十秒…", 4000);
    const r = await window.oak.runExternal(state.project);
    if (!r.ok) { toast(r.error, 5000); return; }
    const lines = Object.entries(r.result.results).map(([k, v]) => `${k}：${v.detail}`);
    toast(lines.join(" ｜ "), 9000);
  });
  $("#btn-to-export").addEventListener("click", () => { renderExportSummary(); showPage("export"); });
  $("#btn-export-all").addEventListener("click", () => actions.doExport().catch((e) => toast(String(e.message || e), 5000)));
  $("#btn-export-pdf").addEventListener("click", () => actions.makePdf().catch((e) => toast(String(e.message || e), 5000)));
  $("#btn-open-folder").addEventListener("click", () => window.oak.openExports(state.project));
  $("#btn-verify").addEventListener("click", () => actions.verify().catch((e) => toast(String(e.message || e))));
  $("#btn-evaluation").addEventListener("click", async () => {
    const r = await window.oak.openEvaluation();
    toast(r.ok ? "已在浏览器打开湖岸橡树网站（APP 未发送任何稿件数据）" : r.error, 3600);
  });
  $("#btn-cta-dismiss").addEventListener("click", () => toast("好的，本次不再提示"));
  $("#btn-login").addEventListener("click", loginPlaceholder);
  $("#btn-login2").addEventListener("click", loginPlaceholder);

  $$("#issue-filters button").forEach((b) =>
    b.addEventListener("click", () => {
      state.filter = b.dataset.f;
      $$("#issue-filters button").forEach((x) => x.classList.toggle("active", x === b));
      renderIssues();
    }));

  renderStandardsPage();
});

// 冒烟测试入口（与 UI 按钮走完全相同的代码路径）
window.__oakActions = actions;
window.__oakState = () => actions.getState();
