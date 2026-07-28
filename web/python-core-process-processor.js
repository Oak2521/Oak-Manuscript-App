"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");

const CORE_BOOTSTRAP = [
  "import runpy,sys",
  "sys.path.insert(0,sys.argv.pop(1))",
  "runpy.run_module('oak_manuscript_core',run_name='__main__')",
].join(";");
const REQUEST_KEYS = Object.freeze(["schema_version", "request_type", "document", "bytes"]);
const DOCUMENT_KEYS = Object.freeze([
  "format", "manuscript_type", "check_config", "citation_style", "size_bytes",
]);
const FORMATS = new Set(["docx", "md", "txt", "epub"]);
const MANUSCRIPT_TYPES = new Set(["paper", "print_book", "ebook"]);
const CHECK_CONFIGS = new Set(["quick", "full"]);
const CITATION_STYLES = new Set([
  "default", "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none",
]);
const STRIPPED_ENV_PREFIXES = Object.freeze([
  "PYTHON", "OAK_", "NODE_OPTIONS", "ELECTRON_", "SUPABASE_", "NETLIFY_", "OPENAI_",
  "ANTHROPIC_", "AWS_", "AZURE_", "GOOGLE_", "GCP_",
]);
const STRIPPED_ENV_NAMES = new Set([
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "PATH",
  "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TMPDIR", "TMP", "TEMP",
  "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH", "VIRTUAL_ENV", "CONDA_PREFIX", "SSLKEYLOGFILE", "BASH_ENV",
]);

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}必须是对象`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label}字段集合非法`);
  }
  return value;
}

function absolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    throw new TypeError(`${label}必须是无 NUL 的绝对路径`);
  }
  return path.resolve(value);
}

function samePath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function requireUnlinkedPath(target, kind, label) {
  const info = await fs.promises.lstat(target);
  if (info.isSymbolicLink() || (kind === "file" ? !info.isFile() : !info.isDirectory())) {
    throw new Error(`${label}不是安全${kind === "file" ? "文件" : "目录"}`);
  }
  const real = await fs.promises.realpath(target);
  if (!samePath(path.resolve(target), path.resolve(real))) throw new Error(`${label}包含链接或重解析跳转`);
  return real;
}

function isolatedEnvironment(source, scratch, pythonExecutable) {
  const env = {};
  for (const [key, value] of Object.entries(source || {})) {
    const upper = key.toUpperCase();
    if (STRIPPED_ENV_NAMES.has(upper) ||
        STRIPPED_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))) continue;
    env[key] = value;
  }
  return {
    ...env,
    PATH: path.dirname(pythonExecutable),
    HOME: scratch,
    USERPROFILE: scratch,
    APPDATA: scratch,
    LOCALAPPDATA: scratch,
    TMPDIR: scratch,
    TMP: scratch,
    TEMP: scratch,
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
    OAK_APP_PACKAGED: "0",
  };
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

