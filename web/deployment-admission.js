// Platform-neutral admission gate for the temporary Web manuscript data plane.
// A declared profile can satisfy capabilities, but never becomes production
// evidence by itself. No profile may contain credentials or endpoint values.

"use strict";

const { createHash } = require("node:crypto");

const {
  DEFAULT_MAX_RESULT_BYTES,
  DEFAULT_MAX_UPLOAD_BYTES,
} = require("./job-contract");
const {
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
} = require("./netlify-ephemeral-storage");
const {
  DEFAULT_PROCESS_TIMEOUT_MS,
} = require("./python-core-process-processor");
const trackedRequirements = require("./deployment-requirements-v1.json");

const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version", "profile_type", "profile_id", "public_http",
  "private_execution", "object_storage", "database", "operations",
]);
const PUBLIC_HTTP_KEYS = Object.freeze([
  "max_buffered_request_bytes", "max_buffered_response_bytes", "max_execution_ms",
  "supports_same_origin_https",
]);
const PRIVATE_EXECUTION_KEYS = Object.freeze([
  "max_execution_ms", "supports_child_process", "supports_absolute_executable",
  "supports_writable_private_scratch", "supports_os_network_deny",
  "supports_read_only_application",
]);
const OBJECT_STORAGE_KEYS = Object.freeze([
  "supports_strong_consistency", "supports_conditional_create", "supports_metadata",
  "supports_paginated_prefix_list", "supports_delete_confirmation",
]);
const DATABASE_KEYS = Object.freeze([
  "supports_transactions", "supports_advisory_locks", "supports_row_level_security",
  "supports_service_role_rpc",
]);
const OPERATIONS_KEYS = Object.freeze([
  "supports_private_worker_scheduler", "supports_cleanup_scheduler",
  "supports_retry_alerting", "supports_secret_injection",
]);

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

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

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label}必须是正整数`);
  return value;
}

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label}必须是布尔值`);
  return value;
}

function validateRequirements(value) {
  exactObject(value, [
    "schema_version", "requirements_type", "source_contracts", "public_http",
    "private_execution", "object_storage", "database", "operations",
  ], "Web 部署需求");
  if (value.schema_version !== "1.0" ||
      value.requirements_type !== "oak_manuscript_web_deployment_requirements") {
    throw new TypeError("Web 部署需求身份不兼容");
  }
  const expectedSources = [
    "web/job-contract.js",
    "web/netlify-ephemeral-storage.js",
    "web/python-core-process-processor.js",
    "web/supabase/001_web_job_state.sql",
    "web/zero-retention-sweeper.js",
  ];
  if (!Array.isArray(value.source_contracts) ||
      value.source_contracts.length !== expectedSources.length ||
      value.source_contracts.some((entry, index) => entry !== expectedSources[index])) {
    throw new TypeError("Web 部署需求来源集合漂移");
  }
  exactObject(value.public_http, [
    "min_buffered_request_bytes", "min_buffered_response_bytes", "min_execution_ms",
    "requires_same_origin_https",
  ], "Web 公开 HTTP 需求");
  exactObject(value.private_execution, [
    "min_execution_ms", "requires_child_process", "requires_absolute_executable",
    "requires_writable_private_scratch", "requires_os_network_deny",
    "requires_read_only_application",
  ], "Web 私有执行需求");
  exactObject(value.object_storage, [
    "requires_strong_consistency", "requires_conditional_create", "requires_metadata",
    "requires_paginated_prefix_list", "requires_delete_confirmation",
  ], "Web 对象存储需求");
  exactObject(value.database, [
    "requires_transactions", "requires_advisory_locks", "requires_row_level_security",
    "requires_service_role_rpc",
  ], "Web 数据库需求");
  exactObject(value.operations, [
    "requires_private_worker_scheduler", "requires_cleanup_scheduler",
    "requires_retry_alerting", "requires_secret_injection",
  ], "Web 运维需求");
  if (MAX_INPUT_BYTES !== DEFAULT_MAX_UPLOAD_BYTES ||
      MAX_OUTPUT_BYTES !== DEFAULT_MAX_RESULT_BYTES ||
      value.public_http.min_buffered_request_bytes !== DEFAULT_MAX_UPLOAD_BYTES ||
      value.public_http.min_buffered_response_bytes !== DEFAULT_MAX_RESULT_BYTES ||
      value.public_http.min_execution_ms !== DEFAULT_PROCESS_TIMEOUT_MS ||
      value.private_execution.min_execution_ms !== DEFAULT_PROCESS_TIMEOUT_MS) {
    throw new TypeError("Web 部署需求与当前运行时上限漂移");
  }
  for (const [groupName, group] of Object.entries({
    public_http: value.public_http,
    private_execution: value.private_execution,
    object_storage: value.object_storage,
    database: value.database,
    operations: value.operations,
  })) {
    for (const [key, item] of Object.entries(group)) {
      if (key.startsWith("min_")) positiveSafeInteger(item, `${groupName}.${key}`);
      if (key.startsWith("requires_")) requiredBoolean(item, `${groupName}.${key}`);
    }
  }
  return value;
}

const REQUIREMENTS = deepFreeze(JSON.parse(JSON.stringify(validateRequirements(trackedRequirements))));
const DEPLOYMENT_REQUIREMENTS_SHA256 = createHash("sha256")
  .update(canonicalBytes(REQUIREMENTS))
  .digest("hex");

