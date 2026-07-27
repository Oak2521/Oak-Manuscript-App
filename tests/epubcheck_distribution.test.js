"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const {
  DISTRIBUTION_RELATIVE,
  MANIFEST_RELATIVE,
  REQUIRED_FILES,
  verifyDistribution,
  writePinnedManifest,
} = require("../scripts/epubcheck_distribution");

const REPO_ROOT = path.resolve(__dirname, "..");

function fixtureRoot(t) {
  const parent = path.join(REPO_ROOT, "out", "test-fixtures");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "epubcheck-dist-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const distribution = path.join(root, ...DISTRIBUTION_RELATIVE.split("/"));
  for (const relative of [...REQUIRED_FILES, "lib/dependency.jar"]) {
    const target = path.join(distribution, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `fixture ${relative}\n`);
  }
  return { root, distribution };
}

test("EpubCheck manifest is deterministic and covers the complete distribution", (t) => {
  const { root } = fixtureRoot(t);
  const first = writePinnedManifest(root);
  const firstBytes = fs.readFileSync(first.target);
  const second = writePinnedManifest(root);
  assert.deepEqual(fs.readFileSync(second.target), firstBytes);

  const verified = verifyDistribution(root);
  assert.equal(verified.manifest.tool.version, "5.3.0");
  assert.equal(verified.manifest.file_count, REQUIRED_FILES.length + 1);
  assert.equal(verified.manifest.formal_provenance_audit_required, true);
  assert.equal(verified.entry, path.join(verified.distribution, "epubcheck.jar"));
});

test("EpubCheck verification rejects changed, extra, and missing distribution files", (t) => {
  const { root, distribution } = fixtureRoot(t);
  writePinnedManifest(root);
  const target = path.join(distribution, "lib", "dependency.jar");
  fs.appendFileSync(target, "tamper\n");
  assert.throws(() => verifyDistribution(root), /SHA-256 或大小/);

  writePinnedManifest(root);
  fs.writeFileSync(path.join(distribution, "extra.jar"), "extra\n");
  assert.throws(() => verifyDistribution(root), /漏列实际文件/);

  fs.rmSync(path.join(distribution, "extra.jar"));
  writePinnedManifest(root);
  fs.rmSync(path.join(distribution, "LICENSE.txt"));
  assert.throws(() => verifyDistribution(root), /列出不存在文件/);
});

test("EpubCheck verification rejects a self-relaxed audit manifest", (t) => {
  const { root } = fixtureRoot(t);
  const { target } = writePinnedManifest(root);
  const manifest = JSON.parse(fs.readFileSync(target, "utf8"));
  manifest.formal_provenance_audit_required = false;
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => verifyDistribution(root), /审计状态不匹配/);

  assert.equal(
    path.relative(root, target).split(path.sep).join("/"),
    MANIFEST_RELATIVE,
  );
});
