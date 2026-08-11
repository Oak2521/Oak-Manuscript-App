// Deployable composition root for the temporary Web manuscript job boundary.
// The platform injects configuration and adapters; this module never reads
// process.env and never exposes repositories, storage, or credentials.

"use strict";

const { createHash } = require("node:crypto");

const { createFetchHandlerAdapter } = require("./fetch-adapter");
const { createGoTrueAccessTokenVerifier } = require("./gotrue-verifier");
const { createWebJobHttpHandler } = require("./http-handler");
const { PersistentWebJobService } = require("./persistent-job-service");
const { PrivateLeaseWorker } = require("./private-lease-worker");
const { PythonCoreProcessProcessor } = require("./python-core-process-processor");
const { SupabaseJobRepository } = require("./supabase-job-repository");
const { SupabaseS3DirectStorage } = require("./supabase-s3-direct-storage");
const { createSupabaseSessionResolver } = require("./supabase-session-adapter");
const { ZeroRetentionSweeper } = require("./zero-retention-sweeper");
const {
  DIRECT_DEPLOYMENT_REQUIREMENTS_SHA256,
  assessDirectWebDeploymentProfile,
} = require("./deployment-admission-v2");
const migrationManifest = require("./supabase/migrations-v1.json");

const MIGRATION_MANIFEST_SHA256 = createHash("sha256")
  .update(Buffer.from(`${JSON.stringify(migrationManifest, null, 2)}\n`, "utf8"))
  .digest("hex");

const CONFIGURATION_KEYS = Object.freeze([
  "schema_version",
  "api_origin",
  "supabase_origin",
  "supabase_api_key",
  "supabase_service_role_key",
  "python_executable",
  "python_core_dir",
  "scratch_root",
  "s3_endpoint",
  "s3_region",
  "s3_bucket",
  "s3_prefix",
  "s3_access_key_id",
  "s3_secret_access_key",
  "direct_credential_ttl_seconds",
  "expected_migration_manifest_sha256",
  "expected_deployment_requirements_sha256",
  "deployment_profile",
]);

const ADAPTER_KEYS = Object.freeze([
  "fetch_impl",
  "spawn_impl",
  "security_event_sink",
  "job_audit_sink",
  "cleanup_audit_sink",
  "clock",
  "request_id_factory",
  "uuid_factory",
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

function requiredFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label}必须是函数`);
  return value;
}

function validateConfiguration(input) {
  const value = exactObject(input, CONFIGURATION_KEYS, "Web 作业生产配置");
  if (value.schema_version !== "2.0") throw new TypeError("Web 作业生产配置版本不兼容");
  if (value.expected_migration_manifest_sha256 !== MIGRATION_MANIFEST_SHA256) {
    throw new TypeError("Web 作业生产配置未绑定当前 Supabase 迁移 bundle");
  }
  if (value.expected_deployment_requirements_sha256 !== DIRECT_DEPLOYMENT_REQUIREMENTS_SHA256) {
    throw new TypeError("Web 作业生产配置未绑定当前部署需求");
  }
  if (typeof value.supabase_api_key === "string" &&
      value.supabase_api_key === value.supabase_service_role_key) {
    throw new TypeError("Supabase 公开 API key 与 service-role key 必须分离");
  }
  const deploymentAdmission = assessDirectWebDeploymentProfile(value.deployment_profile);
  if (deploymentAdmission.declared_capabilities_satisfied !== true) {
    throw new TypeError("Web 作业部署平台能力不足");
  }
  return Object.freeze({ value, deploymentAdmission });
}

function validateAdapters(input) {
  const value = exactObject(input, ADAPTER_KEYS, "Web 作业生产适配器");
  for (const key of ADAPTER_KEYS) requiredFunction(value[key], key);
  return value;
}

function createWebJobProductionRuntime({ configuration, adapters } = {}) {
  const validated = validateConfiguration(configuration);
  const config = validated.value;
  const injected = validateAdapters(adapters);

  const storage = new SupabaseS3DirectStorage({
    endpoint: config.s3_endpoint,
    region: config.s3_region,
    bucket: config.s3_bucket,
    prefix: config.s3_prefix,
    accessKeyId: config.s3_access_key_id,
    secretAccessKey: config.s3_secret_access_key,
    credentialTtlSeconds: config.direct_credential_ttl_seconds,
    clock: injected.clock,
  });
  const repository = new SupabaseJobRepository({
    supabaseOrigin: config.supabase_origin,
    serviceRoleKey: config.supabase_service_role_key,
    fetchImpl: injected.fetch_impl,
  });
  const processor = new PythonCoreProcessProcessor({
    pythonExecutable: config.python_executable,
    coreDir: config.python_core_dir,
    scratchRoot: config.scratch_root,
    spawnImpl: injected.spawn_impl,
    // Production workers receive an empty inherited environment. The processor
    // adds only its fixed scratch/Python variables at invocation time.
    sourceEnvironment: {},
  });
  const service = new PersistentWebJobService({
    repository,
    storage,
    contentInspector: processor,
    clock: injected.clock,
    uuidFactory: injected.uuid_factory,
    auditSink: injected.job_audit_sink,
  });
  const verifyAccessToken = createGoTrueAccessTokenVerifier({
    supabaseOrigin: config.supabase_origin,
    apiKey: config.supabase_api_key,
    fetchImpl: injected.fetch_impl,
  });
  const nodeHandler = createWebJobHttpHandler({
    service,
    expectedOrigin: config.api_origin,
    resolveSession: createSupabaseSessionResolver({ verifyAccessToken }),
    requestIdFactory: injected.request_id_factory,
    clock: injected.clock,
    securityEventSink: injected.security_event_sink,
    dataPlane: "direct_object",
  });
  const worker = new PrivateLeaseWorker({ service, processor });
  const cleanup = new ZeroRetentionSweeper({
    taskService: service,
    objectStorage: storage,
    clock: injected.clock,
    auditSink: injected.cleanup_audit_sink,
  });

  const readiness = Object.freeze({
    schema_version: "2.0",
    runtime_type: "oak_manuscript_web_job_runtime",
    data_plane: "direct_object",
    configuration_validated: true,
    public_handler_enabled: true,
    private_worker_enabled: true,
    cleanup_scheduler_required: true,
    migration_manifest_sha256: MIGRATION_MANIFEST_SHA256,
    deployment_requirements_sha256: DIRECT_DEPLOYMENT_REQUIREMENTS_SHA256,
    declared_deployment_capabilities_satisfied:
      validated.deploymentAdmission.declared_capabilities_satisfied,
    production_evidence_verified: false,
    database_migrations_applied: "not_verified",
    os_network_isolation_verified: false,
    production_zero_retention_verified: false,
    production_ready: false,
  });
  return Object.freeze({
    readiness,
    handleRequest: createFetchHandlerAdapter({ nodeHandler }),
    runWorkerOnce: () => worker.runOnce(),
    runCleanupCycle: () => cleanup.runCycle(),
  });
}

module.exports = {
  ADAPTER_KEYS,
  CONFIGURATION_KEYS,
  MIGRATION_MANIFEST_SHA256,
  createWebJobProductionRuntime,
};
