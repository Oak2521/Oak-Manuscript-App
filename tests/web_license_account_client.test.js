"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const contract = require("../web/client/client-contract");
const { createLicenseAccountController } = require("../web/client/license-account-controller");

const CLIENT_ROOT = path.join(__dirname, "..", "web", "client");
const HTML = fs.readFileSync(path.join(CLIENT_ROOT, "index.html"), "utf8");
const APP = fs.readFileSync(path.join(CLIENT_ROOT, "app.js"), "utf8");
const DEVICE = "device-10000000-0000-4000-8000-000000000001";
const DEVICE_TWO = "device-20000000-0000-4000-8000-000000000002";

function overview(overrides = {}) {
  return {
    schema_version: "1.0",
    account_type: "oak_manuscript_license_account",
    entitlement: {
      entitlement_state: "active",
      not_before: "2026-07-01T00:00:00.000Z",
      valid_until: "2026-08-01T00:00:00.000Z",
      grace_until: "2026-08-08T00:00:00.000Z",
    },
    devices: [
      {
        device_id: DEVICE, device_state: "active",
        first_seen_at: "2026-07-20T00:00:00.000Z",
        last_seen_at: "2026-07-29T11:00:00.000Z", revoked_at: null,
      },
      {
        device_id: DEVICE_TWO, device_state: "revoked",
        first_seen_at: "2026-07-10T00:00:00.000Z",
        last_seen_at: "2026-07-21T11:00:00.000Z",
        revoked_at: "2026-07-21T12:00:00.000Z",
      },
    ],
    truncated: false,
    ...overrides,
  };
}

function revokedResponse() {
  return {
    schema_version: "1.0", outcome: "revoked",
    device: {
      device_id: DEVICE, device_state: "revoked",
      first_seen_at: "2026-07-20T00:00:00.000Z",
      last_seen_at: "2026-07-29T12:00:00.000Z",
      revoked_at: "2026-07-29T12:00:00.000Z",
    },
  };
}

class FakeNode {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.className = "";
    this.type = "";
    this.listeners = new Map();
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
}

function fakeDocument() {
  return { createElement(tag) { return new FakeNode(tag); } };
}

function textTree(node) {
  return [node.textContent, ...node.children.map(textTree)].join(" ");
}

function findNodes(node, predicate) {
  const found = predicate(node) ? [node] : [];
  for (const child of node.children) found.push(...findNodes(child, predicate));
  return found;
}

function response(payload, ok = true, status = 200) {
  return { ok, status, async json() { return structuredClone(payload); } };
}

function harness({ api, confirmAction = () => true } = {}) {
  const nodes = {
    panel: new FakeNode("section"), status: new FakeNode("p"),
    list: new FakeNode("div"), refresh: new FakeNode("button"),
  };
  const controller = createLicenseAccountController({
    contract, nodes, document: fakeDocument(),
    api: api || (async () => response(overview())),
    confirmAction, clock: () => new Date("2026-07-29T12:00:00.000Z"),
  });
  return { controller, nodes };
}

test("Web license contract strictly parses content-free overview and derives display state", () => {
  const parsed = contract.parseLicenseAccountOverview(overview());
  assert.deepEqual(parsed, {
    entitlement: {
      entitlementState: "active", notBefore: "2026-07-01T00:00:00.000Z",
      validUntil: "2026-08-01T00:00:00.000Z", graceUntil: "2026-08-08T00:00:00.000Z",
    },
    devices: [
      { deviceId: DEVICE, deviceState: "active", firstSeenAt: "2026-07-20T00:00:00.000Z", lastSeenAt: "2026-07-29T11:00:00.000Z", revokedAt: null },
      { deviceId: DEVICE_TWO, deviceState: "revoked", firstSeenAt: "2026-07-10T00:00:00.000Z", lastSeenAt: "2026-07-21T11:00:00.000Z", revokedAt: "2026-07-21T12:00:00.000Z" },
    ],
    truncated: false,
  });
  assert.equal(contract.licenseDisplayState(parsed, new Date("2026-07-29T12:00:00.000Z")), "active");
  assert.equal(contract.licenseDisplayState(contract.parseLicenseAccountOverview(overview({ entitlement: null })), new Date()), "free");
  assert.equal(contract.licenseDisplayState(contract.parseLicenseAccountOverview(overview({ entitlement: { ...overview().entitlement, entitlement_state: "revoked" } })), new Date()), "revoked");
  assert.equal(contract.licenseDisplayState(parsed, new Date("2026-08-03T00:00:00.000Z")), "grace");
  assert.equal(contract.licenseDisplayState(parsed, new Date("2026-08-09T00:00:00.000Z")), "expired");
  assert.throws(() => contract.parseLicenseAccountOverview({ ...overview(), account_id: "private" }), /订阅与设备/);
  assert.throws(() => contract.parseLicenseAccountOverview(overview({ devices: [{ ...overview().devices[0], last_seen_at: "not-a-time" }] })), /订阅与设备/);
});

