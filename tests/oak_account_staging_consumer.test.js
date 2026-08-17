"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const test = require("node:test");
const { AuthHttpClient } = require("../electron/auth-http-client");
const { validateDesktopAuthConfig } = require("../electron/desktop-auth-config");
const { DesktopAuthProvider, EMPTY_STATE, validateState } = require("../electron/desktop-application-login-provider");

const ENABLED = process.env.OAK10_STAGING_CONSUMER === "1";
const ORIGIN = "https://account-staging.oakbylake.com";
const APPLICATION_ID = "oak-manuscript-desktop";
const SCENARIOS = new Set(["refresh_replay", "explicit_revoke", "lifecycle", "hold_active"]);

class SyntheticSafeStore {
  constructor() { this.encrypted = true; this.value = EMPTY_STATE; }
  load() { return structuredClone(this.value); }
  save(value, { expectedRevision } = {}) {
    assert.equal(expectedRevision, this.value.revision, "synthetic SafeStorage revision");
    assertNoAccessToken(value);
    this.value = structuredClone(validateState(value));
    return this.load();
  }
}

function assertNoAccessToken(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /access[_-]?token|authorization|bearer/iu, "SafeStorage boundary persists refresh state only");
}

async function jsonRequest(url, { method = "GET", body = null } = {}) {
  const response = await fetch(url, {
    method,
    headers: body === null ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
    body: body === null ? undefined : JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(30000),
  });
  const value = await response.json();
  return { status: response.status, value };
}

async function stagingConfig() {
  const jwks = await jsonRequest(`${ORIGIN}/application-login/.well-known/jwks.json`);
  assert.equal(jwks.status, 200, "short-lived Staging JWKS must be enabled");
  assert.deepEqual(Object.keys(jwks.value).sort(), ["keys"]);
  assert.equal(jwks.value.keys.length, 1);
  const key = jwks.value.keys[0];
  return validateDesktopAuthConfig({
    schema_version: "2.0",
    config_type: "oak_manuscript_desktop_application_login",
    status: "configured",
    application_id: APPLICATION_ID,
    account_center_origin: ORIGIN,
    issuer: `${ORIGIN}/application-login`,
    trusted_keys: [{ key_id: key.kid, algorithm: "ES256", public_key_jwk: key }],
    sync_api_origin: ORIGIN,
  });
}

async function waitForAuthenticated(provider, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = provider.status();
    if (status.loggedIn) return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("system-browser loopback login timed out");
}

async function waitForControl(label) {
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/continue") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("Oak Manuscript Staging 验收步骤已继续。");
      server.close();
      return;
    }
    response.writeHead(404, { "content-length": "0" }); response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve); });
  const address = server.address();
  const control = `http://127.0.0.1:${address.port}/continue`;
  console.log(`OAK10_${label} control=${control}`);
  await new Promise((resolve, reject) => { server.once("close", resolve); server.once("error", reject); });
}

function refreshBody(refreshToken) {
  return { schema_version: "oak-desktop-refresh/1.0", application_id: APPLICATION_ID, refresh_token: refreshToken };
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("base64url").slice(0, 16);
}

