"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ENVELOPE_KIND,
  ENVELOPE_SCHEMA_VERSION,
  MANIFEST_KIND,
  PACKAGE_FILES,
  StandardsStore,
  TRUST_KIND,
  TRUST_SCHEMA_VERSION,
  canonicalJson,
  compareSemver,
  sha256,
} = require("../electron/standards-store");
const {
  loadAndValidateAssets,
  verifyStandardAssets,
} = require("../scripts/standard_assets");

const APP_VERSION = require("../package.json").version;
const REPO_ROOT = path.resolve(__dirname, "..");
const NOW = new Date("2026-07-28T00:00:00.000Z");
const CAPABILITY_SET_SHA256 = sha256(Buffer.from(
  '{"capabilities":[],"pack_name":"oak-rules","schema_version":"1.0"}\n',
));

function signer() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  return {
    privateKey,
    keyid: sha256(der),
    spkiDerB64: der.toString("base64"),
  };
}

function makeTrust(signers, threshold = signers.length) {
  return {
    schema_version: TRUST_SCHEMA_VERSION,
    kind: TRUST_KIND,
    keys: Object.fromEntries(signers.map((item) => [item.keyid, {
      alg: "ed25519",
      spki_der_b64: item.spkiDerB64,
    }])),
    roles: {
      release: {
        threshold,
        keyids: signers.map((item) => item.keyid),
      },
    },
  };
}

function payloads(version) {
  const standardsBytes = Buffer.from(canonicalJson({
    schema_version: "2.0",
    registry_version: version,
    standards: [{ standard_id: "OAK-TEST-001", title: `Test ${version}` }],
  }));
  const rulepackBytes = Buffer.from(canonicalJson({
    pack_name: "oak-rules",
    pack_version: version,
    citation_default_mapping: { version, map: [] },
    rules: [],
  }));
  return { standardsBytes, rulepackBytes };
}

function manifestFor({
  sequence,
  version,
  signingRole,
  payload,
  expiresAt = null,
  rollbackTarget = null,
  changeSummary = [`Release ${version}`],
}) {
  return {
    schema_version: "1.0",
    kind: MANIFEST_KIND,
    bundle_id: "oak-standards",
    release_sequence: sequence,
    version,
    channel: "stable",
    released_at: "2026-07-27T00:00:00Z",
    expires_at: expiresAt,
    min_app: APP_VERSION,
    max_app_exclusive: "0.2.0",
    signing_role: signingRole,
    files: [
      {
        path: "standards.json",
        size_bytes: payload.standardsBytes.length,
        sha256: sha256(payload.standardsBytes),
        media_type: "application/json",
      },
      {
        path: "rulepack.json",
        size_bytes: payload.rulepackBytes.length,
        sha256: sha256(payload.rulepackBytes),
        media_type: "application/json",
      },
    ],
    rulepack: {
      name: "oak-rules",
      version,
      sha256: sha256(payload.rulepackBytes),
      capability_set_sha256: CAPABILITY_SET_SHA256,
    },
    rollback_target: rollbackTarget,
    change_summary: changeSummary,
  };
}

