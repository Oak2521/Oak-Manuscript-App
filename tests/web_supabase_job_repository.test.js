"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const {
  RPC_NAMES,
  SupabaseJobRepository,
  SupabaseJobRepositoryError,
  validateCreateResult,
  validateInternalRecord,
} = require("../web/supabase-job-repository");

const ORIGIN = "https://project-ref.supabase.co";
const SERVICE_KEY = `service_role_${"k".repeat(48)}`;
const OWNER = "account:8f3b65e1-0e6e-42b4-81c0-61e5cf9a1020";
const JOB_ID = "webjob-10000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "persistent-job-request-0001";
const DOCUMENT = Object.freeze({
  format: "txt",
  manuscript_type: "paper",
  check_config: "full",
  citation_style: "default",
  size_bytes: 6,
});
const CANONICAL = JSON.stringify({
  schema_version: "1.0",
  request_type: "oak_manuscript_web_job",
  idempotency_key: IDEMPOTENCY_KEY,
  consent: {
    granted: true,
    scope: "single_job_processing",
    privacy_version: "web-privacy-v1",
    granted_at: "2026-07-28T12:00:00.000Z",
  },
  document: DOCUMENT,
});
const FINGERPRINT = createHash("sha256").update(CANONICAL, "utf8").digest("hex");

