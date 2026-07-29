(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OakLicenseAccountController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STATE_COPY = Object.freeze({
    free: "当前为 Free：账号没有有效的 Pro 订阅。",
    active: "Pro 订阅有效。",
    grace: "Pro 订阅处于宽限期，请检查续费状态。",
    expired: "Pro 订阅已过期，已有本地项目仍可继续访问。",
    revoked: "Pro 订阅已撤销，已有本地项目仍可继续访问。",
    not_yet_valid: "Pro 订阅尚未生效。",
  });

  function requireFunction(value, name) {
    if (typeof value !== "function") throw new TypeError(name + " 依赖缺失");
    return value;
  }

  function requireNode(value, name) {
    if (!value || typeof value !== "object" || typeof value.replaceChildren !== "function") {
      throw new TypeError(name + " 节点缺失");
    }
    return value;
  }

  function createLicenseAccountController(options) {
    if (!options || typeof options !== "object" || !options.contract || !options.document) {
      throw new TypeError("订阅设备控制器依赖不完整");
    }
    var contract = options.contract;
    var api = requireFunction(options.api, "api");
    var confirmAction = requireFunction(options.confirmAction, "confirmAction");
    var clock = requireFunction(options.clock, "clock");
    var createElement = requireFunction(options.document.createElement.bind(options.document), "createElement");
    var nodes = options.nodes || {};
    var panel = requireNode(nodes.panel, "panel");
    var status = requireNode(nodes.status, "status");
    var list = requireNode(nodes.list, "list");
    var refresh = requireNode(nodes.refresh, "refresh");
    var generation = 0;
    var busy = false;
    var current = null;

    function field(label, value) {
      var wrapper = createElement("div");
      var term = createElement("dt");
      var detail = createElement("dd");
      term.textContent = label;
      detail.textContent = String(value);
      wrapper.append(term, detail);
      return wrapper;
    }

    function displayTime(value) {
      return new Date(value).toLocaleString("zh-CN");
    }

    function maskedDevice(deviceId) {
      return "设备 ····" + deviceId.slice(-8);
    }

    function render(overview) {
      list.replaceChildren();
      var displayState = contract.licenseDisplayState(overview, clock());
      var message = STATE_COPY[displayState];
      if (overview.entitlement !== null) {
        message += " 有效期至 " + displayTime(overview.entitlement.validUntil) +
          "；宽限期至 " + displayTime(overview.entitlement.graceUntil) + "。";
      }
      status.textContent = message + (overview.truncated ? " 设备列表已达到显示上限。" : "");
      if (overview.devices.length === 0) {
        var empty = createElement("p");
        empty.textContent = "当前账号还没有登记设备。";
        list.append(empty);
        return;
      }
      overview.devices.forEach(function (device) {
        var card = createElement("article");
        card.className = "license-device-item";
        var title = createElement("h3");
        title.textContent = maskedDevice(device.deviceId);
        var summary = createElement("dl");
        summary.append(
          field("状态", device.deviceState === "active" ? "可用" : "已撤销"),
          field("首次登记", displayTime(device.firstSeenAt)),
          field("最近使用", displayTime(device.lastSeenAt)),
          field("撤销时间", device.revokedAt === null ? "—" : displayTime(device.revokedAt))
        );
        var revokeButton = createElement("button");
        revokeButton.type = "button";
        revokeButton.className = "secondary";
        revokeButton.textContent = device.deviceState === "active" ? "撤销此设备" : "设备已撤销";
        revokeButton.disabled = busy || device.deviceState !== "active";
        revokeButton.addEventListener("click", function () { revoke(device.deviceId); });
        card.append(title, summary, revokeButton);
        list.append(card);
      });
    }

    async function load() {
      if (busy) return;
      var requestGeneration = ++generation;
      busy = true;
      refresh.disabled = true;
      status.textContent = "正在读取订阅与设备状态…";
      try {
        var response = await api(contract.LICENSE_ACCOUNT_PATH, { method: "GET" });
        var parsed = contract.parseLicenseAccountOverview(await response.json());
        if (requestGeneration !== generation) return;
        current = parsed;
        busy = false;
        render(parsed);
      } catch (error) {
        if (requestGeneration !== generation) return;
        current = null;
        list.replaceChildren();
        status.textContent = "暂时无法读取订阅与设备状态：" + error.message;
      } finally {
        if (requestGeneration === generation) {
          busy = false;
          refresh.disabled = false;
        }
      }
    }

    async function show() {
      panel.hidden = false;
      return load();
    }

    function clear() {
      generation += 1;
      busy = false;
      current = null;
      panel.hidden = true;
      status.textContent = "";
      list.replaceChildren();
      refresh.disabled = false;
    }

    async function revoke(deviceId) {
      if (busy || current === null) return;
      var existing = current.devices.find(function (device) { return device.deviceId === deviceId; });
      if (!existing || existing.deviceState !== "active") return;
      if (!confirmAction("确认撤销" + maskedDevice(deviceId) + "？该设备之后刷新权益时将失去 Pro 权限；本地项目和导出不会被删除。")) return;
      var requestGeneration = ++generation;
      busy = true;
      refresh.disabled = true;
      render(current);
      status.textContent = "正在撤销所选设备…";
      var finalMessage = null;
      try {
        var payload = contract.buildLicenseDeviceRevokePayload();
        var response = await api(contract.licenseDeviceRevokePath(deviceId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        var result = contract.parseLicenseDeviceRevokeResponse(await response.json());
        if (requestGeneration !== generation) return;
        if (result.device.deviceId !== deviceId) throw new TypeError("设备撤销回执与所选设备不一致");
        current = Object.freeze({
          entitlement: current.entitlement,
          devices: Object.freeze(current.devices.map(function (device) {
            return device.deviceId === deviceId ? result.device : device;
          })),
          truncated: current.truncated,
        });
        finalMessage = "设备已撤销。";
      } catch (error) {
        if (requestGeneration !== generation) return;
        finalMessage = "撤销失败：" + error.message;
      } finally {
        if (requestGeneration === generation) {
          busy = false;
          refresh.disabled = false;
          if (current !== null) render(current);
          if (finalMessage !== null) {
            status.textContent = finalMessage.startsWith("设备已撤销")
              ? finalMessage + status.textContent
              : finalMessage;
          }
        }
      }
    }

    refresh.addEventListener("click", load);
    return Object.freeze({ clear: clear, load: load, revoke: revoke, show: show });
  }

  return Object.freeze({ createLicenseAccountController: createLicenseAccountController });
});
