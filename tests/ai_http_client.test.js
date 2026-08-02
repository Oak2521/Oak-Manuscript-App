"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  AIHttpClientError,
  BoundedAIHttpClient,
  DEFAULT_MAX_RESPONSE_BYTES,
  validateEndpoint,
  validateHeaders,
  validateJson,
} = require("../electron/ai-http-client");

const SECRET = "sk-ai-http-secret-never-reflect";

function fakeResponse({
  statusCode = 200,
  headers = { "content-type": "application/json; charset=utf-8" },
  rawHeaders = null,
  chunks = [Buffer.from('{"ok":true}', "utf8")],
} = {}) {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  response.headers = headers;
  response.rawHeaders = rawHeaders || Object.entries(headers).flat();
  response.destroyedByClient = false;
  response.destroy = () => { response.destroyedByClient = true; };
  response.play = () => {
    for (const chunk of chunks) response.emit("data", chunk);
    response.emit("end");
  };
  return response;
}

function requestHarness(response = fakeResponse()) {
  const calls = [];
  let latest = null;
  const request = (url, options, onResponse) => {
    const handle = new EventEmitter();
    handle.destroyedByClient = false;
    handle.destroy = () => { handle.destroyedByClient = true; };
    handle.setTimeout = (timeoutMs, callback) => {
      handle.timeoutMs = timeoutMs;
      handle.timeoutCallback = callback;
    };
    handle.end = (body) => {
      handle.body = Buffer.from(body);
      process.nextTick(() => {
        onResponse(response);
        response.play();
      });
    };
    latest = handle;
    calls.push({ url, options, handle });
    return handle;
  };
  return { request, calls, latest: () => latest };
}

function clientWith(response, overrides = {}) {
  const https = requestHarness(response);
  const http = requestHarness(response);
  return {
    client: new BoundedAIHttpClient({
      httpsRequest: https.request,
      httpRequest: http.request,
      ...overrides,
    }),
    https,
    http,
  };
}