function validateProfile(input) {
  const profile = exactObject(input, TOP_LEVEL_KEYS, "Web 平台 profile");
  if (profile.schema_version !== "1.0" ||
      profile.profile_type !== "oak_manuscript_web_platform_profile") {
    throw new TypeError("Web 平台 profile 身份不兼容");
  }
  if (typeof profile.profile_id !== "string" || !PROFILE_ID_PATTERN.test(profile.profile_id)) {
    throw new TypeError("profile_id 不是规范的非敏感标识");
  }
  const publicHttp = exactObject(profile.public_http, PUBLIC_HTTP_KEYS, "public_http");
  const privateExecution = exactObject(profile.private_execution,
    PRIVATE_EXECUTION_KEYS, "private_execution");
  const objectStorage = exactObject(profile.object_storage, OBJECT_STORAGE_KEYS, "object_storage");
  const database = exactObject(profile.database, DATABASE_KEYS, "database");
  const operations = exactObject(profile.operations, OPERATIONS_KEYS, "operations");
  for (const [label, group] of Object.entries({
    public_http: publicHttp,
    private_execution: privateExecution,
  })) {
    for (const [key, value] of Object.entries(group)) {
      if (key.startsWith("max_")) positiveSafeInteger(value, `${label}.${key}`);
      if (key.startsWith("supports_")) requiredBoolean(value, `${label}.${key}`);
    }
  }
  for (const [label, group] of Object.entries({ object_storage: objectStorage, database, operations })) {
    for (const [key, value] of Object.entries(group)) requiredBoolean(value, `${label}.${key}`);
  }
  return profile;
}

function assessWebDeploymentProfile(input) {
  const profile = validateProfile(input);
  const violations = [];
  const addCapacity = (actual, required, code) => {
    if (actual < required) violations.push(code);
  };
  const addCapability = (actual, code) => {
    if (actual !== true) violations.push(code);
  };
  addCapacity(profile.public_http.max_buffered_request_bytes,
    REQUIREMENTS.public_http.min_buffered_request_bytes, "PUBLIC_REQUEST_BYTES_INSUFFICIENT");
  addCapacity(profile.public_http.max_buffered_response_bytes,
    REQUIREMENTS.public_http.min_buffered_response_bytes, "PUBLIC_RESPONSE_BYTES_INSUFFICIENT");
  addCapacity(profile.public_http.max_execution_ms,
    REQUIREMENTS.public_http.min_execution_ms, "PUBLIC_EXECUTION_WINDOW_INSUFFICIENT");
  addCapability(profile.public_http.supports_same_origin_https, "SAME_ORIGIN_HTTPS_UNSUPPORTED");
  addCapacity(profile.private_execution.max_execution_ms,
    REQUIREMENTS.private_execution.min_execution_ms, "PRIVATE_EXECUTION_WINDOW_INSUFFICIENT");
  addCapability(profile.private_execution.supports_child_process, "CHILD_PROCESS_UNSUPPORTED");
  addCapability(profile.private_execution.supports_absolute_executable,
    "ABSOLUTE_EXECUTABLE_UNSUPPORTED");
  addCapability(profile.private_execution.supports_writable_private_scratch,
    "PRIVATE_SCRATCH_UNSUPPORTED");
  addCapability(profile.private_execution.supports_os_network_deny, "OS_NETWORK_DENY_UNSUPPORTED");
  addCapability(profile.private_execution.supports_read_only_application,
    "READ_ONLY_APPLICATION_UNSUPPORTED");
  addCapability(profile.object_storage.supports_strong_consistency,
    "STRONG_CONSISTENCY_UNSUPPORTED");
  addCapability(profile.object_storage.supports_conditional_create, "CONDITIONAL_CREATE_UNSUPPORTED");
  addCapability(profile.object_storage.supports_metadata, "OBJECT_METADATA_UNSUPPORTED");
  addCapability(profile.object_storage.supports_paginated_prefix_list, "PREFIX_LIST_UNSUPPORTED");
  addCapability(profile.object_storage.supports_delete_confirmation, "DELETE_CONFIRMATION_UNSUPPORTED");
  addCapability(profile.database.supports_transactions, "TRANSACTIONS_UNSUPPORTED");
  addCapability(profile.database.supports_advisory_locks, "ADVISORY_LOCKS_UNSUPPORTED");
  addCapability(profile.database.supports_row_level_security, "RLS_UNSUPPORTED");
  addCapability(profile.database.supports_service_role_rpc, "SERVICE_ROLE_RPC_UNSUPPORTED");
  addCapability(profile.operations.supports_private_worker_scheduler,
    "PRIVATE_WORKER_SCHEDULER_UNSUPPORTED");
  addCapability(profile.operations.supports_cleanup_scheduler, "CLEANUP_SCHEDULER_UNSUPPORTED");
  addCapability(profile.operations.supports_retry_alerting, "RETRY_ALERTING_UNSUPPORTED");
  addCapability(profile.operations.supports_secret_injection, "SECRET_INJECTION_UNSUPPORTED");

  return deepFreeze({
    schema_version: "1.0",
    report_type: "oak_manuscript_web_deployment_admission",
    profile_id: profile.profile_id,
    requirements_sha256: DEPLOYMENT_REQUIREMENTS_SHA256,
    declared_capabilities_satisfied: violations.length === 0,
    production_evidence_verified: false,
    production_ready: false,
    violations,
  });
}

function getWebDeploymentRequirements() {
  return REQUIREMENTS;
}

module.exports = {
  DEPLOYMENT_REQUIREMENTS_SHA256,
  assessWebDeploymentProfile,
  getWebDeploymentRequirements,
};
