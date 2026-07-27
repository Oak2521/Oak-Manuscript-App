"""引擎与 ops 的 M3 集成测试：EPUB 样本、修复闭环、基础 EPUB 导出自检。"""

import os
import shutil
import stat
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core import ops
from oak_manuscript_core.engine import check_document
from oak_manuscript_core.project import Project
from oak_manuscript_core.readers.epub_reader import read_epub
from oak_manuscript_core.rulepack import load_rulepack

REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-1.0.0.json")
SAMPLES = REPO / "samples"

EBOOK_SETTINGS = {
    "manuscript_type": "ebook",
    "language": "auto",
    "citation_style": "default",
    "check_depth": "full",
}

ALL_M3_RULES = {
    "EPUB-MIME-001", "EPUB-OPF-001", "EPUB-NAV-001",
    "EPUB-LANG-001", "EPUB-IMG-001", "EPUB-LINK-001",
}


def run_confirmed_fixes(project: Project):
    plan = ops.plan_fixes(project, PACK)
    return ops.run_fixes(project, PACK, plan_id=plan["plan_id"])


def rmtree_force(path: Path) -> None:
    for root_, _d, files in os.walk(path):
        for f in files:
            try:
                os.chmod(os.path.join(root_, f), stat.S_IWRITE)
            except OSError:
                pass
    shutil.rmtree(path, ignore_errors=True)


class EngineM3SamplesTest(unittest.TestCase):
    def test_epub_good_yields_zero_issues(self):
        book = read_epub(SAMPLES / "epub_good.epub")
        result = check_document(book, dict(EBOOK_SETTINGS), PACK, doc_format="epub")
        self.assertEqual(
            [i["rule_id"] for i in result.issues], [],
            f"EPUB 绿色基线误报：{[(i['rule_id'], i['preview']) for i in result.issues]}",
        )
        self.assertEqual(result.resolved["citation_style_resolved"], "none")
        self.assertEqual(result.resolved["citation_resolved_by"], "default_mapping")

    def test_epub_needs_review_triggers_all_six_rules(self):
        book = read_epub(SAMPLES / "epub_needs_review.epub")
        result = check_document(book, dict(EBOOK_SETTINGS), PACK, doc_format="epub")
        triggered = {i["rule_id"] for i in result.issues}
        self.assertEqual(triggered, ALL_M3_RULES)
        link_issues = [i for i in result.issues if i["rule_id"] == "EPUB-LINK-001"]
        self.assertEqual(len(link_issues), 2)  # 断文件 + 断锚点

    def test_no_skipped_groups_after_m3(self):
        book = read_epub(SAMPLES / "epub_good.epub")
        result = check_document(book, dict(EBOOK_SETTINGS), PACK, doc_format="epub")
        self.assertEqual(result.skipped_rule_groups, [])

    def test_determinism(self):
        r1 = check_document(read_epub(SAMPLES / "epub_needs_review.epub"),
                            dict(EBOOK_SETTINGS), PACK, doc_format="epub")
        r2 = check_document(read_epub(SAMPLES / "epub_needs_review.epub"),
                            dict(EBOOK_SETTINGS), PACK, doc_format="epub")
        self.assertEqual(r1.issues, r2.issues)


class EpubOpsFlowTest(unittest.TestCase):
    """EPUB 项目的 create → check → fix → recheck → export 闭环。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(rmtree_force, self.tmp)
        self.proj = Project.create(
            SAMPLES / "epub_needs_review.epub", self.tmp / "proj",
            manuscript_type="ebook",
        )

    def test_full_epub_flow(self):
        record, outcome = ops.run_check(self.proj, PACK)
        self.assertEqual({i["rule_id"] for i in outcome.issues}, ALL_M3_RULES)
        self.assertGreater(record["issue_counts"]["error"], 0)  # MIME/OPF/NAV 为 error

        _fix_record, counts = run_confirmed_fixes(self.proj)
        self.assertEqual(counts.get("FIX-EPUB-MIME-001"), 1)
        self.assertEqual(counts.get("FIX-EPUB-LANG-001"), 1)
        self.assertEqual(len(self.proj.data["checkpoints"]), 1)

        _r2, outcome2 = ops.run_check(self.proj, PACK, kind="recheck")
        rules_after = {i["rule_id"] for i in outcome2.issues}
        self.assertEqual(rules_after, ALL_M3_RULES - {"EPUB-MIME-001", "EPUB-LANG-001"})

        written = ops.export_project(self.proj, PACK)
        names = {p.name for p in written}
        self.assertIn("revised_epub_needs_review.epub", names)
        # 原稿不可变
        from oak_manuscript_core.util import sha256_file
        self.assertEqual(sha256_file(self.proj.source_path), self.proj.source_sha256)

    def test_check_external_tools_reported_not_run(self):
        record, _outcome = ops.run_check(self.proj, PACK)
        from oak_manuscript_core.util import read_json
        result = read_json(self.proj.root / record["result_file"])
        self.assertEqual(result["external_tools"],
                         {"epubcheck": "not_run", "ace": "not_run"})


class BasicEpubExportTest(unittest.TestCase):
    """基础 EPUB 导出（DOCX 项目 → preview.epub），并用自身检查核心自检。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(rmtree_force, self.tmp)

    def test_docx_project_exports_selfcheck_clean_epub(self):
        proj = Project.create(
            SAMPLES / "paper_good.docx", self.tmp / "proj",
            manuscript_type="paper", epub_preview=True,
        )
        ops.run_check(proj, PACK)
        written = ops.export_project(proj, PACK)
        preview = next((p for p in written if p.name == "preview.epub"), None)
        self.assertIsNotNone(preview, "epub_preview 开启时应导出 preview.epub")

        # 用自己的 EPUB 检查核心自检：0 条问题
        book = read_epub(preview)
        result = check_document(book, dict(EBOOK_SETTINGS), PACK, doc_format="epub")
        self.assertEqual(
            [i["rule_id"] for i in result.issues], [],
            f"导出的基础 EPUB 未通过自检：{[(i['rule_id'], i['preview']) for i in result.issues]}",
        )
        self.assertEqual(book.title, "示例研究：构造样本的检查基线")
        self.assertEqual(book.language, "zh")

    def test_no_preview_when_setting_off(self):
        proj = Project.create(SAMPLES / "paper_good.docx", self.tmp / "proj2",
                              manuscript_type="paper")
        ops.run_check(proj, PACK)
        written = ops.export_project(proj, PACK)
        self.assertNotIn("preview.epub", {p.name for p in written})


if __name__ == "__main__":
    unittest.main()
