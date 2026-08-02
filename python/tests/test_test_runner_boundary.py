from __future__ import annotations

import importlib.util
import os
import shutil
import tempfile
import unittest
from pathlib import Path


RUNNER_PATH = Path(__file__).resolve().parents[2] / "scripts" / "run_tests.py"
SPEC = importlib.util.spec_from_file_location("oak_test_runner", RUNNER_PATH)
assert SPEC is not None and SPEC.loader is not None
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class TestRunnerBoundaryTests(unittest.TestCase):
    def test_safe_directory_rejects_link_before_creating_a_child(self) -> None:
        sandbox = Path(tempfile.mkdtemp(prefix="runner-boundary-"))
        root = sandbox / "root"
        outside = sandbox / "outside"
        root.mkdir()
        outside.mkdir()
        link = root / "out"
        try:
            try:
                os.symlink(outside, link, target_is_directory=True)
            except (NotImplementedError, OSError) as error:
                self.skipTest(f"当前主机不能创建测试链接：{error}")
            with self.assertRaisesRegex(RuntimeError, "链接|逃逸"):
                RUNNER._ensure_safe_directory(root, link / "test-tmp" / "python")
            self.assertFalse((outside / "test-tmp").exists())
        finally:
            if link.is_symlink():
                link.unlink()
            shutil.rmtree(sandbox, ignore_errors=True)

    def test_cleanup_handles_read_only_files_without_chmodding_hardlink_target(self) -> None:
        sandbox = Path(tempfile.mkdtemp(prefix="runner-cleanup-"))
        run_temp = sandbox / "run"
        run_temp.mkdir()
        read_only = run_temp / "read-only.txt"
        read_only.write_text("fixture\n", encoding="utf-8")
        read_only.chmod(0o400)
        sentinel = sandbox / "sentinel.txt"
        sentinel.write_text("unchanged\n", encoding="utf-8")
        hardlink = run_temp / "hardlink.txt"
        try:
            os.link(sentinel, hardlink)
            RUNNER._cleanup_test_tempdir(run_temp)
            self.assertFalse(run_temp.exists())
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "unchanged\n")
        finally:
            try:
                read_only.chmod(0o600)
            except OSError:
                pass
            shutil.rmtree(sandbox, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