class PythonCoreProcessProcessor {
  constructor({
    pythonExecutable,
    coreDir,
    scratchRoot,
    spawnImpl = spawn,
    sourceEnvironment = process.env,
    timeoutMs = 4 * 60 * 1000,
    maxOutputBytes = 16 * 1024 * 1024,
  } = {}) {
    this.pythonExecutable = absolutePath(pythonExecutable, "pythonExecutable");
    this.coreDir = absolutePath(coreDir, "coreDir");
    this.scratchRoot = absolutePath(scratchRoot, "scratchRoot");
    if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl 必须是函数");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10 * 60 * 1000) {
      throw new TypeError("timeoutMs 必须在 100 毫秒到 10 分钟之间");
    }
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1024 ||
        maxOutputBytes > 100 * 1024 * 1024) {
      throw new TypeError("maxOutputBytes 必须在 1 KiB 到 100 MiB 之间");
    }
    this.spawnImpl = spawnImpl;
    this.sourceEnvironment = { ...(sourceEnvironment || {}) };
    this.timeoutMs = timeoutMs;
    this.maxOutputBytes = maxOutputBytes;
    this.execution_boundary = "isolated_process";
    this.max_execution_ms = timeoutMs;
  }

  _invocation(args, scratch) {
    return {
      command: this.pythonExecutable,
      args: ["-I", "-B", "-S", "-X", "utf8", "-c", CORE_BOOTSTRAP, this.coreDir, ...args],
      options: {
        cwd: scratch,
        shell: false,
        windowsHide: true,
        env: isolatedEnvironment(this.sourceEnvironment, scratch, this.pythonExecutable),
        stdio: ["ignore", "pipe", "pipe"],
      },
    };
  }

  _run(args, acceptedCodes, scratch) {
    const invocation = this._invocation(args, scratch);
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawnImpl(invocation.command, invocation.args, invocation.options);
      } catch {
        reject(new Error("隔离检查核心无法启动"));
        return;
      }
      if (!child || !child.stdout || !child.stderr || typeof child.kill !== "function" ||
          typeof child.once !== "function") {
        reject(new Error("隔离检查核心子进程接口非法"));
        return;
      }
      let settled = false;
      let total = 0;
      const stdout = [];
      let timer = null;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      const add = (chunk, keep) => {
        const bytes = Buffer.from(chunk);
        total += bytes.length;
        if (total > this.maxOutputBytes) {
          try { child.kill(); } catch {}
          finish(new Error("隔离检查核心输出超限"));
          return;
        }
        if (keep) stdout.push(bytes);
      };
      child.stdout.on("data", (chunk) => add(chunk, true));
      child.stderr.on("data", (chunk) => add(chunk, false));
      child.once("error", () => finish(new Error("隔离检查核心启动失败")));
      child.once("close", (code, signal) => {
        if (!acceptedCodes.has(code) || signal) {
          finish(new Error("隔离检查核心执行失败"));
          return;
        }
        let value;
        try {
          value = JSON.parse(Buffer.concat(stdout).toString("utf8"));
        } catch {
          finish(new Error("隔离检查核心输出不是 JSON"));
          return;
        }
        if (!value || typeof value !== "object" || Array.isArray(value) || value.ok !== true) {
          finish(new Error("隔离检查核心未返回成功结果"));
          return;
        }
        finish(null, value);
      });
      timer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish(new Error("隔离检查核心执行超时"));
      }, this.timeoutMs);
    });
  }

  _validateRequest(request) {
    exactObject(request, REQUEST_KEYS, "processor 请求");
    exactObject(request.document, DOCUMENT_KEYS, "processor document");
    if (request.schema_version !== "1.0" ||
        request.request_type !== "oak_manuscript_isolated_processing_request" ||
        !FORMATS.has(request.document.format) ||
        !MANUSCRIPT_TYPES.has(request.document.manuscript_type) ||
        !CHECK_CONFIGS.has(request.document.check_config) ||
        !CITATION_STYLES.has(request.document.citation_style) ||
        !Number.isSafeInteger(request.document.size_bytes) ||
        !Buffer.isBuffer(request.bytes) || request.bytes.length !== request.document.size_bytes ||
        request.bytes.length < 1 || request.bytes.length > 50 * 1024 * 1024) {
      throw new TypeError("processor 请求值非法");
    }
  }

  async execute(request) {
    this._validateRequest(request);
    await requireUnlinkedPath(this.pythonExecutable, "file", "Python 可执行文件");
    await requireUnlinkedPath(this.coreDir, "directory", "Python 核心目录");
    const scratchRoot = await requireUnlinkedPath(this.scratchRoot, "directory", "worker scratch 根目录");
    const scratch = await fs.promises.mkdtemp(path.join(scratchRoot, "oak-web-worker-"));
    let scratchReal = null;
    try {
      scratchReal = await fs.promises.realpath(scratch);
      if (!samePath(path.dirname(scratchReal), scratchRoot)) throw new Error("worker scratch 越界");
      const inputPath = path.join(scratchReal, `input.${request.document.format}`);
      const projectPath = path.join(scratchReal, "project");
      const sourceBytes = request.bytes;
      const sourceDigest = digest(sourceBytes);
      await fs.promises.writeFile(inputPath, sourceBytes, { flag: "wx", mode: 0o600 });

      const checked = await this._run([
        "web-check", "--input", inputPath, "--project", projectPath,
        "--type", request.document.manuscript_type,
        "--citation", request.document.citation_style,
        "--depth", request.document.check_config,
      ], new Set([0, 1]), scratchReal);
      const after = await fs.promises.readFile(inputPath);
      if (after.length !== sourceBytes.length || digest(after) !== sourceDigest) {
        throw new Error("隔离检查核心改变了输入文件");
      }
      const output = Buffer.from(JSON.stringify(checked), "utf8");
      if (output.length < 1 || output.length > this.maxOutputBytes) {
        throw new Error("隔离检查结果超限");
      }
      return Object.freeze({ bytes: output, media_type: "application/json" });
    } finally {
      let info = null;
      try { info = await fs.promises.lstat(scratch); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (info !== null) {
        if (info.isSymbolicLink() || !info.isDirectory()) {
          await fs.promises.unlink(scratch);
          throw new Error("worker scratch 身份在处理期间改变");
        }
        const cleanupReal = await fs.promises.realpath(scratch);
        if (scratchReal === null || !samePath(cleanupReal, scratchReal) ||
            !samePath(path.dirname(cleanupReal), scratchRoot)) {
          throw new Error("worker scratch 清理边界失效");
        }
        await fs.promises.rm(scratch, { recursive: true, force: true, maxRetries: 2 });
      }
    }
  }
}

module.exports = {
  CORE_BOOTSTRAP,
  PythonCoreProcessProcessor,
  isolatedEnvironment,
};
