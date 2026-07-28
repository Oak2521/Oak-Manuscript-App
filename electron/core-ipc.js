// 项目创建、引用体例预检与检查 IPC。
// 本模块把渲染进程输入收窄为固定枚举和固定 CLI 参数，不能传入任意命令行参数。

"use strict";

const path = require("node:path");

const { toFailureResponse } = require("./core-result");

const MANUSCRIPT_TYPES = Object.freeze(["paper", "print_book", "ebook"]);
const LANGUAGES = Object.freeze(["auto", "zh", "en", "mixed"]);
const CITATION_STYLES = Object.freeze([
  "default",
  "gbt7714-2025",
  "apa-7",
  "chicago-18-nb",
  "chicago-18-ad",
  "none",
]);
const CHECK_KINDS = Object.freeze(["check", "recheck"]);
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function ok(data) {
  return { ok: true, ...data };
}

function fail(error) {
  return toFailureResponse(error);
}

function assertString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`参数非法：${name}`);
  return value;
}

function assertProjectDir(project, pathPolicy) {
  assertString(project, "project");
  if (!path.isAbsolute(project)) throw new Error("项目路径必须是绝对路径");
  if (!pathPolicy || typeof pathPolicy.looksLikeProject !== "function" ||
      !pathPolicy.looksLikeProject(project)) {
    throw new Error("该目录不是湖岸稿件项目");
  }
  return project;
}

function optionalEnum(value, allowed, fallback, name) {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) throw new Error(`参数非法：${name}`);
  return value;
}

function requiredEnum(value, allowed, name) {
  if (!allowed.includes(value)) throw new Error(`参数非法：${name}`);
  return value;
}

function assertOptionalOpaqueId(value, name) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !OPAQUE_ID_RE.test(value)) {
    throw new Error(`参数非法：${name}`);
  }
  return value;
}

function buildCreateArgs(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("参数非法：create");
  }
  const input = assertString(payload.input, "input");
  const projectDir = assertString(payload.projectDir, "projectDir");
  const type = optionalEnum(payload.type, MANUSCRIPT_TYPES, "paper", "type");
  const language = optionalEnum(payload.language, LANGUAGES, "auto", "language");
  const citation = optionalEnum(payload.citation, CITATION_STYLES, "default", "citation");
  if (payload.epubPreview !== undefined && typeof payload.epubPreview !== "boolean") {
    throw new Error("参数非法：epubPreview");
  }

  const args = [
    "create", "--input", input, "--project", projectDir,
    "--type", type, "--language", language, "--citation", citation,
  ];
  if (payload.epubPreview === true) args.push("--epub-preview");
  return args;
}

function buildCitationPlanArgs(project, citation, pathPolicy) {
  const safeProject = assertProjectDir(project, pathPolicy);
  const safeCitation = requiredEnum(citation, CITATION_STYLES, "citation");
  return ["plan-citation", "--project", safeProject, "--citation", safeCitation];
}

function buildCheckArgs(payload = {}, pathPolicy) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("参数非法：check");
  }
  const project = assertProjectDir(payload.project, pathPolicy);
  // 旧版 preload 可不传 kind；该调用仍等价于 check。显式非法值不再静默回退。
  const kind = optionalEnum(payload.kind, CHECK_KINDS, "check", "kind");
  const args = [kind, "--project", project];

  if (payload.citation !== undefined) {
    args.push("--citation", requiredEnum(payload.citation, CITATION_STYLES, "citation"));
  }
  const citationPlanId = assertOptionalOpaqueId(payload.citationPlanId, "citationPlanId");
  if (citationPlanId !== null) args.push("--citation-plan-id", citationPlanId);
  return args;
}

function registerCoreIpc({ ipcMain, runCore, pathPolicy }) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("ipcMain 非法");
  if (typeof runCore !== "function") throw new TypeError("runCore 非法");

  ipcMain.handle("core:create", async (_event, payload = {}) => {
    try {
      const { data } = await runCore(buildCreateArgs(payload));
      return ok({ result: data });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("core:plan-citation", async (_event, payload = {}) => {
    try {
      const args = buildCitationPlanArgs(payload.project, payload.citation, pathPolicy);
      const { data } = await runCore(args);
      return ok({ result: data });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("core:check", async (_event, payload = {}) => {
    try {
      const { data } = await runCore(buildCheckArgs(payload, pathPolicy));
      return ok({ result: data });
    } catch (error) {
      return fail(error);
    }
  });
}

module.exports = {
  CHECK_KINDS,
  CITATION_STYLES,
  LANGUAGES,
  MANUSCRIPT_TYPES,
  assertOptionalOpaqueId,
  buildCheckArgs,
  buildCitationPlanArgs,
  buildCreateArgs,
  registerCoreIpc,
};
