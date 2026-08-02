"""受污染 project.json / 项目路径必须在任何业务写入前 fail-closed。"""

from __future__ import annotations

import json
import hashlib
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from oak_manuscript_core.errors import OakError
from oak_manuscript_core.project import Project
from oak_manuscript_core.project_lock import PROJECT_LOCK_FILENAME, ProjectWriteLock


PY_DIR = Path(__file__).resolve().parents[1]


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


def rmtree_force(path: Path) -> None:
    for root, dirs, files in os.walk(path):
        for name in [*dirs, *files]:
            try:
                os.chmod(Path(root) / name, stat.S_IWRITE)
            except OSError:
                pass
    shutil.rmtree(path, ignore_errors=True)


def tree_identity(path: Path):
    """文件树结构、文件字节与目录/文件时间身份；不存在时返回 None。"""
    if not os.path.lexists(path):
        return None
    result = []
    paths = [path, *sorted(path.rglob("*"), key=lambda item: item.as_posix())]
    for item in paths:
        info = os.lstat(item)
        relative = "." if item == path else item.relative_to(path).as_posix()
        digest = None
        if stat.S_ISREG(info.st_mode):
            digest = hashlib.sha256(item.read_bytes()).hexdigest()
        result.append(
            (
                relative,
                stat.S_IFMT(info.st_mode),
                info.st_size,
                info.st_mtime_ns,
                digest,
            )
        )
    return result


class ProjectValidationCliTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-project-validation-"))
        self.addCleanup(rmtree_force, self.tmp)
        self.source = self.tmp / "manuscript.txt"
        self.source.write_text("anonymous source\n", encoding="utf-8")
        self.sentinel = self.tmp / "outside-sentinel.txt"
        self.sentinel.write_bytes(b"OUTSIDE-MUST-NOT-CHANGE")

    def _project(self, name: str) -> Path:
        root = self.tmp / name
        Project.create(self.source, root, manuscript_type="print_book")
        return root

    @staticmethod
    def _mutate_manifest(root: Path, mutate) -> None:
        path = root / "project.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        mutate(data)
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )

    def _assert_rejected_without_sentinel_change(self, root: Path, *command: str) -> None:
        before = self.sentinel.read_bytes()
        code, payload, stderr = run_cli(*command, "--project", str(root))
        self.assertEqual(code, 2, stderr)
        self.assertIsNotNone(payload)
        self.assertEqual(payload["ok"], False)
        self.assertIn(
            payload["error"]["code"],
            {"PROJECT_VALIDATION_FAILED", "PROJECT_WRITE_LOCK_UNAVAILABLE"},
        )
        self.assertEqual(self.sentinel.read_bytes(), before)

    def test_stored_filename_rejects_traversal_and_absolute_path(self) -> None:
        for index, malicious in enumerate(("../../outside-sentinel.txt", str(self.sentinel))):
            with self.subTest(value=malicious):
                root = self._project(f"stored-{index}")
                self._mutate_manifest(
                    root,
                    lambda data, value=malicious: data["source"].__setitem__(
                        "stored_filename", value
                    ),
                )
                self._assert_rejected_without_sentinel_change(root, "check")

    def test_create_preflight_failures_leave_target_tree_byte_identical(self) -> None:
        missing_target = self.tmp / "missing-input-project"
        before = tree_identity(missing_target)
        code, payload, stderr = run_cli(
            "create",
            "--input", str(self.tmp / "does-not-exist.txt"),
            "--project", str(missing_target),
        )
        self.assertEqual(code, 2)
        self.assertIsNone(payload)
        self.assertIn("找不到输入文件", stderr)
        self.assertEqual(tree_identity(missing_target), before)

        unsupported = self.tmp / "legacy.doc"
        unsupported.write_bytes(b"LEGACY")
        unsupported_target = self.tmp / "unsupported-project"
        before = tree_identity(unsupported_target)
        code, payload, stderr = run_cli(
            "create", "--input", str(unsupported), "--project", str(unsupported_target)
        )
        self.assertEqual(code, 2)
        self.assertIsNone(payload)
        self.assertIn("不支持", stderr)
        self.assertEqual(tree_identity(unsupported_target), before)

        nonempty = self.tmp / "nonempty-project"
        nonempty.mkdir()
        (nonempty / "user-file.bin").write_bytes(b"USER-CONTENT")
        before = tree_identity(nonempty)
        code, payload, stderr = run_cli(
            "create", "--input", str(self.source), "--project", str(nonempty)
        )
        self.assertEqual(code, 2)
        self.assertIsNone(payload)
        self.assertIn("不为空", stderr)
        self.assertEqual(tree_identity(nonempty), before)

        sentinel_lock_dir = self.tmp / "ordinary-lock-target"
        sentinel_lock_dir.mkdir()
        sentinel_lock = sentinel_lock_dir / PROJECT_LOCK_FILENAME
        sentinel_lock.write_bytes(b"THIS-IS-A-USER-FILE-NOT-A-LOCK")
        before = tree_identity(sentinel_lock_dir)
        code, payload, stderr = run_cli(
            "create", "--input", str(self.source), "--project", str(sentinel_lock_dir)
        )
        self.assertEqual(code, 2, stderr)
        self.assertEqual(payload["error"]["code"], "PROJECT_WRITE_LOCK_UNAVAILABLE")
        self.assertEqual(tree_identity(sentinel_lock_dir), before)

    def test_readonly_input_may_resolve_through_cloud_link_to_regular_file(self) -> None:
        abstract_target = self.tmp / "abstract-cloud-project"
        with mock.patch(
            "oak_manuscript_core.project.is_link_or_reparse",
            return_value=True,
        ):
            # 输入来源不应再因 reparse 标志本身被拒；不存在的写目标不会调用该判定。
            Project.preflight_create(self.source, abstract_target)

        alias = self.tmp / "cloud-alias.txt"
        try:
            os.symlink(self.source, alias, target_is_directory=False)
        except (OSError, NotImplementedError):
            # Windows 未开启开发者模式时用最终常规文件硬链接保留正向覆盖；
            # 上面的抽象断言仍始终证明输入 reparse 标志不会触发拒绝。
            os.link(self.source, alias)
        root = self.tmp / "cloud-input-project"
        project = Project.create(alias, root, manuscript_type="print_book")
        self.assertEqual(project.source_path.read_bytes(), self.source.read_bytes())
        self.assertEqual(project.working_path.read_bytes(), self.source.read_bytes())

    def test_input_change_during_single_fd_copy_fails_closed_and_cleans_partial_project(self) -> None:
        root = self.tmp / "changing-input-project"
        original_copy = shutil.copyfileobj
        calls = 0

        def copy_then_change(source_stream, target_stream, *args, **kwargs):
            nonlocal calls
            calls += 1
            original_copy(source_stream, target_stream, *args, **kwargs)
            if calls == 1:
                self.source.write_bytes(b"changed while project was being created\n")

        with mock.patch(
            "oak_manuscript_core.project.shutil.copyfileobj",
            side_effect=copy_then_change,
        ), self.assertRaisesRegex(OakError, "复制期间发生变化"):
            Project.create(self.source, root, manuscript_type="print_book")
        self.assertFalse(root.exists(), "本事务创建的半项目必须精确清理")

    def test_locked_create_opens_input_once_then_copies_from_controlled_source(self) -> None:
        root = self.tmp / "single-open-project"
        Project.preflight_create(self.source, root)
        real_open = open
        input_opens = 0

        def tracking_open(path, *args, **kwargs):
            nonlocal input_opens
            if Path(path).absolute() == self.source.absolute():
                input_opens += 1
            return real_open(path, *args, **kwargs)

        with ProjectWriteLock(
            root,
            command="create",
            create_root=True,
            cleanup_on_error=True,
        ):
            with mock.patch("builtins.open", side_effect=tracking_open):
                project = Project.create(
                    self.source,
                    root,
                    manuscript_type="print_book",
                )

        self.assertEqual(input_opens, 1, "锁内只能打开一次用户输入来源")
        self.assertEqual(project.source_path.read_bytes(), self.source.read_bytes())
        self.assertEqual(project.working_path.read_bytes(), project.source_path.read_bytes())

    def test_partial_copy_failure_preserves_empty_target_and_restores_protocol_lock(self) -> None:
        def partial_then_fail(source_stream, target_stream, *args, **kwargs):
            target_stream.write(source_stream.read(4))
            raise OakError("injected partial copy failure")

        existing_empty = self.tmp / "existing-empty-copy-failure"
        existing_empty.mkdir()
        with mock.patch(
            "oak_manuscript_core.project.shutil.copyfileobj",
            side_effect=partial_then_fail,
        ), self.assertRaisesRegex(OakError, "injected partial copy failure"):
            with ProjectWriteLock(
                existing_empty,
                command="create",
                create_root=True,
                cleanup_on_error=True,
            ):
                Project.create(self.source, existing_empty, manuscript_type="print_book")
        self.assertTrue(existing_empty.is_dir(), "用户原有空目录必须保留")
        self.assertEqual(list(existing_empty.iterdir()), [], "失败后不得留下半项目或锁")

        protocol_root = self.tmp / "protocol-copy-failure"
        protocol_root.mkdir()
        with ProjectWriteLock(protocol_root, command="seed"):
            pass
        lock_path = protocol_root / PROJECT_LOCK_FILENAME
        lock_before = lock_path.read_bytes()
        with mock.patch(
            "oak_manuscript_core.project.shutil.copyfileobj",
            side_effect=partial_then_fail,
        ), self.assertRaisesRegex(OakError, "injected partial copy failure"):
            with ProjectWriteLock(
                protocol_root,
                command="create",
                create_root=True,
                cleanup_on_error=True,
            ):
                Project.create(self.source, protocol_root, manuscript_type="print_book")
        self.assertEqual(list(protocol_root.iterdir()), [lock_path])
        self.assertEqual(lock_path.read_bytes(), lock_before, "旧协议锁字节必须精确恢复")

    def test_noncreate_preflight_never_touches_arbitrary_directory_or_lock_sentinel(self) -> None:
        arbitrary = self.tmp / "arbitrary-directory"
        arbitrary.mkdir()
        (arbitrary / "keep.bin").write_bytes(b"KEEP")
        before = tree_identity(arbitrary)
        code, payload, _stderr = run_cli("verify", "--project", str(arbitrary))
        self.assertEqual(code, 2)
        self.assertEqual(payload["error"]["code"], "PROJECT_VALIDATION_FAILED")
        self.assertEqual(tree_identity(arbitrary), before)
        self.assertFalse((arbitrary / PROJECT_LOCK_FILENAME).exists())

        sentinel_dir = self.tmp / "arbitrary-with-lock-name"
        sentinel_dir.mkdir()
        (sentinel_dir / PROJECT_LOCK_FILENAME).write_bytes(b"USER-SENTINEL")
        before = tree_identity(sentinel_dir)
        code, payload, _stderr = run_cli("check", "--project", str(sentinel_dir))
        self.assertEqual(code, 2)
        self.assertEqual(payload["error"]["code"], "PROJECT_VALIDATION_FAILED")
        self.assertEqual(tree_identity(sentinel_dir), before)

        valid_project = self._project("valid-with-user-lock-name")
        user_lock = valid_project / PROJECT_LOCK_FILENAME
        user_lock.write_bytes(b"USER-SENTINEL-IN-VALID-PROJECT")
        before = tree_identity(valid_project)
        code, payload, _stderr = run_cli("verify", "--project", str(valid_project))
        self.assertEqual(code, 2)
        self.assertEqual(payload["error"]["code"], "PROJECT_WRITE_LOCK_UNAVAILABLE")
        self.assertEqual(tree_identity(valid_project), before)

    def test_all_manifest_controlled_paths_reject_escape(self) -> None:
        mutations = {
            "issues": lambda data: data.__setitem__(
                "issues_file", "../../outside-sentinel.txt"
            ),
            "check-result": lambda data: data.update(
                {
                    "check_seq": 1,
                    "checks": [
                        {
                            "check_id": "check-0001",
                            "result_file": "../../outside-sentinel.txt",
                        }
                    ],
                }
            ),
            "checkpoint": lambda data: data.update(
                {
                    "checkpoint_seq": 1,
                    "checkpoints": [
                        {
                            "checkpoint_id": "cp-0001",
                            "path": "../outside",
                        }
                    ],
                }
            ),
            "fix-checkpoint": lambda data: data.update(
                {
                    "fixes": [
                        {
                            "fix_run_id": "fix-0001",
                            "checkpoint_id": "../../outside",
                            "applied": [],
                        }
                    ]
                }
            ),
        }
        for name, mutation in mutations.items():
            with self.subTest(field=name):
                root = self._project(f"manifest-{name}")
                self._mutate_manifest(root, mutation)
                self._assert_rejected_without_sentinel_change(root, "export")

    def _replace_with_symlink(self, path: Path, target: Path, *, directory: bool) -> None:
        if path.is_dir() and not path.is_symlink():
            rmtree_force(path)
        else:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
        try:
            os.symlink(target, path, target_is_directory=directory)
        except (OSError, NotImplementedError) as exc:
            if os.name == "nt" and directory:
                created = subprocess.run(
                    ["cmd.exe", "/d", "/c", "mklink", "/J", str(path), str(target)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )
                if created.returncode == 0 and path.exists():
                    return
            if not directory:
                try:
                    os.link(target, path)
                    return
                except OSError:
                    pass
            self.skipTest(f"当前测试环境不允许创建链接或目录联接：{exc}")

    def test_manifest_and_fixed_subdirectory_symlinks_are_rejected(self) -> None:
        manifest_root = self._project("manifest-link")
        outside_manifest = self.tmp / "outside-project.json"
        outside_manifest.write_bytes((manifest_root / "project.json").read_bytes())
        self._replace_with_symlink(
            manifest_root / "project.json", outside_manifest, directory=False
        )
        before_manifest = outside_manifest.read_bytes()
        self._assert_rejected_without_sentinel_change(manifest_root, "check")
        self.assertEqual(outside_manifest.read_bytes(), before_manifest)

        for subdir in ("source", "working", "checkpoints", "reports", "exports", "logs"):
            with self.subTest(fixed_subdir=subdir):
                linked_root = self._project(f"fixed-{subdir}-link")
                outside_dir = self.tmp / f"outside-{subdir}"
                outside_dir.mkdir()
                outside_keep = outside_dir / "keep.txt"
                outside_keep.write_bytes(b"KEEP")
                self._replace_with_symlink(
                    linked_root / subdir, outside_dir, directory=True
                )
                self._assert_rejected_without_sentinel_change(linked_root, "export")
                self.assertEqual(outside_keep.read_bytes(), b"KEEP")
                self.assertEqual(list(outside_dir.iterdir()), [outside_keep])

    def test_source_and_working_links_or_same_file_are_rejected(self) -> None:
        source_link_root = self._project("source-link")
        source_path = source_link_root / "source" / self.source.name
        os.chmod(source_path, stat.S_IWRITE)
        self._replace_with_symlink(source_path, self.sentinel, directory=False)
        self._assert_rejected_without_sentinel_change(source_link_root, "check")

        working_link_root = self._project("working-link")
        working_path = working_link_root / "working" / self.source.name
        self._replace_with_symlink(working_path, self.sentinel, directory=False)
        self._assert_rejected_without_sentinel_change(working_link_root, "check")

        same_root = self._project("source-working-same")
        source_path = same_root / "source" / self.source.name
        working_path = same_root / "working" / self.source.name
        working_path.unlink()
        try:
            os.link(source_path, working_path)
        except OSError as exc:
            self.skipTest(f"当前测试环境不允许创建硬链接：{exc}")
        source_before = source_path.read_bytes()
        self._assert_rejected_without_sentinel_change(same_root, "check")
        self.assertEqual(source_path.read_bytes(), source_before)

    def test_project_root_symlink_is_rejected_before_external_target_write(self) -> None:
        real_root = self._project("real-project")
        alias = self.tmp / "project-alias"
        self._replace_with_symlink(alias, real_root, directory=True)
        real_tree_before = {
            path.relative_to(real_root).as_posix(): path.read_bytes()
            for path in real_root.rglob("*")
            if path.is_file()
        }
        self._assert_rejected_without_sentinel_change(alias, "check")
        real_tree_after = {
            path.relative_to(real_root).as_posix(): path.read_bytes()
            for path in real_root.rglob("*")
            if path.is_file()
        }
        self.assertEqual(real_tree_after, real_tree_before)

    def test_explicit_export_rejects_linked_parent_and_hardlinked_target_atomically(self) -> None:
        root = self._project("export-project")
        code, payload, stderr = run_cli("check", "--project", str(root))
        self.assertIn(code, (0, 1), stderr)
        self.assertTrue(payload["ok"])

        hardlink_out = self.tmp / "hardlink-out"
        hardlink_out.mkdir()
        report_target = hardlink_out / "report.json"
        try:
            os.link(self.sentinel, report_target)
        except OSError as exc:
            self.skipTest(f"当前测试环境不允许创建硬链接：{exc}")
        sentinel_before = self.sentinel.read_bytes()
        code, payload, stderr = run_cli(
            "export", "--project", str(root), "--out", str(hardlink_out)
        )
        self.assertEqual(code, 2, stderr)
        self.assertEqual(payload["error"]["code"], "PROJECT_VALIDATION_FAILED")
        self.assertEqual(self.sentinel.read_bytes(), sentinel_before)
        self.assertEqual(
            {path.name for path in hardlink_out.iterdir()},
            {"report.json"},
            "全目标预检必须避免先写入部分导出文件",
        )

        real_out = self.tmp / "real-external-out"
        real_out.mkdir()
        outside_keep = real_out / "keep.txt"
        outside_keep.write_bytes(b"KEEP-EXTERNAL")
        linked_out = self.tmp / "linked-out"
        self._replace_with_symlink(linked_out, real_out, directory=True)
        code, payload, stderr = run_cli(
            "export", "--project", str(root), "--out", str(linked_out)
        )
        self.assertEqual(code, 2, stderr)
        self.assertEqual(payload["error"]["code"], "PROJECT_VALIDATION_FAILED")
        self.assertEqual(outside_keep.read_bytes(), b"KEEP-EXTERNAL")
        self.assertEqual({path.name for path in real_out.iterdir()}, {"keep.txt"})


if __name__ == "__main__":
    unittest.main()
