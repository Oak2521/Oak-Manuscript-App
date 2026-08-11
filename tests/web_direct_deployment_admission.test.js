"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DIRECT_DEPLOYMENT_REQUIREMENTS_SHA256,
  assessDirectWebDeploymentProfile,
  getDirectWebDeploymentRequirements,
} = require("../web/deployment-admission-v2");

function capableProfile(overrides = {}) {
  const profile = {
    schema_version: "2.0",
    profile_type: "oak_manuscript_web_direct_platform_profile",
    profile_id: "compatible-direct-test-platform",
    public_http: {
      max_control_request_bytes: 64 * 1024,
      max_control_response_bytes: 64 * 1024,
      max_execution_ms: 60 * 1000,
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
      max_object_bytes: 100 * 1024 * 1024,
      supports_private_bucket: true,
      supports_presigned_put: true,
      supports_presigned_get: true,
      supports_presigned_expiry_control: true,
      supports_exact_origin_cors: true,
      supports_strong_consistency: true,
      supports_conditional_create: true,
      supports_source_etag_copy: true,
      supports_metadata: true,
      supports_head: true,
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

test("direct requirements bind the small control plane and full object size", () => {
  const value = getDirectWebDeploymentRequirements();
  assert.equal(value.public_http.min_control_request_bytes, 64 * 1024);
  assert.equal(value.public_http.min_control_response_bytes, 64 * 1024);
  assert.equal(value.private_execution.min_execution_ms, 4 * 60 * 1000);
  assert.equal(value.object_storage.min_object_bytes, 100 * 1024 * 1024);
  assert.match(DIRECT_DEPLOYMENT_REQUIREMENTS_SHA256, /^[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(value.object_storage), true);
});

test("capable direct declarations pass without becoming production proof", () => {
  const report = assessDirectWebDeploymentProfile(capableProfile());
  assert.deepEqual(report, {
    schema_version: "2.0",
    report_type: "oak_manuscript_web_direct_deployment_admission",
    profile_id: "compatible-direct-test-platform",
    requirements_sha256: DIRECT_DEPLOYMENT_REQUIREMENTS_SHA256,
    declared_capabilities_satisfied: true,
    production_evidence_verified: false,
    production_ready: false,
    violations: [],
  });
});

test("direct profile rejects undersized controls and transfer/storage gaps", () => {
  const report = assessDirectWebDeploymentProfile(capableProfile({
    public_http: {
      max_control_request_bytes: 1024,
      max_control_response_bytes: 2048,
      max_execution_ms: 5000,
    },
    object_storage: {
      max_object_bytes: 50 * 1024 * 1024,
      supports_presigned_expiry_control: false,
      supports_exact_origin_cors: false,
      supports_source_etag_copy: false,
    },
  }));
  assert.deepEqual(report.violations, [
    "CONTROL_REQUEST_BYTES_INSUFFICIENT",
    "CONTROL_RESPONSE_BYTES_INSUFFICIENT",
    "CONTROL_EXECUTION_WINDOW_INSUFFICIENT",
    "OBJECT_BYTES_INSUFFICIENT",
    "PRESIGNED_EXPIRY_CONTROL_UNSUPPORTED",
    "EXACT_ORIGIN_CORS_UNSUPPORTED",
    "SOURCE_ETAG_COPY_UNSUPPORTED",
  ]);
  assert.equal(report.production_ready, false);
});

test("direct profile schema rejects extra and unverified values", () => {
  assert.throws(() => assessDirectWebDeploymentProfile({
    ...capableProfile(), production_ready: true,
  }), /字段集合/);
  assert.throws(() => assessDirectWebDeploymentProfile(capableProfile({
    private_execution: { supports_os_network_deny: "unverified" },
  })), /supports_os_network_deny/);
});
