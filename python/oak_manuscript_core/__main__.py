"""湖岸稿件命令行入口（AD-002 契约）。

- stdout：单个 UTF-8 JSON 文档（机器可读，Electron 桥直接消费）；
- stderr：人类可读提示；
- 退出码：0 成功；1 检查存在未处理的必须处理问题（或完整性有非致命问题）；
  2 运行错误 / 原稿哈希不一致。
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

from . import __version__
from . import ops
from .errors import OakError, StructuredOakError
from .project import Project
from .project_lock import ProjectWriteLock
from .rulepack import attach_rulepack_identity, load_rulepack, validate_rulepack_identity
from .rulepack_upgrade import apply_rulepack_upgrade, plan_rulepack_upgrade
from .standards_store import resolve_active_release, resolve_project_rulepack

_MUTATING_COMMANDS = {
    "create",
    "web-check",
    "check",
    "recheck",
    "fix",
    "export",
    "verify",  # verify 会更新 integrity 状态，并非纯读。
    "restore-checkpoint",
    "upgrade-rulepack",
    "external",
    "external-prepare",
    "external-finalize",
    "issue",
}
def _emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _pending_error_exists(issues: list[dict]) -> bool:
    return any(
        i["severity"] == "error" and i["status"] in ("open", "accepted") for i in issues
    )


def _cmd_create(args) -> int:
    release = resolve_active_release()
    proj = Project.create(
        Path(args.input), Path(args.project),
        manuscript_type=args.type, language=args.language,
        citation_style=args.citation, check_depth=args.depth,
        epub_preview=args.epub_preview,
        rulepack_identity=release.identity,
    )
    _emit({
        "ok": True,
        "project": str(proj.root),
        "project_id": proj.data["project_id"],
        "source_sha256": proj.source_sha256,
        "settings": proj.data["settings"],
        "rulepack": proj.data["rulepack"],
    })
    print("项目已创建，原稿只读副本与 SHA-256 已记录。", file=sys.stderr)
    return 0


def _cmd_check(args, kind: str) -> int:
    proj = Project.open(Path(args.project))
    pack = _project_rulepack(proj, args.rulepack)
    record, outcome = ops.run_check(
        proj,
        pack,
        kind=kind,
        citation_style=args.citation,
        citation_plan_id=args.citation_plan_id,
    )
    from .engine import manuscript_status_level

    _emit({
        "ok": True,
        "check_id": record["check_id"],
        "kind": kind,
        "status_level": manuscript_status_level(outcome.issues),
        "issue_counts": record["issue_counts"],
        "rulepack": copy.deepcopy(record["rulepack"]),
        "citation_note": ops._citation_note(proj.data["settings"]),
        "citation_resolution": copy.deepcopy(
            proj.data["settings"].get("citation_resolution")
        ),
        "format_coverage": copy.deepcopy(outcome.format_coverage),
        "issues": outcome.issues,
        "skipped_rule_groups": outcome.skipped_rule_groups,
    })
    return 1 if _pending_error_exists(outcome.issues) else 0


def _cmd_web_check(args) -> int:
    """在一个受控临时项目中创建并检查 Web 任务，不输出本地路径或项目身份。"""
    release = resolve_active_release()
    proj = Project.create(
        Path(args.input), Path(args.project),
        manuscript_type=args.type, language="auto",
        citation_style=args.citation, check_depth=args.depth,
        epub_preview=False,
        rulepack_identity=release.identity,
    )
    pack = _project_rulepack(proj, None)
    record, outcome = ops.run_check(
        proj,
        pack,
        kind="check",
        citation_style=args.citation,
    )
    from .engine import manuscript_status_level

    _emit({
        "ok": True,
        "check_id": record["check_id"],
        "kind": "check",
        "status_level": manuscript_status_level(outcome.issues),
        "issue_counts": record["issue_counts"],
        "rulepack": copy.deepcopy(record["rulepack"]),
        "citation_note": ops._citation_note(proj.data["settings"]),
        "citation_resolution": copy.deepcopy(
            proj.data["settings"].get("citation_resolution")
        ),
        "format_coverage": copy.deepcopy(outcome.format_coverage),
        "issues": outcome.issues,
        "skipped_rule_groups": outcome.skipped_rule_groups,
        "source_hash_ok": True,
    })
    return 1 if _pending_error_exists(outcome.issues) else 0


def _cmd_web_inspect(args) -> int:
    """只读检查 Web 上传的格式、压缩结构与主动内容风险。"""
    from .web_inspection import inspect_web_document

    _emit(inspect_web_document(Path(args.input), args.format))
    return 0


def _cmd_fix(args) -> int:
    proj = Project.open(Path(args.project))
    pack = _project_rulepack(proj, args.rulepack)
    record, counts = ops.run_fixes(
        proj,
        pack,
        plan_id=args.plan_id,
        confirmed_issue_ids=args.issue_id,
    )
    _emit({
        "ok": True,
        "plan_id": record.get("plan_id"),
        "fix_run_id": record.get("fix_run_id"),
        "checkpoint_id": record.get("checkpoint_id"),
        "applied_count": len(record["applied"]),
        "counts": counts,
    })
    if record["applied"]:
        print("修复完成。修复前的版本已保存为检查点，建议运行 recheck 复检。", file=sys.stderr)
    else:
        print("没有可自动修复的问题。", file=sys.stderr)
    return 0


def _project_rulepack(proj: Project, requested_path: str | None) -> dict:
    """按项目 pin 解析；旧 ``--rulepack`` 只能提供完全相同的 payload。"""
    release = resolve_project_rulepack(proj.data["rulepack"])
    if requested_path is None:
        return release.rulepack
    pack = load_rulepack(Path(requested_path))
    return attach_rulepack_identity(pack, release.identity)


def _cmd_plan_fixes(args) -> int:
    proj = Project.open(Path(args.project))
    pack = _project_rulepack(proj, args.rulepack)
    plan = ops.plan_fixes(proj, pack)
    _emit({"ok": True, **plan})
    print(
        f"已生成批量修复预览：{plan['candidate_count']} 项。"
        "尚未修改 working、问题状态或项目记录。",
        file=sys.stderr,
    )
    return 0


def _cmd_ai_context(args) -> int:
    proj = Project.open(Path(args.project))
    context = ops.build_ai_issue_context(proj, issue_id=args.issue_id)
    _emit({"ok": True, **context})
    print("已生成本机 AI 建议上下文；尚未联网或发送任何内容。", file=sys.stderr)
    return 0


def _cmd_plan_citation(args) -> int:
    proj = Project.open(Path(args.project))
    pack = _project_rulepack(proj, args.rulepack)
    plan = ops.plan_citation_resolution(
        proj,
        pack,
        citation_style=args.citation,
    )
    _emit({"ok": True, **plan})
    print("已生成引用体例确认预览；尚未修改项目或运行检查。", file=sys.stderr)
    return 0


def _cmd_plan_rulepack_upgrade(args) -> int:
    proj = Project.open(Path(args.project))
    plan = plan_rulepack_upgrade(proj, args.to_manifest_sha256)
    _emit({"ok": True, **plan})
    print(
        f"已生成规则包{('升级' if plan['direction'] == 'upgrade' else '回退')}计划；"
        "尚未修改项目。",
        file=sys.stderr,
    )
    return 0


def _cmd_project_standard_status(args) -> int:
    proj = Project.open(Path(args.project))
    stored = copy.deepcopy(proj.data["rulepack"])
    state = validate_rulepack_identity(
        stored,
        allow_legacy=True,
        allow_uninitialized=True,
    )
    # status 只做身份探测，不执行检查；允许解析已撤回/过期/与当前 APP
    # 不兼容的完整旧 pin，才能让用户生成迁移计划离开该版本。
    release = resolve_project_rulepack(
        stored,
        _allow_inactive_for_migration=True,
    )
    _emit(
        {
            "ok": True,
            "project": str(proj.root),
            "standard_identity": copy.deepcopy(release.identity),
            "stored_identity": stored,
            "legacy_migratable": state == "legacy",
        }
    )
    print("项目标准身份已只读解析；未修改项目。", file=sys.stderr)
    return 0


def _cmd_upgrade_rulepack(args) -> int:
    proj = Project.open(Path(args.project))
    result = apply_rulepack_upgrade(
        proj,
        args.to_manifest_sha256,
        plan_id=args.plan_id,
    )
    _emit(result)
    print(
        "项目规则包 pin 已变更；旧问题已归档，必须重新运行 check。",
        file=sys.stderr,
    )
    return 0


def _cmd_export(args) -> int:
    proj = Project.open(Path(args.project))
    pack = _project_rulepack(proj, args.rulepack)
    out_dir = Path(args.out) if args.out else None
    files = ops.export_project(proj, pack, out_dir)
    _emit({"ok": True, "files": [str(f) for f in files]})
    print(f"已导出 {len(files)} 个文件。原稿未被修改。", file=sys.stderr)
    return 0


def _cmd_verify(args) -> int:
    proj = Project.open(Path(args.project))
    problems = proj.verify()
    _emit({
        "ok": not problems,
        "problems": problems,
        "source_sha256": proj.source_sha256,
    })
    if any("SHA-256" in p for p in problems):
        return 2
    return 1 if problems else 0


def _cmd_external(args) -> int:
    proj = Project.open(Path(args.project))
    results = ops.run_external(proj)
    _emit({"ok": True, "results": results})
    return 1 if any(r["status"] == "failed" for r in results.values()) else 0


def _cmd_external_plan(args) -> int:
    proj = Project.open(Path(args.project))
    plan = ops.plan_external_validation(proj)
    _emit({"ok": True, "plan": plan})
    print("已生成外部验证计划；尚未清理输出或运行工具。", file=sys.stderr)
    return 0


def _cmd_external_prepare(args) -> int:
    proj = Project.open(Path(args.project))
    prepared = ops.prepare_external_ace(proj, args.plan_id)
    _emit({"ok": True, **prepared})
    return 0


def _cmd_external_finalize(args) -> int:
    proj = Project.open(Path(args.project))
    results = ops.finalize_external_validation(
        proj,
        args.plan_id,
        ace_exit_code=args.ace_exit_code,
    )
    _emit({"ok": True, "results": results})
    return 1 if any(item["status"] == "failed" for item in results.values()) else 0


def _cmd_issue(args) -> int:
    proj = Project.open(Path(args.project))
    issue = ops.set_issue_status(proj, args.id, args.status)
    _emit({"ok": True, "issue": issue})
    return 0


def _cmd_list_checkpoints(args) -> int:
    proj = Project.open(Path(args.project))
    _emit({"ok": True, "checkpoints": proj.list_checkpoints()})
    return 0


def _cmd_sync_source(args) -> int:
    proj = Project.open(Path(args.project))
    _project_rulepack(proj, None)
    _emit({"ok": True, **ops.build_sync_source(proj, event=args.event)})
    print("已在本机生成同步白名单来源；未发送、未入队。", file=sys.stderr)
    return 0


def _cmd_restore_checkpoint(args) -> int:
    proj = Project.open(Path(args.project))
    result = proj.restore_checkpoint(args.checkpoint_id)
    _emit({"ok": True, **result})
    print(
        f"已恢复检查点 {result['restored_checkpoint_id']}；"
        f"恢复前状态保存在 {result['safety_checkpoint_id']}。",
        file=sys.stderr,
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="oak_manuscript_core",
        description="湖岸稿件本地检查核心（M1：DOCX + 论文 + GB/T 7714—2025）",
    )
    parser.add_argument("--version", action="version", version=f"oak-manuscript-core {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("create", help="创建检查项目（复制只读原稿并记录哈希）")
    p.add_argument("--input", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--type", default="paper", choices=["paper", "print_book", "ebook"])
    p.add_argument("--language", default="auto", choices=["auto", "zh", "en", "mixed"])
    p.add_argument("--citation", default="default",
                   choices=["default", "gbt7714-2025", "apa-7",
                            "chicago-18-nb", "chicago-18-ad", "none"])
    p.add_argument("--depth", default="full", choices=["quick", "full"])
    p.add_argument("--epub-preview", action="store_true",
                   help="导出时附带基础 EPUB 预览（非 EPUB 源稿适用）")

    p = sub.add_parser("web-check", help="在隔离临时项目中创建并检查一次 Web 任务")
    p.add_argument("--input", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--type", required=True, choices=["paper", "print_book", "ebook"])
    p.add_argument("--citation", required=True,
                   choices=["default", "gbt7714-2025", "apa-7",
                            "chicago-18-nb", "chicago-18-ad", "none"])
    p.add_argument("--depth", required=True, choices=["quick", "full"])

    p = sub.add_parser("web-inspect", help="只读检查 Web 上传的结构与主动内容风险")
    p.add_argument("--input", required=True)
    p.add_argument("--format", required=True, choices=["docx", "md", "txt", "epub"])

    for name, help_text in (("check", "运行检查"), ("recheck", "复检")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--project", required=True)
        p.add_argument("--rulepack")
        p.add_argument(
            "--citation",
            choices=["default", "gbt7714-2025", "apa-7",
                     "chicago-18-nb", "chicago-18-ad", "none"],
        )
        p.add_argument("--citation-plan-id")

    p = sub.add_parser("plan-citation", help="生成引用体例解析与确认预览（严格只读）")
    p.add_argument("--project", required=True)
    p.add_argument("--rulepack")
    p.add_argument(
        "--citation",
        choices=["default", "gbt7714-2025", "apa-7",
                 "chicago-18-nb", "chicago-18-ad", "none"],
    )

    p = sub.add_parser("plan-fixes", help="生成批量机械修复集中预览（严格只读）")
    p.add_argument("--project", required=True)
    p.add_argument("--rulepack")

    p = sub.add_parser(
        "plan-rulepack-upgrade",
        help="按显式 manifest digest 生成项目规则包升级/回退计划（严格只读）",
    )
    p.add_argument("--project", required=True)
    p.add_argument("--to-manifest-sha256", required=True)

    p = sub.add_parser(
        "project-standard-status",
        help="只读解析项目已固定的标准/规则包完整身份",
    )
    p.add_argument("--project", required=True)

    p = sub.add_parser(
        "upgrade-rulepack",
        help="应用已确认的项目规则包升级/回退计划",
    )
    p.add_argument("--project", required=True)
    p.add_argument("--to-manifest-sha256", required=True)
    p.add_argument("--plan-id", required=True)

    p = sub.add_parser("fix", help="执行已集中确认的批量机械修复（自动建检查点）")
    p.add_argument("--project", required=True)
    p.add_argument("--rulepack")
    p.add_argument("--plan-id", required=True,
                   help="plan-fixes 返回、且已由用户确认的 plan_id")
    p.add_argument("--issue-id", action="append",
                   help="可选；重复传入计划中的全部 issue_id，用于显式校验确认集合")

    p = sub.add_parser("export", help="导出修订稿与三种报告")
    p.add_argument("--project", required=True)
    p.add_argument("--rulepack")
    p.add_argument("--out", help="导出目录（默认为项目 exports/）")

    p = sub.add_parser("verify", help="项目完整性验证（原稿哈希等）")
    p.add_argument("--project", required=True)

    p = sub.add_parser("list-checkpoints", help="列出可恢复的项目检查点")
    p.add_argument("--project", required=True)

    p = sub.add_parser("sync-source", help="生成结果同步白名单来源（严格只读，不发送）")
    p.add_argument("--project", required=True)
    p.add_argument("--event", required=True, choices=["check", "export"])

    p = sub.add_parser("ai-context", help="生成单条问题的 AI 发送预览来源（严格只读，不发送）")
    p.add_argument("--project", required=True)
    p.add_argument("--issue-id", required=True)

    p = sub.add_parser("restore-checkpoint", help="安全恢复检查点（恢复前自动创建安全检查点）")
    p.add_argument("--project", required=True)
    p.add_argument("--checkpoint-id", required=True)

    p = sub.add_parser("external", help="运行外部验证工具（EpubCheck / Ace，仅 EPUB）")
    p.add_argument("--project", required=True)

    p = sub.add_parser("external-plan", help="生成绑定当前状态的外部验证计划（只读）")
    p.add_argument("--project", required=True)

    p = sub.add_parser("external-prepare", help="按已绑定计划安全清空 Ace 输出目录")
    p.add_argument("--project", required=True)
    p.add_argument("--plan-id", required=True)

    p = sub.add_parser("external-finalize", help="收尾外部验证并写回真实状态")
    p.add_argument("--project", required=True)
    p.add_argument("--plan-id", required=True)
    p.add_argument("--ace-exit-code", type=int)

    p = sub.add_parser("issue", help="设置问题处理状态")
    p.add_argument("--project", required=True)
    p.add_argument("--id", required=True)
    p.add_argument("--status", required=True,
                   choices=["open", "accepted", "rejected", "resolved"])
    return parser


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass
    args = build_parser().parse_args(argv)
    handlers = {
        "create": _cmd_create,
        "web-check": _cmd_web_check,
        "web-inspect": _cmd_web_inspect,
        "check": lambda a: _cmd_check(a, "check"),
        "recheck": lambda a: _cmd_check(a, "recheck"),
        "plan-citation": _cmd_plan_citation,
        "plan-fixes": _cmd_plan_fixes,
        "plan-rulepack-upgrade": _cmd_plan_rulepack_upgrade,
        "project-standard-status": _cmd_project_standard_status,
        "upgrade-rulepack": _cmd_upgrade_rulepack,
        "fix": _cmd_fix,
        "export": _cmd_export,
        "verify": _cmd_verify,
        "list-checkpoints": _cmd_list_checkpoints,
        "sync-source": _cmd_sync_source,
        "ai-context": _cmd_ai_context,
        "restore-checkpoint": _cmd_restore_checkpoint,
        "external": _cmd_external,
        "external-plan": _cmd_external_plan,
        "external-prepare": _cmd_external_prepare,
        "external-finalize": _cmd_external_finalize,
        "issue": _cmd_issue,
    }
    try:
        if args.command in _MUTATING_COMMANDS:
            if args.command in {"create", "web-check"}:
                Project.preflight_create(Path(args.input), Path(args.project))
            else:
                # 锁前只读门禁：任意普通目录或受污染项目不得因此创建/覆盖锁文件。
                # 锁内 handler 仍会再次 Project.open，封闭门禁后的竞态窗口。
                Project.open(Path(args.project))
            with ProjectWriteLock(
                Path(args.project),
                command=args.command,
                create_root=args.command in {"create", "web-check"},
                cleanup_on_error=args.command in {"create", "web-check"},
            ):
                return handlers[args.command](args)
        return handlers[args.command](args)
    except StructuredOakError as exc:
        _emit(exc.as_payload())
        print(f"错误：{exc.message}", file=sys.stderr)
        return 2
    except OakError as exc:
        print(f"错误：{exc.message}", file=sys.stderr)
        return 2
    except Exception as exc:  # 兜底：绝不吞错误，也绝不假装成功
        print(f"意外错误（{type(exc).__name__}）：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
