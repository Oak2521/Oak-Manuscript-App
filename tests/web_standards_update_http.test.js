"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Readable } = require("node:stream");

const { StandardsUpdateHttpClient } = require("../electron/standards-update-http-client");
const {
  BUNDLED_STANDARD_RELEASE,
  StandardsProvider,
} = require("../electron/standards-provider");
const { canonicalJson, sha256: storeSha256 } = require("../electron/standards-store");
const { createFetchHandlerAdapter } = require("../web/fetch-adapter");
const {
  STANDARDS_UPDATE_API_PATH,
  PACKAGE_MEDIA_TYPE,
  createStandardsUpdateHttpHandler,
  validateStandardsUpdateHttpAuditEvent,
  validateStandardsUpdateHttpErrorResponse,
} = require("../web/standards-update-http-handler");
const {
  StandardsUpdateService,
  validateStandardsUpdateRequest,
} = require("../web/standards-update-service");
const { createStandardsUpdateFetchHandler } = require("../web/standards-update-runtime");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://updates.oakbylake.com";
const REQUEST_ID = "70000000-0000-4000-8000-000000000007";
const CURRENT_MANIFEST = "a".repeat(64);
const NEXT_MANIFEST = "b".repeat(64);
const ENVELOPE = Buffer.from('{"kind":"oak-standards-envelope"}', "utf8");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function tempRoot(t, prefix) {
  const parent = path.join(ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function signedReleaseFixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const keyid = storeSha256(der);
  const config = path.join(ROOT, "config");
  const standards = JSON.parse(fs.readFileSync(path.join(config, "standards.json"), "utf8"));
  const rulepack = JSON.parse(fs.readFileSync(
    path.join(config, BUNDLED_STANDARD_RELEASE.rulepackRelative), "utf8",
  ));
  standards.registry_version = "2.0.1";
  standards.updated_at = "2026-07-29";
  rulepack.pack_version = "2.0.1";
  rulepack.frozen_at = "2026-07-29";
  rulepack.citation_default_mapping.version = "2.0.1";
  const standardsBytes = Buffer.from(`${JSON.stringify(standards, null, 2)}\n`, "utf8");
  const rulepackBytes = Buffer.from(`${JSON.stringify(rulepack, null, 2)}\n`, "utf8");
  const capabilityBytes = fs.readFileSync(path.join(config, "rule-capabilities.json"));
  const manifest = {
    schema_version: "1.0",
    kind: "oak-standard-release",
    bundle_id: "oak-standards",
    release_sequence: 3,
    version: "2.0.1",
    channel: "stable",
    released_at: "2026-07-29T00:00:00Z",
    expires_at: null,
    min_app: "0.1.0-alpha.5",
    max_app_exclusive: "0.2.0",
    signing_role: "release",
    files: [
      {
        path: "standards.json",
        size_bytes: standardsBytes.length,
        sha256: storeSha256(standardsBytes),
        media_type: "application/json",
      },
      {
        path: "rulepack.json",
        size_bytes: rulepackBytes.length,
        sha256: storeSha256(rulepackBytes),
        media_type: "application/json",
      },
    ],
    rulepack: {
      name: "oak-rules",
      version: "2.0.1",
      sha256: storeSha256(rulepackBytes),
      capability_set_sha256: storeSha256(capabilityBytes),
    },
    rollback_target: {
      manifest_sha256: BUNDLED_STANDARD_RELEASE.manifestSha256,
      release_sequence: 2,
    },
    change_summary: ["服务端到桌面签名更新纵向测试。"],
  };
  const manifestBytes = Buffer.from(canonicalJson(manifest), "utf8");
  const signature = crypto.sign(null, manifestBytes, privateKey);
  const envelopeBytes = Buffer.from(JSON.stringify({
    schema_version: "1.0",
    kind: "oak-standards-envelope",
    manifest_b64: manifestBytes.toString("base64"),
    signatures: [{ keyid, alg: "ed25519", sig_b64: signature.toString("base64") }],
    files: [
      { path: "standards.json", payload_b64: standardsBytes.toString("base64") },
      { path: "rulepack.json", payload_b64: rulepackBytes.toString("base64") },
    ],
  }), "utf8");
  return {
    envelopeBytes,
    manifestSha256: storeSha256(manifestBytes),
    trustStore: {
      schema_version: "1.0",
      kind: "oak-standards-trust-store",
      keys: { [keyid]: { alg: "ed25519", spki_der_b64: der.toString("base64") } },
      roles: { release: { threshold: 1, keyids: [keyid] } },
    },
  };
}

function requestBody(overrides = {}) {
  return {
    schema_version: "1.0",
    request_type: "oak_manuscript_standard_update_check",
    app_version: "0.1.0-alpha.50",
    bundle_id: "oak-standards",
    current_release_sequence: 2,
    current_manifest_sha256: CURRENT_MANIFEST,
    ...overrides,
  };
}

function publishedRelease(overrides = {}) {
  return {
    schema_version: "1.0",
    record_type: "oak_standards_published_release",
    bundle_id: "oak-standards",
    release_sequence: 3,
    manifest_sha256: NEXT_MANIFEST,
    envelope_sha256: sha256(ENVELOPE),
    envelope_bytes: ENVELOPE,
    ...overrides,
  };
}

function nodeRequest({
  method = "POST",
  url = STANDARDS_UPDATE_API_PATH,
  headers = {},
  body = Buffer.alloc(0),
  encrypted = true,
} = {}) {
  const value = Readable.from(body.length ? [body] : []);
  value.method = method;
  value.url = url;
  value.headers = Object.fromEntries(Object.entries(headers).map(([key, item]) => [key.toLowerCase(), item]));
  value.rawHeaders = Object.entries(headers).flatMap(([key, item]) => [key, String(item)]);
  value.socket = { encrypted };
  return value;
}

function nodeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body = Buffer.alloc(0)) { this.body = Buffer.from(body); },
    json() { return JSON.parse(this.body.toString("utf8")); },
  };
}

