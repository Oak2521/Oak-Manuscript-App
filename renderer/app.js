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
  citationResolution: null,
  citationPlan: null,
  citationPlanning: false,
  citationApplying: false,
  pendingCitationKind: null,
  fixPlan: null,
  fixPlanning: false,
  fixApplying: false,
  checkpoints: [],
  selectedCheckpointId: null,
  restoringCheckpoint: false,
  rulepackUpgradePlan: null,
  rulepackUpgradePlanning: false,
  rulepackUpgradeApplying: false,
  authStatus: null,
  licenseStatus: null,
  aiStatus: null,
  aiRequestPlan: null,
  aiRequestConfirming: false,
  aiSuggestion: null,
  aiSuggestionReviewing: false,
  syncPreview: null,
  syncConfirming: false,
  syncQueue: [],
  syncPersistence: null,
  syncTransportConfigured: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const P0 = window.OakP0Ui;

const CITATION_VALUES = new Set([
  "default", "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none",
]);
const RESOLVED_CITATION_VALUES = new Set([
  "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none",
]);
const CITATION_STYLE_LABELS = Object.freeze({
  "gbt7714-2025": "GB/T 7714—2025",
  "apa-7": "APA 7",
  "chicago-18-nb": "Chicago 18 注释—书目",
  "chicago-18-ad": "Chicago 18 作者—日期",
  none: "暂不检查引用格式",
});
const CITATION_CONFIDENCE_LABELS = Object.freeze({
  high: "高",
  medium: "中",
  low: "低",
  not_applicable: "不适用（用户指定）",
});
const CITATION_REASON_LABELS = Object.freeze({
  user_selected: "由用户明确指定引用体例。",
  user_disabled: "由用户明确选择暂不检查引用格式。",
  paper_zh_numeric_reference_structure: "论文以中文为主，且引用结构与顺序编码制特征一致。",
  paper_en_author_date_structure: "论文以英文为主，且引用结构与作者—日期制特征一致。",
  print_book_note_bibliography_structure: "书稿的注释与书目结构更符合注释—书目制。",
  low_confidence: "现有引用结构信号不足，解析器不强行套用具体体例。",
  conflicting_signals: "稿件中的引用结构信号互相冲突，解析器不强行套用具体体例。",
  insufficient_structure_signals: "没有足够引用结构信号支持可靠的具体体例判断。",
  legacy_default_mapping: "由固定的稿件类型与语言映射选定。",
});

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function nonemptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCitationMode(value, resolvedStyle) {
  const aliases = {
    style: "style_specific",
    style_specific: "style_specific",
    specific_style: "style_specific",
    structure_only: "structure_only",
    structure: "structure_only",
    generic: "structure_only",
    disabled: "disabled",
    none: "disabled",
  };
  if (value !== undefined && value !== null && !Object.hasOwn(aliases, value)) {
    throw new Error("引用体例解析结果的检查模式非法");
  }
  return value === undefined || value === null
    ? (resolvedStyle === "none" ? "disabled" : "style_specific")
    : aliases[value];
}

function normalizeCitationResolution(value, requestedFallback = null) {
  const input = plainObject(value);
  if (!input) throw new Error("引用体例解析结果缺失或格式非法");
  const rawRequested = input.requested_style !== undefined
    ? input.requested_style
    : input.citation_style_requested !== undefined
      ? input.citation_style_requested
      : requestedFallback;
  const requestedStyle = nonemptyString(rawRequested);
  if (!CITATION_VALUES.has(requestedStyle)) throw new Error("引用体例解析结果的请求值非法");
  if (requestedFallback && requestedStyle !== requestedFallback) {
    throw new Error("引用体例解析结果与用户本次选择不一致");
  }

  const rawResolved = input.resolved_style !== undefined
    ? input.resolved_style
    : input.citation_style_resolved;
  const resolvedStyle = rawResolved === null || rawResolved === undefined
    ? null
    : nonemptyString(rawResolved);
  if (rawResolved !== null && rawResolved !== undefined && !resolvedStyle) {
    throw new Error("引用体例解析结果的最终体例非法");
  }
  if (resolvedStyle !== null && !RESOLVED_CITATION_VALUES.has(resolvedStyle)) {
    throw new Error("引用体例解析结果的最终体例非法");
  }
  const rawMode = input.mode !== undefined ? input.mode : input.check_mode;
  const mode = normalizeCitationMode(rawMode, resolvedStyle);
  if (mode === "style_specific" && (!resolvedStyle || resolvedStyle === "none")) {
    throw new Error("具体体例检查模式缺少可用的最终体例");
  }
  if (mode === "disabled" && resolvedStyle !== "none") {
    throw new Error("停用引用检查模式与最终体例不一致");
  }

  const rawConfidence = input.confidence;
  const confidence = rawConfidence === null || rawConfidence === undefined
    ? null
    : nonemptyString(rawConfidence);
  if (rawConfidence !== null && rawConfidence !== undefined && !confidence) {
    throw new Error("引用体例解析结果的置信度非法");
  }
  if (confidence !== null && !Object.hasOwn(CITATION_CONFIDENCE_LABELS, confidence)) {
    throw new Error("引用体例解析结果的置信度非法");
  }
  const resolver = plainObject(input.resolver);
  if (input.resolver !== undefined && !resolver) {
    throw new Error("引用体例解析器信息缺失或格式非法");
  }
  const resolverVersion = resolver
    ? nonemptyString(resolver.version)
    : nonemptyString(input.resolver_version) || nonemptyString(input.citation_resolver_version);
  if (resolver && !resolverVersion) throw new Error("引用体例解析器版本缺失或格式非法");
  const reasonCode = nonemptyString(input.reason_code) || "unspecified";
  const reason = nonemptyString(input.reason);
  const resolvedBy = nonemptyString(input.resolved_by) || "default_resolver";
  return Object.freeze({
    requestedStyle,
    resolvedStyle,
    mode,
    confidence,
    resolverVersion,
    reasonCode,
    reason,
    resolvedBy,
  });
}

function citationResolutionReason(resolution) {
  if (resolution.reason) return resolution.reason;
  if (Object.hasOwn(CITATION_REASON_LABELS, resolution.reasonCode)) {
    return CITATION_REASON_LABELS[resolution.reasonCode];
  }
  if (resolution.resolvedBy === "user") return "由用户明确指定引用检查设置。";
  if (resolution.mode === "structure_only") {
    return "引用结构信号不足或互相冲突，解析器不强行套用具体体例。";
  }
  return "解析器根据检查类型、主要语言和引用结构信号作出确定性选择。";
}

function citationResolutionStyle(resolution) {
  if (resolution.mode === "structure_only") return "仅做结构与一致性检查";
  if (resolution.mode === "disabled") return "暂不检查引用格式";
  return `${CITATION_STYLE_LABELS[resolution.resolvedStyle]}（按具体体例检查）`;
}

function renderCitationResolutionFields(prefix, resolution) {
  $(`#${prefix}-style`).textContent = citationResolutionStyle(resolution);
  $(`#${prefix}-reason`).textContent = citationResolutionReason(resolution);
  $(`#${prefix}-confidence`).textContent = resolution.confidence === null
    ? "不适用（用户指定或无需判定）"
    : CITATION_CONFIDENCE_LABELS[resolution.confidence];
  $(`#${prefix}-version`).textContent = resolution.resolverVersion || "不适用（用户指定）";
}

function normalizeCitationPlan(value, citation, kind) {
  const input = plainObject(value);
  const planId = nonemptyString(input && input.plan_id);
  if (!planId || !input.resolution) throw new Error("引用体例解析计划缺失或格式非法");
  if (!new Set(["check", "recheck"]).has(kind)) throw new Error("引用体例解析计划的检查类型非法");
  return Object.freeze({
    planId,
    citation,
    kind,
    resolution: normalizeCitationResolution(input.resolution, citation),
  });
}

function sameCitationResolution(left, right) {
  return [
    "requestedStyle", "resolvedStyle", "mode", "resolvedBy",
    "reasonCode", "reason", "confidence", "resolverVersion",
  ].every((key) => left[key] === right[key]);
}

function adoptCitationResolution(value, requestedFallback = null) {
  const resolution = normalizeCitationResolution(value, requestedFallback);
  state.citationResolution = resolution;
  state.settings.citation = resolution.requestedStyle;
  $("#citation-select").value = resolution.requestedStyle;
  $("#citation-resolution-select").value = resolution.requestedStyle;
  return resolution;
}

