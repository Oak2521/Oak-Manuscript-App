"""单条规则判断逻辑测试（含白名单反例：不得误报）。"""

import shutil
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core.model import DocxDocument, Footnote, Paragraph
from oak_manuscript_core.readers.docx_reader import read_docx
from oak_manuscript_core.rules import RULE_FUNCS
from tests.docx_factory import DocxBuilder


def doc_from(builder: DocxBuilder) -> DocxDocument:
    tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
    try:
        path = tmp / "t.docx"
        builder.save(str(path))
        return read_docx(path)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run_rule(rule_id: str, doc: DocxDocument, **ctx):
    context = {"language": "zh", "citation_style": "gbt7714-2025"}
    context.update(ctx)
    return RULE_FUNCS[rule_id](doc, context)


class WhitespaceRulesTest(unittest.TestCase):
    def test_space_001_finds_each_occurrence(self):
        doc = doc_from(DocxBuilder().p("这里有  两个空格，这里有   三个。"))
        findings = run_rule("DOCX-SPACE-001", doc)
        self.assertEqual(len(findings), 2)
        self.assertEqual(findings[0]["paragraph"], 1)

    def test_space_001_ignores_single_spaces(self):
        doc = doc_from(DocxBuilder().p("normal single spaced text 正常。"))
        self.assertEqual(run_rule("DOCX-SPACE-001", doc), [])

    def test_space_002_flags_tab_paragraph(self):
        doc = doc_from(DocxBuilder().p_runs([("t", "前"), ("tab",), ("t", "后")]))
        findings = run_rule("DOCX-SPACE-002", doc)
        self.assertEqual(len(findings), 1)

    def test_space_002_finds_every_tab_in_same_paragraph(self):
        doc = doc_from(DocxBuilder().p_runs([
            ("t", "甲"), ("tab",), ("t", "乙"),
            ("tab",), ("t", "丙"), ("tab",), ("t", "丁"),
        ]))
        findings = run_rule("DOCX-SPACE-002", doc)
        self.assertEqual(len(findings), 3)
        self.assertEqual([finding["paragraph"] for finding in findings], [1, 1, 1])
        self.assertTrue(all(finding["preview"].count("【⇥】") == 1 for finding in findings))
        self.assertEqual(len({finding["preview"] for finding in findings}), 3)

    def test_space_003_flags_leading_halfwidth_and_fullwidth(self):
        doc = doc_from(DocxBuilder().p("  半角开头。").p("　全角开头。").p("正常段。"))
        findings = run_rule("DOCX-SPACE-003", doc)
        self.assertEqual([f["paragraph"] for f in findings], [1, 2])

    def test_space_003_ignores_whitespace_only_paragraph(self):
        doc = doc_from(DocxBuilder().p("   "))
        self.assertEqual(run_rule("DOCX-SPACE-003", doc), [])

    def test_para_001_flags_runs_of_empty_paragraphs(self):
        doc = doc_from(DocxBuilder().p("a").p_empty().p_empty().p("b").p_empty().p("c"))
        findings = run_rule("DOCX-PARA-001", doc)
        self.assertEqual(len(findings), 1)  # 只有 2、3 段构成连续空段
        self.assertEqual(findings[0]["paragraph"], 2)

    def test_para_001_skips_paragraphs_with_content_markers(self):
        # 含图片 / 分节符的段落不算空段：直接构造模型验证豁免逻辑
        doc = DocxDocument(
            paragraphs=[
                Paragraph(part="document", index=1, text=""),
                Paragraph(part="document", index=2, text="", has_drawing=True),
                Paragraph(part="document", index=3, text="", has_sectpr=True),
            ]
        )
        self.assertEqual(run_rule("DOCX-PARA-001", doc), [])


class PunctuationRulesTest(unittest.TestCase):
    def test_punct_001_flags_doubled_fullwidth(self):
        doc = doc_from(DocxBuilder().p("句号重复。。逗号重复，，"))
        findings = run_rule("DOCX-PUNCT-001", doc)
        self.assertEqual(len(findings), 2)

    def test_punct_001_counterexamples_ellipsis_and_dash(self):
        doc = doc_from(DocxBuilder().p("省略号……破折号——都是正常用法。"))
        self.assertEqual(run_rule("DOCX-PUNCT-001", doc), [])

    def test_mix_001_flags_halfwidth_between_cjk(self):
        doc = doc_from(DocxBuilder().p("这是中文,里面夹了半角。"))
        self.assertEqual(len(run_rule("PUNCT-MIX-001", doc)), 1)

    def test_mix_001_counterexamples(self):
        doc = doc_from(
            DocxBuilder()
            .p("版本号 3.11 不应触发。")
            .p("张示. 学术稿件的规范准备[M]. 北京: 示例出版社, 2020.")
            .p("English, sentence stays fine.")
        )
        self.assertEqual(run_rule("PUNCT-MIX-001", doc), [])

    def test_mix_002_flags_halfwidth_parens_with_cjk(self):
        doc = doc_from(DocxBuilder().p("术语(中文说明)如此。"))
        self.assertEqual(len(run_rule("PUNCT-MIX-002", doc)), 1)

    def test_mix_002_ignores_pure_ascii_parens(self):
        doc = doc_from(DocxBuilder().p("术语（Chinese term, CT）与 (English only) 均正常。"))
        self.assertEqual(run_rule("PUNCT-MIX-002", doc), [])


