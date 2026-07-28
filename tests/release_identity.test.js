"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  IDENTITY_RELATIVE,
  SCHEMA_RELATIVE,
  parseArgs,
  verifyReleaseIdentity,
} = require("../scripts/release_identity");

const REPO_ROOT = path.resolve(__dirname, "..");

function write(root, relative, bytes) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return target;
}

function writeJson(root, relative, value) {
  return write(root, relative, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture(t) {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "release-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const identity = {
    schema_version: "1.0",
    identity_id: "oak-manuscript-release-identity",
    product_name: "湖岸稿件 Oak Manuscript",
    app_id: "com.oakbylake.manuscript",
    publisher_brand: "湖岸橡树",
    official_website: "https://oakbylake.com/",
    legal_seller_name: "Oak by Lake Test Seller Inc.",
    support_url: "https://support.oakbylake.com/manuscript",
    privacy_policy_url: "https://oakbylake.com/privacy",
    terms_url: "https://oakbylake.com/terms",
    copyright_notice: "Copyright 2026 Oak by Lake Test Seller Inc.",
    signing: {
      windows_certificate_subject: "CN=Oak by Lake Test Seller Inc.",
      apple_team_id: "ABCDE12345",
    },
    human_review: {
      status: "verified",
      reviewed_by: "Release Reviewer",
      reviewed_at: "2026-07-28T12:00:00Z",
    },
  };
  const schemaSource = path.join(REPO_ROOT, ...SCHEMA_RELATIVE.split("/"));
  write(root, SCHEMA_RELATIVE, fs.readFileSync(schemaSource));
  writeJson(root, IDENTITY_RELATIVE, identity);
  writeJson(root, "package.json", {
    name: "fixture",
    productName: identity.product_name,
    version: "1.0.0",
    author: { name: identity.legal_seller_name },
    homepage: identity.official_website,
    build: {
      appId: identity.app_id,
      copyright: identity.copyright_notice,
      extraMetadata: {
        oakReleaseIdentity: {
          schema_version: "1.0",
          app_id: identity.app_id,
          copyright_notice: identity.copyright_notice,
        },
      },
    },
  });
  return { root, identity };
}

test("tracked repository identity is valid but explicitly incomplete", () => {
  const windows = verifyReleaseIdentity({
    identityRoot: REPO_ROOT,
    packageRoot: REPO_ROOT,
    platform: "win32",
  });
  assert.equal(windows.ok, true);
  assert.equal(windows.complete, false);
  assert.equal(windows.human_review_status, "pending");
  assert.equal(windows.missing_fields.includes("legal_seller_name"), true);
  assert.equal(windows.missing_fields.includes("signing.windows_certificate_subject"), true);
  assert.equal(windows.missing_fields.includes("package.json.author"), true);

  const mac = verifyReleaseIdentity({
    identityRoot: REPO_ROOT,
    packageRoot: REPO_ROOT,
    platform: "darwin",
  });
  assert.equal(mac.missing_fields.includes("signing.apple_team_id"), true);
  assert.equal(mac.missing_fields.includes("signing.windows_certificate_subject"), false);
});

test("complete reviewed identity agrees with package metadata on both platforms", (t) => {
  const { root } = makeFixture(t);
  assert.equal(verifyReleaseIdentity({
    identityRoot: root,
    packageRoot: root,
    platform: "win32",
  }).complete, true);
  assert.equal(verifyReleaseIdentity({
    identityRoot: root,
    packageRoot: root,
    platform: "darwin",
  }).complete, true);
});

test("identity verifier accepts explicit packaged bytes and rejects duplicate packaged keys", (t) => {
  const { root, identity } = makeFixture(t);
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const packageBytes = Buffer.from(`${JSON.stringify({
    name: sourcePackage.name,
    productName: sourcePackage.productName,
    version: sourcePackage.version,
    author: sourcePackage.author,
    homepage: sourcePackage.homepage,
    oakReleaseIdentity: sourcePackage.build.extraMetadata.oakReleaseIdentity,
  }, null, 2)}\n`);
  const result = verifyReleaseIdentity({
    identityRoot: root,
    packageRoot: path.join(root, "unused-package-root"),
    packageBytes,
    packageEvidenceScope: "packaged-app-asar",
    platform: "win32",
  });
  assert.equal(result.complete, true);
  assert.equal(result.package_evidence_scope, "packaged-app-asar");
  assert.equal(result.app_id, identity.app_id);

  const duplicate = Buffer.from(packageBytes.toString("utf8").replace(
    '  "name": "fixture",',
    '  "name": "fixture",\n  "name": "duplicate",',
  ));
  assert.throws(() => verifyReleaseIdentity({
    identityRoot: root,
    packageBytes: duplicate,
    packageEvidenceScope: "packaged-app-asar",
    platform: "win32",
  }), /app\.asar package\.json.*重复字段 name/u);
});

test("identity verifier rejects duplicate keys, unknown fields, placeholders and package drift", async (t) => {
  await t.test("duplicate key", (child) => {
    const { root } = makeFixture(child);
    const target = path.join(root, ...IDENTITY_RELATIVE.split("/"));
    const text = fs.readFileSync(target, "utf8").replace(
      '  "schema_version": "1.0",',
      '  "schema_version": "1.0",\n  "schema_version": "1.0",',
    );
    fs.writeFileSync(target, text);
    assert.throws(() => verifyReleaseIdentity({ identityRoot: root, packageRoot: root, platform: "win32" }),
      /重复字段 schema_version/u);
  });

  await t.test("unknown field", (child) => {
    const { root, identity } = makeFixture(child);
    identity.unreviewed_extension = true;
    writeJson(root, IDENTITY_RELATIVE, identity);
    assert.throws(() => verifyReleaseIdentity({ identityRoot: root, packageRoot: root, platform: "win32" }),
      /字段或顺序必须精确/u);
  });

  await t.test("placeholder", (child) => {
    const { root, identity } = makeFixture(child);
    identity.legal_seller_name = "TBD";
    writeJson(root, IDENTITY_RELATIVE, identity);
    assert.throws(() => verifyReleaseIdentity({ identityRoot: root, packageRoot: root, platform: "win32" }),
      /不得使用占位文本/u);
  });

  await t.test("package drift", (child) => {
    const { root } = makeFixture(child);
    const packageTarget = path.join(root, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageTarget, "utf8"));
    packageJson.build.appId = "com.example.changed";
    fs.writeFileSync(packageTarget, `${JSON.stringify(packageJson, null, 2)}\n`);
    assert.throws(() => verifyReleaseIdentity({ identityRoot: root, packageRoot: root, platform: "win32" }),
      /build\.appId 与身份文件不一致/u);
  });

  await t.test("packaged identity marker drift", (child) => {
    const { root } = makeFixture(child);
    const packageTarget = path.join(root, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageTarget, "utf8"));
    packageJson.build.extraMetadata.oakReleaseIdentity.app_id = "com.example.changed";
    fs.writeFileSync(packageTarget, `${JSON.stringify(packageJson, null, 2)}\n`);
    assert.throws(() => verifyReleaseIdentity({ identityRoot: root, packageRoot: root, platform: "win32" }),
      /oakReleaseIdentity\.app_id 与身份文件不一致/u);
  });
});

test("identity verifier rejects schema mutation and noncanonical identity bytes", async (t) => {
  await t.test("schema hash", (child) => {
    const { root } = makeFixture(child);
    fs.appendFileSync(path.join(root, ...SCHEMA_RELATIVE.split("/")), " ");
    assert.throws(() => verifyReleaseIdentity({ identityRoot: root, packageRoot: root, platform: "win32" }),
      /不是规范 JSON 字节|固定摘要不一致/u);
  });
  await t.test("identity canonical bytes", (child) => {
    const { root } = makeFixture(child);
    const target = path.join(root, ...IDENTITY_RELATIVE.split("/"));
    fs.writeFileSync(target, fs.readFileSync(target, "utf8").replace(/\n$/u, ""));
    assert.throws(() => verifyReleaseIdentity({ identityRoot: root, packageRoot: root, platform: "win32" }),
      /不是规范 JSON 字节/u);
  });
});

test("identity CLI parser accepts only an explicit supported argument shape", () => {
  assert.deepEqual(parseArgs(["--platform", "win32"]), { platform: "win32" });
  assert.throws(() => parseArgs(["--update"]), /未知或不完整参数/u);
  assert.throws(() => parseArgs(["--platform"]), /未知或不完整参数/u);
});
