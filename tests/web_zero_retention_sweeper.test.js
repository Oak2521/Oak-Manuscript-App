"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { ZeroRetentionSweeper } = require("../web/zero-retention-sweeper");

function harness({ taskResults, objectResult, taskLimit = 25, objectLimit = 50 } = {}) {
  const order = [];
  const audits = [];
  const tasks = [...(taskResults || [
    { deleted: [], pending: [] },
    { deleted: [], pending: [] },
  ])];
  const taskService = {
    async sweepDeletionDue(options) {
      order.push(["task", options]);
      const value = tasks.shift();
      if (value instanceof Error) throw value;
      return value;
    },
  };
  const objectStorage = {
    async sweepExpiredObjects(options) {
      order.push(["objects", options]);
      if (objectResult instanceof Error) throw objectResult;
      return objectResult || {
        scanned: 0, deleted: [], pending: [], invalid_keys: 0, truncated: false,
      };
    },
  };
  let clockCall = 0;
  const sweeper = new ZeroRetentionSweeper({
    taskService,
    objectStorage,
    taskLimit,
    objectLimit,
    clock: () => new Date(clockCall++ === 0 ?
      "2026-07-28T12:00:00.000Z" : "2026-07-28T12:00:01.000Z"),
    auditSink: async (report) => { audits.push(report); },
  });
  return { sweeper, order, audits };
}

test("cleanup cycle runs task-object-task and emits only count-level local evidence", async () => {
  const secretJob = "webjob-10000000-0000-4000-8000-000000000001";
  const { sweeper, order, audits } = harness({
    taskResults: [
      { deleted: [{ job_id: secretJob }], pending: [] },
      { deleted: [], pending: [] },
    ],
    objectResult: {
      scanned: 2,
      deleted: [{ job_id: secretJob, object_type: "input" }],
      pending: [],
      invalid_keys: 0,
      truncated: false,
    },
  });
  const report = await sweeper.runCycle();

  assert.deepEqual(order, [
    ["task", { limit: 25 }],
    ["objects", { maxObjects: 50 }],
    ["task", { limit: 25 }],
  ]);
  assert.equal(report.status, "cycle_clear");
  assert.equal(report.task_before.deleted_count, 1);
  assert.equal(report.objects.deleted_count, 1);
  assert.equal(report.production_zero_retention_verified, false);
  assert.equal(JSON.stringify(report).includes(secretJob), false);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.objects), true);
  assert.deepEqual(audits, [report]);
});

test("phase failures, pending objects, invalid keys, and truncation require attention without leaks", async () => {
  const secret = "secret-object-key-and-upstream-details";
  const { sweeper, order } = harness({
    taskResults: [new Error(secret), { deleted: [], pending: [{ job_id: secret }] }],
    objectResult: {
      scanned: 3,
      deleted: [],
      pending: [{ reason: secret }],
      invalid_keys: 1,
      truncated: true,
    },
  });
  const report = await sweeper.runCycle();

  assert.equal(order.length, 3);
  assert.deepEqual(report.task_before, { status: "failed" });
  assert.equal(report.objects.pending_count, 1);
  assert.equal(report.objects.invalid_key_count, 1);
  assert.equal(report.objects.truncated, true);
  assert.equal(report.task_after.pending_count, 1);
  assert.equal(report.status, "attention_required");
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("object sweep failure does not suppress the second task cleanup pass", async () => {
  const { sweeper, order } = harness({ objectResult: new Error("private storage error") });
  const report = await sweeper.runCycle();
  assert.deepEqual(order.map(([phase]) => phase), ["task", "objects", "task"]);
  assert.deepEqual(report.objects, { status: "failed" });
  assert.equal(report.task_after.status, "completed");
  assert.equal(report.status, "attention_required");
});

test("malformed phase results fail closed in the report while later phases still run", async () => {
  const { sweeper, order } = harness({
    taskResults: [{ deleted: "not-an-array", pending: [] }, { deleted: [], pending: [] }],
    objectResult: {
      scanned: 1, deleted: [], pending: [], invalid_keys: 2, truncated: false,
    },
  });
  const report = await sweeper.runCycle();
  assert.equal(order.length, 3);
  assert.equal(report.task_before.status, "failed");
  assert.equal(report.objects.status, "failed");
  assert.equal(report.task_after.status, "completed");
  assert.equal(report.status, "attention_required");
});

test("dependencies, limits, clock, and audit evidence fail closed", async () => {
  assert.throws(() => new ZeroRetentionSweeper(), /taskService/);
  const dependencies = {
    taskService: { sweepDeletionDue: async () => ({ deleted: [], pending: [] }) },
    objectStorage: { sweepExpiredObjects: async () => ({
      scanned: 0, deleted: [], pending: [], invalid_keys: 0, truncated: false,
    }) },
  };
  assert.throws(() => new ZeroRetentionSweeper({ ...dependencies, taskLimit: 0 }), /taskLimit/);
  assert.throws(() => new ZeroRetentionSweeper({ ...dependencies, objectLimit: 5_001 }), /objectLimit/);
  await assert.rejects(new ZeroRetentionSweeper({
    ...dependencies,
    clock: () => new Date("invalid"),
  }).runCycle(), /clock/);
  await assert.rejects(new ZeroRetentionSweeper({
    ...dependencies,
    auditSink: async () => { throw new Error("secret audit failure"); },
  }).runCycle(), (error) => error.message === "清理周期审计写入失败" &&
    !error.message.includes("secret"));
});
