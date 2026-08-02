"use strict";

const crypto = require("node:crypto");
const { validateDesktopLicenseConfig } = require("./desktop-license-config");
const { DEVICE_PATTERN } = require("./license-http-client");
const { buildLicenseStatus } = require("./providers");

const ENVELOPE_KEYS = Object.freeze([
  "schema_version", "record_type", "key_id", "algorithm", "claims", "signature",
]);
const UNSIGNED_KEYS = Object.freeze(ENVELOPE_KEYS.filter((key) => key !== "signature"));
const CLAIM_KEYS = Object.freeze([
  "issuer", "audience", "entitlement_id", "account_id", "device_id", "tier",
  "device_state", "issued_at", "not_before", "valid_until", "grace_until",
]);
const ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ENTITLEMENT_PATTERN = /^ent-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function unsignedEnvelope(value) {
  const keys = Object.keys(value || {});
  if (!exactKeys(value, UNSIGNED_KEYS) && !exactKeys(value, ENVELOPE_KEYS)) {
    throw new Error("订阅权益凭证结构非法");
  }
  if (keys.includes("signature") && value.signature !== undefined && typeof value.signature !== "string") {
    throw new Error("订阅权益签名非法");
  }
  return {
    schema_version: value.schema_version,
    record_type: value.record_type,
    key_id: value.key_id,
    algorithm: value.algorithm,
    claims: value.claims,
  };
}

function canonicalEntitlementPayload(value) {
  return JSON.stringify(canonicalValue(unsignedEnvelope(value)));
}

function validateClaims(claims) {
  if (!exactKeys(claims, CLAIM_KEYS) || typeof claims.issuer !== "string" ||
      typeof claims.audience !== "string" || !ENTITLEMENT_PATTERN.test(claims.entitlement_id || "") ||
      !ACCOUNT_PATTERN.test(claims.account_id || "") || !DEVICE_PATTERN.test(claims.device_id || "") ||
      claims.tier !== "pro" || !["active", "revoked"].includes(claims.device_state) ||
      ![claims.issued_at, claims.not_before, claims.valid_until, claims.grace_until].every(canonicalTime)) {
    throw new Error("订阅权益 claims 非法");
  }
  if (Date.parse(claims.issued_at) > Date.parse(claims.not_before) ||
      Date.parse(claims.not_before) > Date.parse(claims.valid_until) ||
      Date.parse(claims.valid_until) > Date.parse(claims.grace_until)) {
    throw new Error("订阅权益有效期顺序非法");
  }
  return claims;
}

function verifyEntitlement(envelope, { config, accountId, deviceId } = {}) {
  const trusted = validateDesktopLicenseConfig(config);
  if (trusted.status !== "configured") throw new Error("生产订阅权益尚未配置");
  if (!exactKeys(envelope, ENVELOPE_KEYS) || envelope.schema_version !== "1.0" ||
      envelope.record_type !== "oak_manuscript_signed_entitlement" || envelope.algorithm !== "Ed25519" ||
      typeof envelope.key_id !== "string" || typeof envelope.signature !== "string") {
    throw new Error("订阅权益凭证结构非法");
  }
  const claims = validateClaims(envelope.claims);
  if (claims.issuer !== trusted.issuer || claims.audience !== trusted.audience ||
      claims.account_id !== accountId || claims.device_id !== deviceId) {
    throw new Error("订阅权益的发行方、受众、账号或设备绑定不匹配");
  }
  const key = trusted.trusted_keys.find((item) => item.key_id === envelope.key_id);
  if (!key) throw new Error("订阅权益使用了未知签名密钥");
  let signature;
  try { signature = Buffer.from(envelope.signature, "base64url"); } catch { signature = null; }
  if (!signature || signature.length !== 64 || signature.toString("base64url") !== envelope.signature) {
    throw new Error("订阅权益签名非法");
  }
  let publicKey;
  try { publicKey = crypto.createPublicKey({ key: key.public_key_jwk, format: "jwk" }); }
  catch { throw new Error("订阅权益受信公钥非法"); }
  if (!crypto.verify(null, Buffer.from(canonicalEntitlementPayload(envelope), "utf8"), publicKey, signature)) {
    throw new Error("订阅权益签名验证失败");
  }
  return Object.freeze({ ...claims });
}

function validateCacheState(value) {
  if (!exactKeys(value, ["schema_version", "store_type", "revision", "device_id", "entitlement"]) ||
      value.schema_version !== "1.0" || value.store_type !== "oak_manuscript_license_cache" ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 || !DEVICE_PATTERN.test(value.device_id || "") ||
      (value.entitlement !== null && (!value.entitlement || typeof value.entitlement !== "object" || Array.isArray(value.entitlement)))) {
    throw new Error("订阅权益缓存状态非法");
  }
  return value;
}

