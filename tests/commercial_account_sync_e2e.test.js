"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { registerAccountSyncIpc } = require("../electron/account-sync-ipc");
const {
  AuthProvider,
  LicenseProvider,
  SyncProvider,
  buildSyncRecordV1,
} = require("../electron/providers");
const { SyncHttpClient } = require("../electron/sync-http-client");
const { SyncTransportCoordinator } = require("../electron/sync-transport-coordinator");
const { createFetchHandlerAdapter } = require("../web/fetch-adapter");
const { createSupabaseSessionResolver } = require("../web/supabase-session-adapter");
const { createSyncRecordHttpHandler } = require("../web/sync-record-http-handler");
const {
  MemorySyncRecordRepository,
  SyncRecordService,
} = require("../web/sync-record-service");
const webContract = require("../web/client/client-contract");

const API_ORIGIN = "https://manuscript.test";
const ACCOUNT = "account-0001";
const TOKEN = "oak_test_access_token_00000000000000000000000000000001";
const PROJECT = "C:\\projects\\commercial-flow";
const NOW = "2026-07-29T16:00:00.000Z";

function source(event) {
  return {
    projectId: "0123456789abcdef",
    runId: "check-0001",
    event,
    format: "docx",
    manuscriptType: "paper",
    checkConfig: "full",
    languageBucket: "zh",
    lengthBucket: "5千—2万字",
    citation: {
      requestedStyle: "default",
      resolvedStyle: "gbt7714-2025",
      mode: "style_specific",
      confidence: "high",
      reasonCode: "paper_zh_numeric_reference_structure",
      resolverVersion: "1.0.0",
    },
    rulepackVersion: "2.0.0",
    appVersion: "0.1.0-alpha.54",
    platform: "win32",
    createdAt: "2026-07-29T15:59:00.000Z",
    authorizedAt: null,
    issues: [
      {
        rule_id: "OAK-CN-PUNCT-001",
        severity: "warning",
        dimension: "punctuation",
        status: "open",
        fixable: true,
        title: "不得进入同步记录的稿件标题",
        location: "C:\\Users\\author\\private.docx",
        preview: "不得进入同步记录的正文片段",
      },
    ],
    externalValidation: { epubcheck: "not_applicable", ace: "not_applicable" },
    exportState: "completed",
  };
}

function encryptedMemoryStore() {
  let state = null;
  return {
    encrypted: true,
    load() { return state === null ? null : structuredClone(state); },
    save(next, { expectedRevision } = {}) {
      const actualRevision = state === null ? 0 : state.revision;
      if (expectedRevision !== actualRevision) throw new Error("同步队列 revision 冲突");
      state = structuredClone(next);
      return structuredClone(state);
    },
  };
}

function registerDesktopFlow({ authProvider, licenseProvider, syncProvider, coordinator }) {
  const handlers = new Map();
  registerAccountSyncIpc({
    ipcMain: { handle(name, handler) { handlers.set(name, handler); } },
    pathPolicy: { looksLikeProject(value) { return value === PROJECT; } },
    authProvider,
    licenseProvider,
    syncProvider,
    getSyncCoordinator: () => coordinator,
    syncRecordSource: async (project, event, includeIssues) => {
      assert.equal(project, PROJECT);
      return buildSyncRecordV1(source(event), { includeIssues });
    },
  });
  return handlers;
}

