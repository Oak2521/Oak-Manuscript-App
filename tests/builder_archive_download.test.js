"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const {
  DEFAULT_OUTPUT_RELATIVE,
  downloadHttpsFile,
  downloadWindowsBuilderArchives,
  parseArgs,
  validateRedirectUrl,
  validateSourceUrl,
} = require("../scripts/download_windows_builder_archives");
const { SOURCE_ARCHIVES } = require("../scripts/builder_toolchain_contract");

const REPO_ROOT = path.resolve(__dirname, "..");

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function makeTestRoot(t, prefix = "builder-download-") {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function fixtureArchives() {
  return ["alpha", "bravo", "charlie"].map((content, index) => {
    const name = `fixture-${index + 1}.7z`;
    return Object.freeze({
      id: `fixture${index + 1}`,
      name,
      sha256: sha256(content),
      url: `https://github.com/electron-userland/electron-builder-binaries/releases/download/fixture-${index + 1}/${name}`,
      fixtureContent: content,
    });
  });
}

function fakeHttps(routes) {
  return (url, _options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = (error) => queueMicrotask(() => request.emit("error", error));
    queueMicrotask(() => {
      const route = routes[url];
      if (!route) {
        request.emit("error", new Error(`unexpected URL: ${url}`));
        return;
      }
      const response = Readable.from(route.body == null ? [] : [Buffer.from(route.body)]);
      response.statusCode = route.statusCode;
      response.headers = route.headers ?? {};
      callback(response);
    });
    return request;
  };
}

test("builder archive contract pins the exact official HTTPS release URLs", () => {
  assert.deepEqual(SOURCE_ARCHIVES.map(({ name, url }) => ({ name, url })), [
    {
      name: "nsis-3.0.4.1.7z",
      url: "https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z",
    },
    {
      name: "nsis-resources-3.4.1.7z",
      url: "https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z",
    },
    {
      name: "winCodeSign-2.6.0.7z",
      url: "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z",
    },
  ]);
  for (const archive of SOURCE_ARCHIVES) assert.equal(validateSourceUrl(archive), archive.url);
});

test("CLI parser requires an explicit network switch and rejects bypass arguments", () => {
  assert.deepEqual(parseArgs(["--allow-network"]), {
    allowNetwork: true,
    outputDir: null,
  });
  assert.deepEqual(
    parseArgs(["--output-dir", "out/custom-builder-archives", "--allow-network"]),
    { allowNetwork: true, outputDir: "out/custom-builder-archives" },
  );
  assert.throws(() => parseArgs([]), /--allow-network/);
  assert.throws(() => parseArgs(["--allow-network", "--allow-network"]), /重复参数/);
  assert.throws(() => parseArgs(["--allow-network", "--output-dir"]), /缺少路径/);
  assert.throws(() => parseArgs(["--allow-network", "--replace"]), /未知参数/);
});

test("network archive retrieval is explicit and never part of build or test scripts", () => {
  const packageJson = require("../package.json");
  assert.equal(
    packageJson.scripts["download:builder:win"],
    "node scripts/download_windows_builder_archives.js --allow-network",
  );
  for (const name of ["test", "test:node", "test:python", "build:win", "dist"]) {
    assert.doesNotMatch(packageJson.scripts[name], /download_windows_builder_archives/);
  }
});

test("missing network authorization performs no directory creation or download", async (t) => {
  const root = makeTestRoot(t);
  const output = path.join(root, ...DEFAULT_OUTPUT_RELATIVE.split("/"));
  let calls = 0;
  await assert.rejects(
    downloadWindowsBuilderArchives({
      root,
      allowNetwork: false,
      archives: fixtureArchives(),
      async downloadFile() { calls += 1; },
    }),
    /必须显式传入 --allow-network/,
  );
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(output), false);
});

test("download transaction verifies all hashes before atomically installing files", async (t) => {
  const root = makeTestRoot(t);
  const archives = fixtureArchives();
  const calls = [];
  const result = await downloadWindowsBuilderArchives({
    root,
    allowNetwork: true,
    archives,
    async downloadFile(archive, target) {
      calls.push(archive.name);
      fs.writeFileSync(target, archive.fixtureContent, { flag: "wx" });
    },
  });
  assert.deepEqual(calls, archives.map((item) => item.name));
  assert.deepEqual(result.downloaded, archives.map((item) => item.name));
  assert.deepEqual(result.reused, []);
  for (const archive of archives) {
    const target = path.join(result.outputDir, archive.name);
    assert.equal(fs.readFileSync(target, "utf8"), archive.fixtureContent);
    assert.equal(fs.statSync(target).nlink, 1);
  }

  const reused = await downloadWindowsBuilderArchives({
    root,
    allowNetwork: true,
    archives,
    async downloadFile() { throw new Error("matching archives must not redownload"); },
  });
  assert.deepEqual(reused.downloaded, []);
  assert.deepEqual(reused.reused, archives.map((item) => item.name));
});

