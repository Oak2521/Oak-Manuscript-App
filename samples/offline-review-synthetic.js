"use strict";
// Synthetic only. Never contains a user manuscript.
const RULEPACK = Object.freeze({
  name: "oak-rules",
  version: "2.1.0",
  pinned: true,
  sha256: "b".repeat(64),
  bundle_id: "oak-standards/oak-rules",
  release_sequence: 21,
  manifest_sha256: "c".repeat(64),
});

function syntheticReport() {
  return {
    generated_at: "2026-09-11T00:30:00-04:00",
    app_version: "0.1.0-alpha.64",
    file: "C:\\Users\\Example Person\\Private Draft.docx",
    manuscript_type: "paper",
    check: {
      check_id: "check-synthetic-001",
      kind: "recheck",
      started_at: "2026-09-11T00:29:00-04:00",
      finished_at: "2026-09-11T00:29:03-04:00",
      app_version: "0.1.0-alpha.64",
      rulepack_version: "2.1.0",
      rulepack: RULEPACK,
      issue_counts: { error: 1, warning: 1, suggestion: 0 },
      result_file: "C:\\Users\\Example Person\\project\\results\\check.json",
    },
    rulepack: RULEPACK,
    status_level: "尚未具备提交条件",
    pending_counts: { error: 1, warning: 0, suggestion: 0 },
    issues: [
      {
        issue_id: "check-synthetic-001-0001",
        rule_id: "DOCX-SPACE-001",
        profile: "paper",
        severity: "error",
        title: "连续空格",
        explanation: "Alice Example <alice@example.test> wrote this private note.",
        location: {
          part: "document",
          paragraph: 2,
          line: null,
          note_id: null,
          resource: null,
        },
        preview: "PRIVATE MANUSCRIPT EXCERPT",
        standard_refs: ["OAK-DOCX-STYLE-001"],
        auto_fixable: true,
        fix_id: "replace-private-text",
        confidence: "high",
        status: "open",
      },
      {
        issue_id: "check-synthetic-001-0002",
        rule_id: "REF-003",
        profile: "paper",
        severity: "warning",
        title: "参考文献未被正文引用",
        explanation: "A content-bearing explanation.",
        location: {
          part: "references",
          paragraph: 8,
          line: null,
          note_id: null,
          resource: "OEBPS/chapter-1.xhtml",
        },
        preview: "SECOND PRIVATE EXCERPT",
        standard_refs: ["GBT-7714-2025"],
        auto_fixable: false,
        fix_id: null,
        confidence: "medium",
        status: "resolved",
      },
    ],
    applied_fixes: [
      {
        rule_id: "DOCX-SPACE-001",
        fix_id: "replace-private-text",
        before: "PRIVATE BEFORE",
        after: "PRIVATE AFTER",
      },
    ],
    format_coverage: {
      schema_version: "1.1",
      format: "docx",
      status: "limited",
      rule_ids: ["DOCX-SPACE-001", "REF-003"],
      auto_fixable_rule_ids: ["DOCX-SPACE-001"],
      excluded_contexts: [],
      not_checked: [
        "semantic_rewriting",
        "external_standard_completeness",
        "numbered_citation_ranges_and_lists",
        "complex_author_year_citations",
        "document_visual_fidelity",
        "reference_truth",
      ],
      disclosure: "Private author note: Alice Example.",
    },
    skipped_rule_groups: [
      { milestone: "M2", reason: "本版本未实现" },
    ],
    external_tools: { epubcheck: "not_run", ace: "not_run" },
    external_tools_detail: {
      command: "C:\\Users\\Example Person\\bin\\tool.exe --private",
      stdout: "PRIVATE RAW TOOL OUTPUT",
    },
    citation_note: "Private author note.",
    unexpected_personal_info: "alice@example.test",
  };
}

const SOURCE_IDENTITY = Object.freeze({
  format: "docx",
  size_bytes: 12345,
  sha256: "a".repeat(64),
});


module.exports = { syntheticReport, SOURCE_IDENTITY };

