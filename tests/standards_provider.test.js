"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  BUNDLED_STANDARD_RELEASE,
  StandardsProvider,
} = require("../electron/standards-provider");
const { canonicalJson, sha256 } = require("../electron/standards-store");

const ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(ROOT, "config");

function tempRoot(t, prefix) {
  const parent = path.join(ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createProvider(t, options = {}) {
  const rootDir = options.rootDir || tempRoot(t, "standards-provider-");
  const providerOptions = {
    rootDir,
    configDir: options.configDir || CONFIG,
    appVersion: options.appVersion || "0.1.0-alpha.2",
    bundledRelease: options.bundledRelease || BUNDLED_STANDARD_RELEASE,
    ...(options.fsImpl ? { fsImpl: options.fsImpl } : {}),
    ...(options.storeClass ? { storeClass: options.storeClass } : {}),
  };
  if (Object.hasOwn(options, "trustStore")) providerOptions.trustStore = options.trustStore;
  return new StandardsProvider(providerOptions);
}

function signingFixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const keyid = sha256(der);
  return {
    privateKey,
    keyid,
    trustStore: {
      schema_version: "1.0",
      kind: "oak-standards-trust-store",
      keys: { [keyid]: { alg: "ed25519", spki_der_b64: der.toString("base64") } },
      roles: { release: { threshold: 1, keyids: [keyid] } },
    },
  };
}

function updateEnvelope(privateKey, keyid) {
  const standards = JSON.parse(fs.readFileSync(path.join(CONFIG, "standards.json"), "utf8"));
  const rulepack = JSON.parse(fs.readFileSync(
    path.join(CONFIG, "rule-packs", "oak-rules-1.0.0.json"), "utf8",
  ));
  standards.registry_version = "1.0.1";
  standards.updated_at = "2026-07-27";
  rulepack.pack_version = "1.0.1";
  rulepack.frozen_at = "2026-07-27";
  const standardsBytes = Buffer.from(`${JSON.stringify(standards, null, 2)}\n`, "utf8");
  const rulepackBytes = Buffer.from(`${JSON.stringify(rulepack, null, 2)}\n`, "utf8");
  const capabilityBytes = fs.readFileSync(path.join(CONFIG, "rule-capabilities.json"));
  const manifest = {
    schema_version: "1.0",
    kind: "oak-standard-release",
    bundle_id: "oak-standards",
    release_sequence: 2,
    version: "1.0.1",
    channel: "stable",
    released_at: "2026-07-27T00:00:00Z",
    expires_at: null,
    min_app: "0.1.0-alpha.2",
    max_app_exclusive: "0.2.0",
    signing_role: "release",
    files: [
      {
        path: "standards.json",
        size_bytes: standardsBytes.length,
        sha256: sha256(standardsBytes),
        media_type: "application/json",
      },
      {
        path: "rulepack.json",
        size_bytes: rulepackBytes.length,
        sha256: sha256(rulepackBytes),
        media_type: "application/json",
      },
    ],
    rulepack: {
      name: "oak-rules",
      version: "1.0.1",
      sha256: sha256(rulepackBytes),
      capability_set_sha256: sha256(capabilityBytes),
    },
    rollback_target: {
      manifest_sha256: BUNDLED_STANDARD_RELEASE.manifestSha256,
      release_sequence: 1,
    },
    change_summary: ["测试签名标准包 1.0.1。"],
  };
  const manifestBytes = Buffer.from(canonicalJson(manifest), "utf8");
  const signature = crypto.sign(null, manifestBytes, privateKey);
  return Buffer.from(JSON.stringify({
    schema_version: "1.0",
    kind: "oak-standards-envelope",
    manifest_b64: manifestBytes.toString("base64"),
    signatures: [{ keyid, alg: "ed25519", sig_b64: signature.toString("base64") }],
    files: [
      { path: "standards.json", payload_b64: standardsBytes.toString("base64") },
      { path: "rulepack.json", payload_b64: rulepackBytes.toString("base64") },
    ],
  }), "utf8");
}

function writeBundledUpgrade(t) {
  const configDir = tempRoot(t, "standards-provider-v2-config-");
  fs.cpSync(CONFIG, configDir, { recursive: true });
  const standards = JSON.parse(fs.readFileSync(path.join(configDir, "standards.json"), "utf8"));
  const rulepack = JSON.parse(fs.readFileSync(
    path.join(configDir, "rule-packs", "oak-rules-1.0.0.json"),
    "utf8",
  ));
  standards.registry_version = "1.1.0";
  standards.updated_at = "2026-07-27";
  rulepack.pack_version = "1.1.0";
  rulepack.frozen_at = "2026-07-27";
  rulepack.citation_default_mapping.version = "1.1.0";
  const standardsBytes = Buffer.from(`${JSON.stringify(standards, null, 2)}\n`, "utf8");
  const rulepackBytes = Buffer.from(`${JSON.stringify(rulepack, null, 2)}\n`, "utf8");
  const capabilityBytes = fs.readFileSync(path.join(configDir, "rule-capabilities.json"));
  const manifest = {
    schema_version: "1.0",
    kind: "oak-standard-release",
    bundle_id: "oak-standards",
    release_sequence: 2,
    version: "1.1.0",
    channel: "stable",
    released_at: "2026-07-27T00:00:00Z",
    expires_at: null,
    min_app: "0.1.0-alpha.2",
    max_app_exclusive: "0.2.0",
    signing_role: "bundled",
    files: [
      {
        path: "standards.json",
        size_bytes: standardsBytes.length,
        sha256: sha256(standardsBytes),
        media_type: "application/json",
      },
      {
        path: "rulepack.json",
        size_bytes: rulepackBytes.length,
        sha256: sha256(rulepackBytes),
        media_type: "application/json",
      },
    ],
    rulepack: {
      name: "oak-rules",
      version: "1.1.0",
      sha256: sha256(rulepackBytes),
      capability_set_sha256: sha256(capabilityBytes),
    },
    rollback_target: {
      manifest_sha256: BUNDLED_STANDARD_RELEASE.manifestSha256,
      release_sequence: 1,
    },
    change_summary: ["APP 内置标准升级到 1.1.0。"],
  };
  const manifestBytes = Buffer.from(canonicalJson(manifest), "utf8");
  const manifestRelative = "standard-packs/oak-standards-1.1.0.manifest.json";
  const standardsRelative = "standards-v1.1.0.json";
  const rulepackRelative = "rule-packs/oak-rules-1.1.0.json";
  fs.writeFileSync(path.join(configDir, manifestRelative), manifestBytes);
  fs.writeFileSync(path.join(configDir, standardsRelative), standardsBytes);
  fs.writeFileSync(path.join(configDir, rulepackRelative), rulepackBytes);
  return {
    configDir,
    manifest,
    release: {
      ...BUNDLED_STANDARD_RELEASE,
      releaseSequence: 2,
      version: "1.1.0",
      manifestSha256: sha256(manifestBytes),
      historicalManifestSha256s: [BUNDLED_STANDARD_RELEASE.manifestSha256],
      manifestRelative,
      standardsRelative,
      rulepackRelative,
    },
  };
}

test("provider bootstraps and verifies the digest-anchored bundled release without a trust root", async (t) => {
  const provider = createProvider(t);
  const status = await provider.initialize();
  assert.equal(status.ready, true);
  assert.equal(status.active.manifest_sha256, BUNDLED_STANDARD_RELEASE.manifestSha256);
  assert.equal(status.active.source, "bundled");
  assert.equal(status.trust_configured, false);
  assert.equal(status.local_signed_import_enabled, false);
  assert.equal(status.network_updates_enabled, false);

  const listing = await provider.listStandards();
  assert.equal(listing.standards.length, 13);
  assert.equal(listing.release.release_sequence, 1);
  const identity = await provider.verifiedActiveIdentity();
  assert.deepEqual(identity, {
    name: "oak-rules",
    version: "1.0.0",
    pinned: true,
    sha256: listing.release.rulepack_version === "1.0.0"
      ? JSON.parse(fs.readFileSync(path.join(CONFIG, "standard-packs", "oak-standards-1.0.0.manifest.json"), "utf8")).rulepack.sha256
      : null,
    bundle_id: "oak-standards",
    release_sequence: 1,
    manifest_sha256: BUNDLED_STANDARD_RELEASE.manifestSha256,
  });
  assert.deepEqual(await provider.verifyReleaseIdentity(identity), identity);
  await assert.rejects(provider.importPackage(path.join(ROOT, "fixture.oakstd")),
    /签名公钥尚未配置/);
});

test("provider reopens an existing CAS and re-verifies active bytes", async (t) => {
  const storeRoot = tempRoot(t, "standards-provider-reopen-");
  const first = createProvider(t, { rootDir: storeRoot });
  await first.initialize();
  const second = createProvider(t, { rootDir: storeRoot });
  const status = await second.initialize();
  assert.equal(status.ready, true);
  assert.equal(status.active.release_sequence, 1);
});

test("provider constructor defers all asset reads and reports initialization failure through status", async (t) => {
  const missingConfig = tempRoot(t, "standards-provider-missing-config-");
  const provider = createProvider(t, { configDir: missingConfig });
  assert.equal(provider.status().ready, false);
  assert.equal(provider.status().error, null);
  await assert.rejects(
    () => provider.initialize(),
    (error) => error && error.code === "FILE_UNAVAILABLE",
  );
  assert.equal(provider.status().ready, false);
  assert.equal(provider.status().error.code, "FILE_UNAVAILABLE");
});

test("on-disk trust root is rejected unless its raw digest is code-pinned", async (t) => {
  const signing = signingFixture();
  const configDir = tempRoot(t, "standards-provider-trust-config-");
  fs.cpSync(CONFIG, configDir, { recursive: true });
  const trustBytes = Buffer.from(canonicalJson(signing.trustStore), "utf8");
  fs.writeFileSync(path.join(configDir, BUNDLED_STANDARD_RELEASE.trustRelative), trustBytes);

  const unpinned = createProvider(t, { configDir });
  await assert.rejects(
    () => unpinned.initialize(),
    (error) => error && error.code === "TRUST_ROOT_UNPINNED",
  );
  assert.equal(unpinned.status().local_signed_import_enabled, false);

  const pinned = createProvider(t, {
    configDir,
    bundledRelease: {
      ...BUNDLED_STANDARD_RELEASE,
      trustSha256: sha256(trustBytes),
    },
  });
  const status = await pinned.initialize();
  assert.equal(status.ready, true);
  assert.equal(status.trust_configured, true);
  assert.equal(status.local_signed_import_enabled, true);
});

test("provider initializes a newer bundled release and preserves/verifies historical CAS", async (t) => {
  const storeRoot = tempRoot(t, "standards-provider-v1-v2-store-");
  const first = createProvider(t, { rootDir: storeRoot, trustStore: null });
  await first.initialize();
  const v1Identity = await first.verifiedActiveIdentity();
  const upgrade = writeBundledUpgrade(t);
  const second = createProvider(t, {
    rootDir: storeRoot,
    configDir: upgrade.configDir,
    bundledRelease: upgrade.release,
    trustStore: null,
  });

  const status = await second.initialize();
  assert.equal(status.active.release_sequence, 2);
  assert.equal(status.active.manifest_sha256, upgrade.release.manifestSha256);
  assert.equal(status.previous.manifest_sha256, BUNDLED_STANDARD_RELEASE.manifestSha256);
  assert.deepEqual(await second.verifyReleaseIdentity(v1Identity), v1Identity);
  assert.equal((await second.listStandards()).registry_version, "1.1.0");

  const reopened = createProvider(t, {
    rootDir: storeRoot,
    configDir: upgrade.configDir,
    bundledRelease: upgrade.release,
    trustStore: null,
  });
  assert.equal((await reopened.initialize()).active.release_sequence, 2);
  assert.deepEqual(await reopened.verifyReleaseIdentity(v1Identity), v1Identity);
});

test("provider rejects a bundled manifest whose bytes do not match the code-fixed digest", async (t) => {
  const fixture = tempRoot(t, "standards-provider-config-");
  fs.cpSync(CONFIG, fixture, { recursive: true });
  const manifestPath = path.join(fixture, "standard-packs", "oak-standards-1.0.0.manifest.json");
  fs.appendFileSync(manifestPath, " ");
  const provider = createProvider(t, { configDir: fixture });
  await assert.rejects(provider.initialize(), /代码固定摘要不一致/);
  assert.equal(provider.status().ready, false);
  assert.equal(provider.status().error.code, "BUNDLED_TRUST_MISMATCH");
});

test("provider installs a local signed release and explicitly rolls global active back", async (t) => {
  const signing = signingFixture();
  const provider = createProvider(t, { trustStore: signing.trustStore });
  await provider.initialize();
  const packagePath = path.join(tempRoot(t, "standards-package-"), "update.oakstd");
  fs.writeFileSync(packagePath, updateEnvelope(signing.privateKey, signing.keyid));

  const preview = await provider.previewPackage(packagePath);
  assert.equal(preview.release_sequence, 2);
  assert.equal(preview.expected_active_manifest_sha256,
    BUNDLED_STANDARD_RELEASE.manifestSha256);
  const installed = await provider.importPackage(packagePath, preview);
  assert.equal(installed.active.release_sequence, 2);
  assert.equal(installed.active.source, "installed");
  assert.equal(installed.previous.release_sequence, 1);
  assert.deepEqual(installed.change_summary, ["测试签名标准包 1.0.1。"]);
  assert.equal((await provider.listStandards()).registry_version, "1.0.1");

  const rollbackPreview = await provider.previewRollback();
  assert.equal(rollbackPreview.target.release_sequence, 1);
  const rolledBack = await provider.rollback(rollbackPreview);
  assert.equal(rolledBack.active.release_sequence, 1);
  assert.equal(rolledBack.previous, null);
  const status = provider.status();
  assert.equal(status.highest_seen_sequence, 2);
  assert.equal((await provider.listStandards()).registry_version, "1.0.0");
});

test("provider rejects linked or incorrectly named local update files", async (t) => {
  const signing = signingFixture();
  const provider = createProvider(t, { trustStore: signing.trustStore });
  await provider.initialize();
  const parent = tempRoot(t, "standards-package-path-");
  const wrong = path.join(parent, "update.json");
  fs.writeFileSync(wrong, updateEnvelope(signing.privateKey, signing.keyid));
  await assert.rejects(provider.importPackage(wrong), /\.oakstd/);

  const linked = path.join(parent, "linked.oakstd");
  try {
    fs.symlinkSync(wrong, linked, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`当前主机不能创建测试链接：${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(provider.importPackage(linked), /单链接普通文件/);
});
