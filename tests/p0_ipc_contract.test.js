"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { registerP0Ipc } = require("../electron/p0-ipc");

test("sandboxed preload maps approved P0 and project-standard IPC payloads", async () => {
  const calls = [];
  let api = null;
  const preloadPath = path.resolve(__dirname, "../electron/preload.js");
  const source = fs.readFileSync(preloadPath, "utf8");
  vm.runInNewContext(source, {
    require(specifier) {
      assert.equal(
        specifier,
        "electron",
        "sandboxed preload must not require local modules or Node built-ins",
      );
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, "oak");
            api = value;
          },
        },
        ipcRenderer: {
          invoke(channel, payload) {
            calls.push({ channel, payload });
            return Promise.resolve({ ok: true });
          },
        },
      };
    },
  }, { filename: preloadPath });
  assert.ok(api, "preload must expose window.oak");

  await api.planFixes("C:\\projects\\oak");
  await api.applyFixPlan("C:\\projects\\oak", "plan-0001");
  await api.planCitation("C:\\projects\\oak", "default");
  await api.check("C:\\projects\\oak", "check", {
    citation: "default",
    citationPlanId: "citation-plan-0001",
  });
  await api.listCheckpoints("C:\\projects\\oak");
  await api.restoreCheckpoint("C:\\projects\\oak", "cp-0001");
  await api.projectStandardStatus("C:\\projects\\oak");
  await api.planProjectStandardChange("C:\\projects\\oak");
  await api.applyProjectStandardChange("C:\\projects\\oak", "rulepack-plan-0001");

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { channel: "core:plan-fixes", payload: { project: "C:\\projects\\oak" } },
    {
      channel: "core:apply-fix-plan",
      payload: { project: "C:\\projects\\oak", planId: "plan-0001" },
    },
    {
      channel: "core:plan-citation",
      payload: { project: "C:\\projects\\oak", citation: "default" },
    },
    {
      channel: "core:check",
      payload: {
        project: "C:\\projects\\oak",
        kind: "check",
        citation: "default",
        citationPlanId: "citation-plan-0001",
      },
    },
    { channel: "core:list-checkpoints", payload: { project: "C:\\projects\\oak" } },
    {
      channel: "core:restore-checkpoint",
      payload: { project: "C:\\projects\\oak", checkpointId: "cp-0001" },
    },
    {
      channel: "standards:project-status",
      payload: { project: "C:\\projects\\oak" },
    },
    {
      channel: "standards:plan-project-change",
      payload: { project: "C:\\projects\\oak" },
    },
    {
      channel: "standards:apply-project-change",
      payload: { project: "C:\\projects\\oak", planId: "rulepack-plan-0001" },
    },
  ]);
  assert.equal(Object.hasOwn(api, "fix"), false, "preload must not expose an unconfirmed direct fix");
});

test("main P0 IPC validates the project and maps bridge methods", async () => {
  const handlers = new Map();
  const calls = [];
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  const bridge = {
    planFixes: async (project) => {
      calls.push(["planFixes", project]);
      return { code: 0, json: { plan_id: "plan-0001", candidate_count: 0, items: [] }, stderr: "" };
    },
    applyFixPlan: async (project, planId) => {
      calls.push(["applyFixPlan", project, planId]);
      return { code: 0, json: { applied_count: 2 }, stderr: "" };
    },
    listCheckpoints: async (project) => {
      calls.push(["listCheckpoints", project]);
      return { code: 0, json: { checkpoints: [] }, stderr: "" };
    },
    restoreCheckpoint: async (project, checkpointId) => {
      calls.push(["restoreCheckpoint", project, checkpointId]);
      return { code: 0, json: { restored_checkpoint_id: checkpointId }, stderr: "" };
    },
  };
  const pathPolicy = { looksLikeProject: (project) => project === "C:\\projects\\oak" };

  registerP0Ipc({ ipcMain, bridge, pathPolicy });

  assert.deepEqual(Array.from(handlers.keys()).sort(), [
    "core:apply-fix-plan",
    "core:list-checkpoints",
    "core:plan-fixes",
    "core:restore-checkpoint",
  ]);

  const project = "C:\\projects\\oak";
  assert.equal((await handlers.get("core:plan-fixes")(null, { project })).ok, true);
  assert.equal(
    (await handlers.get("core:apply-fix-plan")(null, { project, planId: "plan-0001" })).ok,
    true,
  );
  assert.equal((await handlers.get("core:list-checkpoints")(null, { project })).ok, true);
  assert.equal(
    (await handlers.get("core:restore-checkpoint")(null, { project, checkpointId: "cp-0001" })).ok,
    true,
  );
  assert.deepEqual(calls, [
    ["planFixes", project],
    ["applyFixPlan", project, "plan-0001"],
    ["listCheckpoints", project],
    ["restoreCheckpoint", project, "cp-0001"],
  ]);
});