test("bounded AI HTTP client sends one fixed POST without proxy, cookies, redirects, or compression", async () => {
  const fixture = clientWith(fakeResponse());
  const result = await fixture.client.requestJson({
    url: "https://api.example.test/v1/messages",
    headers: { Authorization: `Bearer ${SECRET}`, "X-Vendor-Version": "2026-01-01" },
    json: { model: "fixed-model", messages: [{ role: "user", content: "测试" }] },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(fixture.http.calls.length, 0);
  assert.equal(fixture.https.calls.length, 1);
  const call = fixture.https.calls[0];
  assert.equal(call.url.href, "https://api.example.test/v1/messages");
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.agent, false);
  assert.equal(call.options.timeout, 60_000);
  assert.equal(call.options.headers.authorization, `Bearer ${SECRET}`);
  assert.equal(call.options.headers.accept, "application/json");
  assert.equal(call.options.headers["accept-encoding"], "identity");
  assert.equal(call.options.headers.cookie, undefined);
  assert.equal(call.options.headers["proxy-authorization"], undefined);
  assert.equal(Number(call.options.headers["content-length"]), call.handle.body.length);
  assert.deepEqual(JSON.parse(call.handle.body.toString("utf8")), {
    model: "fixed-model", messages: [{ role: "user", content: "测试" }],
  });
});

test("plain HTTP is allowed only for exact loopback hosts", async () => {
  for (const url of [
    "http://localhost:11434/api/chat",
    "http://127.0.0.1:1234/v1/chat/completions",
    "http://[::1]:8080/v1/messages",
  ]) assert.equal(validateEndpoint(url).protocol, "http:");
  for (const url of [
    "http://example.test/v1/messages",
    "http://localhost.example.test/v1/messages",
    "ftp://localhost/file",
  ]) assert.throws(() => validateEndpoint(url), /HTTPS|非法/u);

  const fixture = clientWith(fakeResponse());
  await fixture.client.requestJson({
    url: "http://127.0.0.1:11434/api/chat", headers: {}, json: { model: "local" },
  });
  assert.equal(fixture.http.calls.length, 1);
  assert.equal(fixture.https.calls.length, 0);
});

test("endpoint and request shape reject credential URLs, fragments, smuggled fields, and unsafe headers", () => {
  for (const url of [
    `https://user:${SECRET}@api.example.test/v1/messages`,
    `https://api.example.test/v1/messages?key=${SECRET}`,
    "https://api.example.test/v1/messages#fragment",
    "https://api.example.test/\u0000",
  ]) assert.throws(() => validateEndpoint(url), /不得|非法/u);
  for (const headers of [
    { Cookie: SECRET },
    { Host: "attacker.test" },
    { "Proxy-Authorization": SECRET },
    { "X-Forwarded-Host": "attacker.test" },
    { Authorization: `Bearer ${SECRET}`, authorization: "duplicate" },
    { Authorization: `Bearer ${SECRET}\r\nX-Leak: yes` },
  ]) assert.throws(() => validateHeaders(headers), /不允许|重复|非法/u);
  const fixture = clientWith(fakeResponse());
  assert.throws(() => fixture.client.requestJson({
    url: "https://api.example.test/v1/messages", headers: {}, json: {}, method: "GET",
  }), /字段集合/u);
  assert.equal(fixture.https.calls.length, 0);
});

test("request JSON is plain, finite, bounded, and side-effect free", () => {
  validateJson({ messages: [{ content: "ok" }], temperature: 0.2, stream: false });
  for (const value of [
    { temperature: Number.NaN },
    { value: BigInt(1) },
    { date: new Date() },
    Object.assign(Object.create(null), { model: "x" }),
    { constructor: "smuggled" },
  ]) assert.throws(() => validateJson(value), /JSON/u);

  let deep = {};
  for (let index = 0; index < 34; index += 1) deep = { child: deep };
  assert.throws(() => validateJson(deep), /超限/u);
  const fixture = clientWith(fakeResponse(), { maxRequestBytes: 32 });
  assert.throws(() => fixture.client.requestJson({
    url: "https://api.example.test/v1/messages", headers: {}, json: { prompt: "x".repeat(100) },
  }), (error) => error instanceof AIHttpClientError && error.code === "REQUEST_TOO_LARGE");
  assert.equal(fixture.https.calls.length, 0);
});

test("redirects, non-success status, media drift, compression, and duplicate lengths fail closed", async () => {
  const cases = [
    fakeResponse({ statusCode: 302, headers: { location: `https://attacker.test/${SECRET}` } }),
    fakeResponse({ statusCode: 401, chunks: [Buffer.from(`{"error":"${SECRET}"}`)] }),
    fakeResponse({ headers: { "content-type": "text/html" }, chunks: [Buffer.from(SECRET)] }),
    fakeResponse({ headers: {
      "content-type": "application/json", "content-encoding": "gzip",
    } }),
    fakeResponse({
      headers: { "content-type": "application/json", "content-length": "2" },
      rawHeaders: ["content-type", "application/json", "content-length", "2", "content-length", "3"],
    }),
    fakeResponse({
      headers: { "content-type": "application/json" },
      rawHeaders: ["content-type", "application/json", "dangling"],
    }),
  ];
  for (const response of cases) {
    const fixture = clientWith(response);
    await assert.rejects(
      () => fixture.client.requestJson({
        url: "https://api.example.test/v1/messages",
        headers: { Authorization: `Bearer ${SECRET}` },
        json: { model: "fixed" },
      }),
      (error) => error instanceof AIHttpClientError && !error.message.includes(SECRET),
    );
    assert.equal(response.destroyedByClient, true);
  }
});

test("declared and streamed response limits plus malformed JSON are rejected without body reflection", async () => {
  const responses = [
    fakeResponse({ headers: {
      "content-type": "application/json", "content-length": String(DEFAULT_MAX_RESPONSE_BYTES + 1),
    } }),
    fakeResponse({ chunks: [Buffer.alloc(DEFAULT_MAX_RESPONSE_BYTES), Buffer.from("x")] }),
    fakeResponse({ chunks: [Buffer.from(`{"secret":"${SECRET}"`, "utf8")] }),
  ];
  for (const response of responses) {
    const fixture = clientWith(response);
    await assert.rejects(
      () => fixture.client.requestJson({
        url: "https://api.example.test/v1/messages", headers: {}, json: { model: "fixed" },
      }),
      (error) => error instanceof AIHttpClientError && !error.message.includes(SECRET),
    );
  }
});

test("request construction, socket errors, and timeout expose only bounded local errors", async () => {
  const throwing = new BoundedAIHttpClient({
    httpsRequest: () => { throw new Error(`leak ${SECRET}`); },
    httpRequest: () => { throw new Error("unused"); },
  });
  await assert.rejects(
    () => throwing.requestJson({
      url: "https://api.example.test/v1/messages",
      headers: { Authorization: `Bearer ${SECRET}` }, json: { model: "fixed" },
    }),
    (error) => error.code === "NETWORK_FAILED" && !error.message.includes(SECRET),
  );

  const malformedHandle = new BoundedAIHttpClient({
    httpsRequest: () => ({}),
    httpRequest: () => ({}),
  });
  await assert.rejects(
    () => malformedHandle.requestJson({
      url: "https://api.example.test/v1/messages",
      headers: { Authorization: `Bearer ${SECRET}` }, json: { model: "fixed" },
    }),
    (error) => error.code === "NETWORK_FAILED" && !error.message.includes(SECRET),
  );

  const fixture = clientWith(fakeResponse());
  const pending = fixture.client.requestJson({
    url: "https://api.example.test/v1/messages",
    headers: { Authorization: `Bearer ${SECRET}` }, json: { model: "fixed" },
  });
  fixture.https.latest().timeoutCallback();
  await assert.rejects(
    () => pending,
    (error) => error.code === "NETWORK_TIMEOUT" && !error.message.includes(SECRET),
  );
  assert.equal(fixture.https.latest().destroyedByClient, true);
});
