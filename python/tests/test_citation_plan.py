"""引用体例确认计划、持久化与过期拒绝的集成测试。"""

from __future__ import annotations

import copy
import os
import shutil
import stat
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core import ops
from oak_manuscript_core.errors import ProjectValidationError, StructuredOakError
from oak_manuscript_core.project import Project
from oak_manuscript_core.rulepack import load_rulepack
from oak_manuscript_core.util import read_json, sha256_file, write_json


REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-2.0.0.json")
SAMPLE = REPO / "samples" / "paper_sample.md"


def rmtree_force(path: Path) -> None:
    for root, _directories, files in os.walk(path):
        for filename in files:
            try:
                os.chmod(Path(root) / filename, stat.S_IWRITE)
            except OSError:
                pass
    shutil.rmtree(path, ignore_errors=True)


class CitationPlanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-citation-plan-"))
        self.addCleanup(rmtree_force, self.tmp)
        self.project = Project.create(SAMPLE, self.tmp / "project")

    def test_plan_is_deterministic_and_strictly_read_only(self):
        before_data = copy.deepcopy(self.project.data)
        before_manifest = self.project.manifest_path().read_bytes()
        first = ops.plan_citation_resolution(self.project, PACK)
        second = ops.plan_citation_resolution(self.project, PACK)
        self.assertEqual(first, second)
        self.assertRegex(first["plan_id"], r"^citation-plan-[0-9a-f]{64}$")
        self.assertEqual(first["resolution"]["requested_style"], "default")
        self.assertEqual(self.project.data, before_data)
        self.assertEqual(self.project.manifest_path().read_bytes(), before_manifest)

    def test_confirmed_plan_is_the_persisted_check_resolution(self):
        plan = ops.plan_citation_resolution(
            self.project,
            PACK,
            citation_style="none",
        )
        record, outcome = ops.run_check(
            self.project,
            PACK,
            citation_style="none",
            citation_plan_id=plan["plan_id"],
        )
        self.assertEqual(outcome.resolved["citation_resolution"], plan["resolution"])
        self.assertEqual(self.project.data["settings"]["citation_style"], "none")
        self.assertEqual(self.project.data["check_seq"], 1)
        result = read_json(self.project.report_path(record["result_file"]))
        self.assertEqual(result["citation_resolution"], plan["resolution"])
        self.assertEqual(
            result["settings_snapshot"]["citation_resolution"],
            plan["resolution"],
        )

    def test_stale_plan_does_not_create_a_check_or_persist_override(self):
        plan = ops.plan_citation_resolution(
            self.project,
            PACK,
            citation_style="apa-7",
        )
        source_hash = sha256_file(self.project.source_path)
        with open(self.project.working_path, "a", encoding="utf-8") as stream:
            stream.write("\nworking copy changed after confirmation\n")
        with self.assertRaises(StructuredOakError) as caught:
            ops.run_check(
                self.project,
                PACK,
                citation_style="apa-7",
                citation_plan_id=plan["plan_id"],
            )
        self.assertEqual(caught.exception.code, "CITATION_PLAN_STALE")
        self.assertEqual(self.project.data["check_seq"], 0)
        self.assertEqual(self.project.data["checks"], [])
        self.assertEqual(self.project.data["settings"]["citation_style"], "default")
        self.assertEqual(sha256_file(self.project.source_path), source_hash)

    def test_tampered_persisted_resolution_is_rejected_on_open(self):
        plan = ops.plan_citation_resolution(self.project, PACK, citation_style="none")
        ops.run_check(
            self.project,
            PACK,
            citation_style="none",
            citation_plan_id=plan["plan_id"],
        )
        manifest = read_json(self.project.manifest_path())
        manifest["settings"]["citation_resolution"]["reason_code"] = "user_selected"
        write_json(self.project.manifest_path(), manifest)
        with self.assertRaises(ProjectValidationError):
            Project.open(self.project.root)


class ProjectInputValidationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-project-input-"))
        self.addCleanup(rmtree_force, self.tmp)

    def test_invalid_python_api_settings_are_rejected_before_project_write(self):
        cases = (
            {"manuscript_type": "unknown"},
            {"language": "fr"},
            {"citation_style": "mla"},
            {"check_depth": "comprehensive"},
            {"epub_preview": 1},
        )
        for index, kwargs in enumerate(cases):
            target = self.tmp / f"invalid-{index}"
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(ProjectValidationError):
                    Project.create(SAMPLE, target, **kwargs)
                self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
