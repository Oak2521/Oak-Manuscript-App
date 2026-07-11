"""引擎 M2 集成测试：书稿/APA/MD/TXT 样本的完整断言。"""

import unittest
from pathlib import Path

from oak_manuscript_core.engine import check_document
from oak_manuscript_core.readers.docx_reader import read_docx
from oak_manuscript_core.readers.md_reader import read_md
from oak_manuscript_core.readers.txt_reader import read_txt
from oak_manuscript_core.rulepack import load_rulepack

REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-1.0.0.json")
SAMPLES = REPO / "samples"


def settings(mtype: str) -> dict:
    return {
        "manuscript_type": mtype,
        "language": "auto",
        "citation_style": "default",
        "check_depth": "full",
    }


class EngineM2SamplesTest(unittest.TestCase):
    def test_book_good_yields_zero_issues(self):
        doc = read_docx(SAMPLES / "book_good.docx")
        result = check_document(doc, settings("print_book"), PACK)
        self.assertEqual(
            [i["rule_id"] for i in result.issues], [],
            f"书稿绿色基线出现误报：{[(i['rule_id'], i['preview']) for i in result.issues]}",
        )
        self.assertEqual(result.resolved["language_detected"], "zh")
        self.assertEqual(result.resolved["citation_style_resolved"], "chicago-18-nb")
        self.assertEqual(result.resolved["citation_resolved_by"], "default_mapping")

    def test_book_no_structure_triggers_expected(self):
        doc = read_docx(SAMPLES / "book_no_structure.docx")
        result = check_document(doc, settings("print_book"), PACK)
        triggered = {i["rule_id"] for i in result.issues}
        self.assertEqual(triggered, {"BOOK-STRUCT-001", "BOOK-PAGE-001"})

    def test_book_toc_mismatch_triggers_only_that(self):
        doc = read_docx(SAMPLES / "book_toc_mismatch.docx")
        result = check_document(doc, settings("print_book"), PACK)
        triggered = {i["rule_id"] for i in result.issues}
        self.assertEqual(triggered, {"BOOK-STRUCT-002"})

    def test_apa_md_sample_triggers_expected(self):
        doc = read_md(SAMPLES / "paper_apa_citations.md")
        result = check_document(doc, settings("paper"), PACK, doc_format="md")
        self.assertEqual(result.resolved["language_detected"], "en")
        self.assertEqual(result.resolved["citation_style_resolved"], "apa-7")
        triggered = {i["rule_id"] for i in result.issues}
        self.assertEqual(triggered, {"MD-STRUCT-001", "REF-APA-001"})

    def test_txt_runs_clean(self):
        doc = read_txt(SAMPLES / "paper_sample.txt")
        result = check_document(doc, settings("paper"), PACK, doc_format="txt")
        self.assertEqual(result.issues, [])

    def test_only_m3_reported_as_skipped(self):
        doc = read_docx(SAMPLES / "book_good.docx")
        result = check_document(doc, settings("print_book"), PACK)
        milestones = {g["milestone"] for g in result.skipped_rule_groups}
        self.assertEqual(milestones, {"M3"})

    def test_m2_determinism(self):
        r1 = check_document(read_docx(SAMPLES / "book_toc_mismatch.docx"),
                            settings("print_book"), PACK)
        r2 = check_document(read_docx(SAMPLES / "book_toc_mismatch.docx"),
                            settings("print_book"), PACK)
        self.assertEqual(r1.issues, r2.issues)


if __name__ == "__main__":
    unittest.main()