function record(overrides = {}) {
  return {
    schema_version: "1.0",
    record_type: "oak_manuscript_web_job_internal",
    job_id: JOB_ID,
    owner_key: OWNER,
    state: "awaiting_upload",
    created_at: "2026-07-28T12:00:00.000Z",
    updated_at: "2026-07-28T12:00:00.000Z",
    expires_at: "2026-07-28T12:15:00.000Z",
    input_retained: false,
    result_available: false,
    result_media_type: null,
    pending_deletion_reason: null,
    request_fingerprint: FINGERPRINT,
    request_canonical: CANONICAL,
    idempotency_key: IDEMPOTENCY_KEY,
    document: { ...DOCUMENT },
    upload_reservation_id: null,
    upload_reservation_expires_at: null,
    lease_id: null,
    lease_expires_at: null,
    revision: 0,
    ...overrides,
  };
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function repository(fetchImpl) {
  return new SupabaseJobRepository({
    supabaseOrigin: ORIGIN,
    serviceRoleKey: SERVICE_KEY,
    fetchImpl,
  });
}

function createInput() {
  return {
    owner_key: OWNER,
    job_id: JOB_ID,
    idempotency_key: IDEMPOTENCY_KEY,
    request_fingerprint: FINGERPRINT,
    request_canonical: CANONICAL,
    document: { ...DOCUMENT },
    ttl_seconds: 900,
    max_active_per_owner: 2,
    max_active_global: 100,
  };
}

function expectCode(code) {
  return (error) => error instanceof SupabaseJobRepositoryError && error.code === code &&
    !error.message.includes(SERVICE_KEY);
}

test("repository configuration is server-only, HTTPS, bounded, and injection-safe", () => {
  const valid = { supabaseOrigin: ORIGIN, serviceRoleKey: SERVICE_KEY, fetchImpl: async () => null };
  for (const supabaseOrigin of [undefined, "http://project.supabase.co", `${ORIGIN}/rest`, `${ORIGIN}?x=1`]) {
    assert.throws(() => new SupabaseJobRepository({ ...valid, supabaseOrigin }), /HTTPS origin/);
  }
  for (const serviceRoleKey of [undefined, "short", `${SERVICE_KEY}\r\nX: yes`, `${SERVICE_KEY},other`]) {
    assert.throws(() => new SupabaseJobRepository({ ...valid, serviceRoleKey }), /serviceRoleKey/);
  }
  assert.throws(() => new SupabaseJobRepository({ ...valid, timeoutMs: 99 }), /timeoutMs/);
  assert.throws(() => new SupabaseJobRepository({ ...valid, maxResponseBytes: 257 * 1024 }),
    /maxResponseBytes/);
});

test("atomic create-or-replay uses one fixed RPC and exact service-role request", async () => {
  const seen = [];
  const repo = repository(async (url, options) => {
    seen.push({ url, options });
    return jsonResponse({
      schema_version: "1.0",
      result_type: "oak_manuscript_web_job_create_result",
      outcome: "created",
      record: record(),
    });
  });
  const result = await repo.createOrReplay(createInput());
  assert.equal(result.outcome, "created");
  assert.equal(Object.isFrozen(result.record), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `${ORIGIN}/rest/v1/rpc/${RPC_NAMES.create}`);
  assert.equal(seen[0].options.method, "POST");
  assert.equal(seen[0].options.redirect, "error");
  assert.equal(seen[0].options.cache, "no-store");
  assert.equal(seen[0].options.credentials, "omit");
  assert.deepEqual(seen[0].options.headers, {
    accept: "application/json",
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    "content-type": "application/json",
  });
  assert.deepEqual(JSON.parse(seen[0].options.body), {
    p_owner_key: OWNER,
    p_job_id: JOB_ID,
    p_idempotency_key: IDEMPOTENCY_KEY,
    p_request_fingerprint: FINGERPRINT,
    p_request_canonical: CANONICAL,
    p_document: DOCUMENT,
    p_ttl_seconds: 900,
    p_max_active_per_owner: 2,
    p_max_active_global: 100,
  });
});

test("create outcomes preserve replay while conflicts, tombstones, and limits expose no record", async () => {
  assert.equal(validateCreateResult({
    schema_version: "1.0",
    result_type: "oak_manuscript_web_job_create_result",
    outcome: "replayed",
    record: record(),
  }).outcome, "replayed");
  for (const outcome of ["conflict", "terminal", "job_id_collision", "owner_limit", "global_limit"]) {
    const result = validateCreateResult({
      schema_version: "1.0",
      result_type: "oak_manuscript_web_job_create_result",
      outcome,
      record: null,
    });
    assert.equal(result.record, null);
  }
  assert.throws(() => validateCreateResult({
    schema_version: "1.0",
    result_type: "oak_manuscript_web_job_create_result",
    outcome: "conflict",
    record: record(),
  }), /record/);
});

test("owned reads, lists, CAS, private claim, deletion finalization, and expiry scan use fixed RPC contracts", async () => {
  const calls = [];
  const queued = record({
    state: "queued",
    updated_at: "2026-07-28T12:00:01.000Z",
    input_retained: true,
    revision: 1,
  });
  const leaseId = "10000000-0000-4000-8000-000000000002";
  const processing = record({
    state: "processing",
    updated_at: "2026-07-28T12:00:02.000Z",
    input_retained: true,
    lease_id: leaseId,
    lease_expires_at: "2026-07-28T12:05:02.000Z",
    revision: 2,
  });
  const responses = [record(), [record()], queued, processing, true, [queued]];
  const repo = repository(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return jsonResponse(responses.shift());
  });

  assert.equal((await repo.getOwned({ owner_key: OWNER, job_id: JOB_ID })).job_id, JOB_ID);
  assert.equal((await repo.listOwned({ owner_key: OWNER })).length, 1);
  const swapped = await repo.compareAndSwap({
    owner_key: OWNER,
    job_id: JOB_ID,
    expected_revision: 0,
    expected_states: ["awaiting_upload"],
    next: {
      state: "queued",
      input_retained: true,
      result_available: false,
      result_media_type: null,
      pending_deletion_reason: null,
      upload_reservation_id: null,
      upload_reservation_expires_at: null,
      lease_id: null,
      lease_expires_at: null,
    },
  });
  assert.equal(swapped.revision, 1);
  assert.equal((await repo.claimNext({ lease_id: leaseId, lease_seconds: 300 })).lease_id, leaseId);
  assert.equal(await repo.finalizeDeletion({ owner_key: OWNER, job_id: JOB_ID, expected_revision: 2 }), true);
  assert.equal((await repo.listExpired({ before: "2026-07-28T12:15:00.000Z", limit: 20 })).length, 1);
  assert.deepEqual(calls.map((call) => call.url), [
    RPC_NAMES.get,
    RPC_NAMES.list,
    RPC_NAMES.compareAndSwap,
    RPC_NAMES.claimNext,
    RPC_NAMES.finalizeDeletion,
    RPC_NAMES.listExpired,
  ].map((name) => `${ORIGIN}/rest/v1/rpc/${name}`));
  assert.deepEqual(calls[2].body.p_expected_states, ["awaiting_upload"]);
  assert.equal(calls[2].body.p_next_state, "queued");
  assert.deepEqual(calls[3].body, { p_lease_id: leaseId, p_lease_seconds: 300 });
});

