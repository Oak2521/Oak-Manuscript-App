"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  cleanJavaEnvironment,
  commitRuntimeAndLockTransaction,
  javaFeature,
  parseModuleList,
  parseReleaseFile,
  requireContained,
  validateSourceJdkRelease,
} = require("../scripts/stage_epubcheck_jre");

const REPO_ROOT = path.resolve(__dirname, "..");

function transactionFixture() {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "oak-jre-transaction-"));
  const staged = path.join(root, "staged-runtime");
  const destination = path.join(root, "installed-runtime");
  const lockTarget = path.join(root, "jre-lock.json");
  fs.mkdirSync(staged);
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(staged, "identity.txt"), "new-runtime\n", "utf8");
  fs.writeFileSync(path.join(destination, "identity.txt"), "old-runtime\n", "utf8");
  const oldLockText = '{\r\n  "identity": "old-lock"\r\n}\r\n';
  fs.writeFileSync(lockTarget, oldLockText, "utf8");
  return { root, staged, destination, lockTarget, oldLockText };
}

function failRenameOnce(predicate, message, calls = []) {
  let failed = false;
  return new Proxy(fs, {
    get(target, property, receiver) {
      if (property !== "renameSync") return Reflect.get(target, property, receiver);
      return (source, destination) => {
        calls.push([source, destination]);
        if (!failed && predicate(source, destination)) {
          failed = true;
          const error = new Error(message);
          error.code = "EIO";
          throw error;
        }
        return fs.renameSync(source, destination);
      };
    },
  });
}

const TEMURIN_RELEASE = [
  'IMPLEMENTOR="Eclipse Adoptium"',
  'IMPLEMENTOR_VERSION="Temurin-21.0.11+10"',
  'JAVA_RUNTIME_VERSION="21.0.11+10-LTS"',
  'JAVA_VERSION="21.0.11"',
  'OS_ARCH="x86_64"',
  'OS_NAME="Windows"',
  'IMAGE_TYPE="JDK"',
  "",
].join("\n");

test("Temurin release parser and platform gate pin JDK 21 Windows x64", () => {
  const release = parseReleaseFile(TEMURIN_RELEASE);
  assert.equal(validateSourceJdkRelease(release, {
    platform: "win32",
    arch: "x64",
  }), release);
  assert.equal(javaFeature(release.JAVA_VERSION), 21);

  for (const [label, mutate, pattern] of [
    ["vendor", (item) => { item.IMPLEMENTOR = "Other"; }, /Eclipse Adoptium/],
    ["distribution", (item) => { item.IMPLEMENTOR_VERSION = "OpenJDK"; }, /Temurin/],
    ["patch", (item) => { item.JAVA_VERSION = "21.0.12"; }, /JDK 版本必须/],
    ["runtime", (item) => { item.JAVA_RUNTIME_VERSION = "21.0.11+11-LTS"; }, /JDK 版本必须/],
    ["os", (item) => { item.OS_NAME = "Linux"; }, /Windows/],
    ["arch", (item) => { item.OS_ARCH = "aarch64"; }, /x86_64/],
  ]) {
    const changed = { ...release };
    mutate(changed);
    assert.throws(
      () => validateSourceJdkRelease(changed, { platform: "win32", arch: "x64" }),
      pattern,
      label,
    );
  }
  assert.throws(
    () => validateSourceJdkRelease(release, { platform: "darwin", arch: "x64" }),
    /只能在 Windows x64/,
  );
});

test("release parser fails closed on unquoted or injected metadata", () => {
  assert.throws(
    () => parseReleaseFile(`${TEMURIN_RELEASE}JAVA_VERSION=21\n`),
    /无法审计/,
  );
  assert.throws(
    () => parseReleaseFile(`${TEMURIN_RELEASE}BAD="value" trailing\n`),
    /无法审计/,
  );
});

test("jdeps and java module output becomes a unique deterministic module set", () => {
  assert.equal(javaFeature("openjdk 21.0.11 2026-04-21 LTS\nOpenJDK Runtime"), 21);
  assert.equal(javaFeature("21.0.11"), 21);
  assert.equal(javaFeature("openjdk 17.0.15"), 17);
  assert.equal(javaFeature("build date 2026-04-21"), null);
  assert.deepEqual(
    parseModuleList("java.sql,java.base,jdk.unsupported,java.sql\n"),
    ["java.base", "java.sql", "jdk.unsupported"],
  );
  assert.deepEqual(
    parseModuleList("java.base@21.0.11\njava.xml@21.0.11\n"),
    ["java.base", "java.xml"],
  );
  assert.deepEqual(
    parseModuleList(
      "警告: 拆分程序包: javax.xml jrt:/java.xml fixture.jar\n"
      + "java.base,java.desktop,jdk.unsupported\n",
    ),
    ["java.base", "java.desktop", "jdk.unsupported"],
  );
  assert.throws(() => parseModuleList(""), /无法解析/);
  assert.throws(() => parseModuleList("java.base;evil"), /无法解析/);
});

