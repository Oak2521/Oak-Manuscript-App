// Ace 在 Electron utilityProcess 中运行；不依赖 ELECTRON_RUN_AS_NODE，
// 不接受 Renderer 提供的模块、参数、环境或输出路径。

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createChromeController } = require("./chrome-controller");

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CAPTURED_BYTES = 64 * 1024;
const REQUEST_KEYS = Object.freeze(["chrome", "entry", "epub", "out_dir"]);
const BROWSER_PROFILE_PREFIX = "oak-ace-chrome-";

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function nonEmptyAbsolute(value, label) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0") ||
      !path.isAbsolute(value)) {
    throw new Error(`${label} 必须是无 NUL 的绝对路径`);
  }
  return path.resolve(value);
}

function exactRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ace utility request 必须是对象");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== REQUEST_KEYS.length ||
      keys.some((key, index) => key !== REQUEST_KEYS[index])) {
    throw new Error("Ace utility request 字段集合不严格匹配");
  }
  return {
    chrome: nonEmptyAbsolute(value.chrome, "Chrome"),
    entry: nonEmptyAbsolute(value.entry, "Ace 入口"),
    epub: nonEmptyAbsolute(value.epub, "EPUB"),
    out_dir: nonEmptyAbsolute(value.out_dir, "Ace 输出目录"),
  };
}

function fileIdentity(stat, realPath) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: String(stat.size),
    mtime: String(stat.mtimeNs ?? stat.mtimeMs),
    ctime: String(stat.ctimeNs ?? stat.ctimeMs),
    realPath: path.resolve(realPath),
  };
}

function sameFileIdentity(left, right) {
  return left && right && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtime === right.mtime && left.ctime === right.ctime &&
    samePath(left.realPath, right.realPath);
}

function inspectExternalFileDefault(target) {
  const resolved = nonEmptyAbsolute(target, "外部工具文件");
  const stat = fs.lstatSync(resolved, { bigint: true, throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0n || stat.nlink !== 1n) {
    throw new Error(`外部工具文件必须是非空、单链接常规文件：${resolved}`);
  }
  const realPath = fs.realpathSync.native(resolved);
  if (!samePath(realPath, resolved)) throw new Error(`外部工具文件经过链接或重解析：${resolved}`);
  return { target: resolved, identity: fileIdentity(stat, realPath) };
}

function assertExternalFileUnchangedDefault(snapshot) {
  const current = inspectExternalFileDefault(snapshot.target);
  if (!sameFileIdentity(snapshot.identity, current.identity)) {
    throw new Error(`外部工具文件在 Ace 运行期间发生变化：${snapshot.target}`);
  }
}

function inspectBrowserProfileDefault(target) {
  const temporaryRoot = fs.realpathSync.native(os.tmpdir());
  const resolved = nonEmptyAbsolute(target, "Ace browser profile");
  const stat = fs.lstatSync(resolved, { bigint: true, throwIfNoEntry: false });
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink() ||
      path.dirname(resolved) !== temporaryRoot ||
      !path.basename(resolved).startsWith(BROWSER_PROFILE_PREFIX) ||
      !samePath(fs.realpathSync.native(resolved), resolved)) {
    throw new Error("Ace browser profile 目录不安全");
  }
  return {
    target: resolved,
    identity: { dev: String(stat.dev), ino: String(stat.ino), realPath: resolved },
  };
}

function prepareBrowserProfileDefault() {
  const temporaryRoot = fs.realpathSync.native(os.tmpdir());
  const rootStat = fs.lstatSync(temporaryRoot, { bigint: true, throwIfNoEntry: false });
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Ace browser 临时根目录不安全");
  }
  const created = fs.mkdtempSync(path.join(temporaryRoot, BROWSER_PROFILE_PREFIX));
  return inspectBrowserProfileDefault(created);
}

