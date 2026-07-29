// 账号、权益和同步 IPC。Renderer 只能传项目句柄和有限枚举，不能提供同步正文或任意 payload。

"use strict";

const path = require("path");
const { toFailureResponse } = require("./core-result");

function ok(data = {}) { return { ok: true, ...data }; }
function fail(error) { return toFailureResponse(error); }

function projectDir(value, pathPolicy) {
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value)) {
    throw new Error("参数非法：project");
  }
  if (!pathPolicy.looksLikeProject(value)) throw new Error("该目录不是湖岸稿件项目");
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`参数非法：${label}`);
  return value;
}

function opaqueId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/.test(value)) {
    throw new Error(`参数非法：${label}`);
  }
  return value;
}

function authenticatedStatus(authProvider) {
  const status = authProvider.status();
  if (!status || status.loggedIn !== true || status.state !== "authenticated" ||
      typeof status.accountId !== "string" || !status.accountId) {
    throw new Error("必须先登录湖岸账号；登录本身不代表同意同步");
  }
  return status;
}

function registerAccountSyncIpc({
  ipcMain,
  pathPolicy,
  authProvider,
  licenseProvider,
  syncProvider,
  syncRecordSource,
  getSyncCoordinator = () => null,
}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("ipcMain 非法");
  const previews = new Map();

  ipcMain.handle("provider:auth-status", () => ok(authProvider.status()));
  ipcMain.handle("provider:auth-begin", async () => {
    try { return ok(await authProvider.beginLogin()); } catch (error) { return fail(error); }
  });
  ipcMain.handle("provider:auth-logout", async () => {
    try {
      const status = await authProvider.logout();
      previews.clear();
      return ok(status);
    } catch (error) { return fail(error); }
  });
  ipcMain.handle("provider:license-status", () => ok(licenseProvider.status()));
  ipcMain.handle("provider:license-refresh", async () => {
    try {
      const status = authenticatedStatus(authProvider);
      return ok({ status: await licenseProvider.refresh(status) });
    } catch (error) { return fail(error); }
  });
  ipcMain.handle("provider:sync-preference", (_event, payload = {}) => {
    try {
      if (payload.value !== undefined) syncProvider.setPreference(payload.value);
      return ok({
        preference: syncProvider.getPreference(),
        persistence: typeof syncProvider.persistenceStatus === "function"
          ? syncProvider.persistenceStatus()
          : { state: "memory_only", encrypted: false, persistent: false },
      });
    } catch (error) { return fail(error); }
  });

  ipcMain.handle("provider:sync-preview", async (_event, payload = {}) => {
    try {
      const project = projectDir(payload.project, pathPolicy);
      const event = enumValue(payload.event, ["check", "export"], "event");
      if (typeof payload.includeIssues !== "boolean") throw new Error("参数非法：includeIssues");
      const authStatus = authenticatedStatus(authProvider);
      const record = await syncRecordSource(project, event, payload.includeIssues);
      const preview = syncProvider.preview(record, authStatus);
      previews.set(record.idempotency_id, { record, accountId: authStatus.accountId });
      const coordinator = getSyncCoordinator();
      return ok({
        preview: {
          ...preview,
          transportConfigured: coordinator !== null && typeof coordinator?.flush === "function",
        },
      });
    } catch (error) { return fail(error); }
  });

  ipcMain.handle("provider:sync-confirm", async (_event, payload = {}) => {
    try {
      const id = opaqueId(payload.idempotencyId, "idempotencyId");
      const choice = enumValue(
        payload.choice,
        ["sync_once", "ask_each_time", "not_now", "never_for_project"],
        "choice",
      );
      const cached = previews.get(id);
      if (!cached) throw new Error("同步预览不存在或已过期，请重新预览");
      const authStatus = authenticatedStatus(authProvider);
      if (cached.accountId !== authStatus.accountId) {
        previews.delete(id);
        throw new Error("账号已变化，同步预览已失效，请重新预览");
      }
      const result = syncProvider.confirm(cached.record, choice, authStatus);
      previews.delete(id);
      if (!result || result.queued !== true) {
        return ok({ result, delivery: { state: "not_requested" } });
      }
      const coordinator = getSyncCoordinator();
      if (!coordinator || typeof coordinator.flush !== "function") {
        return ok({ result, delivery: { state: "queued", transportConfigured: false } });
      }
      try {
        const delivery = await coordinator.flush(result.item.queue_id);
        return ok({ result, delivery });
      } catch (deliveryError) {
        const failure = fail(deliveryError);
        return ok({
          result,
          delivery: {
            state: "queued",
            transportConfigured: true,
            error: failure.error,
            ...(failure.code ? { code: failure.code } : {}),
            ...(failure.retryable !== undefined ? { retryable: failure.retryable } : {}),
          },
        });
      }
    } catch (error) { return fail(error); }
  });

  ipcMain.handle("provider:sync-queue", () => {
    try {
      const status = authProvider.status();
      const persistence = typeof syncProvider.persistenceStatus === "function"
        ? syncProvider.persistenceStatus()
        : { state: "memory_only", encrypted: false, persistent: false };
      if (!status || status.loggedIn !== true || status.state !== "authenticated") {
        return ok({ items: [], signedOut: true, persistence, transportConfigured: getSyncCoordinator() !== null });
      }
      return ok({ items: syncProvider.listQueue(status), signedOut: false, persistence, transportConfigured: getSyncCoordinator() !== null });
    } catch (error) { return fail(error); }
  });
  ipcMain.handle("provider:sync-cancel", (_event, payload = {}) => {
    try {
      return ok({
        item: syncProvider.cancel(
          opaqueId(payload.queueId, "queueId"),
          authenticatedStatus(authProvider),
        ),
      });
    }
    catch (error) { return fail(error); }
  });
  ipcMain.handle("provider:sync-retry", (_event, payload = {}) => {
    try {
      return ok({
        item: syncProvider.retry(
          opaqueId(payload.queueId, "queueId"),
          authenticatedStatus(authProvider),
        ),
      });
    }
    catch (error) { return fail(error); }
  });
  ipcMain.handle("provider:sync-delete", (_event, payload = {}) => {
    try {
      return ok({
        deleted: syncProvider.delete(
          opaqueId(payload.queueId, "queueId"),
          authenticatedStatus(authProvider),
        ),
      });
    }
    catch (error) { return fail(error); }
  });
  ipcMain.handle("provider:sync-send", async (_event, payload = {}) => {
    try {
      authenticatedStatus(authProvider);
      const coordinator = getSyncCoordinator();
      if (!coordinator || typeof coordinator.flush !== "function") {
        throw new Error("生产同步服务尚未配置，未发起网络请求");
      }
      return ok({ result: await coordinator.flush(opaqueId(payload.queueId, "queueId")) });
    } catch (error) { return fail(error); }
  });
}

module.exports = { registerAccountSyncIpc, projectDir, opaqueId, authenticatedStatus };
