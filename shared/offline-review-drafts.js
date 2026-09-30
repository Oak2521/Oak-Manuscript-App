(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./offline-review-core")());
  else root.OakReviewDrafts = factory(root.createOakOfflineReviewCodec());
})(globalThis, function (core) {
  "use strict";
  const MAX_BYTES = 256 * 1024;
  const decisions = new Set(["unreviewed", "needs_review", "agree", "disagree"]);
  function exact(value, keys, label) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) {
      throw new Error(label + " fields invalid");
    }
  }
  function createDraftStore(storage, verifiedPackage) {
    // Caller must first verify the envelope with the Node or Web Crypto adapter.
    core.validateStructure(verifiedPackage);
    const binding = JSON.parse(core.canonicalJson({
      payload_sha256: verifiedPackage.payload_sha256,
      report_identity: verifiedPackage.payload.report_identity,
      source_identity: verifiedPackage.payload.source_identity,
      rulepack: verifiedPackage.payload.rulepack,
    }));
    const issueIds = new Set(verifiedPackage.payload.issues.map(i => i.issue_id));
    const key = "oak.review.draft.v1." + binding.payload_sha256;
    let observed = storage.getItem(key);
    function empty() {
      return { schema_version:"1.0", record_type:"oak_review_opinion_draft",
        binding, revision:0, opinions:[] };
    }
    function validate(draft) {
      exact(draft, ["schema_version","record_type","binding","revision","opinions"],"draft");
      if (draft.schema_version !== "1.0" || draft.record_type !== "oak_review_opinion_draft") throw new Error("draft schema");
      if (core.canonicalJson(draft.binding) !== core.canonicalJson(binding)) throw new Error("draft binding mismatch");
      if (!Number.isSafeInteger(draft.revision) || draft.revision < 0) throw new Error("draft revision");
      if (!Array.isArray(draft.opinions) || draft.opinions.length > issueIds.size) throw new Error("draft opinions limit");
      const seen = new Set();
      for (const opinion of draft.opinions) {
        exact(opinion, ["issue_id","decision","note"],"opinion");
        if (!issueIds.has(opinion.issue_id) || seen.has(opinion.issue_id)) throw new Error("draft issue identity");
        seen.add(opinion.issue_id);
        if (!decisions.has(opinion.decision)) throw new Error("draft decision");
        if (typeof opinion.note !== "string" || opinion.note.length > 4000 ||
            core.encode(opinion.note).length > 8192) throw new Error("draft note limit");
      }
      return draft;
    }
    function decode(raw) {
      if (raw === null) return empty();
      const draft = core.parseBoundedJson(raw, MAX_BYTES);
      validate(draft);
      if (core.canonicalJson(draft) !== raw) throw new Error("draft non-canonical");
      return draft;
    }
    return Object.freeze({
      key,
      load() {
        const raw = storage.getItem(key);
        const draft = decode(raw);
        observed = raw;
        return draft;
      },
      save(issueId, decision, note) {
        const current = storage.getItem(key);
        if (current !== observed) throw new Error("draft conflict: reopen the report before saving");
        const draft = decode(current);
        const opinion = {issue_id:issueId, decision, note};
        const index = draft.opinions.findIndex(o => o.issue_id === issueId);
        if (index < 0) draft.opinions.push(opinion);
        else draft.opinions[index] = opinion;
        draft.revision++;
        validate(draft);
        draft.opinions.sort((a,b) => a.issue_id.localeCompare(b.issue_id, "en"));
        const raw = core.canonicalJson(draft);
        if (core.encode(raw).length > MAX_BYTES) throw new Error("draft bytes limit");
        storage.setItem(key, raw); // one synchronous replacement, on every edit, not on unload
        if (storage.getItem(key) !== raw) throw new Error("draft write verification failed");
        observed = raw;
        return draft;
      },
    });
  }
  return Object.freeze({ createDraftStore });
});
