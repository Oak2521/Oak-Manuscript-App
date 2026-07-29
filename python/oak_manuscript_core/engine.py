"""确定性规则引擎：同一输入 + 同一规则包版本 = 完全相同的结果。"""

from __future__ import annotations

from dataclasses import dataclass, field

from .citation import resolve_citation, validate_citation_resolution
from .errors import OakError
from .format_coverage import build_format_coverage
from .model import DocxDocument
from .rules import RULE_FUNCS
from .rules.common import PREVIEW_MAX

IMPLEMENTED_MILESTONES = {"M1", "M2", "M3"}
_PART_ORDER = {"package": 0, "document": 1, "footnotes": 2, "endnotes": 3}


@dataclass
class CheckOutcome:
    issues: list[dict] = field(default_factory=list)
    resolved: dict = field(default_factory=dict)
    skipped_rule_groups: list[dict] = field(default_factory=list)
    format_coverage: dict | None = None


def _matches(allowed: list[str], value: str) -> bool:
    return "*" in allowed or value in allowed


def citation_rule_ids_for_resolution(
    pack: dict,
    settings: dict,
    resolution: dict,
    *,
    doc_format: str,
) -> list[str]:
    """返回该解析合同会调度的引用规则 ID（不读取或保留正文）。"""
    validate_citation_resolution(resolution)
    dispatch_style = {
        "style_specific": resolution["resolved_style"],
        "structure_only": "structure-only",
        "disabled": "none",
    }[resolution["mode"]]
    language = resolution["evidence"]["language"]
    return [
        rule_def["rule_id"]
        for rule_def in pack["rules"]
        if (
            rule_def["rule_id"].startswith("REF-")
            and rule_def["milestone"] in IMPLEMENTED_MILESTONES
            and rule_def["enabled_by_default"]
            and _matches(rule_def["applies_to"]["formats"], doc_format)
            and _matches(
                rule_def["applies_to"]["manuscript_types"],
                settings["manuscript_type"],
            )
            and _matches(rule_def["applies_to"]["languages"], language)
            and _matches(rule_def["applies_to"]["citation_styles"], dispatch_style)
        )
    ]


def check_document(
    doc: DocxDocument,
    settings: dict,
    pack: dict,
    *,
    doc_format: str = "docx",
    check_id: str = "check",
) -> CheckOutcome:
    # 1. 解析语言与体例。新规则包使用结构信号解析器；旧规则包保留历史映射。
    citation_resolution = resolve_citation(
        doc,
        settings,
        pack,
        doc_format=doc_format,
    )
    detected = citation_resolution["evidence"]["language"]
    resolved_style = citation_resolution["resolved_style"]
    resolved_by = citation_resolution["resolved_by"]
    mapping_version = (
        citation_resolution["resolver"]["policy_version"]
        if citation_resolution["requested_style"] == "default"
        else None
    )
    compatibility_resolved_by = (
        "default_mapping" if resolved_by == "legacy_mapping" else resolved_by
    )
    dispatch_style = {
        "style_specific": resolved_style,
        "structure_only": "structure-only",
        "disabled": "none",
    }[citation_resolution["mode"]]

    resolved = {
        "language_detected": detected,
        "citation_style_resolved": resolved_style,
        "citation_resolved_by": compatibility_resolved_by,
        "citation_mapping_version": mapping_version,
        "citation_resolution": citation_resolution,
    }
    ctx = {
        "language": detected,
        "citation_style": resolved_style,
        "citation_mode": citation_resolution["mode"],
        "settings": settings,
    }

    # 2. 调度规则
    issues: list[dict] = []
    citation_rule_ids = citation_rule_ids_for_resolution(
        pack,
        settings,
        citation_resolution,
        doc_format=doc_format,
    )
    skipped_milestones: set[str] = set()
    applied_rule_defs: list[dict] = []
    for rule_def in pack["rules"]:
        milestone = rule_def["milestone"]
        if milestone not in IMPLEMENTED_MILESTONES:
            skipped_milestones.add(milestone)
            continue
        if not rule_def["enabled_by_default"]:
            continue
        at = rule_def["applies_to"]
        if not (
            _matches(at["formats"], doc_format)
            and _matches(at["manuscript_types"], settings["manuscript_type"])
            and _matches(at["languages"], detected)
            and _matches(at["citation_styles"], dispatch_style)
        ):
            continue
        fn = RULE_FUNCS.get(rule_def["rule_id"])
        if fn is None:
            raise OakError(
                f"规则 {rule_def['rule_id']} 属当前里程碑但没有对应实现：规则包与代码不一致，拒绝继续。"
            )
        applied_rule_defs.append(rule_def)
        for f in fn(doc, ctx):
            issues.append(_assemble_issue(rule_def, f, settings))

    citation_resolution["coverage"]["rule_ids"] = citation_rule_ids
    validate_citation_resolution(citation_resolution)

    # 3. 确定性排序 + 编号
    issues.sort(
        key=lambda i: (
            _PART_ORDER.get(i["location"]["part"], 9),
            i["location"].get("resource") or "",
            i["location"].get("line") if i["location"].get("line") is not None else 10**9,
            i["location"]["paragraph"] if i["location"]["paragraph"] is not None else 10**9,
            i["location"]["note_id"] if i["location"]["note_id"] is not None else 0,
            i["rule_id"],
        )
    )
    for n, issue in enumerate(issues, start=1):
        issue["issue_id"] = f"{check_id}-{n:04d}"

    skipped = [
        {"milestone": m, "reason": "本版本未实现"} for m in sorted(skipped_milestones)
    ]
    return CheckOutcome(
        issues=issues,
        resolved=resolved,
        skipped_rule_groups=skipped,
        format_coverage=build_format_coverage(doc_format, applied_rule_defs),
    )


def _assemble_issue(rule_def: dict, f: dict, settings: dict) -> dict:
    preview = (f.get("preview") or "")[:PREVIEW_MAX]
    return {
        "issue_id": "",  # 排序后统一编号
        "rule_id": rule_def["rule_id"],
        "profile": settings["manuscript_type"],
        "severity": rule_def["severity"],
        "title": rule_def["title"],
        "explanation": rule_def["explanation"],
        "location": {
            "part": f.get("part", "document"),
            "paragraph": f.get("paragraph"),
            "line": f.get("line"),
            "note_id": f.get("note_id"),
            "resource": f.get("resource"),
        },
        "preview": preview,
        "standard_refs": list(rule_def["standard_refs"]),
        "auto_fixable": rule_def["auto_fixable"],
        "fix_id": rule_def["fix_id"],
        "confidence": rule_def["confidence"],
        "status": "open",
    }


def manuscript_status_level(issues: list[dict]) -> str:
    """稿件状态级别（SPEC_MODELS §2 冻结条件）。计 open/accepted 的问题。"""
    pending = [i for i in issues if i["status"] in ("open", "accepted")]
    if any(i["severity"] == "error" for i in pending):
        return "尚未具备提交条件"
    if any(i["severity"] == "warning" for i in pending):
        return "可在订正后提交"
    return "基本具备编辑评估条件"
