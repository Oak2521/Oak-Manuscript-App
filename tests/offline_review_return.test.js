"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {createHash}=require("node:crypto");
const codec=require("../shared/offline-review-package");
const core=require("../shared/offline-review-core")();
const drafts=require("../shared/offline-review-drafts");
const sample=require("../samples/offline-review-synthetic");
const NOW=Date.parse("2026-09-11T14:00:00.000Z");
const DAY=86400000;
function memory(){const values=new Map();return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};}
function setup(){
  const pkg=codec.buildOfflineReviewPackage(sample.syntheticReport(),sample.SOURCE_IDENTITY);
  const storage=memory(),store=drafts.createDraftStore(storage,pkg);
  store.save(pkg.payload.issues[0].issue_id,"needs_review","合成意见，请编辑复核。");
  return {pkg,storage,store,draft:store.load()};
}
function api(){
  assert.ok(fs.existsSync(require("node:path").join(__dirname,"../shared/offline-review-return.js")),"S3 response implementation is missing");
  return require("../shared/offline-review-return");
}
function encoded(value,resign=true){
  if(resign)value.payload_sha256=createHash("sha256").update(core.canonicalJson(value.payload)).digest("hex");
  return core.encode(core.canonicalJson(value)+"\n");
}
test("explicit confirmation alone persists a read-only receipt without changing report or draft",async()=>{
  const r=api(),s=setup(),disk=memory();
  const before=JSON.stringify([...s.storage.values]),source=codec.serializeOfflineReviewPackage(s.pkg);
  const bytes=await r.exportResponse(s.pkg,s.draft,NOW);
  const inbox=r.createInbox(disk,s.pkg,()=>NOW);
  const preview=await inbox.preview(bytes);
  assert.equal(preview.opinions[0].note,"合成意见，请编辑复核。");
  assert.equal(disk.values.size,0,"preview must not write");
  await assert.rejects(()=>inbox.confirm(preview,false),/confirmation/);
  assert.equal(disk.values.size,0);
  await inbox.confirm(preview,true);
  const reopened=await r.createInbox(disk,s.pkg,()=>NOW+8*DAY).load();
  assert.equal(reopened.length,1,"an accepted receipt survives subsequent expiry");
  assert.equal(reopened[0].status,"pending_review");
  assert.equal(reopened[0].opinions[0].note,"合成意见，请编辑复核。");
  assert.equal(JSON.stringify([...s.storage.values]),before);
  assert.deepEqual(codec.serializeOfflineReviewPackage(s.pkg),source);
});
test("wrong report, rule identity, issue, versions, tampering and oversized bytes are rejected",async()=>{
  const r=api(),s=setup(),bytes=await r.exportResponse(s.pkg,s.draft,NOW);
  const base=JSON.parse(new TextDecoder().decode(bytes));
  for(const change of [
    x=>x.payload.draft.binding.report_identity.canonical_sha256="d".repeat(64),
    x=>x.payload.draft.binding.rulepack.version="9.0.0",
    x=>x.payload.draft.opinions[0].issue_id="foreign-issue",
    x=>x.schema_version="2.0",
    x=>x.payload.draft.schema_version="2.0",
    x=>x.payload.draft.opinions[0].fix_id="forbidden",
  ]){const x=structuredClone(base);change(x);await assert.rejects(()=>r.createInbox(memory(),s.pkg,()=>NOW).preview(encoded(x)));}
  const tampered=structuredClone(base);tampered.payload.draft.opinions[0].note="changed";
  await assert.rejects(()=>r.createInbox(memory(),s.pkg,()=>NOW).preview(encoded(tampered,false)),/hash/);
  const inbox=r.createInbox(memory(),s.pkg,()=>NOW);
  for(const bad of [new Uint8Array(256*1024+1),core.encode("[".repeat(40)+"0"+"]".repeat(40)),
    core.encode(" "+new TextDecoder().decode(bytes)),new Uint8Array([239,187,191,...bytes]),
    core.encode(new TextDecoder().decode(bytes).replace('"schema_version":"1.0"}', '"schema_version":"1.0","schema_version":"1.0"}'))])await assert.rejects(()=>inbox.preview(bad));
});
test("expiry, future time and confirmation-time expiry fail closed",async()=>{
  const r=api(),s=setup(),bytes=await r.exportResponse(s.pkg,s.draft,NOW);
  await assert.rejects(()=>r.createInbox(memory(),s.pkg,()=>NOW+7*DAY).preview(bytes),/expired/);
  await assert.rejects(()=>r.createInbox(memory(),s.pkg,()=>NOW-600001).preview(bytes),/future/);
  let clock=NOW;const disk=memory(),inbox=r.createInbox(disk,s.pkg,()=>clock),ticket=await inbox.preview(bytes);
  clock=NOW+7*DAY;
  await assert.rejects(()=>inbox.confirm(ticket,true),/expired/);assert.equal(disk.values.size,0);
});
test("repeat responses and re-exported older revisions cannot replay after reopen",async()=>{
  const r=api(),s=setup(),disk=memory();let inbox=r.createInbox(disk,s.pkg,()=>NOW);
  const bytes=await r.exportResponse(s.pkg,s.draft,NOW),ticket=await inbox.preview(bytes);
  await inbox.confirm(ticket,true);inbox=r.createInbox(disk,s.pkg,()=>NOW+1000);
  await assert.rejects(()=>inbox.preview(bytes),/replay|revision/);
  const reexported=await r.exportResponse(s.pkg,s.draft,NOW+1000);
  await assert.rejects(()=>inbox.preview(reexported),/revision/);
  s.store.save(s.pkg.payload.issues[0].issue_id,"agree","修订意见");
  await inbox.confirm(await inbox.preview(await r.exportResponse(s.pkg,s.store.load(),NOW+1000)),true);
  assert.equal((await inbox.load()).length,2);
});
test("forged confirmation tickets, stale previews and storage failures preserve pending data",async()=>{
  const r=api(),s=setup(),disk=memory(),a=r.createInbox(disk,s.pkg,()=>NOW),b=r.createInbox(disk,s.pkg,()=>NOW);
  const bytes=await r.exportResponse(s.pkg,s.draft,NOW),ta=await a.preview(bytes),tb=await b.preview(bytes);
  await assert.rejects(()=>a.confirm({...ta},true),/ticket/);
  await a.confirm(ta,true);const saved=JSON.stringify([...disk.values]);
  await assert.rejects(()=>b.confirm(tb,true),/conflict|replay|revision/);
  assert.equal(JSON.stringify([...disk.values]),saved);
  const broken={getItem:()=>null,setItem:()=>{throw Error("quota");}},bad=r.createInbox(broken,s.pkg,()=>NOW);
  const t=await bad.preview(bytes);await assert.rejects(()=>bad.confirm(t,true),/quota/);
  assert.equal((await bad.load()).length,0);
});

test("preview rejects non-byte input before coercion and preserves receipts at capacity",async()=>{
  const r=api(),s=setup(),disk=memory(),inbox=r.createInbox(disk,s.pkg,()=>NOW);
  await assert.rejects(()=>inbox.preview({get length(){throw Error("coercion executed");}}),/bytes/);
  for(let i=0;i<16;i++){
    if(i)s.store.save(s.pkg.payload.issues[0].issue_id,"needs_review","意见"+i);
    await inbox.confirm(await inbox.preview(await r.exportResponse(s.pkg,s.store.load(),NOW)),true);
  }
  const before=JSON.stringify([...disk.values]);s.store.save(s.pkg.payload.issues[0].issue_id,"agree","第17份");
  await assert.rejects(()=>inbox.confirm(inbox.preview,true),/ticket/);
  await assert.rejects(async()=>inbox.confirm(await inbox.preview(await r.exportResponse(s.pkg,s.store.load(),NOW)),true),/count limit/);
  assert.equal(JSON.stringify([...disk.values]),before);
});