class StructureRulesTest(unittest.TestCase):
    def test_missing_abstract_keywords_references(self):
        doc = doc_from(DocxBuilder().p("题名").p("只有正文的文档。"))
        for rule_id in ("PAPER-STRUCT-002", "PAPER-STRUCT-003", "PAPER-STRUCT-004"):
            self.assertEqual(len(run_rule(rule_id, doc)), 1, rule_id)

    def test_present_parts_not_flagged(self):
        b = (
            DocxBuilder()
            .p("题名")
            .p("摘要：内容。")
            .p("关键词：一；二")
            .p("参考文献", style="Heading1")
            .p("[1] 某条目[M]. 某社, 2020.")
        )
        doc = doc_from(b)
        for rule_id in ("PAPER-STRUCT-001", "PAPER-STRUCT-002", "PAPER-STRUCT-003", "PAPER-STRUCT-004"):
            self.assertEqual(run_rule(rule_id, doc), [], rule_id)

    def test_unclear_title_when_first_paragraph_too_long(self):
        long_first = "这是一段非常长的开头文字，" * 10
        doc = doc_from(DocxBuilder().p(long_first).p("正文。"))
        self.assertEqual(len(run_rule("PAPER-STRUCT-001", doc)), 1)


class HeadingRulesTest(unittest.TestCase):
    def test_level_jump_flagged(self):
        b = DocxBuilder().p("一级", style="Heading1").p("三级", style="Heading3")
        self.assertEqual(len(run_rule("HEAD-STRUCT-001", doc_from(b))), 1)

    def test_sequential_levels_ok(self):
        b = (
            DocxBuilder()
            .p("一级", style="Heading1")
            .p("二级", style="Heading2")
            .p("三级", style="Heading3")
            .p("又一个二级", style="Heading2")
        )
        self.assertEqual(run_rule("HEAD-STRUCT-001", doc_from(b)), [])

    def test_numbering_gap_flagged(self):
        b = (
            DocxBuilder()
            .p("2 方法", style="Heading1")
            .p("2.1 数据", style="Heading2")
            .p("2.3 模型", style="Heading2")
        )
        findings = run_rule("HEAD-STRUCT-002", doc_from(b))
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["paragraph"], 3)

    def test_sequential_numbering_ok(self):
        b = (
            DocxBuilder()
            .p("1 引言", style="Heading1")
            .p("2 方法", style="Heading1")
            .p("2.1 数据", style="Heading2")
            .p("2.2 分析", style="Heading2")
            .p("3 结论", style="Heading1")
        )
        self.assertEqual(run_rule("HEAD-STRUCT-002", doc_from(b)), [])


class NoteRulesTest(unittest.TestCase):
    def _doc(self):
        b = (
            DocxBuilder()
            .p_runs([("t", "正文"), ("fnref", 1), ("fnref", 2), ("fnref", 4), ("fnref", 5)])
            .footnote(1, "正常注")
            .footnote(2, "")
            .footnote(3, "孤立注")
            .footnote(4, "相同内容。")
            .footnote(5, "相同内容。")
        )
        return doc_from(b)

    def test_empty_note_flagged(self):
        findings = run_rule("NOTE-001", self._doc())
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["note_id"], 2)

    def test_orphan_note_flagged(self):
        findings = run_rule("NOTE-002", self._doc())
        self.assertEqual([f["note_id"] for f in findings], [3])

    def test_duplicate_notes_flagged_once_per_group(self):
        findings = run_rule("NOTE-003", self._doc())
        self.assertEqual(len(findings), 1)


class ReferenceRulesTest(unittest.TestCase):
    def _doc(self):
        b = (
            DocxBuilder()
            .p("题名")
            .p("正文引用[1]与[2]，还有一个不存在的[5]。")
            .p("参考文献", style="Heading1")
            .p("[1] 张示. 学术稿件的规范准备[M]. 北京: 示例出版社, 2020.")
            .p("[2] 李构. 编辑流程中的技术检查. 示例学报, 2021.")
            .p("[3] 王样. 另一项占位研究[J]. 示例学报.")
            .p("[4] 张示. 学术稿件的规范准备[M]. 北京: 示例出版社, 2020.")
            .p("[6] 赵占，位. 混用标点的网络资源[EB/OL], 2021。")
        )
        return doc_from(b)

    def test_ref_002_missing_cited_entry(self):
        findings = run_rule("REF-002", self._doc())
        self.assertEqual(len(findings), 1)
        self.assertIn("[5]", findings[0]["preview"])

    def test_ref_003_uncited_entries(self):
        findings = run_rule("REF-003", self._doc())
        self.assertEqual(len(findings), 3)  # [3]、[4]、[6] 未被引用

    def test_ref_001_duplicate_entries(self):
        findings = run_rule("REF-001", self._doc())
        self.assertEqual(len(findings), 1)

    def test_ref_004_numbering_gap(self):
        findings = run_rule("REF-004", self._doc())
        self.assertEqual(len(findings), 1)  # [4] 之后直接 [6]

    def test_gbt_001_missing_type_code(self):
        findings = run_rule("REF-GBT-001", self._doc())
        self.assertEqual(len(findings), 1)  # 仅 [2] 缺类型标识

    def test_gbt_002_missing_year(self):
        findings = run_rule("REF-GBT-002", self._doc())
        self.assertEqual(len(findings), 1)  # 仅 [3] 缺年份

    def test_gbt_003_mixed_punctuation(self):
        findings = run_rule("REF-GBT-003", self._doc())
        self.assertEqual(len(findings), 1)  # 仅 [6] 全半角混用

    def test_no_reference_section_produces_no_findings(self):
        doc = doc_from(DocxBuilder().p("题名").p("正文没有文献。"))
        for rule_id in ("REF-001", "REF-002", "REF-003", "REF-004",
                        "REF-GBT-001", "REF-GBT-002", "REF-GBT-003"):
            self.assertEqual(run_rule(rule_id, doc), [], rule_id)


if __name__ == "__main__":
    unittest.main()
