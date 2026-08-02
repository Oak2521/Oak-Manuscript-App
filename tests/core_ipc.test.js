"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  CITATION_STYLES,
  buildCheckArgs,
  buildCitationPlanArgs,
  buildCreateArgs,
  registerCoreIpc,
} = require("../electron/core-ipc");

const PROJECT = path.resolve("out", "test-tmp", "citation-ipc-project");
const pathPolicy = { looksLikeProject: (value) => value === PROJECT };

function fixture() {
  const handlers = new Map();
  const calls = [];
  registerCoreIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    pathPolicy,
    async runCore(args) {
      calls.push(args);
      return { data: { ok: true, command: args[0] } };
    },
  });
  return { handlers, calls };
}

test("project creation preserves omitted-field defaults but rejects supplied invalid settings", () => {
  assert.deepEqual(buildCreateArgs({ input: "input.docx", projectDir: PROJECT }), [
    "create", "--input", "input.docx", "--project", PROJECT,
    "--type", "paper", "--language", "auto", "--citation", "default",
  ]);
  assert.deepEqual(buildCreateArgs({
    input: "input.epub",
    projectDir: PROJECT,
    type: "ebook",
    language: "mixed",
    citation: "chicago-18-ad",
    epubPreview: true,
  }), [
    "create", "--input", "input.epub", "--project", PROJECT,
    "--type", "ebook", "--language", "mixed", "--citation", "chicago-18-ad",
    "--epub-preview",
  ]);

  for (const [field, value] of [
    ["type", "memoir"],
    ["language", "fr"],
    ["citation", "mla-9"],
    ["citation", null],
    ["epubPreview", "false"],
  ]) {
    assert.throws(
      () => buildCreateArgs({ input: "input.docx", projectDir: PROJECT, [field]: value }),
      new RegExp(field),
    );
  }
});

test("citation plan and check builders expose only the six citation choices and fixed CLI flags", () => {
  for (const citation of CITATION_STYLES) {
    assert.deepEqual(buildCitationPlanArgs(PROJECT, citation, pathPolicy), [
      "plan-citation", "--project", PROJECT, "--citation", citation,
    ]);
  }
  assert.deepEqual(buildCheckArgs({ project: PROJECT }, pathPolicy), [
    "check", "--project", PROJECT,
  ]);
  assert.deepEqual(buildCheckArgs({
    project: PROJECT,
    kind: "recheck",
    citation: "apa-7",
    citationPlanId: "citation-plan-0123456789abcdef",
  }, pathPolicy), [
    "recheck", "--project", PROJECT,
    "--citation", "apa-7",
    "--citation-plan-id", "citation-plan-0123456789abcdef",
  ]);

  assert.throws(
    () => buildCitationPlanArgs(PROJECT, "mla-9", pathPolicy),
    /citation/,
  );
  assert.throws(
    () => buildCheckArgs({ project: PROJECT, kind: "repair" }, pathPolicy),
    /kind/,
  );
  assert.throws(
    () => buildCheckArgs({ project: PROJECT, citation: "mla-9" }, pathPolicy),
    /citation/,
  );
  for (const citationPlanId of ["", "../plan", `x${"a".repeat(128)}`]) {
    assert.throws(
      () => buildCheckArgs({ project: PROJECT, citationPlanId }, pathPolicy),
      /citationPlanId/,
    );
  }
});

test("core IPC routes citation planning and confirmed checks through the injected bound runner", async () => {
  const { handlers, calls } = fixture();
  assert.deepEqual(Array.from(handlers.keys()).sort(), [
    "core:check",
    "core:create",
    "core:plan-citation",
  ]);

  const planned = await handlers.get("core:plan-citation")(null, {
    project: PROJECT,
    citation: "default",
  });
  assert.equal(planned.ok, true);

  const checked = await handlers.get("core:check")(null, {
    project: PROJECT,
    kind: "check",
    citation: "default",
    citationPlanId: "citation-plan-abcdef",
  });
  assert.equal(checked.ok, true);
  assert.deepEqual(calls, [
    ["plan-citation", "--project", PROJECT, "--citation", "default"],
    [
      "check", "--project", PROJECT,
      "--citation", "default",
      "--citation-plan-id", "citation-plan-abcdef",
    ],
  ]);
});

test("invalid renderer payloads fail before the bound core runner", async () => {
  const { handlers, calls } = fixture();
  const failures = [
    await handlers.get("core:create")(null, {
      input: "input.docx", projectDir: PROJECT, type: "memoir",
    }),
    await handlers.get("core:plan-citation")(null, {
      project: PROJECT, citation: "mla-9",
    }),
    await handlers.get("core:check")(null, {
      project: PROJECT, kind: "repair",
    }),
    await handlers.get("core:check")(null, {
      project: PROJECT, kind: "check", citationPlanId: "plan/escape",
    }),
  ];
  assert.ok(failures.every((result) => result.ok === false));
  assert.equal(calls.length, 0);
});
