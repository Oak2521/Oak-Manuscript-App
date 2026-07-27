"""服务层编排：check / fix / recheck / export 的完整闭环。

CLI（__main__）与未来的 Electron 桥都只调用本层，不直接碰引擎与文件细节。
"""

from __future__ import annotations

import copy
import json
import os
import shutil
import tempfile
from pathlib import Path

from . import __version__
from .engine import check_document, manuscript_status_level
from .errors import OakError
from .fix_plans import build_fix_plan
from .fixes import WHITELIST, apply_fixes
from .project import MAX_CHECKPOINTS, Project
from .readers.docx_reader import read_docx
from .safety import ensure_within
from .util import now_iso, read_json, sha256_file, write_json

DISCLAIMER = (
    "本报告仅代表稿件的技术与规范准备程度，不评价学术质量、文学价值或出版可行性，"
    "不构成任何出版承诺。全部检查在本机完成，稿件未被上传。"
)

_STATUS_VALUES = {"open", "accepted", "rejected", "resolved"}


def _read_document(project: Project):
    fmt = project.source_format
    if fmt == "docx":
        return read_docx(project.working_path)
    if fmt == "md":
        from .readers.md_reader import read_md

        return read_md(project.working_path)
    if fmt == "txt":
        from .readers.txt_reader import read_txt

        return read_txt(project.working_path)
    from .readers.epub_reader import read_epub

    return read_epub(project.working_path)


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


def _ensure_source_unchanged(project: Project) -> None:
    if not project.source_path.is_file():
        raise OakError("原稿副本缺失，拒绝生成或执行修复计划。")
    if sha256_file(project.source_path) != project.source_sha256:
        raise OakError("原稿 SHA-256 与项目记录不一致，拒绝生成或执行修复计划。")


def plan_fixes(project: Project, pack: dict) -> dict:
    """返回当前项目的完整批量修复预览；本函数严格只读。"""
    if not project.data.get("checks") or not (project.root / "reports" / "issues.json").is_file():
        raise OakError("尚未运行检查，无法生成修复计划。请先执行 check。")
    pinned = project.data.get("rulepack") or {}
    if pinned.get("name") and (
        pinned.get("name") != pack.get("pack_name")
        or pinned.get("version") != pack.get("pack_version")
    ):
        raise OakError(
            "当前规则包与本次检查固定的规则包不一致，无法生成修复计划。请先复检。"
        )
    _ensure_source_unchanged(project)
    return build_fix_plan(project, pack, load_issues(project))


def _stage_json(destination: Path, data) -> Path:
    """在目标文件同目录写好 JSON，供后续 os.replace 原子换入。"""
    fd, raw_path = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    )
    os.close(fd)
    staged = Path(raw_path)
    try:
        write_json(staged, data)
    except Exception:
        staged.unlink(missing_ok=True)
        raise
    return staged


def _valid_checkpoint_id(value: object) -> bool:
    if not isinstance(value, str) or not value.startswith("cp-"):
        return False
    digits = value[3:]
    return len(digits) >= 4 and digits.isdigit()


def _backup_prunable_checkpoints(project: Project) -> tuple[Path | None, list[tuple[Path, Path]]]:
    """备份本次新建检查点将裁剪的旧目录，供事务失败时完整恢复。

    ``Project.make_checkpoint`` 会在第六个检查点创建后立即删除最旧目录；后续
    JSON/working 提交仍可能失败。因此备份必须发生在 make_checkpoint 之前，且
    成功提交后才删除。
    """
    entries = list(project.data.get("checkpoints", []))
    prune_count = max(0, len(entries) + 1 - MAX_CHECKPOINTS)
    if prune_count == 0:
        return None, []

    checkpoint_root = project.root / "checkpoints"
    root_resolved = checkpoint_root.resolve()
    backup_root = Path(tempfile.mkdtemp(prefix=".fix-rollback-", dir=checkpoint_root))
    backups: list[tuple[Path, Path]] = []
    try:
        for entry in entries[:prune_count]:
            if not isinstance(entry, dict):
                raise OakError("检查点元数据损坏，无法建立修复事务回滚副本。")
            checkpoint_id = entry.get("checkpoint_id")
            relative = entry.get("path")
            if not _valid_checkpoint_id(checkpoint_id) or not isinstance(relative, str):
                raise OakError("检查点路径或 ID 非法，无法建立修复事务回滚副本。")
            unresolved = project.root / relative
            if unresolved.is_symlink():
                raise OakError(f"检查点目录是符号链接，拒绝继续：{checkpoint_id}")
            source = ensure_within(checkpoint_root, unresolved)
            if source.parent != root_resolved or source.name != checkpoint_id:
                raise OakError(f"检查点路径与 ID 不一致，拒绝继续：{checkpoint_id}")
            if not source.is_dir():
                raise OakError(f"待裁剪的检查点目录缺失：{checkpoint_id}")
            if any(path.is_symlink() for path in source.rglob("*")):
                raise OakError(f"检查点内含符号链接，拒绝继续：{checkpoint_id}")
            backup = backup_root / checkpoint_id
            shutil.copytree(source, backup)
            backups.append((backup, source))
    except Exception:
        shutil.rmtree(backup_root, ignore_errors=True)
        raise
    return backup_root, backups


