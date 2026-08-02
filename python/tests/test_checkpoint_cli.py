"""检查点 CLI 契约测试：列表、默认安全恢复与错误退出。"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core.project import Project


REPO = Path(__file__).resolve().parents[2]
PY_DIR = REPO / "python"


def run_cli(*args: str):
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.run(
        [sys.executable, "-m", "oak_manuscript_core", *args],
        cwd=str(PY_DIR),
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
    )
    payload = json.loads(proc.stdout) if proc.stdout.strip() else None
    return proc.returncode, payload, proc.stderr


def rmtree_force(path: Path) -> None:
    for root, _dirs, files in os.walk(path):
        for filename in files:
            try:
                os.chmod(Path(root) / filename, stat.S_IWRITE)
            except OSError:
                pass
    shutil.rmtree(path, ignore_errors=True)


class CheckpointCliTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-checkpoint-cli-"))
        self.addCleanup(rmtree_force, self.tmp)
        source = self.tmp / "manuscript.txt"
        source.write_text("source", encoding="utf-8")
        self.project_dir = self.tmp / "project"
        code, payload, stderr = run_cli(
            "create", "--input", str(source), "--project", str(self.project_dir),
            "--type", "print_book",
        )
        self.assertEqual(code, 0, stderr)
        self.assertTrue(payload["ok"])

        project = Project.open(self.project_dir)
        project.working_path.write_text("checkpoint version", encoding="utf-8")
        self.target = project.make_checkpoint(reason="before_fix")
        project.working_path.write_text("current version", encoding="utf-8")
        project.save()

    def test_list_checkpoints_returns_stable_json_payload(self) -> None:
        code, payload, stderr = run_cli(
            "list-checkpoints", "--project", str(self.project_dir)
        )

        self.assertEqual(code, 0, stderr)
        self.assertEqual(payload["ok"], True)
        self.assertEqual(len(payload["checkpoints"]), 1)
        item = payload["checkpoints"][0]
        self.assertEqual(item["checkpoint_id"], self.target["checkpoint_id"])
        self.assertEqual(item["reason"], "before_fix")
        self.assertTrue(item["can_restore"])

    def test_restore_checkpoint_defaults_to_safety_checkpoint(self) -> None:
        code, payload, stderr = run_cli(
            "restore-checkpoint",
            "--project", str(self.project_dir),
            "--checkpoint-id", self.target["checkpoint_id"],
        )

        self.assertEqual(code, 0, stderr)
        self.assertEqual(payload["ok"], True)
        self.assertEqual(payload["restored_checkpoint_id"], self.target["checkpoint_id"])
        self.assertRegex(payload["safety_checkpoint_id"], r"^cp-[0-9]{4,}$")
        self.assertEqual(
            Project.open(self.project_dir).working_path.read_text(encoding="utf-8"),
            "checkpoint version",
        )
        listed_code, listed, listed_stderr = run_cli(
            "list-checkpoints", "--project", str(self.project_dir)
        )
        self.assertEqual(listed_code, 0, listed_stderr)
        ids = {item["checkpoint_id"] for item in listed["checkpoints"]}
        self.assertIn(payload["safety_checkpoint_id"], ids)

    def test_missing_checkpoint_exits_two_without_modifying_working(self) -> None:
        project_before = Project.open(self.project_dir)
        working_before = project_before.working_path.read_bytes()
        checkpoint_count = len(project_before.data["checkpoints"])

        code, payload, stderr = run_cli(
            "restore-checkpoint",
            "--project", str(self.project_dir),
            "--checkpoint-id", "cp-9999",
        )

        self.assertEqual(code, 2)
        self.assertIsNone(payload)
        self.assertIn("检查点不存在", stderr)
        project_after = Project.open(self.project_dir)
        self.assertEqual(project_after.working_path.read_bytes(), working_before)
        self.assertEqual(len(project_after.data["checkpoints"]), checkpoint_count)


if __name__ == "__main__":
    unittest.main()
