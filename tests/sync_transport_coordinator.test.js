"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { SyncTransportError } = require("../electron/sync-http-client");
const {
  SyncTransportCoordinator,
  SyncCoordinatorError,
} = require("../electron/sync-transport-coordinator");
const { SyncProvider, buildSyncRecordV1 } = require("../electron/providers");

const AUTH_A = Object.freeze({
  state: "authenticated",
  loggedIn: true,
  accountId: "account-0001",
  sessionExpiresAt: "2026-08-01T00:00:00.000Z",
});
const AUTH_B = Object.freeze({ ...AUTH_A, accountId: "account-0002" });
const TOKEN = `${"a".repeat(36)}.${"b".repeat(36)}.${"c".repeat(36)}`;

function source() {
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
    appVersion: "0.1.0-alpha.38",
    platform: "win32",
    createdAt: "2026-07-28T12:00:00.000Z",
    authorizedAt: null,
    issues: [],
    externalValidation: { epubcheck: "not_applicable", ace: "not_applicable" },
    exportState: "completed",
  };
}

function queuedProvider() {
  const provider = new SyncProvider({
    clock: () => new Date("2026-07-28T12:02:00.000Z"),
    idFactory: () => "queue-0001",
  });
  const queued = provider.confirm(buildSyncRecordV1(source()), "sync_once", AUTH_A);
  return { provider, queueId: queued.item.queue_id, record: queued.item.payload };
}

function authProvider(initial = AUTH_A) {
  let current = initial;
  return {
    status: () => current,
    set: (value) => { current = value; },
  };
}

test("coordinator is disabled without all main-process dependencies", () => {
  const { provider } = queuedProvider();
  const auth = authProvider();
  assert.throws(() => new SyncTransportCoordinator({
    syncProvider: provider,
    authProvider: auth,
    accessTokenProvider: async () => ({ accessToken: TOKEN, accountId: AUTH_A.accountId }),
  }), /transport/);
  const coordinator = new SyncTransportCoordinator({
    syncProvider: provider,
    authProvider: auth,
    accessTokenProvider: async () => ({ accessToken: TOKEN, accountId: AUTH_A.accountId }),
    transport: { send: async () => null },
  });
  assert.deepEqual(coordinator.status(), { configured: true, in_flight: 0 });
});

test("successful or replayed upload deletes only the exact local queue item", async () => {
  for (const outcome of ["created", "replayed"]) {
    const { provider, queueId, record } = queuedProvider();
    const auth = authProvider();
    const seen = [];
    const coordinator = new SyncTransportCoordinator({
      syncProvider: provider,
      authProvider: auth,
      accessTokenProvider: async ({ accountId }) => ({ accessToken: TOKEN, accountId }),
      transport: {
        async send(input) {
          seen.push(input);
          return {
            outcome,
            idempotency_id: record.idempotency_id,
            received_at: "2026-07-28T12:05:00.000Z",
          };
        },
      },
    });
    const result = await coordinator.flush(queueId);
    assert.deepEqual(result, {
      state: "synced",
      outcome,
      idempotency_id: record.idempotency_id,
      received_at: "2026-07-28T12:05:00.000Z",
    });
    assert.equal(seen[0].accessToken, TOKEN);
    assert.deepEqual(seen[0].record, record);
    assert.equal(provider.listQueue(AUTH_A).length, 0);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  }
});

test("bounded transport failures persist attempts and stable error code until explicit retry", async () => {
  const { provider, queueId } = queuedProvider();
  const auth = authProvider();
  let fail = true;
  const coordinator = new SyncTransportCoordinator({
    syncProvider: provider,
    authProvider: auth,
    accessTokenProvider: async ({ accountId }) => ({ accessToken: TOKEN, accountId }),
    transport: {
      async send({ record }) {
        if (fail) throw new SyncTransportError("TRANSPORT_UNAVAILABLE", true);
        return {
          outcome: "replayed",
          idempotency_id: record.idempotency_id,
          received_at: "2026-07-28T12:05:00.000Z",
        };
      },
    },
  });
  await assert.rejects(coordinator.flush(queueId), (error) =>
    error instanceof SyncCoordinatorError && error.code === "TRANSPORT_UNAVAILABLE" &&
    error.retryable === true);
  let item = provider.listQueue(AUTH_A)[0];
  assert.equal(item.attempts, 1);
  assert.equal(item.last_error, "TRANSPORT_UNAVAILABLE");
  assert.throws(() => provider.transportCandidate(queueId, AUTH_A), /重试/);

  provider.retry(queueId, AUTH_A);
  fail = false;
  assert.equal((await coordinator.flush(queueId)).outcome, "replayed");
  assert.equal(provider.listQueue(AUTH_A).length, 0);
});

test("account change after upload keeps the original account queue for idempotent replay", async () => {
  const { provider, queueId, record } = queuedProvider();
  const auth = authProvider();
  const coordinator = new SyncTransportCoordinator({
    syncProvider: provider,
    authProvider: auth,
    accessTokenProvider: async ({ accountId }) => ({ accessToken: TOKEN, accountId }),
    transport: {
      async send() {
        auth.set(AUTH_B);
        return {
          outcome: "created",
          idempotency_id: record.idempotency_id,
          received_at: "2026-07-28T12:05:00.000Z",
        };
      },
    },
  });
  await assert.rejects(coordinator.flush(queueId), (error) =>
    error instanceof SyncCoordinatorError && error.code === "AUTH_CHANGED");
  const item = provider.listQueue(AUTH_A)[0];
  assert.equal(item.last_error, "AUTH_CHANGED");
  assert.equal(item.attempts, 1);
  assert.equal(provider.listQueue(AUTH_B).length, 0);
});

test("one queue item cannot be flushed concurrently", async () => {
  const { provider, queueId, record } = queuedProvider();
  const auth = authProvider();
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const coordinator = new SyncTransportCoordinator({
    syncProvider: provider,
    authProvider: auth,
    accessTokenProvider: async ({ accountId }) => ({ accessToken: TOKEN, accountId }),
    transport: {
      async send() {
        await blocked;
        return {
          outcome: "created",
          idempotency_id: record.idempotency_id,
          received_at: "2026-07-28T12:05:00.000Z",
        };
      },
    },
  });
  const first = coordinator.flush(queueId);
  await assert.rejects(coordinator.flush(queueId), (error) =>
    error instanceof SyncCoordinatorError && error.code === "SYNC_IN_FLIGHT");
  release();
  await first;
});

test("a token bound to another account fails before transport and preserves the queue", async () => {
  const { provider, queueId } = queuedProvider();
  const auth = authProvider();
  let sends = 0;
  const coordinator = new SyncTransportCoordinator({
    syncProvider: provider,
    authProvider: auth,
    accessTokenProvider: async () => ({ accessToken: TOKEN, accountId: AUTH_B.accountId }),
    transport: { async send() { sends += 1; } },
  });
  await assert.rejects(coordinator.flush(queueId), (error) =>
    error instanceof SyncCoordinatorError && error.code === "AUTH_CHANGED");
  assert.equal(sends, 0);
  const item = provider.listQueue(AUTH_A)[0];
  assert.equal(item.last_error, "AUTH_CHANGED");
  assert.equal(item.attempts, 1);
});
