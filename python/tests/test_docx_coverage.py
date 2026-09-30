"""DOCX 输出不能把有限规则命中冒充完整审校或版式安全。"""

import copy
import unittest
from pathlib import Path

from oak_manuscript_core.engine import check_document
from oak_manuscript_core.errors import OakError
from oak_manuscript_core.format_coverage import validate_format_coverage
from oak_manuscript_core.model import DocxDocument, Paragraph
from oak_manuscript_core.reports import render_html, render_markdown
from oak_manuscript_core.rulepack import load_rulepack
from tests.test_reports_citation_resolution import report_data

REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config/rule-packs/oak-rules-2.1.0.json")


class DocxCoverageTest(unittest.TestCase):
    def outcome(self, style="none"):
        doc = DocxDocument(paragraphs=[
            Paragraph(part="document", index=1, text="匿名秘密片段  留白")
        ])
        return check_document(doc, {
            "manuscript_type": "paper", "language": "zh",
            "citation_style": style, "check_depth": "full",
        }, PACK)

    def test_docx_discloses_manual_review_without_claiming_layout_exemption(self):
        outcome = self.outcome()
        coverage = outcome.format_coverage
        self.assertIsNotNone(coverage)
        self.assertEqual(coverage["schema_version"], "1.1")
        self.assertEqual(coverage["excluded_contexts"], [])
        self.assertIn("DOCX-SPACE-001", coverage["auto_fixable_rule_ids"])
        self.assertTrue(set(coverage["auto_fixable_rule_ids"]) <= set(coverage["rule_ids"]))
        self.assertFalse(any(r.startswith("REF-") for r in coverage["rule_ids"]))
        self.assertIn("numbered_citation_ranges_and_lists", coverage["not_checked"])
        self.assertIn("诗歌", coverage["disclosure"])
        self.assertIn("人工", coverage["disclosure"])
        self.assertNotIn("匿名秘密片段", repr(coverage))

    def test_docx_scope_survives_report_rendering_without_raw_enum_labels(self):
        report = report_data()
        report["format_coverage"] = self.outcome().format_coverage
        for render in (render_markdown, render_html):
            output = render(report)
            self.assertIn("DOCX", output)
            self.assertIn("区间与并列", output)
            self.assertIn("未逐项确认", output)
            self.assertNotIn("numbered_citation_ranges_and_lists", output)

    def test_docx_scope_cannot_drop_unsupported_areas_or_claim_old_schema(self):
        coverage = self.outcome().format_coverage
        self.assertIsNotNone(coverage)
        for field, value in (("not_checked", []), ("schema_version", "1.0")):
            changed = copy.deepcopy(coverage)
            changed[field] = value
            with self.assertRaises(OakError):
                validate_format_coverage(changed)


if __name__ == "__main__":
    unittest.main()
