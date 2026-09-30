const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

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

function canonicalJson(value) {
  function sort(valueToSort) {
    if (Array.isArray(valueToSort)) {
      return valueToSort.map(sort);
    }
    if (valueToSort && typeof valueToSort === "object") {
      return Object.fromEntries(
        Object.keys(valueToSort)
          .sort()
          .map((key) => [key, sort(valueToSort[key])]),
      );
    }
    return valueToSort;
  }
  return JSON.stringify(sort(value));
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("builds a deterministic, content-free offline review package and reads it back", () => {
  const {
    buildOfflineReviewPackage,
    parseOfflineReviewPackage,
    serializeOfflineReviewPackage,
  } = require("../shared/offline-review-package");

  const report = syntheticReport();
  const first = buildOfflineReviewPackage(report, SOURCE_IDENTITY);
  const second = buildOfflineReviewPackage(syntheticReport(), SOURCE_IDENTITY);
  const firstBytes = serializeOfflineReviewPackage(first);
  const secondBytes = serializeOfflineReviewPackage(second);

  assert.deepEqual(firstBytes, secondBytes);
  assert.deepEqual(parseOfflineReviewPackage(firstBytes), first);
  assert.deepEqual(Object.keys(first), [
    "schema_version",
    "record_type",
    "payload",
    "payload_sha256",
  ]);
  assert.deepEqual(Object.keys(first.payload), [
    "source_identity",
    "report_identity",
    "rulepack",
    "document",
    "check",
    "status",
    "issues",
    "format_coverage",
    "skipped_rule_groups",
    "external_tools",
  ]);
  assert.equal(first.payload.source_identity.sha256, SOURCE_IDENTITY.sha256);
  assert.equal(first.payload.rulepack.manifest_sha256, RULEPACK.manifest_sha256);
  assert.equal(first.payload.issues[0].rule_id, "DOCX-SPACE-001");
  assert.match(first.payload.issues[1].location.resource_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(first.payload.issues[1].location.resource_sha256, digest("OEBPS/chapter-1.xhtml"));
  assert.match(first.payload.report_identity.canonical_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(first.payload.report_identity.canonical_sha256, digest(canonicalJson(report)));
  assert.match(first.payload_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(first.payload_sha256, digest(canonicalJson(first.payload)));
  assert.deepEqual(parseOfflineReviewPackage(firstBytes, {
    source_sha256: SOURCE_IDENTITY.sha256,
    report_canonical_sha256: first.payload.report_identity.canonical_sha256,
    rulepack: RULEPACK,
  }), first);

  const serialized = firstBytes.toString("utf8");
  for (const forbidden of [
    "PRIVATE MANUSCRIPT EXCERPT",
    "SECOND PRIVATE EXCERPT",
    "PRIVATE BEFORE",
    "PRIVATE AFTER",
    "PRIVATE RAW TOOL OUTPUT",
    "Alice Example",
    "alice@example.test",
    "C:\\\\Users",
    "external_tools_detail",
    "preview",
    "fix_id",
    '"title"',
    '"explanation"',
    '"disclosure"',
    '"reason"',
    '"file"',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

test("supports an EPUB report without pretending text-format coverage exists", () => {
  const {
    buildOfflineReviewPackage,
    parseOfflineReviewPackage,
    serializeOfflineReviewPackage,
  } = require("../shared/offline-review-package");
  const report = syntheticReport();
  report.format_coverage = null;
  report.external_tools = { epubcheck: "passed", ace: "failed" };
  const sourceIdentity = { ...SOURCE_IDENTITY, format: "epub" };

  const reviewPackage = buildOfflineReviewPackage(report, sourceIdentity);
  assert.equal(reviewPackage.payload.document.format, "epub");
  assert.equal(reviewPackage.payload.format_coverage, null);
  assert.deepEqual(reviewPackage.payload.external_tools, {
    epubcheck: "passed",
    ace: "failed",
  });
  assert.deepEqual(
    parseOfflineReviewPackage(serializeOfflineReviewPackage(reviewPackage)),
    reviewPackage,
  );
});

test("rejects missing and unknown fields inside every bound identity", () => {
  const {
    buildOfflineReviewPackage,
    parseOfflineReviewPackage,
    serializeOfflineReviewPackage,
  } = require("../shared/offline-review-package");
  const reviewPackage = buildOfflineReviewPackage(syntheticReport(), SOURCE_IDENTITY);

  for (const [label, mutate] of [
    ["source", (candidate) => delete candidate.payload.source_identity.sha256],
    ["report", (candidate) => delete candidate.payload.report_identity.canonical_sha256],
    ["rulepack", (candidate) => delete candidate.payload.rulepack.manifest_sha256],
    ["source unknown", (candidate) => { candidate.payload.source_identity.path = "private"; }],
    ["report unknown", (candidate) => { candidate.payload.report_identity.file = "private"; }],
    ["rulepack unknown", (candidate) => { candidate.payload.rulepack.raw = "private"; }],
  ]) {
    const candidate = structuredClone(reviewPackage);
    mutate(candidate);
    candidate.payload_sha256 = digest(canonicalJson(candidate.payload));
    assert.throws(
      () => parseOfflineReviewPackage(canonicalBytes(candidate)),
      /字段|source|report|rulepack/u,
      label,
    );
  }

  const initialCheck = syntheticReport();
  initialCheck.check.kind = "check";
  assert.equal(
    parseOfflineReviewPackage(
      serializeOfflineReviewPackage(buildOfflineReviewPackage(initialCheck, SOURCE_IDENTITY)),
    ).payload.check.kind,
    "check",
  );
});

test("rejects tampering, non-canonical bytes, unknown fields, duplicate keys, and invalid UTF-8", () => {
  const {
    buildOfflineReviewPackage,
    parseOfflineReviewPackage,
    serializeOfflineReviewPackage,
  } = require("../shared/offline-review-package");
  const reviewPackage = buildOfflineReviewPackage(syntheticReport(), SOURCE_IDENTITY);
  const bytes = serializeOfflineReviewPackage(reviewPackage);

  const tamperedText = bytes.toString("utf8").replace('"manuscript_type":"paper"', '"manuscript_type":"print_book"');
  assert.throws(() => parseOfflineReviewPackage(Buffer.from(tamperedText)), /payload|SHA-256|篡改/u);
  assert.throws(() => parseOfflineReviewPackage(Buffer.concat([Buffer.from(" "), bytes])), /canonical/u);

  const unknown = JSON.parse(bytes.toString("utf8"));
  unknown.zzz_unknown = true;
  assert.throws(() => parseOfflineReviewPackage(canonicalBytes(unknown)), /字段|unknown/u);

  const canonical = bytes.toString("utf8").slice(0, -2);
  const duplicateKey = Buffer.from(`${canonical},"schema_version":"1.0"}\n`, "utf8");
  assert.throws(() => parseOfflineReviewPackage(duplicateKey), /canonical|重复/u);
  assert.throws(() => parseOfflineReviewPackage(Buffer.from([0xc3, 0x28])), /UTF-8/u);

  const changedSchema = structuredClone(reviewPackage);
  changedSchema.schema_version = "2.0";
  assert.throws(() => serializeOfflineReviewPackage(changedSchema), /schema/u);

  const changedPayload = structuredClone(reviewPackage);
  changedPayload.payload.document.manuscript_type = "print_book";
  assert.throws(() => serializeOfflineReviewPackage(changedPayload), /payload|SHA-256|篡改/u);
});

test("binds source, report, and rulepack identities and rejects inconsistent report data", () => {
  const {
    buildOfflineReviewPackage,
    parseOfflineReviewPackage,
    serializeOfflineReviewPackage,
  } = require("../shared/offline-review-package");
  const report = syntheticReport();
  const reviewPackage = buildOfflineReviewPackage(report, SOURCE_IDENTITY);
  const bytes = serializeOfflineReviewPackage(reviewPackage);

  assert.throws(
    () => parseOfflineReviewPackage(bytes, { source_sha256: "d".repeat(64) }),
    /source/u,
  );
  assert.throws(
    () => parseOfflineReviewPackage(bytes, { report_canonical_sha256: "e".repeat(64) }),
    /report/u,
  );
  assert.throws(
    () => parseOfflineReviewPackage(bytes, {
      rulepack: { ...RULEPACK, version: "2.2.0" },
    }),
    /rulepack/u,
  );

  const wrongRulepack = syntheticReport();
  wrongRulepack.check.rulepack = { ...RULEPACK, version: "2.2.0" };
  assert.throws(() => buildOfflineReviewPackage(wrongRulepack, SOURCE_IDENTITY), /rulepack/u);

  const wrongFormat = syntheticReport();
  assert.throws(
    () => buildOfflineReviewPackage(wrongFormat, { ...SOURCE_IDENTITY, format: "epub" }),
    /format/u,
  );

  const wrongCounts = syntheticReport();
  wrongCounts.pending_counts.error = 0;
  assert.throws(() => buildOfflineReviewPackage(wrongCounts, SOURCE_IDENTITY), /pending_counts/u);

  const missingSourceHash = { ...SOURCE_IDENTITY };
  delete missingSourceHash.sha256;
  assert.throws(() => buildOfflineReviewPackage(syntheticReport(), missingSourceHash), /source.*sha256/u);

  const internallyRetargeted = structuredClone(reviewPackage);
  internallyRetargeted.payload.source_identity.sha256 = "d".repeat(64);
  internallyRetargeted.payload_sha256 = digest(canonicalJson(internallyRetargeted.payload));
  const retargetedBytes = canonicalBytes(internallyRetargeted);
  assert.throws(
    () => parseOfflineReviewPackage(retargetedBytes, { source_sha256: SOURCE_IDENTITY.sha256 }),
    /source/u,
  );
});

test("enforces frozen report, package, issue, array, and string limits", () => {
  const {
    LIMITS,
    buildOfflineReviewPackage,
    parseOfflineReviewPackage,
  } = require("../shared/offline-review-package");

  assert.deepEqual(LIMITS, {
    max_report_bytes: 16 * 1024 * 1024,
    max_package_bytes: 2 * 1024 * 1024,
    max_issues: 2000,
    max_array_items: 2000,
    max_string_bytes: 512,
    max_standard_refs_per_issue: 16,
  });

  const tooManyIssues = syntheticReport();
  tooManyIssues.issues = Array.from({ length: LIMITS.max_issues + 1 }, (_, index) => ({
    ...tooManyIssues.issues[0],
    issue_id: `check-synthetic-001-${String(index + 1).padStart(4, "0")}`,
  }));
  tooManyIssues.check.issue_counts = {
    error: LIMITS.max_issues + 1,
    warning: 0,
    suggestion: 0,
  };
  tooManyIssues.pending_counts = {
    error: LIMITS.max_issues + 1,
    warning: 0,
    suggestion: 0,
  };
  assert.throws(() => buildOfflineReviewPackage(tooManyIssues, SOURCE_IDENTITY), /issues.*上限/u);

  const oversizedReport = syntheticReport();
  oversizedReport.ignored_private_blob = "x".repeat(LIMITS.max_report_bytes);
  assert.throws(() => buildOfflineReviewPackage(oversizedReport, SOURCE_IDENTITY), /report.*上限/u);

  const longString = syntheticReport();
  const oversizedRulepack = {
    ...RULEPACK,
    name: "x".repeat(LIMITS.max_string_bytes + 1),
  };
  longString.rulepack = oversizedRulepack;
  longString.check.rulepack = oversizedRulepack;
  assert.throws(() => buildOfflineReviewPackage(longString, SOURCE_IDENTITY), /string.*上限|rulepack/u);

  assert.throws(
    () => parseOfflineReviewPackage(Buffer.alloc(LIMITS.max_package_bytes + 1, 0x20)),
    /package.*上限/u,
  );
});
