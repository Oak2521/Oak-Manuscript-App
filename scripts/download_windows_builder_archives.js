"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");

const { SOURCE_ARCHIVES } = require("./builder_toolchain_contract");
const { ensureBuildDirectory } = require("./run_electron_builder");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_RELATIVE = "out/downloads/windows-builder";
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const OFFICIAL_REPOSITORY_PATH = "/electron-userland/electron-builder-binaries/releases/download/";
const ALLOWED_REDIRECT_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);

function sha256File(target) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(target));
  return hash.digest("hex");
}

function assertInsideProject(root, target, label) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须位于项目目录内：${target}`);
  }
}

function resolveOutputDirectory(root, outputDir) {
  const projectRoot = path.resolve(root);
  const target = outputDir == null
    ? path.join(projectRoot, ...DEFAULT_OUTPUT_RELATIVE.split("/"))
    : path.resolve(projectRoot, outputDir);
  assertInsideProject(projectRoot, target, "Windows builder 归档目录");
  return target;
}

function validateSourceUrl(archive) {
  if (!archive || typeof archive !== "object" || typeof archive.url !== "string" ||
      typeof archive.name !== "string") {
    throw new Error("Windows builder 来源合同缺少固定 URL 或文件名");
  }
  let parsed;
  try {
    parsed = new URL(archive.url);
  } catch {
    throw new Error(`Windows builder 来源 URL 非法：${archive.url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Windows builder 来源必须使用 HTTPS：${archive.url}`);
  }
  if (parsed.hostname !== "github.com" || parsed.port !== "" ||
      parsed.username !== "" || parsed.password !== "" ||
      parsed.search !== "" || parsed.hash !== "") {
    throw new Error(`Windows builder 来源必须是无凭据、无参数的固定 GitHub URL：${archive.url}`);
  }
  if (!parsed.pathname.startsWith(OFFICIAL_REPOSITORY_PATH) ||
      path.posix.basename(parsed.pathname) !== archive.name) {
    throw new Error(`Windows builder 来源不属于固定官方发布路径或文件名不匹配：${archive.url}`);
  }
  return parsed.href;
}

function validateRedirectUrl(currentUrl, location) {
  let parsed;
  try {
    parsed = new URL(location, currentUrl);
  } catch {
    throw new Error(`Windows builder 下载重定向 URL 非法：${location}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Windows builder 下载重定向必须使用 HTTPS：${parsed.href}`);
  }
  if (!ALLOWED_REDIRECT_HOSTS.has(parsed.hostname) || parsed.port !== "") {
    throw new Error(`Windows builder 下载重定向到未授权主机：${parsed.host}`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`Windows builder 下载重定向不得携带凭据：${parsed.href}`);
  }
  if (parsed.hash !== "") {
    throw new Error(`Windows builder 下载重定向不得携带 fragment：${parsed.href}`);
  }
  return parsed;
}

function safeRegularFile(target, label, { maxBytes = MAX_ARCHIVE_BYTES } = {}) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      stat.size <= 0 || stat.size > maxBytes) {
    throw new Error(`${label} 必须是单链接、非空且不超过 ${maxBytes} 字节的普通文件：${target}`);
  }
  return stat;
}

function validateOutputContents(outputDir, archives) {
  const allowed = new Set(archives.map((item) => item.name));
  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (!allowed.has(entry.name)) {
      const kind = entry.name.toLowerCase().endsWith(".7z") ? "未授权的 .7z 文件" : "归档目录含未知条目";
      throw new Error(`${kind}：${entry.name}`);
    }
  }
}

async function downloadHttpsFile(archive, target, {
  request = https.get,
  maxBytes = MAX_ARCHIVE_BYTES,
  maxRedirects = MAX_REDIRECTS,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const sourceUrl = validateSourceUrl(archive);
  let createdIdentity = null;

  async function requestUrl(url, redirectCount) {
    const response = await new Promise((resolve, reject) => {
      const req = request(url, {
        headers: {
          Accept: "application/octet-stream",
          "Accept-Encoding": "identity",
          "User-Agent": "Oak-Manuscript-controlled-builder-fetch/1",
        },
      }, resolve);
      req.once("error", reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`Windows builder 下载超时：${archive.name}`)));
    });

    const status = response.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.location;
      response.resume();
      if (typeof location !== "string" || location.length === 0) {
        throw new Error(`Windows builder 下载收到无 Location 的重定向：HTTP ${status}`);
      }
      if (redirectCount >= maxRedirects) {
        throw new Error(`Windows builder 下载重定向超过 ${maxRedirects} 次：${archive.name}`);
      }
      const next = validateRedirectUrl(url, location);
      return requestUrl(next.href, redirectCount + 1);
    }
    if (status !== 200) {
      response.resume();
      throw new Error(`Windows builder 下载失败：${archive.name}，HTTP ${status}`);
    }

    const contentLength = response.headers["content-length"];
    if (contentLength != null) {
      const length = Number(contentLength);
      if (!Number.isSafeInteger(length) || length <= 0 || length > maxBytes) {
        response.resume();
        throw new Error(`Windows builder 下载 Content-Length 非法或超过限制：${archive.name}`);
      }
    }

    let received = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > maxBytes) {
          callback(new Error(`Windows builder 下载超过 ${maxBytes} 字节限制：${archive.name}`));
          return;
        }
        callback(null, chunk);
      },
    });
    const output = fs.createWriteStream(target, { flags: "wx", mode: 0o600 });
    output.once("open", (fd) => {
      const stat = fs.fstatSync(fd);
      createdIdentity = { dev: stat.dev, ino: stat.ino };
    });
    await pipeline(response, limiter, output);
    if (received <= 0) throw new Error(`Windows builder 下载得到空文件：${archive.name}`);
  }

  try {
    await requestUrl(sourceUrl, 0);
    // Windows rejects fsync on a read-only descriptor; r+ keeps the already
    // verified candidate bytes unchanged while allowing an explicit flush.
    const fd = fs.openSync(target, "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (createdIdentity && stat?.isFile() && !stat.isSymbolicLink() &&
        stat.dev === createdIdentity.dev && stat.ino === createdIdentity.ino) {
      fs.unlinkSync(target);
    }
    throw error;
  }
}

function rollbackInstalled(installed) {
  const errors = [];
  for (const item of [...installed].reverse()) {
    try {
      const stat = fs.lstatSync(item.target, { throwIfNoEntry: false });
      if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("目标不再是本事务安装的普通文件");
      }
      if (stat.dev !== item.stat.dev || stat.ino !== item.stat.ino ||
          sha256File(item.target) !== item.archive.sha256) {
        throw new Error("文件身份或哈希已变化，拒绝删除");
      }
      fs.unlinkSync(item.target);
    } catch (error) {
      errors.push(`${item.archive.name}: ${error.message}`);
    }
  }
  return errors;
}

async function downloadWindowsBuilderArchives({
  root = PROJECT_ROOT,
  outputDir = null,
  allowNetwork = false,
  archives = SOURCE_ARCHIVES,
  downloadFile = downloadHttpsFile,
} = {}) {
  if (allowNetwork !== true) {
    throw new Error("联网下载默认禁用；必须显式传入 --allow-network，且仅应在用户批准后运行");
  }
  if (!Array.isArray(archives) || archives.length === 0) {
    throw new Error("Windows builder 来源合同为空");
  }
  for (const archive of archives) {
    if (typeof archive.name !== "string" || !/^[A-Za-z0-9._-]+\.7z$/u.test(archive.name) ||
        typeof archive.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(archive.sha256)) {
      throw new Error(`Windows builder 来源合同非法：${String(archive?.name)}`);
    }
    validateSourceUrl(archive);
  }

  const projectRoot = path.resolve(root);
  const destination = resolveOutputDirectory(projectRoot, outputDir);
  ensureBuildDirectory(projectRoot, destination, "Windows builder 归档目录");
  validateOutputContents(destination, archives);

  const reused = [];
  const missing = [];
  for (const archive of archives) {
    const target = path.join(destination, archive.name);
    if (!fs.existsSync(target)) {
      missing.push(archive);
      continue;
    }
    safeRegularFile(target, `已有归档 ${archive.name}`);
    const actual = sha256File(target);
    if (actual !== archive.sha256) {
      throw new Error(`已有归档 SHA256 不匹配，拒绝覆盖：${archive.name}；实际 ${actual}`);
    }
    reused.push(archive.name);
  }
  if (missing.length === 0) {
    return { outputDir: destination, downloaded: [], reused };
  }

  const transaction = fs.mkdtempSync(path.join(path.dirname(destination), ".oak-builder-download-"));
  const installed = [];
  try {
    for (const archive of missing) {
      const staged = path.join(transaction, archive.name);
      await downloadFile(archive, staged);
      safeRegularFile(staged, `下载候选归档 ${archive.name}`);
      const actual = sha256File(staged);
      if (actual !== archive.sha256) {
        throw new Error(`下载候选归档 SHA256 不匹配：${archive.name}；实际 ${actual}`);
      }
    }

    for (const archive of missing) {
      const staged = path.join(transaction, archive.name);
      const target = path.join(destination, archive.name);
      fs.linkSync(staged, target);
      const linkedStat = fs.lstatSync(target);
      installed.push({ archive, target, stat: linkedStat });
      fs.unlinkSync(staged);
      const stat = safeRegularFile(target, `已安装归档 ${archive.name}`);
      if (sha256File(target) !== archive.sha256) {
        throw new Error(`归档原子换入后 SHA256 漂移：${archive.name}`);
      }
      installed.at(-1).stat = stat;
    }
    return {
      outputDir: destination,
      downloaded: missing.map((item) => item.name),
      reused,
    };
  } catch (error) {
    const rollbackErrors = rollbackInstalled(installed);
    if (rollbackErrors.length > 0) {
      throw new Error(`${error.message}；归档事务回滚也失败：${rollbackErrors.join("；")}`);
    }
    throw error;
  } finally {
    fs.rmSync(transaction, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  let allowNetwork = false;
  let outputDir = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-network") {
      if (allowNetwork) throw new Error("重复参数：--allow-network");
      allowNetwork = true;
    } else if (arg === "--output-dir") {
      if (outputDir != null) throw new Error("重复参数：--output-dir");
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) throw new Error("--output-dir 缺少路径");
      outputDir = value;
      index += 1;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!allowNetwork) {
    throw new Error("必须显式传入 --allow-network；仅在用户批准联网后运行");
  }
  return { allowNetwork, outputDir };
}

if (require.main === module) {
  (async () => {
    try {
      const result = await downloadWindowsBuilderArchives(parseArgs(process.argv.slice(2)));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  ALLOWED_REDIRECT_HOSTS,
  DEFAULT_OUTPUT_RELATIVE,
  MAX_ARCHIVE_BYTES,
  downloadHttpsFile,
  downloadWindowsBuilderArchives,
  parseArgs,
  resolveOutputDirectory,
  sha256File,
  validateRedirectUrl,
  validateSourceUrl,
};
