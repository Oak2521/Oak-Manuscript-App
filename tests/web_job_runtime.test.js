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
  DEPLOYMENT_REQUIREMENTS_SHA256,
} = require("../web/deployment-admission");

const PUBLIC_KEY = "public-api-key-0000000000000001";
const SERVICE_KEY = "service-role-key-0000000000001";
const UUID = "10000000-0000-4000-8000-000000000001";

function deploymentProfile(overrides = {}) {
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

class NoNetworkStore {
  async set() { throw new Error("not called"); }
  async getWithMetadata() { throw new Error("not called"); }
  async getMetadata() { throw new Error("not called"); }
  async delete() { throw new Error("not called"); }
  async *list() { throw new Error("not called"); }
}

function configuration(overrides = {}) {
  return {
    schema_version: "1.0",
    api_origin: "https://app.example.test",
    supabase_origin: "https://project.supabase.test",
    supabase_api_key: PUBLIC_KEY,
    supabase_service_role_key: SERVICE_KEY,
    python_executable: process.execPath,
    python_core_dir: path.resolve(__dirname, "..", "python"),
    scratch_root: path.resolve(os.tmpdir()),
    blob_store_name: "oak-manuscript-ephemeral-v1",
    blob_prefix: "oak-manuscript/jobs/v1",
    expected_migration_manifest_sha256: MIGRATION_MANIFEST_SHA256,
    expected_deployment_requirements_sha256: DEPLOYMENT_REQUIREMENTS_SHA256,
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
    get_store_impl: (options) => {
      state.stores.push(options);
      return new NoNetworkStore();
    },
    spawn_impl: () => { throw new Error("unexpected process"); },
    security_event_sink: (event) => state.security.push(event),
    job_audit_sink: (event) => state.jobs.push(event),
    cleanup_audit_sink: async (event) => state.cleanup.push(event),
    clock: () => new Date("2026-07-29T20:00:00.000Z"),
    request_id_factory: () => UUID,
    uuid_factory: () => UUID,
    ...overrides,
  };
}

function state() {
  return { fetches: 0, stores: [], security: [], jobs: [], cleanup: [] };
}

test("production Web job runtime composes public handler, private worker, and cleanup without startup network", async () => {
  const observed = state();
  const runtime = createWebJobProductionRuntime({
    configuration: configuration(),
    adapters: adapters(observed),
  });

  assert.deepEqual(runtime.readiness, {
    schema_version: "1.0",
    runtime_type: "oak_manuscript_web_job_runtime",
    configuration_validated: true,
    public_handler_enabled: true,
    private_worker_enabled: true,
    cleanup_scheduler_required: true,
    migration_manifest_sha256: MIGRATION_MANIFEST_SHA256,
    deployment_requirements_sha256: DEPLOYMENT_REQUIREMENTS_SHA256,
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
  assert.equal(JSON.stringify(runtime).includes(PUBLIC_KEY), false);
  assert.equal(JSON.stringify(runtime).includes(SERVICE_KEY), false);
  assert.deepEqual(observed.stores,
    [{ name: "oak-manuscript-ephemeral-v1", consistency: "strong" }]);
  assert.equal(observed.fetches, 0);

  const response = await runtime.handleRequest(new Request(
    "https://app.example.test/manuscript/api/v1/jobs",
    { method: "GET" },
  ));
  assert.equal(response.status, 401);
  assert.equal(observed.fetches, 0);
  assert.equal(observed.security.length, 1);
  assert.equal(JSON.stringify(observed.security).includes(PUBLIC_KEY), false);
  assert.equal(JSON.stringify(observed.security).includes(SERVICE_KEY), false);
});

test("production Web job runtime fails closed on incomplete, extra, or mixed-secret configuration", () => {
  const observed = state();
  const validAdapters = adapters(observed);
  const missing = configuration();
  delete missing.scratch_root;
  assert.throws(() => createWebJobProductionRuntime({
    configuration: missing,
    adapters: validAdapters,
  }), /字段集合/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: { ...configuration(), unexpected: true },
    adapters: validAdapters,
  }), /字段集合/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration({ supabase_api_key: SERVICE_KEY }),
    adapters: validAdapters,
  }), /必须分离/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration({ schema_version: "2.0" }),
    adapters: validAdapters,
  }), /版本不兼容/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration({ expected_migration_manifest_sha256: "0".repeat(64) }),
    adapters: validAdapters,
  }), /迁移 bundle/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration({ expected_deployment_requirements_sha256: "0".repeat(64) }),
    adapters: validAdapters,
  }), /部署需求/);
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration({
      deployment_profile: deploymentProfile({
        public_http: { max_buffered_request_bytes: 6 * 1024 * 1024 },
      }),
    }),
    adapters: validAdapters,
  }), /平台能力不足/);
  assert.equal(observed.fetches, 0);
  assert.deepEqual(observed.stores, []);
});

test("production Web job runtime requires every audit and execution adapter explicitly", () => {
  for (const key of ["security_event_sink", "job_audit_sink", "cleanup_audit_sink",
    "fetch_impl", "get_store_impl", "spawn_impl"]) {
    const observed = state();
    assert.throws(() => createWebJobProductionRuntime({
      configuration: configuration(),
      adapters: adapters(observed, { [key]: undefined }),
    }), new RegExp(key));
    assert.equal(observed.fetches, 0);
    assert.deepEqual(observed.stores, []);
  }
  const observed = state();
  assert.throws(() => createWebJobProductionRuntime({
    configuration: configuration(),
    adapters: { ...adapters(observed), extra_adapter: () => {} },
  }), /字段集合/);
});
