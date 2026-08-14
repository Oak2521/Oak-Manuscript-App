"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const test = require("node:test");

const { validateDesktopAuthConfig } = require("../electron/desktop-auth-config");
const { verifyDesktopAccessToken } = require("../electron/oak-account-token");
const { LoopbackAuthListener } = require("../electron/loopback-auth-listener");
const { DesktopAuthProvider, EMPTY_STATE } = require("../electron/desktop-auth-provider");
const { AuthHttpError } = require("../electron/application-login-http-client");

const ACCOUNT = "63000000-0000-4000-8000-000000000003";
const SUBJECT = "61000000-0000-4000-8000-000000000001";
const SESSION = "62000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-08-14T12:00:00.000Z");

function signingFixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { publicJwk: publicKey.export({ format: "jwk" }), privateKey };
}

function jwt(privateKey, claims, header = { alg: "EdDSA", kid: "oak-login-test-1", typ: "JWT" }) {
  const first = Buffer.from(JSON.stringify(header)).toString("base64url");
  const second = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign(null, Buffer.from(`${first}.${second}`, "ascii"), privateKey).toString("base64url");
  return `${first}.${second}.${signature}`;
}

function claims(overrides = {}) {
  return {
    iss: "https://identity.example.invalid/application-login",
    sub: SUBJECT,
    aud: "oak-manuscript-desktop",
    sid: SESSION,
    iat: 1786708800,
    exp: 1786709100,
    aal: "aal1",
    oak_account_id: ACCOUNT,
    oak_account_status: "active",
    oak_profile_version: 3,
    oak_claims_version: "1.0",
    ...overrides,
  };
}

function configured(publicJwk) {
  return validateDesktopAuthConfig({
    schema_version: "2.0",
    config_type: "oak_manuscript_desktop_application_login",
    status: "configured",
    application_id: "oak-manuscript-desktop",
    account_center_origin: "https://identity.example.invalid",
    issuer: "https://identity.example.invalid/application-login",
    trusted_keys: [{ key_id: "oak-login-test-1", algorithm: "Ed25519", public_key_jwk: publicJwk }],
    sync_api_origin: "https://manuscript-api.example.invalid",
  });
}

function memoryStore(initial = EMPTY_STATE) {
  let value = structuredClone(initial);
  return {
    encrypted: true,
    load: () => structuredClone(value),
    save(next, { expectedRevision }) {
      assert.equal(value.revision, expectedRevision);
      value = structuredClone(next);
      return structuredClone(value);
    },
    value: () => structuredClone(value),
  };
}

test("desktop config has only fixed application-login origins and no legacy OAuth fields", () => {
  const pending = validateDesktopAuthConfig({
    schema_version: "2.0", config_type: "oak_manuscript_desktop_application_login",
    status: "pending_configuration", application_id: "oak-manuscript-desktop",
    account_center_origin: null, issuer: null, trusted_keys: [], sync_api_origin: null,
  });
  assert.equal(pending.status, "pending_configuration");
  for (const forbidden of ["authorization_endpoint", "token_endpoint", "user_endpoint", "client_id", "public_api_key", "redirect_uri", "scopes"]) {
    assert.equal(Object.hasOwn(pending, forbidden), false);
  }
});

test("signed access token accepts only exact active Oak claims and never Pro claims", () => {
  const key = signingFixture();
  const config = configured(key.publicJwk);
  const accepted = verifyDesktopAccessToken(jwt(key.privateKey, claims()), claims(), { config, clock: () => NOW });
  assert.equal(accepted.oak_account_id, ACCOUNT);
  for (const poison of [
    claims({ aud: "oak-research-desktop" }),
    claims({ iss: "https://wrong.example.invalid/application-login" }),
    claims({ exp: 1786708799 }),
    claims({ oak_claims_version: "2.0" }),
    claims({ oak_account_status: "suspended" }),
    { ...claims(), entitlements: ["pro"] },
  ]) {
    assert.throws(() => verifyDesktopAccessToken(jwt(key.privateKey, poison), poison, { config, clock: () => NOW }));
  }
});

test("loopback listener binds 127.0.0.1 on a runtime port and consumes one exact callback", async () => {
  const callbacks = [];
  const listener = new LoopbackAuthListener({
    pathNonce: "n".repeat(43), expectedState: "s".repeat(43), timeoutMs: 10_000,
    onCallback: async (value) => callbacks.push(value),
  });
  const opened = await listener.start();
  const url = new URL(opened.redirectUri);
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(Number(url.port) >= 1024 && Number(url.port) <= 65535);
  const result = await new Promise((resolve, reject) => {
    http.get(`${opened.redirectUri}?code=${"c".repeat(43)}&state=${"s".repeat(43)}`, (response) => {
      response.resume(); response.on("end", () => resolve(response.statusCode));
    }).on("error", reject);
  });
  assert.equal(result, 200);
  assert.deepEqual(callbacks, [{ code: "c".repeat(43), state: "s".repeat(43), redirectUri: opened.redirectUri }]);
  assert.equal(listener.active, false);
});

