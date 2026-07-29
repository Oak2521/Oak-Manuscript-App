"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Readable } = require("node:stream");

const { StandardsRevocationHttpClient } = require("../electron/standards-revocation-http-client");
const { BUNDLED_STANDARD_RELEASE, StandardsProvider } = require("../electron/standards-provider");
const { canonicalJson, sha256 } = require("../electron/standards-store");
const { createFetchHandlerAdapter } = require("../web/fetch-adapter");
const {
  REVOCATION_API_PATH,
  REVOCATION_MEDIA_TYPE,
  createStandardsRevocationHttpHandler,
  validateStandardsRevocationHttpAuditEvent,
  validateStandardsRevocationHttpErrorResponse,
} = require("../web/standards-revocation-http-handler");
const {
  StandardsRevocationService,
  validatePublishedRevocation,
  validateStandardsRevocationRequest,
} = require("../web/standards-revocation-service");
const { createStandardsRevocationFetchHandler } = require("../web/standards-revocation-runtime");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://updates.oakbylake.com";
const REQUEST_ID = "90000000-0000-4000-8000-000000000009";

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function tempRoot(t, prefix) {
  const parent = path.join(ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function signedRevocationFixture(revoked = [BUNDLED_STANDARD_RELEASE.manifestSha256]) {
  const release = crypto.generateKeyPairSync("ed25519");
  const revocation = crypto.generateKeyPairSync("ed25519");
  const releaseDer = release.publicKey.export({ format: "der", type: "spki" });
  const revocationDer = revocation.publicKey.export({ format: "der", type: "spki" });
  const releaseKeyid = sha256(releaseDer);
  const revocationKeyid = sha256(revocationDer);
  const payloadBytes = Buffer.from(canonicalJson({
    schema_version: "1.0",
    kind: "oak-standards-revocation-list",
    bundle_id: "oak-standards",
    issued_at: "2026-07-29T00:00:00Z",
    expires_at: "2026-08-29T00:00:00Z",
    revoked_manifest_sha256s: [...revoked].sort(),
  }), "utf8");
  const envelopeBytes = Buffer.from(canonicalJson({
    schema_version: "1.0",
    kind: "oak-standards-revocation-envelope",
    payload_b64: payloadBytes.toString("base64"),
    signatures: [{
      keyid: revocationKeyid,
      alg: "ed25519",
      sig_b64: crypto.sign(null, payloadBytes, revocation.privateKey).toString("base64"),
    }],
  }), "utf8");
  return {
    envelopeBytes,
    payloadSha256: digest(payloadBytes),
    trustStore: {
      schema_version: "1.1",
      kind: "oak-standards-trust-store",
      keys: {
        [releaseKeyid]: { alg: "ed25519", spki_der_b64: releaseDer.toString("base64") },
        [revocationKeyid]: { alg: "ed25519", spki_der_b64: revocationDer.toString("base64") },
      },
      roles: {
        release: { threshold: 1, keyids: [releaseKeyid] },
        revocation: { threshold: 1, keyids: [revocationKeyid] },
      },
    },
  };
}

function requestBody(overrides = {}) {
  return {
    schema_version: "1.0",
    request_type: "oak_manuscript_standard_revocation_fetch",
    app_version: "0.1.0-alpha.52",
    bundle_id: "oak-standards",
    ...overrides,
  };
}

function publishedRevocation(fixture, overrides = {}) {
  return {
    schema_version: "1.0",
    record_type: "oak_standards_published_revocation_list",
    bundle_id: "oak-standards",
    payload_sha256: fixture.payloadSha256,
    envelope_sha256: digest(fixture.envelopeBytes),
    envelope_bytes: fixture.envelopeBytes,
    ...overrides,
  };
}

function nodeRequest({
  method = "POST",
  url = REVOCATION_API_PATH,
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

function encodedRequest(overrides = {}) {
  const body = Buffer.from(JSON.stringify(requestBody(overrides)), "utf8");
  return {
    body,
    headers: {
      Accept: REVOCATION_MEDIA_TYPE,
      "Content-Type": "application/json",
      "Content-Length": String(body.length),
    },
  };
}

function harness({ fixture = signedRevocationFixture(), sourceResult, service, ...overrides } = {}) {
  const calls = [];
  const events = [];
  const revocationSource = {
    async latest(bundleId) {
      calls.push(bundleId);
      return sourceResult === undefined ? publishedRevocation(fixture) : sourceResult;
    },
  };
  const selectedService = service || new StandardsRevocationService({ revocationSource });
  const handler = createStandardsRevocationHttpHandler({
    service: selectedService,
    expectedOrigin: ORIGIN,
    requestIdFactory: () => REQUEST_ID,
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
    securityEventSink: (event) => events.push(event),
    ...overrides,
  });
  return { calls, events, fixture, handler, revocationSource, service: selectedService };
}

async function invoke(context, options = {}) {
  const output = nodeResponse();
  await context.handler(nodeRequest(options), output);
  return output;
}

test("revocation acquisition schemas and service records are exact and content-free", () => {
  const schemaRoot = path.join(ROOT, "config", "schemas");
  const requestSchema = JSON.parse(fs.readFileSync(path.join(schemaRoot, "standards-revocation-request-v1.schema.json"), "utf8"));
  const errorSchema = JSON.parse(fs.readFileSync(path.join(schemaRoot, "standards-revocation-http-error-v1.schema.json"), "utf8"));
  const auditSchema = JSON.parse(fs.readFileSync(path.join(schemaRoot, "standards-revocation-http-audit-v1.schema.json"), "utf8"));
  assert.equal(requestSchema.additionalProperties, false);
  assert.deepEqual(requestSchema.required, Object.keys(requestBody()));
  assert.equal(errorSchema.additionalProperties, false);
  assert.equal(auditSchema.properties.event_type.const, "standards_revocation_http_request_completed");
  assert.equal(validateStandardsRevocationRequest(requestBody()), true);
  assert.throws(() => validateStandardsRevocationRequest(requestBody({ account_id: "private" })), /请求/);
  for (const forbidden of ["manuscript", "project", "path", "file", "account", "token", "device"]) {
    assert.equal(JSON.stringify(requestBody()).toLowerCase().includes(`\"${forbidden}`), false);
  }
});

test("one secure public POST returns exact immutable signed revocation bytes", async () => {
  const context = harness();
  const output = await invoke(context, encodedRequest());
  assert.equal(output.statusCode, 200);
  assert.deepEqual(output.body, context.fixture.envelopeBytes);
  assert.equal(output.headers["content-type"], REVOCATION_MEDIA_TYPE);
  assert.equal(output.headers["cache-control"], "no-store");
  assert.deepEqual(context.calls, ["oak-standards"]);
  assert.equal(validateStandardsRevocationHttpAuditEvent(context.events[0]), true);
  assert.equal(JSON.stringify(context.events).includes(context.fixture.payloadSha256), false);
});

test("routing, framing, credentials, and poisoned requests fail before source lookup", async () => {
  const cases = [
    [{ encrypted: false }, 400, "INSECURE_TRANSPORT"],
    [{ method: "GET" }, 405, "METHOD_NOT_ALLOWED"],
    [{ url: `${REVOCATION_API_PATH}/extra` }, 404, "NOT_FOUND"],
    [{ headers: { Authorization: "Bearer private" } }, 400, "CREDENTIALS_NOT_ALLOWED"],
  ];
  for (const [options, status, code] of cases) {
    const context = harness();
    const output = await invoke(context, options);
    assert.equal(output.statusCode, status);
    assert.equal(output.json().error.code, code);
    assert.equal(validateStandardsRevocationHttpErrorResponse(output.json()), true);
    assert.equal(context.calls.length, 0);
  }
  const poisoned = harness();
  const output = await invoke(poisoned, encodedRequest({ manuscript_content: "private" }));
  assert.equal(output.statusCode, 400);
  assert.equal(output.json().error.code, "INVALID_REQUEST");
  assert.equal(poisoned.calls.length, 0);
  assert.equal(output.body.includes(Buffer.from("private")), false);
});

test("duplicate framing, length drift, transfer encoding, and media drift fail closed", async () => {
  const valid = encodedRequest();
  const duplicateContext = harness();
  const duplicate = nodeRequest(valid);
  duplicate.rawHeaders.push("Content-Length", String(valid.body.length));
  const duplicateOutput = nodeResponse();
  await duplicateContext.handler(duplicate, duplicateOutput);
  assert.equal(duplicateOutput.statusCode, 400);
  assert.equal(duplicateOutput.json().error.code, "INVALID_HEADERS");
  assert.equal(duplicateContext.calls.length, 0);

  const cases = [
    [{ body: valid.body, headers: { Accept: REVOCATION_MEDIA_TYPE, "Content-Type": "application/json" } }, 411, "LENGTH_REQUIRED"],
    [{ ...valid, headers: { ...valid.headers, "Content-Length": String(valid.body.length + 1) } }, 400, "BODY_LENGTH_MISMATCH"],
    [{ ...valid, headers: { ...valid.headers, "Transfer-Encoding": "chunked" } }, 400, "TRANSFER_ENCODING_NOT_ALLOWED"],
    [{ ...valid, headers: { ...valid.headers, Accept: "application/json" } }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    [{ ...valid, headers: { ...valid.headers, "Content-Type": "application/json; charset=utf-8" } }, 415, "UNSUPPORTED_MEDIA_TYPE"],
  ];
  for (const [options, status, code] of cases) {
    const context = harness();
    const output = await invoke(context, options);
    assert.equal(output.statusCode, status);
    assert.equal(output.json().error.code, code);
    assert.equal(context.calls.length, 0);
  }
});

test("source absence, poisoning, and digest drift fail closed without reflecting details", async () => {
  const fixture = signedRevocationFixture();
  for (const sourceResult of [
    null,
    publishedRevocation(fixture, { private_key: "secret" }),
    publishedRevocation(fixture, { envelope_sha256: "f".repeat(64) }),
    publishedRevocation(fixture, { bundle_id: "other-bundle" }),
  ]) {
    const context = harness({ fixture, sourceResult });
    const output = await invoke(context, encodedRequest());
    assert.equal(output.statusCode, 503);
    assert.equal(output.json().error.code, "SERVICE_UNAVAILABLE");
    assert.equal(output.body.includes(Buffer.from("secret")), false);
  }
  assert.throws(() => validatePublishedRevocation(publishedRevocation(fixture, {
    payload_sha256: "f".repeat(64),
  }), "oak-standards"), /发布源/);
});

test("the desktop client consumes the production-shaped Fetch handler without network", async () => {
  const context = harness();
  const fetchHandler = createFetchHandlerAdapter({ nodeHandler: context.handler });
  const client = new StandardsRevocationHttpClient({
    endpoint: `${ORIGIN}${REVOCATION_API_PATH}`,
    fetchImpl: (url, options) => fetchHandler(new Request(url, options)),
  });
  const result = await client.fetch({ appVersion: "0.1.0-alpha.52", bundleId: "oak-standards" });
  assert.deepEqual(result.envelopeBytes, context.fixture.envelopeBytes);
  assert.equal(context.events.length, 1);
});

test("desktop client fixes a content-free request and rejects endpoint or response drift", async () => {
  const fixture = signedRevocationFixture([]);
  let observed;
  const client = new StandardsRevocationHttpClient({
    endpoint: `${ORIGIN}${REVOCATION_API_PATH}`,
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return new Response(fixture.envelopeBytes, {
        status: 200,
        headers: {
          "content-type": REVOCATION_MEDIA_TYPE,
          "content-length": String(fixture.envelopeBytes.length),
        },
      });
    },
  });
  await client.fetch({ appVersion: "0.1.0-alpha.52", bundleId: "oak-standards" });
  assert.equal(observed.url, `${ORIGIN}${REVOCATION_API_PATH}`);
  assert.equal(observed.options.method, "POST");
  assert.equal(observed.options.credentials, "omit");
  assert.equal(observed.options.redirect, "error");
  assert.deepEqual(JSON.parse(observed.options.body), requestBody());
  assert.equal(JSON.stringify(observed.options).toLowerCase().includes("authorization"), false);

  for (const endpoint of [
    `http://updates.oakbylake.com${REVOCATION_API_PATH}`,
    `${ORIGIN}${REVOCATION_API_PATH}?account=private`,
    `${ORIGIN}/manuscript/standards/v1/check`,
    `https://user:pass@updates.oakbylake.com${REVOCATION_API_PATH}`,
  ]) {
    assert.throws(() => new StandardsRevocationHttpClient({ endpoint }), /端点/);
  }

  const responses = [
    new Response(null, { status: 204 }),
    new Response(fixture.envelopeBytes, { status: 200, headers: { "content-type": "application/json" } }),
    new Response(fixture.envelopeBytes, { status: 200, headers: { "content-type": REVOCATION_MEDIA_TYPE, "content-encoding": "gzip" } }),
    new Response(fixture.envelopeBytes, { status: 200, headers: { "content-type": REVOCATION_MEDIA_TYPE, "set-cookie": "private=1" } }),
    new Response(fixture.envelopeBytes, { status: 200, headers: { "content-type": REVOCATION_MEDIA_TYPE, "content-length": String(fixture.envelopeBytes.length + 1) } }),
    new Response(fixture.envelopeBytes, { status: 200, headers: { "content-type": REVOCATION_MEDIA_TYPE, "content-length": String((1024 * 1024) + 1) } }),
  ];
  for (const response of responses) {
    const drifting = new StandardsRevocationHttpClient({
      endpoint: `${ORIGIN}${REVOCATION_API_PATH}`,
      fetchImpl: async () => response.clone(),
    });
    await assert.rejects(() => drifting.fetch({
      appVersion: "0.1.0-alpha.52",
      bundleId: "oak-standards",
    }), (error) => error && [
      "STANDARDS_REVOCATION_RESPONSE_INVALID",
      "STANDARDS_REVOCATION_UNAVAILABLE",
    ].includes(error.code));
  }
});

test("desktop client timeout and transport errors are bounded and non-reflective", async () => {
  const timeout = new StandardsRevocationHttpClient({
    endpoint: `${ORIGIN}${REVOCATION_API_PATH}`,
    timeoutMs: 100,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("private"), {
        name: "AbortError",
      })));
    }),
  });
  await assert.rejects(
    () => timeout.fetch({ appVersion: "0.1.0-alpha.52", bundleId: "oak-standards" }),
    (error) => error?.code === "STANDARDS_REVOCATION_TIMEOUT" && !error.message.includes("private"),
  );
  const unavailable = new StandardsRevocationHttpClient({
    endpoint: `${ORIGIN}${REVOCATION_API_PATH}`,
    fetchImpl: async () => { throw new Error("private upstream"); },
  });
  await assert.rejects(
    () => unavailable.fetch({ appVersion: "0.1.0-alpha.52", bundleId: "oak-standards" }),
    (error) => error?.code === "STANDARDS_REVOCATION_UNAVAILABLE" &&
      !error.message.includes("private"),
  );
});

