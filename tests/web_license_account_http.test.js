"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Readable } = require("node:stream");

const {
  LICENSE_ACCOUNT_API_PATH,
  createLicenseAccountHttpHandler,
  validateLicenseAccountAuditEvent,
  validateLicenseAccountHttpErrorResponse,
} = require("../web/license-account-http-handler");

const ORIGIN = "https://accounts.oakbylake.com";
const ACCOUNT = "account-0001";
const DEVICE = "device-10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000003";

function publicDevice(state = "active") {
  return {
    device_id: DEVICE, device_state: state,
    first_seen_at: "2026-07-20T00:00:00.000Z", last_seen_at: "2026-07-29T11:00:00.000Z",
    revoked_at: state === "revoked" ? "2026-07-29T12:00:00.000Z" : null,
  };
}

function overview() {
  return {
    schema_version: "1.0", account_type: "oak_manuscript_license_account",
    entitlement: {
      entitlement_state: "active", not_before: "2026-07-01T00:00:00.000Z",
      valid_until: "2026-08-01T00:00:00.000Z", grace_until: "2026-08-08T00:00:00.000Z",
    },
    devices: [publicDevice()], truncated: false,
  };
}

function revokeResult() {
  return { schema_version: "1.0", outcome: "revoked", device: publicDevice("revoked") };
}

function request({ method = "GET", url = LICENSE_ACCOUNT_API_PATH, headers = {}, body = Buffer.alloc(0), encrypted = true, session } = {}) {
  const value = Readable.from(body.length ? [body] : []);
  value.method = method; value.url = url;
  value.headers = Object.fromEntries(Object.entries(headers).map(([key, item]) => [key.toLowerCase(), item]));
  value.rawHeaders = Object.entries(headers).flatMap(([key, item]) => [key, String(item)]);
  value.socket = { encrypted };
  value.session = session || { principal: { kind: "account", subject_id: ACCOUNT }, auth_mode: "bearer" };
  return value;
}

function response() {
  return { statusCode: null, headers: null, body: Buffer.alloc(0), writeHead(code, headers) { this.statusCode = code; this.headers = headers; }, end(body = Buffer.alloc(0)) { this.body = Buffer.from(body); }, json() { return JSON.parse(this.body.toString("utf8")); } };
}

function harness(overrides = {}) {
  const events = [];
  const calls = [];
  const service = {
    async getOverview(...args) { calls.push(["get", ...args]); return overview(); },
    async revokeDevice(...args) { calls.push(["revoke", ...args]); return revokeResult(); },
  };
  const handler = createLicenseAccountHttpHandler({
    service, expectedOrigin: ORIGIN, resolveSession: async (input) => input.session,
    requestIdFactory: () => REQUEST_ID, clock: () => new Date("2026-07-29T12:00:00.000Z"),
    securityEventSink: (event) => events.push(event), ...overrides,
  });
  return { calls, events, handler };
}

async function invoke(context, options = {}) {
  const output = response();
  await context.handler(request(options), output);
  return output;
}

function revokeBody(extra = {}) {
  return { schema_version: "1.0", action: "revoke_device", ...extra };
}

test("license account HTTP schemas match exact overview, revoke, error, and content-free audit contracts", () => {
  const root = path.join(__dirname, "..", "config", "schemas");
  for (const file of [
    "license-account-overview-v1.schema.json", "license-device-revoke-v1.schema.json",
    "license-account-http-error-v1.schema.json", "license-account-http-audit-v1.schema.json",
  ]) {
    const schema = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    assert.equal(schema.additionalProperties, false, file);
  }
});

test("secure owner can list account license state and explicitly revoke one device", async () => {
  const context = harness();
  const listed = await invoke(context);
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), overview());
  const body = Buffer.from(JSON.stringify(revokeBody()), "utf8");
  const revoked = await invoke(context, {
    method: "POST", url: `${LICENSE_ACCOUNT_API_PATH}/devices/${DEVICE}/revoke`, body,
    headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", "Content-Length": body.length },
  });
  assert.equal(revoked.statusCode, 200);
  assert.deepEqual(revoked.json(), revokeResult());
  assert.deepEqual(context.calls, [
    ["get", { kind: "account", subject_id: ACCOUNT }],
    ["revoke", { kind: "account", subject_id: ACCOUNT }, DEVICE],
  ]);
  assert.equal(context.events.length, 2);
  context.events.forEach(validateLicenseAccountAuditEvent);
  assert.equal(JSON.stringify(context.events).includes(DEVICE), false);
});

test("cookie, cross-site, malformed body, unknown route, and device self-report fail before service mutation", async () => {
  const cases = [
    [{ encrypted: false }, 400, "INSECURE_TRANSPORT"],
    [{ session: { principal: { kind: "account", subject_id: ACCOUNT }, auth_mode: "cookie", csrf_token: "x".repeat(32) } }, 401, "AUTH_REQUIRED"],
    [{ headers: { "Sec-Fetch-Site": "cross-site" } }, 403, "CROSS_SITE_REQUEST"],
    [{ url: `${LICENSE_ACCOUNT_API_PATH}/unknown` }, 404, "NOT_FOUND"],
  ];
  for (const [options, status, code] of cases) {
    const context = harness();
    const output = await invoke(context, options);
    assert.equal(output.statusCode, status);
    assert.equal(output.json().error.code, code);
    validateLicenseAccountHttpErrorResponse(output.json());
    assert.equal(context.calls.length, 0);
  }
  const context = harness();
  const missingOriginBody = Buffer.from(JSON.stringify(revokeBody()), "utf8");
  const missingOrigin = await invoke(context, {
    method: "POST", url: `${LICENSE_ACCOUNT_API_PATH}/devices/${DEVICE}/revoke`, body: missingOriginBody,
    headers: { "Content-Type": "application/json", "Content-Length": missingOriginBody.length },
  });
  assert.equal(missingOrigin.statusCode, 403);
  assert.equal(missingOrigin.json().error.code, "CROSS_SITE_REQUEST");
  assert.equal(context.calls.length, 0);
  const body = Buffer.from(JSON.stringify(revokeBody({ account_id: ACCOUNT, device_id: DEVICE })), "utf8");
  const output = await invoke(context, {
    method: "POST", url: `${LICENSE_ACCOUNT_API_PATH}/devices/${DEVICE}/revoke`, body,
    headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", "Content-Length": body.length },
  });
  assert.equal(output.statusCode, 400);
  assert.equal(output.json().error.code, "INVALID_REQUEST");
  assert.equal(context.calls.length, 0);
});

test("service errors and response poisoning are bounded and never expose internal fields", async () => {
  const failing = harness({ service: { async getOverview() { const error = new Error("private account"); error.code = "DEVICE_NOT_FOUND"; throw error; }, async revokeDevice() {} } });
  const missing = await invoke(failing);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "DEVICE_NOT_FOUND");
  assert.equal(JSON.stringify(missing.json()).includes("private"), false);
  const poisoned = harness({ service: { async getOverview() { return { ...overview(), account_id: ACCOUNT }; }, async revokeDevice() {} } });
  const output = await invoke(poisoned);
  assert.equal(output.statusCode, 503);
  assert.equal(JSON.stringify(output.json()).includes(ACCOUNT), false);
});
