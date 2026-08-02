"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { registerExternalValidationIpc } = require("../electron/external-validation-ipc");

const PROJECT = path.resolve("out", "test-tmp", "external-ipc-project");
const PLAN_ID = `external-plan-${"a".repeat(64)}`;
const REQUEST = Object.freeze({
  entry: path.resolve("tools", "ace", "ace.js"),
  chrome: path.resolve("out", "test-tmp", "chrome.exe"),
  epub: path.join(PROJECT, "working", "book.epub"),
  out_dir: path.join(PROJECT, "reports", "ace"),
});

function fixture({ aceRequest = REQUEST, runnerError = null } = {}) {
  const handlers = new Map();
  const coreCalls = [];
  const runnerCalls = [];
  const runCore = async (args) => {
    coreCalls.push(args);
    if (args[0] === "external-plan") {
      return { data: { ok: true, plan: { plan_id: PLAN_ID, ace_request: aceRequest } } };
    }
    if (args[0] === "external-prepare") {
      return { data: { ok: true, prepared: true } };
    }
    if (args[0] === "external-finalize") {
      return { data: { ok: true, results: { ace: { status: "passed", detail: "ok" } } } };
    }
    throw new Error(`unexpected command ${args[0]}`);
  };
  registerExternalValidationIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    pathPolicy: { looksLikeProject: (value) => value === PROJECT },
    runCore,
    aceRunner: {
      async run(value) {
        runnerCalls.push(value);
        if (runnerError) throw runnerError;
        return { exitCode: 0, runtime: "electron_utility_process" };
      },
    },
  });
  return { handler: handlers.get("core:external"), coreCalls, runnerCalls };
}

test("external IPC keeps the Ace request in main and finalizes one bound plan", async () => {
  const { handler, coreCalls, runnerCalls } = fixture();
  const result = await handler({}, { project: PROJECT, ignored: "renderer-cannot-add-args" });
  assert.equal(result.ok, true);
  assert.deepEqual(coreCalls, [
    ["external-plan", "--project", PROJECT],
    ["external-prepare", "--project", PROJECT, "--plan-id", PLAN_ID],
    [
      "external-finalize", "--project", PROJECT, "--plan-id", PLAN_ID,
      "--ace-exit-code", "0",
    ],
  ]);
  assert.deepEqual(runnerCalls, [{ project: PROJECT, request: REQUEST }]);
  assert.deepEqual(result.result.results.ace, { status: "passed", detail: "ok" });
});

test("external IPC records unavailable or failed helpers without accepting renderer status", async () => {
  const unavailable = fixture({ aceRequest: null });
  const unavailableResult = await unavailable.handler({}, { project: PROJECT });
  assert.equal(unavailableResult.ok, true);
  assert.deepEqual(unavailable.coreCalls, [
    ["external-plan", "--project", PROJECT],
    ["external-finalize", "--project", PROJECT, "--plan-id", PLAN_ID],
  ]);
  assert.deepEqual(unavailable.runnerCalls, []);

  const failed = fixture({ runnerError: new Error("helper failed") });
  const failedResult = await failed.handler({}, {
    project: PROJECT,
    aceExitCode: 0,
    aceStatus: "passed",
  });
  assert.equal(failedResult.ok, true);
  assert.deepEqual(failed.coreCalls.at(-1), [
    "external-finalize", "--project", PROJECT, "--plan-id", PLAN_ID,
  ]);
});

test("external IPC rejects an untrusted project before any core or utility process", async () => {
  const { handler, coreCalls, runnerCalls } = fixture();
  const result = await handler({}, { project: path.resolve("outside") });
  assert.equal(result.ok, false);
  assert.deepEqual(coreCalls, []);
  assert.deepEqual(runnerCalls, []);
});
