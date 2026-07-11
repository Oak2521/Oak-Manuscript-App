"""M2 六条规则的单元测试（含反例）。"""

import shutil
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core.readers.docx_reader import read_docx
from oak_manuscript_core.readers.md_reader import read_md
from oak_manuscript_core.rules import RULE_FUNCS
from tests.docx_factory import DocxBuilder


def doc_from(builder: DocxBuilder):
    tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
    try:
        path = tmp / "t.docx"
        builder.save(str(path))
        return read_docx(path)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def md_doc(content: str):
    tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
    try:
        path = tmp / "t.md"
        path.write_text(content, encoding="utf-8")
        return read_md(path)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run_rule(rule_id: str, doc, **ctx):
    context = {"language": "zh", "citation_style": "chicago-18-nb"}
    context.update(ctx)
    return RULE_FUNCS[rule_id](doc, context)


class BookStructureTest(unittest.TestCase):
    def test_no_headings_flagged(self):
        doc = doc_from(DocxBuilder().p("书名").p("正文一。").p("正文二。"))
        findings = run_rule("BOOK-STRUCT-001", doc)
        self.assertEqual(len(findings), 1)

    def test_with_headings_ok(self):
        doc = doc_from(DocxBuilder().p("书名").p("第一章", style="Heading1").p("正文。"))
        self.assertEqual(run_rule("BOOK-STRUCT-001", doc), [])


class TocConsistencyTest(unittest.TestCase):
    def _builder(self, toc_entries: list[str]):
        b = DocxBuilder().p("书名").p("目录")
        for entry in toc_entries:
            b.p(entry)
        b.p("第一章 起点", style="Heading1").p("正文。")
        b.p("第二章 转机", style="Heading1").p("正文。")
        return b

    def test_mismatched_entry_flagged(self):
        doc = doc_from(self._builder(["第一章 起点", "第二章 转折"]))
        findings = run_rule("BOOK-STRUCT-002", doc)
        self.assertEqual(len(findings), 1)
        self.assertIn("转折", findings[0]["preview"])

    def test_consistent_toc_ok(self):
        doc = doc_from(self._builder(["第一章 起点", "第二章 转机"]))
        self.assertEqual(run_rule("BOOK-STRUCT-002", doc), [])

    def test_toc_with_page_numbers_and_leaders_ok(self):
        doc = doc_from(self._builder(["第一章 起点 ……… 1", "第二章 转机 ....... 15"]))
        self.assertEqual(run_rule("BOOK-STRUCT-002", doc), [])

    def test_no_toc_section_ok(self):
        doc = doc_from(DocxBuilder().p("书名").p("第一章", style="Heading1").p("正文。"))
        self.assertEqual(run_rule("BOOK-STRUCT-002", doc), [])


class PageBreakTest(unittest.TestCase):
    def test_three_or_more_breaks_flagged_once(self):
        b = (
            DocxBuilder()
            .p("书名")
            .p_runs([("t", "第一段"), ("pagebreak",)])
            .p_runs([("t", "第二段"), ("pagebreak",)])
            .p_section_break()
            .p("尾段。")
        )
        findings = run_rule("BOOK-PAGE-001", doc_from(b))
        self.assertEqual(len(findings), 1)
        self.assertIn("3", findings[0]["preview"])

    def test_fewer_than_three_ok(self):
        b = DocxBuilder().p("书名").p_runs([("t", "第一段"), ("pagebreak",)]).p("尾段。")
        self.assertEqual(run_rule("BOOK-PAGE-001", doc_from(b)), [])


class MdHeadingTest(unittest.TestCase):
    def test_level_jump_flagged(self):
        doc = md_doc("# 一级\n\n### 直接三级\n\n正文。\n")
        findings = run_rule("MD-STRUCT-001", doc)
        self.assertEqual(len(findings), 1)

    def test_sequential_ok(self):
        doc = md_doc("# 一级\n\n## 二级\n\n### 三级\n")
        self.assertEqual(run_rule("MD-STRUCT-001", doc), [])


class ApaCitationTest(unittest.TestCase):
    MD = (
        "# Sample Paper\n\n"
        "Abstract: constructed sample.\n\n"
        "Prior work shows results (Smith, 2020). Another claim cites a missing source "
        "(Jones, 2021). Joint work also counts (Smith & Lee, 2019).\n\n"
        "## References\n\n"
        "Smith, J. (2020). Constructed methods. Example Press.\n\n"
        "Smith, J., & Lee, K. (2019). Joint constructed work. Example Press.\n"
    )

    def test_missing_entry_flagged(self):
        findings = run_rule("REF-APA-001", md_doc(self.MD),
                            language="en", citation_style="apa-7")
        self.assertEqual(len(findings), 1)
        self.assertIn("Jones", findings[0]["preview"])

    def test_all_present_ok(self):
        content = self.MD.replace(
            "## References\n\n",
            "## References\n\nJones, A. (2021). Found source. Example Press.\n\n",
        )
        findings = run_rule("REF-APA-001", md_doc(content),
                            language="en", citation_style="apa-7")
        self.assertEqual(findings, [])

    def test_no_reference_section_no_findings(self):
        findings = run_rule("REF-APA-001", md_doc("Body cites (Smith, 2020) only.\n"),
                            language="en", citation_style="apa-7")
        self.assertEqual(findings, [])


class ChicagoConsistencyTest(unittest.TestCase):
    def test_notes_without_bibliography_flagged(self):
        b = (
            DocxBuilder()
            .p("书名")
            .p("第一章", style="Heading1")
            .p_runs([("t", "正文含注"), ("fnref", 1), ("t", "。")])
            .footnote(1, "注释内容。")
        )
        findings = run_rule("REF-CHI-001", doc_from(b))
        self.assertEqual(len(findings), 1)

    def test_bibliography_without_notes_flagged(self):
        b = (
            DocxBuilder()
            .p("书名")
            .p("第一章", style="Heading1")
            .p("正文无注。")
            .p("参考文献", style="Heading1")
            .p("某条目。")
        )
        findings = run_rule("REF-CHI-001", doc_from(b))
        self.assertEqual(len(findings), 1)

    def test_both_present_ok(self):
        b = (
            DocxBuilder()
            .p("书名")
            .p("第一章", style="Heading1")
            .p_runs([("t", "正文含注"), ("fnref", 1), ("t", "。")])
            .p("参考文献", style="Heading1")
            .p("某条目。")
            .footnote(1, "注释内容。")
        )
        self.assertEqual(run_rule("REF-CHI-001", doc_from(b)), [])

    def test_neither_present_ok(self):
        b = DocxBuilder().p("书名").p("第一章", style="Heading1").p("正文。")
        self.assertEqual(run_rule("REF-CHI-001", doc_from(b)), [])


if __name__ == "__main__":
    unittest.main()
