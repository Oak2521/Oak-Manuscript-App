"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { LicenseHttpClient } = require("../electron/license-http-client");

function response(status, value, contentType = "application/json") {
  const bytes = Buffer.from(JSON.stringify(value));
  return { status, headers: new Headers({ "content-type": contentType, "content-length": String(bytes.length) }), arrayBuffer: async () => bytes };
}

test("license HTTP client sends one bounded account token request for the fixed device", async () => {
  let captured = null;
  const envelope = { schema_version: "1.0", record_type: "oak_manuscript_signed_entitlement", key_id: "k", algorithm: "Ed25519", claims: {}, signature: "s" };
  const client = new LicenseHttpClient({
    endpoint: "https://accounts.oakbylake.com/manuscript/api/v1/entitlement",
    fetchImpl: async (url, options) => { captured = { url, options }; return response(200, envelope); },
  });
  assert.deepEqual(await client.fetchEntitlement({ accessToken: "a".repeat(48), deviceId: "device-10000000-0000-4000-8000-000000000001" }), envelope);
  assert.equal(captured.url, "https://accounts.oakbylake.com/manuscript/api/v1/entitlement");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.credentials, "omit");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.options.headers.authorization, `Bearer ${"a".repeat(48)}`);
  assert.deepEqual(JSON.parse(captured.options.body), {
    schema_version: "1.0", request_type: "oak_manuscript_entitlement_request",
    device_id: "device-10000000-0000-4000-8000-000000000001",
  });
});
test("license HTTP client rejects non-HTTPS, auth errors, wrong media, and oversized responses", async () => {
  assert.throws(() => new LicenseHttpClient({ endpoint: "http://accounts.oakbylake.com/e", fetchImpl() {} }), /HTTPS/);
  const request = { accessToken: "a".repeat(48), deviceId: "device-10000000-0000-4000-8000-000000000001" };
  await assert.rejects(() => new LicenseHttpClient({ endpoint: "https://accounts.oakbylake.com/e", fetchImpl: async () => response(401, { error: true }) }).fetchEntitlement(request), /登录|授权/);
  await assert.rejects(() => new LicenseHttpClient({ endpoint: "https://accounts.oakbylake.com/e", fetchImpl: async () => response(200, {}, "text/plain") }).fetchEntitlement(request), /响应/);
});

test("license HTTP client maps exact subscription and device failures without reflecting server text", async () => {
  const request = { accessToken: "a".repeat(48), deviceId: "device-10000000-0000-4000-8000-000000000001" };
  for (const [status, remoteCode, localCode, message] of [
    [403, "SUBSCRIPTION_REQUIRED", "LICENSE_SUBSCRIPTION_REQUIRED", "Pro 订阅"],
    [429, "DEVICE_LIMIT", "LICENSE_DEVICE_LIMIT", "设备数量"],
    [503, "SERVICE_UNAVAILABLE", "LICENSE_UNAVAILABLE", "暂时不可用"],
  ]) {
    const client = new LicenseHttpClient({
      endpoint: "https://accounts.oakbylake.com/e",
      fetchImpl: async () => response(status, {
        schema_version: "1.0",
        error: { code: remoteCode, message: "private upstream detail must not be reflected" },
        request_id: "30000000-0000-4000-8000-000000000003",
      }),
    });
    await assert.rejects(() => client.fetchEntitlement(request), (error) =>
      error.code === localCode && error.message.includes(message) && !error.message.includes("private"));
  }
});
