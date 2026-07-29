"use strict";

const MAX_TASK_LIMIT = 100;
const MAX_OBJECT_LIMIT = 5_000;

function currentDate(clock) {
  const value = clock();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock 必须返回有效时间");
  return date;
}

function validateLimit(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${label} 非法`);
  }
  return value;
}

function failedPhase() {
  return Object.freeze({ status: "failed" });
}

function taskPhase(result, limit) {
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      !Array.isArray(result.deleted) || !Array.isArray(result.pending) ||
      result.deleted.length + result.pending.length > limit) {
    throw new TypeError("任务清扫结果非法");
  }
  return Object.freeze({
    status: "completed",
    deleted_count: result.deleted.length,
    pending_count: result.pending.length,
  });
}

function objectPhase(result, limit) {
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      !Number.isSafeInteger(result.scanned) || result.scanned < 0 || result.scanned > limit ||
      !Array.isArray(result.deleted) || !Array.isArray(result.pending) ||
      !Number.isSafeInteger(result.invalid_keys) || result.invalid_keys < 0 ||
      typeof result.truncated !== "boolean" ||
      result.deleted.length + result.pending.length + result.invalid_keys > result.scanned) {
    throw new TypeError("对象清扫结果非法");
  }
  return Object.freeze({
    status: "completed",
    scanned_count: result.scanned,
    deleted_count: result.deleted.length,
    pending_count: result.pending.length,
    invalid_key_count: result.invalid_keys,
    truncated: result.truncated,
  });
}

function phaseClear(phase) {
  if (phase.status !== "completed" || phase.pending_count !== 0) return false;
  if (Object.hasOwn(phase, "invalid_key_count") &&
      (phase.invalid_key_count !== 0 || phase.truncated)) return false;
  return true;
}

class ZeroRetentionSweeper {
  constructor({
    taskService,
    objectStorage,
    taskLimit = 100,
    objectLimit = 1_000,
    clock = () => new Date(),
    auditSink = () => {},
  } = {}) {
    if (!taskService || typeof taskService.sweepDeletionDue !== "function") {
      throw new TypeError("taskService 未实现 sweepDeletionDue");
    }
    if (!objectStorage || typeof objectStorage.sweepExpiredObjects !== "function") {
      throw new TypeError("objectStorage 未实现 sweepExpiredObjects");
    }
    if (typeof clock !== "function" || typeof auditSink !== "function") {
      throw new TypeError("clock 与 auditSink 必须是函数");
    }
    this.taskService = taskService;
    this.objectStorage = objectStorage;
    this.taskLimit = validateLimit(taskLimit, MAX_TASK_LIMIT, "taskLimit");
    this.objectLimit = validateLimit(objectLimit, MAX_OBJECT_LIMIT, "objectLimit");
    this.clock = clock;
    this.auditSink = auditSink;
  }

  async _runTaskPhase() {
    try {
      return taskPhase(await this.taskService.sweepDeletionDue({ limit: this.taskLimit }),
        this.taskLimit);
    } catch {
      return failedPhase();
    }
  }

  async _runObjectPhase() {
    try {
      return objectPhase(await this.objectStorage.sweepExpiredObjects({
        maxObjects: this.objectLimit,
      }), this.objectLimit);
    } catch {
      return failedPhase();
    }
  }

  async runCycle() {
    const started = currentDate(this.clock);
    const taskBefore = await this._runTaskPhase();
    const objects = await this._runObjectPhase();
    const taskAfter = await this._runTaskPhase();
    const completed = currentDate(this.clock);
    if (completed.getTime() < started.getTime()) throw new TypeError("clock 时间倒退");
    const clear = phaseClear(taskBefore) && phaseClear(objects) && phaseClear(taskAfter);
    const report = Object.freeze({
      schema_version: "1.0",
      report_type: "oak_manuscript_cleanup_cycle",
      started_at: started.toISOString(),
      completed_at: completed.toISOString(),
      status: clear ? "cycle_clear" : "attention_required",
      task_before: taskBefore,
      objects,
      task_after: taskAfter,
      production_zero_retention_verified: false,
    });
    try {
      await this.auditSink(report);
    } catch {
      throw new Error("清理周期审计写入失败");
    }
    return report;
  }
}

module.exports = {
  MAX_OBJECT_LIMIT,
  MAX_TASK_LIMIT,
  ZeroRetentionSweeper,
};
