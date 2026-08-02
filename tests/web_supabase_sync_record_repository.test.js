"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildSyncRecordV1 } = require("../electron/providers");
const {
  canonicalSyncRecordV1,
} = require("../web/sync-record-service");
const {
  RPC_NAMES,
  SupabaseSyncRecordRepository,
  SupabaseSyncRecordRepositoryError,
  validateCreateResult,
  validateStoredRow,
} = require("../web/supabase-sync-record-repository");

const ORIGIN = "https://project-ref.supabase.co";
const SERVICE_KEY = `service_role_${"k".repeat(48)}`;
const ACCOUNT = "8f3b65e1-0e6e-42b4-81c0-61e5cf9a1020";

function record(runId = "check-0001") {
  return buildSyncRecordV1({
    projectId: "0123456789abcdef",
    runId,
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

function row(overrides = {}) {
  const value = record();
  return {
    account_id: ACCOUNT,
    canonical_record: canonicalSyncRecordV1(value),
    received_at: "2026-07-28T12:05:00.000Z",
    record: value,
    ...overrides,
  };
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function repository(fetchImpl, options = {}) {
  return new SupabaseSyncRecordRepository({
    supabaseOrigin: ORIGIN,
    serviceRoleKey: SERVICE_KEY,
    fetchImpl,
    ...options,
  });
}

function expectCode(code) {
  return (error) => error instanceof SupabaseSyncRecordRepositoryError &&
    error.code === code && !error.message.includes(SERVICE_KEY);
}

test("sync repository configuration is server-only, HTTPS, bounded, and injection-safe", () => {
  const valid = { supabaseOrigin: ORIGIN, serviceRoleKey: SERVICE_KEY, fetchImpl: async () => null };
  for (const supabaseOrigin of [undefined, "http://project.supabase.co", `${ORIGIN}/rest`, `${ORIGIN}?x=1`]) {
    assert.throws(() => new SupabaseSyncRecordRepository({ ...valid, supabaseOrigin }), /HTTPS origin/);
  }
  for (const serviceRoleKey of [undefined, "short", `${SERVICE_KEY}\r\nX: yes`, `${SERVICE_KEY},other`]) {
    assert.throws(() => new SupabaseSyncRecordRepository({ ...valid, serviceRoleKey }), /serviceRoleKey/);
  }
  assert.throws(() => new SupabaseSyncRecordRepository({ ...valid, timeoutMs: 99 }), /timeoutMs/);
  assert.throws(() => new SupabaseSyncRecordRepository({ ...valid, maxResponseBytes: 9 * 1024 * 1024 }),
    /maxResponseBytes/);
});

test("atomic create-or-replay uses one fixed RPC and exact service-role request", async () => {
  const candidate = row();
  const seen = [];
  const target = repository(async (url, options) => {
    seen.push({ url, options });
    return jsonResponse({
      schema_version: "1.0",
      result_type: "oak_manuscript_sync_record_create_result",
      outcome: "created",
      row: candidate,
    });
  });
  const result = await target.createOrReplay(
    ACCOUNT,
    candidate.canonical_record,
    candidate,
    200,
  );
  assert.equal(result.outcome, "created");
  assert.equal(Object.isFrozen(result.row), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `${ORIGIN}/rest/v1/rpc/${RPC_NAMES.create}`);
  assert.deepEqual(seen[0].options.headers, {
    accept: "application/json",
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    "content-type": "application/json",
  });
  assert.equal(seen[0].options.redirect, "error");
  assert.equal(seen[0].options.cache, "no-store");
  assert.equal(seen[0].options.credentials, "omit");
  assert.deepEqual(JSON.parse(seen[0].options.body), {
    p_account_id: ACCOUNT,
    p_idempotency_id: candidate.record.idempotency_id,
    p_canonical_record: candidate.canonical_record,
    p_record: candidate.record,
    p_max_records: 200,
  });
});

test("owned snapshot list, get, and delete use bounded fixed RPC contracts", async () => {
  const calls = [];
  const responses = [{ rows: [row()], total: 1 }, row(), true];
  const target = repository(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return jsonResponse(responses.shift());
  });
  const listed = await target.listOwned(ACCOUNT, 50);
  assert.equal(listed.rows.length, 1);
  assert.equal(listed.total, 1);
  assert.equal((await target.getOwned(ACCOUNT, row().record.idempotency_id)).account_id, ACCOUNT);
  assert.equal(await target.deleteOwned(ACCOUNT, row().record.idempotency_id), true);
  assert.deepEqual(calls.map((call) => call.url), [
    RPC_NAMES.list, RPC_NAMES.get, RPC_NAMES.delete,
  ].map((name) => `${ORIGIN}/rest/v1/rpc/${name}`));
  assert.deepEqual(calls[0].body, { p_account_id: ACCOUNT, p_limit: 50 });
  assert.deepEqual(calls[1].body, {
    p_account_id: ACCOUNT,
    p_idempotency_id: row().record.idempotency_id,
  });
});

test("database responses fail closed on ownership drift, content fields, and malformed outcomes", () => {
  assert.equal(validateStoredRow(row(), ACCOUNT).account_id, ACCOUNT);
  assert.throws(() => validateStoredRow(row({ account_id: "other-account-0001" }), ACCOUNT), /归属/);
  assert.throws(() => validateStoredRow({ ...row(), filename: "private.docx" }, ACCOUNT), /字段/);
  const poisoned = row();
  poisoned.record.filename = "private.docx";
  assert.throws(() => validateStoredRow(poisoned, ACCOUNT), /SyncRecord|禁止|字段/);
  assert.throws(() => validateCreateResult({
    schema_version: "1.0",
    result_type: "oak_manuscript_sync_record_create_result",
    outcome: "conflict",
    row: row(),
  }, ACCOUNT), /row/);
});

test("write inputs reject extra fields, bad limits, and inconsistent canonical bytes before fetch", async () => {
  let calls = 0;
  const target = repository(async () => { calls += 1; return jsonResponse(null); });
  const candidate = row();
  await assert.rejects(target.createOrReplay(
    ACCOUNT,
    `${candidate.canonical_record} `,
    candidate,
    200,
  ), /canonical/);
  await assert.rejects(target.createOrReplay(ACCOUNT, candidate.canonical_record, candidate, 501), /maximum/);
  await assert.rejects(target.createOrReplay(
    ACCOUNT,
    candidate.canonical_record,
    { ...candidate, manuscript: "secret" },
    200,
  ), /字段/);
  assert.equal(calls, 0);
});

test("upstream errors, malformed JSON, oversized declarations, and timeouts are bounded", async () => {
  for (const [response, code] of [
    [jsonResponse({ message: `leak ${SERVICE_KEY}` }, 401), "SYNC_DB_UNAUTHORIZED"],
    [jsonResponse({ message: `leak ${SERVICE_KEY}` }, 429), "SYNC_DB_UNAVAILABLE"],
    [new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
      "SYNC_DB_INVALID_RESPONSE"],
    [new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "999999" },
    }), "SYNC_DB_INVALID_RESPONSE"],
  ]) {
    const target = repository(async () => response);
    await assert.rejects(target.listOwned(ACCOUNT, 50), expectCode(code));
  }
  const timed = repository(async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error(`aborted ${SERVICE_KEY}`);
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  }), { timeoutMs: 100 });
  await assert.rejects(timed.listOwned(ACCOUNT, 50), expectCode("SYNC_DB_TIMEOUT"));
});

