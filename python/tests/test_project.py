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

    def _add_check_report(
        self,
        *,
        check_id="check-0001",
        check_identity=None,
        report_identity=None,
        legacy=False,
    ):
        if check_identity is None:
            check_identity = dict(self.p.data["rulepack"])
        if report_identity is None:
            report_identity = dict(check_identity)
        check = {
            "check_id": check_id,
            "kind": "check",
            "started_at": "2026-07-27T00:00:00+00:00",
            "finished_at": "2026-07-27T00:00:01+00:00",
            "rulepack_version": check_identity["version"],
            "issue_counts": {"error": 0, "warning": 0, "suggestion": 0},
            "result_file": f"reports/{check_id}.json",
        }
        if not legacy:
            check["rulepack"] = dict(check_identity)
        result = {
            "schema_version": "1.0",
            "check_id": check_id,
            "rulepack": dict(report_identity),
        }
        (self.pdir / check["result_file"]).write_text(
            json.dumps(result, ensure_ascii=False),
            encoding="utf-8",
        )
        self.p.data["checks"].append(check)
        self.p.data["check_seq"] = max(self.p.data["check_seq"], int(check_id[6:]))
        self.p.save()
        return check, result

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

    def test_verify_detects_invalid_report_json_without_crashing(self):
        check, _result = self._add_check_report()
        (self.pdir / check["result_file"]).write_text("{", encoding="utf-8")

        problems = self.p.verify()

        self.assertTrue(any("有效 UTF-8 JSON" in item for item in problems))

    def test_verify_detects_non_object_report_without_crashing(self):
        check, _result = self._add_check_report()
        (self.pdir / check["result_file"]).write_text("[]", encoding="utf-8")

        problems = self.p.verify()

        self.assertTrue(any("顶层必须是 JSON 对象" in item for item in problems))

    def test_verify_detects_report_schema_mismatch(self):
        check, result = self._add_check_report()
        result["schema_version"] = "2.0"
        (self.pdir / check["result_file"]).write_text(
            json.dumps(result, ensure_ascii=False), encoding="utf-8"
        )

        problems = self.p.verify()

        self.assertTrue(any("schema_version" in item for item in problems))

    def test_verify_detects_report_check_id_mismatch(self):
        check, result = self._add_check_report()
        result["check_id"] = "check-9999"
        (self.pdir / check["result_file"]).write_text(
            json.dumps(result, ensure_ascii=False), encoding="utf-8"
        )

        problems = self.p.verify()

        self.assertTrue(any("check_id" in item for item in problems))

    def test_verify_detects_full_report_rulepack_mismatch(self):
        check, result = self._add_check_report()
        result["rulepack"]["manifest_sha256"] = "0" * 64
        (self.pdir / check["result_file"]).write_text(
            json.dumps(result, ensure_ascii=False), encoding="utf-8"
        )

        problems = self.p.verify()

        self.assertTrue(any("规则包身份与检查记录不一致" in item for item in problems))

    def test_verify_accepts_real_legacy_report_shape(self):
        current = self.p.data["rulepack"]
        legacy_identity = {"name": current["name"], "version": current["version"]}
        self._add_check_report(
            check_identity=current,
            report_identity=legacy_identity,
            legacy=True,
        )

        self.assertEqual(self.p.verify(), [])

    def test_verify_compares_historical_report_to_its_check_not_current_pin(self):
        historical = dict(self.p.data["rulepack"])
        historical.update(
            {
                "version": "0.9.0",
                "sha256": "0" * 64,
                "release_sequence": 1,
                "manifest_sha256": "1" * 64,
            }
        )
        self._add_check_report(check_identity=historical, report_identity=historical)

        self.assertNotEqual(historical, self.p.data["rulepack"])
        self.assertEqual(self.p.verify(), [])

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
