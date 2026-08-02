"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { EncryptedLicenseStore, MAGIC, STATE_FILE } = require("../electron/license-store");

const ROOT = path.resolve(__dirname, "..");

function state(revision = 1) {
  return {
    schema_version: "1.0",
    store_type: "oak_manuscript_license_cache",
    revision,
    device_id: "device-10000000-0000-4000-8000-000000000001",
    entitlement: null,
  };
}

test("license cache uses encrypted canonical atomic storage with revision CAS", () => {
  fs.mkdirSync(path.join(ROOT, "out"), { recursive: true });
  const parent = fs.mkdtempSync(path.join(ROOT, "out", "license-store-"));
  try {
    const store = new EncryptedLicenseStore({
      rootDir: path.join(parent, "license"),
      protect: (plaintext) => Buffer.from(plaintext, "utf8").reverse(),
      unprotect: (ciphertext) => Buffer.from(ciphertext).reverse().toString("utf8"),
    });
    assert.equal(store.encrypted, true);
    assert.equal(store.load(), null);
    assert.deepEqual(store.save(state(), { expectedRevision: 0 }), state());
    assert.deepEqual(store.load(), state());
    assert.throws(() => store.save(state(2), { expectedRevision: 0 }), /revision/);
    assert.deepEqual(store.save(state(2), { expectedRevision: 1 }), state(2));
    const bytes = fs.readFileSync(path.join(parent, "license", STATE_FILE));
    assert.equal(bytes.subarray(0, MAGIC.length).equals(MAGIC), true);
    assert.equal(bytes.includes(Buffer.from("account", "utf8")), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
test("license cache rejects tampering instead of falling back to plaintext or empty state", () => {
  fs.mkdirSync(path.join(ROOT, "out"), { recursive: true });
  const parent = fs.mkdtempSync(path.join(ROOT, "out", "license-store-"));
  try {
    const store = new EncryptedLicenseStore({
      rootDir: path.join(parent, "license"),
      protect: (plaintext) => Buffer.from(plaintext, "utf8"),
      unprotect: (ciphertext) => Buffer.from(ciphertext).toString("utf8"),
    });
    store.save(state(), { expectedRevision: 0 });
    const target = path.join(parent, "license", STATE_FILE);
    const bytes = fs.readFileSync(target);
    bytes[0] ^= 0xff;
    fs.writeFileSync(target, bytes);
    assert.throws(() => store.load(), /文件头|权益缓存/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
