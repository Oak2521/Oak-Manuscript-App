"use strict";

// Offline-first StandardsProvider. It has no transport and never enables
// networking. A future updater may hand authenticated bytes to importPackage;
// the same local signature, schema, capability, CAS, and rollback gates apply.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  DEFAULT_LIMITS,
  StandardsStore,
  StandardsStoreError,
  sha256,
} = require("./standards-store");
const {
  StandardsPayloadError,
  createStandardsPayloadValidator,
  strictJson,
} = require("./standards-payload");
const { summarizeStandardsGovernance } = require("./standards-governance");

// This constant lives in the Electron application code (inside app.asar), not
// beside the mutable extraResource payload. Packaging tests prove it matches
// the tracked manifest. Formal releases must additionally sign the application.
const BUNDLED_STANDARD_RELEASE = Object.freeze({
  bundleId: "oak-standards",
  releaseSequence: 3,
  version: "2.1.0",
  manifestSha256: "88a60da2f55c6de13853e0af56389f56a591c5702e44de1a7943d31afbff0187",
  manifestRelative: "standard-packs/oak-standards-2.1.0.manifest.json",
  standardsRelative: "standards.json",
  rulepackRelative: "rule-packs/oak-rules-2.1.0.json",
  capabilitiesRelative: "rule-capabilities.json",
  trustRelative: "standard-trust.json",
  trustSha256: null,
  historicalManifestSha256s: Object.freeze([
    "0aff75eb181a62869147e9af27330c717bc808bdd23865197534fc9868568427",
    "d33534f081b2122a90652ee03304a0e71177a7fd0d3130fffe77b0fea807d7af",
  ]),
  historicalCapabilitySetSha256s: Object.freeze([
    "af67d0aaf2ece431ec1b617934bdfa3627b6be1b1301a92fcf3b2b2f29ca232e",
  ]),
});

const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REMOTE_PLAN_TTL_MS = 10 * 60 * 1000;

class StandardsProviderError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "StandardsProviderError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new StandardsProviderError(code, message, details);
}

function sameFile(left, right) {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino) &&
    String(left.mode) === String(right.mode) && String(left.size) === String(right.size) &&
    String(left.mtimeNs ?? left.mtimeMs ?? "") === String(right.mtimeNs ?? right.mtimeMs ?? "");
}

function readPlainFile(target, {
  label,
  maxBytes,
  allowMissing = false,
  expectedExtension = null,
  fsImpl = fs,
} = {}) {
  if (typeof target !== "string" || !path.isAbsolute(target)) {
    fail("INVALID_PATH", `${label} 必须是绝对路径`);
  }
  if (expectedExtension && path.extname(target).toLowerCase() !== expectedExtension) {
    fail("INVALID_PATH", `${label} 必须使用 ${expectedExtension} 扩展名`);
  }
  let before;
  try {
    before = fsImpl.lstatSync(target, { bigint: true });
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    fail("FILE_UNAVAILABLE", `${label} 不存在或不可读`, { cause: error.message });
  }
  if (before.isSymbolicLink() || !before.isFile() || BigInt(before.nlink) !== 1n ||
      before.size <= 0n || before.size > BigInt(maxBytes)) {
    fail("UNSAFE_FILE", `${label} 必须是大小受限的单链接普通文件`);
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fsImpl.openSync(target, flags);
    const opened = fsImpl.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || BigInt(opened.nlink) !== 1n || !sameFile(before, opened)) {
      fail("FILE_CHANGED", `${label} 打开时身份发生变化`);
    }
    const bytes = fsImpl.readFileSync(descriptor);
    const afterRead = fsImpl.fstatSync(descriptor, { bigint: true });
    if (!sameFile(opened, afterRead) || bytes.length !== Number(afterRead.size)) {
      fail("FILE_CHANGED", `${label} 读取期间发生变化`);
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor);
    let after = null;
    try { after = fsImpl.lstatSync(target, { bigint: true }); } catch {}
    if (!after || !sameFile(before, after)) fail("FILE_CHANGED", `${label} 目录项发生变化`);
  }
}

