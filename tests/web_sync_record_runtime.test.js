"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildSyncRecordV1 } = require("../electron/providers");
const { canonicalSyncRecordV1 } = require("../web/sync-record-service");
const { createSyncRecordFetchHandler } = require("../web/sync-record-runtime");

const API_ORIGIN = "https://manuscript.test";
const SUPABASE_ORIGIN = "https://project-ref.supabase.co";
const API_KEY = `sb_publishable_${"a".repeat(40)}`;
const SERVICE_KEY = `service_role_${"b".repeat(48)}`;
const TOKEN = `${"c".repeat(36)}.${"d".repeat(36)}.${"e".repeat(36)}`;
const ACCOUNT = "8f3b65e1-0e6e-42b4-81c0-61e5cf9a1020";

function record() {
  return buildSyncRecordV1({
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
    appVersion: "0.1.0-alpha.38",
    platform: "win32",
    createdAt: "2026-07-28T12:00:00.000Z",
    authorizedAt: "2026-07-28T12:01:00.000Z",
    issues: [],
    externalValidation: { epubcheck: "not_applicable", ace: "not_applicable" },
    exportState: "completed",
  });
}

test("production sync composition requires separate public and service credentials plus audit sink", () => {
  const base = {
    apiOrigin: API_ORIGIN,
    supabaseOrigin: SUPABASE_ORIGIN,
    supabaseApiKey: API_KEY,
    supabaseServiceRoleKey: SERVICE_KEY,
    fetchImpl: async () => null,
    securityEventSink() {},
  };
  assert.throws(() => createSyncRecordFetchHandler({ ...base, securityEventSink: undefined }), /securityEventSink/);
  assert.throws(() => createSyncRecordFetchHandler({
    ...base,
    supabaseApiKey: SERVICE_KEY,
  }), /必须分离/);
});

test("one production-style Fetch request verifies GoTrue identity then atomically stores the record", async () => {
  const calls = [];
  const events = [];
  const value = record();
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === `${SUPABASE_ORIGIN}/auth/v1/user`) {
      assert.equal(options.headers.authorization, `Bearer ${TOKEN}`);
      assert.equal(options.headers.apikey, API_KEY);
      return new Response(JSON.stringify({ id: ACCOUNT, email: "private@example.test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    assert.equal(url, `${SUPABASE_ORIGIN}/rest/v1/rpc/oak_manuscript_sync_record_create_or_replay`);
    assert.equal(options.headers.authorization, `Bearer ${SERVICE_KEY}`);
    const input = JSON.parse(options.body);
    assert.equal(input.p_account_id, ACCOUNT);
    assert.equal(input.p_canonical_record, canonicalSyncRecordV1(value));
    return new Response(JSON.stringify({
      schema_version: "1.0",
      result_type: "oak_manuscript_sync_record_create_result",
      outcome: "created",
      row: {
        account_id: ACCOUNT,
        canonical_record: input.p_canonical_record,
        received_at: "2026-07-28T12:05:00.000Z",
        record: input.p_record,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const handler = createSyncRecordFetchHandler({
    apiOrigin: API_ORIGIN,
    supabaseOrigin: SUPABASE_ORIGIN,
    supabaseApiKey: API_KEY,
    supabaseServiceRoleKey: SERVICE_KEY,
    fetchImpl,
    clock: () => new Date("2026-07-28T12:05:00.000Z"),
    requestIdFactory: () => "20000000-0000-4000-8000-000000000001",
    securityEventSink: (event) => events.push(event),
  });
  const body = JSON.stringify(value);
  const response = await handler(new Request(
    `${API_ORIGIN}/manuscript/api/v1/sync-records`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        origin: API_ORIGIN,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body, "utf8")),
      },
      body,
    },
  ));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).outcome, "created");
  assert.equal(calls.length, 2);
  assert.equal(events.length, 1);
  assert.equal(events[0].http_status, 201);
  const serialized = JSON.stringify(events);
  for (const secret of [TOKEN, API_KEY, SERVICE_KEY, ACCOUNT]) {
    assert.equal(serialized.includes(secret), false);
  }
});
