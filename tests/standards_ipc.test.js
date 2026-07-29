"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { registerStandardsIpc, summarizeChanges } = require("../electron/standards-ipc");

function fixture({ trustConfigured = true } = {}) {
  const handlers = new Map();
  const calls = [];
  const status = {
    ready: true,
    active: { version: "1.0.0", release_sequence: 1, manifest_sha256: "a".repeat(64) },
    previous: null,
    local_signed_import_enabled: trustConfigured,
    network_updates_enabled: trustConfigured,
  };
  const activeIdentity = {
    name: "oak-rules",
    version: "1.0.1",
    pinned: true,
    sha256: "1".repeat(64),
    bundle_id: "oak-standards",
    release_sequence: 2,
    manifest_sha256: "b".repeat(64),
  };
  const projectIdentity = {
    ...activeIdentity,
    version: "1.0.0",
    sha256: "2".repeat(64),
    release_sequence: 1,
    manifest_sha256: "a".repeat(64),
  };
  const project = "C:\\projects\\oak";
  const preview = {
    package_path: "C:\\fixture\\update.oakstd",
    version: "1.0.1",
    release_sequence: 2,
    manifest_sha256: "b".repeat(64),
    envelope_sha256: "c".repeat(64),
    expected_active_manifest_sha256: "a".repeat(64),
    change_summary: ["变更一", "变更二"],
  };
  const rollbackPreview = {
    active: { version: "1.0.1", release_sequence: 2 },
    target: { version: "1.0.0", release_sequence: 1 },
    expected_active_manifest_sha256: "b".repeat(64),
    expected_previous_manifest_sha256: "a".repeat(64),
  };
  const provider = {
    async verifiedStatus() { calls.push(["status"]); return status; },
    status() { return status; },
    async listStandards() {
      calls.push(["list"]);
      return { standards: [{ standard_id: "OAK-001" }], registry_version: "1.0.0" };
    },
    async verifiedActiveIdentity() {
      calls.push(["active-identity"]);
      return activeIdentity;
    },
    async previewPackage(file) { calls.push(["preview", file]); return preview; },
    async importPackage(file, expected) {
      calls.push(["import", file, expected]);
      return { active: { version: "1.0.1" } };
    },
    async checkForRemoteUpdate() {
      calls.push(["check-remote"]);
      return {
        outcome: "update_available",
        plan_id: "11111111-1111-4111-8111-111111111111",
        version: "1.0.2",
        release_sequence: 3,
        manifest_sha256: "d".repeat(64),
        envelope_sha256: "e".repeat(64),
        change_summary: ["在线变更一", "在线变更二"],
      };
    },
    async installRemoteUpdate(planId) {
      calls.push(["install-remote", planId]);
      return { active: { version: "1.0.2", release_sequence: 3 } };
    },
    cancelRemoteUpdate(planId) {
      calls.push(["cancel-remote", planId]);
      return { canceled: true };
    },
    async previewRollback() { calls.push(["preview-rollback"]); return rollbackPreview; },
    async rollback(expected) {
      calls.push(["rollback", expected]);
      return { active: rollbackPreview.target };
    },
  };
  const upgradePlan = {
    ok: true,
    schema_version: "1.0",
    kind: "oak-rulepack-upgrade-plan",
    project_id: "project-1",
    direction: "upgrade",
    current_rulepack: projectIdentity,
    target_rulepack: activeIdentity,
    bindings: {},
    diff_sha256: "3".repeat(64),
    diff: { summary: { rules_added: 1 } },
    requires_recheck: true,
    plan_id: `rulepack-plan-${"4".repeat(64)}`,
  };
  const boundCore = {
    async verifiedProjectStatus(value, options) {
      calls.push(["project-status", value, options]);
      return {
        status: {
          ok: true,
          project: value,
          standard_identity: projectIdentity,
          stored_identity: projectIdentity,
          legacy_migratable: false,
        },
        identity: projectIdentity,
      };
    },
    async runProject(value, args, options) {
      calls.push(["project-core", value, args, options]);
      if (args[0] === "plan-rulepack-upgrade") {
        return { code: 0, json: upgradePlan, stderr: "" };
      }
      return {
        code: 0,
        json: {
          ok: true,
          change: { change_id: "rulepack-change-0001" },
          rulepack: activeIdentity,
          rulepack_check_required: true,
          archived_issues: null,
        },
        stderr: "",
      };
    },
  };
  const dialogState = {
    open: { canceled: false, filePaths: [preview.package_path] },
    confirm: { response: 0 },
  };
  const dialog = {
    async showOpenDialog(_window, options) {
      calls.push(["open-dialog", options]);
      return dialogState.open;
    },
    async showMessageBox(_window, options) {
      calls.push(["confirm-dialog", options]);
      return dialogState.confirm;
    },
  };
  registerStandardsIpc({
    ipcMain: { handle(name, handler) { handlers.set(name, handler); } },
    dialog,
    getWindow: () => ({ id: "window" }),
    provider,
    boundCore,
    pathPolicy: { looksLikeProject: (value) => value === project },
  });
  return {
    activeIdentity,
    boundCore,
    calls,
    dialogState,
    handlers,
    preview,
    project,
    projectIdentity,
    provider,
    rollbackPreview,
    upgradePlan,
  };
}

