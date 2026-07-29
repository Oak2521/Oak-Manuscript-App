(function () {
  "use strict";

  var contract = window.OakWebClientContract;
  var API_BASE = "/manuscript/api/v1/jobs";
  var currentJobId = null;
  var pollTimer = null;

  var nodes = {
    accountState: document.getElementById("account-state"),
    loginLink: document.getElementById("login-link"),
    registerLink: document.getElementById("register-link"),
    accountLink: document.getElementById("account-link"),
    loginRequired: document.getElementById("login-required"),
    form: document.getElementById("job-form"),
    file: document.getElementById("manuscript-file"),
    manuscriptType: document.getElementById("manuscript-type"),
    checkConfig: document.getElementById("check-config"),
    citationStyle: document.getElementById("citation-style"),
    consent: document.getElementById("processing-consent"),
    submit: document.getElementById("submit-job"),
    cancel: document.getElementById("cancel-job"),
    progressPanel: document.getElementById("progress-panel"),
    status: document.getElementById("job-status"),
    download: document.getElementById("download-result"),
    syncPanel: document.getElementById("sync-panel"),
    syncHistoryPanel: document.getElementById("sync-history-panel"),
    syncHistoryStatus: document.getElementById("sync-history-status"),
    syncHistoryList: document.getElementById("sync-history-list"),
    refreshSyncHistory: document.getElementById("refresh-sync-history"),
  };

  function setControls(enabled) {
    [nodes.file, nodes.manuscriptType, nodes.checkConfig, nodes.citationStyle, nodes.consent]
      .forEach(function (node) { node.disabled = !enabled; });
    nodes.submit.disabled = !enabled;
  }

  function setStatus(message) {
    nodes.progressPanel.hidden = false;
    nodes.status.textContent = message;
  }

  function humanState(state) {
    return {
      awaiting_upload: "任务已建立，正在上传…",
      queued: "稿件已进入临时队列，等待检查…",
      processing: "正在检查稿件…",
      result_ready: "检查完成，可以下载结果。",
      deletion_pending: "临时内容删除尚未完整完成，服务正在重试。",
    }[state] || "任务状态不可识别。";
  }

  async function session() {
    if (!window.oblAuth || !window.oblAuth.enabled) return null;
    return window.oblAuth.getSession();
  }

  async function refreshAccount() {
    var active = await session();
    var hasAccessToken = Boolean(active && active.access_token);
    if (!hasAccessToken) {
      nodes.accountState.textContent = "未登录";
      nodes.loginLink.hidden = false;
      nodes.registerLink.hidden = false;
      nodes.accountLink.hidden = true;
      nodes.loginRequired.hidden = false;
      setControls(false);
      nodes.syncHistoryPanel.hidden = true;
      nodes.syncHistoryList.replaceChildren();
      return;
    }
    nodes.accountState.textContent = "已登录湖岸账号";
    nodes.loginLink.hidden = true;
    nodes.registerLink.hidden = true;
    nodes.accountLink.hidden = false;
    nodes.loginRequired.hidden = true;
    setControls(currentJobId === null);
    nodes.syncHistoryPanel.hidden = false;
    await loadSyncHistory();
  }

  async function api(path, options) {
    var active = await session();
    var token = active && active.access_token;
    if (!token) throw new Error("登录已过期，请重新登录湖岸账号。");
    var headers = new Headers(options.headers || {});
    headers.set("Authorization", "Bearer " + token);
    var response = await fetch(path, {
      method: options.method,
      headers: headers,
      body: options.body,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      var payload = null;
      try { payload = await response.json(); } catch (_error) { payload = null; }
      var code = payload && payload.error && payload.error.code;
      throw new Error(code ? "请求失败：" + code : "请求失败（" + response.status + "）");
    }
    return response;
  }

  function stopPolling() {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function field(label, value) {
    var wrapper = document.createElement("div");
    var term = document.createElement("dt");
    var detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = String(value);
    wrapper.append(term, detail);
    return wrapper;
  }

  function renderSyncHistory(result) {
    nodes.syncHistoryList.replaceChildren();
    if (result.items.length === 0) {
      nodes.syncHistoryStatus.textContent = "当前账号还没有已同步的检查记录。";
      return;
    }
    nodes.syncHistoryStatus.textContent = result.truncated
      ? "显示最近 50 条记录；更早记录暂未加载。"
      : "共显示 " + result.items.length + " 条记录。";
    result.items.forEach(function (item) {
      var card = document.createElement("article");
      card.className = "sync-history-item";
      var title = document.createElement("h3");
      title.textContent = item.format.toUpperCase() + " · " + item.manuscriptType + " · " + item.event;
      var summary = document.createElement("dl");
      summary.append(
        field("同步时间", new Date(item.receivedAt).toLocaleString("zh-CN")),
        field("问题总数", item.total),
        field("可机械修复", item.fixable),
        field("必须处理 / 建议 / 可选", item.errors + " / " + item.warnings + " / " + item.suggestions),
        field("引用体例", item.requestedStyle + " → " + item.resolvedStyle),
        field("APP / 规则包", item.appVersion + " / " + item.rulepackVersion)
      );
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary";
      remove.textContent = "删除这条同步记录";
      remove.addEventListener("click", function () { deleteSyncRecord(item.idempotencyId); });
      card.append(title, summary, remove);
      nodes.syncHistoryList.append(card);
    });
  }

  async function loadSyncHistory() {
    nodes.refreshSyncHistory.disabled = true;
    nodes.syncHistoryStatus.textContent = "正在读取已同步记录…";
    try {
      var response = await api("/manuscript/api/v1/sync-records", { method: "GET" });
      renderSyncHistory(contract.parseSyncRecordList(await response.json()));
    } catch (error) {
      nodes.syncHistoryList.replaceChildren();
      nodes.syncHistoryStatus.textContent = "暂时无法读取同步记录：" + error.message;
    } finally {
      nodes.refreshSyncHistory.disabled = false;
    }
  }

  async function deleteSyncRecord(idempotencyId) {
    if (!window.confirm("确认从湖岸账号后台删除这条同步记录？本机项目和导出不会受影响。")) return;
    nodes.refreshSyncHistory.disabled = true;
    try {
      var response = await api(contract.syncRecordPath(idempotencyId), { method: "DELETE" });
      var deleted = contract.parseSyncDeleteResponse(await response.json());
      if (deleted.idempotencyId !== idempotencyId) throw new Error("删除回执与所选记录不一致。");
      await loadSyncHistory();
    } catch (error) {
      nodes.syncHistoryStatus.textContent = "删除失败：" + error.message;
      nodes.refreshSyncHistory.disabled = false;
    }
  }

  async function pollStatus() {
    if (!currentJobId) return;
    try {
      var response = await api(API_BASE + "/" + encodeURIComponent(currentJobId), { method: "GET" });
      var status = contract.parseJobStatus(await response.json());
      setStatus(humanState(status.state));
      if (status.state === "result_ready") {
        nodes.download.hidden = false;
        nodes.cancel.hidden = true;
        stopPolling();
        return;
      }
      if (status.state === "deletion_pending") {
        nodes.cancel.hidden = true;
        stopPolling();
        return;
      }
      pollTimer = window.setTimeout(pollStatus, 1500);
    } catch (error) {
      setStatus(error.message);
      stopPolling();
    }
  }

  async function submitJob(event) {
    event.preventDefault();
    var file = nodes.file.files && nodes.file.files[0];
    if (!file) { setStatus("请选择稿件。"); return; }
    if (!nodes.consent.checked) { setStatus("请确认本次临时处理同意。"); return; }
    var format = contract.formatFromFilename(file.name);
    if (!format) { setStatus("稿件格式不受支持。"); return; }

    setControls(false);
    nodes.syncPanel.hidden = true;
    nodes.download.hidden = true;
    try {
      var payload = contract.buildCreatePayload({
        format: format,
        manuscriptType: nodes.manuscriptType.value,
        checkConfig: nodes.checkConfig.value,
        citationStyle: nodes.citationStyle.value,
        sizeBytes: file.size,
        idempotencyKey: "webclient-" + window.crypto.randomUUID(),
        grantedAt: new Date().toISOString(),
      });
      var createResponse = await api(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var created = contract.parseJobStatus(await createResponse.json());
      currentJobId = created.job_id;
      nodes.cancel.hidden = false;
      setStatus(humanState(created.state));
      var uploadResponse = await api(API_BASE + "/" + encodeURIComponent(currentJobId) + "/input", {
        method: "PUT",
        headers: { "Content-Type": contract.mediaTypeForFormat(format) },
        body: file,
      });
      var uploaded = contract.parseJobStatus(await uploadResponse.json());
      setStatus(humanState(uploaded.state));
      pollTimer = window.setTimeout(pollStatus, 800);
    } catch (error) {
      setStatus(error.message);
      nodes.cancel.hidden = currentJobId === null;
      if (currentJobId === null) setControls(true);
    }
  }

  async function cancelJob() {
    if (!currentJobId) return;
    stopPolling();
    nodes.cancel.disabled = true;
    try {
      await api(API_BASE + "/" + encodeURIComponent(currentJobId) + "/cancel", { method: "POST" });
      setStatus("任务已取消，临时内容删除回执已返回。若存储删除失败，服务会显示等待重试而不会假报成功。");
      currentJobId = null;
      nodes.cancel.hidden = true;
      nodes.cancel.disabled = false;
      setControls(true);
    } catch (error) {
      setStatus(error.message);
      nodes.cancel.disabled = false;
    }
  }

  async function downloadResult() {
    if (!currentJobId) return;
    nodes.download.disabled = true;
    try {
      var response = await api(API_BASE + "/" + encodeURIComponent(currentJobId) + "/result", { method: "POST" });
      var blob = await response.blob();
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = "oak-manuscript-result";
      link.click();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      currentJobId = null;
      nodes.download.hidden = true;
      setControls(true);
      setStatus("结果已领取；服务器临时副本已在返回前删除。如本机保存失败，需要重新检查稿件。");
      nodes.syncPanel.hidden = false;
    } catch (error) {
      setStatus(error.message);
    } finally {
      nodes.download.disabled = false;
    }
  }

  nodes.form.addEventListener("submit", submitJob);
  nodes.cancel.addEventListener("click", cancelJob);
  nodes.download.addEventListener("click", downloadResult);
  nodes.refreshSyncHistory.addEventListener("click", loadSyncHistory);
  document.addEventListener("obl-auth-ready", refreshAccount, { once: true });
  window.setTimeout(refreshAccount, 0);
  if (window.oblAuth && window.oblAuth.client) {
    window.oblAuth.client.auth.onAuthStateChange(refreshAccount);
  }
})();