test("tracked sync SQL is transactional, owner-scoped, service-role only, and concurrency aware", () => {
  const sql = fs.readFileSync(path.join(
    __dirname, "..", "web", "supabase", "002_sync_records.sql",
  ), "utf8");
  for (const required of [
    "begin;",
    "commit;",
    "create table if not exists public.oak_manuscript_sync_records",
    "enable row level security",
    "force row level security",
    "pg_advisory_xact_lock",
    "for update",
    "oak_manuscript_sync_record_create_or_replay",
    "oak_manuscript_sync_record_list",
    "oak_manuscript_sync_record_get",
    "oak_manuscript_sync_record_delete",
    "grant execute on function",
    "to service_role",
    "from public, anon, authenticated",
  ]) assert.equal(sql.toLowerCase().includes(required.toLowerCase()), true, required);
  assert.equal(/grant\s+(?:all|select|insert|update|delete).*\bto\s+(?:anon|authenticated)\b/iu.test(sql), false);
  assert.equal(/\b(?:manuscript_bytes|manuscript_content|file_name|filename|file_path)\s+(?:text|jsonb|bytea)\b/iu.test(sql), false);
  assert.equal(/\bexecute\s+(?:format\s*\(|[^;]*\|\|)/iu.test(sql), false);
  assert.match(sql, /revoke all on function public\.oak_manuscript_sync_record_delete\(text,text\)\s+from public, anon, authenticated;/iu);
  assert.match(sql, /grant execute on function public\.oak_manuscript_sync_record_delete\(text,text\)\s+to service_role;/iu);
});
