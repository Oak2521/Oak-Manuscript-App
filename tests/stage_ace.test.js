"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("node:url");

const {
  SANDBOX_PATCH,
  aceLockRelative,
  buildAceLock,
  collectProductionClosure,
  replaceDirectoryAtomically,
  stageAce,
  verifyAceStageLock,
} = require("../scripts/stage_ace");
const controlledRunner = require(
  "../scripts/patches/ace-axe-runner-puppeteer-1.4.6",
);

const REPO_ROOT = path.resolve(__dirname, "..");

function writePackage(project, relative, manifest, files = {}) {
  const directory = path.join(project, "node_modules", ...relative.split("/"));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(directory, ...name.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return directory;
}

function snapshotTree(root) {
  const snapshot = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) snapshot[relative] = fs.readFileSync(full).toString("base64");
      else snapshot[relative] = `<${entry.isSymbolicLink() ? "symlink" : "other"}>`;
    }
  }
  visit(root);
  return snapshot;
}

function auditedRunnerSource() {
  const installedSource = path.join(
    __dirname,
    "..",
    "node_modules",
    "@daisy",
    "ace-axe-runner-puppeteer",
    "lib",
    "index.js",
  );
  return fs.readFileSync(installedSource, "utf8");
}

function fixture() {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const project = fs.mkdtempSync(path.join(parent, "oak-stage-ace-"));
  writePackage(project, "@daisy/ace-cli", {
    name: "@daisy/ace-cli",
    version: "1.2.3",
    license: "MIT",
    bin: "bin/ace.js",
    dependencies: {
      "@daisy/ace-axe-runner-puppeteer": "1.4.6",
      "dep-a": "1.0.0",
    },
    optionalDependencies: { "optional-missing": "1.0.0" },
    devDependencies: { electron: "99.0.0", "dev-only": "1.0.0" },
  }, {
    "bin/ace.js": "require('../lib');\n",
    "lib/index.js": "module.exports = {};\n",
    "LICENSE-MIT.txt": "MIT fixture license\n",
  });
  writePackage(project, "dep-a", {
    name: "dep-a",
    version: "1.0.0",
    license: "Apache-2.0",
    dependencies: { "dep-b": "2.0.0" },
  }, { "index.js": "module.exports = require('dep-b');\n" });
  writePackage(project, "dep-a/node_modules/dep-b", {
    name: "dep-b",
    version: "2.0.0",
    license: "BSD-3-Clause",
  }, { "index.js": "module.exports = 'nested';\n", "NOTICE.txt": "notice\n" });
  writePackage(project, "@daisy/ace-axe-runner-puppeteer", {
    name: "@daisy/ace-axe-runner-puppeteer",
    version: "1.4.6",
    license: "MIT",
    dependencies: { "@xmldom/xmldom": "0.9.10" },
  }, {
    "lib/index.js": auditedRunnerSource(),
    "LICENSE": "MIT runner fixture\n",
  });
  writePackage(project, "@xmldom/xmldom", {
    name: "@xmldom/xmldom",
    version: "0.9.10",
    license: "MIT",
    main: "lib/index.js",
  }, {
    "lib/index.js": "module.exports = {};\n",
    "LICENSE": "MIT xmldom fixture license\n",
  });
  writePackage(project, "dev-only", {
    name: "dev-only",
    version: "1.0.0",
    license: "MIT",
  }, { "index.js": "throw new Error('must not stage');\n" });

  // 模拟 @daisy/ace 聚合包自带的 Electron 与下载浏览器；二者不应进入 closure。
  writePackage(project, "@daisy/ace", {
    name: "@daisy/ace",
    version: "1.2.3",
    dependencies: { electron: "99.0.0" },
  }, { ".cache/chrome.exe": "browser-binary" });
  writePackage(project, "@daisy/ace/node_modules/electron", {
    name: "electron",
    version: "99.0.0",
  }, { "dist/electron.exe": "nested-electron" });
  return project;
}

