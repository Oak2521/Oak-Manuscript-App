(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory(require("./offline-review-core")(),require("./offline-review-drafts"),root.crypto);
  else root.OakReviewReturn=factory(root.createOakOfflineReviewCodec(),root.OakReviewDrafts,root.crypto);
})(globalThis,function(core,drafts,crypto){
  "use strict";
  const MAX_BYTES=256*1024,MAX_INBOX_BYTES=1024*1024,MAX_RECEIPTS=16;
  const VALID_MS=7*86400000,FUTURE_SKEW_MS=300000;
  const clone=x=>JSON.parse(core.canonicalJson(x));
  const fail=message=>{throw Error(message);};
  function exact(x,keys,label){
    if(!x||typeof x!=="object"||Array.isArray(x)||Object.keys(x).length!==keys.length||keys.some(k=>!Object.hasOwn(x,k)))fail(label+" fields");
  }
  function instant(s){
    if(typeof s!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString()!==s)fail("timestamp");
    return Date.parse(s);
  }
  function time(n){if(!Number.isSafeInteger(n)||n<0)fail("clock");return n;}
  async function hash(text){
    if(!crypto?.subtle)fail("Web Crypto unavailable");
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",core.encode(text))),b=>b.toString(16).padStart(2,"0")).join("");
  }
  async function verifyPackage(pkg){
    core.validateStructure(pkg);
    core.assertPayloadHash(pkg,await hash(core.canonicalJson(pkg.payload)));
  }
  function validateDraft(draft,pkg){
    // Reuse the existing canonical draft reader: no second opinions/binding schema.
    const raw=core.canonicalJson(draft);
    const result=drafts.createDraftStore({getItem:()=>raw},pkg).load();
    if(result.revision<1||result.opinions.length===0)fail("empty draft");
    return result;
  }
  function windowCheck(payload,now){
    now=time(now);
    if(instant(payload.created_at)>now+FUTURE_SKEW_MS)fail("response from future");
    if(now>=instant(payload.expires_at))fail("response expired");
  }
  async function validateResponse(response,pkg,now,checkWindow){
    exact(response,["schema_version","record_type","payload","payload_sha256"],"response");
    if(response.schema_version!=="1.0"||response.record_type!=="oak_review_response")fail("response schema");
    exact(response.payload,["created_at","expires_at","draft"],"response payload");
    if(instant(response.payload.expires_at)-instant(response.payload.created_at)!==VALID_MS)fail("expiry window");
    await verifyPackage(pkg);
    validateDraft(response.payload.draft,pkg);
    if(typeof response.payload_sha256!=="string"||!/^[a-f0-9]{64}$/.test(response.payload_sha256)||
      response.payload_sha256!==await hash(core.canonicalJson(response.payload)))fail("response hash");
    if(checkWindow)windowCheck(response.payload,now);
    return response;
  }
  function encodeResponse(response){
    const bytes=core.encode(core.canonicalJson(response)+"\n");
    if(bytes.length>MAX_BYTES)fail("response bytes limit");
    return bytes;
  }
  async function read(bytes,pkg,now,checkWindow=true){
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_BYTES)fail("response bytes limit");
    const copy=new Uint8Array(bytes);
    if(copy[0]===239&&copy[1]===187&&copy[2]===191)fail("BOM");
    let raw;try{raw=new TextDecoder("utf-8",{fatal:true}).decode(copy);}catch{fail("UTF-8");}
    const response=core.parseBoundedJson(raw,MAX_BYTES);
    if(raw!==core.canonicalJson(response)+"\n")fail("response non-canonical or duplicate key");
    return validateResponse(response,pkg,now,checkWindow);
  }
  async function exportResponse(pkg,draft,now=Date.now()){
    const p=clone(pkg),d=clone(draft);time(now);
    await verifyPackage(p);validateDraft(d,p);
    const payload={created_at:new Date(now).toISOString(),expires_at:new Date(now+VALID_MS).toISOString(),draft:d};
    const response={schema_version:"1.0",record_type:"oak_review_response",payload,payload_sha256:await hash(core.canonicalJson(payload))};
    return encodeResponse(response);
  }
  function createInbox(storage,verifiedPackage,clock=()=>Date.now()){
    const pkg=clone(verifiedPackage);core.validateStructure(pkg);
    const key="oak.review.return.inbox.v1."+pkg.payload_sha256;
    const tickets=new WeakMap();let confirming=false;
    const empty=()=>({schema_version:"1.0",record_type:"oak_review_return_inbox",report_payload_sha256:pkg.payload_sha256,receipts:[]});
    function view(receipt){return clone({response_id:receipt.response.payload_sha256,status:"pending_review",received_at:receipt.received_at,
      revision:receipt.response.payload.draft.revision,expires_at:receipt.response.payload.expires_at,opinions:receipt.response.payload.draft.opinions});}
    async function decode(raw){
      if(raw===null)return empty();
      const data=core.parseBoundedJson(raw,MAX_INBOX_BYTES);
      if(core.canonicalJson(data)!==raw)fail("inbox non-canonical");
      exact(data,["schema_version","record_type","report_payload_sha256","receipts"],"inbox");
      if(data.schema_version!=="1.0"||data.record_type!=="oak_review_return_inbox"||data.report_payload_sha256!==pkg.payload_sha256)fail("inbox binding/schema");
      if(!Array.isArray(data.receipts)||data.receipts.length>MAX_RECEIPTS)fail("inbox count limit");
      let revision=0;
      for(const receipt of data.receipts){
        exact(receipt,["received_at","status","response"],"receipt");
        if(receipt.status!=="pending_review")fail("receipt status");
        await read(encodeResponse(receipt.response),pkg,instant(receipt.received_at),false);
        windowCheck(receipt.response.payload,instant(receipt.received_at));
        if(receipt.response.payload.draft.revision<=revision)fail("inbox revision replay");
        revision=receipt.response.payload.draft.revision;
      }
      return data;
    }
    function rejectReplay(data,response){
      if(data.receipts.some(r=>r.response.payload_sha256===response.payload_sha256))fail("response replay");
      if(data.receipts.some(r=>r.response.payload.draft.revision>=response.payload.draft.revision))fail("stale draft revision");
    }
    return Object.freeze({
      key,
      async load(){const raw=storage.getItem(key),data=await decode(raw);return data.receipts.map(view);},
      async preview(bytes){
        if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_BYTES)fail("response bytes limit");
        const raw=storage.getItem(key),copy=new Uint8Array(bytes);
        if(copy.length>MAX_BYTES)fail("response bytes limit");
        const response=await read(copy,pkg,time(clock())),data=await decode(raw);
        rejectReplay(data,response);
        const ticket=view({received_at:null,response});
        tickets.set(ticket,{bytes:copy,raw});
        return ticket;
      },
      async confirm(ticket,confirmed){
        if(confirmed!==true)fail("explicit confirmation required");
        const pending=tickets.get(ticket);if(!pending)fail("invalid preview ticket");
        if(confirming)fail("confirmation in progress");confirming=true;
        try{
          if(storage.getItem(key)!==pending.raw)fail("inbox conflict: preview again");
          const response=await read(pending.bytes,pkg,time(clock())),data=await decode(pending.raw);
          rejectReplay(data,response);
          const now=time(clock());windowCheck(response.payload,now);
          if(data.receipts.length>=MAX_RECEIPTS)fail("inbox count limit");
          data.receipts.push({received_at:new Date(now).toISOString(),status:"pending_review",response});
          const raw=core.canonicalJson(data);
          if(core.encode(raw).length>MAX_INBOX_BYTES)fail("inbox bytes limit");
          if(storage.getItem(key)!==pending.raw)fail("inbox conflict: preview again");
          storage.setItem(key,raw);
          if(storage.getItem(key)!==raw)fail("inbox write verification failed");
          tickets.delete(ticket);
          return view(data.receipts[data.receipts.length-1]);
        }finally{confirming=false;}
      },
    });
  }
  return Object.freeze({MAX_BYTES,VALID_MS,exportResponse,createInbox});
});
