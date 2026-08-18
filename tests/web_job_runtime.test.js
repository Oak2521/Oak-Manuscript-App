"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const {
  MIGRATION_MANIFEST_SHA256,
  createWebJobProductionRuntime,
} = require("../web/web-job-runtime");
const {
  DIRECT_DEPLOYMENT_REQUIREMENTS_SHA256,
} = require("../web/deployment-admission-v2");
const { createOakAccountTokenFixture } = require("./fixtures/oak-account-token");

const SERVICE_KEY = "service-role-key-0000000000001";
const S3_ACCESS_KEY = "test-s3-access-key-id";
const S3_SECRET_KEY = "test-s3-secret-access-key-value";
const UUID = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-10T20:00:00.000Z");
const ACCOUNT_AUTH = createOakAccountTokenFixture({ oakAccountId: UUID, now: NOW });

function deploymentProfile(overrides = {}) {
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

function configuration(overrides = {}) {
  return {
    schema_version: "2.0",
    api_origin: "https://app.example.test",
    account_issuer: ACCOUNT_AUTH.issuer,
    account_audience: ACCOUNT_AUTH.audience,
    account_trusted_keys: ACCOUNT_AUTH.trustedKeys,
    supabase_origin: "https://project.supabase.test",
    supabase_service_role_key: SERVICE_KEY,
    python_executable: process.execPath,
    python_core_dir: path.resolve(__dirname, "..", "python"),
    scratch_root: path.resolve(os.tmpdir()),
    s3_endpoint: "https://project-ref.storage.supabase.co/storage/v1/s3",
    s3_region: "ca-central-1",
    s3_bucket: "oak-manuscript-private",
    s3_prefix: "oak-manuscript/jobs/v2",
    s3_access_key_id: S3_ACCESS_KEY,
    s3_secret_access_key: S3_SECRET_KEY,
    direct_credential_ttl_seconds: 120,
    expected_migration_manifest_sha256: MIGRATION_MANIFEST_SHA256,
    expected_deployment_requirements_sha256: DIRECT_DEPLOYMENT_REQUIREMENTS_SHA256,
    deployment_profile: deploymentProfile(),
    ...overrides,
  };
}

function adapters(state, overrides = {}) {
  return {
    fetch_impl: async () => {
      state.fetches += 1;
      throw new Error("unexpected network");
    },
    spawn_impl: () => { throw new Error("unexpected process"); },
    security_event_sink: (event) => state.security.push(event),
    job_audit_sink: (event) => state.jobs.push(event),
    cleanup_audit_sink: async (event) => state.cleanup.push(event),
    clock: () => NOW,
    request_id_factory: () => UUID,
    uuid_factory: () => UUID,
    ...overrides,
  };
}

function state() {
  return { fetches: 0, security: [], jobs: [], cleanup: [] };
}

test("production Web job runtime composes v2 direct control plane without startup network", async () => {
  const observed = state();
  const runtime = createWebJobProductionRuntime({
    configuration: configuration(),
    adapters: adapters(observed),
  });

  assert.deepEqual(runtime.readiness, {
    schema_version: "2.0",
    runtime_type: "oak_manuscript_web_job_runtime",
    data_plane: "direct_object",
    configuration_validated: true,
    public_handler_enabled: true,
    private_worker_enabled: true,
    cleanup_scheduler_required: true,
    migration_manifest_sha256: MIGRATION_MANIFEST_SHA256,
    deployment_requirements_sha256: DIRECT_DEPLOYMENT_REQUIREMENTS_SHA256,
    declared_deployment_capabilities_satisfied: true,
    production_evidence_verified: false,
    database_migrations_applied: "not_verified",
    os_network_isolation_verified: false,
    production_zero_retention_verified: false,
    production_ready: false,
  });
  assert.equal(typeof runtime.handleRequest, "function");
  assert.equal(typeof runtime.runWorkerOnce, "function");
  assert.equal(typeof runtime.runCleanupCycle, "function");
  assert.deepEqual(Object.keys(runtime).sort(),
    ["handleRequest", "readiness", "runCleanupCycle", "runWorkerOnce"].sort());
  const serialized = JSON.stringify(runtime);
  for (const secret of [SERVICE_KEY, S3_ACCESS_KEY, S3_SECRET_KEY]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(observed.fetches, 0);

  const response = await runtime.handleRequest(new Request(
    "https://app.example.test/manuscript/api/v2/jobs",
    { method: "GET" },
  ));
  assert.equal(response.status, 401);
  assert.equal(observed.fetches, 0);
  assert.equal(observed.security.length, 1);
  assert.equal(JSON.stringify(observed.security).includes(S3_SECRET_KEY), false);
});

test("production Web job runtime fails closed on incomplete, extra, mixed, or invalid config", () => {
  const observed = state();
  const validAdapters = adapters(observed);
  const missing = configuration();
  delete missing.scratch_root;
  assert.throws(() => createWebJobProductionRuntime({
    configuration: missing, adapters: validAdapters,
  }), /字段集合/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: { ...configuration(), unexpected: true }, adapters: validAdapters,
  }), /字段集合/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration({ account_trusted_keys: [] }), adapters: validAdapters,
  }), /Oak Account/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration({ schema_version: "1.0" }), adapters: validAdapters,
  }), /版本不兼容/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration({ expected_migration_manifest_sha256: "0".repeat(64) }),
    adapters: validAdapters,
  }), /迁移 bundle/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration({ expected_deployment_requirements_sha256: "0".repeat(64) }),
    adapters: validAdapters,
  }), /部署需/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration({ direct_credential_ttl_seconds: 301 }), adapters: validAdapters,
  }), /凭证时限/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration({
      deployment_profile: deploymentProfile({ public_http: { max_control_request_bytes: 1024 } }),
    }),
    adapters: validAdapters,
  }), /平台能力不足/);
  assert.equal(observed.fetches, 0);
});

test("production Web job runtime requires every audit and execution adapter explicitly", () => {
  for (const key of ["security_event_sink", "job_audit_sink", "cleanup_audit_sink",
    "fetch_impl", "spawn_impl"]) {
    const observed = state();
    assert.throws(() => createWebJobProductionRuntime({
      configuration: configuration(),
      adapters: adapters(observed, { [key]: undefined }),
    }), new RegExp(key));
    assert.equal(observed.fetches, 0);
  }
  const observed = state();
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration(),
    adapters: { ...adapters(observed), extra_adapter: () => {} },
  }), /字段集合/);
});
