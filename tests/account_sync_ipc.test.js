"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { registerAccountSyncIpc } = require("../electron/account-sync-ipc");

test("sandboxed preload exposes only bounded account and sync operations", async () => {
  const calls = [];
  let api = null;
  const preloadPath = path.resolve(__dirname, "../electron/preload.js");
  vm.runInNewContext(fs.readFileSync(preloadPath, "utf8"), {
    require(specifier) {
      assert.equal(specifier, "electron");
      return {
        contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
        ipcRenderer: {
          invoke(channel, payload) {
            calls.push({ channel, payload });
            return Promise.resolve({ ok: true });
          },
        },
      };
    },
  }, { filename: preloadPath });

  await api.authStatus();
  await api.beginLogin();
  await api.logout();
  await api.licenseStatus();
  await api.syncPreference();
  await api.syncPreview("C:\\projects\\oak", "export", true);
  await api.syncConfirm("idem-1", "sync_once");
  await api.syncQueue();
  await api.syncCancel("queue-1");
  await api.syncRetry("queue-1");
  await api.syncDelete("queue-1");

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { channel: "provider:auth-status" },
    { channel: "provider:auth-begin" },
    { channel: "provider:auth-logout" },
    { channel: "provider:license-status" },
    { channel: "provider:sync-preference", payload: {} },
    {
      channel: "provider:sync-preview",
      payload: { project: "C:\\projects\\oak", event: "export", includeIssues: true },
    },
    {
      channel: "provider:sync-confirm",
      payload: { idempotencyId: "idem-1", choice: "sync_once" },
    },
    { channel: "provider:sync-queue" },
    { channel: "provider:sync-cancel", payload: { queueId: "queue-1" } },
    { channel: "provider:sync-retry", payload: { queueId: "queue-1" } },
    { channel: "provider:sync-delete", payload: { queueId: "queue-1" } },
  ]);
});

test("account/sync IPC obtains the record from trusted core source, not renderer content", async () => {
  const handlers = new Map();
  const record = {
    schema_version: "1.0",
    record_type: "oak_manuscript_result",
    project_id: "0123456789abcdef",
    run_id: "check-0001",
    idempotency_id: "sync-v1:0123456789abcdef:check-0001",
    event: "export",
    document: {
      format: "docx", manuscript_type: "paper", check_config: "full",
      language_bucket: "zh", length_bucket: "1万字以下",
    },
    citation: {
      requested_style: "default", resolved_style: "gbt7714-2025",
      mode: "style_specific", confidence: "high", reason_code: "test",
      resolver_version: "1.0.0",
    },
    versions: { rulepack: "2.0.0", app: "0.1.0-alpha.12", platform: "win32" },
    counts: {
      total: 0, fixable: 0,
      by_severity: { error: 0, warning: 0, suggestion: 0 },
      by_dimension: {}, by_status: {},
    },
    external_validation: { epubcheck: "not_applicable", ace: "not_applicable" },
    export_state: "completed",
    created_at: "2026-07-28T12:00:00.000Z",
    authorized_at: "2026-07-28T12:01:00.000Z",
  };
  let sourceArgs = null;
  const authProvider = {
    status: () => ({ state: "authenticated", loggedIn: true, accountId: "account-1" }),
    beginLogin: () => ({ state: "configuration_required", opened: false }),
    logout: () => ({ state: "signed_out", loggedIn: false }),
  };
  const licenseProvider = { status: () => ({ tier: "free", localProjectsLocked: false }) };
  const queued = [];
  const syncProvider = {
    getPreference: () => "never_asked",
    setPreference: (value) => value,
    preview: (value) => ({ record: value, choices: ["sync_once"] }),
    confirm: (value, choice) => { queued.push([value, choice]); return { queued: true }; },
    listQueue: () => [],
    cancel: (id) => ({ queue_id: id, state: "canceled" }),
    retry: (id) => ({ queue_id: id, state: "pending_transport" }),
    delete: () => true,
  };
  registerAccountSyncIpc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    pathPolicy: { looksLikeProject: (value) => value === "C:\\projects\\oak" },
    authProvider,
    licenseProvider,
    syncProvider,
    syncRecordSource: async (project, event, includeIssues) => {
      sourceArgs = [project, event, includeIssues];
      return record;
    },
  });

  const preview = await handlers.get("provider:sync-preview")(null, {
    project: "C:\\projects\\oak",
    event: "export",
    includeIssues: false,
    manuscriptText: "renderer must not be able to send this",
  });
  assert.equal(preview.ok, true);
  assert.deepEqual(sourceArgs, ["C:\\projects\\oak", "export", false]);
  assert.equal(JSON.stringify(preview).includes("manuscriptText"), false);

  const confirmed = await handlers.get("provider:sync-confirm")(null, {
    idempotencyId: record.idempotency_id,
    choice: "sync_once",
    forgedRecord: { title: "must be ignored" },
  });
  assert.equal(confirmed.ok, true);
  assert.deepEqual(queued, [[record, "sync_once"]]);
});

