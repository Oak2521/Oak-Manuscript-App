"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Readable } = require("node:stream");

const {
  ENTITLEMENT_API_PATH,
  createEntitlementHttpHandler,
  validateEntitlementHttpAuditEvent,
  validateEntitlementHttpErrorResponse,
} = require("../web/entitlement-http-handler");

const ORIGIN = "https://accounts.oakbylake.com";
const DEVICE = "device-10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000003";
const ENVELOPE = Object.freeze({
  schema_version: "1.0",
  record_type: "oak_manuscript_signed_entitlement",
  key_id: "test-key",
  algorithm: "Ed25519",
  claims: Object.freeze({
    issuer: `${ORIGIN}/`,
    audience: "oak-manuscript-desktop",
    entitlement_id: "ent-20000000-0000-4000-8000-000000000002",
    account_id: "account-0001",
    device_id: DEVICE,
    tier: "pro",
    device_state: "active",
    issued_at: "2026-07-29T12:00:00.000Z",
    not_before: "2026-07-29T12:00:00.000Z",
    valid_until: "2026-08-29T12:00:00.000Z",
    grace_until: "2026-09-05T12:00:00.000Z",
  }),
  signature: "s".repeat(86),
});

function request({ method = "POST", url = ENTITLEMENT_API_PATH, headers = {}, body = Buffer.alloc(0), encrypted = true, session } = {}) {
  const value = Readable.from(body.length ? [body] : []);
  value.method = method; value.url = url;
  value.headers = Object.fromEntries(Object.entries(headers).map(([key, item]) => [key.toLowerCase(), item]));
  value.rawHeaders = Object.entries(headers).flatMap(([key, item]) => [key, String(item)]);
  value.socket = { encrypted };
  value.session = session || { principal: { kind: "account", subject_id: "account-0001" }, auth_mode: "bearer" };
  return value;
}

function response() {
  return { statusCode: null, headers: null, body: Buffer.alloc(0), writeHead(code, headers) { this.statusCode = code; this.headers = headers; }, end(body = Buffer.alloc(0)) { this.body = Buffer.from(body); }, json() { return JSON.parse(this.body.toString("utf8")); } };
}

function harness(overrides = {}) {
  const events = [];
  const calls = [];
  const handler = createEntitlementHttpHandler({
    service: { async issue(...args) { calls.push(args); return ENVELOPE; } },
    expectedOrigin: ORIGIN,
    resolveSession: async (input) => input.session,
    requestIdFactory: () => REQUEST_ID,
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
    securityEventSink: (event) => events.push(event),
    ...overrides,
  });
  return { calls, events, handler };
}

async function invoke(context, options = {}) {
  const output = response();
  await context.handler(request(options), output);
  return output;
}

function validBody(extra = {}) {
  return { schema_version: "1.0", request_type: "oak_manuscript_entitlement_request", device_id: DEVICE, ...extra };
}

test("entitlement HTTP schemas match the exact runtime contracts", () => {
  const root = path.join(__dirname, "..", "config", "schemas");
  const requestSchema = JSON.parse(fs.readFileSync(path.join(root, "entitlement-request-v1.schema.json"), "utf8"));
  const errorSchema = JSON.parse(fs.readFileSync(path.join(root, "license-http-error-v1.schema.json"), "utf8"));
  const auditSchema = JSON.parse(fs.readFileSync(path.join(root, "license-http-audit-v1.schema.json"), "utf8"));
  assert.equal(requestSchema.additionalProperties, false);
  assert.deepEqual(requestSchema.required, ["schema_version", "request_type", "device_id"]);
  assert.equal(errorSchema.additionalProperties, false);
  assert.equal(errorSchema.$defs.errorCode.enum.includes("SUBSCRIPTION_REQUIRED"), true);
  assert.equal(errorSchema.properties.error.properties.code.$ref, "#/$defs/errorCode");
  assert.equal(auditSchema.properties.event_type.const, "license_http_request_completed");
  assert.deepEqual(auditSchema.properties.route.enum, [ENTITLEMENT_API_PATH, "unmatched"]);
});

test("one secure Bearer POST reaches the service without requiring a browser Origin", async () => {
  const context = harness();
  const body = Buffer.from(JSON.stringify(validBody()), "utf8");
  const output = await invoke(context, { headers: { "Content-Type": "application/json", "Content-Length": body.length }, body });
  assert.equal(output.statusCode, 200);
  assert.deepEqual(output.json(), ENVELOPE);
  assert.equal(output.headers["cache-control"], "no-store");
  assert.deepEqual(context.calls, [[{ kind: "account", subject_id: "account-0001" }, validBody()]]);
  assert.equal(context.events.length, 1);
  validateEntitlementHttpAuditEvent(context.events[0]);
  assert.equal(JSON.stringify(context.events).includes(DEVICE), false);
});

test("cookie sessions, insecure transport, malformed framing, routes, and unknown request fields fail closed", async () => {
  const cases = [
    [{ encrypted: false }, 400, "INSECURE_TRANSPORT"],
    [{ session: { principal: { kind: "account", subject_id: "account-0001" }, auth_mode: "cookie", csrf_token: "x".repeat(32) } }, 401, "AUTH_REQUIRED"],
    [{ method: "GET" }, 405, "METHOD_NOT_ALLOWED"],
    [{ url: `${ENTITLEMENT_API_PATH}/extra` }, 404, "NOT_FOUND"],
  ];
  for (const [options, status, code] of cases) {
    const context = harness();
    const output = await invoke(context, options);
    assert.equal(output.statusCode, status);
    assert.equal(output.json().error.code, code);
    validateEntitlementHttpErrorResponse(output.json());
    assert.equal(context.calls.length, 0);
  }
  const context = harness();
  const body = Buffer.from(JSON.stringify(validBody({ account_id: "account-0001" })), "utf8");
  const output = await invoke(context, { headers: { "Content-Type": "application/json", "Content-Length": body.length }, body });
  assert.equal(output.statusCode, 400);
  assert.equal(output.json().error.code, "INVALID_REQUEST");
  assert.equal(context.calls.length, 0);
});

test("service outcomes map to bounded content-free errors and audit failures cannot alter responses", async () => {
  const context = harness({
    service: { async issue() { const error = new Error("private account/device detail"); error.code = "DEVICE_LIMIT"; throw error; } },
    securityEventSink() { throw new Error("audit down"); },
  });
  const body = Buffer.from(JSON.stringify(validBody()), "utf8");
  const output = await invoke(context, { headers: { "Content-Type": "application/json", "Content-Length": body.length }, body });
  assert.equal(output.statusCode, 429);
  assert.equal(output.json().error.code, "DEVICE_LIMIT");
  assert.equal(JSON.stringify(output.json()).includes("private"), false);
});

test("service response poisoning is blocked before any extra field reaches the client", async () => {
  const context = harness({ service: { async issue() { return { ...ENVELOPE, private_key: "must-not-leak" }; } } });
  const body = Buffer.from(JSON.stringify(validBody()), "utf8");
  const output = await invoke(context, { headers: { "Content-Type": "application/json", "Content-Length": body.length }, body });
  assert.equal(output.statusCode, 503);
  assert.equal(output.json().error.code, "SERVICE_UNAVAILABLE");
  assert.equal(JSON.stringify(output.json()).includes("must-not-leak"), false);
});