function renderCitationPlan(plan) {
  renderCitationResolutionFields("citation-resolution", plan.resolution);
  $("#citation-resolution-select").value = plan.citation;
  const limitedCheck = plan.resolution.confidence === "low" ||
    plan.resolution.mode === "structure_only";
  $("#citation-resolution-low-confidence").classList.toggle("hidden", !limitedCheck);
  $("#btn-confirm-citation-resolution").textContent =
    plan.kind === "recheck" ? "确认并重新检查" : "确认并开始检查";
}

function renderCitationResult() {
  const card = $("#citation-result-card");
  if (!state.citationResolution) {
    card.classList.add("hidden");
    return;
  }
  renderCitationResolutionFields("citation-result", state.citationResolution);
  card.classList.remove("hidden");
}

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
  state.citationResolution = check.citation_resolution
    ? adoptCitationResolution(check.citation_resolution)
    : null;
  renderCitationResult();
  const c = pendingCounts(check.issues);
  $("#issues-title").textContent =
    `检查结果：必须处理 ${c.error} ｜ 建议处理 ${c.warning} ｜ 可选改进 ${c.suggestion}`;

  const list = $("#issue-list");
  const items = filteredIssues();
  list.innerHTML = items.length ? "" : '<li class="muted empty-issue">（本组没有问题）</li>';
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
    <h2 class="issue-detail-title"></h2>
    <div class="muted"></div>
    <div class="detail-block"><h4>原文预览</h4><div class="preview-box"></div></div>
    <div class="detail-block"><h4>问题解释</h4><p class="expl"></p></div>
    <div class="detail-block"><h4>参考标准</h4><p class="refs muted"></p></div>
    <div class="detail-block"><h4>修复方式</h4><p class="fix muted"></p></div>
    <div class="detail-block ai-suggestion-controls">
      <h4>AI 建议（可选）</h4>
      <textarea class="ai-instruction-input" maxlength="2000" rows="3" placeholder="可选：补充你希望 AI 重点解释的问题。留空则使用默认要求。"></textarea>
      <button class="ghost ai-preview-button">预览将发送给 AI 的内容</button>
      <p class="ai-preview-help muted"></p>
    </div>
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
    ? "白名单机械修复：APP 会先集中展示本批全部修改，您一次确认后整批处理；修复前自动创建检查点，可撤销。"
    : "需要您人工判断与修改，工具不自动改动。";
  const aiButton = el.querySelector(".ai-preview-button");
  const aiStatus = state.aiStatus;
  const canPreview = Boolean(aiStatus && aiStatus.mode !== "off" &&
    aiStatus.persistence && aiStatus.persistence.state === "ready" &&
    aiStatus.configuration_state !== "credential_required" &&
    !(aiStatus.mode === "byo" && aiStatus.pro_eligible === false));
  aiButton.disabled = !canPreview;
  el.querySelector(".ai-preview-help").textContent = !aiStatus || aiStatus.mode === "off"
    ? "请先在“标准与设置”中选择湖岸 AI 或我的 AI。"
    : !canPreview
      ? "当前 AI 配置或权益尚不能生成发送预览；请先完成设置。"
      : "只生成单条问题的本机预览；不会发送完整稿件、其他问题、路径、哈希、账号或凭据。";
  aiButton.addEventListener("click", () => actions.planAiSuggestion(
    issue.issue_id, el.querySelector(".ai-instruction-input").value,
  ).catch((error) => toast(String(error.message || error), 6000)));
  el.querySelectorAll("[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => actions.issueAction(issue.issue_id, btn.dataset.act)));
}

// ---------- 批量修复确认与检查点 ----------

function renderFixPlan(plan) {
  $("#fix-plan-count").textContent =
    `本批次共 ${plan.count} 项。只有点击“确认批量修复 ${plan.count} 项”才会写入工作稿。`;
  $("#btn-confirm-fix-plan").textContent = `确认批量修复 ${plan.count} 项`;
  $("#btn-confirm-fix-plan").disabled = plan.count === 0;

  const list = $("#fix-plan-items");
  list.replaceChildren();
  for (const item of plan.items) {
    const row = document.createElement("li");
    const info = document.createElement("div");
    const title = document.createElement("span");
    const location = document.createElement("span");
    const before = document.createElement("div");
    const after = document.createElement("div");
    title.className = "batch-item-title";
    location.className = "batch-item-location";
    before.className = "batch-preview before";
    after.className = "batch-preview after";
    title.textContent = item.title;
    location.textContent = item.location;
    before.textContent = item.beforePreview;
    after.textContent = item.afterPreview;
    info.append(title, location);
    row.append(info, before, after);
    list.appendChild(row);
  }
}

function checkpointReasonLabel(reason) {
  return {
    before_batch_fix: "批量修复前",
    before_fix: "批量修复前",
    before_restore: "恢复操作前",
    manual: "手动检查点",
  }[reason] || "项目检查点";
}

function conciseCheckpointError(errors) {
  const fallback = "检查点完整性验证未通过";
  const first = Array.isArray(errors) && errors.length ? String(errors[0]).trim() : fallback;
  const text = first || fallback;
  return text.length > 96 ? `${text.slice(0, 95)}…` : text;
}

function renderCheckpointList() {
  const box = $("#checkpoint-list");
  box.replaceChildren();
  state.selectedCheckpointId = null;
  $("#btn-restore-checkpoint").disabled = true;

  if (!state.checkpoints.length) {
    const empty = document.createElement("div");
    empty.className = "checkpoint-empty";
    empty.textContent = "当前项目还没有可恢复的检查点。";
    box.appendChild(empty);
    $("#btn-undo-last-fix").disabled = true;
    return;
  }

  $("#btn-undo-last-fix").disabled = !P0.latestBatchCheckpoint(state.checkpoints);
  for (const cp of state.checkpoints) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    const name = document.createElement("span");
    const meta = document.createElement("span");
    label.className = `checkpoint-option${cp.canRestore ? "" : " unrestorable"}`;
    radio.type = "radio";
    radio.name = "checkpoint";
    radio.value = cp.checkpointId;
    radio.disabled = !cp.canRestore;
    name.className = "checkpoint-name";
    meta.className = "checkpoint-meta";
    const checkpointName = cp.label || `${checkpointReasonLabel(cp.reason)}（${cp.checkpointId}）`;
    name.textContent = cp.canRestore ? checkpointName : `${checkpointName}（不可恢复）`;
    const count = cp.itemCount === null ? "" : ` ｜ ${cp.itemCount} 项`;
    const invalidReason = cp.canRestore
      ? ""
      : ` ｜ 原因：${conciseCheckpointError(cp.validationErrors)}` +
        (cp.validationErrors.length > 1 ? `（另有 ${cp.validationErrors.length - 1} 项）` : "");
    meta.textContent = `${cp.createdAt || "时间未知"}${count}${invalidReason}`;
    if (cp.canRestore) {
      radio.addEventListener("change", () => {
        state.selectedCheckpointId = cp.checkpointId;
        $("#btn-restore-checkpoint").disabled = false;
      });
    }
    label.append(radio, name, meta);
    box.appendChild(label);
  }
}

function resetCurrentProject({ clearProjectDir = false } = {}) {
  if (state.aiRequestPlan) {
    window.oak.cancelAiSuggestion(state.aiRequestPlan.plan_id).catch(() => {});
  }
  if (state.aiSuggestion && state.aiSuggestion.review_state === "pending") {
    window.oak.reviewAiSuggestion(state.aiSuggestion.review_id, "rejected").catch(() => {});
  }
  state.project = null;
  state.lastCheck = null;
  state.selectedIssue = null;
  state.exportFiles = [];
  state.pdfPath = null;
  state.citationResolution = null;
  state.citationPlan = null;
  state.pendingCitationKind = null;
  state.fixPlan = null;
  state.checkpoints = [];
  state.selectedCheckpointId = null;
  state.rulepackUpgradePlan = null;
  state.syncPreview = null;
  state.aiRequestPlan = null;
  state.aiSuggestion = null;
  if (clearProjectDir) {
    state.projectDir = null;
    $("#chosen-dir").textContent = "未选择（需要空目录）";
  }
}

// ---------- actions（UI 与冒烟共用） ----------