class ProductionLicenseProvider {
  constructor({ config, store, client, accessTokenProvider, authStatusProvider, clock = () => new Date(), deviceIdFactory = crypto.randomUUID } = {}) {
    this.config = validateDesktopLicenseConfig(config);
    if (this.config.status !== "configured") throw new TypeError("生产权益提供方需要完整配置");
    if (!store || store.encrypted !== true || typeof store.load !== "function" || typeof store.save !== "function" ||
        !client || typeof client.fetchEntitlement !== "function" || typeof accessTokenProvider !== "function" ||
        typeof authStatusProvider !== "function" || typeof clock !== "function" || typeof deviceIdFactory !== "function") {
      throw new TypeError("生产权益提供方依赖不完整");
    }
    this.store = store; this.client = client; this.accessTokenProvider = accessTokenProvider;
    this.authStatusProvider = authStatusProvider; this.clock = clock;
    const loaded = store.load();
    if (loaded === null) {
      const deviceId = `device-${deviceIdFactory()}`;
      if (!DEVICE_PATTERN.test(deviceId)) throw new Error("生成的设备标识非法");
      this.state = store.save({
        schema_version: "1.0", store_type: "oak_manuscript_license_cache", revision: 1,
        device_id: deviceId, entitlement: null,
      }, { expectedRevision: 0 });
    } else this.state = loaded;
    validateCacheState(this.state);
  }

  _base({ entitlementState, message, tier = "free", validUntil = null, graceUntil = null, signatureVerified = false, refreshAvailable = false } = {}) {
    return buildLicenseStatus({
      tier, entitlementState, validUntil, graceUntil, signatureVerified,
      productionConfigured: true, refreshAvailable, message,
    });
  }

  status() {
    const auth = this.authStatusProvider();
    const authenticated = auth && auth.state === "authenticated" && auth.loggedIn === true && ACCOUNT_PATTERN.test(auth.accountId || "");
    if (!authenticated) return this._base({ entitlementState: "signed_out", message: "登录湖岸账号后可显式刷新订阅权益；本地文件始终可访问。" });
    if (this.state.entitlement === null) return this._base({ entitlementState: "not_cached", refreshAvailable: true, message: "尚无本机订阅权益缓存；点击刷新后才会联网查询。" });
    let claims;
    try { claims = verifyEntitlement(this.state.entitlement, { config: this.config, accountId: auth.accountId, deviceId: this.state.device_id }); }
    catch { return this._base({ entitlementState: "invalid", refreshAvailable: true, message: "本机订阅权益无效或不属于当前账号；已安全降级 Free。" }); }
    const now = this.clock().getTime();
    let entitlementState;
    if (claims.device_state === "revoked") entitlementState = "revoked";
    else if (now < Date.parse(claims.not_before)) entitlementState = "not_yet_valid";
    else if (now <= Date.parse(claims.valid_until)) entitlementState = "active";
    else if (now <= Date.parse(claims.grace_until)) entitlementState = "grace";
    else entitlementState = "expired";
    return this._base({
      tier: "pro", entitlementState, validUntil: claims.valid_until, graceUntil: claims.grace_until,
      signatureVerified: true, refreshAvailable: true,
      message: ["active", "grace"].includes(entitlementState)
        ? `已验证账号与设备绑定的 Pro 权益（${entitlementState}）；本地文件始终可访问。`
        : `签名权益状态为 ${entitlementState}；Pro 新权益已停用，本地文件始终可访问。`,
    });
  }

  async refresh(authStatus) {
    const current = this.authStatusProvider();
    if (!authStatus || authStatus.state !== "authenticated" || authStatus.loggedIn !== true ||
        !current || current.state !== "authenticated" || current.loggedIn !== true ||
        authStatus.accountId !== current.accountId || !ACCOUNT_PATTERN.test(current.accountId || "")) {
      throw new Error("必须先登录稳定的湖岸账号才能刷新订阅权益");
    }
    const binding = await this.accessTokenProvider({ accountId: current.accountId });
    if (!binding || binding.accountId !== current.accountId || typeof binding.accessToken !== "string") {
      throw new Error("湖岸账号授权与当前账号不匹配");
    }
    const envelope = await this.client.fetchEntitlement({ accessToken: binding.accessToken, deviceId: this.state.device_id });
    const latest = this.authStatusProvider();
    if (!latest || latest.state !== "authenticated" || latest.loggedIn !== true ||
        latest.accountId !== current.accountId) {
      throw new Error("湖岸账号在订阅权益请求期间发生变化；未保存返回的权益");
    }
    verifyEntitlement(envelope, { config: this.config, accountId: latest.accountId, deviceId: this.state.device_id });
    const next = validateCacheState({ ...this.state, revision: this.state.revision + 1, entitlement: structuredClone(envelope) });
    this.state = validateCacheState(this.store.save(next, { expectedRevision: this.state.revision }));
    return this.status();
  }
}

module.exports = {
  ProductionLicenseProvider,
  canonicalEntitlementPayload,
  validateCacheState,
  verifyEntitlement,
};
