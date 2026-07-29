"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  loadDesktopStandardsUpdateConfig,
  validateDesktopStandardsUpdateConfig,
} = require("../electron/desktop-standards-update-config");
const {
  StandardsUpdateHttpClient,
} = require("../electron/standards-update-http-client");

const ROOT = path.resolve(__dirname, "..");
const ENDPOINT = "https://updates.oakbylake.com/manuscript/standards/v1/check";
const REVOCATION_ENDPOINT = "https://updates.oakbylake.com/manuscript/standards/v1/revocations";
const MANIFEST = "a".repeat(64);

function request() {
  return {
    appVersion: "0.1.0-alpha.49",
    bundleId: "oak-standards",
    currentReleaseSequence: 2,
    currentManifestSha256: MANIFEST,
  };
}

function configured(overrides = {}) {
  return {
    schema_version: "1.1",
    config_type: "oak_manuscript_standards_update",
    status: "configured",
    update_endpoint: ENDPOINT,
    revocation_endpoint: REVOCATION_ENDPOINT,
    ...overrides,
  };
}

test("tracked standards update config is exact and pending configuration performs no partial setup", () => {
  const tracked = loadDesktopStandardsUpdateConfig(path.join(ROOT, "config"));
  assert.deepEqual(tracked, {
    schema_version: "1.1",
    config_type: "oak_manuscript_standards_update",
    status: "pending_configuration",
    update_endpoint: null,
    revocation_endpoint: null,
  });
  const schema = JSON.parse(fs.readFileSync(
    path.join(ROOT, "config", "schemas", "desktop-standards-update-v1.1.schema.json"), "utf8",
  ));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "schema_version", "config_type", "status", "update_endpoint", "revocation_endpoint",
  ]);
  assert.equal(validateDesktopStandardsUpdateConfig(configured()).update_endpoint, ENDPOINT);
  assert.throws(() => validateDesktopStandardsUpdateConfig({ ...configured(), account_id: "private" }), /标准更新配置/);
  assert.throws(() => validateDesktopStandardsUpdateConfig({ ...configured(), update_endpoint: "http://updates.oakbylake.com/check" }), /HTTPS/);
  assert.throws(() => validateDesktopStandardsUpdateConfig({ ...tracked, update_endpoint: ENDPOINT }), /待配置/);
  assert.throws(() => validateDesktopStandardsUpdateConfig(configured({
    revocation_endpoint: "https://other.example/manuscript/standards/v1/revocations",
  })), /同源/);
  assert.throws(() => validateDesktopStandardsUpdateConfig(configured({
    update_endpoint: "https://updates.oakbylake.com/wrong",
  })), /固定路径/);
});

test("standards update client sends one exact content-free POST and returns bounded raw signed envelope bytes", async () => {
  const calls = [];
  const envelope = Buffer.from('{"kind":"oak-standards-envelope"}', "utf8");
  const client = new StandardsUpdateHttpClient({
    endpoint: ENDPOINT,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(envelope, {
        status: 200,
        headers: {
          "content-type": "application/vnd.oak.standard-package+json",
          "content-length": String(envelope.length),
        },
      });
    },
  });
  const result = await client.check(request());
  assert.equal(result.outcome, "update");
  assert.deepEqual(result.envelopeBytes, envelope);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENDPOINT);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.credentials, "omit");
  const sent = JSON.parse(calls[0].options.body);
  assert.deepEqual(sent, {
    schema_version: "1.0",
    request_type: "oak_manuscript_standard_update_check",
    app_version: "0.1.0-alpha.49",
    bundle_id: "oak-standards",
    current_release_sequence: 2,
    current_manifest_sha256: MANIFEST,
  });
  for (const forbidden of ["account_id", "token", "manuscript_content", "project_id", "path", "file_name"]) {
    assert.equal(Object.hasOwn(sent, forbidden), false);
  }
});

test("standards update client treats exact empty 204 as current and fails closed on response drift", async () => {
  const current = new StandardsUpdateHttpClient({
    endpoint: ENDPOINT,
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  assert.deepEqual(await current.check(request()), { outcome: "current" });

  const cases = [
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    new Response("{}", { status: 200, headers: { "content-type": "application/vnd.oak.standard-package+json", "content-encoding": "gzip" } }),
    new Response("{}", { status: 200, headers: { "content-type": "application/vnd.oak.standard-package+json", "content-length": String(25 * 1024 * 1024) } }),
    new Response('{"private":"upstream detail"}', { status: 503, headers: { "content-type": "application/json" } }),
  ];
  for (const response of cases) {
    const client = new StandardsUpdateHttpClient({ endpoint: ENDPOINT, fetchImpl: async () => response.clone() });
    await assert.rejects(
      () => client.check(request()),
      (error) => error && /^STANDARDS_UPDATE_/u.test(error.code) && !error.message.includes("upstream detail"),
    );
  }
});

test("standards update client rejects request smuggling, network faults, and timeout without reflecting secrets", async () => {
  const client = new StandardsUpdateHttpClient({
    endpoint: ENDPOINT,
    fetchImpl: async () => { throw new Error("private proxy path"); },
  });
  await assert.rejects(
    () => client.check(request()),
    (error) => error.code === "STANDARDS_UPDATE_UNAVAILABLE" && !error.message.includes("proxy"),
  );
  await assert.rejects(() => client.check({ ...request(), accountId: "private" }), /请求/);
  await assert.rejects(() => client.check({ ...request(), currentReleaseSequence: 0 }), /请求/);

  const timeout = new StandardsUpdateHttpClient({
    endpoint: ENDPOINT,
    timeoutMs: 100,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("late"), { name: "AbortError" })));
    }),
  });
  await assert.rejects(
    () => timeout.check(request()),
    (error) => error.code === "STANDARDS_UPDATE_TIMEOUT",
  );
});

test("desktop wiring keeps endpoint and install authority in main process behind one explicit UI action", () => {
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(ROOT, "electron", "preload.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "renderer", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(ROOT, "renderer", "app.js"), "utf8");

  assert.match(main, /loadDesktopStandardsUpdateConfig/);
  assert.match(main, /new StandardsUpdateHttpClient/);
  assert.match(main, /new StandardsRevocationHttpClient/);
  assert.match(main, /standardsUpdateClient = updateCandidate;\s+standardsRevocationClient = revocationCandidate;/);
  assert.match(main, /standardsUpdateConfig\.status === "configured"/);
  assert.match(preload, /checkStandardUpdates:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("standards:check-online"\)/);
  assert.doesNotMatch(preload, /checkStandardUpdates:\s*\([^)]/);
  assert.match(html, /id="btn-check-standards"/);
  assert.match(html, /先获取并验证撤回清单/);
  assert.match(renderer, /window\.oak\.checkStandardUpdates\(\)/);
  assert.match(renderer, /network_updates_enabled\s*&&\s*standardStatus\.network_revocations_enabled/);
  assert.doesNotMatch(renderer, /updates\.oakbylake\.com|update_endpoint|revocation_endpoint|envelopeBytes/);
});
