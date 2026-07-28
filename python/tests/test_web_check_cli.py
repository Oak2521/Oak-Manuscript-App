"""Web 一次性检查 CLI：共享核心、单锁创建/检查和无路径响应。"""

from __future__ import annotations

import hashlib
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


class WebCheckCliTest(unittest.TestCase):
    def test_one_shot_check_uses_shared_core_without_returning_paths_or_source_identity(self) -> None:
        root = Path(tempfile.mkdtemp(prefix="oak-web-check-cli-"))
        self.addCleanup(rmtree_force, root)
        source = root / "private-manuscript.txt"
        source_bytes = b"Hello\n"
        source.write_bytes(source_bytes)
        project = root / "private-project"

        code, payload, stderr = run_cli(
            "web-check",
            "--input", str(source),
            "--project", str(project),
            "--type", "paper",
            "--citation", "default",
            "--depth", "quick",
        )

        self.assertIn(code, {0, 1}, stderr)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["check_id"], "check-0001")
        self.assertEqual(payload["kind"], "check")
        self.assertTrue(payload["source_hash_ok"])
        self.assertIsInstance(payload["issues"], list)
        self.assertIsInstance(payload["citation_resolution"], dict)
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn(str(source), serialized)
        self.assertNotIn(str(project), serialized)
        self.assertNotIn(source.name, serialized)
        self.assertNotIn("project_id", payload)
        self.assertNotIn("source_sha256", payload)
        self.assertEqual(source.read_bytes(), source_bytes)
        opened = Project.open(project)
        self.assertEqual(
            opened.source_sha256,
            hashlib.sha256(source_bytes).hexdigest(),
        )


if __name__ == "__main__":
    unittest.main()
