"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

const HOSTED_NODE_TESTS = Object.freeze([
  "tests/account_sync_provider.test.js",
  "tests/auth_http_client.test.js",
  "tests/desktop_auth_config.test.js",
  "tests/desktop_auth_provider.test.js",
  "tests/desktop_auth_wiring.test.js",
  "tests/desktop_license_config.test.js",
  "tests/encrypted_auth_store.test.js",
  "tests/hosted_ci_workflow.test.js",
  "tests/hosted_source_test_runner.test.js",
  "tests/license_entitlement.test.js",
  "tests/license_http_client.test.js",
  "tests/license_store.test.js",
  "tests/oak_account_auth.test.js",
  "tests/oak_account_contract.test.js",
  "tests/oak_account_http_client.test.js",
  "tests/oak_account_security_scan.test.js",
  "tests/oak_account_server_session.test.js",
  "tests/oak_account_staging_consumer.test.js",
  "tests/subscription_revoke_desktop_refresh_e2e.test.js",
  "tests/sync_http_client.test.js",
  "tests/sync_store.test.js",
  "tests/sync_transport_coordinator.test.js",
  "tests/web_client.test.js",
  "tests/web_direct_deployment_admission.test.js",
  "tests/web_direct_transfer_contract.test.js",
  "tests/web_direct_transfer_http.test.js",
  "tests/web_entitlement_http.test.js",
  "tests/web_entitlement_runtime.test.js",
  "tests/web_entitlement_service.test.js",
  "tests/web_license_account_client.test.js",
  "tests/web_license_account_http.test.js",
  "tests/web_license_account_runtime.test.js",
  "tests/web_license_account_service.test.js",
  "tests/web_license_management_repository.test.js",
  "tests/web_subscription_event_runtime.test.js",
  "tests/web_subscription_event_service.test.js",
  "tests/web_supabase_entitlement_repository.test.js",
  "tests/web_supabase_sync_record_repository.test.js",
  "tests/web_sync_record_http.test.js",
  "tests/web_sync_record_runtime.test.js",
  "tests/web_sync_record_service.test.js",
]);

function runHostedSourceTests() {
  const env = { ...process.env };
  delete env.OAK10_STAGING_CONSUMER;
  const result = spawnSync(
    process.execPath,
    ["--test", ...HOSTED_NODE_TESTS],
    { cwd: ROOT, env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  return Number.isInteger(result.status) ? result.status : 1;
}

if (require.main === module) {
  process.exitCode = runHostedSourceTests();
}

module.exports = {
  HOSTED_NODE_TESTS,
  runHostedSourceTests,
};
