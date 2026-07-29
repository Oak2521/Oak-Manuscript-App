"""服务层编排：check / fix / recheck / export 的完整闭环。

CLI（__main__）与未来的 Electron 桥都只调用本层，不直接碰引擎与文件细节。
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
from pathlib import Path

from . import __version__
from .citation import REQUESTED_STYLES, resolve_citation, validate_citation_resolution
from .engine import (
    check_document,
    citation_rule_ids_for_resolution,
    manuscript_status_level,
)
from .errors import OakError, ProjectValidationError, StructuredOakError
from .fix_plans import build_fix_plan
from .fixes import WHITELIST, apply_fixes
from .project import MAX_CHECKPOINTS, Project
from .readers.docx_reader import read_docx
from .rulepack import (
    LoadedRulepack,
    attach_rulepack_identity,
    rulepack_identity,
    validate_rulepack_identity,
)
from .safety import ensure_within, is_link_or_reparse
from .util import now_iso, read_json, sha256_file, write_json

DISCLAIMER = (
    "本报告仅代表稿件的技术与规范准备程度，不评价学术质量、文学价值或出版可行性，"
    "不构成任何出版承诺。全部检查在本机完成，稿件未被上传。"
)

_STATUS_VALUES = {"open", "accepted", "rejected", "resolved"}
_CITATION_PLAN_ID_RE = re.compile(r"^citation-plan-[0-9a-f]{64}$")
_EXTERNAL_PLAN_ID_RE = re.compile(r"^external-plan-[0-9a-f]{64}$")


def _bind_or_assert_rulepack(project: Project, pack: dict) -> dict:
    """补齐旧项目 pin，或证明本次 pack 与完整 pin 逐字段一致。

    仅旧 Python API 创建的尚未检查项目允许从空 pin 绑定；正式 CLI 会在
    ``create`` 时由 standards store 固定 active release。已有完整 pin 永不因
    check/recheck/export 等普通操作被覆盖。
    """
    identity = rulepack_identity(pack)
    current = project.data.get("rulepack")
    try:
        state = validate_rulepack_identity(
            current,
            allow_legacy=True,
            allow_uninitialized=True,
        )
    except OakError as exc:
        raise OakError(f"项目规则包 pin 无效：{exc.message}") from exc

    if state == "uninitialized":
        project.data["rulepack"] = copy.deepcopy(identity)
        return identity
    if state == "legacy":
        if current["name"] != identity["name"] or current["version"] != identity["version"]:
            raise OakError(
                "旧项目固定的规则包名称/版本与本次规则包不一致；"
                "拒绝猜测或改用默认最新版。"
            )
        project.data["rulepack"] = copy.deepcopy(identity)
        return identity

    mismatches = [
        field
        for field in identity
        if current.get(field) != identity[field]
    ]
    if mismatches and isinstance(pack, LoadedRulepack) and pack._oak_identity is None:
        # 兼容旧 Python 调用方直接传入 load_rulepack() 的结果。它有可信原始
        # 文件摘要，但还没有 release 身份。这里不能仅凭相同版本号放行：先按
        # 项目完整 pin 重新验证本地 release，再让 attach 核对原始字节 SHA。
        from .standards_store import resolve_project_rulepack

        try:
            release = resolve_project_rulepack(current)
            attach_rulepack_identity(pack, release.identity)
            identity = rulepack_identity(pack)
        except OakError:
            pass
        mismatches = [
            field
            for field in identity
            if current.get(field) != identity[field]
        ]
    if mismatches:
        raise OakError(
            "本次规则包与项目完整 pin 不一致，拒绝静默替换："
            + "、".join(mismatches)
        )
    return identity


def _safe_export_directory(path: Path, *, create: bool) -> Path:
    """逐级拒绝链接/联接并（可选）创建用户指定导出目录。"""
    lexical = Path(path).absolute()
    chain = list(reversed((lexical, *lexical.parents)))
    for candidate in chain:
        exists = os.path.lexists(candidate)
        if not exists:
            if not create:
                raise ProjectValidationError(f"导出目录在写入前消失：{candidate}")
            try:
                candidate.mkdir(exist_ok=False)
            except OSError as exc:
                raise ProjectValidationError(f"无法安全创建导出目录：{candidate}") from exc
        try:
            info = os.lstat(candidate)
        except OSError as exc:
            raise ProjectValidationError(f"无法安全读取导出目录父链：{candidate}") from exc
        if is_link_or_reparse(candidate) or not stat.S_ISDIR(info.st_mode):
            raise ProjectValidationError(
                f"导出目录父链含链接、目录联接或非常规目录：{candidate}"
            )
    try:
        return lexical.resolve(strict=True)
    except OSError as exc:
        raise ProjectValidationError(f"导出目录无法安全解析：{lexical}") from exc


def _safe_export_destination(directory: Path, filename: str) -> Path:
    if (
        not isinstance(filename, str)
        or not filename
        or filename in {".", ".."}
        or "/" in filename
        or "\\" in filename
        or "\x00" in filename
    ):
        raise ProjectValidationError("导出文件名非法。")
    safe_dir = _safe_export_directory(directory, create=False)
    candidate = safe_dir / filename
    if os.path.lexists(candidate):
        try:
            info = os.lstat(candidate)
        except OSError as exc:
            raise ProjectValidationError(f"无法安全读取已有导出目标：{filename}") from exc
        if (
            is_link_or_reparse(candidate)
            or not stat.S_ISREG(info.st_mode)
            or getattr(info, "st_nlink", 1) != 1
        ):
            raise ProjectValidationError(
                f"导出目标 {filename} 是链接、硬链接或非常规文件，拒绝覆盖。"
            )
        resolved = candidate.resolve(strict=True)
        if resolved.parent != safe_dir or resolved.name != filename:
            raise ProjectValidationError(f"导出目标越出指定目录：{filename}")
    return candidate


def _atomic_export_bytes(directory: Path, filename: str, payload: bytes) -> Path:
    """同目录完整暂存并原子换入；换入前再次验证父链和既有目标。"""
    destination = _safe_export_destination(directory, filename)
    fd, raw_stage = tempfile.mkstemp(prefix=f".{filename}.", suffix=".tmp", dir=directory)
    stage = Path(raw_stage)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        destination = _safe_export_destination(directory, filename)
        os.replace(stage, destination)
        return destination
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        raise
    finally:
        stage.unlink(missing_ok=True)


def _atomic_export_copy(directory: Path, filename: str, source: Path) -> Path:
    destination = _safe_export_destination(directory, filename)
    fd, raw_stage = tempfile.mkstemp(prefix=f".{filename}.", suffix=".tmp", dir=directory)
    stage = Path(raw_stage)
    try:
        with open(source, "rb") as source_stream, os.fdopen(fd, "wb") as target_stream:
            shutil.copyfileobj(source_stream, target_stream)
            target_stream.flush()
            os.fsync(target_stream.fileno())
        destination = _safe_export_destination(directory, filename)
        os.replace(stage, destination)
        return destination
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        raise
    finally:
        stage.unlink(missing_ok=True)


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


def _read_stable_document(project: Project):
    """读取一份可证明在解析期间未变化的工作稿。"""
    before = sha256_file(project.working_path)
    document = _read_document(project)
    after = sha256_file(project.working_path)
    if after != before:
        raise OakError("工作稿在引用体例解析期间发生变化；请重新生成确认预览。")
    return document, after


def _citation_settings(project: Project, citation_style: str | None) -> dict:
    settings = copy.deepcopy(project.data["settings"])
    if citation_style is not None:
        if citation_style not in REQUESTED_STYLES:
            raise OakError(f"不支持的引用体例请求：{citation_style}")
        settings["citation_style"] = citation_style
    return settings


def _build_citation_plan(
    project: Project,
    pack: dict,
    *,
    identity: dict,
    document,
    working_sha256: str,
    settings: dict,
) -> dict:
    resolution = resolve_citation(
        document,
        settings,
        pack,
        doc_format=project.source_format,
    )
    resolution["coverage"]["rule_ids"] = citation_rule_ids_for_resolution(
        pack,
        settings,
        resolution,
        doc_format=project.source_format,
    )
    validate_citation_resolution(resolution)
    binding = {
        "schema_version": "1.0",
        "project_id": project.data["project_id"],
        "working_sha256": working_sha256,
        "rulepack": copy.deepcopy(identity),
        "settings": {
            "manuscript_type": settings["manuscript_type"],
            "language": settings["language"],
            "citation_style": settings["citation_style"],
        },
        "resolution": resolution,
    }
    encoded = json.dumps(
        binding,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return {
        "schema_version": "1.0",
        "kind": "citation-resolution-plan",
        "plan_id": f"citation-plan-{hashlib.sha256(encoded).hexdigest()}",
        "requested_style": settings["citation_style"],
        "resolution": resolution,
    }


def plan_citation_resolution(
    project: Project,
    pack: dict,
    *,
    citation_style: str | None = None,
) -> dict:
    """生成绑定工作稿、设置和完整规则包身份的只读引用体例计划。"""
    # ``_bind_or_assert_rulepack`` 要兼容极早期的空/两字段 pin，因而可能补齐
    # 传入对象。计划接口在影子项目上完成该兼容，确保真实项目内存与磁盘均不变。
    shadow = Project(project.root, copy.deepcopy(project.data))
    identity = _bind_or_assert_rulepack(shadow, pack)
    settings = _citation_settings(project, citation_style)
    document, working_sha256 = _read_stable_document(project)
    return _build_citation_plan(
        project,
        pack,
        identity=identity,
        document=document,
        working_sha256=working_sha256,
        settings=settings,
    )


def _issue_key(issue: dict) -> tuple:
    # 不含段落号：修复（如删除空段）会使后续段落序号整体前移，
    # 预览文本 + 规则 + 部位 + 注号足以稳定定位同一问题。
    loc = issue["location"]
    return (issue["rule_id"], loc["part"], loc["note_id"], issue["preview"])


def load_issues(project: Project) -> list[dict]:
    path = project.issues_path(required=False)
    if not path.is_file():
        return []
    return read_json(path)


def save_issues(project: Project, issues: list[dict]) -> None:
    write_json(project.issues_path(required=False), issues)


def _ai_location_label(location: dict) -> str:
    """Return a useful location without exposing an EPUB internal resource path."""
    if location.get("resource"):
        return "电子书内容资源（内部路径未发送）"
    if location.get("part") == "footnotes" and location.get("note_id") is not None:
        return f"脚注 {location['note_id']}"
    if location.get("paragraph") is not None:
        return f"正文第 {location['paragraph']} 段"
    return "文档"


def build_ai_issue_context(project: Project, *, issue_id: str) -> dict:
    """Build the exact, minimal issue context that may enter an AI request preview.

    ``binding`` is local-only freshness evidence. Electron must never place it in the
    model request. ``request_content`` is the complete manuscript-derived disclosure.
    This function is strictly read-only.
    """
    if not isinstance(issue_id, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", issue_id
    ):
        raise OakError("AI 建议问题 ID 非法。")
    if project.data.get("rulepack_check_required", False):
        raise OakError("规则包已变更，必须先重新运行 check 才能请求 AI 建议。")
    checks = project.data.get("checks", [])
    if not checks:
        raise OakError("尚未运行检查，无法生成 AI 建议上下文。")
    _require_current_check_identity(project)
    _ensure_source_unchanged(project)
    issue = next((item for item in load_issues(project) if item["issue_id"] == issue_id), None)
    if issue is None:
        raise OakError(f"找不到问题：{issue_id}")
    return {
        "schema_version": "1.0",
        "context_type": "oak_manuscript_issue_suggestion",
        "binding": {
            "issue_id": issue["issue_id"],
            "check_id": checks[-1]["check_id"],
            "working_sha256": sha256_file(project.working_path),
            "rulepack_manifest_sha256": project.data["rulepack"]["manifest_sha256"],
        },
        "request_content": {
            "rule_id": issue["rule_id"],
            "severity": issue["severity"],
            "title": issue["title"],
            "explanation": issue["explanation"],
            "location": _ai_location_label(issue["location"]),
            "preview": issue["preview"],
            "standard_refs": list(issue["standard_refs"]),
            "status": issue["status"],
        },
    }


def _require_current_check_identity(project: Project) -> None:
    checks = project.data.get("checks", [])
    if not checks:
        return
    if checks[-1].get("rulepack") != project.data.get("rulepack"):
        raise OakError("最近一次检查不属于项目当前规则包；必须先重新运行 check。")


def set_issue_status(project: Project, issue_id: str, status: str) -> dict:
    if project.data.get("rulepack_check_required", False):
        raise OakError("规则包已变更，旧问题状态不可继续使用；请先重新运行 check。")
    _require_current_check_identity(project)
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
    resolution = settings.get("citation_resolution")
    if resolution is None:
        # alpha.4 及更早项目/报告的可复现说明。
        style = settings["citation_style_resolved"]
        if settings["citation_resolved_by"] == "default_mapping":
            origin = f"（由默认规则 v{settings['citation_mapping_version']} 按稿件类型与语言选定）"
        else:
            origin = "（由用户指定）"
        if style == "none":
            return f"本次未检查引用格式{origin}"
        return f"本次按 {style} 体例检查{origin}"

    validate_citation_resolution(resolution)
    mode = resolution["mode"]
    resolver_version = resolution["resolver"]["version"]
    confidence = resolution["confidence"] or "不适用"
    audit = f"解析器 v{resolver_version}；置信度：{confidence}；{resolution['reason']}"
    if mode == "structure_only":
        return f"未可靠确定具体体例，本次仅执行引用结构与一致性检查（{audit}）"
    if mode == "disabled":
        return f"本次未运行引用格式检查（{audit}）"
    return f"本次按 {resolution['resolved_style']} 体例检查（{audit}）"


def run_check(
    project: Project,
    pack: dict,
    *,
    kind: str = "check",
    citation_style: str | None = None,
    citation_plan_id: str | None = None,
):
    """执行检查（或复检），持久化结果。返回 (check 记录, CheckOutcome)。"""
    identity = _bind_or_assert_rulepack(project, pack)
    if citation_plan_id is not None and (
        not isinstance(citation_plan_id, str)
        or not _CITATION_PLAN_ID_RE.fullmatch(citation_plan_id)
    ):
        raise OakError("引用体例确认计划 ID 非法；请重新生成确认预览。")
    settings_for_check = _citation_settings(project, citation_style)
    doc, working_sha256 = _read_stable_document(project)
    current_plan = _build_citation_plan(
        project,
        pack,
        identity=identity,
        document=doc,
        working_sha256=working_sha256,
        settings=settings_for_check,
    )
    if citation_plan_id is not None and current_plan["plan_id"] != citation_plan_id:
        raise StructuredOakError(
            "引用体例确认预览已过期：工作稿、项目设置或标准版本已变化。请重新预览并确认。",
            code="CITATION_PLAN_STALE",
            retryable=True,
        )

    next_check_seq = project.data.get("check_seq", 0) + 1
    check_id = f"check-{next_check_seq:04d}"
    started = now_iso()
    outcome = check_document(
        doc, settings_for_check, pack,
        doc_format=project.source_format, check_id=check_id,
    )
    if outcome.resolved.get("citation_resolution") != current_plan["resolution"]:
        raise OakError("引用体例解析结果与已确认计划不一致；未保存本次检查。")
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

    # 只有检查成功且与确认计划一致，才持久化用户覆盖与解析结果。
    project.data["check_seq"] = next_check_seq
    settings = project.data["settings"]
    if citation_style is not None:
        settings["citation_style"] = citation_style
    settings.update(outcome.resolved)
    project.data["rulepack_check_required"] = False
    counts = {"error": 0, "warning": 0, "suggestion": 0}
    for issue in outcome.issues:
        counts[issue["severity"]] += 1

    record = {
        "check_id": check_id,
        "kind": kind,
        "started_at": started,
        "finished_at": finished,
        "rulepack_version": pack["pack_version"],
        "rulepack": copy.deepcopy(identity),
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
        "rulepack": copy.deepcopy(identity),
        "settings_snapshot": copy.deepcopy(settings),
        "citation_resolution": copy.deepcopy(settings["citation_resolution"]),
        "citation_note": _citation_note(settings),
        "issues": outcome.issues,
        "skipped_rule_groups": outcome.skipped_rule_groups,
        "external_tools": {"epubcheck": "not_run", "ace": "not_run"},
        "disclaimer": DISCLAIMER,
    }
    write_json(project.report_path(record["result_file"], required=False), result_doc)
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
    _bind_or_assert_rulepack(project, pack)
    if project.data.get("rulepack_check_required", False):
        raise OakError("规则包已变更，必须先重新运行 check 才能生成修复计划。")
    if not project.data.get("checks") or not project.issues_path(required=False).is_file():
        raise OakError("尚未运行检查，无法生成修复计划。请先执行 check。")
    _require_current_check_identity(project)
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

    checkpoint_root = project.safe_subdir("checkpoints")
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
            if relative.replace("\\", "/") != f"checkpoints/{checkpoint_id}":
                raise OakError("检查点路径与 ID 不一致，无法建立修复事务回滚副本。")
            unresolved = checkpoint_root / checkpoint_id
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

    try:
        current_plan = plan_fixes(project, pack)
    except OakError as exc:
        raise OakError(
            "修复计划已过期或规则包身份不再匹配；请重新生成并确认计划。"
        ) from exc
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
    manifest_path = project.manifest_path(required=True)
    issues_path = project.issues_path(required=True)
    data_before = copy.deepcopy(project.data)
    manifest_before = manifest_path.read_bytes()
    issues_before = issues_path.read_bytes()
    checkpoint_root = project.safe_subdir("checkpoints")
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
        os.replace(staged_work, project.working_path)
        os.replace(staged_issues, project.issues_path(required=True))
        os.replace(staged_project, project.manifest_path(required=True))
        return record, counts
    except Exception as exc:
        # 若 working 已被换入，检查点是确定的回滚来源；其余状态恢复原始字节。
        rollback_error: Exception | None = None
        try:
            if checkpoint is not None:
                cp_dir = project._checkpoint_dir(checkpoint)
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


def _external_context(project: Project) -> tuple[dict, Path, dict]:
    if project.data.get("rulepack_check_required", False):
        raise OakError("规则包已变更，必须先重新运行 check 才能运行外部验证。")
    _require_current_check_identity(project)
    if project.source_format != "epub":
        raise OakError("外部验证（EpubCheck / Ace）仅适用于 EPUB 稿件。")
    if not project.data["checks"]:
        raise OakError("请先运行检查，再运行外部验证。")
    last = project.data["checks"][-1]
    result_path = project.report_path(last["result_file"], required=True)
    result = read_json(result_path)
    if result.get("rulepack") != project.data.get("rulepack"):
        raise OakError("最近一次检查结果文件不属于项目当前规则包；必须先重新运行 check。")
    return last, result_path, result


def _external_file_identity(value: object, *, digest: bool = False) -> dict | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        requested = Path(value)
        if not requested.is_absolute():
            return None
        lexical = Path(os.path.abspath(requested))
        info = requested.lstat()
        resolved = requested.resolve(strict=True)
        if (
            requested.is_symlink()
            or not requested.is_file()
            or info.st_nlink != 1
            or os.path.normcase(str(resolved)) != os.path.normcase(str(lexical))
        ):
            return None
        identity = {
            "path": str(resolved),
            "device": int(info.st_dev),
            "inode": int(info.st_ino),
            "size": int(info.st_size),
            "mtime_ns": int(info.st_mtime_ns),
        }
        if digest:
            identity["sha256"] = sha256_file(resolved)
        return identity
    except (OSError, TypeError, ValueError):
        return None


def plan_external_validation(project: Project, *, tools: dict | None = None) -> dict:
    """生成绑定当前项目、检查结果与工具身份的只读外部验证计划。"""
    from .external import discover_tools

    last, result_path, _result = _external_context(project)
    discovered = discover_tools() if tools is None else copy.deepcopy(tools)
    identities = {
        "java": _external_file_identity(discovered.get("java")),
        "epubcheck_jar": _external_file_identity(
            discovered.get("epubcheck_jar"), digest=True
        ),
        "ace_entry": _external_file_identity(discovered.get("ace_entry"), digest=True),
        "chrome": _external_file_identity(discovered.get("chrome")),
    }
    payload = {
        "schema_version": "1.0",
        "project_id": project.data.get("project_id"),
        "check_id": last.get("check_id"),
        "working_sha256": sha256_file(project.working_path),
        "result_sha256": sha256_file(result_path),
        "rulepack": copy.deepcopy(project.data.get("rulepack")),
        "tools": identities,
    }
    canonical = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    plan_id = f"external-plan-{hashlib.sha256(canonical).hexdigest()}"
    ace_request = None
    if identities["ace_entry"] is not None and identities["chrome"] is not None:
        ace_request = {
            "entry": identities["ace_entry"]["path"],
            "chrome": identities["chrome"]["path"],
            "epub": str(project.working_path),
            "out_dir": str(project.safe_report_directory("ace")),
        }
    return {
        "schema_version": "1.0",
        "plan_id": plan_id,
        "ace_request": ace_request,
    }


def _require_external_plan(
    project: Project,
    plan_id: str,
    *,
    tools: dict | None = None,
) -> dict:
    if not isinstance(plan_id, str) or not _EXTERNAL_PLAN_ID_RE.fullmatch(plan_id):
        raise OakError("外部验证计划 ID 非法。")
    current = plan_external_validation(project, tools=tools)
    if current["plan_id"] != plan_id:
        raise OakError("外部验证计划已失效；项目、检查结果或工具身份发生变化。")
    return current


def prepare_external_ace(
    project: Project,
    plan_id: str,
    *,
    tools: dict | None = None,
) -> dict:
    """在锁内复核计划并清空 Ace 输出，杜绝旧报告冒充本次结果。"""
    from .external import prepare_ace_output

    plan = _require_external_plan(project, plan_id, tools=tools)
    request = plan["ace_request"]
    if request is None:
        return {"plan_id": plan_id, "prepared": False, "out_dir": None}
    clean = prepare_ace_output(Path(request["out_dir"]))
    return {"plan_id": plan_id, "prepared": True, "out_dir": str(clean)}


def _write_external_results(
    project: Project,
    result_path: Path,
    result: dict,
    results: dict[str, dict],
) -> dict:
    result["external_tools"] = {name: item["status"] for name, item in results.items()}
    result["external_tools_detail"] = {
        name: item["detail"] for name, item in results.items()
    }
    write_json(result_path, result)
    project.save()
    return results


def finalize_external_validation(
    project: Project,
    plan_id: str,
    *,
    ace_exit_code: int | None = None,
    tools: dict | None = None,
) -> dict:
    """复核原计划、运行 EpubCheck，并只接受主进程掌握的 Ace 退出码。"""
    from .external import discover_tools, evaluate_ace_report, run_epubcheck

    plan = _require_external_plan(project, plan_id, tools=tools)
    _last, result_path, result = _external_context(project)
    discovered = discover_tools() if tools is None else copy.deepcopy(tools)
    results: dict[str, dict] = {}

    if discovered.get("epubcheck_jar") and discovered.get("java"):
        results["epubcheck"] = run_epubcheck(
            project.working_path,
            project.report_path("reports/epubcheck.json", required=False),
            jar=discovered["epubcheck_jar"],
            java=discovered["java"],
        )
    else:
        missing = (
            "缺少 Java 运行时"
            if discovered.get("epubcheck_jar")
            else "未安装 EpubCheck"
        )
        results["epubcheck"] = {"status": "not_run", "detail": missing}

    request = plan["ace_request"]
    if request is None:
        detail = (
            "缺少可用的 Chrome / Chromium"
            if discovered.get("ace_entry")
            else "未安装 Ace by DAISY"
        )
        results["ace"] = {"status": "not_run", "detail": detail}
    elif ace_exit_code is None:
        results["ace"] = {
            "status": "not_run",
            "detail": "Ace 未完成：受控 Electron helper 未返回合法退出码",
        }
    elif (
        not isinstance(ace_exit_code, int)
        or isinstance(ace_exit_code, bool)
        or not 0 <= ace_exit_code <= 255
    ):
        raise OakError("Ace helper 退出码非法。")
    else:
        results["ace"] = evaluate_ace_report(
            Path(request["out_dir"]), ace_exit_code
        )
    return _write_external_results(project, result_path, result, results)


def run_external(project: Project) -> dict:
    """源码/CLI 直跑外部工具；打包 GUI 使用受控两阶段 helper。"""
    from .external import discover_tools, run_ace, run_epubcheck

    _last, result_path, result = _external_context(project)

    tools = discover_tools()
    results: dict[str, dict] = {}

    if tools["epubcheck_jar"] and tools["java"]:
        results["epubcheck"] = run_epubcheck(
            project.working_path, project.report_path("reports/epubcheck.json", required=False),
            jar=tools["epubcheck_jar"], java=tools["java"],
        )
    else:
        missing = "缺少 Java 运行时" if tools["epubcheck_jar"] else "未安装 EpubCheck"
        results["epubcheck"] = {"status": "not_run", "detail": missing}

    if tools["ace"] and tools["chrome"]:
        results["ace"] = run_ace(
            project.working_path, project.safe_report_directory("ace"),
            ace=tools["ace"], chrome=tools["chrome"],
        )
    elif tools["ace"]:
        results["ace"] = {"status": "not_run", "detail": "缺少可用的 Chrome / Chromium"}
    else:
        results["ace"] = {"status": "not_run", "detail": "未安装 Ace by DAISY"}

    return _write_external_results(project, result_path, result, results)


_WORD_BUCKETS = (
    (5_000, "5千字以内"),
    (20_000, "5千—2万字"),
    (50_000, "2万—5万字"),
    (100_000, "5万—10万字"),
)


def _sync_dimension(rule_id: str) -> str:
    """把规则稳定归入不含内容的同步维度；只依赖规则 ID。"""
    if rule_id.startswith(("REF-", "NOTE-")):
        return "citation"
    if "PUNCT" in rule_id:
        return "punctuation"
    if "SPACE" in rule_id:
        return "typography"
    if rule_id.startswith("EPUB-"):
        return "epub"
    if rule_id.startswith("BOOK-PAGE-"):
        return "layout"
    return "structure"


def build_sync_source(project: Project, *, event: str) -> dict:
    """生成 Electron 主进程构造 SyncRecord v1 所需的可信脱敏来源。

    这里故意不返回标题、解释、位置、预览、文件名、路径或任何哈希。
    Renderer 永远拿不到本对象；主进程会再次按 SyncRecord v1 精确 schema
    过滤并验证，然后才可展示给已登录用户确认。
    """
    if event not in {"check", "export"}:
        raise OakError("同步事件必须是 check 或 export。")
    if project.data.get("rulepack_check_required", False):
        raise OakError("规则包已变更，必须先重新运行 check 才能生成同步预览。")
    if not project.data.get("checks"):
        raise OakError("尚未运行检查，无法生成同步预览。")
    _require_current_check_identity(project)

    last = project.data["checks"][-1]
    result = read_json(project.report_path(last["result_file"], required=True))
    if result.get("rulepack") != project.data.get("rulepack"):
        raise OakError("最近一次检查结果不属于项目当前规则包。")
    citation = result.get("citation_resolution")
    validate_citation_resolution(citation)

    doc = _read_document(project)
    chars = len("".join(doc.body_text.split()))
    length_bucket = next(
        (label for limit, label in _WORD_BUCKETS if chars <= limit),
        "10万字以上",
    )
    language = project.data["settings"].get("language_detected")
    if language not in {"zh", "en", "mixed"}:
        configured = project.data["settings"].get("language")
        language = configured if configured in {"zh", "en", "mixed"} else "undetermined"

    issues = [
        {
            "rule_id": issue["rule_id"],
            "severity": issue["severity"],
            "dimension": _sync_dimension(issue["rule_id"]),
            "status": issue["status"],
            "fixable": issue.get("auto_fixable") is True,
        }
        for issue in load_issues(project)
    ]
    if project.source_format == "epub":
        external = result.get("external_tools", {})
        external_validation = {
            "epubcheck": external.get("epubcheck", "not_run"),
            "ace": external.get("ace", "not_run"),
        }
    else:
        external_validation = {"epubcheck": "not_applicable", "ace": "not_applicable"}

    return {
        "projectId": project.data["project_id"],
        "runId": last["check_id"],
        "event": event,
        "format": project.source_format,
        "manuscriptType": project.data["settings"]["manuscript_type"],
        "checkConfig": project.data["settings"]["check_depth"],
        "languageBucket": language,
        "lengthBucket": length_bucket,
        "citation": {
            "requestedStyle": citation["requested_style"],
            "resolvedStyle": citation["resolved_style"],
            "mode": citation["mode"],
            "confidence": citation["confidence"],
            "reasonCode": citation["reason_code"],
            "resolverVersion": citation["resolver"]["version"],
        },
        "rulepackVersion": project.data["rulepack"]["version"],
        "appVersion": __version__,
        "createdAt": last["finished_at"],
        "authorizedAt": None,
        "issues": issues,
        "externalValidation": external_validation,
        "exportState": "completed" if event == "export" else "not_exported",
    }


def build_evaluation_summary(project: Project) -> dict:
    """脱敏出版评估摘要（§8.4 字段白名单）。

    默认禁止项在此物理上不存在：不含正文、标题、文件名、路径、
    参考文献原文、任何哈希。第一版仅本地生成，绝不自动发送。
    """
    if project.data.get("rulepack_check_required", False):
        raise OakError("规则包已变更，必须先重新运行 check 才能生成评估摘要。")
    if not project.data["checks"]:
        raise OakError("尚未运行检查，无法生成评估摘要。请先执行 check。")
    _require_current_check_identity(project)
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
    citation_resolution = settings.get("citation_resolution")
    citation_summary = None
    if citation_resolution is not None:
        validate_citation_resolution(citation_resolution)
        citation_summary = {
            "requested_style": citation_resolution["requested_style"],
            "resolved_style": citation_resolution["resolved_style"],
            "mode": citation_resolution["mode"],
            "confidence": citation_resolution["confidence"],
            "reason_code": citation_resolution["reason_code"],
            "resolver_version": citation_resolution["resolver"]["version"],
        }
    return {
        "schema_version": "1.0",
        "manuscript_type": settings["manuscript_type"],
        "language": settings.get("language_detected") or settings["language"],
        "word_count_range": bucket,
        "issue_counts": counts,
        "citation_style_resolved": settings["citation_style_resolved"],
        "citation_resolution": citation_summary,
        "rulepack_version": project.data["rulepack"]["version"],
        "generated_at": now_iso(),
        "intent": "unspecified",
    }


def build_report_data(project: Project, pack: dict) -> dict:
    identity = _bind_or_assert_rulepack(project, pack)
    if project.data.get("rulepack_check_required", False):
        raise OakError("规则包已变更，必须先重新运行 check 才能导出报告。")
    if not project.data["checks"]:
        raise OakError("尚未运行检查，无法生成报告。请先执行 check。")
    _require_current_check_identity(project)
    last = project.data["checks"][-1]
    result = read_json(project.report_path(last["result_file"], required=True))
    if result.get("rulepack") != identity:
        raise OakError("最近一次检查结果文件不属于项目当前规则包；必须先重新运行 check。")
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
    result_resolution = result.get("citation_resolution")
    settings_resolution = project.data["settings"].get("citation_resolution")
    if result_resolution is not None:
        validate_citation_resolution(result_resolution)
        if result_resolution != settings_resolution:
            raise OakError(
                "鎸囧畾鎶ュ憡妫€鏌ョ偣涓婁紶鐨勮繕鐞?缁撴灉涓嶄繚鐣欓紱璇烽噸鏂扮敓鎴?淇璁″垝銆?"
            )

    return {
        "generated_at": now_iso(),
        "app_version": __version__,
        "file": project.stored_filename,
        "manuscript_type": project.data["settings"]["manuscript_type"],
        "check": last,
        "rulepack": copy.deepcopy(identity),
        "citation_note": result["citation_note"],
        "citation_resolution": copy.deepcopy(result_resolution),
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
    if out_dir is None:
        target_dir = project.safe_subdir("exports")
    else:
        target_dir = _safe_export_directory(Path(out_dir), create=True)
        # 项目内部的自选目录只能位于 exports/，绝不把导出写进 source/working 等。
        try:
            target_dir.relative_to(project.root)
        except ValueError:
            pass
        else:
            exports_root = project.safe_subdir("exports")
            try:
                target_dir.relative_to(exports_root)
            except ValueError as exc:
                raise ProjectValidationError(
                    "项目内部的自选导出目录必须位于 exports/ 下。"
                ) from exc

    written: list[Path] = []

    revised_name = f"revised_{project.stored_filename}"
    expected_names = [
        revised_name,
        "report.json",
        "report.md",
        "report.html",
        "evaluation_summary.json",
    ]
    settings = project.data["settings"]
    include_preview = settings.get("epub_preview") and project.source_format != "epub"
    if include_preview:
        expected_names.append("preview.epub")
    # 先验证全部目标；任一链接/硬链接都在第一个导出字节写入前拒绝。
    for filename in expected_names:
        _safe_export_destination(target_dir, filename)

    revised = _atomic_export_copy(target_dir, revised_name, project.working_path)
    written.append(revised)

    # 基础 EPUB 预览（M3，方案 §5.5）：仅当用户开启且源稿不是 EPUB
    if include_preview:
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
        preview = _atomic_export_bytes(
            target_dir,
            "preview.epub",
            build_basic_epub(
                doc, title=title, language=lang_code,
                identifier=f"urn:oak:project-{project.data['project_id']}",
            ),
        )
        written.append(preview)

    json_path = _atomic_export_bytes(
        target_dir,
        "report.json",
        (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
    written.append(json_path)

    md_path = _atomic_export_bytes(
        target_dir,
        "report.md",
        render_markdown(report).encode("utf-8"),
    )
    written.append(md_path)

    html_path = _atomic_export_bytes(
        target_dir,
        "report.html",
        render_html(report).encode("utf-8"),
    )
    written.append(html_path)

    summary = build_evaluation_summary(project)
    summary_path = _atomic_export_bytes(
        target_dir,
        "evaluation_summary.json",
        (json.dumps(summary, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
    written.append(summary_path)

    project.save()
    return written