test("account/sync IPC rejects untrusted paths, choices and stale confirmations", async () => {
  const handlers = new Map();
  let sourceCalls = 0;
  registerAccountSyncIpc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    pathPolicy: { looksLikeProject: () => false },
    authProvider: {
      status: () => ({ state: "signed_out", loggedIn: false }),
      beginLogin: () => ({}), logout: () => ({}),
    },
    licenseProvider: { status: () => ({}) },
    syncProvider: {
      getPreference: () => "never_asked", setPreference: () => "never_asked",
      preview: () => ({}), confirm: () => ({}), listQueue: () => [],
      cancel: () => ({}), retry: () => ({}), delete: () => false,
    },
    syncRecordSource: async () => { sourceCalls += 1; return {}; },
  });

  const badPath = await handlers.get("provider:sync-preview")(null, {
    project: "C:\\not-a-project", event: "export", includeIssues: false,
  });
  assert.equal(badPath.ok, false);
  assert.equal(sourceCalls, 0);
  const stale = await handlers.get("provider:sync-confirm")(null, {
    idempotencyId: "missing", choice: "sync_once",
  });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /预览|过期/);
});

test("signed-out IPC never reads a sync source and account changes invalidate previews", async () => {
  const handlers = new Map();
  let sourceCalls = 0;
  let accountId = null;
  const record = {
    idempotency_id: "sync-v1:0123456789abcdef:check-0001",
    project_id: "0123456789abcdef",
  };
  const authProvider = {
    status: () => accountId
      ? { state: "authenticated", loggedIn: true, accountId }
      : { state: "signed_out", loggedIn: false, accountId: null },
    beginLogin: () => ({}),
    logout: () => { accountId = null; return { state: "signed_out", loggedIn: false }; },
  };
  registerAccountSyncIpc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    pathPolicy: { looksLikeProject: () => true },
    authProvider,
    licenseProvider: { status: () => ({}) },
    syncProvider: {
      getPreference: () => "never_asked", setPreference: () => "never_asked",
      preview: (value) => ({ record: value, choices: ["sync_once"] }),
      confirm: () => ({ queued: true }), listQueue: () => [],
      cancel: () => ({}), retry: () => ({}), delete: () => false,
    },
    syncRecordSource: async () => { sourceCalls += 1; return record; },
  });

  const signedOut = await handlers.get("provider:sync-preview")(null, {
    project: "C:\\projects\\oak", event: "export", includeIssues: false,
  });
  assert.equal(signedOut.ok, false);
  assert.equal(sourceCalls, 0);

  accountId = "account-1";
  const preview = await handlers.get("provider:sync-preview")(null, {
    project: "C:\\projects\\oak", event: "export", includeIssues: false,
  });
  assert.equal(preview.ok, true);
  accountId = "account-2";
  const switched = await handlers.get("provider:sync-confirm")(null, {
    idempotencyId: record.idempotency_id, choice: "sync_once",
  });
  assert.equal(switched.ok, false);
  assert.match(switched.error, /账号已变化|失效/);
});
