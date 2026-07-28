"""服务层（检查/修复编排）、报告渲染与导出测试。"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core import ops
from oak_manuscript_core.errors import OakError
from oak_manuscript_core.project import Project
from oak_manuscript_core.reports import render_html, render_markdown
from oak_manuscript_core.rulepack import load_rulepack
from oak_manuscript_core.util import sha256_file

REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-2.0.0.json")
SAMPLES = REPO / "samples"


def run_confirmed_fixes(project: Project):
    plan = ops.plan_fixes(project, PACK)
    return ops.run_fixes(project, PACK, plan_id=plan["plan_id"])


class OpsFlowTest(unittest.TestCase):
    """create → check → fix → recheck → export 的编排层闭环。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.proj = Project.create(SAMPLES / "paper_needs_review.docx", self.tmp / "proj")

    def test_check_persists_results_and_resolved_settings(self):
        record, outcome = ops.run_check(self.proj, PACK)
        self.assertEqual(record["check_id"], "check-0001")
        self.assertTrue((self.proj.root / record["result_file"]).is_file())
        issues = json.loads(
            (self.proj.root / "reports" / "issues.json").read_text(encoding="utf-8")
        )
        self.assertGreater(len(issues), 0)
        s = self.proj.data["settings"]
        self.assertEqual(s["language_detected"], "zh")
        self.assertIsNone(s["citation_style_resolved"])
        self.assertEqual(s["citation_resolved_by"], "default_resolver")
        self.assertEqual(s["citation_resolution"]["mode"], "structure_only")
        self.assertEqual(self.proj.data["rulepack"]["version"], "2.0.0")
        self.assertEqual(record["issue_counts"]["error"], 1)  # REF-002

    def test_fix_creates_checkpoint_marks_resolved_and_is_idempotent(self):
        ops.run_check(self.proj, PACK)
        record, counts = run_confirmed_fixes(self.proj)
        self.assertGreater(sum(counts.values()), 0)
        self.assertEqual(len(self.proj.data["checkpoints"]), 1)
        self.assertEqual(self.proj.data["checkpoints"][0]["reason"], "before_fix")
        issues = ops.load_issues(self.proj)
        fixed = [i for i in issues if i["status"] == "resolved"]
        self.assertEqual(len(fixed), len(record["applied"]))
        self.assertGreater(len(fixed), 0)
        # 原稿不可变
        self.assertEqual(sha256_file(self.proj.source_path), self.proj.source_sha256)
        # 再次修复：无可修复问题
        _record2, counts2 = run_confirmed_fixes(self.proj)
        self.assertEqual(sum(counts2.values()), 0)

    def test_recheck_removes_fixed_issues_and_keeps_rejected_status(self):
        ops.run_check(self.proj, PACK)
        issues = ops.load_issues(self.proj)
        target = next(i for i in issues if i["rule_id"] == "PUNCT-MIX-001")
        ops.set_issue_status(self.proj, target["issue_id"], "rejected")
        run_confirmed_fixes(self.proj)
        record, outcome = ops.run_check(self.proj, PACK, kind="recheck")
        self.assertEqual(record["check_id"], "check-0002")
        rules_now = {i["rule_id"] for i in outcome.issues}
        self.assertNotIn("DOCX-SPACE-001", rules_now)
        self.assertNotIn("DOCX-PUNCT-001", rules_now)
        carried = [i for i in outcome.issues if i["rule_id"] == "PUNCT-MIX-001"]
        self.assertTrue(carried and carried[0]["status"] == "rejected", "拒绝状态应在复检后保留")

    def test_check_gives_friendly_error_on_broken_epub(self):
        dummy = self.tmp / "book.epub"
        dummy.write_bytes(b"placeholder-not-a-zip")
        proj = Project.create(dummy, self.tmp / "proj-epub", manuscript_type="ebook")
        with self.assertRaises(OakError) as ctx:
            ops.run_check(proj, PACK)
        self.assertIn("无法读取", str(ctx.exception))

    def test_check_supports_md_since_m2(self):
        proj = Project.create(SAMPLES / "paper_apa_citations.md", self.tmp / "proj-md")
        record, outcome = ops.run_check(proj, PACK)
        self.assertEqual(record["check_id"], "check-0001")
        self.assertEqual(proj.data["settings"]["citation_style_resolved"], "apa-7")
        self.assertEqual({i["rule_id"] for i in outcome.issues},
                         {"MD-STRUCT-001", "REF-APA-001"})

    def test_export_writes_revised_docx_and_three_reports(self):
        ops.run_check(self.proj, PACK)
        run_confirmed_fixes(self.proj)
        ops.run_check(self.proj, PACK, kind="recheck")
        written = ops.export_project(self.proj, PACK)
        names = {p.name for p in written}
        self.assertIn("revised_paper_needs_review.docx", names)
        self.assertTrue({"report.json", "report.md", "report.html"} <= names)
        for p in written:
            self.assertEqual(p.parent, self.proj.root / "exports")
            self.assertTrue(p.is_file())
        # 修订稿 = 当前工作副本；原稿仍不可变
        revised = next(p for p in written if p.name.startswith("revised_"))
        self.assertEqual(revised.read_bytes(), self.proj.working_path.read_bytes())
        self.assertEqual(sha256_file(self.proj.source_path), self.proj.source_sha256)
        project_identity = self.proj.data["rulepack"]
        check_identity = self.proj.data["checks"][-1]["rulepack"]
        check_result = json.loads(
            (
                self.proj.root
                / self.proj.data["checks"][-1]["result_file"]
            ).read_text(encoding="utf-8")
        )
        exported_report = json.loads(
            (self.proj.root / "exports" / "report.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            set(project_identity),
            {
                "name", "version", "pinned", "sha256", "bundle_id",
                "release_sequence", "manifest_sha256",
            },
        )
        self.assertEqual(check_identity, project_identity)
        self.assertEqual(check_result["rulepack"], project_identity)
        self.assertEqual(exported_report["rulepack"], project_identity)

    def test_export_requires_prior_check(self):
        with self.assertRaises(OakError):
            ops.export_project(self.proj, PACK)


class ReportRenderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.proj = Project.create(SAMPLES / "paper_needs_review.docx", self.tmp / "proj")
        ops.run_check(self.proj, PACK)
        run_confirmed_fixes(self.proj)
        ops.run_check(self.proj, PACK, kind="recheck")
        self.report = ops.build_report_data(self.proj, PACK)

    def test_markdown_contains_required_sections(self):
        md = render_markdown(self.report)
        for fragment in (
            "结论摘要",
            "必须处理",
            "建议处理",
            "已自动订正",
            "外部验证",
            "oak-rules 2.0.0",
            "仅引用结构与一致性检查",
            "默认（default）",
            "不评价学术质量",
            "湖岸橡树出版评估",
            "未运行",
        ):
            self.assertIn(fragment, md, f"报告缺少：{fragment}")

    def test_markdown_never_claims_external_pass(self):
        md = render_markdown(self.report)
        self.assertNotIn("EpubCheck 通过", md)
        self.assertNotIn("Ace 通过", md)

    def test_html_is_selfcontained_and_escaped(self):
        report = json.loads(json.dumps(self.report))
        report["issues"][0]["preview"] = "<script>alert(1)</script>"
        html = render_html(report)
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("<!doctype html>", html.lower())

    def test_report_records_status_level(self):
        self.assertIn("status_level", self.report)
        self.assertEqual(self.report["status_level"], "尚未具备提交条件")  # REF-002 error 仍在


if __name__ == "__main__":
    unittest.main()
