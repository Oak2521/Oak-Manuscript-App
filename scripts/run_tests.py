"""统一测试入口（方案 §18 阶段 1 要求：单条命令可重复通过）。

用法：python scripts/run_tests.py
零第三方依赖：unittest discover。退出码 0 = 全部通过。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PY_DIR = REPO / "python"


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass
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


if __name__ == "__main__":
    sys.exit(main())
