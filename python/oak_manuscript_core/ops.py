"""服务层编排：check / fix / recheck / export 的完整闭环。

CLI（__main__）与未来的 Electron 桥都只调用本层，不直接碰引擎与文件细节。
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from . import __version__
from .engine import check_document, manuscript_status_level
from .errors import OakError
from .fixes import WHITELIST, apply_fixes
from .project import Project
from .readers.docx_reader import read_docx
from .safety import ensure_within
from .util import now_iso, read_json, write_json

DISCLAIMER = (
    "本报告仅代表稿件的技术与规范准备程度，不评价学术质量、文学价值或出版可行性，"
    "不构成任何出版承诺。全部检查在本机完成，稿件未被上传。"
)

_STATUS_VALUES = {"open", "accepted", "rejected", "resolved"}


def _read_document(project: Project):
    fmt = project.source_format
    if fmt == "docx":
        return read_docx(project.working_path)
    if fmt in ("md", "txt"):
        raise OakError(f"「.{fmt}」输入将在 M2 里程碑支持；当前版本（M1）仅支持 DOCX。")
    raise OakError("「.epub」输入将在 M3 里程碑支持；当前版本（M1）仅支持 DOCX。")


def _issue_key(issue: dict) -> tuple:
    # 不含段落号：修复（如删除空段）会使后续段落序号整体前移，
    # 预览文本 + 规则 + 部位 + 注号足以稳定定位同一问题。
    loc = issue["location"]
    return (issue["rule_id"], loc["part"], loc["note_id"], issue["preview"])


def load_issues(project: Project) -> list[dict]:
    path = project.root / "reports" / "issues.json"
    if not path.is_file():
        return []
    return read_json(path)


def save_issues(project: Project, issues: list[dict]) -> None:
    write_json(project.root / "reports" / "issues.json", issues)


def set_issue_status(project: Project, issue_id: str, status: str) -> dict:
    if status not in _STATUS_VALUES:
        raise OakError(f"无效的问题状态「{status}」，允许：{sorted(_STATUS_VALUES)}")
    issues = load_issues(project)
    for issue in issues:
        if issue["issue_id"] == issue_id:
            issue["status"] = status
            save_issues(project, issues)
            return issue
    raise OakError(f"找不到问题：{issue_id}")


def _citation_note(settings: dict) -> str:
    style = settings["citation_style_resolved"]
    if settings["citation_resolved_by"] == "default_mapping":
        origin = f"（由默认规则 v{settings['citation_mapping_version']} 按稿件类型与语言选定）"
    else:
        origin = "（由用户指定）"
    if style == "none":
        return f"本次未检查引用格式{origin}"
    return f"本次按 {style} 体例检查{origin}"


def run_check(project: Project, pack: dict, *, kind: str = "check"):
    """执行检查（或复检），持久化结果。返回 (check 记录, CheckOutcome)。"""
    doc = _read_document(project)
    project.data["check_seq"] = project.data.get("check_seq", 0) + 1
    check_id = f"check-{project.data['check_seq']:04d}"
    started = now_iso()
    outcome = check_document(
        doc, project.data["settings"], pack,
        doc_format=project.source_format, check_id=check_id,
    )
    finished = now_iso()

    # 已拒绝的问题在复检后保持拒绝状态（多重集合匹配：一次拒绝只携带到一条新问题）
    from collections import Counter

    rejected_keys = Counter(
        _issue_key(i) for i in load_issues(project) if i["status"] == "rejected"
    )
    for issue in outcome.issues:
        key = _issue_key(issue)
        if rejected_keys.get(key, 0) > 0:
            issue["status"] = "rejected"
            rejected_keys[key] -= 1

    settings = project.data["settings"]
    settings.update(outcome.resolved)
    project.data["rulepack"] = {
        "name": pack["pack_name"], "version": pack["pack_version"], "pinned": True,
    }

    counts = {"error": 0, "warning": 0, "suggestion": 0}
    for issue in outcome.issues:
        counts[issue["severity"]] += 1

    record = {
        "check_id": check_id,
        "kind": kind,
        "started_at": started,
        "finished_at": finished,
        "rulepack_version": pack["pack_version"],
        "issue_counts": counts,
        "result_file": f"reports/{check_id}.json",
    }
    result_doc = {
        "schema_version": "1.0",
        "check_id": check_id,
        "kind": kind,
        "started_at": started,
        "finished_at": finished,
        "app_version": __version__,
        "rulepack": {"name": pack["pack_name"], "version": pack["pack_version"]},
        "settings_snapshot": dict(settings),
        "citation_note": _citation_note(settings),
        "issues": outcome.issues,
        "skipped_rule_groups": outcome.skipped_rule_groups,
        "external_tools": {"epubcheck": "not_run", "ace": "not_run"},
        "disclaimer": DISCLAIMER,
    }
    write_json(project.root / record["result_file"], result_doc)
    save_issues(project, outcome.issues)
    project.data["checks"].append(record)
    project.data["issues_file"] = "reports/issues.json"
    project.save()
    return record, outcome


def run_fixes(project: Project, pack: dict):
    """对 open 且可自动修复的问题应用白名单修复。返回 (fix 记录, 计数)。"""
    issues = load_issues(project)
    fixable = [
        i for i in issues
        if i["status"] in ("open", "accepted") and i["auto_fixable"] and i["fix_id"] in WHITELIST
    ]
    if not fixable:
        return {"applied": []}, {}

    checkpoint = project.make_checkpoint(reason="before_fix")
    fix_ids = {i["fix_id"] for i in fixable}
    counts = apply_fixes(project.working_path, fix_ids)

    for issue in issues:
        if issue in fixable:
            issue["status"] = "resolved"
    record = {
        "fix_run_id": f"fix-{len(project.data['fixes']) + 1:04d}",
        "applied_at": now_iso(),
        "checkpoint_id": checkpoint["checkpoint_id"],
        "applied": [
            {"issue_id": i["issue_id"], "rule_id": i["rule_id"], "fix_id": i["fix_id"]}
            for i in fixable
        ],
        "counts": counts,
    }
    project.data["fixes"].append(record)
    save_issues(project, issues)
    project.save()
    return record, counts


def build_report_data(project: Project, pack: dict) -> dict:
    if not project.data["checks"]:
        raise OakError("尚未运行检查，无法生成报告。请先执行 check。")
    last = project.data["checks"][-1]
    result = read_json(project.root / last["result_file"])
    issues = load_issues(project)

    pending = {"error": 0, "warning": 0, "suggestion": 0}
    for issue in issues:
        if issue["status"] in ("open", "accepted"):
            pending[issue["severity"]] += 1

    applied: dict[str, int] = {}
    for fix_run in project.data["fixes"]:
        for entry in fix_run["applied"]:
            applied[entry["rule_id"]] = applied.get(entry["rule_id"], 0) + 1

    titles = {r["rule_id"]: r["title"] for r in pack["rules"]}
    return {
        "generated_at": now_iso(),
        "app_version": __version__,
        "file": project.stored_filename,
        "manuscript_type": project.data["settings"]["manuscript_type"],
        "check": last,
        "rulepack": {"name": pack["pack_name"], "version": pack["pack_version"]},
        "citation_note": result["citation_note"],
        "status_level": manuscript_status_level(issues),
        "pending_counts": pending,
        "issues": issues,
        "applied_fixes": [
            {"rule_id": rid, "title": titles.get(rid, rid), "count": n}
            for rid, n in sorted(applied.items())
        ],
        "skipped_rule_groups": result["skipped_rule_groups"],
        "external_tools": result["external_tools"],
        "disclaimer": DISCLAIMER,
    }


def export_project(project: Project, pack: dict, out_dir: Path | None = None) -> list[Path]:
    """导出修订稿 + 三种报告。默认写入项目 exports/，或用户明确指定的目录。"""
    from .reports import render_html, render_markdown

    report = build_report_data(project, pack)
    target_dir = Path(out_dir) if out_dir is not None else project.root / "exports"
    target_dir.mkdir(parents=True, exist_ok=True)
    base = target_dir if out_dir is not None else project.root

    written: list[Path] = []

    revised = ensure_within(base, target_dir / f"revised_{project.stored_filename}")
    shutil.copyfile(project.working_path, revised)
    written.append(revised)

    json_path = ensure_within(base, target_dir / "report.json")
    write_json(json_path, report)
    written.append(json_path)

    md_path = ensure_within(base, target_dir / "report.md")
    md_path.write_text(render_markdown(report), encoding="utf-8", newline="\n")
    written.append(md_path)

    html_path = ensure_within(base, target_dir / "report.html")
    html_path.write_text(render_html(report), encoding="utf-8", newline="\n")
    written.append(html_path)

    project.save()
    return written