test("standards IPC exposes verified status and active listing", async () => {
  const { handlers } = fixture();
  const status = await handlers.get("standards:status")();
  assert.equal(status.ok, true);
  assert.equal(status.status.ready, true);
  const listing = await handlers.get("standards:list")();
  assert.equal(listing.ok, true);
  assert.equal(listing.standards[0].standard_id, "OAK-001");
});

test("local standard install previews all changes and binds confirmation to the preview", async () => {
  const { calls, handlers, preview } = fixture();
  const response = await handlers.get("standards:install-local")();
  assert.equal(response.ok, true);
  assert.equal(response.canceled, false);
  const imported = calls.find((call) => call[0] === "import");
  assert.deepEqual(imported, ["import", preview.package_path, preview]);
  const confirmation = calls.find((call) => call[0] === "confirm-dialog")[1];
  assert.match(confirmation.detail, /已有项目继续固定原版本/);
  assert.equal(confirmation.defaultId, 1);
  assert.equal(confirmation.cancelId, 1);
});

test("online standard update is one user-triggered check followed by one native confirmation", async () => {
  const { calls, handlers } = fixture();
  const response = await handlers.get("standards:check-online")();
  assert.equal(response.ok, true);
  assert.equal(response.canceled, false);
  assert.equal(response.result.active.version, "1.0.2");
  assert.deepEqual(calls.find((call) => call[0] === "install-remote"), [
    "install-remote", "11111111-1111-4111-8111-111111111111",
  ]);
  const confirmation = calls.find((call) => call[0] === "confirm-dialog")[1];
  assert.match(confirmation.detail, /已有项目继续固定原版本/);
  assert.match(confirmation.detail, /在线变更一/);
  assert.equal(confirmation.defaultId, 1);
  assert.equal(confirmation.cancelId, 1);
});

test("online update cancellation, current result, and disabled transport never install", async () => {
  const canceled = fixture();
  canceled.dialogState.confirm = { response: 1 };
  assert.deepEqual(await canceled.handlers.get("standards:check-online")(), {
    ok: true,
    canceled: true,
  });
  assert.equal(canceled.calls.some((call) => call[0] === "install-remote"), false);
  assert.deepEqual(canceled.calls.find((call) => call[0] === "cancel-remote"), [
    "cancel-remote", "11111111-1111-4111-8111-111111111111",
  ]);

  const current = fixture();
  current.provider.checkForRemoteUpdate = async () => ({ outcome: "current" });
  assert.deepEqual(await current.handlers.get("standards:check-online")(), {
    ok: true,
    canceled: false,
    current: true,
  });
  assert.equal(current.calls.some((call) => call[0] === "confirm-dialog"), false);

  const disabled = fixture({ trustConfigured: false });
  const result = await disabled.handlers.get("standards:check-online")();
  assert.equal(result.ok, false);
  assert.equal(result.code, "STANDARDS_UPDATE_DISABLED");
  assert.equal(disabled.calls.some((call) => call[0] === "check-remote"), false);
});