function harness({ sourceResult = publishedRelease(), service, ...overrides } = {}) {
  const events = [];
  const calls = [];
  const releaseSource = {
    async latest(bundleId) {
      calls.push(bundleId);
      return sourceResult;
    },
  };
  const selectedService = service || new StandardsUpdateService({ releaseSource });
  const handler = createStandardsUpdateHttpHandler({
    service: selectedService,
    expectedOrigin: ORIGIN,
    requestIdFactory: () => REQUEST_ID,
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
    securityEventSink: (event) => events.push(event),
    ...overrides,
  });
  return { calls, events, handler, releaseSource, service: selectedService };
}

async function invoke(context, options = {}) {
  const output = nodeResponse();
  await context.handler(nodeRequest(options), output);
  return output;
}

function encodedRequest(overrides = {}) {
  const body = Buffer.from(JSON.stringify(requestBody(overrides)), "utf8");
  return {
    body,
    headers: {
      Accept: PACKAGE_MEDIA_TYPE,
      "Content-Type": "application/json",
      "Content-Length": String(body.length),
    },
  };
}

test("standards update public schemas and service contracts are exact and content-free", async () => {
  const schemaRoot = path.join(ROOT, "config", "schemas");
  const requestSchema = JSON.parse(fs.readFileSync(path.join(schemaRoot, "standards-update-request-v1.schema.json"), "utf8"));
  const errorSchema = JSON.parse(fs.readFileSync(path.join(schemaRoot, "standards-update-http-error-v1.schema.json"), "utf8"));
  const auditSchema = JSON.parse(fs.readFileSync(path.join(schemaRoot, "standards-update-http-audit-v1.schema.json"), "utf8"));
  assert.equal(requestSchema.additionalProperties, false);
  assert.deepEqual(requestSchema.required, Object.keys(requestBody()));
  assert.equal(errorSchema.additionalProperties, false);
  assert.equal(auditSchema.properties.event_type.const, "standards_update_http_request_completed");

  assert.equal(validateStandardsUpdateRequest(requestBody()), true);
  assert.throws(() => validateStandardsUpdateRequest(requestBody({ account_id: "private" })), /请求/);
  for (const forbidden of ["manuscript", "project", "path", "file", "account", "token"]) {
    assert.equal(JSON.stringify(requestBody()).toLowerCase().includes(`\"${forbidden}`), false);
  }
});

