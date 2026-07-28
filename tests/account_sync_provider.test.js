"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  AuthProvider,
  LicenseProvider,
  SyncProvider,
  buildSyncRecordV1,
  validateSyncRecordV1,
} = require("../electron/providers");

const AUTHENTICATED = Object.freeze({
  state: "authenticated",
  loggedIn: true,
  accountId: "account-0001",
  sessionExpiresAt: "2026-08-01T00:00:00.000Z",
});

function source(overrides = {}) {
  return {
    projectId: "0123456789abcdef",
    runId: "check-0001",
    event: "export",
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
    appVersion: "0.1.0-alpha.9",
    platform: "win32",
    createdAt: "2026-07-28T12:00:00.000Z",
    authorizedAt: "2026-07-28T12:01:00.000Z",
    issues: [
      {
        rule_id: "OAK-CN-PUNCT-001",
        severity: "warning",
        dimension: "punctuation",
        status: "open",
        fixable: true,
        title: "绝不能同步的标题",
        location: "C:\\Users\\author\\private.docx",
        preview: "绝不能同步的正文片段",
        before: "机密原文",
        after: "机密修订文",
      },
      {
        rule_id: "OAK-CITE-001",
        severity: "error",
        dimension: "citation",
        status: "resolved",
        fixable: false,
      },
    ],
    externalValidation: { epubcheck: "not_applicable", ace: "not_applicable" },
    exportState: "completed",
    ...overrides,
  };
}

test("AuthProvider models external-browser PKCE states without pretending production is configured", () => {
  const auth = new AuthProvider();
  assert.deepEqual(auth.status(), {
    state: "signed_out",
    loggedIn: false,
    accountId: null,
    sessionExpiresAt: null,
    authMode: "system_browser_pkce",
    productionConfigured: false,
    message: "湖岸统一账号尚未接入生产服务；当前不会打开登录页或发起网络请求。",
  });
  assert.deepEqual(auth.beginLogin(), {
    state: "configuration_required",
    opened: false,
    authMode: "system_browser_pkce",
    message: "生产账号服务尚未配置，未发起网络请求。",
  });

  const mock = new AuthProvider({
    allowLocalSimulation: true,
    clock: () => new Date("2026-07-28T12:00:00.000Z"),
  });
  assert.equal(mock.simulateLogin({ accountId: "account-0001", ttlSeconds: 60 }).loggedIn, true);
  assert.equal(mock.logout().state, "signed_out");
  mock.simulateLogin({ accountId: "account-0001", ttlSeconds: 60 });
  assert.equal(mock.expireSession().state, "expired");
  assert.equal(mock.revokeDevice().state, "revoked");
});

test("LicenseProvider exposes Free/Pro capabilities and never locks local projects", () => {
  const free = new LicenseProvider().status();
  assert.equal(free.tier, "free");
  assert.equal(free.localProjectsLocked, false);
  assert.equal(free.capabilities.localProjectAccess, true);
  assert.equal(free.capabilities.completeRulepacks, false);
  assert.equal(free.capabilities.fullSyncHistory, false);

  const pro = new LicenseProvider({ tier: "pro", entitlementState: "grace" }).status();
  assert.equal(pro.tier, "pro");
  assert.equal(pro.entitlementState, "grace");
  assert.equal(pro.localProjectsLocked, false);
  assert.equal(pro.capabilities.completeRulepacks, true);
  assert.equal(pro.capabilities.allPublishedMechanicalFixes, true);
  assert.equal(pro.capabilities.fullSyncHistory, true);
  assert.equal(pro.deviceLimit, 3);

  const clock = () => new Date("2026-07-28T12:00:00.000Z");
  const derivedGrace = new LicenseProvider({
    tier: "pro",
    validUntil: "2026-07-27T00:00:00.000Z",
    graceUntil: "2026-08-01T00:00:00.000Z",
    clock,
  }).status();
  assert.equal(derivedGrace.entitlementState, "grace");
  assert.equal(derivedGrace.effectiveTier, "pro");
  assert.equal(derivedGrace.signatureVerified, false);

  const expired = new LicenseProvider({
    tier: "pro",
    validUntil: "2026-07-20T00:00:00.000Z",
    graceUntil: "2026-07-21T00:00:00.000Z",
    clock,
  }).status();
  assert.equal(expired.entitlementState, "expired");
  assert.equal(expired.effectiveTier, "free");
  assert.equal(expired.localProjectsLocked, false);
  assert.equal(expired.capabilities.localProjectAccess, true);
  assert.equal(expired.capabilities.completeRulepacks, false);
});

