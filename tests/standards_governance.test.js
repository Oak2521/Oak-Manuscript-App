"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const {
  StandardsGovernanceError,
  summarizeStandardsGovernance,
} = require("../electron/standards-governance");

test("bundled standards expose an exact content-free governance summary", () => {
  const registry = JSON.parse(fs.readFileSync(
    path.join(ROOT, "config", "standards.json"),
    "utf8",
  ));

  const summary = summarizeStandardsGovernance(registry.standards);

  assert.deepEqual(summary, {
    schema_version: "1.0",
    kind: "oak-standards-governance-summary",
    total_standards: 13,
    status_counts: {
      active: 9,
      under_review: 4,
      superseded: 0,
      deprecated: 0,
    },
    source_type_counts: {
      official: 3,
      technical_spec: 1,
      oak_interpretation: 9,
    },
    source_verification_counts: {
      verified: 0,
      pending: 12,
      unavailable: 1,
    },
    external_source_counts: {
      total: 4,
      verified: 0,
      pending: 3,
      unavailable: 1,
    },
    governance_gate_satisfied: false,
  });
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.status_counts), true);
  assert.equal(Object.isFrozen(summary.source_verification_counts), true);
});

test("governance gate requires reviewed status and verified sources together", () => {
  const standards = [
    {
      standard_id: "OFFICIAL-1",
      source_type: "official",
      status: "active",
      source_verification_status: "verified",
    },
    {
      standard_id: "OAK-1",
      source_type: "oak_interpretation",
      status: "active",
      source_verification_status: "verified",
    },
  ];

  assert.equal(summarizeStandardsGovernance(standards).governance_gate_satisfied, true);
  standards[1].status = "under_review";
  assert.equal(summarizeStandardsGovernance(standards).governance_gate_satisfied, false);
});

test("governance summary rejects malformed or ambiguous standard records", () => {
  const valid = {
    standard_id: "OAK-1",
    source_type: "oak_interpretation",
    status: "active",
    source_verification_status: "pending",
  };

  for (const standards of [
    [],
    [null],
    [{ ...valid, standard_id: "" }],
    [valid, { ...valid }],
    [{ ...valid, source_type: "community" }],
    [{ ...valid, status: "approved" }],
    [{ ...valid, source_verification_status: "unknown" }],
  ]) {
    assert.throws(
      () => summarizeStandardsGovernance(standards),
      (error) => error instanceof StandardsGovernanceError &&
        error.code === "INVALID_STANDARDS_GOVERNANCE_INPUT",
    );
  }
});