test("a real signed list crosses fake server, desktop verification, and atomic local application", async (t) => {
  const fixture = signedRevocationFixture();
  const events = [];
  const fetchHandler = createStandardsRevocationFetchHandler({
    apiOrigin: ORIGIN,
    revocationSource: { async latest() { return publishedRevocation(fixture); } },
    requestIdFactory: () => REQUEST_ID,
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
    securityEventSink: (event) => events.push(event),
  });
  const client = new StandardsRevocationHttpClient({
    endpoint: `${ORIGIN}${REVOCATION_API_PATH}`,
    fetchImpl: (url, options) => fetchHandler(new Request(url, options)),
  });
  const provider = new StandardsProvider({
    rootDir: tempRoot(t, "standards-revocation-web-e2e-"),
    configDir: path.join(ROOT, "config"),
    appVersion: "0.1.0-alpha.52",
    bundledRelease: BUNDLED_STANDARD_RELEASE,
    trustStore: fixture.trustStore,
    revocationClient: client,
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
  });
  await provider.initialize();
  assert.equal(provider.status().ready, true);
  assert.equal(provider.status().network_revocations_enabled, true);
  const applied = await provider.refreshRemoteRevocations();
  assert.equal(applied.active_revoked, true);
  assert.equal(provider.status().ready, false);
  assert.equal(provider.status().error.code, "REVOKED_PACKAGE");
  assert.deepEqual(applied.revoked_manifest_sha256s, [BUNDLED_STANDARD_RELEASE.manifestSha256]);
  assert.equal(events.length, 1);
  assert.equal(JSON.stringify(events).includes(BUNDLED_STANDARD_RELEASE.manifestSha256), false);
});

