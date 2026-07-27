"""检查点列表与安全恢复的独立回归测试。"""

from __future__ import annotations

import copy
import hashlib
import os
import shutil
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from oak_manuscript_core.errors import OakError
from oak_manuscript_core.project import MAX_CHECKPOINTS, Project
from oak_manuscript_core.util import read_json, write_json


def rmtree_force(path: Path) -> None:
    for root, _dirs, files in os.walk(path):
        for filename in files:
            try:
                os.chmod(Path(root) / filename, stat.S_IWRITE)
            except OSError:
                pass
    shutil.rmtree(path, ignore_errors=True)


class CheckpointRestoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-checkpoint-test-"))
        self.addCleanup(rmtree_force, self.tmp)
        source = self.tmp / "manuscript.txt"
        source.write_text("source text\n", encoding="utf-8")
        self.project = Project.create(source, self.tmp / "project", manuscript_type="book")
        self.source_hash = hashlib.sha256(self.project.source_path.read_bytes()).hexdigest()

    def _set_active_state(
        self,
        *,
        text: str,
        issues: list[dict] | None,
        language: str,
        check_number: int,
        fixes: list[dict] | None = None,
    ) -> None:
        self.project.working_path.write_text(text, encoding="utf-8")
        issues_path = self.project.root / "reports" / "issues.json"
        if issues is None:
            issues_path.unlink(missing_ok=True)
            self.project.data["issues_file"] = None
        else:
            write_json(issues_path, issues)
            self.project.data["issues_file"] = "reports/issues.json"

        result_file = f"reports/check-{check_number:04d}.json"
        write_json(
            self.project.root / result_file,
            {"check_id": f"check-{check_number:04d}", "issues": issues or []},
        )
        self.project.data["checks"] = [
            {"check_id": f"check-{check_number:04d}", "result_file": result_file}
        ]
        self.project.data["check_seq"] = check_number
        self.project.data["settings"]["language"] = language
        self.project.data["fixes"] = list(fixes or [])
        self.project.save()

    def assert_source_unchanged(self) -> None:
        self.assertEqual(
            hashlib.sha256(self.project.source_path.read_bytes()).hexdigest(),
            self.source_hash,
        )

    @staticmethod
    def _tree_snapshot(root: Path) -> dict[str, tuple[str, str | None]]:
        snapshot: dict[str, tuple[str, str | None]] = {}
        for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
            relative = path.relative_to(root).as_posix()
            if path.is_dir():
                snapshot[relative] = ("dir", None)
            else:
                snapshot[relative] = (
                    "file",
                    hashlib.sha256(path.read_bytes()).hexdigest(),
                )
        return snapshot

    def _make_five_checkpoint_project(self, name: str) -> tuple[Project, dict]:
        source = self.tmp / f"{name}.txt"
        source.write_text("transaction source", encoding="utf-8")
        project = Project.create(source, self.tmp / name, manuscript_type="book")
        checkpoints = []
        for number in range(1, MAX_CHECKPOINTS + 1):
            project.working_path.write_text(f"checkpoint {number}", encoding="utf-8")
            write_json(
                project.root / "reports" / "issues.json",
                [{"issue_id": f"issue-{number}", "status": "open"}],
            )
            project.data["issues_file"] = "reports/issues.json"
            project.save()
            checkpoints.append(project.make_checkpoint(reason=f"checkpoint_{number}"))
        project.working_path.write_text("current before failed restore", encoding="utf-8")
        write_json(
            project.root / "reports" / "issues.json",
            [{"issue_id": "current", "status": "accepted"}],
        )
        project.data["issues_file"] = "reports/issues.json"
        project.data["settings"]["language"] = "mixed"
        project.save()
        return project, checkpoints[0]

    def test_list_checkpoints_has_stable_newest_first_metadata(self) -> None:
        first = self.project.make_checkpoint(reason="first")
        self.project.working_path.write_text("second state", encoding="utf-8")
        second = self.project.make_checkpoint(reason="second")

        newest = self.project.list_checkpoints()
        oldest = self.project.list_checkpoints(newest_first=False)

        self.assertEqual(
            [item["checkpoint_id"] for item in newest],
            [second["checkpoint_id"], first["checkpoint_id"]],
        )
        self.assertEqual(
            [item["checkpoint_id"] for item in oldest],
            [first["checkpoint_id"], second["checkpoint_id"]],
        )
        self.assertTrue(all(item["can_restore"] for item in newest))
        self.assertTrue(all(item["state_version"] == "1.0" for item in newest))
        self.assertNotIn("path", newest[0])

    def test_restore_restores_working_issues_and_project_state(self) -> None:
        issues_a = [{"issue_id": "issue-a", "status": "open"}]
        self._set_active_state(
            text="version A", issues=issues_a, language="zh", check_number=1
        )
        target = self.project.make_checkpoint(reason="version_a")

        issues_b = [{"issue_id": "issue-b", "status": "resolved"}]
        self._set_active_state(
            text="version B",
            issues=issues_b,
            language="en",
            check_number=2,
            fixes=[{"fix_run_id": "fix-0001", "checkpoint_id": target["checkpoint_id"]}],
        )

        result = self.project.restore_checkpoint(target["checkpoint_id"])

        self.assertEqual(self.project.working_path.read_text(encoding="utf-8"), "version A")
        self.assertEqual(read_json(self.project.root / "reports" / "issues.json"), issues_a)
        self.assertEqual(self.project.data["settings"]["language"], "zh")
        self.assertEqual(self.project.data["checks"][0]["check_id"], "check-0001")
        self.assertEqual(self.project.data["fixes"], [])
        self.assertEqual(self.project.data["issues_file"], "reports/issues.json")
        # 检查序号保持单调，避免后续覆盖 check-0002.json。
        self.assertEqual(self.project.data["check_seq"], 2)
        self.assertTrue(result["state_restored"])
        self.assertIsNotNone(result["safety_checkpoint_id"])
        self.assert_source_unchanged()

    def test_missing_or_corrupt_checkpoint_never_changes_working(self) -> None:
        for corruption in ("missing_working", "working_hash", "invalid_state"):
            with self.subTest(corruption=corruption):
                fresh = self.tmp / f"case-{corruption}"
                source = fresh.with_suffix(".txt")
                source.write_text("source", encoding="utf-8")
                project = Project.create(source, fresh)
                checkpoint = project.make_checkpoint(reason="target")
                project.working_path.write_text("current must survive", encoding="utf-8")
                project.save()
                cp_dir = project.root / "checkpoints" / checkpoint["checkpoint_id"]
                if corruption == "missing_working":
                    (cp_dir / project.stored_filename).unlink()
                elif corruption == "working_hash":
                    (cp_dir / project.stored_filename).write_text("tampered", encoding="utf-8")
                else:
                    (cp_dir / "state.json").write_text("{broken", encoding="utf-8")

                manifest_before = (project.root / "project.json").read_bytes()
                with self.assertRaises(OakError):
                    project.restore_checkpoint(checkpoint["checkpoint_id"])
                self.assertEqual(
                    project.working_path.read_text(encoding="utf-8"),
                    "current must survive",
                )
                self.assertEqual((project.root / "project.json").read_bytes(), manifest_before)
                self.assertEqual(len(project.data["checkpoints"]), 1)

    def test_invalid_id_and_escaping_path_are_rejected_before_writes(self) -> None:
        checkpoint = self.project.make_checkpoint(reason="target")
        self.project.working_path.write_text("current", encoding="utf-8")
        with self.assertRaises(OakError):
            self.project.restore_checkpoint("../cp-0001")
        self.assertEqual(self.project.working_path.read_text(encoding="utf-8"), "current")

        self.project.data["checkpoints"][0]["path"] = "../outside"
        with self.assertRaises(OakError):
            self.project.restore_checkpoint(checkpoint["checkpoint_id"])
        self.assertEqual(self.project.working_path.read_text(encoding="utf-8"), "current")

    def test_safety_checkpoint_can_undo_a_restore(self) -> None:
        issues_a = [{"issue_id": "a", "status": "open"}]
        self._set_active_state(
            text="version A", issues=issues_a, language="zh", check_number=1
        )
        target = self.project.make_checkpoint(reason="version_a")

        issues_b = [{"issue_id": "b", "status": "accepted"}]
        self._set_active_state(
            text="version B", issues=issues_b, language="en", check_number=2
        )
        restored = self.project.restore_checkpoint(target["checkpoint_id"])
        self.assertEqual(self.project.working_path.read_text(encoding="utf-8"), "version A")

        undo = self.project.restore_checkpoint(
            restored["safety_checkpoint_id"], create_safety_checkpoint=False
        )
        self.assertEqual(self.project.working_path.read_text(encoding="utf-8"), "version B")
        self.assertEqual(read_json(self.project.root / "reports" / "issues.json"), issues_b)
        self.assertEqual(self.project.data["settings"]["language"], "en")
        self.assertTrue(undo["state_restored"])
        self.assert_source_unchanged()

    def test_restoring_checkpoint_without_issues_removes_stale_issues(self) -> None:
        self.project.working_path.write_text("clean version", encoding="utf-8")
        clean = self.project.make_checkpoint(reason="clean")
        write_json(
            self.project.root / "reports" / "issues.json",
            [{"issue_id": "stale", "status": "open"}],
        )
        self.project.data["issues_file"] = "reports/issues.json"
        self.project.working_path.write_text("later version", encoding="utf-8")
        self.project.save()

        restored = self.project.restore_checkpoint(clean["checkpoint_id"])

        self.assertFalse((self.project.root / "reports" / "issues.json").exists())
        self.assertIsNone(self.project.data["issues_file"])
        self.assertFalse(restored["issues_restored"])
        self.assert_source_unchanged()

    def test_restore_keeps_target_and_safety_checkpoint_with_max_five(self) -> None:
        checkpoints = []
        for number in range(1, MAX_CHECKPOINTS + 1):
            self.project.working_path.write_text(f"version {number}", encoding="utf-8")
            checkpoints.append(self.project.make_checkpoint(reason=f"version_{number}"))
        target = checkpoints[0]
        self.project.working_path.write_text("current version", encoding="utf-8")

        restored = self.project.restore_checkpoint(target["checkpoint_id"])
        ids = [item["checkpoint_id"] for item in self.project.list_checkpoints()]

        self.assertEqual(len(ids), MAX_CHECKPOINTS)
        self.assertIn(target["checkpoint_id"], ids)
        self.assertIn(restored["safety_checkpoint_id"], ids)
        self.assertNotIn(checkpoints[1]["checkpoint_id"], ids)
        self.assertFalse(
            (self.project.root / "checkpoints" / checkpoints[1]["checkpoint_id"]).exists()
        )
        self.assertEqual(self.project.working_path.read_text(encoding="utf-8"), "version 1")
        self.assert_source_unchanged()

    def test_restore_failure_rolls_back_safety_checkpoint_and_pruning_transaction(self) -> None:
        for failure_mode in ("replace", "save"):
            with self.subTest(failure_mode=failure_mode):
                project, target = self._make_five_checkpoint_project(f"failure-{failure_mode}")
                data_before = copy.deepcopy(project.data)
                tree_before = self._tree_snapshot(project.root)
                checkpoint_ids_before = [
                    item["checkpoint_id"] for item in project.data["checkpoints"]
                ]

                if failure_mode == "replace":
                    original_replace = project._replace_files_from_snapshot
                    replace_calls = 0

                    def replace_then_fail_once(snapshot):
                        nonlocal replace_calls
                        replace_calls += 1
                        original_replace(snapshot)
                        if replace_calls == 1:
                            raise OSError("injected replace failure")

                    failure_patch = mock.patch.object(
                        project,
                        "_replace_files_from_snapshot",
                        side_effect=replace_then_fail_once,
                    )
                else:
                    original_save = project.save
                    save_calls = 0

                    def fail_first_save(*, touch=True):
                        nonlocal save_calls
                        save_calls += 1
                        if save_calls == 1:
                            raise OSError("injected save failure")
                        return original_save(touch=touch)

                    failure_patch = mock.patch.object(
                        project,
                        "save",
                        side_effect=fail_first_save,
                    )

                with failure_patch, self.assertRaises(OakError):
                    project.restore_checkpoint(target["checkpoint_id"])

                self.assertEqual(project.data, data_before)
                self.assertEqual(self._tree_snapshot(project.root), tree_before)
                self.assertEqual(
                    [item["checkpoint_id"] for item in project.data["checkpoints"]],
                    checkpoint_ids_before,
                )
                self.assertEqual(len(project.data["checkpoints"]), MAX_CHECKPOINTS)


if __name__ == "__main__":
    unittest.main()