def _restore_pruned_checkpoint_backups(backups: list[tuple[Path, Path]]) -> None:
    """把 make_checkpoint 已裁剪的目录原子移回原位。"""
    for backup, original in backups:
        if original.exists():
            continue
        if not backup.is_dir():
            raise OakError(f"检查点事务回滚副本缺失：{original.name}")
        os.replace(backup, original)


def run_fixes(
    project: Project,
    pack: dict,
    *,
    plan_id: str | None = None,
    confirmed_issue_ids: list[str] | None = None,
):
    """执行用户已集中确认的批量计划，返回 ``(fix 记录, 计数)``。

    ``plan_id`` 是强制确认凭据。调用方可额外传入计划里的全部 issue_id；
    当前 P0 不允许局部选择，因为底层白名单修复按 fix_id 扫描全文，局部选择会
    给用户造成“未选中的同类位置不会变化”的错误印象。
    """
    if not plan_id:
        raise OakError("缺少已确认的修复计划。请先执行 plan-fixes 并确认完整预览。")

    current_plan = plan_fixes(project, pack)
    if plan_id != current_plan["plan_id"]:
        raise OakError(
            "修复计划已过期或不属于当前项目。工作副本、问题状态或规则包可能已变化；"
            "请重新生成并确认计划。"
        )

    items = current_plan["items"]
    candidate_ids = [item["issue_id"] for item in items]
    candidate_set = set(candidate_ids)
    if confirmed_issue_ids is not None:
        if len(confirmed_issue_ids) != len(set(confirmed_issue_ids)):
            raise OakError("确认列表含重复 issue_id，拒绝执行。")
        confirmed_set = set(confirmed_issue_ids)
        unexpected = sorted(confirmed_set - candidate_set)
        if unexpected:
            raise OakError(f"确认列表包含非本计划候选的问题：{unexpected}")
        missing = sorted(candidate_set - confirmed_set)
        if missing:
            raise OakError(
                "当前版本只允许一次确认整批候选，确认列表遗漏："
                f"{missing}"
            )

    if not items:
        return {
            "fix_run_id": None,
            "plan_id": plan_id,
            "checkpoint_id": None,
            "applied": [],
            "counts": {},
        }, {}

    issues = load_issues(project)
    issue_by_id = {issue["issue_id"]: issue for issue in issues}
    new_issues = copy.deepcopy(issues)
    new_issue_by_id = {issue["issue_id"]: issue for issue in new_issues}
    for issue_id in candidate_ids:
        if issue_id not in issue_by_id or issue_id not in new_issue_by_id:
            raise OakError(f"修复计划候选已不存在：{issue_id}。请重新生成计划。")
        new_issue_by_id[issue_id]["status"] = "resolved"

    working_path = project.working_path
    source_hash_before = sha256_file(project.source_path)
    fd, raw_work = tempfile.mkstemp(
        prefix=f".{working_path.stem}.fix-", suffix=working_path.suffix,
        dir=working_path.parent,
    )
    os.close(fd)
    staged_work = Path(raw_work)
    staged_issues: Path | None = None
    staged_project: Path | None = None
    checkpoint: dict | None = None
    manifest_path = project.root / "project.json"
    issues_path = project.root / "reports" / "issues.json"
    data_before = copy.deepcopy(project.data)
    manifest_before = manifest_path.read_bytes()
    issues_before = issues_path.read_bytes()
    checkpoint_root = project.root / "checkpoints"
    checkpoint_names_before = {path.name for path in checkpoint_root.iterdir()}
    checkpoint_backup_root: Path | None = None
    checkpoint_backups: list[tuple[Path, Path]] = []

    try:
        # 所有可能失败的格式解析与机械修改先发生在临时副本；working 尚未变化。
        shutil.copyfile(working_path, staged_work)
        fix_ids = {item["fix_id"] for item in items}
        if not fix_ids <= WHITELIST:
            raise OakError("修复计划包含白名单之外的 fix_id，拒绝执行。")
        counts = apply_fixes(staged_work, fix_ids)
        if sum(counts.values()) == 0:
            raise OakError("计划中的候选没有产生任何机械修改，拒绝把问题误标为已解决。")

        # 消除生成临时结果期间的 TOCTOU 窗口；变化即要求用户重新确认。
        if plan_fixes(project, pack)["plan_id"] != plan_id:
            raise OakError("修复计划在执行前已过期；请重新生成并确认计划。")
        if sha256_file(project.source_path) != source_hash_before:
            raise OakError("原稿在修复期间发生变化，已中止；working 未被修改。")

        # 检查点先于 working 的唯一一次换入操作创建。
        checkpoint_backup_root, checkpoint_backups = _backup_prunable_checkpoints(project)
        checkpoint = project.make_checkpoint(reason="before_fix")
        record = {
            "fix_run_id": f"fix-{len(project.data['fixes']) + 1:04d}",
            "plan_id": plan_id,
            "applied_at": now_iso(),
            "checkpoint_id": checkpoint["checkpoint_id"],
            "applied": [
                {
                    "issue_id": item["issue_id"],
                    "rule_id": item["rule_id"],
                    "fix_id": item["fix_id"],
                }
                for item in items
            ],
            "counts": counts,
        }
        project.data["fixes"].append(record)

        # JSON 先完整落到临时文件；随后与 working 一起以 os.replace 换入。
        staged_issues = _stage_json(issues_path, new_issues)
        staged_project = _stage_json(manifest_path, project.data)
        os.replace(staged_work, working_path)
        os.replace(staged_issues, issues_path)
        os.replace(staged_project, manifest_path)
        return record, counts
    except Exception as exc:
        # 若 working 已被换入，检查点是确定的回滚来源；其余状态恢复原始字节。
        rollback_error: Exception | None = None
        try:
            if checkpoint is not None:
                cp_dir = project.root / checkpoint["path"]
                cp_work = cp_dir / project.stored_filename
                if not cp_work.is_file():
                    raise OakError("修复失败，且新建检查点的工作稿副本缺失。")
                shutil.copyfile(cp_work, working_path)
                issues_path.write_bytes(issues_before)
                manifest_path.write_bytes(manifest_before)
                project.data = data_before
                shutil.rmtree(cp_dir, ignore_errors=True)
            else:
                project.data = data_before
                if manifest_path.read_bytes() != manifest_before:
                    manifest_path.write_bytes(manifest_before)
                # 兼容 make_checkpoint 在目录换入后、返回 entry 前失败的窗口。
                for path in checkpoint_root.iterdir():
                    if path.name not in checkpoint_names_before and _valid_checkpoint_id(path.name):
                        shutil.rmtree(path, ignore_errors=True)
            _restore_pruned_checkpoint_backups(checkpoint_backups)
        except Exception as rollback_exc:  # pragma: no cover - 极端磁盘故障
            rollback_error = rollback_exc
        if rollback_error is not None:
            raise OakError(f"批量修复失败，且项目事务回滚也失败：{rollback_error}") from exc
        raise
    finally:
        for path in (staged_work, staged_issues, staged_project):
            if path is not None:
                path.unlink(missing_ok=True)
        if checkpoint_backup_root is not None:
            shutil.rmtree(checkpoint_backup_root, ignore_errors=True)


