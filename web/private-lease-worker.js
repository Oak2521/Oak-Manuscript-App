"use strict";

const { createHash } = require("node:crypto");

const PROCESS_REQUEST_KEYS = Object.freeze(["schema_version", "request_type", "document", "bytes"]);
const PROCESS_RESULT_KEYS = Object.freeze(["bytes", "media_type"]);
const OUTCOME_KEYS = Object.freeze(["schema_version", "outcome_type", "claimed", "outcome"]);
const RESULT_MEDIA_TYPES = new Set([
  "application/json", "application/pdf", "application/epub+zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown", "text/plain",
]);

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}必须是对象`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label}字段集合非法`);
  }
  return value;
}

function outcome(claimed, value) {
  const result = Object.freeze({
    schema_version: "1.0",
    outcome_type: "oak_manuscript_private_worker_outcome",
    claimed,
    outcome: value,
  });
  exactObject(result, OUTCOME_KEYS, "worker 结果");
  return result;
}

class PrivateLeaseWorker {
  constructor({ service, processor } = {}) {
    if (!service || ["claimNextProcessing", "completeClaim", "abandonClaim"]
      .some((name) => typeof service[name] !== "function")) {
      throw new TypeError("service 未实现完整私有租约接口");
    }
    if (!processor || processor.execution_boundary !== "isolated_process" ||
        typeof processor.execute !== "function" ||
        !Number.isSafeInteger(processor.max_execution_ms) || processor.max_execution_ms < 100 ||
        !Number.isSafeInteger(service.leaseTtlMs) ||
        !Number.isSafeInteger(service.maxResultBytes) || service.maxResultBytes < 1 ||
        processor.max_execution_ms > service.leaseTtlMs - 5_000) {
      throw new TypeError("processor 必须声明并实现 isolated_process 边界");
    }
    this.service = service;
    this.processor = processor;
  }

  async runOnce() {
    const workItem = await this.service.claimNextProcessing();
    if (workItem === null) return outcome(false, "idle");

    const request = Object.freeze({
      schema_version: "1.0",
      request_type: "oak_manuscript_isolated_processing_request",
      document: Object.freeze({ ...workItem.document }),
      bytes: workItem.bytes,
    });
    exactObject(request, PROCESS_REQUEST_KEYS, "processor 请求");
    const inputDigest = createHash("sha256").update(request.bytes).digest("hex");

    let result;
    try {
      result = await this.processor.execute(request);
    } catch {
      this.service.abandonClaim(workItem, "processor_failed");
      return outcome(true, "retry_after_lease");
    }
    if (createHash("sha256").update(request.bytes).digest("hex") !== inputDigest) {
      this.service.abandonClaim(workItem, "processor_output_invalid");
      return outcome(true, "retry_after_lease");
    }
    try {
      exactObject(result, PROCESS_RESULT_KEYS, "processor 结果");
      if (!Buffer.isBuffer(result.bytes) || result.bytes.length < 1 ||
          result.bytes.length > this.service.maxResultBytes ||
          !RESULT_MEDIA_TYPES.has(result.media_type)) {
        throw new TypeError("processor 结果类型非法");
      }
    } catch {
      this.service.abandonClaim(workItem, "processor_output_invalid");
      return outcome(true, "retry_after_lease");
    }

    await this.service.completeClaim(workItem, {
      bytes: result.bytes,
      media_type: result.media_type,
    });
    return outcome(true, "completed");
  }
}

module.exports = {
  PrivateLeaseWorker,
};
