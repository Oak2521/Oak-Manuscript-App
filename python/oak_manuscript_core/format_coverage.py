"""TXT/Markdown 实际覆盖范围的 content-free 合同。"""

from __future__ import annotations

import re

from .errors import OakError

_FIELDS = {
    "schema_version", "format", "status", "rule_ids", "auto_fixable_rule_ids",
    "excluded_contexts", "not_checked", "disclosure",
}
_RULE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_EXCLUDED = {
    "md": ["fenced_code", "inline_code", "table", "hard_break", "layout_sensitive"],
    "txt": ["layout_sensitive"],
}
_NOT_CHECKED = {
    "md": ["semantic_rewriting", "full_markdown_conformance", "external_standard_completeness"],
    "txt": ["semantic_rewriting", "layout_reconstruction", "external_standard_completeness"],
}
_LABELS = {"md": "Markdown", "txt": "TXT"}


def _disclosure(doc_format: str, rule_count: int) -> str:
    return (
        f"{_LABELS[doc_format]} 本次运行 {rule_count} 条确定性规则；已保守排除可能承载代码或刻意版式的内容。"
        "没有发现问题不能代表全面审查。"
    )


def build_format_coverage(doc_format: str, rule_defs: list[dict]) -> dict | None:
    if doc_format not in _EXCLUDED:
        return None
    rule_ids = sorted(rule["rule_id"] for rule in rule_defs)
    auto_fixable = sorted(rule["rule_id"] for rule in rule_defs if rule["auto_fixable"])
    result = {
        "schema_version": "1.0",
        "format": doc_format,
        "status": "limited",
        "rule_ids": rule_ids,
        "auto_fixable_rule_ids": auto_fixable,
        "excluded_contexts": list(_EXCLUDED[doc_format]),
        "not_checked": list(_NOT_CHECKED[doc_format]),
        "disclosure": _disclosure(doc_format, len(rule_ids)),
    }
    return validate_format_coverage(result)


def validate_format_coverage(value: object, *, allow_none: bool = False) -> dict | None:
    if value is None and allow_none:
        return None
    if not isinstance(value, dict) or set(value) != _FIELDS:
        raise OakError("格式覆盖记录字段集合非法")
    if value["schema_version"] != "1.0" or value["format"] not in _EXCLUDED or value["status"] != "limited":
        raise OakError("格式覆盖记录身份非法")
    for field in ("rule_ids", "auto_fixable_rule_ids"):
        items = value[field]
        if (not isinstance(items, list) or items != sorted(items) or
                len(items) != len(set(items)) or
                any(not isinstance(item, str) or not _RULE_ID.fullmatch(item) for item in items)):
            raise OakError(f"格式覆盖记录 {field} 非法")
    if any(item not in value["rule_ids"] for item in value["auto_fixable_rule_ids"]):
        raise OakError("格式覆盖记录自动修复规则不属于已运行规则")
    doc_format = value["format"]
    if value["excluded_contexts"] != _EXCLUDED[doc_format] or value["not_checked"] != _NOT_CHECKED[doc_format]:
        raise OakError("格式覆盖记录排除范围非法")
    if value["disclosure"] != _disclosure(doc_format, len(value["rule_ids"])):
        raise OakError("格式覆盖记录披露文本非法")
    return value
