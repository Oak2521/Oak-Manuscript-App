"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeFixPlan,
  normalizeCheckpoints,
  latestBatchCheckpoint,
} = require("../renderer/p0-ui-model");

test("fix plan requires every candidate to have a visible before/after row", () => {
  const plan = normalizeFixPlan({
    plan_id: "plan-0001",
    candidate_count: 2,
    items: [
      {
        issue_id: "issue-1",
        title: "删除连续空格",
        location: { paragraph: 3 },
        before_preview: "湖岸  稿件",
        after_preview: "湖岸 稿件",
      },
      {
        issue_id: "issue-2",
        title: "删除重复标点",
        location: "正文第 7 段",
        before_preview: "完成。。",
        after_preview: "完成。",
      },
    ],
  });

  assert.equal(plan.count, 2);
  assert.equal(plan.items[0].location, "正文第 3 段");
  assert.equal(plan.items[1].afterPreview, "完成。");
});

test("fix plan rejects a count mismatch so hidden fixes cannot be applied", () => {
  assert.throws(
    () => normalizeFixPlan({
      plan_id: "plan-0001",
      candidate_count: 2,
      items: [{
        issue_id: "issue-1",
        title: "删除连续空格",
        location: "正文第 3 段",
        before_preview: "A  B",
        after_preview: "A B",
      }],
    }),
    /数量与预览条目不一致/,
  );
});

test("checkpoint list is newest first and undo selects the latest batch checkpoint", () => {
  const checkpoints = normalizeCheckpoints({ checkpoints: [
    { checkpoint_id: "cp-0001", created_at: "2026-07-26T10:00:00Z", reason: "manual" },
    { checkpoint_id: "cp-0002", created_at: "2026-07-26T11:00:00Z", reason: "before_fix" },
    { checkpoint_id: "cp-0003", created_at: "2026-07-26T12:00:00Z", reason: "before_batch_fix" },
  ] });

  assert.deepEqual(checkpoints.map((cp) => cp.checkpointId), ["cp-0003", "cp-0002", "cp-0001"]);
  assert.equal(latestBatchCheckpoint(checkpoints).checkpointId, "cp-0003");
});

test("checkpoint metadata accepts core issue_count and labels restore safety checkpoints", () => {
  const checkpoints = normalizeCheckpoints({ checkpoints: [
    {
      checkpoint_id: "cp-0004",
      created_at: "2026-07-26T13:00:00Z",
      reason: "before_restore:cp-0001",
      issue_count: 7,
    },
  ] });

  assert.equal(checkpoints[0].itemCount, 7);
  assert.equal(checkpoints[0].label, "恢复前安全检查点");
  assert.equal(checkpoints[0].reason, "before_restore:cp-0001");
  assert.equal(latestBatchCheckpoint(checkpoints), null);
});

test("unrestorable checkpoint metadata is preserved and cannot become the undo target", () => {
  const checkpoints = normalizeCheckpoints({ checkpoints: [
    {
      checkpoint_id: "cp-broken-newest",
      created_at: "2026-07-26T15:00:00Z",
      reason: "before_batch_fix",
      can_restore: false,
      validation_errors: ["working.docx 哈希与检查点记录不一致", "issues.json 缺失"],
    },
    {
      checkpoint_id: "cp-valid-older",
      created_at: "2026-07-26T14:00:00Z",
      reason: "before_fix",
      can_restore: true,
      validation_errors: [],
    },
  ] });

  assert.equal(checkpoints[0].canRestore, false);
  assert.deepEqual(checkpoints[0].validationErrors, [
    "working.docx 哈希与检查点记录不一致",
    "issues.json 缺失",
  ]);
  assert.equal(latestBatchCheckpoint(checkpoints).checkpointId, "cp-valid-older");
  assert.equal(latestBatchCheckpoint([checkpoints[0]]), null);
});