const actions = {
  async chooseOwnFile() {
    const file = await window.oak.pickManuscript();
    if (file) this.chooseFilePath(file);
  },

  chooseFilePath(file) {
    if (state.file !== file) resetCurrentProject({ clearProjectDir: true });
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
    if (state.projectDir !== dir && state.project !== null) resetCurrentProject();
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
    $("#citation-resolution-select").value = state.settings.citation;
    $("#language-select").value = state.settings.language;
    $("#epub-preview-check").checked = !!state.settings.epubPreview;
  },

  readSettingsFromUi() {
    state.settings.type = document.querySelector('input[name="mtype"]:checked').value;
    state.settings.citation = $("#citation-select").value;
    state.settings.language = $("#language-select").value;
    state.settings.epubPreview = $("#epub-preview-check").checked;
  },

  async prepareCitationPlan(kind, citation = state.settings.citation) {
    if (!state.project) throw new Error("请先创建或打开项目");
    if (!new Set(["check", "recheck"]).has(kind)) throw new Error("检查类型非法");
    if (!CITATION_VALUES.has(citation)) throw new Error("引用体例选择非法");
    if (state.citationPlanning || state.citationApplying) {
      throw new Error("引用体例确认正在处理");
    }

    state.citationPlanning = true;
    $("#citation-resolution-select").disabled = true;
    $("#btn-cancel-citation-resolution").disabled = true;
    $("#btn-confirm-citation-resolution").disabled = true;
    try {
      const response = unwrap(await window.oak.planCitation(state.project, citation));
      const plan = normalizeCitationPlan(response.result, citation, kind);
      state.citationPlan = plan;
      state.pendingCitationKind = kind;
      state.settings.citation = citation;
      $("#citation-select").value = citation;
      renderCitationPlan(plan);
      const dialog = $("#citation-resolution-dialog");
      if (!dialog.open) dialog.showModal();
      return {
        awaitingCitationConfirmation: true,
        planId: plan.planId,
        citationResolution: plan.resolution,
        page: state.page,
      };
    } finally {
      state.citationPlanning = false;
      $("#citation-resolution-select").disabled = false;
      $("#btn-cancel-citation-resolution").disabled = false;
      $("#btn-confirm-citation-resolution").disabled = false;
    }
  },

  async changeCitationSelection(citation) {
    const previous = state.citationPlan ? state.citationPlan.citation : state.settings.citation;
    try {
      return await this.prepareCitationPlan(state.pendingCitationKind || "check", citation);
    } catch (error) {
      $("#citation-resolution-select").value = previous;
      throw error;
    }
  },

  cancelCitationResolution() {
    if (state.citationPlanning || state.citationApplying) return false;
    state.citationPlan = null;
    state.pendingCitationKind = null;
    const dialog = $("#citation-resolution-dialog");
    if (dialog.open) dialog.close("cancel");
    showPage(state.lastCheck ? "issues" : "target");
    return true;
  },

  async confirmCitationResolution() {
    const plan = state.citationPlan;
    if (!plan) throw new Error("没有待确认的引用体例解析计划");
    if (state.citationPlanning || state.citationApplying) {
      throw new Error("引用体例确认正在处理");
    }
    const fallbackPage = plan.kind === "recheck" && state.lastCheck ? "issues" : "target";
    state.citationApplying = true;
    $("#citation-resolution-select").disabled = true;
    $("#btn-cancel-citation-resolution").disabled = true;
    $("#btn-confirm-citation-resolution").disabled = true;
    const dialog = $("#citation-resolution-dialog");
    if (dialog.open) dialog.close("confirmed");
    showPage("progress");
    renderStages(2);
    try {
      const checked = unwrap(await window.oak.check(state.project, plan.kind, {
        citation: plan.citation,
        citationPlanId: plan.planId,
      }));
      const resolution = normalizeCitationResolution(
        checked.result && checked.result.citation_resolution,
        plan.citation,
      );
      if (!sameCitationResolution(plan.resolution, resolution)) {
        throw new Error("检查结果与用户确认的引用体例解析计划不一致");
      }

      state.citationResolution = resolution;
      state.lastCheck = checked.result;
      state.citationPlan = null;
      state.pendingCitationKind = null;
      renderStages(STAGES.length);
      enableStep("issues"); enableStep("export");
      showPage("issues");
      state.filter = "pending"; state.selectedIssue = null;
      renderIssues(); renderDetail(null);
      return {
        statusLevel: checked.result.status_level,
        issueCount: checked.result.issues.length,
        rulepack: checked.result.rulepack,
        page: state.page,
        citationResolution: resolution,
      };
    } catch (error) {
      state.citationPlan = null;
      state.pendingCitationKind = null;
      showPage(fallbackPage);
      throw error;
    } finally {
      state.citationApplying = false;
      $("#citation-resolution-select").disabled = false;
      $("#btn-cancel-citation-resolution").disabled = false;
      $("#btn-confirm-citation-resolution").disabled = false;
    }
  },

  async startCheck() {
    if (!state.file || !state.projectDir) throw new Error("请先选择稿件与项目目录");
    enableStep("progress");
    showPage("progress");
    renderStages(0);
    if (!state.project) {
      const created = unwrap(await window.oak.createProject({
        input: state.file, projectDir: state.projectDir,
        type: state.settings.type, language: state.settings.language,
        citation: state.settings.citation, epubPreview: state.settings.epubPreview,
      }));
      state.project = created.result.project;
    }
    renderStages(2);
    return this.prepareCitationPlan("check", state.settings.citation);
  },

  async autoFix() {
    if (state.fixPlanning || state.fixApplying) return { count: 0, busy: true };
    state.fixPlanning = true;
    $("#btn-autofix").disabled = true;
    try {
      const response = unwrap(await window.oak.planFixes(state.project));
      const plan = P0.normalizeFixPlan(response.result);
      state.fixPlan = plan;
      if (plan.count === 0) {
        state.fixPlan = null;
        toast("没有可批量自动修复的问题");
        return { planId: plan.planId, count: 0 };
      }
      renderFixPlan(plan);
      $("#fix-plan-dialog").showModal();
      return { planId: plan.planId, count: plan.count };
    } finally {
      state.fixPlanning = false;
      $("#btn-autofix").disabled = false;
    }
  },

  cancelFixPlan() {
    if (state.fixApplying) return false;
    state.fixPlan = null;
    const dialog = $("#fix-plan-dialog");
    if (dialog.open) dialog.close("cancel");
    return true;
  },

  async confirmFixPlan() {
    if (!state.fixPlan) throw new Error("没有待确认的批量修复计划");
    if (state.fixApplying) throw new Error("批量修复正在执行");
    const plan = state.fixPlan;
    state.fixApplying = true;
    $("#btn-confirm-fix-plan").disabled = true;
    $("#btn-cancel-fix-plan").disabled = true;
    try {
      const fx = unwrap(await window.oak.applyFixPlan(state.project, plan.planId));
      const applied = Number.isInteger(fx.result.applied_count) ? fx.result.applied_count : 0;
      const checkpointId = fx.result.checkpoint_id || null;
      state.fixPlan = null;
      $("#fix-plan-dialog").close("applied");
      if (applied > 0) {
        toast(`已批量修复 ${applied} 项${checkpointId ? `（检查点 ${checkpointId}）` : ""}，正在复检…`);
      } else {
        toast("计划未应用任何修改，正在重新检查…");
      }
      const after = await this.recheck();
      return { applied, checkpointId, after };
    } finally {
      state.fixApplying = false;
      $("#btn-confirm-fix-plan").disabled = false;
      $("#btn-cancel-fix-plan").disabled = false;
    }
  },

  async loadCheckpoints() {
    const response = unwrap(await window.oak.listCheckpoints(state.project));
    state.checkpoints = P0.normalizeCheckpoints(response.result);
    renderCheckpointList();
    return state.checkpoints;
  },

  async openCheckpoints() {
    await this.loadCheckpoints();
    $("#checkpoint-dialog").showModal();
    return { count: state.checkpoints.length };
  },

  closeCheckpoints() {
    if (state.restoringCheckpoint) return false;
    const dialog = $("#checkpoint-dialog");
    if (dialog.open) dialog.close("cancel");
    state.selectedCheckpointId = null;
    return true;
  },

  async restoreCheckpoint(checkpointId) {
    if (state.restoringCheckpoint) throw new Error("正在恢复检查点");
    state.restoringCheckpoint = true;
    $("#btn-undo-last-fix").disabled = true;
    $("#btn-restore-checkpoint").disabled = true;
    try {
      const response = unwrap(await window.oak.restoreCheckpoint(state.project, checkpointId));
      $("#checkpoint-dialog").close("restored");
      state.selectedCheckpointId = null;
      toast(`已恢复检查点 ${checkpointId}，正在重新检查…`);
      const after = await this.recheck();
      return { result: response.result, after };
    } finally {
      state.restoringCheckpoint = false;
    }
  },

  async undoLastFix() {
    await this.loadCheckpoints();
    const checkpoint = P0.latestBatchCheckpoint(state.checkpoints);
    if (!checkpoint) throw new Error("没有可撤销的批量修复检查点");
    return this.restoreCheckpoint(checkpoint.checkpointId);
  },

  async restoreSelectedCheckpoint() {
    if (!state.selectedCheckpointId) throw new Error("请先选择一个检查点");
    return this.restoreCheckpoint(state.selectedCheckpointId);
  },

  async recheck() {
    const chk = unwrap(await window.oak.check(state.project, "recheck"));
    state.lastCheck = chk.result;
    renderIssues(); renderDetail(null);
    return {
      statusLevel: chk.result.status_level,
      issueCount: chk.result.issues.length,
      rulepack: chk.result.rulepack,
      citationResolution: state.citationResolution,
    };
  },

  async requestCitationRecheck() {
    return this.prepareCitationPlan("recheck", state.settings.citation);
  },

  async runExternal() {
    if (!state.project) throw new Error("请先创建或打开 EPUB 项目");
    const response = unwrap(await window.oak.runExternal(state.project));
    return response.result.results;
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

  async planAiSuggestion(issueId, instruction = "") {
    if (!state.project) throw new Error("请先创建或打开项目");
    if (state.aiRequestConfirming) throw new Error("AI 请求确认正在处理");
    const response = unwrap(await window.oak.planAiSuggestion(
      state.project, issueId, instruction,
    ));
    state.aiSuggestion = null;
    state.aiRequestPlan = response.plan;
    renderAiRequestPlan(response.plan);
    const dialog = $("#ai-request-dialog");
    if (!dialog.open) dialog.showModal();
    return response.plan;
  },

  async saveAiSettings() {
    return saveAiSettings();
  },

  async cancelAiSuggestion() {
    if (state.aiRequestConfirming || state.aiSuggestionReviewing) return false;
    const plan = state.aiRequestPlan;
    const suggestion = state.aiSuggestion;
    state.aiRequestPlan = null;
    state.aiSuggestion = null;
    if (plan) unwrap(await window.oak.cancelAiSuggestion(plan.plan_id));
    if (suggestion && suggestion.review_state === "pending") {
      unwrap(await window.oak.reviewAiSuggestion(suggestion.review_id, "rejected"));
    }
    const dialog = $("#ai-request-dialog");
    if (dialog.open) dialog.close("cancel");
    return true;
  },

  async confirmAiSuggestion() {
    const plan = state.aiRequestPlan;
    if (!plan) throw new Error("没有待确认的 AI 发送预览");
    if (!plan.transport_available) throw new Error("模型 transport 尚未接入；没有发送任何内容");
    if (state.aiRequestConfirming) throw new Error("AI 请求确认正在处理");
    state.aiRequestConfirming = true;
    $("#btn-confirm-ai-request").disabled = true;
    $("#btn-cancel-ai-request").disabled = true;
    try {
      const response = unwrap(await window.oak.confirmAiSuggestion(plan.plan_id));
      state.aiRequestPlan = null;
      state.aiSuggestion = { ...response.suggestion, issue_id: state.selectedIssue };
      $("#ai-suggestion-text").textContent = response.suggestion.text;
      $("#ai-suggestion-result").classList.remove("hidden");
      $("#ai-suggestion-review-status").textContent =
        `等待您审阅；${response.suggestion.expires_at} 前有效。采纳只记录问题状态，不会改稿。`;
      $("#btn-accept-ai-suggestion").disabled = false;
      $("#btn-reject-ai-suggestion").disabled = false;
      $("#ai-plan-transport").textContent =
        "建议仅保存在当前界面内存中；没有写入稿件、问题状态、项目、报告或同步记录。";
      $("#btn-confirm-ai-request").textContent = "已完成（不会写回）";
      $("#btn-cancel-ai-request").textContent = "关闭";
      return response.suggestion;
    } finally {
      state.aiRequestConfirming = false;
      $("#btn-cancel-ai-request").disabled = false;
    }
  },

  async reviewAiSuggestion(decision) {
    const suggestion = state.aiSuggestion;
    if (!suggestion || suggestion.review_state !== "pending") {
      throw new Error("没有待审阅的 AI 建议");
    }
    if (!new Set(["accepted", "rejected"]).has(decision)) {
      throw new Error("AI 建议审阅决定非法");
    }
    if (state.aiSuggestionReviewing) throw new Error("AI 建议正在处理");
    state.aiSuggestionReviewing = true;
    $("#btn-accept-ai-suggestion").disabled = true;
    $("#btn-reject-ai-suggestion").disabled = true;
    try {
      const response = unwrap(await window.oak.reviewAiSuggestion(
        suggestion.review_id, decision,
      ));
      state.aiSuggestion = { ...suggestion, review_state: decision };
      if (decision === "accepted") {
        const issue = state.lastCheck && state.lastCheck.issues.find(
          (item) => item.issue_id === suggestion.issue_id,
        );
        if (issue) issue.status = "accepted";
        renderIssues();
        if (issue) renderDetail(issue);
        $("#ai-suggestion-review-status").textContent =
          "已采纳为人工处理参考；问题状态已标记为接受，但建议未写入稿件或项目文件。";
      } else {
        $("#ai-suggestion-review-status").textContent =
          "已放弃这条 AI 建议；规则问题状态和稿件均未改变。";
      }
      $("#btn-cancel-ai-request").textContent = "关闭";
      return response.review;
    } finally {
      state.aiSuggestionReviewing = false;
    }
  },

  async doExport(outDir) {
    const r = unwrap(await window.oak.exportAll(state.project, outDir || undefined));
    state.exportFiles = r.result.files;
    state.pdfPath = null;
    renderExportFiles();
    $("#btn-export-pdf").disabled = false;
    $("#btn-open-folder").disabled = false;
    renderExportSummary();
    toast(`已导出 ${state.exportFiles.length} 个文件。原稿未被修改。`);
    this.offerSyncAfterExport().catch((error) => {
      $("#sync-offer-status").textContent = `同步预览未启动：${String(error.message || error)}。导出不受影响。`;
    });
    return { files: state.exportFiles };
  },

  async offerSyncAfterExport() {
    const auth = unwrap(await window.oak.authStatus());
    state.authStatus = auth;
    renderAccountStatus();
    if (!auth.loggedIn || auth.state !== "authenticated") {
      $("#sync-offer-status").textContent = "未登录，不询问、不发送；本次导出已完整保存在本地。";
      return { offered: false, reason: "signed_out" };
    }
    const response = unwrap(await window.oak.syncPreview(state.project, "export", false));
    const preview = response.preview;
    if (!preview || !preview.record || !Array.isArray(preview.choices)) {
      throw new Error("同步预览返回格式非法");
    }
    state.syncPreview = preview;
    renderSyncPreview(preview.record);
    $("#sync-preview-dialog").showModal();
    $("#sync-offer-status").textContent = "同步预览已打开；尚未发送任何数据。";
    return { offered: true, idempotencyId: preview.record.idempotency_id };
  },

  async confirmSync(choice) {
    const preview = state.syncPreview;
    if (!preview) throw new Error("没有待确认的同步预览");
    if (state.syncConfirming) throw new Error("同步选择正在处理");
    state.syncConfirming = true;
    setSyncChoiceDisabled(true);
    try {
      const response = unwrap(await window.oak.syncConfirm(preview.record.idempotency_id, choice));
      const result = response.result;
      state.syncPreview = null;
      $("#sync-preview-dialog").close(choice);
      if (result.queued) {
        $("#sync-offer-status").textContent =
          "本次负载已写入本机加密待发送队列；生产同步尚未配置，当前没有上传到网站。";
        toast("已写入本机加密待发送队列；尚未上传到网站。", 5000);
        await refreshSyncQueue();
      } else if (choice === "never_for_project") {
        $("#sync-offer-status").textContent = "已记录：不再询问此项目；本地项目和导出不受影响。";
        toast("已关闭此项目的同步询问");
      } else {
        $("#sync-offer-status").textContent = "本次暂不同步；没有发送或入队。";
        toast("本次没有同步");
      }
      return result;
    } finally {
      state.syncConfirming = false;
      setSyncChoiceDisabled(false);
    }
  },

  async makePdf() {
    const r = unwrap(await window.oak.exportPdf(state.project));
    state.pdfPath = r.path;
    renderExportFiles();
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

  async previewProjectStandardChange() {
    if (!state.project) throw new Error("请先打开或创建一个项目");
    if (state.rulepackUpgradePlanning || state.rulepackUpgradeApplying) {
      throw new Error("项目标准变更正在处理");
    }
    state.rulepackUpgradePlanning = true;
    $("#btn-project-standard-change").disabled = true;
    try {
      const response = await window.oak.planProjectStandardChange(state.project);
      if (!response || response.ok === false) {
        if (response && response.code === "RULEPACK_UPGRADE_NOT_NEEDED") {
          toast("当前项目已经使用默认标准版本");
          await renderProjectStandardStatus();
          return { needed: false };
        }
        throw new Error((response && response.error) || "无法生成项目标准差异");
      }
      const plan = response.result;
      if (!plan || plan.kind !== "oak-rulepack-upgrade-plan" ||
          typeof plan.plan_id !== "string" || !plan.diff || plan.requires_recheck !== true) {
        throw new Error("项目标准差异返回格式非法");
      }
      state.rulepackUpgradePlan = plan;
      renderRulepackUpgradePlan(plan);
      $("#rulepack-upgrade-dialog").showModal();
      return { needed: true, planId: plan.plan_id, direction: plan.direction };
    } finally {
      state.rulepackUpgradePlanning = false;
      if (!state.rulepackUpgradePlan) await renderProjectStandardStatus();
    }
  },

  cancelProjectStandardChange() {
    if (state.rulepackUpgradeApplying) return false;
    state.rulepackUpgradePlan = null;
    const dialog = $("#rulepack-upgrade-dialog");
    if (dialog.open) dialog.close("cancel");
    return true;
  },

  async confirmProjectStandardChange() {
    const plan = state.rulepackUpgradePlan;
    if (!plan) throw new Error("没有待确认的项目标准变更计划");
    if (state.rulepackUpgradeApplying) throw new Error("项目标准变更正在执行");
    state.rulepackUpgradeApplying = true;
    $("#btn-cancel-rulepack-upgrade").disabled = true;
    $("#btn-confirm-rulepack-upgrade").disabled = true;
    try {
      const response = unwrap(await window.oak.applyProjectStandardChange(
        state.project,
        plan.plan_id,
      ));
      if (!response.result.rulepack_check_required) {
        throw new Error("核心没有要求按新规则包重新检查，已安全停止");
      }
      state.rulepackUpgradePlan = null;
      state.lastCheck = null;
      state.selectedIssue = null;
      state.fixPlan = null;
      state.exportFiles = [];
      state.pdfPath = null;
      $("#rulepack-upgrade-dialog").close("applied");
      enableStep("progress");
      showPage("progress");
      renderStages(2);
      toast("项目标准已切换并建立检查点，正在按新版本完整检查…", 5000);
      try {
        const checked = unwrap(await window.oak.check(state.project, "check"));
        state.lastCheck = checked.result;
        renderStages(STAGES.length);
        enableStep("issues"); enableStep("export");
        showPage("issues");
        state.filter = "pending";
        renderIssues(); renderDetail(null);
        toast(`项目已采用规则包 ${response.result.rulepack.version}，重新检查完成。`, 5000);
        return {
          change: response.result.change,
          issueCount: checked.result.issues.length,
          statusLevel: checked.result.status_level,
        };
      } catch (error) {
        throw new Error(`项目标准已切换，但重新检查失败：${String(error.message || error)}`);
      }
    } finally {
      state.rulepackUpgradeApplying = false;
      $("#btn-cancel-rulepack-upgrade").disabled = false;
      $("#btn-confirm-rulepack-upgrade").disabled = false;
    }
  },

  getState() {
    return {
      page: state.page, project: state.project,
      issues: state.lastCheck ? state.lastCheck.issues.length : 0,
      statusLevel: state.lastCheck ? state.lastCheck.status_level : null,
      exports: state.exportFiles.length,
      awaitingCitationConfirmation: !!state.citationPlan,
      citationPlan: state.citationPlan ? state.citationPlan.planId : null,
      citationResolution: state.citationResolution,
      fixPlanCount: state.fixPlan ? state.fixPlan.count : 0,
      checkpoints: state.checkpoints.length,
      rulepackUpgradePlan: state.rulepackUpgradePlan ? state.rulepackUpgradePlan.plan_id : null,
      syncPreview: state.syncPreview ? state.syncPreview.record.idempotency_id : null,
      selectedIssue: state.selectedIssue,
      aiRequestPlan: state.aiRequestPlan ? state.aiRequestPlan.plan_id : null,
      aiSuggestionReview: state.aiSuggestion ? {
        id: state.aiSuggestion.review_id,
        state: state.aiSuggestion.review_state,
      } : null,
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

function renderExportFiles() {
  const list = $("#export-files");
  const paths = state.pdfPath
    ? [...state.exportFiles, state.pdfPath]
    : [...state.exportFiles];
  const items = paths.map((filePath) => {
    const item = document.createElement("li");
    item.textContent = String(filePath);
    return item;
  });
  list.replaceChildren(...items);
}

// ---------- 标准与设置页 ----------

function stableDisplay(value) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function diffListItem(kind, text) {
  const item = document.createElement("li");
  const badge = document.createElement("span");
  const content = document.createElement("span");
  badge.className = "upgrade-diff-kind";
  badge.textContent = kind;
  content.textContent = text;
  item.append(badge, content);
  return item;
}

function renderEntityDiff(targetSelector, group, idField) {
  const target = $(targetSelector);
  const items = [];
  const safeGroup = group && typeof group === "object" ? group : {};
  for (const entry of Array.isArray(safeGroup.added) ? safeGroup.added : []) {
    items.push(diffListItem("新增", `${entry[idField] || "未知 ID"}\n${stableDisplay(entry)}`));
  }
  for (const entry of Array.isArray(safeGroup.removed) ? safeGroup.removed : []) {
    items.push(diffListItem("移除", `${entry[idField] || "未知 ID"}\n${stableDisplay(entry)}`));
  }
  for (const entry of Array.isArray(safeGroup.changed) ? safeGroup.changed : []) {
    const fields = Array.isArray(entry.changed_fields) ? entry.changed_fields.join("、") : "未说明字段";
    items.push(diffListItem(
      "变更",
      `${entry[idField] || entry.before?.[idField] || entry.after?.[idField] || "未知 ID"}`
        + `（${fields}）\n修改前：${stableDisplay(entry.before)}\n修改后：${stableDisplay(entry.after)}`,
    ));
  }
  if (!items.length) items.push(diffListItem("无", "本部分没有变化。"));
  target.replaceChildren(...items);
}

function renderRulepackUpgradePlan(plan) {
  const diff = plan.diff || {};
  const summary = diff.summary || {};
  const direction = plan.direction === "rollback" ? "回退" : "升级";
  $("#rulepack-upgrade-summary").textContent =
    `${direction}：${plan.current_rulepack.version}（序列 ${plan.current_rulepack.release_sequence}） → `
    + `${plan.target_rulepack.version}（序列 ${plan.target_rulepack.release_sequence}）。`
    + `规则 +${summary.rules_added || 0} / -${summary.rules_removed || 0} / 改 ${summary.rules_changed || 0}；`
    + `标准 +${summary.standards_added || 0} / -${summary.standards_removed || 0} / 改 ${summary.standards_changed || 0}。`
    + "确认后旧问题集会归档，必须重新检查。";

  const releaseItems = (diff.release && Array.isArray(diff.release.target_change_summary))
    ? diff.release.target_change_summary.map((text) => diffListItem("说明", String(text)))
    : [];
  const standardsDiff = diff.standards || {};
  if (standardsDiff.registry_changed) {
    releaseItems.push(diffListItem(
      "注册表",
      `修改前：${stableDisplay(standardsDiff.registry_before)}\n修改后：${stableDisplay(standardsDiff.registry_after)}`,
    ));
  }
  if (!releaseItems.length) releaseItems.push(diffListItem("说明", "目标版本没有附加发布说明。"));
  $("#rulepack-upgrade-release").replaceChildren(...releaseItems);

  renderEntityDiff("#rulepack-upgrade-rules", diff.rules, "rule_id");
  renderEntityDiff("#rulepack-upgrade-standards", standardsDiff, "standard_id");

  const citation = diff.citation_mapping || {};
  const citationTarget = $("#rulepack-upgrade-citation");
  if (!citation.changed) {
    const unchanged = document.createElement("div");
    unchanged.className = "upgrade-mapping-column";
    unchanged.textContent = "默认引用体例映射没有变化。";
    citationTarget.replaceChildren(unchanged);
  } else {
    const before = document.createElement("div");
    const after = document.createElement("div");
    before.className = "upgrade-mapping-column";
    after.className = "upgrade-mapping-column after";
    before.textContent = `修改前\n${stableDisplay(citation.before)}`;
    after.textContent = `修改后\n${stableDisplay(citation.after)}`;
    citationTarget.replaceChildren(before, after);
  }
  $("#btn-confirm-rulepack-upgrade").textContent =
    plan.direction === "rollback" ? "确认回退并重新检查" : "确认升级并重新检查";
}

async function renderProjectStandardStatus() {
  const text = $("#project-standard-text");
  const button = $("#btn-project-standard-change");
  button.disabled = true;
  if (!state.project) {
    text.textContent = "打开项目后，可在这里比较该项目固定的规则包与当前默认版本。";
    return;
  }
  try {
    const response = unwrap(await window.oak.projectStandardStatus(state.project));
    const current = response.project_identity;
    const active = response.active_identity;
    const legacy = response.legacy_migratable ? "；旧格式 pin 已唯一解析但未静默写回" : "";
    if (response.differs) {
      const direction = active.release_sequence < current.release_sequence ? "回退" : "升级";
      text.textContent =
        `当前项目固定：${current.version}（序列 ${current.release_sequence}）；`
        + `默认版本：${active.version}（序列 ${active.release_sequence}）。可查看完整差异后${direction}${legacy}。`;
      button.disabled = state.rulepackUpgradePlanning || state.rulepackUpgradeApplying;
    } else {
      text.textContent = `当前项目已固定到默认标准包 ${current.version}（序列 ${current.release_sequence}）${legacy}。`;
    }
  } catch (error) {
    text.textContent = `无法核验当前项目的标准版本：${String(error.message || error)}`;
    button.disabled = true;
  }
}

async function renderStandardsPage() {
  try {
    const r = unwrap(await window.oak.getStandards());
    const tbody = $("#standards-table tbody");
    tbody.innerHTML = "";
    for (const s of r.standards) {
      const tr = document.createElement("tr");
      const typeLabel = { official: "官方标准", oak_interpretation: "湖岸解释", technical_spec: "技术规范" }[s.source_type] || s.source_type;
      const statusLabel = {
        active: "有效",
        under_review: "待复核",
        superseded: "已被替代",
        deprecated: "已停用",
      }[s.status] || s.status;
      for (const text of [s.title, typeLabel, s.version, statusLabel, s.scope]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    const standardStatus = r.status || {};
    const active = standardStatus.active;
    $("#standards-active-text").textContent = active
      ? `当前默认标准包：${active.version}（发布序列 ${active.release_sequence}，${active.source === "bundled" ? "APP 内置" : "已签名安装"}）`
      : "当前没有可用的标准包。";
    $("#standards-update-text").textContent = standardStatus.error
      ? `标准库核验失败：${standardStatus.error.message}`
      : standardStatus.trust_configured
        ? "本地签名包导入已启用；自动联网更新保持关闭。"
        : "签名校验与回滚机制已启用，但正式 release 公钥尚未配置；当前只能使用摘要固定的内置标准包。";
    $("#btn-install-standards").disabled = !standardStatus.local_signed_import_enabled;
    $("#btn-rollback-standards").disabled = !standardStatus.previous;
    const info = unwrap(await window.oak.appInfo());
    $("#rulepack-info").textContent = `规则包：${info.rulepack} ｜ 标准包 manifest：${r.release.manifest_sha256.slice(0, 16)}… ｜ APP 版本：${info.appVersion}`;
    $("#app-meta").textContent = `规则包 ${info.rulepack}`;
    await renderProjectStandardStatus();
  } catch (err) {
    $("#standards-active-text").textContent = "标准库不可用（已安全停止，不会回退到未核验规则）。";
    $("#standards-update-text").textContent = String(err.message || err);
    $("#btn-install-standards").disabled = true;
    $("#btn-rollback-standards").disabled = true;
    $("#btn-project-standard-change").disabled = true;
    $("#project-standard-text").textContent = "标准库不可用，项目检查与标准切换已安全停止。";
    toast(String(err.message || err));
  }
}

async function toggleAccountAuth() {
  const status = unwrap(await window.oak.authStatus());
  if (status.loggedIn) {
    const signedOut = unwrap(await window.oak.logout());
    state.authStatus = signedOut;
    renderAccountStatus();
    await refreshSyncQueue();
    toast("已退出湖岸账号；本地项目和导出仍可使用。", 3600);
    return signedOut;
  }
  const result = unwrap(await window.oak.beginLogin());
  state.authStatus = unwrap(await window.oak.authStatus());
  renderAccountStatus();
  toast(result.message || "账号登录尚未配置", 5000);
  return result;
}

function renderAccountStatus() {
  const auth = state.authStatus;
  const license = state.licenseStatus;
  if (auth) {
    $("#auth-status-text").textContent = auth.loggedIn
      ? `已登录湖岸统一账号（${auth.accountId}）。登录不等于同意同步。`
      : `${auth.message} 未登录不影响本地检查、修复和导出。`;
    const label = auth.loggedIn ? "退出湖岸账号" : "注册 / 登录湖岸账号";
    for (const selector of ["#btn-login", "#btn-login2", "#btn-login-export"]) {
      $(selector).textContent = label;
    }
  }
  if (license) {
    const tier = (license.effectiveTier || license.tier) === "pro" ? "Pro" : "Free";
    $("#license-status-text").textContent =
      `${tier} 权益（${license.entitlementState}）；本地项目与已有导出永不因账号或订阅状态锁定。`;
  }
}

function selectedAiMode() {
  const selected = document.querySelector('input[name="ai-mode"]:checked');
  return selected ? selected.value : "off";
}

function replaceTextList(root, items) {
  root.replaceChildren();
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    root.appendChild(li);
  }
}

function renderAiRequestPlan(plan) {
  state.aiSuggestion = null;
  $("#ai-plan-mode").textContent = plan.destination.mode === "byo" ? "我的 AI" : "湖岸 AI";
  $("#ai-plan-provider").textContent = plan.destination.provider_label;
  $("#ai-plan-model").textContent = plan.destination.model || "由湖岸服务确定";
  $("#ai-plan-base-url").textContent = plan.destination.base_url || "湖岸 AI 服务（生产地址尚未配置）";
  $("#ai-plan-expires").textContent = plan.expires_at;
  replaceTextList($("#ai-plan-sends"), plan.disclosure.sends);
  replaceTextList($("#ai-plan-does-not-send"), plan.disclosure.does_not_send);
  $("#ai-plan-request-json").textContent = JSON.stringify(plan.request, null, 2);
  $("#ai-suggestion-text").textContent = "";
  $("#ai-suggestion-review-status").textContent = "";
  $("#btn-accept-ai-suggestion").disabled = true;
  $("#btn-reject-ai-suggestion").disabled = true;
  $("#ai-suggestion-result").classList.add("hidden");
  const confirm = $("#btn-confirm-ai-request");
  confirm.disabled = !plan.transport_available;
  confirm.textContent = plan.transport_available ? "确认发送一次" : "模型 transport 尚未接入";
  $("#ai-plan-transport").textContent = plan.transport_available
    ? "尚未发送。点击确认后只发送上面显示的同一份内容；计划只能使用一次。"
    : "当前检查点没有模型 transport；本预览不会联网，确认按钮保持禁用。";
}

function updateAiEndpointInput({ providerChanged = false } = {}) {
  const provider = $("#ai-provider-select").value;
  const fixedCloud = ["openai", "anthropic", "google"].includes(provider);
  const input = $("#ai-base-url-input");
  input.disabled = fixedCloud;
  if (providerChanged && fixedCloud) input.value = "";
  input.placeholder = fixedCloud
    ? "官方端点固定；如需自定义地址请选择 OpenAI-compatible"
    : "远程地址必须为 HTTPS；本机服务可使用回环 HTTP";
}

function renderAiSettings() {
  const status = state.aiStatus;
  if (!status) return;
  const radio = document.querySelector(`input[name="ai-mode"][value="${status.mode}"]`);
  if (radio) radio.checked = true;
  const byo = status.mode === "byo";
  $("#ai-byo-fields").classList.toggle("hidden", !byo);
  if (status.provider) $("#ai-provider-select").value = status.provider;
  $("#ai-model-input").value = status.model || "";
  $("#ai-base-url-input").value = status.base_url || "";
  updateAiEndpointInput();
  $("#ai-credential-input").value = "";
  $("#btn-clear-ai-credential").disabled = !status.has_credential;
  const persistenceReady = status.persistence && status.persistence.state === "ready" &&
    status.persistence.encrypted === true;
  $("#btn-save-ai-settings").disabled = !persistenceReady;
  const pro = state.licenseStatus && state.licenseStatus.effectiveTier === "pro";
  const entitlement = byo && !pro ? " 我的 AI 需要有效 Pro 权益。" : "";
  $("#ai-status-text").textContent = `${status.message}${entitlement}`;
  if (state.lastCheck && state.selectedIssue) {
    const selected = state.lastCheck.issues.find((issue) => issue.issue_id === state.selectedIssue);
    if (selected) renderDetail(selected);
  }
}

async function refreshAiStatus() {
  const response = unwrap(await window.oak.aiStatus());
  state.aiStatus = response.status;
  renderAiSettings();
  return state.aiStatus;
}

async function saveAiSettings() {
  const mode = selectedAiMode();
  let payload = {
    mode,
    provider: null,
    model: null,
    base_url: null,
    credential_action: "clear",
    credential: null,
  };
  if (mode === "byo") {
    const provider = $("#ai-provider-select").value;
    const model = $("#ai-model-input").value.trim();
    const baseUrl = $("#ai-base-url-input").value.trim() || null;
    const credential = $("#ai-credential-input").value;
    const sameProvider = state.aiStatus && state.aiStatus.mode === "byo" &&
      state.aiStatus.provider === provider;
    const sameAddress = baseUrl === null || (state.aiStatus && state.aiStatus.base_url === baseUrl.replace(/\/+$/u, ""));
    payload = {
      mode,
      provider,
      model,
      base_url: baseUrl,
      credential_action: credential ? "replace" :
        (sameProvider && sameAddress && state.aiStatus.has_credential ? "keep" : "clear"),
      credential: credential || null,
    };
  }
  const response = unwrap(await window.oak.configureAi(payload));
  state.aiStatus = response.status;
  renderAiSettings();
  toast("AI 设置已由主进程保存；当前没有模型网络请求。", 4200);
  return state.aiStatus;
}

async function clearAiCredential() {
  const response = unwrap(await window.oak.clearAiCredential());
  state.aiStatus = response.status;
  renderAiSettings();
  toast("已清除本机保存的 AI 凭据。", 3600);
  return state.aiStatus;
}

function renderSyncQueue() {
  const root = $("#sync-queue-list");
  const persistence = state.syncPersistence;
  if (!persistence || persistence.state !== "ready" || persistence.encrypted !== true) {
    $("#sync-queue-status").textContent =
      "本机加密队列不可用；同步功能已安全停止，本地检查、修复和导出不受影响。";
    root.replaceChildren();
    return;
  }
  if (!state.authStatus || !state.authStatus.loggedIn) {
    $("#sync-queue-status").textContent = "本机加密队列已启用；登录后只显示当前账号的待发送项。";
    root.replaceChildren();
    return;
  }
  const transportText = state.syncTransportConfigured
    ? "只有点击发送才会联网。"
    : "生产同步端点尚未配置，均未上传。";
  $("#sync-queue-status").textContent = state.syncQueue.length
    ? `当前账号有 ${state.syncQueue.length} 个本机队列项；${transportText}`
    : `当前账号没有本机待发送项；${transportText}`;
  const children = state.syncQueue.map((item) => {
    const row = document.createElement("div");
    row.className = "sync-queue-item";
    const meta = document.createElement("div");
    meta.className = "sync-queue-meta";
    meta.textContent = `${item.payload.event} ｜ ${item.payload.run_id} ｜ ${item.state} ｜ ${item.created_at}`;
    const buttons = document.createElement("div");
    buttons.className = "sync-queue-actions";
    const stateButton = document.createElement("button");
    stateButton.textContent = item.state === "canceled" ? "重新加入待发送" : "取消待发送";
    stateButton.addEventListener("click", () => handleSyncQueueAction(item.state === "canceled" ? "retry" : "cancel", item.queue_id));
    const deleteButton = document.createElement("button");
    deleteButton.textContent = "删除本机记录";
    deleteButton.addEventListener("click", () => handleSyncQueueAction("delete", item.queue_id));
    if (state.syncTransportConfigured && item.state === "pending_transport") {
      const sendButton = document.createElement("button");
      sendButton.textContent = item.last_error ? "确认重试并发送" : "发送到网站";
      sendButton.addEventListener("click", () => handleSyncQueueAction(item.last_error ? "retrySend" : "send", item.queue_id));
      buttons.append(sendButton);
    }
    buttons.append(stateButton, deleteButton);
    row.append(meta, buttons);
    return row;
  });
  root.replaceChildren(...children);
}

async function refreshSyncQueue() {
  const response = unwrap(await window.oak.syncQueue());
  state.syncQueue = Array.isArray(response.items) ? response.items : [];
  state.syncPersistence = response.persistence || null;
  state.syncTransportConfigured = response.transportConfigured === true;
  renderSyncQueue();
  return response;
}

async function handleSyncQueueAction(action, queueId) {
  const operations = {
    cancel: () => window.oak.syncCancel(queueId),
    retry: () => window.oak.syncRetry(queueId),
    delete: () => window.oak.syncDelete(queueId),
    send: () => window.oak.syncSend(queueId),
    retrySend: async () => {
      unwrap(await window.oak.syncRetry(queueId));
      return window.oak.syncSend(queueId);
    },
  };
  if (!operations[action]) throw new Error("同步队列操作非法");
  try {
    unwrap(await operations[action]());
    await refreshSyncQueue();
    toast(action === "delete" ? "已删除本机队列记录" :
      ["send", "retrySend"].includes(action) ? "结果已同步到网站账号后台" : "本机队列状态已更新", 3600);
  } catch (error) {
    toast(String(error.message || error), 5000);
  }
}

async function refreshAccountStatus() {
  const [auth, license, ai] = await Promise.all([
    window.oak.authStatus(),
    window.oak.licenseStatus(),
    window.oak.aiStatus(),
  ]);
  state.authStatus = unwrap(auth);
  state.licenseStatus = unwrap(license);
  state.aiStatus = unwrap(ai).status;
  renderAccountStatus();
  renderAiSettings();
  await refreshSyncQueue();
  return { auth: state.authStatus, license: state.licenseStatus };
}

function flattenSyncRecord(value, prefix = "$") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenSyncRecord(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => flattenSyncRecord(child, `${prefix}.${key}`));
  }
  return [[prefix, value]];
}

function renderSyncPreview(record) {
  const items = flattenSyncRecord(record).map(([path, value]) => {
    const item = document.createElement("li");
    const field = document.createElement("code");
    const content = document.createElement("span");
    field.className = "sync-field-path";
    content.className = "sync-field-value";
    field.textContent = path;
    content.textContent = value === null ? "null（确认时写入授权时间）" : String(value);
    item.append(field, content);
    return item;
  });
  $("#sync-preview-fields").replaceChildren(...items);
}

function setSyncChoiceDisabled(disabled) {
  for (const selector of [
    "#btn-sync-once", "#btn-sync-ask-each-time", "#btn-sync-not-now", "#btn-sync-never-project",
  ]) $(selector).disabled = disabled;
}

// ---------- 绑定 ----------

document.addEventListener("DOMContentLoaded", () => {
  window.oak.onAuthChanged(() => {
    refreshAccountStatus().catch((error) => toast(String(error.message || error), 5000));
  });
  $$(".step").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      showPage(btn.dataset.page);
      if (btn.dataset.page === "standards") {
        renderStandardsPage().catch((error) => toast(String(error.message || error), 6000));
      }
    }));

  $("#btn-own-file").addEventListener("click", () =>
    actions.chooseOwnFile().catch((error) => toast(String(error.message || error), 5000)));
  $("#btn-sample").addEventListener("click", () =>
    actions.showSamples().catch((error) => toast(String(error.message || error), 5000)));
  $("#btn-open-project").addEventListener("click", () =>
    actions.openExistingDialog().catch((error) => toast(String(error.message || error), 6000)));
  $("#btn-pick-dir").addEventListener("click", () =>
    actions.pickProjectDir().catch((error) => toast(String(error.message || error), 5000)));
  $("#btn-to-target").addEventListener("click", () => { enableStep("target"); showPage("target"); });
  $("#btn-start-check").addEventListener("click", async () => {
    actions.readSettingsFromUi();
    try { await actions.startCheck(); } catch (err) { toast(String(err.message || err), 5000); showPage("target"); }
  });
  $("#citation-resolution-select").addEventListener("change", (event) =>
    actions.changeCitationSelection(event.target.value)
      .catch((error) => toast(String(error.message || error), 5000)));
  $("#btn-cancel-citation-resolution").addEventListener("click", () =>
    actions.cancelCitationResolution());
  $("#btn-confirm-citation-resolution").addEventListener("click", () =>
    actions.confirmCitationResolution().catch((error) => toast(String(error.message || error), 5000)));
  $("#citation-resolution-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!state.citationPlanning && !state.citationApplying) actions.cancelCitationResolution();
  });
  $("#btn-autofix").addEventListener("click", () => actions.autoFix().catch((e) => toast(String(e.message || e), 5000)));
  $("#btn-checkpoints").addEventListener("click", () => actions.openCheckpoints().catch((e) => toast(String(e.message || e), 5000)));
  $("#btn-cancel-fix-plan").addEventListener("click", () => actions.cancelFixPlan());
  $("#btn-confirm-fix-plan").addEventListener("click", () =>
    actions.confirmFixPlan().catch((e) => toast(String(e.message || e), 5000)));
  $("#btn-close-checkpoints").addEventListener("click", () => actions.closeCheckpoints());
  $("#btn-undo-last-fix").addEventListener("click", () =>
    actions.undoLastFix().catch((e) => toast(String(e.message || e), 5000)));
  $("#btn-restore-checkpoint").addEventListener("click", () =>
    actions.restoreSelectedCheckpoint().catch((e) => toast(String(e.message || e), 5000)));
  $("#fix-plan-dialog").addEventListener("cancel", (event) => {
    if (state.fixApplying) event.preventDefault();
  });
  $("#fix-plan-dialog").addEventListener("close", () => {
    if (!state.fixApplying) state.fixPlan = null;
  });
  $("#checkpoint-dialog").addEventListener("cancel", (event) => {
    if (state.restoringCheckpoint) event.preventDefault();
  });
  $("#checkpoint-dialog").addEventListener("close", () => {
    if (!state.restoringCheckpoint) state.selectedCheckpointId = null;
  });
  $("#btn-recheck").addEventListener("click", () =>
    actions.requestCitationRecheck().catch((e) => toast(String(e.message || e), 5000)));
  $("#btn-external").addEventListener("click", async () => {
    toast("正在运行外部验证（EpubCheck / Ace），可能需要数十秒…", 4000);
    try {
      const results = await actions.runExternal();
      const lines = Object.entries(results).map(([k, v]) => `${k}：${v.detail}`);
      toast(lines.join(" ｜ "), 9000);
    } catch (error) {
      toast(String(error.message || error), 5000);
    }
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
  $("#btn-login").addEventListener("click", () =>
    toggleAccountAuth().catch((error) => toast(String(error.message || error), 5000)));
  $("#btn-login2").addEventListener("click", () =>
    toggleAccountAuth().catch((error) => toast(String(error.message || error), 5000)));
  $("#btn-login-export").addEventListener("click", () =>
    toggleAccountAuth().catch((error) => toast(String(error.message || error), 5000)));
  $$('input[name="ai-mode"]').forEach((input) => input.addEventListener("change", () => {
    $("#ai-byo-fields").classList.toggle("hidden", selectedAiMode() !== "byo");
  }));
  $("#ai-provider-select").addEventListener("change", () =>
    updateAiEndpointInput({ providerChanged: true }));
  $("#btn-save-ai-settings").addEventListener("click", () =>
    saveAiSettings().catch((error) => toast(String(error.message || error), 6000)));
  $("#btn-clear-ai-credential").addEventListener("click", () =>
    clearAiCredential().catch((error) => toast(String(error.message || error), 6000)));
  $("#btn-cancel-ai-request").addEventListener("click", () =>
    actions.cancelAiSuggestion().catch((error) => toast(String(error.message || error), 6000)));
  $("#btn-confirm-ai-request").addEventListener("click", () =>
    actions.confirmAiSuggestion().catch((error) => toast(String(error.message || error), 6000)));
  $("#btn-accept-ai-suggestion").addEventListener("click", () =>
    actions.reviewAiSuggestion("accepted").catch((error) => toast(String(error.message || error), 6000)));
  $("#btn-reject-ai-suggestion").addEventListener("click", () =>
    actions.reviewAiSuggestion("rejected").catch((error) => toast(String(error.message || error), 6000)));
  $("#ai-request-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    actions.cancelAiSuggestion().catch((error) => toast(String(error.message || error), 6000));
  });
  $("#btn-sync-once").addEventListener("click", () =>
    actions.confirmSync("sync_once").catch((error) => toast(String(error.message || error), 5000)));
  $("#btn-sync-ask-each-time").addEventListener("click", () =>
    actions.confirmSync("ask_each_time").catch((error) => toast(String(error.message || error), 5000)));
  $("#btn-sync-not-now").addEventListener("click", () =>
    actions.confirmSync("not_now").catch((error) => toast(String(error.message || error), 5000)));
  $("#btn-sync-never-project").addEventListener("click", () =>
    actions.confirmSync("never_for_project").catch((error) => toast(String(error.message || error), 5000)));
  $("#sync-preview-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!state.syncConfirming && state.syncPreview) {
      actions.confirmSync("not_now").catch((error) => toast(String(error.message || error), 5000));
    }
  });
  $("#btn-install-standards").addEventListener("click", async () => {
    const button = $("#btn-install-standards");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const response = await window.oak.installStandardUpdate();
      if (!response.ok) { toast(response.error, 6000); return; }
      if (response.canceled) { toast("未安装标准更新"); return; }
      toast(`标准包已更新为 ${response.result.active.version}；已有项目尚未改变。`, 5000);
    } catch (error) {
      toast(String(error.message || error), 6000);
    } finally {
      await renderStandardsPage();
    }
  });
  $("#btn-rollback-standards").addEventListener("click", async () => {
    const button = $("#btn-rollback-standards");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const response = await window.oak.rollbackStandardDefault();
      if (!response.ok) { toast(response.error, 6000); return; }
      if (response.canceled) { toast("未切换标准版本"); return; }
      toast(`新建项目的默认标准已切换为 ${response.result.active.version}；已有项目未改变。`, 5000);
    } catch (error) {
      toast(String(error.message || error), 6000);
    } finally {
      await renderStandardsPage();
    }
  });
  $("#btn-project-standard-change").addEventListener("click", () =>
    actions.previewProjectStandardChange().catch((error) =>
      toast(String(error.message || error), 6000)));
  $("#btn-cancel-rulepack-upgrade").addEventListener("click", () =>
    actions.cancelProjectStandardChange());
  $("#btn-confirm-rulepack-upgrade").addEventListener("click", () =>
    actions.confirmProjectStandardChange().catch((error) =>
      toast(String(error.message || error), 7000)));
  $("#rulepack-upgrade-dialog").addEventListener("cancel", (event) => {
    if (state.rulepackUpgradeApplying) event.preventDefault();
  });
  $("#rulepack-upgrade-dialog").addEventListener("close", () => {
    if (!state.rulepackUpgradeApplying) {
      state.rulepackUpgradePlan = null;
      renderProjectStandardStatus().catch((error) => toast(String(error.message || error), 5000));
    }
  });

  $$("#issue-filters button").forEach((b) =>
    b.addEventListener("click", () => {
      state.filter = b.dataset.f;
      $$("#issue-filters button").forEach((x) => x.classList.toggle("active", x === b));
      renderIssues();
    }));

  renderStandardsPage();
  refreshAccountStatus().catch((error) => toast(String(error.message || error), 5000));
});

// 冒烟测试入口（与 UI 按钮走完全相同的代码路径）
window.__oakActions = actions;
window.__oakState = () => actions.getState();
