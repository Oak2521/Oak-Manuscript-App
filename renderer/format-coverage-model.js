// TXT/Markdown 覆盖披露的纯展示模型；只接受 content-free 固定合同。

"use strict";

(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OakFormatCoverage = api;
})(typeof globalThis === "undefined" ? null : globalThis, () => {
  const FIELDS = Object.freeze([
    "schema_version", "format", "status", "rule_ids", "auto_fixable_rule_ids",
    "excluded_contexts", "not_checked", "disclosure",
  ]);
  const FORMAT_LABELS = Object.freeze({ md: "Markdown", txt: "TXT" });
  const EXCLUDED_LABELS = Object.freeze({
    fenced_code: "围栏代码块",
    inline_code: "行内代码",
    table: "Markdown 表格",
    hard_break: "行末双空格换行",
    layout_sensitive: "保守识别的排版敏感文本",
  });
  const NOT_CHECKED_LABELS = Object.freeze({
    semantic_rewriting: "语义改写与语言润色",
    full_markdown_conformance: "完整 Markdown 语法合规",
    layout_reconstruction: "版式还原",
    external_standard_completeness: "外部标准完整合规",
  });
  const RULE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

  function exactObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("格式覆盖记录必须是对象");
    }
    const actual = Object.keys(value).sort();
    const expected = [...FIELDS].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new Error("格式覆盖记录字段集合非法");
    }
  }

  function list(value, label, { pattern = null, labels = null } = {}) {
    if (!Array.isArray(value) || value.length > 256 || new Set(value).size !== value.length) {
      throw new Error(`格式覆盖记录 ${label} 非法`);
    }
    for (const item of value) {
      if (typeof item !== "string" || item.length < 1 || item.length > 128 ||
          (pattern && !pattern.test(item)) || (labels && !Object.hasOwn(labels, item))) {
        throw new Error(`格式覆盖记录 ${label} 非法`);
      }
    }
    return [...value];
  }

  function normalizeFormatCoverage(value) {
    exactObject(value);
    if (value.schema_version !== "1.0" || !Object.hasOwn(FORMAT_LABELS, value.format) ||
        value.status !== "limited") {
      throw new Error("格式覆盖记录身份非法");
    }
    const rules = list(value.rule_ids, "rule_ids", { pattern: RULE_ID });
    const auto = list(value.auto_fixable_rule_ids, "auto_fixable_rule_ids", { pattern: RULE_ID });
    if (auto.some((ruleId) => !rules.includes(ruleId))) {
      throw new Error("格式覆盖记录 auto_fixable_rule_ids 非法");
    }
    const excluded = list(value.excluded_contexts, "excluded_contexts", { labels: EXCLUDED_LABELS });
    const notChecked = list(value.not_checked, "not_checked", { labels: NOT_CHECKED_LABELS });
    if (typeof value.disclosure !== "string" || value.disclosure.length < 1 ||
        value.disclosure.length > 512 || /[\0\r\n]/.test(value.disclosure)) {
      throw new Error("格式覆盖记录 disclosure 非法");
    }
    return Object.freeze({
      formatLabel: FORMAT_LABELS[value.format],
      statusLabel: "有限覆盖",
      ruleCount: rules.length,
      rulesLabel: rules.join("、") || "（无）",
      autoFixLabel: auto.length ? auto.join("、") : "本格式没有自动修复规则",
      excludedLabel: excluded.map((item) => EXCLUDED_LABELS[item]).join("、") || "（无）",
      notCheckedLabel: notChecked.map((item) => NOT_CHECKED_LABELS[item]).join("、") || "（无）",
      summary: value.disclosure,
    });
  }

  return Object.freeze({ normalizeFormatCoverage });
});