function resolveBundledPath(configDir, relative, label) {
  if (typeof relative !== "string" || relative.length === 0 || path.isAbsolute(relative)) {
    fail("INVALID_BUNDLED_RELEASE", `${label} 必须是 configDir 内的相对路径`);
  }
  const target = path.resolve(configDir, relative);
  const relation = path.relative(configDir, target);
  if (relation === "" || relation.startsWith(`..${path.sep}`) || relation === ".." ||
      path.isAbsolute(relation)) {
    fail("INVALID_BUNDLED_RELEASE", `${label} 逃逸 configDir`);
  }
  return target;
}

function readOptionalTrustStore(configDir, bundledRelease, fsImpl = fs) {
  const trustPath = resolveBundledPath(
    configDir,
    bundledRelease.trustRelative,
    "trustRelative",
  );
  const bytes = readPlainFile(trustPath, {
    label: "标准更新信任根",
    maxBytes: 256 * 1024,
    allowMissing: true,
    fsImpl,
  });
  if (bytes === null) return null;
  if (typeof bundledRelease.trustSha256 !== "string" ||
      !SHA256_RE.test(bundledRelease.trustSha256)) {
    fail("TRUST_ROOT_UNPINNED", "磁盘标准更新信任根存在，但 APP 代码未固定其原始 SHA-256");
  }
  const actual = sha256(bytes);
  if (actual !== bundledRelease.trustSha256) {
    fail("TRUST_ROOT_MISMATCH", "磁盘标准更新信任根与 APP 代码固定摘要不一致", {
      expected: bundledRelease.trustSha256,
      actual,
    });
  }
  return strictJson(bytes, "标准更新信任根");
}