def run_external(project: Project) -> dict:
    """对 EPUB 项目运行可用的外部验证工具，把真实状态写回最近一次检查结果。

    工具缺失时保持 not_run（绝不虚报）；返回各工具的状态与说明。
    """
    from .external import discover_tools, run_ace, run_epubcheck

    if project.source_format != "epub":
        raise OakError("外部验证（EpubCheck / Ace）仅适用于 EPUB 稿件。")
    if not project.data["checks"]:
        raise OakError("请先运行检查，再运行外部验证。")

    tools = discover_tools()
    results: dict[str, dict] = {}

    if tools["epubcheck_jar"] and tools["java"]:
        results["epubcheck"] = run_epubcheck(
            project.working_path, project.root / "reports" / "epubcheck.json",
            jar=tools["epubcheck_jar"], java=tools["java"],
        )
    else:
        missing = "缺少 Java 运行时" if tools["epubcheck_jar"] else "未安装 EpubCheck"
        results["epubcheck"] = {"status": "not_run", "detail": missing}

    if tools["ace"] and tools["chrome"]:
        results["ace"] = run_ace(
            project.working_path, project.root / "reports" / "ace",
            ace=tools["ace"], chrome=tools["chrome"],
        )
    elif tools["ace"]:
        results["ace"] = {"status": "not_run", "detail": "缺少可用的 Chrome / Chromium"}
    else:
        results["ace"] = {"status": "not_run", "detail": "未安装 Ace by DAISY"}

    # 写回最近一次检查结果文件（状态 + 说明），供报告如实呈现
    last = project.data["checks"][-1]
    result_path = project.root / last["result_file"]
    result = read_json(result_path)
    result["external_tools"] = {name: r["status"] for name, r in results.items()}
    result["external_tools_detail"] = {name: r["detail"] for name, r in results.items()}
    write_json(result_path, result)
    project.save()
    return results