test("main P0 IPC rejects invalid paths and opaque IDs before reaching Python", async () => {
  let bridgeCalls = 0;
  const handlers = new Map();
  const bridge = {
    planFixes: async () => { bridgeCalls += 1; },
    applyFixPlan: async () => { bridgeCalls += 1; },
    listCheckpoints: async () => { bridgeCalls += 1; },
    restoreCheckpoint: async () => { bridgeCalls += 1; },
  };
  registerP0Ipc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    bridge,
    pathPolicy: { looksLikeProject: (project) => project === "C:\\projects\\oak" },
  });

  const badPath = await handlers.get("core:plan-fixes")(null, { project: "relative-project" });
  assert.equal(badPath.ok, false);

  const badPlan = await handlers.get("core:apply-fix-plan")(null, {
    project: "C:\\projects\\oak",
    planId: "../plan",
  });
  assert.equal(badPlan.ok, false);

  const badCheckpoint = await handlers.get("core:restore-checkpoint")(null, {
    project: "C:\\projects\\oak",
    checkpointId: "cp/0001",
  });
  assert.equal(badCheckpoint.ok, false);
  assert.equal(bridgeCalls, 0);
});

test("main P0 IPC surfaces core JSON errors and exit code 2, while preserving exit code 1 JSON", async () => {
  const handlers = new Map();
  let response = {
    code: 2,
    json: { ok: false, error: "批量修复计划已过期，请重新预览" },
    stderr: "核心拒绝旧计划",
  };
  registerP0Ipc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    bridge: {
      planFixes: async () => response,
      applyFixPlan: async () => response,
      listCheckpoints: async () => response,
      restoreCheckpoint: async () => response,
    },
    pathPolicy: { looksLikeProject: () => true },
  });

  const failed = await handlers.get("core:apply-fix-plan")(null, {
    project: "C:\\projects\\oak",
    planId: "plan-0001",
  });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /批量修复计划已过期/);

  response = {
    code: 2,
    json: { ok: true, message: "不应被当作成功" },
    stderr: "核心退出码 2",
  };
  const exitTwo = await handlers.get("core:plan-fixes")(null, {
    project: "C:\\projects\\oak",
  });
  assert.equal(exitTwo.ok, false);
  assert.match(exitTwo.error, /不应被当作成功/);

  response = {
    code: 1,
    json: { ok: true, plan_id: "plan-0002", candidate_count: 0, items: [] },
    stderr: "存在未处理问题",
  };
  const exitOne = await handlers.get("core:plan-fixes")(null, {
    project: "C:\\projects\\oak",
  });
  assert.equal(exitOne.ok, true);
  assert.equal(exitOne.result.plan_id, "plan-0002");
});

test("main P0 IPC preserves structured project write-lock errors", async () => {
  const handlers = new Map();
  const locked = async () => ({
    code: 2,
    json: {
      ok: false,
      error: {
        code: "PROJECT_WRITE_LOCKED",
        message: "项目正由另一个进程写入",
        retryable: true,
        details: { owner: { command: "test-holder-check", pid: 4321 } },
      },
    },
    stderr: "",
  });
  registerP0Ipc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    bridge: {
      planFixes: locked,
      applyFixPlan: locked,
      listCheckpoints: locked,
      restoreCheckpoint: locked,
    },
    pathPolicy: { looksLikeProject: () => true },
  });

  const result = await handlers.get("core:plan-fixes")(null, {
    project: "C:\\projects\\oak",
  });
  assert.deepEqual(result, {
    ok: false,
    error: "项目正由另一个进程写入",
    code: "PROJECT_WRITE_LOCKED",
    retryable: true,
    details: { owner: { command: "test-holder-check", pid: 4321 } },
  });
});