test("one secure public POST returns the exact immutable signed package bytes", async () => {
  const context = harness();
  const output = await invoke(context, encodedRequest());
  assert.equal(output.statusCode, 200);
  assert.deepEqual(output.body, ENVELOPE);
  assert.equal(output.headers["content-type"], PACKAGE_MEDIA_TYPE);
  assert.equal(output.headers["content-length"], String(ENVELOPE.length));
  assert.equal(output.headers["cache-control"], "no-store");
  assert.deepEqual(context.calls, ["oak-standards"]);
  assert.equal(context.events.length, 1);
  assert.equal(validateStandardsUpdateHttpAuditEvent(context.events[0]), true);
  assert.equal(JSON.stringify(context.events).includes(CURRENT_MANIFEST), false);
});

test("an exact current state returns an empty 204 and no package metadata", async () => {
  const context = harness();
  const output = await invoke(context, encodedRequest({
    current_release_sequence: 3,
    current_manifest_sha256: NEXT_MANIFEST,
  }));
  assert.equal(output.statusCode, 204);
  assert.equal(output.body.length, 0);
  assert.equal(output.headers["content-length"], "0");
  assert.equal(Object.hasOwn(output.headers, "content-type"), false);
});

test("routing, framing, credentials, and request poisoning fail before release lookup", async () => {
  const cases = [
    [{ encrypted: false }, 400, "INSECURE_TRANSPORT"],
    [{ method: "GET" }, 405, "METHOD_NOT_ALLOWED"],
    [{ url: `${STANDARDS_UPDATE_API_PATH}/extra` }, 404, "NOT_FOUND"],
    [{ headers: { Authorization: "Bearer private" } }, 400, "CREDENTIALS_NOT_ALLOWED"],
  ];
  for (const [options, status, code] of cases) {
    const context = harness();
    const output = await invoke(context, options);
    assert.equal(output.statusCode, status);
    assert.equal(output.json().error.code, code);
    assert.equal(validateStandardsUpdateHttpErrorResponse(output.json()), true);
    assert.equal(context.calls.length, 0);
  }

  const context = harness();
  const poisoned = encodedRequest({ manuscript_content: "private" });
  const output = await invoke(context, poisoned);
  assert.equal(output.statusCode, 400);
  assert.equal(output.json().error.code, "INVALID_REQUEST");
  assert.equal(context.calls.length, 0);
  assert.equal(output.body.includes(Buffer.from("private")), false);
});

