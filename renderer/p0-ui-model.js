// P0 UI 数据边界：修复计划必须逐项可见；检查点按时间倒序。

"use strict";

(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OakP0Ui = api;
})(typeof globalThis === "undefined" ? null : globalThis, () => {
  function requireText(value, name) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`修复计划缺少 ${name}`);
    return value;
  }

  function previewText(value, name) {
    if (typeof value !== "string") throw new Error(`修复计划缺少 ${name}`);
    return value || "（无）";
  }

  function formatLocation(location) {
    if (typeof location === "string" && location.trim()) return location;
    const loc = location && typeof location === "object" ? location : {};
    if (loc.resource) return String(loc.resource);
    if (loc.part === "footnotes") return `脚注 ${loc.note_id || ""}`.trim();
    if (loc.paragraph !== null && loc.paragraph !== undefined) return `正文第 ${loc.paragraph} 段`;
    return "文档";
  }

  function normalizeFixPlan(raw) {
    const data = raw && raw.result ? raw.result : raw;
    if (!data || typeof data !== "object") throw new Error("修复计划格式非法");
    const planId = requireText(data.plan_id, "plan_id");
    if (!Array.isArray(data.items)) throw new Error("修复计划缺少 items");
    const declared = data.candidate_count;
    if (!Number.isInteger(declared) || declared < 0) throw new Error("修复计划候选数量非法");
    if (declared !== data.items.length) throw new Error("修复计划数量与预览条目不一致，已拒绝应用");

    const items = data.items.map((item) => ({
      issueId: requireText(item.issue_id, "issue_id"),
      title: requireText(item.title, "title"),
      location: formatLocation(item.location),
      beforePreview: previewText(item.before_preview, "before_preview"),
      afterPreview: previewText(item.after_preview, "after_preview"),
    }));
    return { planId, count: items.length, items };
  }

  function normalizeCheckpoints(raw) {
    const data = raw && raw.result ? raw.result : raw;
    if (!data || !Array.isArray(data.checkpoints)) throw new Error("检查点列表格式非法");
    return data.checkpoints.map((cp) => {
      const reason = typeof cp.reason === "string" ? cp.reason : "";
      const explicitLabel = typeof cp.label === "string" ? cp.label : "";
      const safetyRestore = reason === "before_restore" || reason.startsWith("before_restore:");
      const itemCount = Number.isInteger(cp.item_count)
        ? cp.item_count
        : Number.isInteger(cp.issue_count) ? cp.issue_count : null;
      const validationErrors = Array.isArray(cp.validation_errors)
        ? cp.validation_errors.map((error) => String(error).trim()).filter(Boolean)
        : [];
      return {
        checkpointId: requireText(cp.checkpoint_id, "checkpoint_id"),
        createdAt: typeof cp.created_at === "string" ? cp.created_at : "",
        reason,
        label: explicitLabel || (safetyRestore ? "恢复前安全检查点" : ""),
        itemCount,
        // 兼容尚未返回该字段的旧版本；核心显式标记 false 时必须禁止恢复。
        canRestore: cp.can_restore !== false,
        validationErrors,
      };
    }).sort((a, b) => {
      const byTime = b.createdAt.localeCompare(a.createdAt);
      return byTime || b.checkpointId.localeCompare(a.checkpointId);
    });
  }

  function latestBatchCheckpoint(checkpoints) {
    return checkpoints.find((cp) => cp.canRestore === true &&
      (cp.reason === "before_batch_fix" || cp.reason === "before_fix")) || null;
  }

  return Object.freeze({ normalizeFixPlan, normalizeCheckpoints, latestBatchCheckpoint, formatLocation });
});