test("wrong hash or partial download leaves no newly trusted archive", async (t) => {
  const root = makeTestRoot(t);
  const archives = fixtureArchives();
  await assert.rejects(
    downloadWindowsBuilderArchives({
      root,
      allowNetwork: true,
      archives,
      async downloadFile(archive, target) {
        fs.writeFileSync(
          target,
          archive.id === "fixture2" ? "tampered" : archive.fixtureContent,
          { flag: "wx" },
        );
      },
    }),
    /SHA256 不匹配/,
  );
  const output = path.join(root, ...DEFAULT_OUTPUT_RELATIVE.split("/"));
  for (const archive of archives) {
    assert.equal(fs.existsSync(path.join(output, archive.name)), false);
  }
  assert.deepEqual(
    fs.existsSync(output) ? fs.readdirSync(output) : [],
    [],
    "transaction files must be removed after verification failure",
  );
});

test("real downloader follows only approved redirects and removes rejected payloads", async (t) => {
  const root = makeTestRoot(t);
  const target = path.join(root, "downloaded.7z");
  const source = SOURCE_ARCHIVES[0];
  const redirected = "https://release-assets.githubusercontent.com/github-production-release-asset/123/asset?sig=fixture";
  await downloadHttpsFile(source, target, {
    request: fakeHttps({
      [source.url]: { statusCode: 302, headers: { location: redirected } },
      [redirected]: {
        statusCode: 200,
        headers: { "content-length": "7" },
        body: "fixture",
      },
    }),
  });
  assert.equal(fs.readFileSync(target, "utf8"), "fixture");

  const oversized = path.join(root, "oversized.7z");
  await assert.rejects(
    downloadHttpsFile(source, oversized, {
      maxBytes: 3,
      request: fakeHttps({
        [source.url]: { statusCode: 200, body: "too large" },
      }),
    }),
    /超过 3 字节限制/,
  );
  assert.equal(fs.existsSync(oversized), false);
});

test("commit race rolls back only archives installed by this transaction", async (t) => {
  const root = makeTestRoot(t);
  const archives = fixtureArchives();
  const output = path.join(root, ...DEFAULT_OUTPUT_RELATIVE.split("/"));
  await assert.rejects(
    downloadWindowsBuilderArchives({
      root,
      allowNetwork: true,
      archives,
      async downloadFile(archive, target) {
        fs.writeFileSync(target, archive.fixtureContent, { flag: "wx" });
        if (archive === archives.at(-1)) {
          fs.writeFileSync(path.join(output, archives[1].name), "concurrent file", { flag: "wx" });
        }
      },
    }),
    /EEXIST/,
  );
  assert.equal(fs.existsSync(path.join(output, archives[0].name)), false);
  assert.equal(fs.readFileSync(path.join(output, archives[1].name), "utf8"), "concurrent file");
  assert.equal(fs.existsSync(path.join(output, archives[2].name)), false);
});

test("existing invalid or unknown archives fail closed without replacement", async (t) => {
  const root = makeTestRoot(t);
  const archives = fixtureArchives();
  const output = path.join(root, ...DEFAULT_OUTPUT_RELATIVE.split("/"));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, archives[0].name), "wrong");
  await assert.rejects(
    downloadWindowsBuilderArchives({ root, allowNetwork: true, archives }),
    /已有归档 SHA256 不匹配.*拒绝覆盖/,
  );
  assert.equal(fs.readFileSync(path.join(output, archives[0].name), "utf8"), "wrong");

  fs.rmSync(path.join(output, archives[0].name));
  fs.writeFileSync(path.join(output, "unapproved.7z"), "unknown");
  await assert.rejects(
    downloadWindowsBuilderArchives({ root, allowNetwork: true, archives }),
    /未授权的 \.7z 文件/,
  );
});

test("output directory must remain inside the project and cannot traverse a link", async (t) => {
  const root = makeTestRoot(t);
  const outside = makeTestRoot(t, "builder-download-outside-");
  await assert.rejects(
    downloadWindowsBuilderArchives({
      root,
      outputDir: outside,
      allowNetwork: true,
      archives: fixtureArchives(),
    }),
    /必须位于项目目录内/,
  );

  const linked = path.join(root, "linked-output");
  try {
    fs.symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`当前主机不能创建测试目录链接：${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    downloadWindowsBuilderArchives({
      root,
      outputDir: linked,
      allowNetwork: true,
      archives: fixtureArchives(),
    }),
    /链接|重解析点/,
  );
});

test("redirect validation accepts only GitHub release asset hosts over HTTPS", () => {
  const source = SOURCE_ARCHIVES[0].url;
  assert.equal(
    validateRedirectUrl(
      source,
      "https://release-assets.githubusercontent.com/github-production-release-asset/123/asset?sp=r&sig=fixture",
    ).hostname,
    "release-assets.githubusercontent.com",
  );
  assert.equal(
    validateRedirectUrl(source, "/electron-userland/electron-builder-binaries/releases/download/fixture/file.7z").hostname,
    "github.com",
  );
  for (const unsafe of [
    "http://release-assets.githubusercontent.com/asset",
    "https://example.com/asset",
    "https://user:pass@release-assets.githubusercontent.com/asset",
    "https://release-assets.githubusercontent.com/asset#fragment",
  ]) {
    assert.throws(() => validateRedirectUrl(source, unsafe), /重定向|HTTPS|凭据|fragment/);
  }
});
