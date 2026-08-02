"""脱敏出版评估摘要测试（方案 §8.4：字段白名单，绝不外泄身份与内容信息）。"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core import ops
from oak_manuscript_core.project import Project
from oak_manuscript_core.rulepack import load_rulepack

REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-2.1.0.json")
SAMPLES = REPO / "samples"

ALLOWED_KEYS = {
    "schema_version", "manuscript_type", "language", "word_count_range",
    "issue_counts", "citation_style_resolved", "citation_resolution", "rulepack_version",
    "generated_at", "intent",
}


class EvaluationSummaryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.proj = Project.create(SAMPLES / "paper_needs_review.docx", self.tmp / "proj")
        ops.run_check(self.proj, PACK)

    def test_fields_are_whitelisted_exactly(self):
        summary = ops.build_evaluation_summary(self.proj)
        self.assertEqual(set(summary.keys()), ALLOWED_KEYS)
        self.assertEqual(summary["manuscript_type"], "paper")
        self.assertIsNone(summary["citation_style_resolved"])
        self.assertEqual(summary["citation_resolution"]["mode"], "structure_only")
        self.assertEqual(
            set(summary["citation_resolution"]),
            {
                "requested_style", "resolved_style", "mode", "confidence",
                "reason_code", "resolver_version",
            },
        )
        self.assertIn("error", summary["issue_counts"])

    def test_no_identity_or_content_leaks(self):
        summary = ops.build_evaluation_summary(self.proj)
        text = json.dumps(summary, ensure_ascii=False)
        # 文件名、路径、正文预览片段一律不得出现（§8.4 默认禁止发送项）
        self.assertNotIn("paper_needs_review", text)
        self.assertNotIn("docx", text)
        self.assertNotIn(str(self.proj.root), text)
        self.assertNotIn("连续空格", text)   # 问题预览内容
        self.assertNotIn("待修订样本", text)  # 稿件标题
        self.assertNotIn(self.proj.source_sha256, text)  # 哈希也禁止（§8.4）

    def test_summary_requires_prior_check(self):
        fresh = Project.create(SAMPLES / "paper_good.docx", self.tmp / "p2")
        from oak_manuscript_core.errors import OakError

        with self.assertRaises(OakError):
            ops.build_evaluation_summary(fresh)

    def test_export_includes_summary_file(self):
        written = ops.export_project(self.proj, PACK)
        names = {p.name for p in written}
        self.assertIn("evaluation_summary.json", names)


if __name__ == "__main__":
    unittest.main()