test("provider keeps revocation networking disabled unless complete and rejects concurrent refreshes", async (t) => {
  const fixture = signedRevocationFixture([]);
  const offline = new StandardsProvider({
    rootDir: tempRoot(t, "standards-revocation-offline-"),
    configDir: path.join(ROOT, "config"),
    appVersion: "0.1.0-alpha.52",
    bundledRelease: BUNDLED_STANDARD_RELEASE,
    trustStore: fixture.trustStore,
  });
  await offline.initialize();
  assert.equal(offline.status().network_revocations_enabled, false);
  await assert.rejects(
    () => offline.refreshRemoteRevocations(),
    (error) => error?.code === "STANDARD_REVOCATION_NETWORK_DISABLED",
  );

  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const held = new Promise((resolve) => { releaseResolve = resolve; });
  const provider = new StandardsProvider({
    rootDir: tempRoot(t, "standards-revocation-concurrent-"),
    configDir: path.join(ROOT, "config"),
    appVersion: "0.1.0-alpha.52",
    bundledRelease: BUNDLED_STANDARD_RELEASE,
    trustStore: fixture.trustStore,
    revocationClient: {
      async fetch() {
        enteredResolve();
        await held;
        return { envelopeBytes: fixture.envelopeBytes };
      },
    },
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
  });
  await provider.initialize();
  const first = provider.refreshRemoteRevocations();
  await entered;
  await assert.rejects(
    () => provider.refreshRemoteRevocations(),
    (error) => error?.code === "STANDARD_REVOCATION_BUSY",
  );
  releaseResolve();
  const result = await first;
  assert.equal(result.active_revoked, false);
});

test("production-shaped revocation runtime requires a content-free audit sink", () => {
  assert.throws(() => createStandardsRevocationFetchHandler({
    apiOrigin: ORIGIN,
    revocationSource: { async latest() { return null; } },
  }), /securityEventSink/);
});
