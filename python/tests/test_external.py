"""外部验证工具测试（EpubCheck / Ace）。

工具缺失的机器上自动跳过（unittest.skipUnless），统一测试入口不因此失败。
Ace 较慢（数十秒），默认跳过，设 OAK_TEST_ACE=1 启用。
"""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core import ops
from oak_manuscript_core.external import discover_tools, run_epubcheck
from oak_manuscript_core.project import Project
from oak_manuscript_core.reports import render_markdown
from oak_manuscript_core.rulepack import load_rulepack

REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-1.0.0.json")
SAMPLES = REPO / "samples"
TOOLS = discover_tools()
HAS_EPUBCHECK = bool(TOOLS["epubcheck_jar"] and TOOLS["java"])
HAS_ACE = bool(TOOLS["ace"] and TOOLS["chrome"]) and os.environ.get("OAK_TEST_ACE") == "1"


@unittest.skipUnless(HAS_EPUBCHECK, "本机没有 EpubCheck + Java，跳过")
class EpubcheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_good_sample_passes(self):
        r = run_epubcheck(SAMPLES / "epub_good.epub", self.tmp / "r.json",
                          jar=TOOLS["epubcheck_jar"], java=TOOLS["java"])
        self.assertEqual(r["status"], "passed", r["detail"])

    def test_defect_sample_fails(self):
        r = run_epubcheck(SAMPLES / "epub_needs_review.epub", self.tmp / "r.json",
                          jar=TOOLS["epubcheck_jar"], java=TOOLS["java"])
        self.assertEqual(r["status"], "failed")
        self.assertIn("error", r["detail"])

    def test_exported_basic_epub_passes_epubcheck(self):
        """基础 EPUB 导出的产物必须真实通过 EpubCheck（不只是自检）。"""
        import stat

        proj = Project.create(SAMPLES / "paper_good.docx", self.tmp / "proj",
                              manuscript_type="paper", epub_preview=True)
        self.addCleanup(lambda: [
            os.chmod(os.path.join(r, f), stat.S_IWRITE)
            for r, _d, fs in os.walk(self.tmp) for f in fs
        ])
        ops.run_check(proj, PACK)
        written = ops.export_project(proj, PACK)
        preview = next(p for p in written if p.name == "preview.epub")
        r = run_epubcheck(preview, self.tmp / "p.json",
                          jar=TOOLS["epubcheck_jar"], java=TOOLS["java"])
        self.assertEqual(r["status"], "passed", r["detail"])


@unittest.skipUnless(HAS_EPUBCHECK, "本机没有 EpubCheck + Java，跳过")
class RunExternalFlowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_external_updates_report_status(self):
        proj = Project.create(SAMPLES / "epub_good.epub", self.tmp / "proj",
                              manuscript_type="ebook")
        ops.run_check(proj, PACK)
        results = ops.run_external(proj)
        self.assertEqual(results["epubcheck"]["status"], "passed")
        report = ops.build_report_data(proj, PACK)
        self.assertEqual(report["external_tools"]["epubcheck"], "passed")
        md = render_markdown(report)
        self.assertIn("已运行：未发现问题", md)
        self.assertIn("EpubCheck", md)

    def test_external_rejects_non_epub(self):
        proj = Project.create(SAMPLES / "paper_sample.md", self.tmp / "proj-md")
        from oak_manuscript_core.errors import OakError

        with self.assertRaises(OakError):
            ops.run_external(proj)


@unittest.skipUnless(HAS_ACE, "Ace 未启用（设 OAK_TEST_ACE=1 且需 Ace + Chrome）")
class AceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_ace_runs_and_reports(self):
        from oak_manuscript_core.external import run_ace

        r = run_ace(SAMPLES / "epub_good.epub", self.tmp / "ace",
                    ace=TOOLS["ace"], chrome=TOOLS["chrome"])
        self.assertIn(r["status"], ("passed", "failed"))
        self.assertIn("Ace", r["detail"])


if __name__ == "__main__":
    unittest.main()
