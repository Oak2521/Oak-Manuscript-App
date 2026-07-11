"""引擎端到端测试：三个匿名样本的完整断言 + 确定性。"""

import unittest
from pathlib import Path

from oak_manuscript_core.engine import check_document
from oak_manuscript_core.readers.docx_reader import read_docx
from oak_manuscript_core.rulepack import load_rulepack

REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-1.0.0.json")
SAMPLES = REPO / "samples"

PAPER_SETTINGS = {
    "manuscript_type": "paper",
    "language": "auto",
    "citation_style": "default",
    "check_depth": "full",
}

# needs_review 样本应触发的规则全集（见 samples/README.md 对照表）
EXPECTED_NEEDS_REVIEW_RULES = {
    "DOCX-SPACE-001", "DOCX-SPACE-002", "DOCX-SPACE-003", "DOCX-PARA-001",
    "DOCX-PUNCT-001", "PUNCT-MIX-001", "PUNCT-MIX-002",
    "HEAD-STRUCT-001", "HEAD-STRUCT-002",
    "NOTE-001", "NOTE-002", "NOTE-003",
    "REF-001", "REF-002", "REF-003", "REF-004",
    "REF-GBT-001", "REF-GBT-002", "REF-GBT-003",
}


class EngineOnSamplesTest(unittest.TestCase):
    def test_good_sample_yields_zero_issues(self):
        doc = read_docx(SAMPLES / "paper_good.docx")
        result = check_document(doc, dict(PAPER_SETTINGS), PACK)
        self.assertEqual(
            [i["rule_id"] for i in result.issues], [],
            f"绿色基线出现误报：{[(i['rule_id'], i['location'], i['preview']) for i in result.issues]}",
        )
        self.assertEqual(result.resolved["language_detected"], "zh")
        self.assertEqual(result.resolved["citation_style_resolved"], "gbt7714-2025")
        self.assertEqual(result.resolved["citation_resolved_by"], "default_mapping")
        self.assertEqual(result.resolved["citation_mapping_version"], "1.0.0")

    def test_needs_review_sample_triggers_all_expected_rules(self):
        doc = read_docx(SAMPLES / "paper_needs_review.docx")
        result = check_document(doc, dict(PAPER_SETTINGS), PACK)
        triggered = {i["rule_id"] for i in result.issues}
        self.assertEqual(triggered, EXPECTED_NEEDS_REVIEW_RULES)

    def test_missing_parts_sample_triggers_only_structure_rules(self):
        doc = read_docx(SAMPLES / "paper_missing_parts.docx")
        result = check_document(doc, dict(PAPER_SETTINGS), PACK)
        triggered = {i["rule_id"] for i in result.issues}
        self.assertEqual(
            triggered,
            {"PAPER-STRUCT-001", "PAPER-STRUCT-002", "PAPER-STRUCT-003", "PAPER-STRUCT-004"},
        )

    def test_issues_carry_required_fields(self):
        doc = read_docx(SAMPLES / "paper_needs_review.docx")
        result = check_document(doc, dict(PAPER_SETTINGS), PACK)
        for issue in result.issues:
            for field in ("issue_id", "rule_id", "profile", "severity", "title",
                          "explanation", "location", "preview", "standard_refs",
                          "auto_fixable", "confidence", "status"):
                self.assertIn(field, issue)
            self.assertEqual(issue["status"], "open")
            self.assertLessEqual(len(issue["preview"]), 60)
            self.assertIn(issue["severity"], ("error", "warning", "suggestion"))

    def test_ref_002_is_error_severity(self):
        doc = read_docx(SAMPLES / "paper_needs_review.docx")
        result = check_document(doc, dict(PAPER_SETTINGS), PACK)
        ref002 = [i for i in result.issues if i["rule_id"] == "REF-002"]
        self.assertTrue(ref002)
        self.assertTrue(all(i["severity"] == "error" for i in ref002))

    def test_determinism_same_input_same_output(self):
        doc1 = read_docx(SAMPLES / "paper_needs_review.docx")
        doc2 = read_docx(SAMPLES / "paper_needs_review.docx")
        r1 = check_document(doc1, dict(PAPER_SETTINGS), PACK)
        r2 = check_document(doc2, dict(PAPER_SETTINGS), PACK)
        self.assertEqual(r1.issues, r2.issues)
        self.assertEqual(r1.resolved, r2.resolved)

    def test_skipped_milestone_groups_reported(self):
        doc = read_docx(SAMPLES / "paper_good.docx")
        result = check_document(doc, dict(PAPER_SETTINGS), PACK)
        # 三个里程碑全部实现后，「未启用检查」应为空（如实报告机制本身仍被 engine 保留）
        self.assertEqual(result.skipped_rule_groups, [])

    def test_explicit_citation_style_respected(self):
        doc = read_docx(SAMPLES / "paper_good.docx")
        settings = dict(PAPER_SETTINGS)
        settings["citation_style"] = "none"
        result = check_document(doc, settings, PACK)
        self.assertEqual(result.resolved["citation_style_resolved"], "none")
        self.assertEqual(result.resolved["citation_resolved_by"], "user")
        self.assertEqual(result.resolved["citation_mapping_version"], None)


if __name__ == "__main__":
    unittest.main()
