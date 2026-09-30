(function(){
  "use strict";
  const $=id=>document.getElementById(id),core=createOakOfflineReviewCodec(),api=OakReviewReturn;
  const native=!!globalThis.oakReviewDesktop,CACHE="oak.review.return.last-report.v1";
  let pkg=null,draftStore=null,inbox=null,pending=null,generation=0,busy=false;
  const unsaved=new Set();
  function status(id,text,state="ready"){$(id).textContent=text;$(id).dataset.state=state;}
  function text(parent,tag,value,className){const e=document.createElement(tag);e.textContent=value;if(className)e.className=className;parent.append(e);return e;}
  function controls(){
    $("export-opinions").disabled=native||!pkg||busy||unsaved.size>0;
    $("response-file").disabled=!native||!pkg||busy;
    $("confirm-return").disabled=!pending||busy;$("cancel-return").disabled=!pending||busy;
    $("return-report-file").disabled=busy;
  }
  function clearPreview(){pending=null;$("response-preview").replaceChildren();controls();}
  function showOpinions(parent,opinions){
    for(const opinion of opinions){
      const issue=pkg.payload.issues.find(x=>x.issue_id===opinion.issue_id),row=text(parent,"article","","issue-row");
      text(row,"h3",issue.rule_id+" · "+issue.severity);
      text(row,"p",issue.location.part+" · 段落 "+(issue.location.paragraph??"—")+" · 行 "+(issue.location.line??"—"));
      text(row,"p","意见："+opinion.decision);text(row,"p",opinion.note);
    }
  }
  function showReceipts(receipts){
    $("return-receipts").replaceChildren();
    for(const receipt of receipts){
      const row=text($("return-receipts"),"article","","return-receipt");
      text(row,"h3","待审 · 修订 "+receipt.revision);
      text(row,"p",receipt.received_at);showOpinions(row,receipt.opinions);
    }
  }
  function renderDraft(draft){
    $("return-draft-issues").replaceChildren();
    for(const issue of pkg.payload.issues){
      const row=text($("return-draft-issues"),"article","","issue-row");
      text(row,"h3",issue.rule_id+" · "+issue.severity);
      text(row,"p",issue.location.part+" · 段落 "+(issue.location.paragraph??"—"));
      const label=text(row,"label","我的意见"),select=document.createElement("select");select.className="draft-decision";label.append(select);
      for(const[v,t]of [["unreviewed","尚未审阅"],["needs_review","请编辑复核"],["agree","赞同提示"],["disagree","不同意提示"]]){const o=text(select,"option",t);o.value=v;}
      const noteLabel=text(row,"label","意见文字（将包含在显式导出中）"),note=document.createElement("textarea");note.className="draft-note";note.maxLength=4000;noteLabel.append(note);
      const old=draft.opinions.find(o=>o.issue_id===issue.issue_id);if(old){note.value=old.note;select.value=old.decision;}
      function save(){
        unsaved.add(issue.issue_id);
        try{draftStore.save(issue.issue_id,select.value,note.value);unsaved.delete(issue.issue_id);
          status("return-draft-status",unsaved.size?"仍有意见未保存。":"草稿已保存到本机。",unsaved.size?"error":"saved");
        }catch(e){status("return-draft-status","未保存，当前输入仍保留："+e.message,"error");}
        controls();
      }
      note.addEventListener("input",save);select.addEventListener("change",save);
    }
    status("return-draft-status",draft.revision?"已恢复原草稿。":"输入意见后立即保存。",draft.revision?"saved":"ready");
  }
  async function openReport(bytes,remember){
    if(busy)throw Error("操作进行中");if(unsaved.size)throw Error("仍有未保存意见，不能切换报告");
    busy=true;const token=++generation;clearPreview();controls();
    status("return-report-status","正在校验报告……","loading");
    try{
      const next=await OakOfflineReview.parseOfflineReviewPackage(await bytes);
      const nextStore=OakReviewDrafts.createDraftStore(localStorage,next),draft=nextStore.load();
      const nextInbox=api.createInbox(localStorage,next),receipts=native?await nextInbox.load():[];
      if(token!==generation||unsaved.size)throw Error("报告已变化或存在未保存意见");
      if(remember){const raw=core.canonicalJson(next)+"\n";localStorage.setItem(CACHE,raw);if(localStorage.getItem(CACHE)!==raw)throw Error("报告缓存写入失败");}
      pkg=next;draftStore=nextStore;inbox=nextInbox;
      $("return-identity").textContent="检查 "+pkg.payload.check.check_id+" / 报告 "+pkg.payload.report_identity.canonical_sha256;
      $("return-draft-panel").hidden=native;$("return-desktop-panel").hidden=!native;
      if(native)showReceipts(receipts);else renderDraft(draft);
      status("return-report-status","报告校验完成。","saved");status("return-import-status","回导必须匹配当前报告、规则版本和递增草稿修订。");
    }finally{busy=false;controls();}
  }
  $("return-report-file").addEventListener("change",async function(){
    const f=this.files[0];if(!f)return;
    try{if(f.size>OakOfflineReview.LIMITS.max_package_bytes)throw Error("报告包超过 2 MiB");await openReport(f.arrayBuffer().then(b=>new Uint8Array(b)),true);}
    catch(e){status("return-report-status","未打开："+e.message,"error");}finally{this.value="";}
  });
  $("export-opinions").addEventListener("click",async()=>{
    if(native||!pkg||busy||unsaved.size)return;
    busy=true;controls();const token=generation;
    try{
      const draft=draftStore.load(),bytes=await api.exportResponse(pkg,draft);
      if(token!==generation||unsaved.size||draftStore.load().revision!==draft.revision)throw Error("草稿已变化，请重新导出");
      const url=URL.createObjectURL(new Blob([bytes],{type:"application/json"}));
      const a=document.createElement("a");a.href=url;a.download="oak-opinions-r"+draft.revision+".json";document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      status("return-download-status","已请求浏览器下载意见文件；实际保存以浏览器为准。原草稿已保留。","saved");
    }catch(e){status("return-download-status","未导出："+e.message,"error");}finally{busy=false;controls();}
  });
  $("response-file").addEventListener("change",async function(){
    const f=this.files[0];if(!f)return;
    clearPreview();status("return-import-status","正在校验意见……","loading");
    try{
      if(!native||!pkg||busy)throw Error("请在桌面打开对应报告");
      if(f.size>api.MAX_BYTES)throw Error("意见超过 256 KiB");
      busy=true;controls();const token=generation,owner=inbox;
      const ticket=await owner.preview(new Uint8Array(await f.arrayBuffer()));
      if(token!==generation||owner!==inbox)throw Error("报告已变化");
      pending=ticket;showOpinions($("response-preview"),ticket.opinions);
      text($("response-preview"),"p","修订 "+ticket.revision+"；有效至 "+ticket.expires_at);
      status("return-import-status","预览通过，尚未保存；请明确确认或取消。","preview");
    }catch(e){status("return-import-status","拒绝回导："+e.message,"error");}finally{busy=false;this.value="";controls();}
  });
  $("cancel-return").addEventListener("click",()=>{if(busy)return;clearPreview();status("return-import-status","已取消预览，没有写入待审记录。");});
  $("confirm-return").addEventListener("click",async()=>{
    if(!native||!pending||busy)return;busy=true;controls();
    try{await inbox.confirm(pending,true);clearPreview();showReceipts(await inbox.load());status("return-import-status","已存为待审；未改稿、未执行修复。","saved");}
    catch(e){status("return-import-status","未确认保存："+e.message,"error");}finally{busy=false;controls();}
  });
  if(native){
    $("return-desktop-panel").hidden=false;$("return-export-synthetic").hidden=false;
    $("return-export-synthetic").addEventListener("click",async function(){this.disabled=true;try{const r=await oakReviewDesktop.exportSyntheticReport();status("return-export-status","合成报告已导出到独立 exports："+r.filename,"saved");}catch(e){status("return-export-status",e.message,"error");}finally{this.disabled=false;}});
  }
  addEventListener("beforeunload",e=>{if(unsaved.size){e.preventDefault();e.returnValue="";}});
  (async()=>{try{const raw=localStorage.getItem(CACHE);if(raw!==null){if(raw.length>OakOfflineReview.LIMITS.max_package_bytes)throw Error("报告缓存超限");await openReport(core.encode(raw),false);}}catch(e){status("return-report-status","未恢复缓存："+e.message,"error");}})();
})();
