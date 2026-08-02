"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AIProvider } = require("../electron/ai-provider");
const { EncryptedAISettingsStore, STATE_FILE } = require("../electron/ai-settings-store");

const KEY = crypto.createHash("sha256").update("oak-ai-settings-test-key").digest();
const PRO = Object.freeze({ effectiveTier: "pro" });

function root(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "oak-ai-settings-"));
  t.after(() => fs.rmSync(value, { recursive: true, force: true }));
  return value;
}

function protect(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function unprotect(ciphertext) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, ciphertext.subarray(0, 12));
  decipher.setAuthTag(ciphertext.subarray(12, 28));
  return Buffer.concat([decipher.update(ciphertext.subarray(28)), decipher.final()]).toString("utf8");
}

function store(directory) {
  return new EncryptedAISettingsStore({ rootDir: directory, protect, unprotect });
}

test("AI settings and credential survive restart only as OS-encrypted bytes", (t) => {
  const directory = root(t);
  const secret = "sk-restart-secret-must-not-appear";
  const first = new AIProvider({ requirePersistence: true });
  first.configurePersistence(store(directory));
  first.configure({
    mode: "byo", provider: "openai", model: "gpt-5-mini", base_url: null,
    credential_action: "replace", credential: secret,
  }, PRO);
  const bytes = fs.readFileSync(path.join(directory, STATE_FILE));
  for (const plaintext of [secret, "openai", "gpt-5-mini", "oak_manuscript_ai_settings"]) {
    assert.equal(bytes.includes(Buffer.from(plaintext)), false, plaintext);
  }

  const restarted = new AIProvider({ requirePersistence: true });
  const status = restarted.configurePersistence(store(directory));
  assert.equal(status.mode, "byo");
  assert.equal(status.has_credential, true);
  assert.equal(JSON.stringify(status).includes(secret), false);
});

test("tampering and revision conflicts fail closed", (t) => {
  const directory = root(t);
  const left = store(directory);
  const provider = new AIProvider({ requirePersistence: true });
  provider.configurePersistence(left);
  provider.configure({
    mode: "byo", provider: "ollama", model: "qwen3:8b", base_url: null,
    credential_action: "clear", credential: null,
  }, PRO);
  const stale = store(directory);
  const staleState = stale.load();
  provider.configure({
    mode: "off", provider: null, model: null, base_url: null,
    credential_action: "clear", credential: null,
  }, PRO);
  assert.throws(() => stale.save({ ...staleState, revision: staleState.revision + 1 }, {
    expectedRevision: staleState.revision,
  }), /revision/u);

  const file = path.join(directory, STATE_FILE);
  const bytes = fs.readFileSync(file);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(file, bytes);
  assert.throws(() => store(directory).load(), /解密/u);
});

test("unsafe roots and hard-linked state files are rejected", (t) => {
  assert.throws(() => new EncryptedAISettingsStore({
    rootDir: "relative", protect, unprotect,
  }), /绝对路径/u);
  const directory = root(t);
  const provider = new AIProvider({ requirePersistence: true });
  provider.configurePersistence(store(directory));
  provider.configure({
    mode: "byo", provider: "ollama", model: "qwen3:8b", base_url: null,
    credential_action: "clear", credential: null,
  }, PRO);
  const file = path.join(directory, STATE_FILE);
  const link = path.join(directory, "settings-copy.enc");
  try { fs.linkSync(file, link); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error && error.code)) {
      t.skip(`当前文件系统不允许创建硬链接：${error.code}`);
      return;
    }
    throw error;
  }
  assert.throws(() => store(directory).load(), /单链接/u);
});