function publicError(error) {
  const known = error instanceof StandardsProviderError ||
    error instanceof StandardsStoreError || error instanceof StandardsPayloadError;
  return {
    code: known && typeof error.code === "string" ? error.code : "STANDARDS_PROVIDER_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

class StandardsProvider {
  constructor({
    rootDir,
    configDir,
    appVersion,
    trustStore = undefined,
    bundledRelease = BUNDLED_STANDARD_RELEASE,
    fsImpl = fs,
    storeClass = StandardsStore,
    updateClient = null,
    revocationClient = null,
    clock = () => new Date(),
    planIdFactory = crypto.randomUUID,
  }) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir) ||
        typeof configDir !== "string" || !path.isAbsolute(configDir)) {
      fail("INVALID_PATH", "StandardsProvider rootDir/configDir 必须是绝对路径");
    }
    this.rootDir = path.resolve(rootDir);
    this.configDir = path.resolve(configDir);
    this.appVersion = appVersion;
    this.fs = fsImpl;
    this.bundledRelease = Object.freeze({ ...bundledRelease });
    this.trustStoreInput = trustStore;
    this.storeClass = storeClass;
    if (updateClient !== null && (!updateClient || typeof updateClient.check !== "function")) {
      throw new TypeError("标准更新 transport 必须提供 check");
    }
    if (revocationClient !== null &&
        (!revocationClient || typeof revocationClient.fetch !== "function")) {
      throw new TypeError("标准撤回 transport 必须提供 fetch");
    }
    if (typeof clock !== "function" || typeof planIdFactory !== "function") {
      throw new TypeError("标准更新计划时钟或 ID 生成器非法");
    }
    this.updateClient = updateClient;
    this.revocationClient = revocationClient;
    this.clock = clock;
    this.planIdFactory = planIdFactory;
    this.paths = null;
    this.trustConfigured = false;
    this.store = null;
    this.initialized = false;
    this.initializationError = null;
    this._initializing = null;
    this._preparing = null;
    this._checkingRemote = false;
    this._refreshingRevocations = false;
    this._remotePlan = null;
  }

  _validateBundledRelease() {
    const release = this.bundledRelease;
    if (typeof release.manifestSha256 !== "string" || !SHA256_RE.test(release.manifestSha256)) {
      fail("INVALID_BUNDLED_RELEASE", "bundledRelease.manifestSha256 非法");
    }
    const historical = release.historicalManifestSha256s === undefined
      ? []
      : release.historicalManifestSha256s;
    if (!Array.isArray(historical) ||
        historical.some((digest) => typeof digest !== "string" || !SHA256_RE.test(digest))) {
      fail("INVALID_BUNDLED_RELEASE", "historicalManifestSha256s 必须是 SHA-256 数组");
    }
    const historicalCapabilities = release.historicalCapabilitySetSha256s === undefined
      ? []
      : release.historicalCapabilitySetSha256s;
    if (!Array.isArray(historicalCapabilities) || historicalCapabilities.some(
      (digest) => typeof digest !== "string" || !SHA256_RE.test(digest),
    )) {
      fail("INVALID_BUNDLED_RELEASE", "historicalCapabilitySetSha256s 必须是 SHA-256 数组");
    }
    this.paths = Object.freeze({
      manifest: resolveBundledPath(this.configDir, release.manifestRelative, "manifestRelative"),
      standards: resolveBundledPath(this.configDir, release.standardsRelative, "standardsRelative"),
      rulepack: resolveBundledPath(this.configDir, release.rulepackRelative, "rulepackRelative"),
      capabilities: resolveBundledPath(
        this.configDir,
        release.capabilitiesRelative,
        "capabilitiesRelative",
      ),
    });
    return [...new Set([release.manifestSha256, ...historical])];
  }

  _constructStore() {
    const bundledManifestSha256s = this._validateBundledRelease();
    const capabilityBytes = readPlainFile(this.paths.capabilities, {
      label: "APP 规则能力表",
      maxBytes: 1024 * 1024,
      fsImpl: this.fs,
    });
    const effectiveTrust = this.trustStoreInput === undefined
      ? readOptionalTrustStore(this.configDir, this.bundledRelease, this.fs)
      : this.trustStoreInput;
    const store = new this.storeClass({
      rootDir: this.rootDir,
      trustStore: effectiveTrust,
      appVersion: this.appVersion,
      validatePayload: createStandardsPayloadValidator({
        capabilityBytes,
        historicalBundledCapabilitySetSha256s:
          this.bundledRelease.historicalCapabilitySetSha256s || [],
      }),
      bundledManifestSha256: this.bundledRelease.manifestSha256,
      bundledManifestSha256s,
      fsImpl: this.fs,
    });
    this.trustConfigured = effectiveTrust !== null;
    this.store = store;
    return store;
  }

  async _prepareStoreAndBundle() {
    if (this._preparing) return this._preparing;
    this._preparing = (async () => {
      const store = this.store || this._constructStore();
      const manifestBytes = readPlainFile(this.paths.manifest, {
        label: "APP 内置标准 manifest",
        maxBytes: DEFAULT_LIMITS.manifestBytes,
        fsImpl: this.fs,
      });
      if (sha256(manifestBytes) !== this.bundledRelease.manifestSha256) {
        fail("BUNDLED_TRUST_MISMATCH", "APP 内置标准 manifest 与代码固定摘要不一致");
      }
      await store.reconcileBundledFiles({
        manifestPath: this.paths.manifest,
        standardsPath: this.paths.standards,
        rulepackPath: this.paths.rulepack,
      });
      return store;
    })();
    try {
      return await this._preparing;
    } finally {
      this._preparing = null;
    }
  }

  async initialize() {
    if (this.initialized) return this.status();
    if (this._initializing) return this._initializing;
    this._initializing = (async () => {
      try {
        const store = await this._prepareStoreAndBundle();
        await store.verifyActive();
        this.initialized = true;
        this.initializationError = null;
        return this.status();
      } catch (error) {
        this.initialized = false;
        this.initializationError = publicError(error);
        throw error;
      } finally {
        this._initializing = null;
      }
    })();
    return this._initializing;
  }

  async _requireReady({ allowMigrationSource = false } = {}) {
    if (allowMigrationSource) {
      const store = await this._prepareStoreAndBundle();
      return store.verifyActive({ allowMigrationSource: true });
    }
    if (!this.initialized) await this.initialize();
    return this.store.verifyActive();
  }

  status() {
    let state = null;
    try { state = this.store ? this.store.getState() : null; } catch (error) {
      if (this.initializationError === null) this.initializationError = publicError(error);
    }
    return {
      ready: this.initialized && this.initializationError === null,
      store_root: this.rootDir,
      active: state?.active || null,
      previous: state?.previous || null,
      highest_seen_sequence: state?.highest_seen_sequence || null,
      trust_configured: this.trustConfigured,
      local_signed_import_enabled: this.trustConfigured,
      network_updates_enabled: this.trustConfigured && this.updateClient !== null,
      network_revocations_enabled: this.trustConfigured && this.revocationClient !== null,
      error: this.initializationError,
    };
  }

  _remoteNow() {
    let value;
    try { value = this.clock(); } catch {
      fail("STANDARD_UPDATE_CLOCK_INVALID", "标准更新时间不可用");
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) fail("STANDARD_UPDATE_CLOCK_INVALID", "标准更新时间不可用");
    return date;
  }

  async checkForRemoteUpdate() {
    const { state: current } = await this._requireReady({ allowMigrationSource: true });
    if (!this.trustConfigured || this.updateClient === null) {
      fail("STANDARD_UPDATE_NETWORK_DISABLED", "标准更新联网配置或生产签名公钥尚未就绪");
    }
    if (this._checkingRemote) fail("STANDARD_UPDATE_BUSY", "标准更新检查正在进行");
    this._checkingRemote = true;
    this._remotePlan = null;
    try {
      const result = await this.updateClient.check({
        appVersion: this.appVersion,
        bundleId: current.active.bundle_id,
        currentReleaseSequence: current.active.release_sequence,
        currentManifestSha256: current.active.manifest_sha256,
      });
      if (result && typeof result === "object" && !Array.isArray(result) &&
          Object.keys(result).length === 1 && result.outcome === "current") {
        const { state: latest } = await this.store.verifyActive({ allowMigrationSource: true });
        if (latest.active.bundle_id !== current.active.bundle_id ||
            latest.active.release_sequence !== current.active.release_sequence ||
            latest.active.manifest_sha256 !== current.active.manifest_sha256 ||
            latest.highest_seen_sequence !== current.highest_seen_sequence) {
          fail("STANDARD_UPDATE_STATE_CHANGED", "标准库在在线检查期间发生变化，请重新检查");
        }
        if (latest.revoked_manifest_sha256s.includes(latest.active.manifest_sha256)) {
          fail("REVOKED_PACKAGE", "当前标准包已由受信撤回清单撤回，请获取更高版本");
        }
        return { outcome: "current", active: latest.active };
      }
      if (!result || typeof result !== "object" || Array.isArray(result) ||
          Object.keys(result).sort().join("\0") !== ["envelopeBytes", "outcome"].sort().join("\0") ||
          result.outcome !== "update" || !Buffer.isBuffer(result.envelopeBytes)) {
        fail("STANDARD_UPDATE_RESPONSE_INVALID", "标准更新 transport 返回了非法候选");
      }
      const bytes = Buffer.from(result.envelopeBytes);
      const verified = await this.store.verifyEnvelope(bytes, {
        enforceCompatibility: true,
        enforceExpiry: true,
        runPayloadValidation: true,
      });
      const { state: latest } = await this.store.verifyActive({ allowMigrationSource: true });
      if (latest.active.bundle_id !== current.active.bundle_id ||
          latest.active.release_sequence !== current.active.release_sequence ||
          latest.active.manifest_sha256 !== current.active.manifest_sha256 ||
          latest.highest_seen_sequence !== current.highest_seen_sequence) {
        fail("STANDARD_UPDATE_STATE_CHANGED", "标准库在在线检查期间发生变化，请重新检查");
      }
      if (latest.revoked_manifest_sha256s.includes(verified.manifestSha256)) {
        fail("REVOKED_PACKAGE", "在线标准候选已列入受信撤回清单");
      }
      if (verified.manifest.bundle_id !== latest.active.bundle_id ||
          verified.manifest.release_sequence <= latest.highest_seen_sequence) {
        fail("STANDARD_UPDATE_NOT_NEWER", "在线标准候选不是当前标准库的更高 release_sequence");
      }
      const planId = this.planIdFactory();
      if (typeof planId !== "string" || !UUID_RE.test(planId)) {
        fail("STANDARD_UPDATE_PLAN_INVALID", "标准更新计划 ID 生成失败");
      }
      const now = this._remoteNow();
      const expiresAt = new Date(now.getTime() + REMOTE_PLAN_TTL_MS).toISOString();
      this._remotePlan = Object.freeze({
        planId,
        expiresAt,
        expectedActiveManifestSha256: latest.active.manifest_sha256,
        envelopeSha256: sha256(bytes),
        manifestSha256: verified.manifestSha256,
        bytes,
      });
      return {
        outcome: "update_available",
        plan_id: planId,
        expires_at: expiresAt,
        envelope_sha256: this._remotePlan.envelopeSha256,
        manifest_sha256: verified.manifestSha256,
        expected_active_manifest_sha256: latest.active.manifest_sha256,
        bundle_id: verified.manifest.bundle_id,
        release_sequence: verified.manifest.release_sequence,
        version: verified.manifest.version,
        released_at: verified.manifest.released_at,
        change_summary: [...verified.manifest.change_summary],
      };
    } finally {
      this._checkingRemote = false;
    }
  }

  async installRemoteUpdate(planId) {
    if (typeof planId !== "string" || !UUID_RE.test(planId) ||
        this._remotePlan === null || this._remotePlan.planId !== planId) {
      fail("STANDARD_UPDATE_PLAN_STALE", "在线标准更新计划不存在或已失效，请重新检查");
    }
    const plan = this._remotePlan;
    this._remotePlan = null;
    const now = this._remoteNow();
    if (now.getTime() > Date.parse(plan.expiresAt)) {
      fail("STANDARD_UPDATE_PLAN_STALE", "在线标准更新计划已过期，请重新检查");
    }
    const { state: current } = await this._requireReady({ allowMigrationSource: true });
    if (current.active.manifest_sha256 !== plan.expectedActiveManifestSha256 ||
        sha256(plan.bytes) !== plan.envelopeSha256) {
      fail("STANDARD_UPDATE_PLAN_STALE", "标准库或候选包在确认前发生变化，请重新检查");
    }
    const verified = await this.store.verifyEnvelope(plan.bytes, {
      enforceCompatibility: true,
      enforceExpiry: true,
      runPayloadValidation: true,
    });
    if (verified.manifestSha256 !== plan.manifestSha256) {
      fail("STANDARD_UPDATE_PLAN_STALE", "标准更新候选与预览不一致，请重新检查");
    }
    const state = await this.store.install(plan.bytes);
    const active = await this.store.verifyActive();
    this.initialized = true;
    this.initializationError = null;
    return {
      active: state.active,
      previous: state.previous,
      change_summary: [...active.verified.manifest.change_summary],
    };
  }

  cancelRemoteUpdate(planId) {
    if (typeof planId !== "string" || !UUID_RE.test(planId) ||
        this._remotePlan === null || this._remotePlan.planId !== planId) {
      fail("STANDARD_UPDATE_PLAN_STALE", "在线标准更新计划不存在或已失效，请重新检查");
    }
    this._remotePlan = null;
    return { canceled: true };
  }

  async refreshRemoteRevocations() {
    const { state: current } = await this._requireReady({ allowMigrationSource: true });
    if (!this.trustConfigured || this.revocationClient === null) {
      fail("STANDARD_REVOCATION_NETWORK_DISABLED", "标准撤回联网配置或生产签名公钥尚未就绪");
    }
    if (this._refreshingRevocations) {
      fail("STANDARD_REVOCATION_BUSY", "标准撤回清单获取正在进行");
    }
    this._refreshingRevocations = true;
    try {
      const result = await this.revocationClient.fetch({
        appVersion: this.appVersion,
        bundleId: current.active.bundle_id,
      });
      if (!result || typeof result !== "object" || Array.isArray(result) ||
          Object.keys(result).length !== 1 || !Buffer.isBuffer(result.envelopeBytes)) {
        fail("STANDARD_REVOCATION_RESPONSE_INVALID", "标准撤回 transport 返回了非法签名清单");
      }
      return await this.applyRevocationEnvelope(Buffer.from(result.envelopeBytes));
    } finally {
      this._refreshingRevocations = false;
    }
  }

  async applyRevocationEnvelope(envelopeBytes) {
    const store = await this._prepareStoreAndBundle();
    if (!this.trustConfigured) {
      fail("REVOCATION_TRUST_UNCONFIGURED", "正式撤回签名公钥尚未配置，拒绝应用撤回清单");
    }
    this._remotePlan = null;
    const state = await store.applyRevocationEnvelope(envelopeBytes);
    const activeRevoked = state.revoked_manifest_sha256s.includes(
      state.active.manifest_sha256,
    );
    if (activeRevoked) {
      this.initialized = false;
      this.initializationError = {
        code: "REVOKED_PACKAGE",
        message: "当前标准包已由受信撤回清单撤回；新检查已停止，请获取更高版本",
      };
    }
    return {
      active: state.active,
      active_revoked: activeRevoked,
      revoked_manifest_sha256s: [...state.revoked_manifest_sha256s],
    };
  }

  async listStandards() {
    const { verified } = await this._requireReady();
    const value = strictJson(verified.standardsBytes, "active standards.json");
    return {
      standards: value.standards,
      registry_version: value.registry_version,
      governance_summary: summarizeStandardsGovernance(value.standards),
      release: {
        bundle_id: verified.manifest.bundle_id,
        release_sequence: verified.manifest.release_sequence,
        version: verified.manifest.version,
        manifest_sha256: verified.manifestSha256,
        rulepack_name: verified.manifest.rulepack.name,
        rulepack_version: verified.manifest.rulepack.version,
        change_summary: [...verified.manifest.change_summary],
      },
    };
  }

  async verifiedStatus() {
    await this._requireReady();
    return this.status();
  }

  async verifiedRecoveryStatus() {
    await this._requireReady({ allowMigrationSource: true });
    return this.status();
  }

  async verifiedActiveIdentity() {
    await this._requireReady();
    return this.store.verifiedActiveIdentity();
  }

  async verifyReleaseIdentity(identity, { allowMigrationSource = false } = {}) {
    if (allowMigrationSource) {
      const store = await this._prepareStoreAndBundle();
      return store.verifyReleaseIdentity(identity, { allowMigrationSource: true });
    }
    await this._requireReady();
    return this.store.verifyReleaseIdentity(identity);
  }

  async previewPackage(packagePath) {
    const { state: current } = await this._requireReady({ allowMigrationSource: true });
    if (!this.trustConfigured) {
      fail("TRUST_ROOT_UNCONFIGURED", "正式发布签名公钥尚未配置，拒绝读取标准更新包");
    }
    const bytes = readPlainFile(packagePath, {
      label: "标准更新包",
      maxBytes: DEFAULT_LIMITS.envelopeBytes,
      expectedExtension: ".oakstd",
      fsImpl: this.fs,
    });
    const verified = await this.store.verifyEnvelope(bytes, {
      enforceCompatibility: true,
      enforceExpiry: true,
      runPayloadValidation: true,
    });
    if (verified.manifest.bundle_id !== current.active.bundle_id ||
        verified.manifest.release_sequence <= current.highest_seen_sequence) {
      fail("STANDARD_UPDATE_NOT_NEWER", "标准更新包不是当前标准库的更高 release_sequence");
    }
    return {
      package_path: packagePath,
      envelope_sha256: sha256(bytes),
      manifest_sha256: verified.manifestSha256,
      expected_active_manifest_sha256: current.active.manifest_sha256,
      bundle_id: verified.manifest.bundle_id,
      release_sequence: verified.manifest.release_sequence,
      version: verified.manifest.version,
      released_at: verified.manifest.released_at,
      change_summary: [...verified.manifest.change_summary],
    };
  }

  async importPackage(packagePath, expected = null) {
    const { state: current } = await this._requireReady({ allowMigrationSource: true });
    if (!this.trustConfigured) {
      fail("TRUST_ROOT_UNCONFIGURED", "正式发布签名公钥尚未配置，拒绝导入标准更新包");
    }
    const bytes = readPlainFile(packagePath, {
      label: "标准更新包",
      maxBytes: DEFAULT_LIMITS.envelopeBytes,
      expectedExtension: ".oakstd",
      fsImpl: this.fs,
    });
    if (expected !== null) {
      if (!expected || typeof expected !== "object" ||
          expected.expected_active_manifest_sha256 !== current.active.manifest_sha256 ||
          expected.envelope_sha256 !== sha256(bytes)) {
        fail("STANDARD_UPDATE_PREVIEW_STALE", "标准更新预览已失效，请重新选择并确认");
      }
      const verified = await this.store.verifyEnvelope(bytes, {
        enforceCompatibility: true,
        enforceExpiry: true,
        runPayloadValidation: true,
      });
      if (verified.manifestSha256 !== expected.manifest_sha256) {
        fail("STANDARD_UPDATE_PREVIEW_STALE", "标准更新 manifest 与预览不一致");
      }
    }
    const state = await this.store.install(bytes);
    const { verified } = await this.store.verifyActive();
    return {
      active: state.active,
      previous: state.previous,
      change_summary: [...verified.manifest.change_summary],
    };
  }

  async previewRollback() {
    const { state } = await this._requireReady();
    if (state.previous === null) fail("NO_ROLLBACK_TARGET", "当前没有可回滚的上一标准包");
    return {
      expected_active_manifest_sha256: state.active.manifest_sha256,
      expected_previous_manifest_sha256: state.previous.manifest_sha256,
      active: state.active,
      target: state.previous,
      highest_seen_sequence: state.highest_seen_sequence,
    };
  }

  async rollback(expected = null) {
    const { state: current } = await this._requireReady();
    if (expected !== null && (!expected || typeof expected !== "object" ||
        expected.expected_active_manifest_sha256 !== current.active.manifest_sha256 ||
        expected.expected_previous_manifest_sha256 !== current.previous?.manifest_sha256)) {
      fail("STANDARD_ROLLBACK_PREVIEW_STALE", "标准回滚预览已失效，请重新确认");
    }
    const state = await this.store.rollback();
    await this.store.verifyActive();
    return { active: state.active, previous: state.previous };
  }
}

module.exports = {
  BUNDLED_STANDARD_RELEASE,
  StandardsProvider,
  StandardsProviderError,
  publicError,
  readPlainFile,
};
