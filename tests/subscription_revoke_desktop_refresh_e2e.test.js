"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { ProductionLicenseProvider } = require("../electron/license-entitlement");
const { LicenseHttpClient } = require("../electron/license-http-client");
const contract = require("../web/client/client-contract");
const { createLicenseAccountController } = require("../web/client/license-account-controller");
const { createEntitlementFetchHandler } = require("../web/entitlement-runtime");
const { createLicenseAccountFetchHandler } = require("../web/license-account-runtime");

const API_ORIGIN = "https://accounts.oakbylake.com";
const SUPABASE_ORIGIN = "https://project-ref.supabase.co";
const API_KEY = `sb_publishable_${"a".repeat(40)}`;
const SERVICE_KEY = `service_role_${"b".repeat(48)}`;
const TOKEN = `${"c".repeat(36)}.${"d".repeat(36)}.${"e".repeat(36)}`;
const ACCOUNT = "8f3b65e1-0e6e-42b4-81c0-61e5cf9a1020";
const DEVICE = "device-10000000-0000-4000-8000-000000000001";
const ENTITLEMENT = "ent-20000000-0000-4000-8000-000000000002";
const NOW = "2026-07-29T12:00:00.000Z";

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

function findNodes(node, predicate) {
  const found = predicate(node) ? [node] : [];
  for (const child of node.children) found.push(...findNodes(child, predicate));
  return found;
}

function memoryStore() {
  let state = {
    schema_version: "1.0",
    store_type: "oak_manuscript_license_cache",
    revision: 1,
    device_id: DEVICE,
    entitlement: null,
  };
  return {
    encrypted: true,
    load: () => structuredClone(state),
    save(value, { expectedRevision }) {
      assert.equal(expectedRevision, state.revision);
      state = structuredClone(value);
      return structuredClone(state);
    },
    inspect: () => structuredClone(state),
  };
}