function signedEnvelope({ sequence, version, signers, ...overrides }) {
  const payload = overrides.payload || payloads(version);
  const manifest = manifestFor({
    sequence,
    version,
    signingRole: "release",
    payload,
    expiresAt: overrides.expiresAt,
    rollbackTarget: overrides.rollbackTarget || null,
    changeSummary: overrides.changeSummary,
  });
  const manifestBytes = overrides.manifestBytes || Buffer.from(canonicalJson(manifest));
  const signatures = signers.map((item) => ({
    keyid: item.keyid,
    alg: "ed25519",
    sig_b64: crypto.sign(null, manifestBytes, item.privateKey).toString("base64"),
  }));
  const envelope = {
    schema_version: ENVELOPE_SCHEMA_VERSION,
    kind: ENVELOPE_KIND,
    manifest_b64: manifestBytes.toString("base64"),
    signatures,
    files: [
      { path: "standards.json", payload_b64: payload.standardsBytes.toString("base64") },
      { path: "rulepack.json", payload_b64: payload.rulepackBytes.toString("base64") },
    ],
  };
  return {
    bytes: Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`),
    envelope,
    manifest,
    manifestBytes,
    manifestSha256: sha256(manifestBytes),
    payload,
  };
}

function mutateAndResign(update, signers, mutate) {
  const envelope = JSON.parse(update.bytes.toString("utf8"));
  const manifest = JSON.parse(Buffer.from(envelope.manifest_b64, "base64").toString("utf8"));
  mutate(manifest);
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  envelope.manifest_b64 = manifestBytes.toString("base64");
  envelope.signatures = signers.map((item) => ({
    keyid: item.keyid,
    alg: "ed25519",
    sig_b64: crypto.sign(null, manifestBytes, item.privateKey).toString("base64"),
  }));
  return Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
}

function writeBundledAssets(root, versionOrOptions = "1.0.0") {
  const options = typeof versionOrOptions === "string"
    ? { version: versionOrOptions }
    : versionOrOptions;
  const version = options.version || "1.0.0";
  const sequence = options.sequence || 1;
  const directory = path.join(root, options.directory || `bundled-assets-${sequence}`);
  fs.mkdirSync(directory, { recursive: true });
  const payload = payloads(version);
  const manifest = manifestFor({
    sequence,
    version,
    signingRole: "bundled",
    payload,
    expiresAt: null,
    rollbackTarget: options.rollbackTarget || null,
    changeSummary: options.changeSummary || [`Bundled ${version}`],
  });
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const paths = {
    manifestPath: path.join(directory, "manifest.json"),
    standardsPath: path.join(directory, "standards.json"),
    rulepackPath: path.join(directory, "rulepack.json"),
  };
  fs.writeFileSync(paths.manifestPath, manifestBytes);
  fs.writeFileSync(paths.standardsPath, payload.standardsBytes);
  fs.writeFileSync(paths.rulepackPath, payload.rulepackBytes);
  return { manifest, manifestBytes, manifestSha256: sha256(manifestBytes), paths };
}

function fixture(t, {
  threshold = 2,
  trust = undefined,
  validatePayload = async ({ capabilitySetSha256 }) => {
    assert.equal(capabilitySetSha256, CAPABILITY_SET_SHA256);
  },
  fsImpl = fs,
  bundledManifestSha256s = undefined,
} = {}) {
  const parent = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "oak-standards-store-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const signers = [signer(), signer()];
  const bundled = writeBundledAssets(root);
  const trustStore = trust === undefined ? makeTrust(signers, threshold) : trust;
  const options = {
    rootDir: path.join(root, "store"),
    trustStore,
    appVersion: APP_VERSION,
    validatePayload,
    bundledManifestSha256: bundled.manifestSha256,
    ...(bundledManifestSha256s === undefined ? {} : { bundledManifestSha256s }),
    now: () => NOW,
    fsImpl,
  };
  return {
    root,
    signers,
    bundled,
    options,
    store: new StandardsStore(options),
  };
}

async function bootstrap(item) {
  return item.store.bootstrapBundledFiles(item.bundled.paths);
}

function expectCode(code) {
  return (error) => {
    assert.equal(error && error.code, code, error && error.stack);
    return true;
  };
}

function startFaultingChild(item, update, { stayAlive = false } = {}) {
  const specPath = path.join(item.root, `child-spec-${crypto.randomBytes(8).toString("hex")}.json`);
  const envelopePath = path.join(item.root, `child-update-${crypto.randomBytes(8).toString("hex")}.oakstd`);
  fs.writeFileSync(envelopePath, update.bytes);
  fs.writeFileSync(specPath, JSON.stringify({
    modulePath: path.join(REPO_ROOT, "electron", "standards-store.js"),
    rootDir: item.options.rootDir,
    trustStore: item.options.trustStore,
    appVersion: item.options.appVersion,
    bundledManifestSha256: item.bundled.manifestSha256,
    envelopePath,
    stayAlive,
  }));
  const script = String.raw`
    const fs = require("node:fs");
    const path = require("node:path");
    const spec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const { StandardsStore } = require(spec.modulePath);
    let failStateRename = true;
    const faultFs = new Proxy(fs, {
      get(target, property) {
        if (property === "renameSync") {
          return (source, destination) => {
            if (failStateRename && destination === path.join(spec.rootDir, "active.json") &&
                path.basename(source).startsWith(".active.json.")) {
              failStateRename = false;
              const error = new Error("child injected active state rename failure");
              error.code = "EIO";
              throw error;
            }
            return target.renameSync(source, destination);
          };
        }
        return Reflect.get(target, property);
      },
    });
    const store = new StandardsStore({
      rootDir: spec.rootDir,
      trustStore: spec.trustStore,
      appVersion: spec.appVersion,
      bundledManifestSha256: spec.bundledManifestSha256,
      validatePayload: async () => ({ ok: true }),
      now: () => new Date("2026-07-28T00:00:00.000Z"),
      fsImpl: faultFs,
    });
    store.install(fs.readFileSync(spec.envelopePath)).then(
      () => { console.error("unexpected child install success"); process.exit(20); },
      (error) => {
        if (!String(error && error.message).includes("child injected active state")) {
          console.error(error && error.stack || error);
          process.exit(21);
        }
        if (spec.stayAlive) {
          process.stdout.write("READY\n");
          setInterval(() => {}, 1000);
        } else {
          process.exit(0);
        }
      },
    );
  `;
  return spawn(process.execPath, ["-e", script, specPath], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function waitForReady(child) {
  await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`child readiness timeout: ${stderr}`)), 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.includes("READY\n")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("exit", (code) => {
      if (!stdout.includes("READY\n")) {
        clearTimeout(timer);
        reject(new Error(`child exited before ready (${code}): ${stderr}`));
      }
    });
  });
}

test("the repository's real bundled assets seed the digest-anchored store", async (t) => {
  const root = path.join(REPO_ROOT, "out", "test-tmp");
  fs.mkdirSync(root, { recursive: true });
  const storeRoot = fs.mkdtempSync(path.join(root, "oak-real-standards-store-"));
  t.after(() => fs.rmSync(storeRoot, { recursive: true, force: true }));
  const gate = verifyStandardAssets(REPO_ROOT);
  const assets = loadAndValidateAssets(REPO_ROOT);
  const store = new StandardsStore({
    rootDir: path.join(storeRoot, "store"),
    trustStore: null,
    appVersion: APP_VERSION,
    bundledManifestSha256: gate.manifestSha256,
    now: () => NOW,
    validatePayload: async ({ manifest, standardsBytes, rulepackBytes, capabilitySetSha256 }) => {
      assert.equal(manifest.signing_role, "bundled");
      assert.deepEqual(JSON.parse(standardsBytes.toString("utf8")), assets.standards);
      assert.deepEqual(JSON.parse(rulepackBytes.toString("utf8")), assets.rulepack);
      assert.equal(capabilitySetSha256, sha256(assets.capabilityFile.bytes));
    },
  });
  const state = await store.bootstrapBundledFiles({
    manifestPath: gate.manifestTarget,
    standardsPath: assets.standardsFile.target,
    rulepackPath: assets.rulepackFile.target,
  });
  assert.equal(state.active.manifest_sha256, gate.manifestSha256);
  assert.equal(state.active.source, "bundled");
  assert.equal((await store.verifyActive()).verified.manifest.version, gate.manifest.version);
});

test("digest-anchored bundled assets bootstrap without a release trust root", async (t) => {
  const item = fixture(t, { trust: null });
  const state = await bootstrap(item);

  assert.deepEqual(state, {
    schema_version: "1.0",
    active: {
      bundle_id: "oak-standards",
      release_sequence: 1,
      version: "1.0.0",
      manifest_sha256: item.bundled.manifestSha256,
      source: "bundled",
    },
    previous: null,
    highest_seen_sequence: 1,
    revoked_manifest_sha256s: [],
  });
  assert.deepEqual(
    fs.readdirSync(path.join(item.options.rootDir, "packages", item.bundled.manifestSha256)).sort(),
    [...PACKAGE_FILES],
  );
  const status = await item.store.verifyActive();
  assert.equal(status.verified.manifest.signing_role, "bundled");

  const update = signedEnvelope({ sequence: 2, version: "1.1.0", signers: item.signers });
  await assert.rejects(() => item.store.install(update.bytes), expectCode("TRUST_ROOT_UNCONFIGURED"));
  assert.equal(item.store.getState().active.manifest_sha256, item.bundled.manifestSha256);
});

test("bundled current plus historical digest allowlist supports v1-to-v2 reconciliation", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const v1Identity = await item.store.verifiedActiveIdentity();
  const bundledV2 = writeBundledAssets(item.root, {
    sequence: 2,
    version: "1.1.0",
    directory: "bundled-assets-v2",
    rollbackTarget: {
      manifest_sha256: item.bundled.manifestSha256,
      release_sequence: 1,
    },
  });
  const anchors = [item.bundled.manifestSha256, bundledV2.manifestSha256];
  const upgraded = new StandardsStore({
    ...item.options,
    bundledManifestSha256s: anchors,
  });

  const migrated = await upgraded.reconcileBundledFiles(bundledV2.paths);
  assert.equal(migrated.active.manifest_sha256, bundledV2.manifestSha256);
  assert.equal(migrated.active.source, "bundled");
  assert.equal(migrated.previous.manifest_sha256, item.bundled.manifestSha256);
  assert.equal(migrated.highest_seen_sequence, 2);
  assert.ok(fs.existsSync(path.join(item.options.rootDir, "packages", item.bundled.manifestSha256)));

  const reopened = new StandardsStore({
    ...item.options,
    bundledManifestSha256s: anchors,
  });
  assert.deepEqual(await reopened.verifyReleaseIdentity(v1Identity), v1Identity);
  const v2Identity = await reopened.verifiedActiveIdentity();
  assert.equal(v2Identity.manifest_sha256, bundledV2.manifestSha256);
  assert.equal(v2Identity.name, "oak-rules");
  assert.equal(v2Identity.sha256, bundledV2.manifest.rulepack.sha256);
  assert.equal(v2Identity.pinned, true);

  const missingHistoricalAnchor = new StandardsStore({
    ...item.options,
    bundledManifestSha256: null,
    bundledManifestSha256s: [bundledV2.manifestSha256],
  });
  await assert.rejects(
    () => missingHistoricalAnchor.verifyReleaseIdentity(v1Identity),
    expectCode("BUNDLED_TRUST_MISMATCH"),
  );
});

test("release identity verification compares every pin field and never bypasses global integrity", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const identity = await item.store.verifiedActiveIdentity();
  assert.deepEqual(identity, {
    name: "oak-rules",
    version: "1.0.0",
    pinned: true,
    sha256: item.bundled.manifest.rulepack.sha256,
    bundle_id: "oak-standards",
    release_sequence: 1,
    manifest_sha256: item.bundled.manifestSha256,
  });
  await assert.rejects(
    () => item.store.verifyReleaseIdentity({ ...identity, sha256: "a".repeat(64) }),
    expectCode("RELEASE_IDENTITY_MISMATCH"),
  );

  const update = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: item.bundled.manifestSha256,
      release_sequence: 1,
    },
  });
  await item.store.install(update.bytes);
  const corrupted = item.store.getState();
  corrupted.highest_seen_sequence = 1;
  fs.writeFileSync(path.join(item.options.rootDir, "active.json"), canonicalJson(corrupted));
  await assert.rejects(
    () => item.store.verifyReleaseIdentity(identity),
    expectCode("INVALID_STATE"),
  );
});

test("migration-source identity mode relaxes only revoked, expired, and app-compatibility availability", async (t) => {
  const compatibility = fixture(t);
  await bootstrap(compatibility);
  const baselineTarget = {
    manifest_sha256: compatibility.bundled.manifestSha256,
    release_sequence: 1,
  };
  const compatibleUpdate = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: compatibility.signers,
    rollbackTarget: baselineTarget,
  });
  await compatibility.store.install(compatibleUpdate.bytes);
  const identity = await compatibility.store.verifiedActiveIdentity();
  const newerApp = new StandardsStore({ ...compatibility.options, appVersion: "0.2.0" });
  await assert.rejects(
    () => newerApp.verifyReleaseIdentity(identity),
    expectCode("INCOMPATIBLE_APP"),
  );
  assert.deepEqual(
    await newerApp.verifyReleaseIdentity(identity, { allowMigrationSource: true }),
    identity,
  );

  const revokedState = compatibility.store.getState();
  revokedState.revoked_manifest_sha256s = [identity.manifest_sha256];
  fs.writeFileSync(
    path.join(compatibility.options.rootDir, "active.json"),
    canonicalJson(revokedState),
  );
  await assert.rejects(
    () => compatibility.store.verifyReleaseIdentity(identity),
    expectCode("REVOKED_PACKAGE"),
  );
  assert.deepEqual(
    await compatibility.store.verifyReleaseIdentity(identity, { allowMigrationSource: true }),
    identity,
  );

  const expiration = fixture(t);
  const earlyStore = new StandardsStore({
    ...expiration.options,
    now: () => new Date("2026-07-27T01:00:00.000Z"),
  });
  await earlyStore.bootstrapBundledFiles(expiration.bundled.paths);
  const expiringUpdate = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: expiration.signers,
    expiresAt: "2026-07-27T12:00:00Z",
    rollbackTarget: {
      manifest_sha256: expiration.bundled.manifestSha256,
      release_sequence: 1,
    },
  });
  await earlyStore.install(expiringUpdate.bytes);
  const expiringIdentity = await earlyStore.verifiedActiveIdentity();
  const expiredStore = new StandardsStore(expiration.options);
  await assert.rejects(
    () => expiredStore.verifyReleaseIdentity(expiringIdentity),
    expectCode("EXPIRED_MANIFEST"),
  );
  assert.deepEqual(
    await expiredStore.verifyReleaseIdentity(expiringIdentity, { allowMigrationSource: true }),
    expiringIdentity,
  );
});

test("valid threshold-signed release installs into CAS and atomically advances state", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const update = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: item.bundled.manifestSha256,
      release_sequence: 1,
    },
  });

  const state = await item.store.install(update.bytes);
  assert.equal(state.active.manifest_sha256, update.manifestSha256);
  assert.equal(state.active.source, "installed");
  assert.equal(state.previous.manifest_sha256, item.bundled.manifestSha256);
  assert.equal(state.previous.source, "bundled");
  assert.equal(state.highest_seen_sequence, 2);
  assert.deepEqual(
    fs.readdirSync(path.join(item.options.rootDir, "packages", update.manifestSha256)).sort(),
    [...PACKAGE_FILES],
  );
  const status = await item.store.verifyActive();
  assert.equal(status.verified.manifest.version, "1.1.0");
});

test("every noninitial install requires an exact already-verified signed rollback target", async (t) => {
  const item = fixture(t);
  await bootstrap(item);

  const missingTarget = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
  });
  await assert.rejects(
    () => item.store.install(missingTarget.bytes),
    expectCode("ROLLBACK_TARGET_REQUIRED"),
  );

  const absentTarget = signedEnvelope({
    sequence: 2,
    version: "1.1.1",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: "f".repeat(64),
      release_sequence: 1,
    },
  });
  await assert.rejects(
    () => item.store.install(absentTarget.bytes),
    expectCode("ROLLBACK_TARGET_MISSING"),
  );

  const wrongSequence = signedEnvelope({
    sequence: 3,
    version: "1.2.0",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: item.bundled.manifestSha256,
      release_sequence: 2,
    },
  });
  await assert.rejects(
    () => item.store.install(wrongSequence.bytes),
    expectCode("ROLLBACK_TARGET_MISMATCH"),
  );
  assert.equal(item.store.getState().active.manifest_sha256, item.bundled.manifestSha256);
});

test("signed rollback_target, rather than the formerly active package, defines state.previous", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const baselineTarget = {
    manifest_sha256: item.bundled.manifestSha256,
    release_sequence: 1,
  };
  const versionTwo = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: baselineTarget,
  });
  await item.store.install(versionTwo.bytes);
  const versionThree = signedEnvelope({
    sequence: 3,
    version: "1.2.0",
    signers: item.signers,
    rollbackTarget: baselineTarget,
  });
  const state = await item.store.install(versionThree.bytes);
  assert.equal(state.active.manifest_sha256, versionThree.manifestSha256);
  assert.equal(state.previous.manifest_sha256, item.bundled.manifestSha256);

  const rolledBack = await item.store.rollback();
  assert.equal(rolledBack.active.manifest_sha256, item.bundled.manifestSha256);
  assert.equal(rolledBack.previous, null);
  await assert.rejects(() => item.store.rollback(), expectCode("NO_ROLLBACK_TARGET"));
});

test("rollback re-verifies that active manifest signed the exact state.previous target", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const baselineTarget = {
    manifest_sha256: item.bundled.manifestSha256,
    release_sequence: 1,
  };
  const versionTwo = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: baselineTarget,
  });
  const versionTwoState = await item.store.install(versionTwo.bytes);
  const versionThree = signedEnvelope({
    sequence: 3,
    version: "1.2.0",
    signers: item.signers,
    rollbackTarget: baselineTarget,
  });
  await item.store.install(versionThree.bytes);
  const tampered = item.store.getState();
  tampered.previous = versionTwoState.active;
  fs.writeFileSync(path.join(item.options.rootDir, "active.json"), canonicalJson(tampered));
  await assert.rejects(() => item.store.rollback(), expectCode("ROLLBACK_TARGET_MISMATCH"));
});

test("activate cannot bypass rollback_target validation", async (t) => {
  const item = fixture(t);
  const baseline = await bootstrap(item);
  const noTarget = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
  });
  const verified = await item.store.verifyEnvelope(noTarget.bytes);
  await item.store._materialize(verified);
  item.store._atomicWriteState(
    { ...baseline, highest_seen_sequence: 2 },
    { expectedState: baseline },
  );
  await assert.rejects(
    () => item.store.activate(noTarget.manifestSha256),
    expectCode("ROLLBACK_TARGET_REQUIRED"),
  );
});

test("payload and signed manifest tampering fail closed", async (t) => {
  const item = fixture(t);
  const update = signedEnvelope({ sequence: 2, version: "1.1.0", signers: item.signers });

  const payloadTamper = JSON.parse(update.bytes.toString("utf8"));
  const changed = Buffer.from(update.payload.standardsBytes);
  changed[changed.length - 2] ^= 1;
  payloadTamper.files[0].payload_b64 = changed.toString("base64");
  await assert.rejects(
    () => item.store.verifyEnvelope(Buffer.from(JSON.stringify(payloadTamper))),
    expectCode("HASH_MISMATCH"),
  );

  const manifestTamper = JSON.parse(update.bytes.toString("utf8"));
  const parsed = JSON.parse(Buffer.from(manifestTamper.manifest_b64, "base64").toString("utf8"));
  parsed.change_summary = ["attacker changed signed metadata"];
  manifestTamper.manifest_b64 = Buffer.from(canonicalJson(parsed)).toString("base64");
  await assert.rejects(
    () => item.store.verifyEnvelope(Buffer.from(JSON.stringify(manifestTamper))),
    expectCode("INVALID_SIGNATURE"),
  );
});

test("unknown keys and signatures below threshold are rejected", async (t) => {
  const item = fixture(t);
  const insufficient = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: [item.signers[0]],
  });
  await assert.rejects(
    () => item.store.verifyEnvelope(insufficient.bytes),
    expectCode("SIGNATURE_THRESHOLD"),
  );

  const outsider = signer();
  const unknown = signedEnvelope({ sequence: 2, version: "1.1.0", signers: [outsider] });
  await assert.rejects(
    () => item.store.verifyEnvelope(unknown.bytes),
    expectCode("UNKNOWN_SIGNING_KEY"),
  );
});

test("signature loops and unreferenced trust keys are bounded", async (t) => {
  const item = fixture(t);
  const update = signedEnvelope({ sequence: 2, version: "1.1.0", signers: item.signers });
  const tooMany = JSON.parse(update.bytes.toString("utf8"));
  tooMany.signatures = Array.from({ length: 17 }, () => ({ ...tooMany.signatures[0] }));
  await assert.rejects(
    () => item.store.verifyEnvelope(Buffer.from(JSON.stringify(tooMany))),
    expectCode("INVALID_SIGNATURE"),
  );

  const outsider = signer();
  const trust = makeTrust(item.signers, 2);
  trust.keys[outsider.keyid] = { alg: "ed25519", spki_der_b64: outsider.spkiDerB64 };
  assert.throws(
    () => new StandardsStore({ ...item.options, trustStore: trust }),
    expectCode("INVALID_TRUST_STORE"),
  );
});

test("a correctly signed but non-canonical manifest is rejected", async (t) => {
  const item = fixture(t);
  const payload = payloads("1.1.0");
  const manifest = manifestFor({
    sequence: 2,
    version: "1.1.0",
    signingRole: "release",
    payload,
  });
  const nonCanonical = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const update = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    payload,
    manifestBytes: nonCanonical,
  });
  await assert.rejects(
    () => item.store.verifyEnvelope(update.bytes),
    expectCode("NON_CANONICAL_JSON"),
  );
});

test("manifest gate independently rejects non-stable channel and split release/rulepack versions", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const update = signedEnvelope({ sequence: 2, version: "1.1.0", signers: item.signers });
  const beta = mutateAndResign(update, item.signers, (manifest) => {
    manifest.channel = "beta";
  });
  await assert.rejects(() => item.store.verifyEnvelope(beta), expectCode("INVALID_SCHEMA"));

  const splitVersion = mutateAndResign(update, item.signers, (manifest) => {
    manifest.rulepack.version = "1.1.1";
  });
  await assert.rejects(
    () => item.store.verifyEnvelope(splitVersion),
    expectCode("INVALID_SCHEMA"),
  );
});

test("ordinary update rejects downgrade and same-version different bytes", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const baselineTarget = {
    manifest_sha256: item.bundled.manifestSha256,
    release_sequence: 1,
  };
  const versionTwo = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: baselineTarget,
  });
  await item.store.install(versionTwo.bytes);

  const downgrade = signedEnvelope({
    sequence: 1,
    version: "0.9.0",
    signers: item.signers,
  });
  await assert.rejects(() => item.store.install(downgrade.bytes), expectCode("ROLLBACK_BLOCKED"));

  const duplicateVersion = signedEnvelope({
    sequence: 3,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: baselineTarget,
    changeSummary: ["Different signed bytes under the same version"],
  });
  await assert.rejects(
    () => item.store.install(duplicateVersion.bytes),
    expectCode("DUPLICATE_VERSION"),
  );
  assert.equal(item.store.getState().active.manifest_sha256, versionTwo.manifestSha256);
  assert.equal(item.store.getState().highest_seen_sequence, 2);
});

test("active-state commit failure is recovered without a permanent orphan high-water lock", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const versionTwo = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: item.bundled.manifestSha256,
      release_sequence: 1,
    },
  });
  await item.store.install(versionTwo.bytes);

  let failStateRename = true;
  const faultFs = new Proxy(fs, {
    get(target, property) {
      if (property === "renameSync") {
        return (source, destination) => {
          if (failStateRename && destination === path.join(item.options.rootDir, "active.json") &&
              path.basename(source).startsWith(".active.json.")) {
            failStateRename = false;
            const error = new Error("injected active state rename failure");
            error.code = "EIO";
            throw error;
          }
          return target.renameSync(source, destination);
        };
      }
      return Reflect.get(target, property);
    },
  });
  const faultingStore = new StandardsStore({ ...item.options, fsImpl: faultFs });
  const versionThree = signedEnvelope({
    sequence: 3,
    version: "1.2.0",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: versionTwo.manifestSha256,
      release_sequence: 2,
    },
  });
  await assert.rejects(() => faultingStore.install(versionThree.bytes), /injected active state/);

  const state = item.store.getState();
  assert.equal(state.active.manifest_sha256, versionTwo.manifestSha256);
  assert.equal(state.highest_seen_sequence, 2);
  assert.ok(fs.existsSync(path.join(item.options.rootDir, "packages", versionThree.manifestSha256)));

  const reopened = new StandardsStore(item.options);
  const recovered = await reopened.verifyActive();
  assert.equal(recovered.state.active.manifest_sha256, versionTwo.manifestSha256);
  assert.equal(recovered.state.highest_seen_sequence, 2);
  assert.equal(
    fs.existsSync(path.join(item.options.rootDir, "packages", versionThree.manifestSha256)),
    false,
  );

  const versionFour = signedEnvelope({
    sequence: 4,
    version: "1.3.0",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: versionTwo.manifestSha256,
      release_sequence: 2,
    },
  });
  const finalState = await reopened.install(versionFour.bytes);
  assert.equal(finalState.active.manifest_sha256, versionFour.manifestSha256);
  assert.equal(finalState.highest_seen_sequence, 4);
});

test("bootstrap commit failure is cleaned and can bootstrap again on reopen", async (t) => {
  const item = fixture(t);
  let failStateRename = true;
  const faultFs = new Proxy(fs, {
    get(target, property) {
      if (property === "renameSync") {
        return (source, destination) => {
          if (failStateRename && destination === path.join(item.options.rootDir, "active.json") &&
              path.basename(source).startsWith(".active.json.")) {
            failStateRename = false;
            const error = new Error("injected bootstrap state rename failure");
            error.code = "EIO";
            throw error;
          }
          return target.renameSync(source, destination);
        };
      }
      return Reflect.get(target, property);
    },
  });
  const faultingStore = new StandardsStore({ ...item.options, fsImpl: faultFs });
  await assert.rejects(
    () => faultingStore.bootstrapBundledFiles(item.bundled.paths),
    /injected bootstrap state/,
  );
  assert.equal(item.store.getState(), null);
  assert.ok(fs.existsSync(
    path.join(item.options.rootDir, "packages", item.bundled.manifestSha256),
  ));

  const reopened = new StandardsStore(item.options);
  const state = await reopened.bootstrapBundledFiles(item.bundled.paths);
  assert.equal(state.active.manifest_sha256, item.bundled.manifestSha256);
  assert.equal((await reopened.verifyActive()).state.highest_seen_sequence, 1);
});

test("two store instances serialize concurrent installs for the same root", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const secondStore = new StandardsStore(item.options);
  const baselineTarget = {
    manifest_sha256: item.bundled.manifestSha256,
    release_sequence: 1,
  };
  const versionTwo = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: baselineTarget,
  });
  const versionThree = signedEnvelope({
    sequence: 3,
    version: "1.2.0",
    signers: item.signers,
    rollbackTarget: baselineTarget,
  });

  const [first, second] = await Promise.all([
    item.store.install(versionTwo.bytes),
    secondStore.install(versionThree.bytes),
  ]);
  assert.equal(first.active.manifest_sha256, versionTwo.manifestSha256);
  assert.equal(second.active.manifest_sha256, versionThree.manifestSha256);
  const final = await item.store.verifyActive();
  assert.equal(final.state.highest_seen_sequence, 3);
  assert.equal(final.state.active.manifest_sha256, versionThree.manifestSha256);
  assert.equal(final.state.previous.manifest_sha256, item.bundled.manifestSha256);
});

test("a live foreign transaction owner is busy and is never treated as stale by age", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const update = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: item.bundled.manifestSha256,
      release_sequence: 1,
    },
  });
  const child = startFaultingChild(item, update, { stayAlive: true });
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  await waitForReady(child);

  const reopened = new StandardsStore(item.options);
  await assert.rejects(() => reopened.verifyActive(), expectCode("STORE_BUSY"));
  assert.equal(item.store.getState().active.manifest_sha256, item.bundled.manifestSha256);
});

test("a dead transaction owner is deterministically recovered on reopen", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const update = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: item.bundled.manifestSha256,
      release_sequence: 1,
    },
  });
  const child = startFaultingChild(item, update);
  const exit = await new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve(code)
      : reject(new Error(`fault child exited ${code}: ${stderr}`)));
  });
  assert.equal(exit, 0);
  assert.ok(fs.existsSync(path.join(item.options.rootDir, "packages", update.manifestSha256)));

  const reopened = new StandardsStore(item.options);
  const recovered = await reopened.verifyActive();
  assert.equal(recovered.state.active.manifest_sha256, item.bundled.manifestSha256);
  assert.equal(recovered.state.highest_seen_sequence, 1);
  assert.equal(
    fs.existsSync(path.join(item.options.rootDir, "packages", update.manifestSha256)),
    false,
  );
});

test("recovery never cleans a pending target whose bytes no longer match its strict intent", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const update = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: item.bundled.manifestSha256,
      release_sequence: 1,
    },
  });
  const child = startFaultingChild(item, update);
  await new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`fault child exited ${code}: ${stderr}`)));
  });
  const target = path.join(
    item.options.rootDir,
    "packages",
    update.manifestSha256,
    "standards.json",
  );
  fs.appendFileSync(target, " ");

  const reopened = new StandardsStore(item.options);
  await assert.rejects(
    () => reopened.verifyActive(),
    expectCode("TRANSACTION_RECOVERY_FAILED"),
  );
  assert.ok(fs.existsSync(target));
});

test("explicit rollback swaps only the verified previous package and keeps high-water mark", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const versionTwo = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: item.bundled.manifestSha256,
      release_sequence: 1,
    },
  });
  await item.store.install(versionTwo.bytes);

  const rolledBack = await item.store.rollback();
  assert.equal(rolledBack.active.manifest_sha256, item.bundled.manifestSha256);
  assert.equal(rolledBack.active.source, "bundled");
  assert.equal(rolledBack.previous, null);
  assert.equal(rolledBack.highest_seen_sequence, 2);
  const status = await item.store.verifyActive();
  assert.equal(status.verified.manifest.version, "1.0.0");
});

test("state cannot relabel bundled and installed package sources", async (t) => {
  const item = fixture(t);
  await bootstrap(item);
  const statePath = path.join(item.options.rootDir, "active.json");
  const tampered = item.store.getState();
  tampered.active.source = "installed";
  fs.writeFileSync(statePath, canonicalJson(tampered));
  await assert.rejects(() => item.store.verifyActive(), expectCode("INVALID_STATE"));
});

test("state high-water cannot trail a newer verified CAS package", async (t) => {
  const item = fixture(t);
  const baseline = await bootstrap(item);
  const versionTwo = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: item.bundled.manifestSha256,
      release_sequence: 1,
    },
  });
  await item.store.install(versionTwo.bytes);
  fs.writeFileSync(
    path.join(item.options.rootDir, "active.json"),
    canonicalJson(baseline),
  );
  const versionThree = signedEnvelope({
    sequence: 3,
    version: "1.2.0",
    signers: item.signers,
    rollbackTarget: {
      manifest_sha256: versionTwo.manifestSha256,
      release_sequence: 2,
    },
  });
  await assert.rejects(() => item.store.install(versionThree.bytes), expectCode("INVALID_STATE"));
});

test("global verification rejects foreign bundles, duplicate sequences, and a missing high-water package", async (t) => {
  const foreign = fixture(t);
  await bootstrap(foreign);
  const foreignUpdate = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: foreign.signers,
  });
  const foreignBytes = mutateAndResign(foreignUpdate, foreign.signers, (manifest) => {
    manifest.bundle_id = "other-standards";
  });
  await foreign.store._materialize(await foreign.store.verifyEnvelope(foreignBytes));
  await assert.rejects(() => foreign.store.verifyActive(), expectCode("INVALID_STATE"));

  const duplicate = fixture(t);
  await bootstrap(duplicate);
  const duplicateSequence = signedEnvelope({
    sequence: 1,
    version: "1.1.0",
    signers: duplicate.signers,
  });
  await duplicate.store._materialize(await duplicate.store.verifyEnvelope(duplicateSequence.bytes));
  await assert.rejects(() => duplicate.store.verifyActive(), expectCode("INVALID_STATE"));

  const missingHighWater = fixture(t);
  await bootstrap(missingHighWater);
  const versionTwo = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: missingHighWater.signers,
    rollbackTarget: {
      manifest_sha256: missingHighWater.bundled.manifestSha256,
      release_sequence: 1,
    },
  });
  await missingHighWater.store.install(versionTwo.bytes);
  await missingHighWater.store.rollback();
  fs.renameSync(
    path.join(missingHighWater.options.rootDir, "packages", versionTwo.manifestSha256),
    path.join(missingHighWater.root, "removed-high-water-package"),
  );
  await assert.rejects(
    () => missingHighWater.store.verifyActive(),
    expectCode("INVALID_STATE"),
  );
});

test("injected payload/capability validator can veto before active state changes", async (t) => {
  const item = fixture(t, {
    validatePayload: async ({ manifest }) => {
      if (manifest.release_sequence > 1) return { ok: false };
      return { ok: true };
    },
  });
  await bootstrap(item);
  const update = signedEnvelope({ sequence: 2, version: "1.1.0", signers: item.signers });
  await assert.rejects(
    () => item.store.install(update.bytes),
    expectCode("PAYLOAD_VALIDATION_FAILED"),
  );
  assert.equal(item.store.getState().active.manifest_sha256, item.bundled.manifestSha256);
});

test("non-canonical payload paths and linked CAS files are rejected", async (t) => {
  const item = fixture(t);
  const update = signedEnvelope({ sequence: 2, version: "1.1.0", signers: item.signers });
  const unsafe = JSON.parse(update.bytes.toString("utf8"));
  unsafe.files[1].path = "../rulepack.json";
  await assert.rejects(
    () => item.store.verifyEnvelope(Buffer.from(JSON.stringify(unsafe))),
    expectCode("UNSAFE_PATH"),
  );

  await bootstrap(item);
  const packageDir = path.join(
    item.options.rootDir,
    "packages",
    item.bundled.manifestSha256,
  );
  const standards = path.join(packageDir, "standards.json");
  const outside = path.join(item.root, "hardlink-source.json");
  fs.copyFileSync(standards, outside);
  fs.unlinkSync(standards);
  fs.linkSync(outside, standards);
  await assert.rejects(() => item.store.verifyActive(), expectCode("UNSAFE_PATH"));
});

test("future, expired, and incompatible signed releases are not accepted", async (t) => {
  const item = fixture(t);
  const expired = signedEnvelope({
    sequence: 2,
    version: "1.1.0",
    signers: item.signers,
    expiresAt: "2026-07-27T12:00:00Z",
  });
  await assert.rejects(() => item.store.verifyEnvelope(expired.bytes), expectCode("EXPIRED_MANIFEST"));

  const future = signedEnvelope({ sequence: 2, version: "1.1.0", signers: item.signers });
  const futureOuter = JSON.parse(future.bytes.toString("utf8"));
  const futureManifest = JSON.parse(Buffer.from(futureOuter.manifest_b64, "base64").toString("utf8"));
  futureManifest.released_at = "2026-07-29T00:00:00Z";
  futureOuter.manifest_b64 = Buffer.from(canonicalJson(futureManifest)).toString("base64");
  futureOuter.signatures = item.signers.map((entry) => ({
    keyid: entry.keyid,
    alg: "ed25519",
    sig_b64: crypto.sign(
      null,
      Buffer.from(futureOuter.manifest_b64, "base64"),
      entry.privateKey,
    ).toString("base64"),
  }));
  await assert.rejects(
    () => item.store.verifyEnvelope(Buffer.from(JSON.stringify(futureOuter))),
    expectCode("NOT_YET_VALID"),
  );

  const incompatible = signedEnvelope({ sequence: 2, version: "1.1.0", signers: item.signers });
  const incompatibleOuter = JSON.parse(incompatible.bytes.toString("utf8"));
  const incompatibleManifest = JSON.parse(
    Buffer.from(incompatibleOuter.manifest_b64, "base64").toString("utf8"),
  );
  incompatibleManifest.min_app = "0.2.0";
  incompatibleManifest.max_app_exclusive = "0.3.0";
  const incompatibleBytes = Buffer.from(canonicalJson(incompatibleManifest));
  incompatibleOuter.manifest_b64 = incompatibleBytes.toString("base64");
  incompatibleOuter.signatures = item.signers.map((entry) => ({
    keyid: entry.keyid,
    alg: "ed25519",
    sig_b64: crypto.sign(null, incompatibleBytes, entry.privateKey).toString("base64"),
  }));
  await assert.rejects(
    () => item.store.verifyEnvelope(Buffer.from(JSON.stringify(incompatibleOuter))),
    expectCode("INCOMPATIBLE_APP"),
  );
});

test("SemVer core numbers outside JavaScript safe-integer range are rejected", () => {
  assert.throws(
    () => compareSemver("9007199254740992.0.0", "1.0.0"),
    expectCode("INVALID_SEMVER"),
  );
  assert.equal(
    compareSemver(
      "1.0.0-99999999999999999999999999999999999999",
      "1.0.0-100000000000000000000000000000000000000",
    ),
    -1,
  );
});
