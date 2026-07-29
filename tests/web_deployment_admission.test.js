"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEPLOYMENT_REQUIREMENTS_SHA256,
  assessWebDeploymentProfile,
  getWebDeploymentRequirements,
} = require("../web/deployment-admission");

function capableProfile(overrides = {}) {
  const profile = {
    schema_version: "1.0",
    profile_type: "oak_manuscript_web_platform_profile",
    profile_id: "compatible-test-platform",
    public_http: {
      max_buffered_request_bytes: 50 * 1024 * 1024,
      max_buffered_response_bytes: 100 * 1024 * 1024,
      max_execution_ms: 4 * 60 * 1000,
      supports_same_origin_https: true,
    },
    private_execution: {
      max_execution_ms: 4 * 60 * 1000,
      supports_child_process: true,
      supports_absolute_executable: true,
      supports_writable_private_scratch: true,
      supports_os_network_deny: true,
      supports_read_only_application: true,
    },
    object_storage: {
      supports_strong_consistency: true,
      supports_conditional_create: true,
      supports_metadata: true,
      supports_paginated_prefix_list: true,
      supports_delete_confirmation: true,
    },
    database: {
      supports_transactions: true,
      supports_advisory_locks: true,
      supports_row_level_security: true,
      supports_service_role_rpc: true,
    },
    operations: {
      supports_private_worker_scheduler: true,
      supports_cleanup_scheduler: true,
      supports_retry_alerting: true,
      supports_secret_injection: true,
    },
  };
  return {
    ...profile,
    ...overrides,
    public_http: { ...profile.public_http, ...(overrides.public_http || {}) },
    private_execution: { ...profile.private_execution, ...(overrides.private_execution || {}) },
    object_storage: { ...profile.object_storage, ...(overrides.object_storage || {}) },
    database: { ...profile.database, ...(overrides.database || {}) },
    operations: { ...profile.operations, ...(overrides.operations || {}) },
  };
}

test("deployment requirements are bound to current manuscript and processor limits", () => {
  const requirements = getWebDeploymentRequirements();
  assert.deepEqual(requirements.public_http, {
    min_buffered_request_bytes: 50 * 1024 * 1024,
    min_buffered_response_bytes: 100 * 1024 * 1024,
    min_execution_ms: 4 * 60 * 1000,
    requires_same_origin_https: true,
  });
  assert.equal(requirements.private_execution.min_execution_ms, 4 * 60 * 1000);
  assert.match(DEPLOYMENT_REQUIREMENTS_SHA256, /^[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(requirements), true);
  assert.equal(Object.isFrozen(requirements.public_http), true);
});

test("a declared capable profile passes capability admission without becoming production proof", () => {
  const report = assessWebDeploymentProfile(capableProfile());
  assert.deepEqual(report, {
    schema_version: "1.0",
    report_type: "oak_manuscript_web_deployment_admission",
    profile_id: "compatible-test-platform",
    requirements_sha256: DEPLOYMENT_REQUIREMENTS_SHA256,
    declared_capabilities_satisfied: true,
    production_evidence_verified: false,
    production_ready: false,
    violations: [],
  });
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.violations), true);
});

test("undersized public limits and missing isolation are rejected with stable content-free codes", () => {
  const profile = capableProfile({
    profile_id: "undersized-test-platform",
    public_http: {
      max_buffered_request_bytes: 6 * 1024 * 1024,
      max_buffered_response_bytes: 20 * 1024 * 1024,
      max_execution_ms: 60 * 1000,
    },
    private_execution: {
      supports_os_network_deny: false,
      supports_read_only_application: false,
    },
  });
  const report = assessWebDeploymentProfile(profile);
  assert.equal(report.declared_capabilities_satisfied, false);
  assert.equal(report.production_ready, false);
  assert.deepEqual(report.violations, [
    "PUBLIC_REQUEST_BYTES_INSUFFICIENT",
    "PUBLIC_RESPONSE_BYTES_INSUFFICIENT",
    "PUBLIC_EXECUTION_WINDOW_INSUFFICIENT",
    "OS_NETWORK_DENY_UNSUPPORTED",
    "READ_ONLY_APPLICATION_UNSUPPORTED",
  ]);
  assert.equal(JSON.stringify(report).includes("6 * 1024"), false);
});

test("storage, database, scheduler, and secret gaps all fail closed", () => {
  const report = assessWebDeploymentProfile(capableProfile({
    object_storage: {
      supports_strong_consistency: false,
      supports_conditional_create: false,
      supports_delete_confirmation: false,
    },
    database: {
      supports_transactions: false,
      supports_row_level_security: false,
    },
    operations: {
      supports_private_worker_scheduler: false,
      supports_cleanup_scheduler: false,
      supports_retry_alerting: false,
      supports_secret_injection: false,
    },
  }));
  assert.deepEqual(report.violations, [
    "STRONG_CONSISTENCY_UNSUPPORTED",
    "CONDITIONAL_CREATE_UNSUPPORTED",
    "DELETE_CONFIRMATION_UNSUPPORTED",
    "TRANSACTIONS_UNSUPPORTED",
    "RLS_UNSUPPORTED",
    "PRIVATE_WORKER_SCHEDULER_UNSUPPORTED",
    "CLEANUP_SCHEDULER_UNSUPPORTED",
    "RETRY_ALERTING_UNSUPPORTED",
    "SECRET_INJECTION_UNSUPPORTED",
  ]);
});

test("profile schema is exact and rejects invented or unverified values", () => {
  assert.throws(() => assessWebDeploymentProfile({
    ...capableProfile(),
    production_ready: true,
  }), /字段集合/);
  assert.throws(() => assessWebDeploymentProfile(capableProfile({
    public_http: { max_execution_ms: "240000" },
  })), /max_execution_ms/);
  assert.throws(() => assessWebDeploymentProfile(capableProfile({
    private_execution: { supports_os_network_deny: "unknown" },
  })), /supports_os_network_deny/);
  assert.throws(() => assessWebDeploymentProfile(capableProfile({
    profile_id: "contains secret token",
  })), /profile_id/);
});
