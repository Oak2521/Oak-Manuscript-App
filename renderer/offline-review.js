(function () {
  "use strict";
  const codec = globalThis.OakOfflineReview;
  const core = globalThis.createOakOfflineReviewCodec();
  const byId = id => document.getElementById(id);
  const CACHE_KEY = "oak.review.last-package.v1";
  let generation = 0, store = null, switchBlocked = false;
  const unsaved = new Set();
  const fixedDescriptions = Object.freeze({
    "DOCX-SPACE-001":"空白提示：请结合稿件排版意图复核。",
    "REF-003":"引用提示：编号区间与并列引用须人工复核。",
  });
  const coverageLabels = Object.freeze({
    semantic_rewriting:"语义改写", external_standard_completeness:"外部标准完整性",
    numbered_citation_ranges_and_lists:"编号引用区间与并列", complex_author_year_citations:"复杂作者年份引用",
    document_visual_fidelity:"文档版式保真", reference_truth:"文献真实性",
    full_markdown_conformance:"完整 Markdown 规范", layout_reconstruction:"版式重建",
  });
  function status(id,text,state) {
    byId(id).textContent=text;
    byId(id).dataset.state=state;
  }
  function append(parent,tag,text,className) {
    const element=document.createElement(tag);
    element.textContent=text;
    if(className)element.className=className;
    parent.append(element);
    return element;
  }
  function render(pkg, draft) {
    const p=pkg.payload;
    byId("summary").textContent=p.document.format.toUpperCase()+" · "+p.issues.length+" 项规则提示 · "+p.status.level;
    byId("identity").textContent="检查 "+p.check.check_id+" / 报告 "+p.report_identity.canonical_sha256;
    byId("coverage").textContent=p.format_coverage
      ? "已运行规则 "+p.format_coverage.rule_ids.join("、")+"；未覆盖 "+p.format_coverage.not_checked.map(k=>coverageLabels[k]||"其他检查项").join("、")
      : "此包未附文本格式覆盖记录。";
    byId("issues").replaceChildren();
    for(const issue of p.issues) {
      const row=document.createElement("article");row.className="issue-row";
      row.dataset.issueId=issue.issue_id;
      const head=append(row,"div","","issue-head");
      append(head,"h3",issue.rule_id);
      append(head,"span",issue.severity,"badge");
      append(row,"p",fixedDescriptions[issue.rule_id] || "规则提示需人工核对，请使用对应版本的规则说明。");
      const loc=issue.location;
      append(row,"p",[loc.part,loc.paragraph===null?null:"段落 "+loc.paragraph,
        loc.line===null?null:"行 "+loc.line,loc.note_id===null?null:"注 "+loc.note_id,
        loc.resource_sha256===null?null:"资源标识 "+loc.resource_sha256].filter(Boolean).join(" · "),"location");
      append(row,"p","原报告状态："+issue.status+"；标准："+issue.standard_refs.join("、"),"muted");
      const label=append(row,"label","我的意见");
      const select=document.createElement("select");label.append(select);
      for(const [value,text] of [["unreviewed","尚未审阅"],["needs_review","请编辑复核"],["agree","赞同提示"],["disagree","不同意提示"]]) {
        const option=document.createElement("option");option.value=value;option.textContent=text;select.append(option);
      }
      const noteLabel=append(row,"label","补充说明（仅本机草稿）");
      const note=document.createElement("textarea");note.maxLength=4000;noteLabel.append(note);
      const previous=draft.opinions.find(o=>o.issue_id===issue.issue_id);
      if(previous){select.value=previous.decision;note.value=previous.note;}
      function save() {
        unsaved.add(issue.issue_id);
        try {
          store.save(issue.issue_id,select.value,note.value);
          unsaved.delete(issue.issue_id);
          status("draft-status",unsaved.size?"仍有其他意见未保存。":"意见已保存到本机；可关闭后重开。",
            unsaved.size?"error":"saved");
          if(!unsaved.size && switchBlocked) {
            switchBlocked=false;
            status("load-status","当前报告已保留，意见已保存；现在可切换报告。","saved");
          }
        } catch(error) {
          status("draft-status","未保存，当前输入仍在页面中："+error.message,"error");
        }
      }
      select.addEventListener("change",save);note.addEventListener("input",save);
      byId("issues").append(row);
    }
    byId("review-panel").hidden=false;
  }
  async function openBytes(bytes, remember, ticket) {
    const pkg=await codec.parseOfflineReviewPackage(bytes);
    if(ticket!==generation)return;
    if(unsaved.size)throw Error("仍有未保存意见，已保留当前报告");
    let draftStore, draft;
    try {
      draftStore=OakReviewDrafts.createDraftStore(localStorage,pkg);
      draft=draftStore.load();
    } catch(error) {
      status("draft-status","草稿不可读，原存储内容已保留："+error.message,"error");
      throw error;
    }
    if(remember) {
      // Cache and opinions are separate records. Never rewrite the imported file.
      localStorage.setItem(CACHE_KEY,core.canonicalJson(pkg)+"\n");
      if(localStorage.getItem(CACHE_KEY)!==core.canonicalJson(pkg)+"\n")throw Error("报告缓存写入失败");
    }
    store=draftStore;unsaved.clear();render(pkg,draft);
    status("load-status","包校验完成，已打开 "+pkg.payload.issues.length+" 项规则提示。","saved");
    status("draft-status",draft.revision>0?"已恢复本机意见草稿。":"输入意见后立即保存到本机。",draft.revision>0?"saved":"ready");
  }
  byId("review-file").addEventListener("change",async function () {
    const file=this.files[0];if(!file)return;
    if(unsaved.size) {
      switchBlocked=true;
      status("load-status","仍有未保存意见；请先重试保存，再切换报告。","error");
      this.value="";
      return;
    }
    const ticket=++generation;
    try {
      if(file.size>codec.LIMITS.max_package_bytes)throw Error("审阅包超过 2 MiB");
      await openBytes(new Uint8Array(await file.arrayBuffer()),true,ticket);
    } catch(error) {
      if(ticket===generation)status("load-status","无法打开："+error.message,"error");
    } finally { this.value=""; }
  });
  addEventListener("beforeunload",event=>{
    if(unsaved.size){event.preventDefault();event.returnValue="";}
  });
  const bridge=globalThis.oakReviewDesktop;
  if(bridge) {
    byId("export-synthetic").hidden=false;
    status("export-status","按钮将合成包保存到本演示的独立 exports 目录；不会读取稿件。","ready");
    byId("export-synthetic").addEventListener("click",async function () {
      this.disabled=true;
      try {
        const result=await bridge.exportSyntheticReport();
        status("export-status","已导出 "+result.filename+"。请通过文件选择器打开。","saved");
      } catch(error) {status("export-status","导出失败："+error.message,"error");}
      finally {this.disabled=false;}
    });
  }
  (async function restore() {
    const ticket=generation;
    try {
      const raw=localStorage.getItem(CACHE_KEY);
      if(raw!==null) {
        if(raw.length>codec.LIMITS.max_package_bytes)throw Error("缓存超限");
        await openBytes(core.encode(raw),false,ticket);
      }
    } catch(error) { if(ticket===generation)status("load-status","本机缓存未恢复："+error.message,"error"); }
  })();
})();
