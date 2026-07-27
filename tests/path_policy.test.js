"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  assertSafeExistingProjectFile,
  writeProjectFileAtomicSync,
} = require("../electron/path-policy");

const TEST_OUTPUT_PARENT = path.resolve(__dirname, "../out/node-path-policy");

function makeRoot(t) {
  fs.mkdirSync(TEST_OUTPUT_PARENT, { recursive: true });
  const root = fs.mkdtempSync(path.join(TEST_OUTPUT_PARENT, "case-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function makeProject(root, name = "project") {
  const project = path.join(root, name);
  fs.mkdirSync(path.join(project, "exports"), { recursive: true });
  fs.writeFileSync(path.join(project, "project.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(project, "exports", "report.html"), "<p>safe report</p>\n", "utf8");
  return project;
}

function linkUnavailable(error) {
  return error && ["EPERM", "EACCES", "ENOTSUP", "EINVAL", "UNKNOWN"].includes(error.code);
}

function makeDirectoryLink(t, target, link) {
  try {
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (error) {
    if (!linkUnavailable(error)) throw error;
    t.skip(`当前主机不能创建测试用 junction/symlink：${error.code}`);
    return false;
  }
}

function makeFileLink(t, target, link) {
  try {
    fs.symlinkSync(target, link, "file");
    return true;
  } catch (error) {
    if (!linkUnavailable(error)) throw error;
    t.skip(`当前主机不能创建测试用文件 symlink：${error.code}`);
    return false;
  }
}

function removeLink(link) {
  try {
    fs.unlinkSync(link);
  } catch {
    try { fs.rmSync(link, { recursive: true, force: true }); } catch { /* test cleanup */ }
  }
}

test("atomic project write supports a missing target and safely replaces an existing regular file", (t) => {
  const root = makeRoot(t);
  const project = makeProject(root);
  const target = path.join(project, "exports", "report_preview.pdf");

  assert.equal(
    writeProjectFileAtomicSync(project, target, Buffer.from("first"), {
      expectedParentRelative: "exports",
    }),
    target,
  );
  assert.equal(fs.readFileSync(target, "utf8"), "first");

  writeProjectFileAtomicSync(project, target, Buffer.from("second"), {
    expectedParentRelative: "exports",
  });
  assert.equal(fs.readFileSync(target, "utf8"), "second");
  assert.deepEqual(
    fs.readdirSync(path.dirname(target)).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("project root junction or symlink is rejected before PDF bytes are written", (t) => {
  const root = makeRoot(t);
  const actual = makeProject(root, "actual-project");
  const linked = path.join(root, "linked-project");
  if (!makeDirectoryLink(t, actual, linked)) return;

  const target = path.join(linked, "exports", "report_preview.pdf");
  assert.throws(
    () => writeProjectFileAtomicSync(linked, target, Buffer.from("pdf"), {
      expectedParentRelative: "exports",
    }),
    /符号链接|junction|重解析点/,
  );
  assert.equal(fs.existsSync(path.join(actual, "exports", "report_preview.pdf")), false);
});

test("exports junction or symlink cannot redirect a PDF write outside the project", (t) => {
  const root = makeRoot(t);
  const project = path.join(root, "project");
  const outside = path.join(root, "outside");
  fs.mkdirSync(project);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(project, "project.json"), "{}\n");
  fs.writeFileSync(path.join(outside, "report.html"), "<p>outside</p>\n");
  if (!makeDirectoryLink(t, outside, path.join(project, "exports"))) return;

  assert.throws(
    () => writeProjectFileAtomicSync(
      project,
      path.join(project, "exports", "report_preview.pdf"),
      Buffer.from("sensitive pdf"),
      { expectedParentRelative: "exports" },
    ),
    /符号链接|junction|重解析点/,
  );
  assert.equal(fs.existsSync(path.join(outside, "report_preview.pdf")), false);
});

test("report.html symlink is rejected before the PDF window loads it", (t) => {
  const root = makeRoot(t);
  const project = makeProject(root);
  const report = path.join(project, "exports", "report.html");
  const outside = path.join(root, "outside-report.html");
  fs.writeFileSync(outside, "<script>throw new Error('outside')</script>\n");
  fs.unlinkSync(report);
  if (!makeFileLink(t, outside, report)) return;

  assert.throws(
    () => assertSafeExistingProjectFile(project, report, {
      expectedParentRelative: "exports",
    }),
    /符号链接|junction|重解析点/,
  );
});

test("existing report_preview.pdf symlink is rejected without touching its outside target", (t) => {
  const root = makeRoot(t);
  const project = makeProject(root);
  const outside = path.join(root, "outside.pdf");
  const target = path.join(project, "exports", "report_preview.pdf");
  fs.writeFileSync(outside, "outside-original");
  if (!makeFileLink(t, outside, target)) return;

  assert.throws(
    () => writeProjectFileAtomicSync(project, target, Buffer.from("new pdf"), {
      expectedParentRelative: "exports",
    }),
    /符号链接|junction|重解析点/,
  );
  assert.equal(fs.readFileSync(outside, "utf8"), "outside-original");
});

test("existing report_preview.pdf hardlink fails closed and is never modified in place", (t) => {
  const root = makeRoot(t);
  const project = makeProject(root);
  const outside = path.join(root, "outside-hardlink.pdf");
  const target = path.join(project, "exports", "report_preview.pdf");
  fs.writeFileSync(outside, "outside-original");
  try {
    fs.linkSync(outside, target);
  } catch (error) {
    if (!linkUnavailable(error)) throw error;
    t.skip(`当前文件系统不能创建测试用硬链接：${error.code}`);
    return;
  }

  assert.throws(
    () => writeProjectFileAtomicSync(project, target, Buffer.from("new pdf"), {
      expectedParentRelative: "exports",
    }),
    /硬链接/,
  );
  assert.equal(fs.readFileSync(outside, "utf8"), "outside-original");
  assert.equal(fs.readFileSync(target, "utf8"), "outside-original");
});

test("parent identity fault after open is always rejected before content write or rename", (t) => {
  const root = makeRoot(t);
  const project = makeProject(root);
  const exportsDir = path.join(project, "exports");
  const replacementIdentity = path.join(root, "replacement-identity");
  fs.mkdirSync(replacementIdentity);

  let opened = false;
  let writeCalls = 0;
  let renameCalls = 0;
  const fsImpl = Object.create(fs);
  fsImpl.openSync = (...args) => {
    const descriptor = fs.openSync(...args);
    opened = true;
    return descriptor;
  };
  fsImpl.lstatSync = (target, options) => {
    if (opened && path.resolve(target) === exportsDir) {
      // 用另一目录的 dev/ino 模拟 attacker 在 open 后换入同词法路径的新父目录。
      return fs.lstatSync(replacementIdentity, options);
    }
    return fs.lstatSync(target, options);
  };
  fsImpl.writeFileSync = (...args) => {
    writeCalls += 1;
    return fs.writeFileSync(...args);
  };
  fsImpl.renameSync = (...args) => {
    renameCalls += 1;
    return fs.renameSync(...args);
  };

  assert.throws(
    () => writeProjectFileAtomicSync(
      project,
      path.join(exportsDir, "report_preview.pdf"),
      Buffer.from("must-not-be-written"),
      { expectedParentRelative: "exports", fsImpl },
    ),
    /父目录.*发生变化/,
  );
  assert.equal(writeCalls, 0);
  assert.equal(renameCalls, 0);
  assert.equal(fs.existsSync(path.join(exportsDir, "report_preview.pdf")), false);
});

test("parent-chain replacement after temporary open is rejected before content write or commit", (t) => {
  const root = makeRoot(t);
  const project = makeProject(root);
  const exportsDir = path.join(project, "exports");
  const movedExports = path.join(project, "exports-before-swap");
  const outside = path.join(root, "outside-swap");
  fs.mkdirSync(outside);

  let writeCalls = 0;
  let commitCalls = 0;
  let swapped = false;
  const fsImpl = Object.create(fs);
  fsImpl.openSync = (...args) => {
    const descriptor = fs.openSync(...args);
    try {
      fs.renameSync(exportsDir, movedExports);
      fs.symlinkSync(outside, exportsDir, process.platform === "win32" ? "junction" : "dir");
      swapped = true;
      return descriptor;
    } catch (error) {
      fs.closeSync(descriptor);
      if (!fs.existsSync(exportsDir) && fs.existsSync(movedExports)) {
        fs.renameSync(movedExports, exportsDir);
      }
      error.testLinkUnavailable = linkUnavailable(error) || error.code === "EBUSY";
      throw error;
    }
  };
  fsImpl.writeFileSync = (...args) => {
    writeCalls += 1;
    return fs.writeFileSync(...args);
  };
  fsImpl.renameSync = (...args) => {
    commitCalls += 1;
    return fs.renameSync(...args);
  };

  let thrown;
  try {
    writeProjectFileAtomicSync(
      project,
      path.join(exportsDir, "report_preview.pdf"),
      Buffer.from("must-not-be-written"),
      { expectedParentRelative: "exports", fsImpl },
    );
  } catch (error) {
    thrown = error;
  }
  if (thrown && thrown.testLinkUnavailable) {
    t.skip(`当前主机不能在打开文件后替换测试目录链：${thrown.code}`);
    return;
  }

  assert.ok(thrown);
  assert.match(thrown.message, /符号链接|junction|重解析点|发生变化/);
  assert.equal(swapped, true);
  assert.equal(writeCalls, 0, "目录换入必须在写入 PDF 内容前被发现");
  assert.equal(commitCalls, 0, "目录换入后不得提交 rename");
  assert.equal(fs.existsSync(path.join(outside, "report_preview.pdf")), false);

  removeLink(exportsDir);
  fs.renameSync(movedExports, exportsDir);
});
