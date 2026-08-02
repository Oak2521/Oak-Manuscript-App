"use strict";

const STANDARD_STATUSES = Object.freeze([
  "active",
  "under_review",
  "superseded",
  "deprecated",
]);
const SOURCE_TYPES = Object.freeze([
  "official",
  "technical_spec",
  "oak_interpretation",
]);
const SOURCE_VERIFICATION_STATUSES = Object.freeze([
  "verified",
  "pending",
  "unavailable",
]);

class StandardsGovernanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "StandardsGovernanceError";
    this.code = "INVALID_STANDARDS_GOVERNANCE_INPUT";
  }
}

function fail(message) {
  throw new StandardsGovernanceError(message);
}

function counter(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function summarizeStandardsGovernance(standards) {
  if (!Array.isArray(standards) || standards.length === 0) {
    fail("标准治理摘要需要至少一个标准条目");
  }

  const seenIds = new Set();
  const statusCounts = counter(STANDARD_STATUSES);
  const sourceTypeCounts = counter(SOURCE_TYPES);
  const sourceVerificationCounts = counter(SOURCE_VERIFICATION_STATUSES);
  const externalSourceCounts = {
    total: 0,
    verified: 0,
    pending: 0,
    unavailable: 0,
  };

  for (const [index, standard] of standards.entries()) {
    if (!standard || typeof standard !== "object" || Array.isArray(standard)) {
      fail(`标准条目 ${index + 1} 非法`);
    }
    const id = standard.standard_id;
    if (typeof id !== "string" || id.length === 0 || id.length > 128 || id.trim() !== id) {
      fail(`标准条目 ${index + 1} 缺少合法 standard_id`);
    }
    if (seenIds.has(id)) fail(`标准条目 ${id} 重复`);
    seenIds.add(id);

    if (!STANDARD_STATUSES.includes(standard.status)) {
      fail(`标准条目 ${id} status 非法`);
    }
    if (!SOURCE_TYPES.includes(standard.source_type)) {
      fail(`标准条目 ${id} source_type 非法`);
    }
    if (!SOURCE_VERIFICATION_STATUSES.includes(standard.source_verification_status)) {
      fail(`标准条目 ${id} source_verification_status 非法`);
    }

    statusCounts[standard.status] += 1;
    sourceTypeCounts[standard.source_type] += 1;
    sourceVerificationCounts[standard.source_verification_status] += 1;
    if (standard.source_type === "official" || standard.source_type === "technical_spec") {
      externalSourceCounts.total += 1;
      externalSourceCounts[standard.source_verification_status] += 1;
    }
  }

  const governanceGateSatisfied = statusCounts.under_review === 0 &&
    sourceVerificationCounts.pending === 0 &&
    sourceVerificationCounts.unavailable === 0;

  return deepFreeze({
    schema_version: "1.0",
    kind: "oak-standards-governance-summary",
    total_standards: standards.length,
    status_counts: statusCounts,
    source_type_counts: sourceTypeCounts,
    source_verification_counts: sourceVerificationCounts,
    external_source_counts: externalSourceCounts,
    governance_gate_satisfied: governanceGateSatisfied,
  });
}

module.exports = {
  SOURCE_TYPES,
  SOURCE_VERIFICATION_STATUSES,
  STANDARD_STATUSES,
  StandardsGovernanceError,
  summarizeStandardsGovernance,
};