async function removeBrowserProfileDefault(snapshot) {
  if (!snapshot || !snapshot.target || !snapshot.identity) {
    throw new TypeError("Ace browser profile 快照非法");
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!fs.existsSync(snapshot.target)) return;
    const current = inspectBrowserProfileDefault(snapshot.target);
    if (current.identity.dev !== snapshot.identity.dev ||
        current.identity.ino !== snapshot.identity.ino ||
        !samePath(current.identity.realPath, snapshot.identity.realPath)) {
      throw new Error("Ace browser profile 在清理前发生身份变化");
    }
    try {
      fs.rmSync(snapshot.target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!error || !new Set(["EBUSY", "ENOTEMPTY", "EPERM"]).has(error.code) ||
          attempt === 39) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

function sanitizedEnvironment(source, chrome) {
  const env = {};
  for (const [key, value] of Object.entries(source || {})) {
    const upper = key.toUpperCase();
    if (upper.startsWith("NODE_") || upper.startsWith("ELECTRON_") ||
        upper.startsWith("PUPPETEER_") || upper.startsWith("OAK_") ||
        upper.startsWith("ACE_") ||
        new Set(["NPM_CONFIG_NODE_OPTIONS", "CHROME_PATH", "GOOGLE_CHROME_SHIM",
          "LD_PRELOAD", "DYLD_INSERT_LIBRARIES"]).has(upper)) continue;
    env[key] = value;
  }
  env.PUPPETEER_EXECUTABLE_PATH = chrome;
  env.ACE_TIMEOUT_INITIAL = "30000";
  return env;
}

function createAceUtilityRunner({
  utilityProcess,
  pathPolicy,
  inspectExternalFile = inspectExternalFileDefault,
  assertExternalFileUnchanged = assertExternalFileUnchangedDefault,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onOutput = null,
  prepareBrowserProfile = prepareBrowserProfileDefault,
  removeBrowserProfile = removeBrowserProfileDefault,
  chromeController = createChromeController(),
} = {}) {
  if (!utilityProcess || typeof utilityProcess.fork !== "function") {
    throw new TypeError("Electron utilityProcess 不可用");
  }
  if (!pathPolicy || typeof pathPolicy.toolsDir !== "function" ||
      typeof pathPolicy.assertSafeExistingProjectFile !== "function" ||
      typeof pathPolicy.assertSafeExistingProjectFileUnchanged !== "function" ||
      typeof pathPolicy.assertSafeProjectDirectory !== "function" ||
      typeof pathPolicy.assertSafeProjectDirectoryUnchanged !== "function") {
    throw new TypeError("Ace utility pathPolicy 不完整");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS) {
    throw new TypeError("Ace utility timeout 非法");
  }
  if (onOutput !== null && typeof onOutput !== "function") {
    throw new TypeError("Ace utility output observer 非法");
  }
  if (typeof prepareBrowserProfile !== "function" || typeof removeBrowserProfile !== "function") {
    throw new TypeError("Ace browser profile 控制器非法");
  }
  if (!chromeController || typeof chromeController.launch !== "function") {
    throw new TypeError("Chrome controller 非法");
  }

  return Object.freeze({
    async run({ project, request, environment = process.env } = {}) {
      const safeProject = nonEmptyAbsolute(project, "项目路径");
      const safe = exactRequest(request);
      const fixedEntry = path.join(pathPolicy.toolsDir(), "ace", "ace.js");
      if (!samePath(safe.entry, fixedEntry)) throw new Error("Ace utility 只允许固定入口");

      const epubSnapshot = pathPolicy.assertSafeExistingProjectFile(
        safeProject,
        safe.epub,
        { expectedParentRelative: "working" },
      );
      const outputSnapshot = pathPolicy.assertSafeProjectDirectory(
        safeProject,
        safe.out_dir,
        { expectedParentRelative: "reports" },
      );
      const entrySnapshot = inspectExternalFile(safe.entry);
      const chromeSnapshot = inspectExternalFile(safe.chrome);
      const browserProfile = prepareBrowserProfile();
      let browserSession;
      try {
        browserSession = await chromeController.launch({
          chrome: safe.chrome,
          profile: browserProfile.target,
          environment,
        });
      } catch (error) {
        await removeBrowserProfile(browserProfile);
        throw error;
      }
      if (!browserSession || typeof browserSession.endpoint !== "string" ||
          typeof browserSession.stop !== "function") {
        await removeBrowserProfile(browserProfile);
        throw new Error("Chrome controller 未返回有效会话");
      }

      const childEnvironment = sanitizedEnvironment(environment, safe.chrome);
      childEnvironment.OAK_ACE_BROWSER_PROFILE_ROOT = browserProfile.target;
      childEnvironment.OAK_ACE_BROWSER_WS_ENDPOINT = browserSession.endpoint;
      let child;
      try {
        child = utilityProcess.fork(
          safe.entry,
          ["-f", "-o", safe.out_dir, safe.epub],
          {
            allowLoadingUnsignedLibraries: false,
            env: childEnvironment,
            execArgv: [],
            serviceName: "Oak Manuscript Ace validation",
            stdio: "pipe",
          },
        );
      } catch (error) {
        await browserSession.stop();
        await removeBrowserProfile(browserProfile);
        throw error;
      }
      if (!child || typeof child.on !== "function" || typeof child.kill !== "function") {
        await browserSession.stop();
        await removeBrowserProfile(browserProfile);
        throw new Error("Ace utilityProcess 未返回有效子进程");
      }

      let exitCode;
      try {
        exitCode = await new Promise((resolve, reject) => {
          let settled = false;
          let outputBytes = 0;
          let timer = null;
          const stdoutChunks = [];
          const stderrChunks = [];
          const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            callback(value);
          };
          const rejectAndKill = (error) => {
            try { child.kill(); } catch { /* best effort */ }
            finish(reject, error);
          };
          const count = (chunks, chunk) => {
            outputBytes += Buffer.byteLength(chunk);
            if (outputBytes > MAX_CAPTURED_BYTES) {
              rejectAndKill(new Error("Ace utility 输出超过安全上限"));
              return;
            }
            chunks.push(Buffer.from(chunk));
          };
          if (!child.stdout || !child.stderr || typeof child.stdout.on !== "function" ||
              typeof child.stderr.on !== "function") {
            rejectAndKill(new Error("Ace utility 必须使用受控 pipe 输出"));
            return;
          }
          child.stdout.on("data", (chunk) => count(stdoutChunks, chunk));
          child.stderr.on("data", (chunk) => count(stderrChunks, chunk));
          child.once("exit", (code) => {
            if (onOutput !== null) {
              try {
                onOutput({
                  stdout: Buffer.concat(stdoutChunks).toString("utf8"),
                  stderr: Buffer.concat(stderrChunks).toString("utf8"),
                });
              } catch { /* 诊断观察者不得改变工具状态 */ }
            }
            if (!Number.isInteger(code) || code < 0 || code > 255) {
              finish(reject, new Error("Ace utility 返回非法退出码"));
            } else {
              finish(resolve, code);
            }
          });
          timer = setTimeout(
            () => rejectAndKill(new Error(`Ace utility 运行超时（${timeoutMs} 毫秒）`)),
            timeoutMs,
          );
        });
      } finally {
        await browserSession.stop();
        await removeBrowserProfile(browserProfile);
      }

      pathPolicy.assertSafeExistingProjectFileUnchanged(epubSnapshot);
      pathPolicy.assertSafeProjectDirectoryUnchanged(outputSnapshot);
      assertExternalFileUnchanged(entrySnapshot);
      assertExternalFileUnchanged(chromeSnapshot);
      return { exitCode, runtime: "electron_utility_process" };
    },
  });
}

module.exports = {
  MAX_CAPTURED_BYTES,
  createAceUtilityRunner,
  inspectExternalFileDefault,
  prepareBrowserProfileDefault,
  removeBrowserProfileDefault,
  sanitizedEnvironment,
};