test("Ace staging copies only the recursive production closure and writes an auditable manifest", () => {
  const project = fixture();
  const out = path.join(project, "staged", "ace");
  try {
    const runnerSource = path.join(
      project,
      "node_modules",
      "@daisy",
      "ace-axe-runner-puppeteer",
      "lib",
      "index.js",
    );
    const runnerSourceBefore = fs.readFileSync(runnerSource);
    const sourceTreeBefore = snapshotTree(path.join(project, "node_modules"));
    const closure = collectProductionClosure(project);
    assert.deepEqual(closure.map((item) => item.manifest.name).sort(), [
      "@daisy/ace-axe-runner-puppeteer", "@daisy/ace-cli", "@xmldom/xmldom",
      "dep-a", "dep-b",
    ]);

    const manifest = stageAce({ projectRoot: project, outDir: out, updateLock: true });
    assert.equal(manifest.root_package.name, "@daisy/ace-cli");
    assert.equal(manifest.root_package.version, "1.2.3");
    assert.equal(manifest.package_count, 5);
    assert.deepEqual(manifest.packages.map((item) => item.name).sort(), [
      "@daisy/ace-axe-runner-puppeteer", "@daisy/ace-cli", "@xmldom/xmldom",
      "dep-a", "dep-b",
    ]);
    assert.equal(
      manifest.packages.find((item) => item.name === "@daisy/ace-cli").license,
      "MIT",
    );
    assert.deepEqual(
      manifest.packages.find((item) => item.name === "@daisy/ace-cli").license_files,
      ["LICENSE-MIT.txt"],
    );
    const generatedLicense = manifest.packages.find((item) => item.name === "dep-a");
    assert.equal(generatedLicense.license_source, "generated-metadata-notice");
    assert.deepEqual(generatedLicense.license_files, []);
    assert.deepEqual(generatedLicense.license_notice_files, ["licenses/dep-a@1.0.0.txt"]);
    assert.equal(manifest.formal_license_audit_required, true);
    assert.deepEqual(manifest.packages_requiring_formal_license_audit, [{
      name: "dep-a",
      version: "1.0.0",
      license: "Apache-2.0",
      path: "node_modules/dep-a",
      license_notice: "licenses/dep-a@1.0.0.txt",
    }]);
    const generatedNotice = fs.readFileSync(
      path.join(out, "licenses", "dep-a@1.0.0.txt"),
      "utf8",
    );
    assert.match(generatedNotice, /It is not an original license file/);
    assert.match(generatedNotice, /Canonical license reference: https:\/\/www\.apache\.org\/licenses\/LICENSE-2\.0/);
    assert.equal(generatedNotice.split(/\r?\n/).some((line) => /^Copyright\b/i.test(line)), false);
    assert.ok(fs.statSync(path.join(out, "THIRD_PARTY_NOTICES.md")).isFile());
    assert.ok(fs.statSync(path.join(out, "THIRD_PARTY_NOTICES.json")).isFile());
    assert.ok(fs.statSync(path.join(out, "ace.js")).isFile());
    assert.ok(fs.statSync(path.join(out, "node_modules", "@daisy", "ace-cli", "bin", "ace.js")).isFile());
    assert.ok(fs.statSync(path.join(out, "node_modules", "dep-a", "node_modules", "dep-b", "index.js")).isFile());
    assert.equal(fs.existsSync(path.join(out, "node_modules", "dev-only")), false);
    assert.equal(fs.existsSync(path.join(out, "node_modules", "@daisy", "ace")), false);
    assert.equal(fs.existsSync(path.join(out, "node_modules", "electron")), false);

    const saved = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    const lockRelative = aceLockRelative(saved.root_package.version);
    const lockTarget = path.join(project, ...lockRelative.split("/"));
    const savedLock = JSON.parse(fs.readFileSync(lockTarget, "utf8"));
    assert.deepEqual(savedLock, buildAceLock(saved));
    assert.equal(savedLock.lock_type, "oak-ace-stage");
    assert.equal(savedLock.package_closure.length, saved.package_count);
    assert.equal(savedLock.files.length, saved.file_count);
    assert.equal(saved.file_count, saved.files.length);
    assert.equal(saved.total_bytes, saved.files.reduce((sum, file) => sum + file.size_bytes, 0));
    assert.ok(saved.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)));
    assert.ok(saved.files.some((file) => file.path === "ace.js"));
    assert.ok(saved.files.some((file) => file.path === "licenses/dep-a@1.0.0.txt"));
    assert.ok(saved.files.some((file) => file.path === "THIRD_PARTY_NOTICES.md"));
    assert.ok(saved.files.some((file) => file.path === "THIRD_PARTY_NOTICES.json"));
    assert.ok(saved.excluded.some((item) => item.includes("electron")));
    assert.ok(saved.excluded.some((item) => item.includes("浏览器")));
    assert.equal(saved.patches.length, 1);
    assert.equal(saved.patches[0].patch_id, "OAK-ACE-ISOLATION-002");
    assert.equal(
      saved.patches[0].controlled_replacement,
      "scripts/patches/ace-axe-runner-puppeteer-1.4.6.js",
    );
    assert.deepEqual(saved.patches[0].sanitizer, {
      package_name: "@xmldom/xmldom",
      package_version: "0.9.10",
    });
    assert.equal(
      saved.packages.find((item) => item.name === "@daisy/ace-axe-runner-puppeteer")
        .dependencies["@xmldom/xmldom"].version,
      "0.9.10",
    );
    assert.equal(
      JSON.parse(fs.readFileSync(
        path.join(out, "node_modules", "@daisy", "ace-axe-runner-puppeteer", "package.json"),
        "utf8",
      )).dependencies["@xmldom/xmldom"],
      "0.9.10",
    );
    assert.match(saved.patches[0].effect, /作者 XHTML.*JavaScript 禁用/);
    assert.match(saved.patches[0].effect, /basedir 内 file:/);
    assert.match(saved.patches[0].effect, /OS 级网络隔离仍是正式发布阻断项/);
    const patchedFile = path.join(out, ...saved.patches[0].target_file.split("/"));
    assert.equal(saved.patches[0].after_sha256, saved.files.find(
      (file) => file.path === saved.patches[0].target_file,
    ).sha256);
    const patched = fs.readFileSync(patchedFile, "utf8");
    assert.equal(patched, fs.readFileSync(
      path.join(REPO_ROOT, ...SANDBOX_PATCH.replacement_source.split("/")),
      "utf8",
    ).replace(/\r\n?/g, "\n"));
    assert.match(patched, /await page\.setJavaScriptEnabled\(false\)/);
    assert.match(patched, /sanitizeAuthorDocument\(source\)/);
    assert.match(patched, /resolveAllowedFileUrl\(requestUrl, canonicalBaseDirectory\)/);
    assert.match(patched, /await settleIntercept\(request, 'abort', 'blockedbyclient'\)/);
    assert.match(patched, /handleRequest\(request, canonicalBaseDirectory\)\.catch/);
    const firstManifestBytes = fs.readFileSync(path.join(out, "manifest.json"));
    stageAce({ projectRoot: project, outDir: out });
    assert.deepEqual(
      fs.readFileSync(path.join(out, "manifest.json")),
      firstManifestBytes,
      "同一输入必须生成字节一致的 manifest",
    );
    assert.deepEqual(fs.readFileSync(runnerSource), runnerSourceBefore, "不得修改 source node_modules");
    assert.deepEqual(
      snapshotTree(path.join(project, "node_modules")),
      sourceTreeBefore,
      "阶段化不得修改 source node_modules 中的任何文件",
    );
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("Ace staging rejects an empty file that only looks like license material", () => {
  const project = fixture();
  const out = path.join(project, "staged", "ace");
  try {
    fs.writeFileSync(
      path.join(project, "node_modules", "@daisy", "ace-cli", "LICENSE-MIT.txt"),
      "",
    );
    assert.throws(
      () => stageAce({ projectRoot: project, outDir: out, updateLock: true }),
      /许可证文件为空/,
    );
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("Ace staging fails closed when the pinned upstream runner hash no longer matches", () => {
  const project = fixture();
  const out = path.join(project, "staged", "ace");
  try {
    const target = path.join(
      project,
      "node_modules",
      "@daisy",
      "ace-axe-runner-puppeteer",
      "lib",
      "index.js",
    );
    fs.writeFileSync(target, "module.exports = { changedUpstream: true };\n");
    assert.throws(
      () => stageAce({ projectRoot: project, outDir: out }),
      /安全补丁源哈希不匹配/,
    );
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("Ace staging never self-blesses a missing or changed repository lock", () => {
  const project = fixture();
  const out = path.join(project, "staged", "ace");
  try {
    assert.throws(
      () => stageAce({ projectRoot: project, outDir: out }),
      /受版本控制固定 lock 缺失或不安全/,
    );
    assert.equal(fs.existsSync(out), false);

    const manifest = stageAce({ projectRoot: project, outDir: out, updateLock: true });
    const manifestBefore = fs.readFileSync(path.join(out, "manifest.json"));
    const lockTarget = path.join(
      project,
      ...aceLockRelative(manifest.root_package.version).split("/"),
    );
    const changedLock = JSON.parse(fs.readFileSync(lockTarget, "utf8"));
    changedLock.total_bytes += 1;
    fs.writeFileSync(lockTarget, `${JSON.stringify(changedLock, null, 2)}\n`);

    assert.throws(
      () => stageAce({ projectRoot: project, outDir: out }),
      /固定 lock 与阶段化完整依赖闭包不一致.*--update-lock/,
    );
    assert.deepEqual(
      fs.readFileSync(path.join(out, "manifest.json")),
      manifestBefore,
      "lock 不匹配时不得换入新 stage",
    );

    stageAce({ projectRoot: project, outDir: out, updateLock: true });
    assert.doesNotThrow(() => stageAce({ projectRoot: project, outDir: out }));
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("Ace lock verification rejects semantically equivalent manifest byte drift", () => {
  const project = fixture();
  const out = path.join(project, "staged", "ace");
  try {
    const manifest = stageAce({ projectRoot: project, outDir: out, updateLock: true });
    const manifestTarget = path.join(out, "manifest.json");
    const canonicalBytes = fs.readFileSync(manifestTarget);

    fs.writeFileSync(manifestTarget, JSON.stringify(manifest));
    assert.throws(
      () => verifyAceStageLock(project, JSON.parse(
        fs.readFileSync(manifestTarget, "utf8"),
      ), manifestTarget),
      /manifest 字节身份与固定 lock 不一致/,
    );

    fs.writeFileSync(manifestTarget, canonicalBytes);
    assert.doesNotThrow(() => verifyAceStageLock(project, manifest, manifestTarget));
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("Ace stage swap rolls back before lock commit and restores the previous directory", () => {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "oak-ace-transaction-"));
  const staged = path.join(root, "staged");
  const destination = path.join(root, "destination");
  try {
    fs.mkdirSync(staged);
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(staged, "identity.txt"), "new\n");
    fs.writeFileSync(path.join(destination, "identity.txt"), "old\n");
    let commitCalls = 0;
    assert.throws(
      () => replaceDirectoryAtomically(staged, destination, () => {
        commitCalls += 1;
        throw new Error("simulated lock commit failure");
      }),
      /simulated lock commit failure/,
    );
    assert.equal(commitCalls, 1);
    assert.equal(fs.readFileSync(path.join(destination, "identity.txt"), "utf8"), "old\n");
    assert.equal(fs.existsSync(staged), false);

    assert.throws(
      () => replaceDirectoryAtomically(path.join(root, "missing-stage"), destination, () => {
        commitCalls += 1;
      }),
      /ENOENT/,
    );
    assert.equal(commitCalls, 1, "目录换入失败时不得进入 lock commit");
    assert.equal(fs.readFileSync(path.join(destination, "identity.txt"), "utf8"), "old\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Ace staging rejects repository root, node_modules, and paths outside projectRoot", () => {
  const project = fixture();
  const outside = path.join(path.dirname(project), `${path.basename(project)}-outside`);
  try {
    for (const target of [project, path.join(project, "node_modules"), outside]) {
      assert.throws(
        () => stageAce({ projectRoot: project, outDir: target, updateLock: true }),
        /输出目录.*(?:项目根目录|node_modules)/,
      );
    }
    assert.equal(fs.existsSync(outside), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("Ace staging rejects an existing junction or symlink that canonicalizes outside projectRoot", (t) => {
  const project = fixture();
  const outside = fs.mkdtempSync(path.join(path.dirname(project), "oak-ace-outside-"));
  const link = path.join(project, "escaped-output");
  try {
    try {
      fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        t.skip(`当前主机不能创建测试用 junction/symlink：${error.code}`);
        return;
      }
      throw error;
    }
    assert.throws(
      () => stageAce({
        projectRoot: project,
        outDir: path.join(link, "ace"),
        updateLock: true,
      }),
      /经规范化后逃逸项目根目录/,
    );
    assert.equal(fs.existsSync(path.join(outside, "ace")), false);
  } finally {
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("controlled Ace runner sanitizes author XHTML before enabling JavaScript", () => {
  const {
    CHROMIUM_SECURITY_ARGS,
    allowedNonFileProtocol,
    sanitizeAuthorDocument,
  } = controlledRunner.__oakSecurity;
  const malicious = [
    '<?xml version="1.0"?>',
    '<?xml-stylesheet type="text/xsl" href="data:text/xml,unsafe"?>',
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink">',
    '<head>',
    '<base href="https://attacker.invalid/"/>',
    '<meta http-equiv="refresh" content="0; https://attacker.invalid/"/>',
    '<meta http-equiv="Content-Security-Policy" content="script-src *"/>',
    '<script>globalThis.authorScriptRan = true;</script>',
    '</head>',
    '<body onload="fetch(\'https://attacker.invalid/\')">',
    '<iframe src="https://attacker.invalid/"></iframe>',
    '<object data="https://attacker.invalid/"></object>',
    '<embed src="https://attacker.invalid/"/>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
    '<script>alert(2)</script>',
    '<a xlink:href=" javascript:alert(3)">unsafe</a>',
    '</svg>',
    '<p onclick="alert(4)">safe manuscript text</p>',
    '</body></html>',
  ].join('');
  const sanitized = sanitizeAuthorDocument(malicious);
  assert.doesNotMatch(sanitized, /<(?:\w+:)?(?:script|base|iframe|object|embed)\b/i);
  assert.doesNotMatch(sanitized, /http-equiv=["']refresh["']/i);
  assert.doesNotMatch(sanitized, /http-equiv=["']Content-Security-Policy["']/i);
  assert.doesNotMatch(sanitized, /\s(?:\w+:)?on\w+\s*=/i);
  assert.doesNotMatch(sanitized, /javascript\s*:/i);
  assert.doesNotMatch(sanitized, /<\?xml-stylesheet/i);
  assert.match(sanitized, /safe manuscript text/);
  assert.throws(
    () => sanitizeAuthorDocument('<html><body><p></body></html>'),
    /Author XHTML parse failure/,
  );

  for (const argument of [
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--no-pings',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  ]) {
    assert.ok(CHROMIUM_SECURITY_ARGS.includes(argument), `missing Chromium argument ${argument}`);
  }
  assert.equal(CHROMIUM_SECURITY_ARGS.includes('--no-sandbox'), false);
  assert.equal(allowedNonFileProtocol('data:text/plain,ok'), true);
  assert.equal(allowedNonFileProtocol('blob:null/id'), true);
  assert.equal(allowedNonFileProtocol('about:blank'), true);
  for (const blocked of [
    'https://attacker.invalid/',
    'http://attacker.invalid/',
    'wss://attacker.invalid/socket',
    'ws://attacker.invalid/socket',
    'ftp://attacker.invalid/file',
  ]) {
    assert.equal(allowedNonFileProtocol(blocked), false, `must block ${blocked}`);
  }

  const source = fs.readFileSync(
    path.join(REPO_ROOT, ...SANDBOX_PATCH.replacement_source.split('/')),
    'utf8',
  );
  const disabledAt = source.indexOf('await page.setJavaScriptEnabled(false)');
  const navigatedAt = source.indexOf("await page.goto(url, { waitUntil: 'load' })");
  const enabledAt = source.indexOf('await page.setJavaScriptEnabled(true)');
  const injectedAt = source.indexOf('await utils.addScriptContents(scriptContents, page)');
  assert.ok(disabledAt >= 0 && disabledAt < navigatedAt);
  assert.ok(navigatedAt < enabledAt && enabledAt < injectedAt);
});

test("controlled Ace runner only serves sanitized files inside the canonical EPUB basedir", async () => {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "oak-ace-path-policy-"));
  const basedir = path.join(root, "book");
  const inside = path.join(basedir, "chapter.xhtml");
  const outside = path.join(root, "outside.xhtml");
  try {
    fs.mkdirSync(basedir, { recursive: true });
    fs.writeFileSync(inside, "<html><body onload=\"alert(1)\"><script>alert(2)</script><p>ok</p></body></html>");
    fs.writeFileSync(outside, "<html/>");
    const canonicalBase = fs.realpathSync(basedir);
    assert.equal(
      controlledRunner.__oakSecurity.resolveAllowedFileUrl(
        pathToFileURL(inside).href,
        canonicalBase,
      ),
      fs.realpathSync(inside),
    );
    assert.equal(
      controlledRunner.__oakSecurity.resolveAllowedFileUrl(
        pathToFileURL(outside).href,
        canonicalBase,
      ),
      null,
    );
    assert.equal(
      controlledRunner.__oakSecurity.resolveAllowedFileUrl(
        "https://attacker.invalid/chapter.xhtml",
        canonicalBase,
      ),
      null,
    );

    function requestFor(rawUrl, resourceType = "document") {
      const calls = [];
      return {
        calls,
        request: {
          url: () => rawUrl,
          resourceType: () => resourceType,
          isInterceptResolutionHandled: () => false,
          continue: async (options) => calls.push(["continue", options]),
          respond: async (options) => calls.push(["respond", options]),
          abort: async (reason) => calls.push(["abort", reason]),
        },
      };
    }

    const authorDocument = requestFor(pathToFileURL(inside).href);
    await controlledRunner.__oakSecurity.handleRequest(
      authorDocument.request,
      canonicalBase,
    );
    assert.equal(authorDocument.calls.length, 1);
    assert.equal(authorDocument.calls[0][0], "respond");
    assert.doesNotMatch(authorDocument.calls[0][1].body, /<script\b/i);
    assert.doesNotMatch(authorDocument.calls[0][1].body, /\sonload=/i);
    assert.match(authorDocument.calls[0][1].body, /<p>ok<\/p>/);

    for (const blockedUrl of [
      pathToFileURL(outside).href,
      "https://attacker.invalid/resource",
      "wss://attacker.invalid/socket",
    ]) {
      const blocked = requestFor(blockedUrl, "fetch");
      await controlledRunner.__oakSecurity.handleRequest(blocked.request, canonicalBase);
      assert.deepEqual(blocked.calls, [["abort", "blockedbyclient"]]);
    }

    for (const allowedUrl of ["about:blank", "blob:null/id", "data:text/plain,ok"]) {
      const allowed = requestFor(allowedUrl, "image");
      await controlledRunner.__oakSecurity.handleRequest(allowed.request, canonicalBase);
      assert.deepEqual(allowed.calls, [["continue", undefined]]);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Ace staging refuses to synthesize a notice for an unsupported license expression", () => {
  const project = fixture();
  const out = path.join(project, "staged", "ace");
  try {
    const manifestPath = path.join(project, "node_modules", "dep-a", "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.license = "SEE LICENSE IN PRIVATE-CONTRACT.txt";
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => stageAce({ projectRoot: project, outDir: out }),
      /不支持为声明 SEE LICENSE IN PRIVATE-CONTRACT\.txt 生成元数据通知/,
    );
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
