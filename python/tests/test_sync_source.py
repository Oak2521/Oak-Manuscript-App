"""SyncRecord v1 的可信核心来源：严格白名单，不把稿件内容交给 Renderer。"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core import ops
from oak_manuscript_core.errors import OakError
from oak_manuscript_core.project import Project
from oak_manuscript_core.rulepack import load_rulepack

REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-2.0.0.json")
SAMPLE = REPO / "samples" / "paper_needs_review.docx"

ALLOWED_KEYS = {
    "projectId", "runId", "event", "format", "manuscriptType", "checkConfig",
    "languageBucket", "lengthBucket", "citation", "rulepackVersion", "appVersion",
    "createdAt", "authorizedAt", "issues", "externalValidation", "exportState",
}
ALLOWED_ISSUE_KEYS = {"rule_id", "severity", "dimension", "status", "fixable"}


class SyncSourceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-sync-source-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.project = Project.create(SAMPLE, self.tmp / "project")
        ops.run_check(self.project, PACK)

    def test_source_is_exact_allowlist(self):
        source = ops.build_sync_source(self.project, event="check")
        self.assertEqual(set(source), ALLOWED_KEYS)
        self.assertEqual(source["projectId"], self.project.data["project_id"])
        self.assertEqual(source["runId"], "check-0001")
        self.assertEqual(source["event"], "check")
        self.assertEqual(source["format"], "docx")
        self.assertEqual(source["exportState"], "not_exported")
        self.assertIsNone(source["authorizedAt"])
        self.assertGreater(len(source["issues"]), 0)

    def test_optional_issue_records_are_structural_only(self):
        source = ops.build_sync_source(self.project, event="export")
        self.assertGreater(len(source["issues"]), 0)
        self.assertTrue(all(set(issue) == ALLOWED_ISSUE_KEYS for issue in source["issues"]))
        self.assertTrue(all(isinstance(issue["fixable"], bool) for issue in source["issues"]))
        self.assertEqual(source["exportState"], "completed")

    def test_source_contains_no_content_paths_names_or_hashes(self):
        source = ops.build_sync_source(self.project, event="export")
        serialized = json.dumps(source, ensure_ascii=False)
        for forbidden in (
            "paper_needs_review",
            str(self.project.root),
            self.project.source_sha256,
            "待修订样本",
            "连续空格",
            "C:\\Users",
        ):
            self.assertNotIn(forbidden, serialized)
        forbidden_keys = {
            "title", "preview", "location", "filename", "path", "sha256", "hash",
            "content", "body", "abstract", "keywords",
        }

        def walk(value):
            if isinstance(value, dict):
                self.assertTrue(forbidden_keys.isdisjoint(value))
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)

        walk(source)

    def test_requires_a_current_check_and_rejects_invalid_options(self):
        fresh = Project.create(REPO / "samples" / "paper_good.docx", self.tmp / "fresh")
        with self.assertRaises(OakError):
            ops.build_sync_source(fresh, event="check")
        with self.assertRaises(OakError):
            ops.build_sync_source(self.project, event="upload")


if __name__ == "__main__":
    unittest.main()
