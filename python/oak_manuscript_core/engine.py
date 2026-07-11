"""确定性规则引擎：同一输入 + 同一规则包版本 = 完全相同的结果。"""

from __future__ import annotations

from dataclasses import dataclass, field

from .errors import OakError
from .model import DocxDocument
from .rulepack import detect_language, resolve_citation_style
from .rules import RULE_FUNCS
from .rules.common import PREVIEW_MAX

IMPLEMENTED_MILESTONES = {"M1"}
_PART_ORDER = {"document": 0, "footnotes": 1, "endnotes": 2}


@dataclass
class CheckOutcome:
    issues: list[dict] = field(default_factory=list)
    resolved: dict = field(default_factory=dict)
    skipped_rule_groups: list[dict] = field(default_factory=list)


def _matches(allowed: list[str], value: str) -> bool:
    return "*" in allowed or value in allowed


def check_document(
    doc: DocxDocument,
    settings: dict,
    pack: dict,
    *,
    doc_format: str = "docx",
    check_id: str = "check",
) -> CheckOutcome:
    # 1. 解析语言与体例（确定性，结果写入返回值供持久化与报告）
    language = settings.get("language", "auto")
    detected = detect_language(doc.body_text) if language == "auto" else language

    style = settings.get("citation_style", "default")
    if style == "default":
        resolved_style, mapping_version = resolve_citation_style(
            pack, settings["manuscript_type"], detected
        )
        resolved_by = "default_mapping"
    else:
        resolved_style, mapping_version, resolved_by = style, None, "user"

    resolved = {
        "language_detected": detected,
        "citation_style_resolved": resolved_style,
        "citation_resolved_by": resolved_by,
        "citation_mapping_version": mapping_version,
    }
    ctx = {"language": detected, "citation_style": resolved_style, "settings": settings}

    # 2. 调度规则
    issues: list[dict] = []
    skipped_milestones: set[str] = set()
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
            and _matches(at["citation_styles"], resolved_style)
        ):
            continue
        fn = RULE_FUNCS.get(rule_def["rule_id"])
        if fn is None:
            raise OakError(
                f"规则 {rule_def['rule_id']} 属当前里程碑但没有对应实现：规则包与代码不一致，拒绝继续。"
            )
        for f in fn(doc, ctx):
            issues.append(_assemble_issue(rule_def, f, settings))

    # 3. 确定性排序 + 编号
    issues.sort(
        key=lambda i: (
            _PART_ORDER.get(i["location"]["part"], 9),
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
    return CheckOutcome(issues=issues, resolved=resolved, skipped_rule_groups=skipped)


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
            "note_id": f.get("note_id"),
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