function createStatefulDatabaseFetch() {
  const state = {
    deviceState: "active",
    firstSeenAt: "2026-07-20T00:00:00.000Z",
    lastSeenAt: "2026-07-29T11:00:00.000Z",
    revokedAt: null,
  };
  function deviceRow() {
    return {
      account_id: ACCOUNT,
      device_id: DEVICE,
      device_state: state.deviceState,
      first_seen_at: state.firstSeenAt,
      last_seen_at: state.lastSeenAt,
      revoked_at: state.revokedAt,
    };
  }
  return {
    state,
    async fetch(url, options) {
      if (url === `${SUPABASE_ORIGIN}/auth/v1/user`) {
        assert.equal(options.headers.authorization, `Bearer ${TOKEN}`);
        return new Response(JSON.stringify({ id: ACCOUNT }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      assert.equal(options.headers.apikey, SERVICE_KEY);
      assert.equal(options.headers.authorization, `Bearer ${SERVICE_KEY}`);
      const input = JSON.parse(options.body);
      if (url.endsWith("oak_manuscript_license_authorize_device")) {
        assert.equal(input.p_account_id, ACCOUNT);
        assert.equal(input.p_device_id, DEVICE);
        state.lastSeenAt = NOW;
        return new Response(JSON.stringify({
          schema_version: "1.0",
          result_type: "oak_manuscript_device_authorization",
          outcome: "authorized",
          authorization: {
            account_id: ACCOUNT,
            entitlement_id: ENTITLEMENT,
            device_id: DEVICE,
            device_state: state.deviceState,
            issued_at: "2026-07-01T00:00:00.000Z",
            not_before: "2026-07-01T00:00:00.000Z",
            valid_until: "2026-08-01T00:00:00.000Z",
            grace_until: "2026-08-08T00:00:00.000Z",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("oak_manuscript_license_account_overview")) {
        assert.equal(input.p_account_id, ACCOUNT);
        return new Response(JSON.stringify({
          schema_version: "1.0",
          result_type: "oak_manuscript_license_account_snapshot",
          account_id: ACCOUNT,
          entitlement: {
            account_id: ACCOUNT,
            entitlement_id: ENTITLEMENT,
            entitlement_state: "active",
            not_before: "2026-07-01T00:00:00.000Z",
            valid_until: "2026-08-01T00:00:00.000Z",
            grace_until: "2026-08-08T00:00:00.000Z",
            revision: 2,
          },
          devices: [deviceRow()],
          total_devices: 1,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("oak_manuscript_license_revoke_device")) {
        assert.equal(input.p_account_id, ACCOUNT);
        assert.equal(input.p_device_id, DEVICE);
        state.deviceState = "revoked";
        state.lastSeenAt = NOW;
        state.revokedAt = NOW;
        return new Response(JSON.stringify(deviceRow()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected database route: ${url}`);
    },
  };
}

test("account UI revoke flows through signed service refresh and safely downgrades the desktop", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  const database = createStatefulDatabaseFetch();
  const audit = [];
  const common = {
    apiOrigin: API_ORIGIN,
    supabaseOrigin: SUPABASE_ORIGIN,
    supabaseApiKey: API_KEY,
    supabaseServiceRoleKey: SERVICE_KEY,
    fetchImpl: database.fetch,
    clock: () => new Date(NOW),
    requestIdFactory: () => "30000000-0000-4000-8000-000000000003",
    securityEventSink: (event) => audit.push(event),
  };
  const entitlementHandler = createEntitlementFetchHandler({
    ...common,
    issuer: `${API_ORIGIN}/`,
    audience: "oak-manuscript-desktop",
    keyId: "oak-license-2026-01",
    signingPrivateKey: privateKey,
  });
  const accountHandler = createLicenseAccountFetchHandler(common);
  const client = new LicenseHttpClient({
    endpoint: `${API_ORIGIN}/manuscript/api/v1/entitlement`,
    fetchImpl: (url, options) => entitlementHandler(new Request(url, options)),
  });
  const config = {
    schema_version: "1.0",
    config_type: "oak_manuscript_desktop_license",
    status: "configured",
    entitlement_endpoint: `${API_ORIGIN}/manuscript/api/v1/entitlement`,
    issuer: `${API_ORIGIN}/`,
    audience: "oak-manuscript-desktop",
    trusted_keys: [{
      key_id: "oak-license-2026-01",
      algorithm: "Ed25519",
      public_key_jwk: { kty: "OKP", crv: "Ed25519", x: publicJwk.x },
    }],
  };
  const auth = { state: "authenticated", loggedIn: true, accountId: ACCOUNT };
  const store = memoryStore();
  const desktop = new ProductionLicenseProvider({
    config,
    store,
    client,
    accessTokenProvider: async ({ accountId }) => ({ accountId, accessToken: TOKEN }),
    authStatusProvider: () => auth,
    clock: () => new Date(NOW),
  });

  const active = await desktop.refresh(auth);
  assert.equal(active.entitlementState, "active");
  assert.equal(active.effectiveTier, "pro");
  assert.equal(active.localProjectsLocked, false);
  assert.equal(store.inspect().revision, 2);

  const nodes = {
    panel: new FakeNode("section"),
    status: new FakeNode("p"),
    list: new FakeNode("div"),
    refresh: new FakeNode("button"),
  };
  const api = async (requestPath, options) => {
    const headers = { Authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) };
    if (options.method === "POST") {
      headers.Origin = API_ORIGIN;
      headers["Sec-Fetch-Site"] = "same-origin";
      headers["Content-Length"] = String(Buffer.byteLength(options.body));
    }
    return accountHandler(new Request(`${API_ORIGIN}${requestPath}`, {
      method: options.method,
      headers,
      ...(options.body === undefined ? {} : { body: options.body }),
    }));
  };
  const website = createLicenseAccountController({
    contract,
    document: { createElement: (tag) => new FakeNode(tag) },
    nodes,
    api,
    confirmAction: () => true,
    clock: () => new Date(NOW),
  });
  await website.show();
  assert.equal(nodes.list.children.length, 1);
  assert.equal(findNodes(nodes.list, (node) => node.tagName === "BUTTON" && !node.disabled).length, 1);

  await website.revoke(DEVICE);
  assert.equal(database.state.deviceState, "revoked");
  assert.match(nodes.status.textContent, /设备已撤销/);
  assert.equal(findNodes(nodes.list, (node) => node.tagName === "BUTTON" && !node.disabled).length, 0);

  const cachedBeforeRefresh = desktop.status();
  assert.equal(cachedBeforeRefresh.entitlementState, "active", "desktop cache changes only after explicit refresh");
  assert.equal(cachedBeforeRefresh.localProjectsLocked, false);

  const revoked = await desktop.refresh(auth);
  assert.equal(revoked.entitlementState, "revoked");
  assert.equal(revoked.effectiveTier, "free");
  assert.equal(revoked.localProjectsLocked, false);
  assert.equal(store.inspect().revision, 3);
  assert.equal(store.inspect().device_id, DEVICE);
  assert.equal(store.inspect().entitlement.claims.device_state, "revoked");

  assert.equal(audit.length, 4);
  for (const secret of [TOKEN, API_KEY, SERVICE_KEY, ACCOUNT, DEVICE]) {
    assert.equal(JSON.stringify(audit).includes(secret), false);
  }
});
