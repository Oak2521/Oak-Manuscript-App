"""AI request context is exact, minimal, local-only and read-only."""

from __future__ import annotations

import copy
import json
import os
import shutil
import subprocess
import sys
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

TOP_KEYS = {"schema_version", "context_type", "binding", "request_content"}
BINDING_KEYS = {
    "issue_id", "check_id", "working_sha256", "rulepack_manifest_sha256",
}
CONTENT_KEYS = {
    "rule_id", "severity", "title", "explanation", "location", "preview",
    "standard_refs", "status",
}


class AIContextTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-ai-context-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.project = Project.create(SAMPLE, self.tmp / "project")
        _record, outcome = ops.run_check(self.project, PACK)
        self.issue = outcome.issues[0]

    def test_exact_binding_and_request_content_are_separated(self) -> None:
        context = ops.build_ai_issue_context(
            self.project, issue_id=self.issue["issue_id"]
        )
        self.assertEqual(set(context), TOP_KEYS)
        self.assertEqual(set(context["binding"]), BINDING_KEYS)
        self.assertEqual(set(context["request_content"]), CONTENT_KEYS)
        self.assertEqual(context["schema_version"], "1.0")
        self.assertEqual(context["context_type"], "oak_manuscript_issue_suggestion")
        self.assertEqual(context["request_content"]["preview"], self.issue["preview"])
        self.assertEqual(context["binding"]["issue_id"], self.issue["issue_id"])

    def test_context_generation_is_strictly_read_only(self) -> None:
        before = {
            "project": copy.deepcopy(self.project.data),
            "manifest": self.project.manifest_path().read_bytes(),
            "working": self.project.working_path.read_bytes(),
            "issues": self.project.issues_path().read_bytes(),
            "source": self.project.source_path.read_bytes(),
        }
        ops.build_ai_issue_context(self.project, issue_id=self.issue["issue_id"])
        self.assertEqual(self.project.data, before["project"])
        self.assertEqual(self.project.manifest_path().read_bytes(), before["manifest"])
        self.assertEqual(self.project.working_path.read_bytes(), before["working"])
        self.assertEqual(self.project.issues_path().read_bytes(), before["issues"])
        self.assertEqual(self.project.source_path.read_bytes(), before["source"])

    def test_request_content_omits_local_identity_and_hashes(self) -> None:
        context = ops.build_ai_issue_context(
            self.project, issue_id=self.issue["issue_id"]
        )
        serialized = json.dumps(context["request_content"], ensure_ascii=False)
        for forbidden in (
            str(self.project.root), self.project.data["project_id"],
            context["binding"]["check_id"], self.project.source_sha256,
            context["binding"]["working_sha256"], "paper_needs_review.docx",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_missing_or_invalid_issue_and_stale_rules_fail_closed(self) -> None:
        with self.assertRaises(OakError):
            ops.build_ai_issue_context(self.project, issue_id="missing")
        with self.assertRaises(OakError):
            ops.build_ai_issue_context(self.project, issue_id="bad issue")
        self.project.data["rulepack_check_required"] = True
        with self.assertRaises(OakError):
            ops.build_ai_issue_context(self.project, issue_id=self.issue["issue_id"])

    def test_cli_emits_context_without_mutating_the_project(self) -> None:
        manifest_before = self.project.manifest_path().read_bytes()
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        proc = subprocess.run(
            [
                sys.executable, "-m", "oak_manuscript_core", "ai-context",
                "--project", str(self.project.root),
                "--issue-id", self.issue["issue_id"],
            ],
            cwd=str(REPO / "python"), capture_output=True, text=True,
            encoding="utf-8", env=env,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        payload = json.loads(proc.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["binding"]["issue_id"], self.issue["issue_id"])
        self.assertIn("尚未联网", proc.stderr)
        self.assertEqual(self.project.manifest_path().read_bytes(), manifest_before)


if __name__ == "__main__":
    unittest.main()
