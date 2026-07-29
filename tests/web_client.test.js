"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const contract = require("../web/client/client-contract");

const CLIENT_ROOT = path.join(__dirname, "..", "web", "client");
const HTML = fs.readFileSync(path.join(CLIENT_ROOT, "index.html"), "utf8");
const JS = fs.readFileSync(path.join(CLIENT_ROOT, "app.js"), "utf8");

test("Web client payload exactly matches the tracked privacy-minimal create contract", () => {
  const payload = contract.buildCreatePayload({
    format: "docx",
    manuscriptType: "paper",
    checkConfig: "full",
    citationStyle: "default",
    sizeBytes: 1024,
    idempotencyKey: "webclient-10000000-0000-4000-8000-000000000001",
    grantedAt: "2026-07-28T12:00:00.000Z",
    filename: "private-title.docx",
    path: "C:\\Private\\private-title.docx",
  });
  assert.deepEqual(payload, {
    schema_version: "1.0",
    request_type: "oak_manuscript_web_job",
    idempotency_key: "webclient-10000000-0000-4000-8000-000000000001",
    consent: {
      granted: true,
      scope: "single_job_processing",
      privacy_version: "web-privacy-v1",
      granted_at: "2026-07-28T12:00:00.000Z",
    },
    document: {
      format: "docx",
      manuscript_type: "paper",
      check_config: "full",
      citation_style: "default",
      size_bytes: 1024,
    },
  });
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("private-title"), false);
  assert.equal(serialized.includes("Private"), false);
});

test("Web client contract maps only supported extensions and exact media types", () => {
  assert.equal(contract.formatFromFilename("Private.Name.DOCX"), "docx");
  assert.equal(contract.formatFromFilename("book.epub"), "epub");
  assert.equal(contract.formatFromFilename("notes.md"), "md");
  assert.equal(contract.formatFromFilename("notes.txt"), "txt");
  assert.equal(contract.formatFromFilename("archive.zip"), null);
  assert.equal(contract.mediaTypeForFormat("docx"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(contract.mediaTypeForFormat("epub"), "application/epub+zip");
  assert.throws(() => contract.mediaTypeForFormat("pdf"), /不支持/);
});

test("Web client rejects invalid enums, limits, consent time, and idempotency", () => {
  const valid = {
    format: "txt",
    manuscriptType: "paper",
    checkConfig: "quick",
    citationStyle: "default",
    sizeBytes: 10,
    idempotencyKey: "webclient-10000000-0000-4000-8000-000000000001",
    grantedAt: "2026-07-28T12:00:00.000Z",
  };
  for (const change of [
    { format: "pdf" }, { manuscriptType: "memo" }, { checkConfig: "custom" },
    { citationStyle: "guess" }, { sizeBytes: 0 }, { sizeBytes: contract.MAX_BYTES + 1 },
    { idempotencyKey: "short" }, { grantedAt: "not-a-time" },
  ]) assert.throws(() => contract.buildCreatePayload({ ...valid, ...change }));

  const status = {
    schema_version: "1.0",
    record_type: "oak_manuscript_web_job_status",
    job_id: "webjob-10000000-0000-4000-8000-000000000001",
    state: "queued",
    created_at: "2026-07-28T12:00:00.000Z",
    expires_at: "2026-07-28T12:15:00.000Z",
    input_retained: true,
    result_available: false,
    deletion_due_at: "2026-07-28T12:15:00.000Z",
  };
  assert.deepEqual(contract.parseJobStatus(status), status);
  assert.equal(Object.isFrozen(contract.parseJobStatus(status)), true);
  assert.throws(() => contract.parseJobStatus({ ...status, token: "secret" }), /响应非法/);
  assert.throws(() => contract.parseJobStatus({ ...status, job_id: "undefined" }), /响应非法/);
});

test("Web page preserves login/register, default citation, consent, cancel, download, and sync notice", () => {
  for (const required of [
    'id="login-link"', 'href="/register/"', 'id="manuscript-file"',
    '<option value="default">默认', 'id="processing-consent"', 'id="cancel-job"',
    'id="download-result"', 'id="sync-panel"', "同步功能尚未启用", "结果只能领取一次",
  ]) assert.equal(HTML.includes(required), true, required);
  assert.equal(HTML.includes("登录本身不等于同意同步"), true);
  assert.equal(HTML.includes("文件名不会写入任务元数据"), true);
});

test("Web client uses safe text rendering and no browser persistence or analytics", () => {
  assert.equal(JS.includes(".innerHTML"), false);
  assert.equal(JS.includes("insertAdjacentHTML"), false);
  assert.equal(JS.includes("localStorage"), false);
  assert.equal(JS.includes("sessionStorage"), false);
  assert.equal(JS.includes("document.cookie"), false);
  assert.equal(JS.includes("sendBeacon"), false);
  assert.equal(JS.includes("textContent"), true);
  assert.equal(JS.includes('credentials: "omit"'), true);
  assert.equal(JS.includes('headers.set("Authorization", "Bearer " + token)'), true);
  assert.match(JS, /\/result", \{ method: "POST" \}/);
  assert.equal(JS.includes('setStatus("结果已领取；服务器临时副本已在返回前删除。'), true);
});
