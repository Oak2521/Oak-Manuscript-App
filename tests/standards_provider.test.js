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
const LEGACY_MANIFEST_SHA256 =
  "d33534f081b2122a90652ee03304a0e71177a7fd0d3130fffe77b0fea807d7af";
const LEGACY_FIXTURE = path.join(ROOT, "tests", "fixtures", "standards-v1");

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
    appVersion: options.appVersion || "0.1.0-alpha.5",
    bundledRelease: options.bundledRelease || BUNDLED_STANDARD_RELEASE,
    ...(options.fsImpl ? { fsImpl: options.fsImpl } : {}),
    ...(options.storeClass ? { storeClass: options.storeClass } : {}),
    ...(options.updateClient ? { updateClient: options.updateClient } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.planIdFactory ? { planIdFactory: options.planIdFactory } : {}),
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
      schema_version: "1.1",
      kind: "oak-standards-trust-store",
      keys: { [keyid]: { alg: "ed25519", spki_der_b64: der.toString("base64") } },
      roles: {
        release: { threshold: 1, keyids: [keyid] },
        revocation: { threshold: 1, keyids: [keyid] },
      },
    },
  };
}

function revocationEnvelope(signing, revokedManifestSha256s, overrides = {}) {
  const payloadBytes = Buffer.from(canonicalJson({
    schema_version: "1.0",
    kind: "oak-standards-revocation-list",
    bundle_id: "oak-standards",
    issued_at: overrides.issuedAt || "2026-07-29T00:00:00Z",
    expires_at: overrides.expiresAt || "2026-08-29T00:00:00Z",
    revoked_manifest_sha256s: [...revokedManifestSha256s].sort(),
  }), "utf8");
  return Buffer.from(canonicalJson({
    schema_version: "1.0",
    kind: "oak-standards-revocation-envelope",
    payload_b64: payloadBytes.toString("base64"),
    signatures: [{
      keyid: signing.keyid,
      alg: "ed25519",
      sig_b64: crypto.sign(null, payloadBytes, signing.privateKey).toString("base64"),
    }],
  }), "utf8");
}

