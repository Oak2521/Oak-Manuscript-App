"""外部验证工具运行器（EpubCheck / Ace）。

纪律（方案 §24 第 9 条）：工具未实际运行绝不声称「通过」。
状态取值：not_run（未运行/工具缺失）| passed（已运行且零错误）| failed（已运行且发现问题）。
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_TIMEOUT = 300


def discover_tools(repo_root: Path | None = None) -> dict:
    root = Path(repo_root) if repo_root else _REPO
    java = shutil.which("java")
    jar = None
    tools_dir = root / "tools"
    if tools_dir.is_dir():
        candidates = sorted(tools_dir.glob("epubcheck-*/epubcheck.jar"))
        if candidates:
            jar = str(candidates[-1])
    ace = None
    for name in ("ace.cmd", "ace"):
        candidate = root / "node_modules" / ".bin" / name
        if candidate.is_file():
            ace = str(candidate)
            break
    # Ace 依赖 Chromium；安装时跳过了内置下载，运行时用本机 Chrome
    chrome = None
    import os

    for candidate in (
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ):
        if Path(candidate).is_file():
            chrome = candidate
            break
    return {"java": java, "epubcheck_jar": jar, "ace": ace, "chrome": chrome}


def run_epubcheck(epub_path: Path, report_json: Path, *, jar: str, java: str) -> dict:
    """运行 EpubCheck，JSON 报告写入 report_json。"""
    proc = subprocess.run(
        [java, "-jar", jar, "--json", str(report_json), str(epub_path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=_TIMEOUT,
    )
    fatals = errors = warnings = -1
    version = ""
    try:
        data = json.loads(report_json.read_text(encoding="utf-8"))
        checker = data.get("checker", {})
        fatals = checker.get("nFatal", -1)
        errors = checker.get("nError", -1)
        warnings = checker.get("nWarning", -1)
        version = checker.get("checkerVersion", "")
    except (OSError, json.JSONDecodeError):
        pass
    status = "passed" if proc.returncode == 0 else "failed"
    detail = (
        f"EpubCheck {version}：{fatals} fatal / {errors} error / {warnings} warning"
        if errors >= 0 else f"EpubCheck 退出码 {proc.returncode}"
    )
    return {"status": status, "detail": detail}


def run_ace(epub_path: Path, out_dir: Path, *, ace: str, chrome: str | None = None) -> dict:
    """运行 Ace by DAISY，可访问性报告写入 out_dir。"""
    import os

    env = dict(os.environ)
    if chrome:
        env["PUPPETEER_EXECUTABLE_PATH"] = chrome
    proc = subprocess.run(
        [ace, "-f", "-o", str(out_dir), str(epub_path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=_TIMEOUT, shell=False, env=env,
    )
    outcome = None
    violations = -1
    try:
        report = json.loads((out_dir / "report.json").read_text(encoding="utf-8"))
        outcome = report.get("earl:result", {}).get("earl:outcome")
        violations = sum(len(a.get("assertions", [])) for a in report.get("assertions", []))
    except (OSError, json.JSONDecodeError):
        pass
    if outcome is None:
        return {"status": "failed", "detail": f"Ace 运行失败（退出码 {proc.returncode}）"}
    status = "passed" if outcome == "pass" else "failed"
    detail = f"Ace：整体 {outcome}，{violations} 项断言（含可访问性元数据检查）"
    return {"status": status, "detail": detail}
