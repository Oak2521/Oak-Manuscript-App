"""CLI 端到端测试：以真实子进程走完 create→check→fix→recheck→export→verify 闭环。

这是 M1 里程碑完成标准的直接验证（方案阶段 1：不用桌面 UI 也能用匿名样本
通过创建、检查、修复、复检、导出和验证流程）。
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PY_DIR = REPO / "python"
SAMPLE = REPO / "samples" / "paper_needs_review.docx"


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
    payload = None
    if proc.stdout.strip():
        payload = json.loads(proc.stdout)
    return proc.returncode, payload, proc.stderr


class CliClosedLoopTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-cli-"))
        self.addCleanup(self._cleanup)
        self.pdir = self.tmp / "proj"

    def _cleanup(self):
        import stat

        for root_, _d, files in os.walk(self.tmp):
            for f in files:
                try:
                    os.chmod(os.path.join(root_, f), stat.S_IWRITE)
                except OSError:
                    pass
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_full_closed_loop_on_defect_sample(self):
        # 1. create
        code, out, err = run_cli(
            "create", "--input", str(SAMPLE), "--project", str(self.pdir),
            "--type", "paper",
        )
        self.assertEqual(code, 0, err)
        self.assertTrue(out["ok"])
        source_sha = out["source_sha256"]

        # 2. check：存在 error（REF-002）→ 退出码 1
        code, out, err = run_cli("check", "--project", str(self.pdir))
        self.assertEqual(code, 1, err)
        self.assertEqual(out["check_id"], "check-0001")
        self.assertEqual(out["status_level"], "尚未具备提交条件")
        self.assertGreater(out["issue_counts"]["warning"], 0)
        self.assertIn("gbt7714-2025", out["citation_note"])

        # 3. fix
        code, out, err = run_cli("fix", "--project", str(self.pdir))
        self.assertEqual(code, 0, err)
        self.assertGreater(out["applied_count"], 0)
        self.assertTrue(out["checkpoint_id"])

        # 4. recheck：白名单问题消失，error 仍在 → 退出码 1
        code, out, err = run_cli("recheck", "--project", str(self.pdir))
        self.assertEqual(code, 1, err)
        rules = {i["rule_id"] for i in out["issues"]}
        self.assertNotIn("DOCX-SPACE-001", rules)
        self.assertIn("REF-002", rules)

        # 5. export
        code, out, err = run_cli("export", "--project", str(self.pdir))
        self.assertEqual(code, 0, err)
        self.assertEqual(len(out["files"]), 4)
        for f in out["files"]:
            self.assertTrue(Path(f).is_file())

        # 6. verify：原稿不可变 → 退出码 0
        code, out, err = run_cli("verify", "--project", str(self.pdir))
        self.assertEqual(code, 0, err)
        self.assertTrue(out["ok"])
        self.assertEqual(out["problems"], [])
        self.assertEqual(out["source_sha256"], source_sha)

    def test_create_rejects_unsupported_format_with_exit_2(self):
        bad = self.tmp / "old.doc"
        bad.write_bytes(b"legacy")
        code, _out, err = run_cli("create", "--input", str(bad), "--project", str(self.pdir))
        self.assertEqual(code, 2)
        self.assertIn(".docx", err)

    def test_verify_detects_tampering_with_exit_2(self):
        run_cli("create", "--input", str(SAMPLE), "--project", str(self.pdir))
        import stat

        src = self.pdir / "source" / SAMPLE.name
        os.chmod(src, stat.S_IWRITE)
        src.write_bytes(b"tampered")
        code, out, _err = run_cli("verify", "--project", str(self.pdir))
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])


if __name__ == "__main__":
    unittest.main()