test("duplicate framing, body drift, media drift, and client identity conflicts fail closed", async () => {
  const context = harness();
  const valid = encodedRequest();
  const duplicate = nodeRequest(valid);
  duplicate.rawHeaders.push("Content-Length", String(valid.body.length));
  const duplicateOutput = nodeResponse();
  await context.handler(duplicate, duplicateOutput);
  assert.equal(duplicateOutput.statusCode, 400);
  assert.equal(duplicateOutput.json().error.code, "INVALID_HEADERS");

  const cases = [
    [{ ...valid, headers: { ...valid.headers, "Content-Length": String(valid.body.length + 1) } }, 400, "BODY_LENGTH_MISMATCH"],
    [{ ...valid, headers: { ...valid.headers, "Content-Type": "application/json; charset=utf-8" } }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    [{ ...valid, headers: { ...valid.headers, Accept: "application/json" } }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    [{ ...valid, headers: { ...valid.headers, "Transfer-Encoding": "chunked" } }, 400, "TRANSFER_ENCODING_NOT_ALLOWED"],
  ];
  for (const [options, status, code] of cases) {
    const isolated = harness();
    const output = await invoke(isolated, options);
    assert.equal(output.statusCode, status);
    assert.equal(output.json().error.code, code);
    assert.equal(isolated.calls.length, 0);
  }

  const conflict = harness();
  const output = await invoke(conflict, encodedRequest({
    current_release_sequence: 3,
    current_manifest_sha256: "f".repeat(64),
  }));
  assert.equal(output.statusCode, 409);
  assert.equal(output.json().error.code, "CLIENT_STATE_CONFLICT");
});

test("release source poisoning and digest drift become bounded non-reflective failures", async () => {
  for (const sourceResult of [
    publishedRelease({ private_key: "secret" }),
    publishedRelease({ envelope_sha256: "c".repeat(64) }),
    publishedRelease({ bundle_id: "other-bundle" }),
  ]) {
    const context = harness({ sourceResult });
    const output = await invoke(context, encodedRequest());
    assert.equal(output.statusCode, 503);
    assert.equal(output.json().error.code, "SERVICE_UNAVAILABLE");
    assert.equal(output.body.includes(Buffer.from("secret")), false);
  }

  const unavailable = harness({
    service: new StandardsUpdateService({
      releaseSource: { async latest() { throw new Error("private storage location"); } },
    }),
  });
  const output = await invoke(unavailable, encodedRequest());
  assert.equal(output.statusCode, 503);
  assert.equal(output.json().error.code, "SERVICE_UNAVAILABLE");
  assert.equal(output.body.includes(Buffer.from("storage")), false);
});

test("the real desktop HTTP client consumes the production-shaped Fetch handler without network", async () => {
  const context = harness();
  const fetchHandler = createFetchHandlerAdapter({ nodeHandler: context.handler });
  const client = new StandardsUpdateHttpClient({
    endpoint: `${ORIGIN}${STANDARDS_UPDATE_API_PATH}`,
    fetchImpl: (url, options) => fetchHandler(new Request(url, options)),
  });
  const result = await client.check({
    appVersion: "0.1.0-alpha.50",
    bundleId: "oak-standards",
    currentReleaseSequence: 2,
    currentManifestSha256: CURRENT_MANIFEST,
  });
  assert.equal(result.outcome, "update");
  assert.deepEqual(result.envelopeBytes, ENVELOPE);
  assert.equal(context.events.length, 1);
});

test("a real signed release crosses fake server, desktop client, verification, and atomic install", async (t) => {
  const signed = signedReleaseFixture();
  const sourceResult = publishedRelease({
    manifest_sha256: signed.manifestSha256,
    envelope_sha256: sha256(signed.envelopeBytes),
    envelope_bytes: signed.envelopeBytes,
  });
  const events = [];
  const fetchHandler = createStandardsUpdateFetchHandler({
    apiOrigin: ORIGIN,
    releaseSource: { async latest() { return sourceResult; } },
    requestIdFactory: () => REQUEST_ID,
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
    securityEventSink: (event) => events.push(event),
  });
  const client = new StandardsUpdateHttpClient({
    endpoint: `${ORIGIN}${STANDARDS_UPDATE_API_PATH}`,
    fetchImpl: (url, options) => fetchHandler(new Request(url, options)),
  });
  const provider = new StandardsProvider({
    rootDir: tempRoot(t, "standards-web-e2e-"),
    configDir: path.join(ROOT, "config"),
    appVersion: "0.1.0-alpha.50",
    bundledRelease: BUNDLED_STANDARD_RELEASE,
    trustStore: signed.trustStore,
    updateClient: client,
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
    planIdFactory: () => "80000000-0000-4000-8000-000000000008",
  });
  await provider.initialize();
  const before = await provider.verifiedActiveIdentity();
  const preview = await provider.checkForRemoteUpdate();
  assert.equal(preview.outcome, "update_available");
  assert.equal(preview.release_sequence, 3);
  assert.equal(preview.manifest_sha256, signed.manifestSha256);
  assert.equal((await provider.verifiedActiveIdentity()).release_sequence, 2);

  const installed = await provider.installRemoteUpdate(preview.plan_id);
  assert.equal(installed.active.release_sequence, 3);
  assert.equal(installed.previous.release_sequence, 2);
  assert.deepEqual(await provider.verifyReleaseIdentity(before), before);
  assert.equal(events.length, 1);
  assert.equal(JSON.stringify(events).includes(signed.manifestSha256), false);
});

test("production-shaped standards update runtime requires a content-free audit sink", () => {
  assert.throws(() => createStandardsUpdateFetchHandler({
    apiOrigin: ORIGIN,
    releaseSource: { async latest() { return null; } },
  }), /securityEventSink/);
});
