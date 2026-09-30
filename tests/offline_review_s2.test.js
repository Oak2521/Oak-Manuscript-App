"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto } = require("node:crypto");

function browserCodec() {
  const sandbox = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, crypto: webcrypto });
  for (const file of ["offline-review-core.js", "offline-review-browser.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../shared", file), "utf8"), sandbox);
  }
  const realmValue = vm.runInContext("(text) => JSON.parse(text)", sandbox);
  return {
    serializeOfflineReviewPackage: sandbox.OakOfflineReview.serializeOfflineReviewPackage,
    parseOfflineReviewPackage(bytes, expected) {
      return sandbox.OakOfflineReview.parseOfflineReviewPackage(bytes,
        expected === undefined ? undefined : realmValue(JSON.stringify(expected)));
    },
  };
}

test("deep JSON is rejected with a bounded-input error before recursive canonicalization", () => {
  const node = require("../shared/offline-review-package");
  const bytes = Buffer.from("[".repeat(10000) + "0" + "]".repeat(10000));
  assert.throws(() => node.parseOfflineReviewPackage(bytes), /depth.*32/);
});

test("UTF-8 BOM cannot be silently removed before canonical byte comparison", () => {
  const node = require("../shared/offline-review-package");
  const { syntheticReport, SOURCE_IDENTITY } = require("../samples/offline-review-synthetic");
  const bytes = node.serializeOfflineReviewPackage(node.buildOfflineReviewPackage(syntheticReport(), SOURCE_IDENTITY));
  assert.throws(() => node.parseOfflineReviewPackage(Buffer.concat([Buffer.from([239,187,191]),bytes])), /BOM|canonical/);
});

test("Node and browser without Buffer or require agree on valid and hostile bytes", async () => {
  const node = require("../shared/offline-review-package");
  const { syntheticReport, SOURCE_IDENTITY } = require("../samples/offline-review-synthetic");
  const browser = browserCodec();
  const good = node.serializeOfflineReviewPackage(node.buildOfflineReviewPackage(syntheticReport(), SOURCE_IDENTITY));
  const parsed = await browser.parseOfflineReviewPackage(new Uint8Array(good));
  assert.equal(parsed.payload.issues[0].rule_id, "DOCX-SPACE-001");
  assert.deepEqual(Buffer.from(await browser.serializeOfflineReviewPackage(parsed)), good);
  const vectors = [
    Buffer.concat([Buffer.from([239,187,191]),good]), Buffer.from([195,40]),
    Buffer.concat([Buffer.from(" "),good]),
    Buffer.from(good.toString().replace('"schema_version":"1.0"}', '"schema_version":"2.0"}')),
    Buffer.from(good.toString().replace('"schema_version":"1.0"}', '"schema_version":"1.0","schema_version":"1.0"}')),
    Buffer.from(good.toString().replace('"payload":{', '"extra":true,"payload":{')),
    Buffer.from(good.toString().replace('"payload_sha256":"', '"payload_sha256":"0')),
    Buffer.from("[".repeat(10000)+"0"+"]".repeat(10000)),
    Buffer.alloc(2*1024*1024+1,32),
  ];
  for (const bytes of vectors) {
    assert.throws(() => node.parseOfflineReviewPackage(bytes));
    await assert.rejects(() => browser.parseOfflineReviewPackage(new Uint8Array(bytes)));
  }
  await assert.rejects(() => browser.parseOfflineReviewPackage(new Uint8Array(good), {source_sha256:"0".repeat(64)}), /source/);
});

test("draft edits persist immediately, reopen separately and cannot attach to a different report", () => {
  const node = require("../shared/offline-review-package");
  const { syntheticReport, SOURCE_IDENTITY } = require("../samples/offline-review-synthetic");
  const { createDraftStore } = require("../shared/offline-review-drafts");
  const pkg = node.buildOfflineReviewPackage(syntheticReport(), SOURCE_IDENTITY);
  const before = node.serializeOfflineReviewPackage(pkg);
  const data = new Map();
  const storage = { getItem:k=>data.get(k)??null, setItem:(k,v)=>data.set(k,v) };
  const first = createDraftStore(storage, pkg);
  first.save(pkg.payload.issues[0].issue_id, "needs_review", "请编辑复核这个定位。");
  const second = createDraftStore(storage, pkg);
  assert.equal(second.load().opinions[0].note, "请编辑复核这个定位。");
  assert.equal(second.load().opinions[0].decision, "needs_review");
  assert.deepEqual(node.serializeOfflineReviewPackage(pkg),before);
  assert.throws(()=>second.save("unrelated-issue","needs_review","wrong"),/issue/);
  const other = structuredClone(pkg); other.payload_sha256="f".repeat(64);
  const wrong = createDraftStore(storage,other);
  storage.setItem(wrong.key,storage.getItem(first.key));
  assert.throws(()=>wrong.load(),/binding/);
  const failing = createDraftStore({getItem:()=>null,setItem:()=>{throw Error("quota");}}, pkg);
  assert.throws(()=>failing.save(pkg.payload.issues[0].issue_id,"needs_review","unsaved"),/quota/);
});

test("stale draft writers detect a revision conflict instead of losing newer opinions", () => {
  const node = require("../shared/offline-review-package");
  const { syntheticReport, SOURCE_IDENTITY } = require("../samples/offline-review-synthetic");
  const { createDraftStore } = require("../shared/offline-review-drafts");
  const pkg = node.buildOfflineReviewPackage(syntheticReport(), SOURCE_IDENTITY);
  const data=new Map(); const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  const a=createDraftStore(storage,pkg), b=createDraftStore(storage,pkg);
  a.load(); b.load();
  a.save(pkg.payload.issues[0].issue_id,"needs_review","first");
  assert.throws(()=>b.save(pkg.payload.issues[0].issue_id,"disagree","stale"),/conflict/);
  assert.equal(createDraftStore(storage,pkg).load().opinions[0].note,"first");
});

test("JSON guards bound wide graphs, reject cycles and handle braces inside escaped strings", () => {
  const core = require("../shared/offline-review-core")();
  const nestedText=JSON.stringify({text:'"escaped" [ { \\\\ ] }'});
  assert.equal(core.parseBoundedJson(nestedText).text,'"escaped" [ { \\\\ ] }');
  assert.throws(()=>core.parseBoundedJson("[".repeat(33)+"0"+"]".repeat(33)),/depth/);
  const wide=JSON.stringify(Array.from({length:150},()=>Array(2000).fill(0)));
  assert.throws(()=>core.parseBoundedJson(wide),/node count/);
  const cyclic={};cyclic.self=cyclic;
  assert.throws(()=>core.canonicalJson(cyclic),/depth/);
  assert.throws(()=>core.canonicalJson({get field(){throw Error("must not execute getter");}}),/accessor/);
});