test("logged-in entitlement, explicit desktop sync, server ownership, and Web history form one local E2E", async () => {
  const clock = () => new Date(NOW);
  const authProvider = new AuthProvider({ allowLocalSimulation: true, clock });
  authProvider.simulateLogin({ accountId: ACCOUNT, ttlSeconds: 3600 });
  const licenseProvider = new LicenseProvider({ tier: "pro", entitlementState: "active", clock });
  const syncProvider = new SyncProvider({
    clock,
    idFactory: () => "queue-commercial-flow-0001",
    requirePersistence: true,
  });
  syncProvider.configurePersistence(encryptedMemoryStore());

  const repository = new MemorySyncRecordRepository();
  const service = new SyncRecordService({ repository, clock });
  const securityEvents = [];
  const nodeHandler = createSyncRecordHttpHandler({
    service,
    expectedOrigin: API_ORIGIN,
    resolveSession: createSupabaseSessionResolver({
      verifyAccessToken: async (token) => token === TOKEN ? { subject_id: ACCOUNT } : null,
    }),
    requestIdFactory: () => "20000000-0000-4000-8000-000000000053",
    clock,
    securityEventSink: (event) => securityEvents.push(event),
  });
  const fetchHandler = createFetchHandlerAdapter({ nodeHandler });
  const transport = new SyncHttpClient({
    apiOrigin: API_ORIGIN,
    fetchImpl: (url, options) => fetchHandler(new Request(url, options)),
  });
  const coordinator = new SyncTransportCoordinator({
    syncProvider,
    authProvider,
    accessTokenProvider: async ({ accountId }) => ({ accountId, accessToken: TOKEN }),
    transport,
  });
  const handlers = registerDesktopFlow({
    authProvider,
    licenseProvider,
    syncProvider,
    coordinator,
  });

  const auth = await handlers.get("provider:auth-status")();
  const license = await handlers.get("provider:license-status")();
  assert.equal(auth.loggedIn, true);
  assert.equal(auth.accountId, ACCOUNT);
  assert.equal(license.effectiveTier, "pro");
  assert.equal(license.capabilities.fullSyncHistory, true);

  const preview = await handlers.get("provider:sync-preview")(null, {
    project: PROJECT,
    event: "export",
    includeIssues: true,
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.preview.record.authorized_at, null);
  assert.equal(syncProvider.listQueue(auth).length, 0, "预览本身不得排队或联网");
  const previewText = JSON.stringify(preview.preview.record);
  for (const privateValue of [
    "不得进入同步记录的稿件标题",
    "不得进入同步记录的正文片段",
    "private.docx",
    "C:\\Users\\author",
  ]) assert.equal(previewText.includes(privateValue), false);

  const confirmed = await handlers.get("provider:sync-confirm")(null, {
    idempotencyId: preview.preview.record.idempotency_id,
    choice: "ask_each_time",
  });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.result.queued, true);
  assert.equal(confirmed.result.persistence.encrypted, true);
  assert.equal(confirmed.result.item.payload.authorized_at, NOW);
  assert.deepEqual(confirmed.delivery, {
    state: "synced",
    outcome: "created",
    idempotency_id: preview.preview.record.idempotency_id,
    received_at: NOW,
  });
  assert.equal(syncProvider.listQueue(auth).length, 0, "服务端确认后本机队列项必须删除");

  const listedResponse = await fetchHandler(new Request(
    `${API_ORIGIN}/manuscript/api/v1/sync-records`,
    { method: "GET", headers: { authorization: `Bearer ${TOKEN}` } },
  ));
  assert.equal(listedResponse.status, 200);
  const rawList = await listedResponse.json();
  const websiteHistory = webContract.parseSyncRecordList(rawList);
  assert.equal(websiteHistory.items.length, 1);
  assert.equal(websiteHistory.items[0].idempotencyId, preview.preview.record.idempotency_id);
  assert.equal(websiteHistory.items[0].total, 1);
  assert.equal(websiteHistory.items[0].warnings, 1);
  assert.equal(websiteHistory.items[0].exportState, "completed");
  assert.equal(JSON.stringify(rawList).includes(ACCOUNT), false, "网站公开记录不得回显账号标识");
  assert.equal(securityEvents.length, 2);
  const auditText = JSON.stringify(securityEvents);
  assert.equal(auditText.includes(TOKEN), false);
  assert.equal(auditText.includes(ACCOUNT), false);
});
