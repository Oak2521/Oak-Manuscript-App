// Coordinates the encrypted local queue with a main-process-only network transport.

"use strict";

const { SyncTransportError } = require("./sync-http-client");

const ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "需要有效的湖岸账号会话才能同步",
  AUTH_CHANGED: "同步期间湖岸账号会话发生变化；本地记录已保留以便幂等重试",
  SYNC_IN_FLIGHT: "该同步记录正在发送",
  INVALID_RESPONSE: "同步 transport 返回了非法成功回执",
  TRANSPORT_TIMEOUT: "结果同步请求超时",
  TRANSPORT_UNAVAILABLE: "结果同步服务暂时不可用",
  RECORD_REJECTED: "服务端拒绝了同步记录",
  IDEMPOTENCY_CONFLICT: "同步记录与服务端既有幂等记录冲突",
  ACCOUNT_RECORD_LIMIT: "当前账号的同步记录数量已达上限",
});

class SyncCoordinatorError extends Error {
  constructor(code, retryable = false) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.TRANSPORT_UNAVAILABLE);
    this.name = "SyncCoordinatorError";
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : "TRANSPORT_UNAVAILABLE";
    this.retryable = retryable === true;
  }
}

function dependency(value, methods, label) {
  if (!value || methods.some((name) => typeof value[name] !== "function")) {
    throw new TypeError(`${label} 接口不完整`);
  }
  return value;
}

function authenticated(status) {
  return status && status.state === "authenticated" && status.loggedIn === true &&
    typeof status.accountId === "string" && status.accountId.length > 0;
}

function tokenBinding(value, expectedAccountId) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== ["accessToken", "accountId"].sort().join("\0") ||
      typeof value.accountId !== "string" || typeof value.accessToken !== "string" ||
      value.accessToken.length < 32) {
    throw new SyncCoordinatorError("AUTH_REQUIRED", false);
  }
  if (value.accountId !== expectedAccountId) throw new SyncCoordinatorError("AUTH_CHANGED", false);
  return value.accessToken;
}

function exactSuccess(value, expectedId) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !==
        ["outcome", "idempotency_id", "received_at"].sort().join("\0") ||
      !["created", "replayed"].includes(value.outcome) ||
      value.idempotency_id !== expectedId || typeof value.received_at !== "string" ||
      Number.isNaN(Date.parse(value.received_at)) ||
      new Date(value.received_at).toISOString() !== value.received_at) {
    throw new SyncCoordinatorError("INVALID_RESPONSE", false);
  }
  return value;
}

class SyncTransportCoordinator {
  constructor({ syncProvider, authProvider, accessTokenProvider, transport } = {}) {
    this.syncProvider = dependency(syncProvider, [
      "transportCandidate", "transportFailed", "transportSucceeded",
    ], "syncProvider");
    this.authProvider = dependency(authProvider, ["status"], "authProvider");
    if (typeof accessTokenProvider !== "function") {
      throw new TypeError("accessTokenProvider 必须是主进程函数");
    }
    this.transport = dependency(transport, ["send"], "transport");
    this.accessTokenProvider = accessTokenProvider;
    this.inFlight = new Set();
  }

  status() {
    return Object.freeze({ configured: true, in_flight: this.inFlight.size });
  }

  async flush(queueId) {
    if (typeof queueId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(queueId)) {
      throw new TypeError("queueId 非法");
    }
    if (this.inFlight.has(queueId)) throw new SyncCoordinatorError("SYNC_IN_FLIGHT", true);
    const authAtStart = this.authProvider.status();
    if (!authenticated(authAtStart)) throw new SyncCoordinatorError("AUTH_REQUIRED", false);
    const candidate = this.syncProvider.transportCandidate(queueId, authAtStart);
    this.inFlight.add(queueId);
    let failureRecorded = false;
    try {
      const accessToken = tokenBinding(
        await this.accessTokenProvider(Object.freeze({ accountId: authAtStart.accountId })),
        authAtStart.accountId,
      );
      const authBeforeSend = this.authProvider.status();
      if (!authenticated(authBeforeSend) || authBeforeSend.accountId !== authAtStart.accountId) {
        throw new SyncCoordinatorError("AUTH_CHANGED", false);
      }
      const raw = await this.transport.send({ accessToken, record: candidate.payload });
      const result = exactSuccess(raw, candidate.idempotency_id);
      const authAfterSend = this.authProvider.status();
      if (!authenticated(authAfterSend) || authAfterSend.accountId !== authAtStart.accountId) {
        this.syncProvider.transportFailed(queueId, authAtStart, "AUTH_CHANGED");
        failureRecorded = true;
        throw new SyncCoordinatorError("AUTH_CHANGED", false);
      }
      this.syncProvider.transportSucceeded(queueId, authAtStart, result.idempotency_id);
      return Object.freeze({
        state: "synced",
        outcome: result.outcome,
        idempotency_id: result.idempotency_id,
        received_at: result.received_at,
      });
    } catch (error) {
      let normalized;
      if (error instanceof SyncCoordinatorError) normalized = error;
      else if (error instanceof SyncTransportError) {
        normalized = new SyncCoordinatorError(error.code, error.retryable);
      } else {
        normalized = new SyncCoordinatorError("TRANSPORT_UNAVAILABLE", true);
      }
      if (!failureRecorded) {
        try {
          this.syncProvider.transportFailed(queueId, authAtStart, normalized.code);
          failureRecorded = true;
        } catch {
          // A concurrent durable-state change must not be masked by a fabricated success.
        }
      }
      throw normalized;
    } finally {
      this.inFlight.delete(queueId);
    }
  }
}

module.exports = {
  SyncCoordinatorError,
  SyncTransportCoordinator,
};