test("canceling either package picker or confirmation never installs", async () => {
  const first = fixture();
  first.dialogState.open = { canceled: true, filePaths: [] };
  assert.deepEqual(await first.handlers.get("standards:install-local")(), {
    ok: true,
    canceled: true,
  });
  assert.equal(first.calls.some((call) => call[0] === "preview"), false);

  const second = fixture();
  second.dialogState.confirm = { response: 1 };
  const result = await second.handlers.get("standards:install-local")();
  assert.equal(result.ok, true);
  assert.equal(result.canceled, true);
  assert.equal(second.calls.some((call) => call[0] === "import"), false);
});

test("unconfigured production trust root fails before opening a file picker", async () => {
  const { calls, handlers } = fixture({ trustConfigured: false });
  const result = await handlers.get("standards:install-local")();
  assert.equal(result.ok, false);
  assert.equal(result.code, "TRUST_ROOT_UNCONFIGURED");
  assert.equal(calls.some((call) => call[0] === "open-dialog"), false);
});

test("global rollback requires a native confirmation bound to active and previous", async () => {
  const { calls, handlers, rollbackPreview } = fixture();
  const result = await handlers.get("standards:rollback-global")();
  assert.equal(result.ok, true);
  assert.equal(result.canceled, false);
  assert.deepEqual(calls.find((call) => call[0] === "rollback"), ["rollback", rollbackPreview]);
  const confirmation = calls.find((call) => call[0] === "confirm-dialog")[1];
  assert.match(confirmation.detail, /已有项目仍固定原版本/);
  assert.equal(confirmation.defaultId, 1);
});

test("change summaries are bounded in native confirmation text", () => {
  const items = Array.from({ length: 20 }, (_, index) => `变更 ${index + 1}`);
  const summary = summarizeChanges(items);
  assert.match(summary, /变更 12/);
  assert.doesNotMatch(summary, /变更 13/);
  assert.match(summary, /另有 8 项/);
});

test("project standard status compares the verified project pin with the verified active release", async () => {
  const { handlers, project, projectIdentity, activeIdentity } = fixture();
  const response = await handlers.get("standards:project-status")(null, { project });
  assert.equal(response.ok, true);
  assert.equal(response.differs, true);
  assert.deepEqual(response.project_identity, projectIdentity);
  assert.deepEqual(response.active_identity, activeIdentity);
});

test("project change plan and apply always target the main-process verified active digest", async () => {
  const { calls, handlers, project, upgradePlan, activeIdentity } = fixture();
  const previewed = await handlers.get("standards:plan-project-change")(null, { project });
  assert.equal(previewed.ok, true);
  assert.deepEqual(previewed.result, upgradePlan);
  const planned = calls.find((call) => call[0] === "project-core");
  assert.deepEqual(planned, [
    "project-core",
    project,
    [
      "plan-rulepack-upgrade", "--project", project,
      "--to-manifest-sha256", activeIdentity.manifest_sha256,
    ],
    { allowMigrationSource: true },
  ]);

  calls.length = 0;
  const applied = await handlers.get("standards:apply-project-change")(null, {
    project,
    planId: upgradePlan.plan_id,
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.result.rulepack_check_required, true);
  assert.deepEqual(calls.find((call) => call[0] === "project-core"), [
    "project-core",
    project,
    [
      "upgrade-rulepack", "--project", project,
      "--to-manifest-sha256", activeIdentity.manifest_sha256,
      "--plan-id", upgradePlan.plan_id,
    ],
    { allowMigrationSource: true },
  ]);
});

test("project standard IPC rejects invalid paths and plan IDs before Python", async () => {
  const { calls, handlers, project } = fixture();
  const pathResult = await handlers.get("standards:project-status")(null, {
    project: "relative-project",
  });
  assert.equal(pathResult.ok, false);
  const planResult = await handlers.get("standards:apply-project-change")(null, {
    project,
    planId: "../plan",
  });
  assert.equal(planResult.ok, false);
  assert.equal(calls.some((call) => call[0] === "project-core"), false);
});