test("Web license contract fixes revoke request, path, and exact owner response", () => {
  assert.deepEqual(contract.buildLicenseDeviceRevokePayload(), { schema_version: "1.0", action: "revoke_device" });
  assert.equal(contract.licenseDeviceRevokePath(DEVICE), `/manuscript/api/v1/account/license/devices/${DEVICE}/revoke`);
  assert.deepEqual(contract.parseLicenseDeviceRevokeResponse(revokedResponse()), {
    outcome: "revoked",
    device: { deviceId: DEVICE, deviceState: "revoked", firstSeenAt: "2026-07-20T00:00:00.000Z", lastSeenAt: "2026-07-29T12:00:00.000Z", revokedAt: "2026-07-29T12:00:00.000Z" },
  });
  assert.throws(() => contract.licenseDeviceRevokePath("device-private"), /设备标识/);
  assert.throws(() => contract.parseLicenseDeviceRevokeResponse({ ...revokedResponse(), account_id: "private" }), /设备撤销/);
});

test("account controller renders safe subscription/device state and revokes only after confirmation", async () => {
  const calls = [];
  let confirmed = false;
  const context = harness({
    confirmAction: () => confirmed,
    api: async (requestPath, options) => {
      calls.push({ requestPath, options });
      return response(options.method === "GET" ? overview() : revokedResponse());
    },
  });
  await context.controller.show();
  assert.equal(context.nodes.panel.hidden, false);
  assert.match(context.nodes.status.textContent, /Pro 订阅有效/);
  assert.equal(context.nodes.list.children.length, 2);
  assert.equal(textTree(context.nodes.list).includes(DEVICE), false);
  assert.equal(textTree(context.nodes.list).includes("00000001"), true);
  assert.equal(findNodes(context.nodes.list, (node) => node.tagName === "BUTTON").length, 2);

  await context.controller.revoke(DEVICE);
  assert.equal(calls.length, 1, "cancelled confirmation must not send");
  confirmed = true;
  await context.controller.revoke(DEVICE);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], {
    requestPath: `/manuscript/api/v1/account/license/devices/${DEVICE}/revoke`,
    options: {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema_version: "1.0", action: "revoke_device" }),
    },
  });
  assert.match(context.nodes.status.textContent, /已撤销/);
  assert.equal(findNodes(context.nodes.list, (node) => node.tagName === "BUTTON" && !node.disabled).length, 0);
});

test("account controller clears immediately on logout and ignores stale in-flight responses", async () => {
  let resolveRequest;
  const pending = new Promise((resolve) => { resolveRequest = resolve; });
  const context = harness({ api: async () => pending });
  const loading = context.controller.show();
  context.controller.clear();
  resolveRequest(response(overview()));
  await loading;
  assert.equal(context.nodes.panel.hidden, true);
  assert.equal(context.nodes.status.textContent, "");
  assert.equal(context.nodes.list.children.length, 0);
});

test("failed revoke remains visible, re-enables the active device, and never changes local state", async () => {
  const context = harness({
    api: async (_requestPath, options) => {
      if (options.method === "GET") return response(overview());
      throw new Error("请求失败：SERVICE_UNAVAILABLE");
    },
  });
  await context.controller.show();
  await context.controller.revoke(DEVICE);
  assert.equal(context.nodes.status.textContent, "撤销失败：请求失败：SERVICE_UNAVAILABLE");
  assert.equal(findNodes(context.nodes.list, (node) => node.tagName === "BUTTON" && !node.disabled).length, 1);
  assert.equal(textTree(context.nodes.list).includes("设备已撤销"), true, "pre-existing revoked device remains visible");
  assert.equal(textTree(context.nodes.list).includes("撤销此设备"), true, "selected device remains active");
});

test("Web page and app wire account license status, refresh, device list, confirm revoke, and logout clear", () => {
  for (const required of [
    'id="license-account-panel"', 'id="license-account-status"',
    'id="license-device-list"', 'id="refresh-license-account"',
    './license-account-controller.js', "订阅与设备",
  ]) assert.equal(HTML.includes(required), true, required);
  assert.equal(APP.includes("licenseAccount.show()"), true);
  assert.equal(APP.includes("licenseAccount.clear()"), true);
  assert.equal(APP.includes("window.confirm"), true);
  assert.equal(APP.includes("localStorage"), false);
  assert.equal(APP.includes("sessionStorage"), false);
});
