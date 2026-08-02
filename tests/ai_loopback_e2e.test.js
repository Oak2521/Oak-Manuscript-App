"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { BoundedAIHttpClient } = require("../electron/ai-http-client");
const { createOpenAICompatibleAdapters } = require("../electron/ai-openai-compatible-adapter");
const { AIProvider } = require("../electron/ai-provider");
const { AIRequestCoordinator } = require("../electron/ai-request");
const { AITransportRouter } = require("../electron/ai-transport-router");

const PROJECT = "C:\\projects\\oak-loopback";
const ISSUE_ID = "check-0001-0001";
const PRO = Object.freeze({ effectiveTier: "pro" });

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  return server;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function context() {
  return {
    schema_version: "1.0",
    context_type: "oak_manuscript_issue_suggestion",
    binding: {
      issue_id: ISSUE_ID,
      check_id: "check-0001",
      working_sha256: "a".repeat(64),
      rulepack_manifest_sha256: "b".repeat(64),
    },
    request_content: {
      rule_id: "CN-001",
      severity: "warning",
      title: "连续空格",
      explanation: "这里包含连续空格。",
      location: "正文第 3 段",
      preview: "湖岸  稿件",
      standard_refs: ["GB/T 15834—2011"],
      status: "open",
    },
  };
}

function system(baseUrl, { reviewSink = async () => {} } = {}) {
  const router = new AITransportRouter({
    adapters: createOpenAICompatibleAdapters(),
    httpClient: new BoundedAIHttpClient({ timeoutMs: 2_000 }),
  });
  const provider = new AIProvider();
  provider.configureTransport(router);
  provider.configure({
    mode: "byo",
    provider: "ollama",
    model: "qwen3:8b",
    base_url: baseUrl,
    credential_action: "clear",
    credential: null,
  }, PRO);
  return new AIRequestCoordinator({
    aiProvider: provider,
    licenseProvider: { status: () => PRO },
    contextSource: async () => context(),
    reviewSink,
    now: () => Date.parse("2026-07-29T18:00:00.000Z"),
    idFactory: () => "ai-plan-00000000-0000-4000-8000-000000000042",
    reviewIdFactory: () => "ai-review-00000000-0000-4000-8000-000000000042",
    transport: router,
  });
}

test("explicit confirmation reaches a real loopback HTTP service and returns a memory-only suggestion", async () => {
  const requests = [];
  const reviews = [];
  const server = await listen((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      const body = Buffer.from(JSON.stringify({
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: "建议删除一个空格。" },
        }],
      }), "utf8");
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(body.length),
      });
      response.end(body);
    });
  });
  try {
    const address = server.address();
    const coordinator = system(`http://127.0.0.1:${address.port}/v1`, {
      reviewSink: async (value) => reviews.push(value),
    });
    const plan = await coordinator.planIssueSuggestion({
      project: PROJECT,
      issueId: ISSUE_ID,
      instruction: "保持原意。",
    });
    assert.equal(requests.length, 0);
    assert.equal(plan.transport_available, true);

    const suggestion = await coordinator.confirmSuggestion(plan.plan_id);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "/v1/chat/completions");
    assert.equal(requests[0].authorization, undefined);
    assert.equal(requests[0].body.model, "qwen3:8b");
    assert.equal(requests[0].body.stream, false);
    assert.equal(requests[0].body.messages[1].content.includes("湖岸  稿件"), true);
    assert.equal(suggestion.text, "建议删除一个空格。");
    assert.equal(suggestion.persistence, "memory_only");

    const review = await coordinator.reviewSuggestion(suggestion.review_id, "accepted");
    assert.equal(review.manuscript_modified, false);
    assert.deepEqual(reviews, [{ project: PROJECT, issueId: ISSUE_ID, status: "accepted" }]);
  } finally {
    await close(server);
  }
});

test("a real loopback connection reset becomes an actionable one-shot failure", async () => {
  let connections = 0;
  const server = await listen((request) => {
    connections += 1;
    request.socket.destroy();
  });
  try {
    const address = server.address();
    const coordinator = system(`http://127.0.0.1:${address.port}/v1`);
    const plan = await coordinator.planIssueSuggestion({
      project: PROJECT,
      issueId: ISSUE_ID,
      instruction: "保持原意。",
    });
    await assert.rejects(
      () => coordinator.confirmSuggestion(plan.plan_id),
      (error) => error.code === "AI_SERVICE_UNREACHABLE" &&
        /服务已启动且地址正确/u.test(error.message),
    );
    assert.equal(connections, 1);
    await assert.rejects(() => coordinator.confirmSuggestion(plan.plan_id), /已过期或已使用/u);
  } finally {
    await close(server);
  }
});