_WORD_BUCKETS = (
    (5_000, "5千字以内"),
    (20_000, "5千—2万字"),
    (50_000, "2万—5万字"),
    (100_000, "5万—10万字"),
)


def build_evaluation_summary(project: Project) -> dict:
    """脱敏出版评估摘要（§8.4 字段白名单）。

    默认禁止项在此物理上不存在：不含正文、标题、文件名、路径、
    参考文献原文、任何哈希。第一版仅本地生成，绝不自动发送。
    """
    if not project.data["checks"]:
        raise OakError("尚未运行检查，无法生成评估摘要。请先执行 check。")
    doc = _read_document(project)
    chars = len("".join(doc.body_text.split()))
    bucket = next((label for limit, label in _WORD_BUCKETS if chars <= limit), "10万字以上")

    issues = load_issues(project)
    counts = {
        "error": {"open": 0, "resolved": 0, "rejected": 0},
        "warning": {"open": 0, "resolved": 0, "rejected": 0},
        "suggestion": {"open": 0, "resolved": 0, "rejected": 0},
    }
    for issue in issues:
        slot = "open" if issue["status"] in ("open", "accepted") else issue["status"]
        if slot in counts[issue["severity"]]:
            counts[issue["severity"]][slot] += 1

    settings = project.data["settings"]
    return {
        "schema_version": "1.0",
        "manuscript_type": settings["manuscript_type"],
        "language": settings.get("language_detected") or settings["language"],
        "word_count_range": bucket,
        "issue_counts": counts,
        "citation_style_resolved": settings["citation_style_resolved"],
        "rulepack_version": project.data["rulepack"]["version"],
        "generated_at": now_iso(),
        "intent": "unspecified",
    }


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
        "external_tools_detail": result.get("external_tools_detail", {}),
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

    # 基础 EPUB 预览（M3，方案 §5.5）：仅当用户开启且源稿不是 EPUB
    settings = project.data["settings"]
    if settings.get("epub_preview") and project.source_format != "epub":
        from .epub_writer import build_basic_epub

        doc = _read_document(project)
        title = next(
            (p.text.strip() for p in doc.paragraphs if p.text.strip()),
            project.stored_filename,
        )
        if len(title) > 100:
            title = project.stored_filename
        lang_code = {"zh": "zh", "en": "en", "mixed": "zh"}.get(
            settings.get("language_detected") or "", "zh"
        )
        preview = ensure_within(base, target_dir / "preview.epub")
        preview.write_bytes(
            build_basic_epub(
                doc, title=title, language=lang_code,
                identifier=f"urn:oak:project-{project.data['project_id']}",
            )
        )
        written.append(preview)

    json_path = ensure_within(base, target_dir / "report.json")
    write_json(json_path, report)
    written.append(json_path)

    md_path = ensure_within(base, target_dir / "report.md")
    md_path.write_text(render_markdown(report), encoding="utf-8", newline="\n")
    written.append(md_path)

    html_path = ensure_within(base, target_dir / "report.html")
    html_path.write_text(render_html(report), encoding="utf-8", newline="\n")
    written.append(html_path)

    summary_path = ensure_within(base, target_dir / "evaluation_summary.json")
    write_json(summary_path, build_evaluation_summary(project))
    written.append(summary_path)

    project.save()
    return written
