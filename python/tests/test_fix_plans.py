"""P0 批量自动修复计划：集中预览、确认令牌、过期拒绝与事务边界。"""

import copy
import os
import shutil
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from oak_manuscript_core import ops
from oak_manuscript_core.errors import OakError
from oak_manuscript_core.project import Project
from oak_manuscript_core.readers.docx_reader import read_docx
from oak_manuscript_core.rulepack import load_rulepack
from oak_manuscript_core.util import sha256_file
from tests.docx_factory import DocxBuilder

REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-1.0.0.json")
SAMPLES = REPO / "samples"


def rmtree_force(path: Path) -> None:
    for root, _dirs, files in os.walk(path):
        for filename in files:
            try:
                os.chmod(Path(root) / filename, stat.S_IWRITE)
            except OSError:
                pass
    shutil.rmtree(path, ignore_errors=True)


def snapshot_tree(root: Path) -> tuple[list[str], dict[str, bytes]]:
    directories = sorted(
        path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_dir()
    )
    files = {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }
    return directories, files


class BatchFixPlanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-fix-plan-"))
        self.addCleanup(rmtree_force, self.tmp)
        self.project = Project.create(
            SAMPLES / "paper_needs_review.docx", self.tmp / "project"
        )
        ops.run_check(self.project, PACK)

    def _apply(self, plan: dict | None = None):
        plan = plan or ops.plan_fixes(self.project, PACK)
        return ops.run_fixes(self.project, PACK, plan_id=plan["plan_id"])

    def test_preview_is_complete_and_has_no_side_effects(self):
        paths = {
            "source": self.project.source_path,
            "working": self.project.working_path,
            "manifest": self.project.root / "project.json",
            "issues": self.project.root / "reports" / "issues.json",
        }
        before = {name: path.read_bytes() for name, path in paths.items()}
        checkpoint_names = list((self.project.root / "checkpoints").iterdir())

        plan = ops.plan_fixes(self.project, PACK)

        self.assertTrue(plan["plan_id"].startswith("fix-plan-"))
        self.assertGreater(plan["candidate_count"], 0)
        self.assertEqual(plan["candidate_count"], len(plan["items"]))
        self.assertEqual(len(plan["working_sha256"]), 64)
        self.assertEqual(len(plan["issues_sha256"]), 64)
        self.assertEqual(len(plan["rulepack"]["sha256"]), 64)
        self.assertEqual(len(plan["candidates_sha256"]), 64)
        for item in plan["items"]:
            self.assertTrue({
                "issue_id", "rule_id", "fix_id", "title", "location",
                "before_preview", "after_preview",
            } <= item.keys())
        self.assertTrue(any(
            item["before_preview"] != item["after_preview"] for item in plan["items"]
        ))
        self.assertEqual(
            {name: path.read_bytes() for name, path in paths.items()}, before
        )
        self.assertEqual(list((self.project.root / "checkpoints").iterdir()), checkpoint_names)

    def test_one_confirmation_applies_entire_batch_and_preserves_source(self):
        plan = ops.plan_fixes(self.project, PACK)
        source_hash = sha256_file(self.project.source_path)
        working_hash = sha256_file(self.project.working_path)

        record, counts = self._apply(plan)

        self.assertEqual(record["plan_id"], plan["plan_id"])
        self.assertEqual(len(record["applied"]), plan["candidate_count"])
        self.assertGreater(sum(counts.values()), 0)
        self.assertNotEqual(sha256_file(self.project.working_path), working_hash)
        self.assertEqual(sha256_file(self.project.source_path), source_hash)
        self.assertEqual(source_hash, self.project.source_sha256)
        self.assertEqual(len(self.project.data["checkpoints"]), 1)
        self.assertEqual(self.project.data["checkpoints"][0]["reason"], "before_fix")
        resolved = {
            issue["issue_id"] for issue in ops.load_issues(self.project)
            if issue["status"] == "resolved"
        }
        self.assertEqual(resolved, {item["issue_id"] for item in plan["items"]})

    def test_rejected_issue_blocks_its_entire_full_document_fix_class(self):
        issues = ops.load_issues(self.project)
        space_issues = [
            issue for issue in issues if issue["fix_id"] == "FIX-SPACE-001"
        ]
        self.assertGreaterEqual(len(space_issues), 2, "夹具应包含同类的多个离散位置")
        rejected_id = space_issues[0]["issue_id"]
        other_space_ids = {issue["issue_id"] for issue in space_issues[1:]}
        ops.set_issue_status(self.project, rejected_id, "rejected")

        plan = ops.plan_fixes(self.project, PACK)
        self.assertNotIn("FIX-SPACE-001", {item["fix_id"] for item in plan["items"]})
        self.assertGreater(plan["candidate_count"], 0, "其他未被拒绝的修复类别仍应可批量执行")
        before_text = read_docx(self.project.working_path).body_text
        self.assertIn("  ", before_text)

        record, counts = self._apply(plan)

        self.assertNotIn("FIX-SPACE-001", counts)
        self.assertNotIn("FIX-SPACE-001", {item["fix_id"] for item in record["applied"]})
        self.assertIn("  ", read_docx(self.project.working_path).body_text)
        statuses = {issue["issue_id"]: issue["status"] for issue in ops.load_issues(self.project)}
        self.assertEqual(statuses[rejected_id], "rejected")
        self.assertTrue(all(statuses[issue_id] == "open" for issue_id in other_space_ids))

    def test_each_tab_has_one_visible_plan_row_and_one_applied_replacement(self):
        source = self.tmp / "three-tabs.docx"
        DocxBuilder().p_runs([
            ("t", "甲"), ("tab",), ("t", "乙"),
            ("tab",), ("t", "丙"), ("tab",), ("t", "丁"),
        ]).save(str(source))
        project = Project.create(source, self.tmp / "three-tabs-project")
        ops.run_check(project, PACK)

        plan = ops.plan_fixes(project, PACK)
        tab_items = [item for item in plan["items"] if item["fix_id"] == "FIX-TAB-001"]
        self.assertEqual(len(tab_items), 3)
        for item in tab_items:
            self.assertEqual(item["before_preview"].count("【⇥】"), 1)
            self.assertEqual(item["after_preview"].count("【␠】"), 1)
            self.assertNotEqual(item["before_preview"], item["after_preview"])
        self.assertEqual(len({item["before_preview"] for item in tab_items}), 3)

        record, counts = ops.run_fixes(project, PACK, plan_id=plan["plan_id"])

        self.assertEqual(counts["FIX-TAB-001"], len(tab_items))
        self.assertEqual(
            len([item for item in record["applied"] if item["fix_id"] == "FIX-TAB-001"]),
            counts["FIX-TAB-001"],
        )
        self.assertEqual(read_docx(project.working_path).paragraphs[0].tab_count, 0)

    def test_working_change_makes_plan_stale(self):
        plan = ops.plan_fixes(self.project, PACK)
        self.project.working_path.write_bytes(
            self.project.working_path.read_bytes() + b"external-change"
        )
        with self.assertRaisesRegex(OakError, "过期"):
            self._apply(plan)
        self.assertEqual(self.project.data["checkpoints"], [])

    def test_issue_status_change_makes_plan_stale(self):
        plan = ops.plan_fixes(self.project, PACK)
        ops.set_issue_status(self.project, plan["items"][0]["issue_id"], "rejected")
        with self.assertRaisesRegex(OakError, "过期"):
            self._apply(plan)
        self.assertEqual(self.project.data["checkpoints"], [])

    def test_rulepack_content_change_makes_plan_stale_even_at_same_version(self):
        plan = ops.plan_fixes(self.project, PACK)
        changed_pack = copy.deepcopy(PACK)
        changed_pack["rules"][0]["title"] += "（变化）"
        with self.assertRaisesRegex(OakError, "过期"):
            ops.run_fixes(self.project, changed_pack, plan_id=plan["plan_id"])
        self.assertEqual(self.project.data["checkpoints"], [])

    def test_missing_plan_and_non_candidate_issue_are_rejected(self):
        with self.assertRaisesRegex(OakError, "缺少"):
            ops.run_fixes(self.project, PACK)
        plan = ops.plan_fixes(self.project, PACK)
        ids = [item["issue_id"] for item in plan["items"]] + ["not-a-candidate"]
        with self.assertRaisesRegex(OakError, "非本计划候选"):
            ops.run_fixes(
                self.project,
                PACK,
                plan_id=plan["plan_id"],
                confirmed_issue_ids=ids,
            )
        self.assertEqual(self.project.data["checkpoints"], [])

    def test_failure_on_staged_copy_leaves_no_partial_project_change(self):
        plan = ops.plan_fixes(self.project, PACK)
        working_before = self.project.working_path.read_bytes()
        manifest_before = (self.project.root / "project.json").read_bytes()
        issues_before = (self.project.root / "reports" / "issues.json").read_bytes()

        def fail_after_partial_temp_write(path, _fix_ids):
            Path(path).write_bytes(b"partial-temporary-result")
            raise RuntimeError("injected failure")

        with patch("oak_manuscript_core.ops.apply_fixes", fail_after_partial_temp_write):
            with self.assertRaisesRegex(RuntimeError, "injected failure"):
                self._apply(plan)

        self.assertEqual(self.project.working_path.read_bytes(), working_before)
        self.assertEqual((self.project.root / "project.json").read_bytes(), manifest_before)
        self.assertEqual((self.project.root / "reports" / "issues.json").read_bytes(), issues_before)
        self.assertEqual(self.project.data["checkpoints"], [])
        self.assertEqual(list((self.project.root / "checkpoints").iterdir()), [])

    def test_commit_failure_at_checkpoint_limit_restores_pruned_checkpoint_tree(self):
        for index in range(5):
            self.project.make_checkpoint(reason=f"seed-{index + 1}")
        plan = ops.plan_fixes(self.project, PACK)
        checkpoint_root = self.project.root / "checkpoints"
        working_before = self.project.working_path.read_bytes()
        issues_before = (self.project.root / "reports" / "issues.json").read_bytes()
        manifest_before = (self.project.root / "project.json").read_bytes()
        data_before = copy.deepcopy(self.project.data)
        checkpoint_tree_before = snapshot_tree(checkpoint_root)

        with patch(
            "oak_manuscript_core.ops._stage_json",
            side_effect=RuntimeError("injected post-checkpoint commit failure"),
        ):
            with self.assertRaisesRegex(RuntimeError, "post-checkpoint"):
                self._apply(plan)

        self.assertEqual(self.project.working_path.read_bytes(), working_before)
        self.assertEqual((self.project.root / "reports" / "issues.json").read_bytes(), issues_before)
        self.assertEqual((self.project.root / "project.json").read_bytes(), manifest_before)
        self.assertEqual(self.project.data, data_before)
        self.assertEqual(snapshot_tree(checkpoint_root), checkpoint_tree_before)
        self.assertEqual(
            [entry["checkpoint_id"] for entry in self.project.data["checkpoints"]],
            [f"cp-{index:04d}" for index in range(1, 6)],
        )

    def test_old_plan_rejected_then_new_zero_plan_is_idempotent(self):
        old_plan = ops.plan_fixes(self.project, PACK)
        self._apply(old_plan)
        after_first = self.project.working_path.read_bytes()
        checkpoint_count = len(self.project.data["checkpoints"])

        with self.assertRaisesRegex(OakError, "过期"):
            self._apply(old_plan)
        zero_plan = ops.plan_fixes(self.project, PACK)
        self.assertEqual(zero_plan["candidate_count"], 0)
        record, counts = self._apply(zero_plan)
        self.assertEqual(record["applied"], [])
        self.assertEqual(counts, {})
        self.assertEqual(self.project.working_path.read_bytes(), after_first)
        self.assertEqual(len(self.project.data["checkpoints"]), checkpoint_count)


class ZeroCandidatePlanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-fix-plan-zero-"))
        self.addCleanup(rmtree_force, self.tmp)

    def test_zero_candidate_plan_is_a_read_only_noop(self):
        project = Project.create(
            SAMPLES / "paper_apa_citations.md", self.tmp / "project"
        )
        ops.run_check(project, PACK)
        working_before = project.working_path.read_bytes()
        manifest_before = (project.root / "project.json").read_bytes()
        plan = ops.plan_fixes(project, PACK)
        self.assertEqual(plan["candidate_count"], 0)

        record, counts = ops.run_fixes(project, PACK, plan_id=plan["plan_id"])

        self.assertEqual(record["applied"], [])
        self.assertIsNone(record["checkpoint_id"])
        self.assertEqual(counts, {})
        self.assertEqual(project.working_path.read_bytes(), working_before)
        self.assertEqual((project.root / "project.json").read_bytes(), manifest_before)
        self.assertEqual(project.data["checkpoints"], [])


if __name__ == "__main__":
    unittest.main()
