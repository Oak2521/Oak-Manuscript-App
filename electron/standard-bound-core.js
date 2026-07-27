// Existing projects need one unbound, read-only project-standard-status
// preflight to discover their pin. The active store is verified before that
// preflight, the returned pin is matched to an exact CAS release, and every
// subsequent business or mutating invocation is bound to that verified release.
// Python re-hashes the same payload and rejects identity drift.

"use strict";

const path = require("node:path");

const { readCoreResult } = require("./core-result");
const { serializeStandardIdentity } = require("./python-invocation");

function samePath(left, right) {
  if (typeof left !== "string" || typeof right !== "string" ||
      !path.isAbsolute(left) || !path.isAbsolute(right)) return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function assertCommandProject(args, project) {
  if (!Array.isArray(args) || args.length === 0 || args.some((item) => typeof item !== "string")) {
    throw new TypeError("核心命令参数非法");
  }
  if (typeof project !== "string" || !path.isAbsolute(project)) {
    throw new TypeError("项目路径必须是绝对路径");
  }
  const indexes = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--project") indexes.push(index);
  }
  if (indexes.length !== 1 || indexes[0] + 1 >= args.length ||
      !samePath(args[indexes[0] + 1], project)) {
    throw new Error("核心命令的项目参数不一致");
  }
}

function assertIdentity(value, label) {
  try {
    serializeStandardIdentity(value);
  } catch (error) {
    throw new Error(`${label}没有返回完整标准身份`, { cause: error });
  }
  return value;
}

function sameIdentity(left, right) {
  try {
    return serializeStandardIdentity(left) === serializeStandardIdentity(right);
  } catch {
    return false;
  }
}

function createStandardBoundCore({ bridge, provider }) {
  if (!bridge || typeof bridge.runCore !== "function") throw new TypeError("Python bridge 非法");
  if (!provider || typeof provider.verifiedActiveIdentity !== "function" ||
      typeof provider.verifyReleaseIdentity !== "function") {
    throw new TypeError("StandardsProvider 验签接口非法");
  }

  async function verifiedActive() {
    return assertIdentity(await provider.verifiedActiveIdentity(), "active 标准库");
  }

  async function verifiedProjectStatus(project, { allowMigrationSource = false } = {}) {
    // Verify global state before even starting the unbound, read-only preflight.
    // If the JS store is inconsistent, no Python process is allowed to run.
    await verifiedActive();
    const raw = await bridge.runCore(["project-standard-status", "--project", project]);
    const status = await readCoreResult(Promise.resolve(raw));
    if (!status || status.ok === false || !samePath(status.project, project)) {
      throw new Error("项目标准状态返回了不一致的项目路径");
    }
    const requested = assertIdentity(status.standard_identity, "项目标准状态");
    const verified = assertIdentity(
      await provider.verifyReleaseIdentity(requested, { allowMigrationSource }),
      "验签标准包",
    );
    if (!sameIdentity(requested, verified)) {
      throw new Error("验签身份与项目身份不一致");
    }
    return { status, identity: verified };
  }

  return Object.freeze({
    async runNewProject(args) {
      if (!Array.isArray(args) || args[0] !== "create") {
        throw new Error("新项目绑定只允许 create 命令");
      }
      const identity = await verifiedActive();
      return bridge.runCore(args, undefined, { expectedStandardIdentity: identity });
    },

    async runProject(project, args, { allowMigrationSource = false } = {}) {
      assertCommandProject(args, project);
      const { identity } = await verifiedProjectStatus(project, { allowMigrationSource });
      return bridge.runCore(args, undefined, { expectedStandardIdentity: identity });
    },

    verifiedActive,
    verifiedProjectStatus,
  });
}

module.exports = {
  assertCommandProject,
  createStandardBoundCore,
  sameIdentity,
  samePath,
};