test("provider persists only rotating refresh credentials and reports offline revoke honestly", async () => {
  const key = signingFixture();
  const config = configured(key.publicJwk);
  const store = memoryStore();
  let callback;
  const listener = {
    active: false,
    async start() { this.active = true; return { redirectUri: `http://127.0.0.1:49152/application-login/callback/${"n".repeat(43)}` }; },
    close() { this.active = false; },
  };
  const tokenClaims = claims();
  const response = {
    schema_version: "oak-desktop-token-response/1.0", token_type: "Bearer",
    access_token: jwt(key.privateKey, tokenClaims), expires_in: 300,
    refresh_token: "r".repeat(43), refresh_expires_at: "2026-09-13T12:00:00.000Z", claims: tokenClaims,
  };
  const provider = new DesktopAuthProvider({
    config, store, clock: () => NOW, randomBytes: (size) => Buffer.alloc(size, 7),
    listenerFactory: (options) => { callback = options.onCallback; return listener; },
    openExternal: async () => {},
    client: {
      exchangeAuthorizationCode: async () => response,
      refresh: async () => { throw new Error("unused"); },
      revoke: async () => { throw new Error("offline"); },
    },
  });
  await provider.beginLogin();
  const pending = store.value().pending;
  await callback({ code: "c".repeat(43), state: pending.state, redirectUri: pending.redirect_uri });
  const persisted = JSON.stringify(store.value());
  assert.equal(persisted.includes(response.access_token), false);
  assert.equal(store.value().session.oak_account_id, ACCOUNT);
  assert.equal((await provider.accessToken({ oakAccountId: ACCOUNT })).accessToken, response.access_token);
  const loggedOut = await provider.logout();
  assert.equal(loggedOut.state, "local_signed_out_remote_revocation_unconfirmed");
  assert.equal(store.value().session, null);
});

test("restart discards an unfinished callback and secure-storage failure stays fail-closed", async () => {
  const key = signingFixture();
  const config = configured(key.publicJwk);
  const withPending = {
    ...EMPTY_STATE,
    revision: 4,
    pending: {
      state: "s".repeat(43), code_verifier: "v".repeat(64),
      redirect_uri: `http://127.0.0.1:49152/application-login/callback/${"n".repeat(43)}`,
      created_at: "2026-08-14T11:59:00.000Z", expires_at: "2026-08-14T12:09:00.000Z",
    },
  };
  const store = memoryStore(withPending);
  const restarted = new DesktopAuthProvider({ config, store, client: {}, openExternal: async () => {}, clock: () => NOW });
  assert.equal(store.value().pending, null);
  assert.equal(restarted.status().state, "signed_out");
  const unavailable = new DesktopAuthProvider({ config, store, client: {}, openExternal: async () => {}, secureStorageAvailable: false });
  assert.equal(unavailable.status().state, "unavailable");
  await assert.rejects(() => unavailable.beginLogin(), /SECURE_STORAGE_REQUIRED/);
});

test("server rejection during refresh purges the local refresh credential", async () => {
  const key = signingFixture();
  const config = configured(key.publicJwk);
  const store = memoryStore({
    ...EMPTY_STATE,
    revision: 1,
    session: {
      oak_account_id: ACCOUNT, session_id: SESSION, refresh_token: "r".repeat(43),
      refresh_issued_at: NOW.toISOString(), refresh_last_used_at: NOW.toISOString(),
      refresh_expires_at: "2026-09-13T12:00:00.000Z",
    },
  });
  const provider = new DesktopAuthProvider({
    config, store, clock: () => NOW, openExternal: async () => {},
    client: { refresh: async () => { throw new AuthHttpError("AUTH_REJECTED"); } },
  });
  await assert.rejects(() => provider.accessToken({ oakAccountId: ACCOUNT }), (error) => error.code === "AUTH_REJECTED");
  assert.equal(store.value().session, null);
  assert.equal(provider.status().state, "signed_out");
});

test("suspended, deletion_pending, and deleted stop remote operations and purge credentials", async () => {
  const key = signingFixture();
  const config = configured(key.publicJwk);
  for (const lifecycle of ["suspended", "deletion_pending", "deleted"]) {
    const store = memoryStore({
      ...EMPTY_STATE,
      revision: 1,
      session: {
        oak_account_id: ACCOUNT, session_id: SESSION, refresh_token: "r".repeat(43),
        refresh_issued_at: NOW.toISOString(), refresh_last_used_at: NOW.toISOString(),
        refresh_expires_at: "2026-09-13T12:00:00.000Z",
      },
    });
    const provider = new DesktopAuthProvider({ config, store, client: {}, openExternal: async () => {}, clock: () => NOW });
    assert.equal(provider.applyAccountLifecycle(lifecycle).state, lifecycle);
    assert.equal(store.value().session, null);
    await assert.rejects(() => provider.accessToken({ oakAccountId: ACCOUNT }), /会话无效|账号不匹配/);
  }
});
