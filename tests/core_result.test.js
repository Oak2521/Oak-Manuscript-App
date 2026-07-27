"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  readCoreResult,
  readCoreCommandResult,
  toFailureResponse,
} = require("../electron/core-result");

test("ordinary core keeps check exit 1 as a valid business result", async () => {
  const json = { ok: true, issue_counts: { error: 1 } };
  assert.equal(
    await readCoreCommandResult("check", Promise.resolve({ code: 1, json, stderr: "发现问题" })),
    json,
  );
});

test("ordinary core keeps verify exit 1 plus ok:false as a valid integrity result", async () => {
  const json = { ok: false, problems: ["缺少一份非关键报告"] };
  assert.equal(
    await readCoreCommandResult("verify", Promise.resolve({ code: 1, json, stderr: "" })),
    json,
  );
});

test("core exit 2 remains a transport failure even when JSON says ok", async () => {
  await assert.rejects(
    readCoreCommandResult("check", Promise.resolve({
      code: 2,
      json: { ok: true, message: "不应当作成功" },
      stderr: "核心退出码 2",
    })),
    /不应当作成功/,
  );
});

test("structured core errors preserve code, message, retryable and details through IPC failure", async () => {
  let error;
  try {
    await readCoreResult(Promise.resolve({
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
    }));
  } catch (caught) {
    error = caught;
  }

  assert.ok(error);
  assert.equal(error.message, "项目正由另一个进程写入");
  assert.equal(error.code, "PROJECT_WRITE_LOCKED");
  assert.equal(error.retryable, true);
  assert.deepEqual(error.details, { owner: { command: "test-holder-check", pid: 4321 } });
  assert.deepEqual(toFailureResponse(error), {
    ok: false,
    error: "项目正由另一个进程写入",
    code: "PROJECT_WRITE_LOCKED",
    retryable: true,
    details: { owner: { command: "test-holder-check", pid: 4321 } },
  });
});