test("JRE staging strips Java option and classpath injection from all child tools", () => {
  assert.deepEqual(cleanJavaEnvironment({
    Path: "C:/Windows",
    CLASSPATH: "C:/evil.jar",
    java_tool_options: "-javaagent:C:/evil.jar",
    JDK_JAVA_OPTIONS: "--module-path=C:/evil",
    _JAVA_OPTIONS: "-Djava.security.manager=allow",
    SAFE: "kept",
  }), {
    Path: "C:/Windows",
    SAFE: "kept",
  });
});

test("JRE staging path gate rejects the project root and lexical escape", () => {
  const root = path.resolve(__dirname, "..");
  assert.throws(() => requireContained(root, root, "fixture"), /必须位于项目目录内/);
  assert.throws(
    () => requireContained(root, path.join(root, "..", "escape"), "fixture"),
    /必须位于项目目录内/,
  );
  assert.equal(
    requireContained(root, path.join(root, "tools", "future-runtime"), "fixture"),
    path.join(root, "tools", "future-runtime"),
  );
});

test("JRE update-lock transaction commits the staged runtime and tracked lock together", () => {
  const fixture = transactionFixture();
  try {
    commitRuntimeAndLockTransaction({
      staged: fixture.staged,
      destination: fixture.destination,
      lockTarget: fixture.lockTarget,
      lock: { identity: "new-lock" },
    });

    assert.equal(
      fs.readFileSync(path.join(fixture.destination, "identity.txt"), "utf8"),
      "new-runtime\n",
    );
    assert.equal(
      fs.readFileSync(fixture.lockTarget, "utf8"),
      `${JSON.stringify({ identity: "new-lock" }, null, 2)}\n`,
    );
    assert.equal(fs.existsSync(fixture.staged), false);
    assert.deepEqual(
      fs.readdirSync(fixture.root).sort(),
      ["installed-runtime", "jre-lock.json"],
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("JRE directory swap failure leaves the tracked lock and old runtime untouched", () => {
  const fixture = transactionFixture();
  const renameCalls = [];
  const operations = failRenameOnce(
    (source, destination) => (
      path.resolve(source) === path.resolve(fixture.staged)
      && path.resolve(destination) === path.resolve(fixture.destination)
    ),
    "injected runtime install failure",
    renameCalls,
  );
  try {
    assert.throws(
      () => commitRuntimeAndLockTransaction({
        staged: fixture.staged,
        destination: fixture.destination,
        lockTarget: fixture.lockTarget,
        lock: { identity: "new-lock" },
        operations,
      }),
      /injected runtime install failure/,
    );

    assert.equal(
      fs.readFileSync(path.join(fixture.destination, "identity.txt"), "utf8"),
      "old-runtime\n",
    );
    assert.equal(fs.readFileSync(fixture.lockTarget, "utf8"), fixture.oldLockText);
    assert.equal(
      renameCalls.some(([source, destination]) => (
        path.resolve(source) === path.resolve(fixture.lockTarget)
        || path.resolve(destination) === path.resolve(fixture.lockTarget)
      )),
      false,
      "目录换入失败时不得移动 tracked lock",
    );
    assert.equal(
      fs.readFileSync(path.join(fixture.staged, "identity.txt"), "utf8"),
      "new-runtime\n",
    );
    assert.deepEqual(
      fs.readdirSync(fixture.root).sort(),
      ["installed-runtime", "jre-lock.json", "staged-runtime"],
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("JRE transaction rejects a non-file tracked lock before moving the runtime", () => {
  const fixture = transactionFixture();
  try {
    fs.rmSync(fixture.lockTarget, { force: true });
    fs.mkdirSync(fixture.lockTarget);
    assert.throws(
      () => commitRuntimeAndLockTransaction({
        staged: fixture.staged,
        destination: fixture.destination,
        lockTarget: fixture.lockTarget,
        lock: { identity: "new-lock" },
      }),
      /受版本控制锁必须是普通文件/,
    );
    assert.equal(
      fs.readFileSync(path.join(fixture.destination, "identity.txt"), "utf8"),
      "old-runtime\n",
    );
    assert.equal(
      fs.readFileSync(path.join(fixture.staged, "identity.txt"), "utf8"),
      "new-runtime\n",
    );
    assert.equal(fs.lstatSync(fixture.lockTarget).isDirectory(), true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("JRE lock commit failure restores the old runtime and exact old lock bytes", () => {
  const fixture = transactionFixture();
  const operations = failRenameOnce(
    (source, destination) => (
      path.resolve(destination) === path.resolve(fixture.lockTarget)
      && path.basename(source).includes(".stage-")
    ),
    "injected lock install failure",
  );
  try {
    assert.throws(
      () => commitRuntimeAndLockTransaction({
        staged: fixture.staged,
        destination: fixture.destination,
        lockTarget: fixture.lockTarget,
        lock: { identity: "new-lock" },
        operations,
      }),
      /injected lock install failure/,
    );

    assert.equal(
      fs.readFileSync(path.join(fixture.destination, "identity.txt"), "utf8"),
      "old-runtime\n",
    );
    assert.equal(fs.readFileSync(fixture.lockTarget, "utf8"), fixture.oldLockText);
    assert.equal(
      fs.readFileSync(path.join(fixture.staged, "identity.txt"), "utf8"),
      "new-runtime\n",
    );
    assert.deepEqual(
      fs.readdirSync(fixture.root).sort(),
      ["installed-runtime", "jre-lock.json", "staged-runtime"],
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
