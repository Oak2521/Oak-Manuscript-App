"""白名单机械修复测试：正确性、幂等、越权拒绝、修复后复检。"""

import shutil
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core.engine import check_document
from oak_manuscript_core.errors import OakError
from oak_manuscript_core.fixes import WHITELIST, apply_fixes
from oak_manuscript_core.readers.docx_reader import read_docx
from oak_manuscript_core.rulepack import load_rulepack
from tests.docx_factory import DocxBuilder

REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-1.0.0.json")

ALL_FIX_IDS = {"FIX-SPACE-001", "FIX-TAB-001", "FIX-EMPTYPARA-001", "FIX-PUNCT-001"}


class FixTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _make(self, builder: DocxBuilder) -> Path:
        path = self.tmp / "work.docx"
        builder.save(str(path))
        return path

    def _texts(self, path: Path) -> list[str]:
        return [p.text for p in read_docx(path).paragraphs]


class SpaceFixTest(FixTestBase):
    def test_collapses_runs_of_spaces(self):
        path = self._make(DocxBuilder().p("这里有  空格，那里有    更多。"))
        counts = apply_fixes(path, {"FIX-SPACE-001"})
        self.assertEqual(counts["FIX-SPACE-001"], 2)
        self.assertEqual(self._texts(path), ["这里有 空格，那里有 更多。"])

    def test_collapses_across_run_boundary(self):
        path = self._make(DocxBuilder().p_runs([("t", "前 "), ("t", " 后")]))
        apply_fixes(path, {"FIX-SPACE-001"})
        self.assertEqual(self._texts(path), ["前 后"])

    def test_leaves_single_spaces_alone(self):
        path = self._make(DocxBuilder().p("normal single spaces here"))
        before = path.read_bytes()
        counts = apply_fixes(path, {"FIX-SPACE-001"})
        self.assertEqual(counts["FIX-SPACE-001"], 0)
        self.assertEqual(path.read_bytes(), before)


class TabFixTest(FixTestBase):
    def test_replaces_tab_with_space(self):
        path = self._make(DocxBuilder().p_runs([("t", "前"), ("tab",), ("t", "后")]))
        counts = apply_fixes(path, {"FIX-TAB-001"})
        self.assertEqual(counts["FIX-TAB-001"], 1)
        doc = read_docx(path)
        self.assertEqual(doc.paragraphs[0].text, "前 后")
        self.assertEqual(doc.paragraphs[0].tab_count, 0)

    def test_does_not_touch_spaces_when_only_tab_selected(self):
        path = self._make(DocxBuilder().p("保留  双空格").p_runs([("t", "a"), ("tab",), ("t", "b")]))
        apply_fixes(path, {"FIX-TAB-001"})
        texts = self._texts(path)
        self.assertEqual(texts[0], "保留  双空格")


class PunctFixTest(FixTestBase):
    def test_collapses_repeated_fullwidth_punct(self):
        path = self._make(DocxBuilder().p("重复。。。句号，，逗号！"))
        counts = apply_fixes(path, {"FIX-PUNCT-001"})
        self.assertEqual(counts["FIX-PUNCT-001"], 2)
        self.assertEqual(self._texts(path), ["重复。句号，逗号！"])

    def test_preserves_ellipsis_and_dash(self):
        path = self._make(DocxBuilder().p("省略号……破折号——保持原样。"))
        counts = apply_fixes(path, {"FIX-PUNCT-001"})
        self.assertEqual(counts["FIX-PUNCT-001"], 0)
        self.assertEqual(self._texts(path), ["省略号……破折号——保持原样。"])

    def test_collapses_across_run_boundary(self):
        path = self._make(DocxBuilder().p_runs([("t", "末。"), ("t", "。首")]))
        apply_fixes(path, {"FIX-PUNCT-001"})
        self.assertEqual(self._texts(path), ["末。首"])


class EmptyParaFixTest(FixTestBase):
    def test_collapses_consecutive_empty_paragraphs_to_one(self):
        path = self._make(DocxBuilder().p("a").p_empty().p_empty().p_empty().p("b"))
        counts = apply_fixes(path, {"FIX-EMPTYPARA-001"})
        self.assertEqual(counts["FIX-EMPTYPARA-001"], 2)
        self.assertEqual(self._texts(path), ["a", "", "b"])

    def test_single_empty_paragraph_kept(self):
        path = self._make(DocxBuilder().p("a").p_empty().p("b"))
        counts = apply_fixes(path, {"FIX-EMPTYPARA-001"})
        self.assertEqual(counts["FIX-EMPTYPARA-001"], 0)
        self.assertEqual(self._texts(path), ["a", "", "b"])


class DisciplineTest(FixTestBase):
    def test_rejects_non_whitelist_fix_id(self):
        path = self._make(DocxBuilder().p("正文"))
        with self.assertRaises(OakError):
            apply_fixes(path, {"FIX-EVIL-999"})

    def test_whitelist_constant_matches_frozen_spec(self):
        self.assertEqual(WHITELIST, ALL_FIX_IDS)

    def test_idempotent_second_run_changes_nothing(self):
        b = (
            DocxBuilder()
            .p("空格  与制表符")
            .p_runs([("t", "前"), ("tab",), ("t", "后")])
            .p("重复。。标点，，")
            .p("a").p_empty().p_empty().p("b")
        )
        path = self._make(b)
        apply_fixes(path, ALL_FIX_IDS)
        after_first = path.read_bytes()
        counts = apply_fixes(path, ALL_FIX_IDS)
        self.assertEqual(sum(counts.values()), 0, f"第二次运行仍有改动：{counts}")
        self.assertEqual(path.read_bytes(), after_first)


class FixThenRecheckTest(FixTestBase):
    """修复后复检：白名单问题消失，非白名单问题保留（用缺陷样本全流程验证）。"""

    AUTO_RULES = {"DOCX-SPACE-001", "DOCX-SPACE-002", "DOCX-PARA-001", "DOCX-PUNCT-001"}

    def test_needs_review_sample_after_fix(self):
        src = REPO / "samples" / "paper_needs_review.docx"
        work = self.tmp / "work.docx"
        shutil.copyfile(src, work)
        settings = {"manuscript_type": "paper", "language": "auto",
                    "citation_style": "default", "check_depth": "full"}

        before = check_document(read_docx(work), dict(settings), PACK)
        before_rules = {i["rule_id"] for i in before.issues}
        self.assertTrue(self.AUTO_RULES <= before_rules)

        counts = apply_fixes(work, ALL_FIX_IDS)
        self.assertGreater(sum(counts.values()), 0)

        after = check_document(read_docx(work), dict(settings), PACK)
        after_rules = {i["rule_id"] for i in after.issues}
        self.assertEqual(after_rules & self.AUTO_RULES, set(), "白名单问题修复后仍被检出")
        self.assertEqual(after_rules, before_rules - self.AUTO_RULES, "非白名单问题不应被修复改变")


if __name__ == "__main__":
    unittest.main()