test("SyncRecord v1 contains only the explicit allowlist and strips manuscript content", () => {
  const record = buildSyncRecordV1(source(), { includeIssues: true });
  assert.equal(validateSyncRecordV1(record), true);
  assert.deepEqual(record, {
    schema_version: "1.0",
    record_type: "oak_manuscript_result",
    project_id: "0123456789abcdef",
    run_id: "check-0001",
    idempotency_id: "sync-v1:0123456789abcdef:check-0001",
    event: "export",
    document: {
      format: "docx",
      manuscript_type: "paper",
      check_config: "full",
      language_bucket: "zh",
      length_bucket: "5千—2万字",
    },
    citation: {
      requested_style: "default",
      resolved_style: "gbt7714-2025",
      mode: "style_specific",
      confidence: "high",
      reason_code: "paper_zh_numeric_reference_structure",
      resolver_version: "1.0.0",
    },
    versions: { rulepack: "2.0.0", app: "0.1.0-alpha.9", platform: "win32" },
    counts: {
      total: 2,
      fixable: 1,
      by_severity: { error: 1, warning: 1, suggestion: 0 },
      by_dimension: { citation: 1, punctuation: 1 },
      by_status: { open: 1, resolved: 1 },
    },
    issues: [
      {
        rule_id: "OAK-CN-PUNCT-001",
        severity: "warning",
        dimension: "punctuation",
        status: "open",
        fixable: true,
      },
      {
        rule_id: "OAK-CITE-001",
        severity: "error",
        dimension: "citation",
        status: "resolved",
        fixable: false,
      },
    ],
    external_validation: { epubcheck: "not_applicable", ace: "not_applicable" },
    export_state: "completed",
    created_at: "2026-07-28T12:00:00.000Z",
    authorized_at: "2026-07-28T12:01:00.000Z",
  });
  const serialized = JSON.stringify(record);
  for (const secret of [
    "绝不能同步的标题",
    "C:\\Users\\author\\private.docx",
    "绝不能同步的正文片段",
    "机密原文",
    "机密修订文",
  ]) assert.equal(serialized.includes(secret), false, secret);
});

test("tracked SyncRecord v1 JSON Schema matches the runtime allowlist", () => {
  const schema = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "../config/schemas/sync-record-v1.schema.json"),
    "utf8",
  ));
  const summary = buildSyncRecordV1(source(), { includeIssues: false });
  const detailed = buildSyncRecordV1(source(), { includeIssues: true });
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(detailed).sort());
  assert.deepEqual([...schema.required].sort(), Object.keys(summary).sort());
  for (const key of ["document", "citation", "versions", "counts", "external_validation"]) {
    assert.equal(schema.properties[key].additionalProperties, false, key);
  }
  assert.equal(schema.properties.issues.items.additionalProperties, false);
});

test("SyncRecord validator fails closed on unknown fields, hashes and content-bearing keys", () => {
  const record = buildSyncRecordV1(source());
  for (const [key, value] of [
    ["filename", "private.docx"],
    ["path", "C:\\private.docx"],
    ["title", "秘密标题"],
    ["preview", "秘密正文"],
    ["sha256", "a".repeat(64)],
    ["content_fingerprint", "fingerprint"],
  ]) {
    const poisoned = structuredClone(record);
    poisoned[key] = value;
    assert.throws(() => validateSyncRecordV1(poisoned), /字段|禁止|非法/);
  }
});

test("SyncProvider requires login and explicit choice before idempotent local queueing", () => {
  let sequence = 0;
  const provider = new SyncProvider({
    clock: () => new Date("2026-07-28T12:02:00.000Z"),
    idFactory: () => `queue-${++sequence}`,
  });
  const record = buildSyncRecordV1(source());

  assert.throws(
    () => provider.preview(record, { state: "signed_out", loggedIn: false }),
    /登录/,
  );
  assert.equal(provider.listQueue().length, 0);

  const preview = provider.preview(record, AUTHENTICATED);
  assert.deepEqual(preview.choices, [
    "sync_once",
    "ask_each_time",
    "not_now",
    "never_for_project",
  ]);
  assert.deepEqual(preview.record, record);
  assert.equal(provider.listQueue().length, 0, "preview alone must not queue");

  assert.deepEqual(provider.confirm(record, "not_now", AUTHENTICATED), {
    action: "not_now",
    queued: false,
    preference: "never_asked",
  });
  assert.equal(provider.listQueue().length, 0);

  const queued = provider.confirm(record, "ask_each_time", AUTHENTICATED);
  assert.equal(queued.queued, true);
  assert.equal(queued.item.state, "pending_transport");
  assert.equal(queued.preference, "ask_each_time");
  const duplicate = provider.confirm(record, "sync_once", AUTHENTICATED);
  assert.equal(duplicate.item.queue_id, queued.item.queue_id);
  assert.equal(provider.listQueue().length, 1, "idempotency id must collapse duplicates");

  assert.equal(provider.cancel(queued.item.queue_id).state, "canceled");
  assert.equal(provider.retry(queued.item.queue_id).state, "pending_transport");
  assert.equal(provider.delete(queued.item.queue_id), true);
  assert.equal(provider.listQueue().length, 0);

  const never = provider.confirm(record, "never_for_project", AUTHENTICATED);
  assert.equal(never.queued, false);
  assert.equal(provider.shouldOffer(record.project_id, AUTHENTICATED), false);
});
