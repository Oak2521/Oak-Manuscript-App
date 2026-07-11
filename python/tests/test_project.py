"""项目管理核心测试：创建 / 哈希 / 检查点 / 完整性验证。"""

import hashlib
import json
import os
import shutil
import stat
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core import project as prj
from oak_manuscript_core.errors import OakError
from tests.docx_factory import DocxBuilder

SUBDIRS = ["source", "working", "checkpoints", "reports", "exports", "logs"]


def rmtree_force(path: Path) -> None:
    """删除含只读文件的目录树（原稿副本是只读的）。"""
    for root_, _dirs, files in os.walk(path):
        for f in files:
            try:
                os.chmod(os.path.join(root_, f), stat.S_IWRITE)
            except OSError:
                pass
    shutil.rmtree(path, ignore_errors=True)


def make_input(dirpath: Path, name: str = "manuscript.docx") -> Path:
    path = dirpath / name
    DocxBuilder().p("题名").p("正文段落。").save(str(path))
    return path


class CreateProjectTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(rmtree_force, self.tmp)

    def test_create_builds_structure_and_hashes_source(self):
        src = make_input(self.tmp)
        pdir = self.tmp / "proj"
        p = prj.Project.create(src, pdir, manuscript_type="paper")

        for sub in SUBDIRS:
            self.assertTrue((pdir / sub).is_dir(), f"缺少子目录 {sub}")
        data = json.loads((pdir / "project.json").read_text(encoding="utf-8"))
        self.assertEqual(data["format_version"], "1.0")
        expected = hashlib.sha256(src.read_bytes()).hexdigest()
        self.assertEqual(data["source"]["sha256"], expected)
        self.assertEqual(data["source"]["stored_filename"], "manuscript.docx")
        self.assertEqual(data["source"]["format"], "docx")
        # 原稿副本与工作副本字节一致
        self.assertEqual((pdir / "source" / "manuscript.docx").read_bytes(), src.read_bytes())
        self.assertEqual((pdir / "working" / "manuscript.docx").read_bytes(), src.read_bytes())
        # 默认设置
        self.assertEqual(data["settings"]["manuscript_type"], "paper")
        self.assertEqual(data["settings"]["citation_style"], "default")
        self.assertIsNone(data["settings"]["citation_style_resolved"])
        self.assertEqual(p.source_sha256, expected)

    def test_create_rejects_nonempty_target(self):
        src = make_input(self.tmp)
        pdir = self.tmp / "proj"
        pdir.mkdir()
        (pdir / "existing.txt").write_text("x", encoding="utf-8")
        with self.assertRaises(OakError):
            prj.Project.create(src, pdir)

    def test_create_rejects_unsupported_format(self):
        bad = self.tmp / "file.doc"
        bad.write_bytes(b"legacy")
        with self.assertRaises(OakError) as ctx:
            prj.Project.create(bad, self.tmp / "proj")
        self.assertIn("doc", str(ctx.exception))

    def test_create_rejects_missing_input(self):
        with self.assertRaises(OakError):
            prj.Project.create(self.tmp / "nope.docx", self.tmp / "proj")

    def test_open_roundtrip(self):
        src = make_input(self.tmp)
        pdir = self.tmp / "proj"
        prj.Project.create(src, pdir, manuscript_type="paper")
        p = prj.Project.open(pdir)
        self.assertEqual(p.data["settings"]["manuscript_type"], "paper")
        self.assertEqual(p.working_path.name, "manuscript.docx")


class CheckpointTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(rmtree_force, self.tmp)
        src = make_input(self.tmp)
        self.pdir = self.tmp / "proj"
        self.p = prj.Project.create(src, self.pdir)

    def test_checkpoint_copies_working_file(self):
        cp = self.p.make_checkpoint(reason="before_fix")
        cp_dir = self.pdir / "checkpoints" / cp["checkpoint_id"]
        self.assertTrue((cp_dir / "manuscript.docx").exists())
        self.assertEqual(
            (cp_dir / "manuscript.docx").read_bytes(), self.p.working_path.read_bytes()
        )
        self.assertEqual(len(self.p.data["checkpoints"]), 1)

    def test_checkpoint_prunes_oldest_beyond_five(self):
        for i in range(7):
            # 让每个检查点内容可区分
            self.p.working_path.write_bytes(b"v%d" % i + self.p.working_path.read_bytes()[:100])
            self.p.make_checkpoint(reason="before_fix")
        self.assertEqual(len(self.p.data["checkpoints"]), 5)
        ids = [c["checkpoint_id"] for c in self.p.data["checkpoints"]]
        # 最早两个被清理
        self.assertNotIn("cp-0001", ids)
        self.assertNotIn("cp-0002", ids)
        self.assertIn("cp-0007", ids)
        remaining = sorted(d.name for d in (self.pdir / "checkpoints").iterdir())
        self.assertEqual(remaining, sorted(ids))

    def test_restore_checkpoint(self):
        original = self.p.working_path.read_bytes()
        cp = self.p.make_checkpoint(reason="before_fix")
        self.p.working_path.write_bytes(b"changed")
        self.p.restore_checkpoint(cp["checkpoint_id"])
        self.assertEqual(self.p.working_path.read_bytes(), original)


class VerifyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(rmtree_force, self.tmp)
        src = make_input(self.tmp)
        self.pdir = self.tmp / "proj"
        self.p = prj.Project.create(src, self.pdir)

    def test_verify_ok_on_fresh_project(self):
        problems = self.p.verify()
        self.assertEqual(problems, [])

    def test_source_copy_is_readonly(self):
        source_file = self.pdir / "source" / "manuscript.docx"
        self.assertFalse(os.access(source_file, os.W_OK), "原稿副本应为只读")

    def test_verify_detects_source_tampering(self):
        source_file = self.pdir / "source" / "manuscript.docx"
        os.chmod(source_file, stat.S_IWRITE)  # 模拟外部强行破坏
        source_file.write_bytes(b"tampered")
        problems = self.p.verify()
        self.assertTrue(any("SHA-256" in s or "哈希" in s for s in problems))

    def test_verify_detects_missing_subdir(self):
        shutil.rmtree(self.pdir / "exports")
        problems = self.p.verify()
        self.assertTrue(any("exports" in s for s in problems))

    def test_operations_never_touch_source_hash(self):
        before = hashlib.sha256((self.pdir / "source" / "manuscript.docx").read_bytes()).hexdigest()
        self.p.make_checkpoint(reason="before_fix")
        self.p.working_path.write_bytes(b"working changed")
        self.p.save()
        after = hashlib.sha256((self.pdir / "source" / "manuscript.docx").read_bytes()).hexdigest()
        self.assertEqual(before, after)
        self.assertEqual(self.p.verify(), [])


if __name__ == "__main__":
    unittest.main()
