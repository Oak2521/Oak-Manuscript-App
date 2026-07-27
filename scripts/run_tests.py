"""统一测试入口（方案 §18 阶段 1 要求：单条命令可重复通过）。

用法：python scripts/run_tests.py
零第三方依赖：unittest discover。退出码 0 = 全部通过。
"""

from __future__ import annotations

import os
import shutil
import stat
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PY_DIR = REPO / "python"
TEST_TEMP_ROOT = REPO / "out" / "test-tmp" / "python"


def _inside(root: Path, target: Path) -> bool:
    try:
        target.resolve().relative_to(root.resolve())
    except (OSError, ValueError):
        return False
    return True


def _is_link_or_junction(target: Path) -> bool:
    if target.is_symlink():
        return True
    is_junction = getattr(target, "is_junction", None)
    return bool(is_junction and is_junction())


def _ensure_safe_directory(root: Path, target: Path) -> None:
    root = root.absolute()
    target = target.absolute()
    try:
        relative = target.relative_to(root)
    except ValueError as error:
        raise RuntimeError(f"测试临时目录逃逸项目：{target}") from error
    root_real = root.resolve(strict=True)
    cursor = root
    for segment in relative.parts:
        cursor = cursor / segment
        try:
            current_stat = cursor.lstat()
        except FileNotFoundError:
            cursor.mkdir()
            current_stat = cursor.lstat()
        if not stat.S_ISDIR(current_stat.st_mode) or _is_link_or_junction(cursor):
            raise RuntimeError(f"测试临时路径包含链接或非目录，拒绝写入：{cursor}")
        try:
            cursor.resolve(strict=True).relative_to(root_real)
        except (OSError, ValueError) as error:
            raise RuntimeError(f"测试临时路径真实位置逃逸项目：{cursor}") from error


def _configure_test_tempdir() -> Path:
    _ensure_safe_directory(REPO, TEST_TEMP_ROOT)
    run_temp = Path(tempfile.mkdtemp(prefix=f"run-{os.getpid()}-", dir=TEST_TEMP_ROOT))
    if not _inside(REPO, run_temp) or _is_link_or_junction(run_temp):
        raise RuntimeError(f"测试临时目录逃逸项目：{run_temp}")
    value = str(run_temp.resolve())
    for name in ("TEMP", "TMP", "TMPDIR"):
        os.environ[name] = value
    tempfile.tempdir = value
    assert Path(tempfile.gettempdir()).resolve() == run_temp.resolve()
    return run_temp


def _cleanup_test_tempdir(run_temp: Path) -> None:
    run_temp = run_temp.absolute()
    if not _inside(REPO, run_temp) or _is_link_or_junction(run_temp):
        raise RuntimeError(f"拒绝清理不安全的测试临时目录：{run_temp}")

    def prepare(directory: Path) -> None:
        for entry in os.scandir(directory):
            item = Path(entry.path)
            info = entry.stat(follow_symlinks=False)
            if _is_link_or_junction(item):
                try:
                    item.unlink()
                except OSError:
                    item.rmdir()
            elif stat.S_ISDIR(info.st_mode):
                prepare(item)
                item.chmod(0o700)
            elif stat.S_ISREG(info.st_mode) and getattr(info, "st_nlink", 1) <= 1:
                item.chmod(0o600)
            else:
                # 硬链接或特殊文件只移除本目录项，绝不 chmod 共享 inode。
                item.unlink()

    prepare(run_temp)
    run_temp.chmod(0o700)
    shutil.rmtree(run_temp)


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass
    run_temp = _configure_test_tempdir()
    try:
        sys.path.insert(0, str(PY_DIR))
        missing = [
            name for name in ("paper_good.docx", "paper_needs_review.docx", "paper_missing_parts.docx")
            if not (REPO / "samples" / name).is_file()
        ]
        if missing:
            print(f"缺少样本 {missing}，先运行：python scripts/make_samples.py", file=sys.stderr)
            return 2
        suite = unittest.defaultTestLoader.discover(
            str(PY_DIR / "tests"), top_level_dir=str(PY_DIR)
        )
        result = unittest.TextTestRunner(verbosity=1).run(suite)
        print(
            f"\n合计：{result.testsRun} 项测试，"
            f"失败 {len(result.failures)}，错误 {len(result.errors)}。"
        )
        return 0 if result.wasSuccessful() else 1
    finally:
        _cleanup_test_tempdir(run_temp)
        tempfile.tempdir = None


if __name__ == "__main__":
    sys.exit(main())