test("internal records and write inputs fail closed on extra fields, content metadata, and inconsistent state", async () => {
  assert.throws(() => validateInternalRecord({ ...record(), filename: "private.txt" }), /字段集合/);
  assert.throws(() => validateInternalRecord(record({ result_available: true })), /跨字段/);
  assert.throws(() => validateInternalRecord(record({
    state: "processing", input_retained: true,
  })), /状态载荷/);
  assert.throws(() => validateInternalRecord(record({
    request_canonical: CANONICAL.replace('"size_bytes":6', '"size_bytes":7'),
  })), /不一致/);
  const reorderedDocument = Object.fromEntries(Object.entries(DOCUMENT).reverse());
  assert.equal(validateInternalRecord(record({ document: reorderedDocument })).job_id, JOB_ID);
  assert.throws(() => validateInternalRecord(record({ request_fingerprint: "b".repeat(64) })),
    /request_fingerprint/);
  const repo = repository(async () => jsonResponse(null));
  await assert.rejects(repo.createOrReplay({ ...createInput(), manuscript: "secret" }), /字段集合/);
  await assert.rejects(repo.createOrReplay({
    ...createInput(),
    document: { ...DOCUMENT, filename: "private.txt" },
  }), /字段集合/);
  await assert.rejects(repo.compareAndSwap({
    owner_key: OWNER,
    job_id: JOB_ID,
    expected_revision: 0,
    expected_states: ["awaiting_upload", "awaiting_upload"],
    next: {},
  }), /期望版本或状态/);
});

test("upstream errors, malformed bodies, and oversized declarations are bounded and non-reflective", async () => {
  for (const [response, code] of [
    [jsonResponse({ message: `leak ${SERVICE_KEY}` }, 401), "JOB_DB_UNAUTHORIZED"],
    [jsonResponse({ message: `leak ${SERVICE_KEY}` }, 429), "JOB_DB_UNAVAILABLE"],
    [new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
      "JOB_DB_INVALID_RESPONSE"],
    [new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "999999" },
    }), "JOB_DB_INVALID_RESPONSE"],
  ]) {
    const repo = repository(async () => response);
    await assert.rejects(repo.getOwned({ owner_key: OWNER, job_id: JOB_ID }), expectCode(code));
  }
  const repo = repository(async () => { throw new Error(`network ${SERVICE_KEY}`); });
  await assert.rejects(repo.getOwned({ owner_key: OWNER, job_id: JOB_ID }),
    expectCode("JOB_DB_UNAVAILABLE"));
});

test("timeout aborts the exact database request without reflecting credentials", async () => {
  const repo = new SupabaseJobRepository({
    supabaseOrigin: ORIGIN,
    serviceRoleKey: SERVICE_KEY,
    timeoutMs: 100,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error(`aborted ${SERVICE_KEY}`);
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });
  await assert.rejects(repo.getOwned({ owner_key: OWNER, job_id: JOB_ID }),
    expectCode("JOB_DB_TIMEOUT"));
});

test("tracked SQL is transactional, service-role only, content-free, and concurrency aware", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "web", "supabase", "001_web_job_state.sql"),
    "utf8");
  for (const required of [
    "begin;",
    "commit;",
    "create table if not exists public.oak_manuscript_web_jobs",
    "create table if not exists public.oak_manuscript_web_job_idempotency",
    "enable row level security",
    "force row level security",
    "pg_advisory_xact_lock",
    "for update",
    "revision = revision + 1",
    "active upload reservation cannot be replaced",
    "active processing lease cannot be replaced",
    "for update skip locked",
    "expires_at > v_now + make_interval",
    "oak_manuscript_web_job_claim_next",
    "oak_manuscript_web_job_create_or_replay",
    "oak_manuscript_web_job_compare_and_swap",
    "oak_manuscript_web_job_finalize_deletion",
    "grant execute on function",
    "to service_role",
    "from public, anon, authenticated",
  ]) {
    assert.equal(sql.toLowerCase().includes(required.toLowerCase()), true, required);
  }
  assert.equal(/grant\s+(?:all|select|insert|update|delete).*\bto\s+(?:anon|authenticated)\b/iu.test(sql), false);
  assert.equal(/\b(?:bytea|manuscript_bytes|manuscript_content|file_name|filename|file_path)\b/iu.test(sql), false);
  assert.equal(/\bexecute\s+(?:format\s*\(|[^;]*\|\|)/iu.test(sql), false);

  const internalSchema = JSON.parse(fs.readFileSync(path.join(
    __dirname, "..", "web", "schemas", "web-job-internal-v1.schema.json"), "utf8"));
  const createSchema = JSON.parse(fs.readFileSync(path.join(
    __dirname, "..", "web", "schemas", "web-job-create-result-v1.schema.json"), "utf8"));
  assert.deepEqual([...internalSchema.required].sort(), Object.keys(record()).sort());
  assert.deepEqual([...createSchema.required].sort(),
    ["schema_version", "result_type", "outcome", "record"].sort());
});