test("Manuscript consumes the separately authorized OAK-16 Staging runtime", { skip: !ENABLED }, async () => {
  assert.equal(process.env.OAK10_STAGING_ORIGIN, ORIGIN, "Staging origin drift");
  const scenario = process.env.OAK10_STAGING_SCENARIO;
  assert.ok(SCENARIOS.has(scenario), "unsupported OAK10_STAGING_SCENARIO");
  const config = await stagingConfig();
  const store = new SyntheticSafeStore();
  const liveClient = new AuthHttpClient({ config, timeoutMs: 30000 });
  const captured = { exchange: null };
  const client = {
    exchangeAuthorizationCode: async (request) => { captured.exchange = await liveClient.exchangeAuthorizationCode(request); return captured.exchange; },
    refresh: (refreshToken) => liveClient.refresh(refreshToken),
    revoke: (refreshToken) => liveClient.revoke(refreshToken),
  };
  const provider = new DesktopAuthProvider({
    config,
    store,
    client,
    secureStorageAvailable: true,
    openExternal: async (url) => { console.log(`OAK10_BROWSER_URL ${url}`); },
  });
  assert.deepEqual(await provider.beginLogin(), {
    state: "awaiting_callback", opened: true, authMode: "system_browser_application_login_pkce", message: "已在系统浏览器打开湖岸账号页面。",
  });
  const identity = await waitForAuthenticated(provider);
  assert.equal(identity.oakAccountId, store.value.session.oak_account_id);
  assertNoAccessToken(store.value);
  assert.ok(store.value.session.refresh_token.length >= 43);
  const [encodedHeader] = captured.exchange.access_token.split(".");
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(header).sort(), ["alg", "kid", "typ"]);
  assert.equal(header.alg, "ES256"); assert.equal(header.typ, "JWT");
  assert.equal(header.kid, config.trusted_keys[0].key_id);
  assert.equal(captured.exchange.claims.iss, config.issuer);
  assert.equal(captured.exchange.claims.aud, APPLICATION_ID);
  assert.ok(captured.exchange.claims.exp - captured.exchange.claims.iat <= 300);
  assert.equal(Object.hasOwn(captured.exchange.claims, "pro"), false);
  assert.equal(Object.hasOwn(captured.exchange.claims, "entitlement"), false);
  const firstRefresh = store.value.session.refresh_token;

  if (scenario === "refresh_replay") {
    const rotated = await liveClient.refresh(firstRefresh);
    assert.notEqual(rotated.refresh_token, firstRefresh);
    assert.equal(rotated.claims.oak_account_id, identity.oakAccountId);
    const replay = await jsonRequest(`${ORIGIN}/api/application-login/refresh`, { method: "POST", body: refreshBody(firstRefresh) });
    assert.equal(replay.status, 400); assert.equal(replay.value.error, "REFRESH_REUSE_FAMILY_REVOKED");
    const family = await jsonRequest(`${ORIGIN}/api/application-login/refresh`, { method: "POST", body: refreshBody(rotated.refresh_token) });
    assert.equal(family.status, 400); assert.equal(family.value.error, "SESSION_REVOKED");
  } else if (scenario === "explicit_revoke") {
    const signedOut = await provider.logout();
    assert.equal(signedOut.loggedIn, false);
    const revoked = await jsonRequest(`${ORIGIN}/api/application-login/refresh`, { method: "POST", body: refreshBody(firstRefresh) });
    assert.equal(revoked.status, 400); assert.equal(revoked.value.error, "SESSION_REVOKED");
  } else if (scenario === "lifecycle") {
    console.log(`OAK10_LIFECYCLE_ACCOUNT oak_account_id=${identity.oakAccountId}`);
    await waitForControl("LIFECYCLE_BLOCK_READY");
    const blocked = await jsonRequest(`${ORIGIN}/api/application-login/refresh`, { method: "POST", body: refreshBody(firstRefresh) });
    assert.equal(blocked.status, 403); assert.equal(blocked.value.error, "ACCOUNT_NOT_ACTIVE");
    await waitForControl("LIFECYCLE_RECOVERY_READY");
    const oldSession = await jsonRequest(`${ORIGIN}/api/application-login/refresh`, { method: "POST", body: refreshBody(firstRefresh) });
    assert.equal(oldSession.status, 400); assert.equal(oldSession.value.error, "SESSION_REVOKED");
    provider.applyAccountLifecycle("suspended");
    assert.equal(provider.status().loggedIn, false);
  } else {
    console.log(`OAK10_ACTIVE_ACCOUNT oak_account_id=${identity.oakAccountId}`);
    await waitForControl("ACTIVE_SESSION_READY");
    await provider.logout();
  }

  console.log(`OAK10_STAGING_CONSUMER_PASS scenario=${scenario} application_id=${APPLICATION_ID} account_fingerprint=${fingerprint(identity.oakAccountId)}`);
});
