"""项目级跨进程写锁：争用拒绝、项目隔离与崩溃自动释放。"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from oak_manuscript_core.__main__ import _MUTATING_COMMANDS
from oak_manuscript_core.errors import OakError
from oak_manuscript_core.project import Project
from oak_manuscript_core.project_lock import PROJECT_LOCK_FILENAME, ProjectWriteLock


REPO = Path(__file__).resolve().parents[2]
PY_DIR = REPO / "python"

_HOLDER_SCRIPT = r"""
import sys
import time
from pathlib import Path

from oak_manuscript_core.project_lock import ProjectWriteLock

project = Path(sys.argv[1])
ready = Path(sys.argv[2])
stop = Path(sys.argv[3])
command = sys.argv[4]

with ProjectWriteLock(project, command=command):
    ready.write_text("ready", encoding="utf-8")
    while not stop.exists():
        time.sleep(0.01)
"""


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
        timeout=20,
    )
    payload = json.loads(proc.stdout) if proc.stdout.strip() else None
    return proc.returncode, payload, proc.stderr


def _tree_state(root: Path) -> dict[str, str]:
    """记录项目文件内容；持久锁文件单独断言，不混入业务状态。"""
    result: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.name != PROJECT_LOCK_FILENAME:
            relative = path.relative_to(root).as_posix()
            result[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


class ProjectWriteLockProcessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-project-lock-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.holders: list[subprocess.Popen[str]] = []
        self.addCleanup(self._stop_holders)

        source = self.tmp / "manuscript.txt"
        source.write_text("A short anonymous manuscript.\n", encoding="utf-8")
        self.project_a = self.tmp / "project-a"
        self.project_b = self.tmp / "project-b"
        Project.create(source, self.project_a, manuscript_type="print_book")
        Project.create(source, self.project_b, manuscript_type="print_book")

    def _stop_holders(self) -> None:
        for process in self.holders:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            process.communicate(timeout=5)

    def _start_holder(self, project: Path, command: str) -> tuple[subprocess.Popen[str], Path]:
        token = f"{project.name}-{command}-{time.time_ns()}"
        ready = self.tmp / f"{token}.ready"
        stop = self.tmp / f"{token}.stop"
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        process = subprocess.Popen(
            [
                sys.executable,
                "-u",
                "-c",
                _HOLDER_SCRIPT,
                str(project),
                str(ready),
                str(stop),
                command,
            ],
            cwd=str(PY_DIR),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            env=env,
        )
        self.holders.append(process)
        deadline = time.monotonic() + 5
        while not ready.is_file():
            if process.poll() is not None:
                stdout, stderr = process.communicate()
                self.fail(f"锁持有进程提前退出：{stdout}\n{stderr}")
            if time.monotonic() >= deadline:
                self.fail("等待锁持有进程超时")
            time.sleep(0.01)
        return process, stop

    def test_every_state_changing_cli_command_is_in_the_single_lock_policy(self) -> None:
        self.assertEqual(
            _MUTATING_COMMANDS,
            {
                "create",
                "web-check",
                "check",
                "recheck",
                "fix",
                "export",
                "verify",
                "restore-checkpoint",
                "upgrade-rulepack",
                "external",
                "external-prepare",
                "external-finalize",
                "issue",
            },
        )

    def test_failed_create_lock_scope_restores_new_empty_and_protocol_lock_targets(self) -> None:
        new_root = self.tmp / "new-create-root"
        with self.assertRaisesRegex(OakError, "injected"):
            with ProjectWriteLock(
                new_root,
                command="create",
                create_root=True,
                cleanup_on_error=True,
            ):
                raise OakError("injected create failure")
        self.assertFalse(new_root.exists(), "本实例新建且仍为空的根目录必须回收")

        existing_empty = self.tmp / "existing-empty-root"
        existing_empty.mkdir()
        with self.assertRaisesRegex(OakError, "injected"):
            with ProjectWriteLock(
                existing_empty,
                command="create",
                create_root=True,
                cleanup_on_error=True,
            ):
                raise OakError("injected create failure")
        self.assertTrue(existing_empty.is_dir(), "用户已有空目录绝不能删除")
        self.assertEqual(list(existing_empty.iterdir()), [])

        protocol_root = self.tmp / "existing-protocol-root"
        protocol_root.mkdir()
        with ProjectWriteLock(protocol_root, command="seed"):
            pass
        lock_path = protocol_root / PROJECT_LOCK_FILENAME
        bytes_before = lock_path.read_bytes()
        with self.assertRaisesRegex(OakError, "injected"):
            with ProjectWriteLock(
                protocol_root,
                command="create",
                create_root=True,
                cleanup_on_error=True,
            ):
                raise OakError("injected create failure")
        self.assertEqual(lock_path.read_bytes(), bytes_before)

    def test_second_check_is_rejected_without_project_or_lock_metadata_overwrite(self) -> None:
        holder, stop = self._start_holder(self.project_a, "test-holder-check")
        lock_path = self.project_a / PROJECT_LOCK_FILENAME
        lock_before = lock_path.read_bytes()
        project_before = _tree_state(self.project_a)

        started = time.monotonic()
        code, payload, stderr = run_cli("check", "--project", str(self.project_a))
        elapsed = time.monotonic() - started

        self.assertEqual(code, 2, stderr)
        self.assertLess(elapsed, 3.0, "锁争用必须立即失败，不能排队等待")
        self.assertEqual(payload["ok"], False)
        self.assertEqual(payload["error"]["code"], "PROJECT_WRITE_LOCKED")
        self.assertEqual(payload["error"]["retryable"], True)
        self.assertEqual(
            payload["error"]["details"]["owner"]["command"],
            "test-holder-check",
        )
        self.assertEqual(_tree_state(self.project_a), project_before)
        self.assertEqual(lock_path.read_bytes(), lock_before, "争用失败方不得覆盖锁元数据")

        stop.write_text("stop", encoding="utf-8")
        holder.wait(timeout=5)
        holder.communicate(timeout=5)
        code, payload, stderr = run_cli("check", "--project", str(self.project_a))
        self.assertIn(code, (0, 1), stderr)
        self.assertTrue(payload["ok"])

    def test_crashed_holder_does_not_orphan_lock_and_other_project_remains_writable(self) -> None:
        holder, _stop = self._start_holder(self.project_a, "test-holder-crash")
        lock_path = self.project_a / PROJECT_LOCK_FILENAME
        lock_before = lock_path.read_bytes()
        project_before = _tree_state(self.project_a)

        code, payload, stderr = run_cli("verify", "--project", str(self.project_a))
        self.assertEqual(code, 2, stderr)
        self.assertEqual(payload["error"]["code"], "PROJECT_WRITE_LOCKED")
        self.assertEqual(_tree_state(self.project_a), project_before)
        self.assertEqual(lock_path.read_bytes(), lock_before)

        # 项目 B 使用不同的内核锁，不能被项目 A 的写事务阻塞。
        code, payload, stderr = run_cli("verify", "--project", str(self.project_b))
        self.assertEqual(code, 0, stderr)
        self.assertTrue(payload["ok"])

        # 模拟进程被强杀：没有 finally、没有删除锁文件；内核仍须自动释放锁。
        holder.terminate()
        holder.wait(timeout=5)
        holder.communicate(timeout=5)
        self.assertTrue(lock_path.is_file(), "锁文件是持久诊断载体，不靠删除判断存活")

        code, payload, stderr = run_cli("verify", "--project", str(self.project_a))
        self.assertEqual(code, 0, stderr)
        self.assertTrue(payload["ok"])
        self.assertNotEqual(lock_path.read_bytes(), lock_before, "新事务应安全接管并更新元数据")


if __name__ == "__main__":
    unittest.main()