function updateEnvelope(privateKey, keyid) {
  const standards = JSON.parse(fs.readFileSync(path.join(CONFIG, "standards.json"), "utf8"));
  const rulepack = JSON.parse(fs.readFileSync(
    path.join(CONFIG, BUNDLED_STANDARD_RELEASE.rulepackRelative), "utf8",
  ));
  standards.registry_version = "2.0.1";
  standards.updated_at = "2026-07-27";
  rulepack.pack_version = "2.0.1";
  rulepack.frozen_at = "2026-07-27";
  rulepack.citation_default_mapping.version = "2.0.1";
  const standardsBytes = Buffer.from(`${JSON.stringify(standards, null, 2)}\n`, "utf8");
  const rulepackBytes = Buffer.from(`${JSON.stringify(rulepack, null, 2)}\n`, "utf8");
  const capabilityBytes = fs.readFileSync(path.join(CONFIG, "rule-capabilities.json"));
  const manifest = {
    schema_version: "1.0",
    kind: "oak-standard-release",
    bundle_id: "oak-standards",
    release_sequence: 3,
    version: "2.0.1",
    channel: "stable",
    released_at: "2026-07-27T00:00:00Z",
    expires_at: null,
    min_app: "0.1.0-alpha.5",
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
      version: "2.0.1",
      sha256: sha256(rulepackBytes),
      capability_set_sha256: sha256(capabilityBytes),
    },
    rollback_target: {
      manifest_sha256: BUNDLED_STANDARD_RELEASE.manifestSha256,
      release_sequence: 2,
    },
    change_summary: ["测试签名标准包 2.0.1。"],
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

function writeLegacyBundledConfig(t) {
  const configDir = tempRoot(t, "standards-provider-v1-config-");
  fs.mkdirSync(path.join(configDir, "standard-packs"), { recursive: true });
  fs.mkdirSync(path.join(configDir, "rule-packs"), { recursive: true });
  fs.copyFileSync(
    path.join(LEGACY_FIXTURE, "standards.json"),
    path.join(configDir, "standards.json"),
  );
  fs.copyFileSync(
    path.join(LEGACY_FIXTURE, "oak-standards-1.0.0.manifest.json"),
    path.join(configDir, "standard-packs", "oak-standards-1.0.0.manifest.json"),
  );
  fs.copyFileSync(
    path.join(CONFIG, "rule-packs", "oak-rules-1.0.0.json"),
    path.join(configDir, "rule-packs", "oak-rules-1.0.0.json"),
  );
  fs.copyFileSync(
    path.join(CONFIG, "rule-capabilities.json"),
    path.join(configDir, "rule-capabilities.json"),
  );
  const manifestRelative = "standard-packs/oak-standards-1.0.0.manifest.json";
  const manifestBytes = fs.readFileSync(path.join(configDir, manifestRelative));
  assert.equal(sha256(manifestBytes), LEGACY_MANIFEST_SHA256);
  return {
    configDir,
    release: {
      ...BUNDLED_STANDARD_RELEASE,
      releaseSequence: 1,
      version: "1.0.0",
      manifestSha256: LEGACY_MANIFEST_SHA256,
      historicalManifestSha256s: [],
      manifestRelative,
      standardsRelative: "standards.json",
      rulepackRelative: "rule-packs/oak-rules-1.0.0.json",
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
  assert.equal(listing.release.release_sequence, 2);
  const currentManifest = JSON.parse(fs.readFileSync(
    path.join(CONFIG, BUNDLED_STANDARD_RELEASE.manifestRelative),
    "utf8",
  ));
  const identity = await provider.verifiedActiveIdentity();
  assert.deepEqual(identity, {
    name: "oak-rules",
    version: "2.0.0",
    pinned: true,
    sha256: currentManifest.rulepack.sha256,
    bundle_id: "oak-standards",
    release_sequence: 2,
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
  assert.equal(status.active.release_sequence, 2);
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
  const legacy = writeLegacyBundledConfig(t);
  const first = createProvider(t, {
    rootDir: storeRoot,
    configDir: legacy.configDir,
    bundledRelease: legacy.release,
    trustStore: null,
  });
  await first.initialize();
  const v1Identity = await first.verifiedActiveIdentity();
  assert.equal(v1Identity.manifest_sha256, LEGACY_MANIFEST_SHA256);
  assert.ok(BUNDLED_STANDARD_RELEASE.historicalManifestSha256s.includes(
    LEGACY_MANIFEST_SHA256,
  ));
  const second = createProvider(t, {
    rootDir: storeRoot,
    trustStore: null,
  });

  const status = await second.initialize();
  assert.equal(status.active.release_sequence, 2);
  assert.equal(status.active.manifest_sha256, BUNDLED_STANDARD_RELEASE.manifestSha256);
  assert.equal(status.previous.manifest_sha256, LEGACY_MANIFEST_SHA256);
  assert.deepEqual(await second.verifyReleaseIdentity(v1Identity), v1Identity);
  assert.equal((await second.listStandards()).registry_version, "2.0.0");

  const reopened = createProvider(t, {
    rootDir: storeRoot,
    trustStore: null,
  });
  assert.equal((await reopened.initialize()).active.release_sequence, 2);
  assert.deepEqual(await reopened.verifyReleaseIdentity(v1Identity), v1Identity);
});

test("provider rejects a bundled manifest whose bytes do not match the code-fixed digest", async (t) => {
  const fixture = tempRoot(t, "standards-provider-config-");
  fs.cpSync(CONFIG, fixture, { recursive: true });
  const manifestPath = path.join(fixture, BUNDLED_STANDARD_RELEASE.manifestRelative);
  fs.appendFileSync(manifestPath, " ");
  const provider = createProvider(t, { configDir: fixture });
  await assert.rejects(provider.initialize(), /代码固定摘要不一致/);
  assert.equal(provider.status().ready, false);
  assert.equal(provider.status().error.code, "BUNDLED_TRUST_MISMATCH");
});

test("provider installs a local signed release and explicitly rolls global active back", async (t) => {
  const signing = signingFixture();
  const storeRoot = tempRoot(t, "standards-provider-signed-chain-");
  const legacy = writeLegacyBundledConfig(t);
  const legacyProvider = createProvider(t, {
    rootDir: storeRoot,
    configDir: legacy.configDir,
    bundledRelease: legacy.release,
    trustStore: null,
  });
  await legacyProvider.initialize();
  const provider = createProvider(t, { rootDir: storeRoot, trustStore: signing.trustStore });
  await provider.initialize();
  const packagePath = path.join(tempRoot(t, "standards-package-"), "update.oakstd");
  fs.writeFileSync(packagePath, updateEnvelope(signing.privateKey, signing.keyid));

  const preview = await provider.previewPackage(packagePath);
  assert.equal(preview.release_sequence, 3);
  assert.equal(preview.expected_active_manifest_sha256,
    BUNDLED_STANDARD_RELEASE.manifestSha256);
  const installed = await provider.importPackage(packagePath, preview);
  assert.equal(installed.active.release_sequence, 3);
  assert.equal(installed.active.source, "installed");
  assert.equal(installed.previous.release_sequence, 2);
  assert.deepEqual(installed.change_summary, ["测试签名标准包 2.0.1。"]);
  assert.equal((await provider.listStandards()).registry_version, "2.0.1");

  const rollbackPreview = await provider.previewRollback();
  assert.equal(rollbackPreview.target.release_sequence, 2);
  const rolledBack = await provider.rollback(rollbackPreview);
  assert.equal(rolledBack.active.release_sequence, 2);
  assert.equal(rolledBack.previous.release_sequence, 1);
  const status = provider.status();
  assert.equal(status.highest_seen_sequence, 3);
  assert.equal((await provider.listStandards()).registry_version, "2.0.0");
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

test("explicit remote check verifies signed bytes before an opaque one-shot install plan", async (t) => {
  const signing = signingFixture();
  const envelopeBytes = updateEnvelope(signing.privateKey, signing.keyid);
  const calls = [];
  const provider = createProvider(t, {
    trustStore: signing.trustStore,
    updateClient: {
      async check(input) {
        calls.push(input);
        return { outcome: "update", envelopeBytes };
      },
    },
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
    planIdFactory: () => "40000000-0000-4000-8000-000000000004",
  });
  await provider.initialize();
  const before = await provider.verifiedActiveIdentity();
  assert.equal(provider.status().network_updates_enabled, true);

  const preview = await provider.checkForRemoteUpdate();
  assert.equal(preview.outcome, "update_available");
  assert.equal(preview.plan_id, "40000000-0000-4000-8000-000000000004");
  assert.equal(preview.release_sequence, 3);
  assert.equal(preview.expected_active_manifest_sha256, before.manifest_sha256);
  assert.equal((await provider.verifiedActiveIdentity()).release_sequence, 2, "preview must not install");
  assert.deepEqual(calls, [{
    appVersion: "0.1.0-alpha.5",
    bundleId: "oak-standards",
    currentReleaseSequence: 2,
    currentManifestSha256: before.manifest_sha256,
  }]);

  const installed = await provider.installRemoteUpdate(preview.plan_id);
  assert.equal(installed.active.release_sequence, 3);
  assert.equal(installed.previous.release_sequence, 2);
  assert.deepEqual(await provider.verifyReleaseIdentity(before), before, "existing project pin remains verifiable");
  await assert.rejects(
    () => provider.installRemoteUpdate(preview.plan_id),
    (error) => error && error.code === "STANDARD_UPDATE_PLAN_STALE",
  );
});

test("signed revocation of the active release blocks new work but preserves history and permits a safe forward recovery", async (t) => {
  const signing = signingFixture();
  const envelopeBytes = updateEnvelope(signing.privateKey, signing.keyid);
  const provider = createProvider(t, {
    trustStore: signing.trustStore,
    updateClient: { async check() { return { outcome: "update", envelopeBytes }; } },
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
    planIdFactory: () => "41000000-0000-4000-8000-000000000004",
  });
  await provider.initialize();
  const historicalIdentity = await provider.verifiedActiveIdentity();
  const projectRoot = tempRoot(t, "revoked-standard-history-");
  const reportPath = path.join(projectRoot, "reports", "check.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, canonicalJson({
    standard_release: historicalIdentity,
    outcome: "historical",
  }));
  const reportBefore = fs.readFileSync(reportPath);

  const applied = await provider.applyRevocationEnvelope(revocationEnvelope(
    signing,
    [historicalIdentity.manifest_sha256],
  ));
  assert.equal(applied.active_revoked, true);
  assert.equal(provider.status().ready, false);
  await assert.rejects(
    () => provider.verifiedActiveIdentity(),
    (error) => error && error.code === "REVOKED_PACKAGE",
  );
  assert.deepEqual(
    await provider.verifyReleaseIdentity(historicalIdentity, { allowMigrationSource: true }),
    historicalIdentity,
  );
  assert.deepEqual(fs.readFileSync(reportPath), reportBefore);

  const preview = await provider.checkForRemoteUpdate();
  const installed = await provider.installRemoteUpdate(preview.plan_id);
  assert.equal(installed.active.release_sequence, 3);
  assert.equal(provider.status().ready, true);
  await assert.rejects(
    () => provider.rollback(),
    (error) => error && error.code === "REVOKED_PACKAGE",
  );
  assert.deepEqual(fs.readFileSync(reportPath), reportBefore);
});

test("remote update preview rejects a candidate already present in the signed revocation set", async (t) => {
  const signing = signingFixture();
  const envelopeBytes = updateEnvelope(signing.privateKey, signing.keyid);
  const parsed = JSON.parse(envelopeBytes.toString("utf8"));
  const candidateDigest = sha256(Buffer.from(parsed.manifest_b64, "base64"));
  const provider = createProvider(t, {
    trustStore: signing.trustStore,
    updateClient: { async check() { return { outcome: "update", envelopeBytes }; } },
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
  });
  await provider.initialize();
  const applied = await provider.applyRevocationEnvelope(revocationEnvelope(
    signing,
    [candidateDigest],
  ));
  assert.equal(applied.active_revoked, false);
  await assert.rejects(
    () => provider.checkForRemoteUpdate(),
    (error) => error && error.code === "REVOKED_PACKAGE",
  );
});

test("a revocation applied while the update response is in flight wins before preview creation", async (t) => {
  const signing = signingFixture();
  const envelopeBytes = updateEnvelope(signing.privateKey, signing.keyid);
  const parsed = JSON.parse(envelopeBytes.toString("utf8"));
  const candidateDigest = sha256(Buffer.from(parsed.manifest_b64, "base64"));
  let releaseResponse;
  let markEntered;
  const held = new Promise((resolve) => { releaseResponse = resolve; });
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const provider = createProvider(t, {
    trustStore: signing.trustStore,
    updateClient: {
      async check() {
        markEntered();
        await held;
        return { outcome: "update", envelopeBytes };
      },
    },
    clock: () => new Date("2026-07-29T12:00:00.000Z"),
  });
  await provider.initialize();
  const checking = provider.checkForRemoteUpdate();
  await entered;
  await provider.applyRevocationEnvelope(revocationEnvelope(signing, [candidateDigest]));
  releaseResponse();
  await assert.rejects(
    checking,
    (error) => error && error.code === "REVOKED_PACKAGE",
  );
});

test("remote update stays disabled without trust/transport and current or invalid candidates never create a plan", async (t) => {
  const offline = createProvider(t, { trustStore: null });
  await offline.initialize();
  assert.equal(offline.status().network_updates_enabled, false);
  await assert.rejects(
    () => offline.checkForRemoteUpdate(),
    (error) => error && error.code === "STANDARD_UPDATE_NETWORK_DISABLED",
  );

  const signing = signingFixture();
  const current = createProvider(t, {
    trustStore: signing.trustStore,
    updateClient: { async check() { return { outcome: "current" }; } },
  });
  await current.initialize();
  assert.deepEqual(await current.checkForRemoteUpdate(), {
    outcome: "current",
    active: current.status().active,
  });

  const invalid = createProvider(t, {
    trustStore: signing.trustStore,
    updateClient: { async check() { return { outcome: "update", envelopeBytes: Buffer.from("{}") }; } },
  });
  await invalid.initialize();
  await assert.rejects(() => invalid.checkForRemoteUpdate(), /envelope|标准更新|结构|canonical/i);
  await assert.rejects(
    () => invalid.installRemoteUpdate("40000000-0000-4000-8000-000000000004"),
    (error) => error && error.code === "STANDARD_UPDATE_PLAN_STALE",
  );
});

test("remote update plans expire, are consumed on failure, and concurrent checks fail closed", async (t) => {
  const signing = signingFixture();
  const envelopeBytes = updateEnvelope(signing.privateKey, signing.keyid);
  let now = new Date("2026-07-29T12:00:00.000Z");
  const expiring = createProvider(t, {
    trustStore: signing.trustStore,
    updateClient: { async check() { return { outcome: "update", envelopeBytes }; } },
    clock: () => now,
    planIdFactory: () => "50000000-0000-4000-8000-000000000005",
  });
  await expiring.initialize();
  const preview = await expiring.checkForRemoteUpdate();
  now = new Date("2026-07-29T12:10:00.001Z");
  await assert.rejects(
    () => expiring.installRemoteUpdate(preview.plan_id),
    (error) => error && error.code === "STANDARD_UPDATE_PLAN_STALE",
  );
  await assert.rejects(
    () => expiring.installRemoteUpdate(preview.plan_id),
    (error) => error && error.code === "STANDARD_UPDATE_PLAN_STALE",
  );

  let releaseCheck;
  let enteredCheck;
  const entered = new Promise((resolve) => { enteredCheck = resolve; });
  const held = new Promise((resolve) => { releaseCheck = resolve; });
  const concurrent = createProvider(t, {
    trustStore: signing.trustStore,
    updateClient: {
      async check() {
        enteredCheck();
        await held;
        return { outcome: "current" };
      },
    },
  });
  await concurrent.initialize();
  const first = concurrent.checkForRemoteUpdate();
  await entered;
  await assert.rejects(
    () => concurrent.checkForRemoteUpdate(),
    (error) => error && error.code === "STANDARD_UPDATE_BUSY",
  );
  releaseCheck();
  assert.equal((await first).outcome, "current");
});

test("canceling a remote update immediately destroys its one-shot plan", async (t) => {
  const signing = signingFixture();
  const provider = createProvider(t, {
    trustStore: signing.trustStore,
    updateClient: {
      async check() {
        return { outcome: "update", envelopeBytes: updateEnvelope(signing.privateKey, signing.keyid) };
      },
    },
    planIdFactory: () => "60000000-0000-4000-8000-000000000006",
  });
  await provider.initialize();
  const preview = await provider.checkForRemoteUpdate();
  assert.deepEqual(provider.cancelRemoteUpdate(preview.plan_id), { canceled: true });
  await assert.rejects(
    () => provider.installRemoteUpdate(preview.plan_id),
    (error) => error && error.code === "STANDARD_UPDATE_PLAN_STALE",
  );
});
