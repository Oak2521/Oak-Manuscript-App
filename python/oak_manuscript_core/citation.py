"""Deterministic citation-style resolution.

The resolver intentionally stores only structural counts and enums.  It never
copies manuscript text, citation strings, names, local paths, or hashes into
its result.  Legacy rule packs keep their historical type/language mapping;
new packs opt in by adding an exact ``citation_default_mapping.resolver``
object.
"""

from __future__ import annotations

import re
from typing import Iterable

from .errors import OakError


RESOLUTION_SCHEMA_VERSION = "1.0"
SUPPORTED_STYLES = (
    "gbt7714-2025",
    "apa-7",
    "chicago-18-nb",
    "chicago-18-ad",
)
REQUESTED_STYLES = {"default", *SUPPORTED_STYLES, "none"}
SUPPORTED_FORMATS = {"docx", "md", "txt", "epub"}
SUPPORTED_PROFILES = {"paper", "print_book", "ebook"}
SUPPORTED_LANGUAGES = {"auto", "zh", "en", "mixed"}

_RESOLVER_FIELDS = {
    "id",
    "version",
    "signal_extractor_version",
    "thresholds",
    "style_capability_rules",
}
_THRESHOLD_FIELDS = {
    "strong_min_unique",
    "moderate_min_unique",
    "strong_min_coverage_percent",
    "moderate_min_coverage_percent",
}
_EXPECTED_THRESHOLDS = {
    "strong_min_unique": 3,
    "moderate_min_unique": 2,
    "strong_min_coverage_percent": 80,
    "moderate_min_coverage_percent": 50,
}

_CJK_RANGES = ((0x3400, 0x4DBF), (0x4E00, 0x9FFF))
_REFERENCE_HEADINGS = {"references", "reference", "bibliography"}
_NUMBERED_ENTRY = re.compile(r"^\s*\[(\d+)\]\s*(.*)$", re.S)
_NUMERIC_CITATION = re.compile(
    r"\[\s*(\d+(?:\s*(?:[-\u2013\u2014,\uff0c;\uff1b])\s*\d+)*)\s*\]"
)
_AUTHOR_YEAR = re.compile(
    r"[\(\uff08]\s*((?:[A-Z][A-Za-z'\u2019-]{0,79})|(?:[\u3400-\u9fff]{2,8}))"
    r"(?:\s*(?:&|and|与|和)\s*(?:[A-Z][A-Za-z'\u2019-]{0,79}|[\u3400-\u9fff]{2,8}))?"
    r"(?:\s+(?:et\s+al\.|等))?\s*(?:[,\uff0c]\s*|\s+)"
    r"((?:19|20)\d{2})[a-z]?\s*[\)\uff09]"
)
_MAX_EXPANDED_RANGE = 1_000
_SEMVER = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
_RULE_ID = re.compile(r"^[A-Z0-9][A-Z0-9._-]{0,127}$")
_RESOLUTION_FIELDS = {
    "schema_version", "requested_style", "mode", "resolved_style", "resolved_by",
    "resolver", "reason_code", "reason", "confidence", "evidence", "coverage",
}
_RESOLVER_METADATA_FIELDS = {
    "id", "version", "policy_version", "signal_extractor_version",
}
_EVIDENCE_FIELDS = {
    "check_profile", "document_format", "language", "language_basis",
    "language_sample_chars", "language_cjk_chars", "language_ascii_letters",
    "language_sufficient", "reference_heading_count", "reference_entry_count",
    "numbered_entry_unique", "numbered_entry_coverage_percent",
    "numeric_citation_unique", "numeric_matched_unique", "numeric_coverage_percent",
    "author_year_citation_unique", "author_year_matched_unique",
    "author_year_entry_matched_unique", "author_year_coverage_percent",
    "note_reference_unique", "nonempty_note_unique", "note_matched_unique",
    "note_coverage_percent",
}
_COUNT_EVIDENCE_FIELDS = {
    field for field in _EVIDENCE_FIELDS
    if field.endswith("_count") or field.endswith("_chars") or field.endswith("_unique")
}
_PERCENT_EVIDENCE_FIELDS = {
    field for field in _EVIDENCE_FIELDS if field.endswith("_percent")
}
_FIXED_REASONS = {
    "user_disabled": "用户已明确选择暂不检查引用格式。",
    "extractor_coverage_insufficient":
        "当前格式只能提取部分引用结构信号；本次仅执行引用结构与一致性检查。",
    "language_evidence_insufficient":
        "正文语言样本不足，无法可靠选择引用体例；本次仅执行引用结构与一致性检查。",
    "ebook_no_citation_signals":
        "电子书中未检测到引用结构信号；本次不运行引用格式检查。",
    "ambiguous_reference_sections":
        "检测到多个参考文献或书目部分，无法可靠选择单一体例。",
    "conflicting_structures":
        "检测到多个达到中等阈值的引用结构家族，无法可靠选择单一体例。",
    "insufficient_evidence": "引用结构证据未达到中等阈值，无法可靠选择体例。",
    "signal_profile_mismatch":
        "引用结构信号与稿件类型或主要语言不吻合，无法可靠选择体例。",
}
_STRUCTURE_ONLY_REASON_CODES = {
    "extractor_coverage_insufficient",
    "language_evidence_insufficient",
    "ambiguous_reference_sections",
    "conflicting_structures",
    "insufficient_evidence",
    "signal_profile_mismatch",
}
_STYLE_REASON_CODES = {
    "gbt7714-2025": "numeric_reference_structure",
    "apa-7": "author_year_structure",
    "chicago-18-nb": "notes_bibliography_structure",
    "chicago-18-ad": "author_year_structure",
}


def _is_cjk(character: str) -> bool:
    code = ord(character)
    return any(lower <= code <= upper for lower, upper in _CJK_RANGES)


def analyze_language(
    text: str,
    *,
    dominance_ratio: int = 4,
    min_sample_chars: int = 200,
) -> dict:
    """Return deterministic language evidence without retaining ``text``."""
    if not isinstance(text, str):
        raise OakError("语言识别输入必须是文本。")
    if (
        isinstance(dominance_ratio, bool)
        or not isinstance(dominance_ratio, int)
        or dominance_ratio < 1
        or isinstance(min_sample_chars, bool)
        or not isinstance(min_sample_chars, int)
        or min_sample_chars < 1
    ):
        raise OakError("语言识别阈值非法。")

    cjk_chars = 0
    ascii_letters = 0
    for character in text:
        if _is_cjk(character):
            cjk_chars += 1
        elif "a" <= character <= "z" or "A" <= character <= "Z":
            ascii_letters += 1
    sample_chars = cjk_chars + ascii_letters
    sufficient = sample_chars >= min_sample_chars
    if not sufficient:
        language = "mixed"
        basis = "auto_insufficient"
    elif cjk_chars >= dominance_ratio * ascii_letters:
        language = "zh"
        basis = "auto_sufficient"
    elif ascii_letters >= dominance_ratio * cjk_chars:
        language = "en"
        basis = "auto_sufficient"
    else:
        language = "mixed"
        basis = "auto_sufficient"
    result = {
        "language": language,
        "basis": basis,
        "sample_chars": sample_chars,
        "cjk_chars": cjk_chars,
        "ascii_letters": ascii_letters,
        "sufficient": sufficient,
    }
    return result


def _is_reference_heading(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    if normalized.startswith("参考文献") and len(normalized) <= 8:
        return True
    return normalized.casefold() in _REFERENCE_HEADINGS


def _paragraph_text(paragraph: object) -> str:
    value = getattr(paragraph, "text", "")
    return value if isinstance(value, str) else ""


def _numeric_values(fragment: str) -> set[int]:
    values: set[int] = set()
    for component in re.split(r"\s*[,\uff0c;\uff1b]\s*", fragment):
        if not component:
            continue
        range_match = re.fullmatch(r"(\d+)\s*[-\u2013\u2014]\s*(\d+)", component)
        if range_match:
            start = int(range_match.group(1))
            end = int(range_match.group(2))
            if end >= start and end - start <= _MAX_EXPANDED_RANGE:
                values.update(range(start, end + 1))
            continue
        if component.isdigit():
            values.add(int(component))
    return values


def _numeric_citations(texts: Iterable[str]) -> set[int]:
    values: set[int] = set()
    for text in texts:
        for match in _NUMERIC_CITATION.finditer(text):
            values.update(_numeric_values(match.group(1)))
    return values


def _author_year_citations(texts: Iterable[str]) -> set[tuple[str, str]]:
    values: set[tuple[str, str]] = set()
    for text in texts:
        for match in _AUTHOR_YEAR.finditer(text):
            values.add((match.group(1).casefold(), match.group(2)))
    return values


def _coverage_percent(matched: int, total: int) -> int:
    return 0 if total <= 0 else (matched * 100) // total


def extract_citation_signals(doc: object, *, doc_format: str) -> dict:
    """Extract privacy-safe structural signals from a reader model.

    DOCX/Markdown/plain-text readers expose paragraph boundaries.  The current
    EPUB model exposes only merged body text, so EPUB evidence is deliberately
    marked partial and can never trigger a style-specific default decision.
    """
    if doc_format not in SUPPORTED_FORMATS:
        raise OakError(f"不支持的引用信号格式：{doc_format}")

    raw_body = getattr(doc, "body_text", "")
    body_text = raw_body if isinstance(raw_body, str) else ""
    paragraphs_value = getattr(doc, "paragraphs", None)
    paragraphs = list(paragraphs_value) if isinstance(paragraphs_value, (list, tuple)) else []
    availability = "partial" if doc_format == "epub" else "full"

    if paragraphs:
        heading_positions = [
            index
            for index, paragraph in enumerate(paragraphs)
            if _is_reference_heading(_paragraph_text(paragraph))
        ]
        first_heading = heading_positions[0] if heading_positions else None
        body_paragraphs = paragraphs if first_heading is None else paragraphs[:first_heading]
        entry_paragraphs: list[object] = []
        if first_heading is not None:
            for paragraph in paragraphs[first_heading + 1 :]:
                if getattr(paragraph, "heading_level", None) is not None:
                    break
                if _paragraph_text(paragraph).strip():
                    entry_paragraphs.append(paragraph)
        body_texts = [_paragraph_text(paragraph) for paragraph in body_paragraphs]
        entry_texts = [_paragraph_text(paragraph).strip() for paragraph in entry_paragraphs]
        reference_heading_count = len(heading_positions)
    else:
        body_texts = [body_text]
        entry_texts = []
        reference_heading_count = 0

    numbered_entries: set[int] = set()
    entry_bodies: list[str] = []
    for text in entry_texts:
        match = _NUMBERED_ENTRY.match(text)
        if match:
            numbered_entries.add(int(match.group(1)))
            entry_bodies.append(match.group(2).strip())
        else:
            entry_bodies.append(text)

    numeric_citations = _numeric_citations(body_texts)
    numeric_matches = numeric_citations & numbered_entries
    author_year_citations = _author_year_citations(body_texts)
    author_year_matches: set[tuple[str, str]] = set()
    author_year_entry_matches: set[int] = set()
    for surname, year in author_year_citations:
        if any(_is_cjk(char) for char in surname):
            surname_pattern = re.compile(re.escape(surname), re.I)
        else:
            surname_pattern = re.compile(
                rf"(?<![A-Za-z]){re.escape(surname)}(?![A-Za-z])", re.I
            )
        matched_indexes = {
            index
            for index, entry in enumerate(entry_bodies)
            if year in entry and surname_pattern.search(entry)
        }
        if matched_indexes:
            author_year_matches.add((surname, year))
            author_year_entry_matches.update(matched_indexes)

    refs_value = getattr(doc, "footnote_ref_ids", None)
    note_references = {
        value
        for value in (refs_value if isinstance(refs_value, (list, tuple)) else [])
        if isinstance(value, int) and not isinstance(value, bool)
    }
    notes_value = getattr(doc, "footnotes", None)
    nonempty_notes: set[int] = set()
    for note in notes_value if isinstance(notes_value, (list, tuple)) else []:
        note_id = getattr(note, "note_id", None)
        note_text = getattr(note, "text", "")
        if (
            isinstance(note_id, int)
            and not isinstance(note_id, bool)
            and isinstance(note_text, str)
            and note_text.strip()
        ):
            nonempty_notes.add(note_id)
    note_matches = note_references & nonempty_notes

    return {
        "signal_availability": availability,
        "reference_heading_count": reference_heading_count,
        "reference_entry_count": len(entry_texts),
        "numbered_entry_unique": len(numbered_entries),
        "numbered_entry_coverage_percent": _coverage_percent(
            len(numbered_entries), len(entry_texts)
        ),
        "numeric_citation_unique": len(numeric_citations),
        "numeric_matched_unique": len(numeric_matches),
        "numeric_coverage_percent": _coverage_percent(
            len(numeric_matches), len(numeric_citations)
        ),
        "author_year_citation_unique": len(author_year_citations),
        "author_year_matched_unique": len(author_year_matches),
        "author_year_entry_matched_unique": len(author_year_entry_matches),
        "author_year_coverage_percent": _coverage_percent(
            len(author_year_matches), len(author_year_citations)
        ),
        "note_reference_unique": len(note_references),
        "nonempty_note_unique": len(nonempty_notes),
        "note_matched_unique": len(note_matches),
        "note_coverage_percent": _coverage_percent(len(note_matches), len(note_references)),
    }


def _validate_settings(settings: object) -> tuple[str, str, str]:
    if not isinstance(settings, dict):
        raise OakError("引用解析 settings 必须是对象。")
    requested = settings.get("citation_style", "default")
    profile = settings.get("manuscript_type")
    language = settings.get("language", "auto")
    if requested not in REQUESTED_STYLES:
        raise OakError(f"不支持的引用体例请求：{requested}")
    if profile not in SUPPORTED_PROFILES:
        raise OakError(f"不支持的稿件类型：{profile}")
    if language not in SUPPORTED_LANGUAGES:
        raise OakError(f"不支持的语言设置：{language}")
    return requested, profile, language


def _validate_resolver(mapping: dict) -> dict | None:
    resolver = mapping.get("resolver")
    if resolver is None:
        return None
    if not isinstance(resolver, dict) or set(resolver) != _RESOLVER_FIELDS:
        raise OakError("规则包 citation resolver 字段不符合冻结 schema。")
    for field in ("id", "version", "signal_extractor_version"):
        if not isinstance(resolver[field], str) or not resolver[field]:
            raise OakError(f"规则包 citation resolver {field} 非法。")
    thresholds = resolver["thresholds"]
    if (
        not isinstance(thresholds, dict)
        or set(thresholds) != _THRESHOLD_FIELDS
        or any(isinstance(value, bool) or not isinstance(value, int) for value in thresholds.values())
        or thresholds != _EXPECTED_THRESHOLDS
    ):
        raise OakError("规则包 citation resolver thresholds 不符合冻结值。")
    capabilities = resolver["style_capability_rules"]
    if not isinstance(capabilities, dict) or set(capabilities) != set(SUPPORTED_STYLES):
        raise OakError("规则包 citation resolver style_capability_rules 非法。")
    for style, rule_ids in capabilities.items():
        if (
            not isinstance(rule_ids, list)
            or any(not isinstance(rule_id, str) or not rule_id for rule_id in rule_ids)
            or len(rule_ids) != len(set(rule_ids))
        ):
            raise OakError(f"规则包 {style} 能力规则列表非法。")
    return resolver


def _resolver_metadata(mapping: dict, resolver: dict | None) -> dict:
    policy_version = mapping.get("version")
    if not isinstance(policy_version, str) or not policy_version:
        raise OakError("规则包默认体例 policy version 非法。")
    if resolver is None:
        return {
            "id": "legacy-citation-default-mapping",
            "version": policy_version,
            "policy_version": policy_version,
            "signal_extractor_version": "legacy",
        }
    return {
        "id": resolver["id"],
        "version": resolver["version"],
        "policy_version": policy_version,
        "signal_extractor_version": resolver["signal_extractor_version"],
    }


def _matches(values: object, value: str) -> bool:
    return isinstance(values, list) and ("*" in values or value in values)


def _assert_style_capability(
    pack: dict,
    resolver: dict,
    style: str,
    *,
    doc_format: str,
    profile: str,
    language: str,
) -> None:
    configured = resolver["style_capability_rules"][style]
    rules = pack.get("rules")
    if not isinstance(rules, list):
        raise OakError("规则包 rules 非法，无法验证引用体例能力。")
    by_id = {
        rule.get("rule_id"): rule
        for rule in rules
        if isinstance(rule, dict) and isinstance(rule.get("rule_id"), str)
    }
    missing = [rule_id for rule_id in configured if rule_id not in by_id]
    if missing:
        raise OakError(f"引用体例 {style} 配置了不存在的能力规则：{', '.join(missing)}")
    for rule_id in configured:
        rule = by_id[rule_id]
        applies = rule.get("applies_to")
        if (
            rule.get("enabled_by_default") is True
            and isinstance(applies, dict)
            and _matches(applies.get("formats"), doc_format)
            and _matches(applies.get("manuscript_types"), profile)
            and _matches(applies.get("languages"), language)
            and _matches(applies.get("citation_styles"), style)
        ):
            return
    raise OakError(
        f"当前规则包没有可用于 {doc_format}/{profile}/{language} 的 {style} 检查能力。"
    )


def _legacy_style(mapping: dict, profile: str, language: str) -> str:
    entries = mapping.get("map")
    if not isinstance(entries, list):
        raise OakError("旧规则包默认体例映射非法。")
    for entry in entries:
        if (
            isinstance(entry, dict)
            and entry.get("manuscript_type") == profile
            and isinstance(entry.get("languages"), list)
            and language in entry["languages"]
            and entry.get("citation_style") in {*SUPPORTED_STYLES, "none"}
        ):
            return entry["citation_style"]
    raise OakError(f"旧规则包默认体例映射未覆盖：{profile} × {language}")


def _family_level(
    unique: int,
    coverage: int,
    thresholds: dict,
    *,
    companion_unique: int,
    companion_coverage: int = 100,
) -> str:
    if (
        unique >= thresholds["strong_min_unique"]
        and companion_unique >= thresholds["strong_min_unique"]
        and coverage >= thresholds["strong_min_coverage_percent"]
        and companion_coverage >= thresholds["strong_min_coverage_percent"]
    ):
        return "strong"
    if (
        unique >= thresholds["moderate_min_unique"]
        and companion_unique >= thresholds["moderate_min_unique"]
        and coverage >= thresholds["moderate_min_coverage_percent"]
        and companion_coverage >= thresholds["moderate_min_coverage_percent"]
    ):
        return "moderate"
    return "insufficient"


def _base_result(
    *,
    requested: str,
    mode: str,
    resolved_style: str | None,
    resolved_by: str,
    resolver_metadata: dict,
    reason_code: str,
    reason: str,
    confidence: str | None,
    evidence: dict,
    signal_availability: str,
) -> dict:
    result = {
        "schema_version": RESOLUTION_SCHEMA_VERSION,
        "requested_style": requested,
        "mode": mode,
        "resolved_style": resolved_style,
        "resolved_by": resolved_by,
        "resolver": dict(resolver_metadata),
        "reason_code": reason_code,
        "reason": reason,
        "confidence": confidence,
        "evidence": evidence,
        "coverage": {
            "signal_availability": signal_availability,
            "rule_ids": [],
        },
    }
    return validate_citation_resolution(result)


def expected_resolution_reason(value: dict) -> str:
    """Render the only accepted explanation for a structured resolution."""
    code = value.get("reason_code")
    if code in _FIXED_REASONS:
        return _FIXED_REASONS[code]
    requested = value.get("requested_style")
    resolved = value.get("resolved_style")
    if code == "user_selected":
        return f"用户已明确选择 {requested}；未运行自动体例判定。"
    if code == "legacy_mapping":
        return f"兼容旧规则包：按稿件类型与语言映射为 {resolved}。"
    evidence = value.get("evidence", {})
    if code == "numeric_reference_structure":
        detail = (
            f"检测到 {evidence.get('numeric_citation_unique')} 个唯一编号引用，"
            f"对应覆盖率 {evidence.get('numeric_coverage_percent')}%。"
        )
    elif code == "author_year_structure":
        detail = (
            f"检测到 {evidence.get('author_year_citation_unique')} 个唯一作者—年份引用，"
            f"对应覆盖率 {evidence.get('author_year_coverage_percent')}%。"
        )
    elif code == "notes_bibliography_structure":
        detail = (
            f"检测到 {evidence.get('note_reference_unique')} 个唯一注释引用，"
            f"对应覆盖率 {evidence.get('note_coverage_percent')}%。"
        )
    else:
        raise OakError(f"未知的引用解析 reason_code：{code}")
    return f"{detail}默认采用 {resolved}。"


def validate_citation_resolution(value: object) -> dict:
    """Validate persisted/project/report resolution data fail-closed."""
    if not isinstance(value, dict) or set(value) != _RESOLUTION_FIELDS:
        raise OakError("引用解析对象字段集合非法。")
    if value.get("schema_version") != RESOLUTION_SCHEMA_VERSION:
        raise OakError("引用解析对象 schema_version 非法。")
    requested = value.get("requested_style")
    mode = value.get("mode")
    resolved = value.get("resolved_style")
    resolved_by = value.get("resolved_by")
    confidence = value.get("confidence")
    if requested not in REQUESTED_STYLES:
        raise OakError("引用解析 requested_style 非法。")
    if mode not in {"style_specific", "structure_only", "disabled"}:
        raise OakError("引用解析 mode 非法。")
    if resolved not in {*SUPPORTED_STYLES, "none", None}:
        raise OakError("引用解析 resolved_style 非法。")
    if resolved_by not in {"user", "default_resolver", "legacy_mapping"}:
        raise OakError("引用解析 resolved_by 非法。")
    if confidence not in {"high", "medium", "low", None}:
        raise OakError("引用解析 confidence 非法。")

    resolver = value.get("resolver")
    if not isinstance(resolver, dict) or set(resolver) != _RESOLVER_METADATA_FIELDS:
        raise OakError("引用解析 resolver 字段集合非法。")
    if not isinstance(resolver.get("id"), str) or not resolver["id"]:
        raise OakError("引用解析 resolver.id 非法。")
    for field in ("version", "policy_version"):
        if not isinstance(resolver.get(field), str) or not _SEMVER.fullmatch(resolver[field]):
            raise OakError(f"引用解析 resolver.{field} 非法。")
    signal_version = resolver.get("signal_extractor_version")
    if signal_version != "legacy" and (
        not isinstance(signal_version, str) or not _SEMVER.fullmatch(signal_version)
    ):
        raise OakError("引用解析 signal_extractor_version 非法。")

    evidence = value.get("evidence")
    if not isinstance(evidence, dict) or set(evidence) != _EVIDENCE_FIELDS:
        raise OakError("引用解析 evidence 字段集合非法。")
    if evidence.get("check_profile") not in SUPPORTED_PROFILES:
        raise OakError("引用解析 evidence.check_profile 非法。")
    if evidence.get("document_format") not in SUPPORTED_FORMATS:
        raise OakError("引用解析 evidence.document_format 非法。")
    if evidence.get("language") not in {"zh", "en", "mixed"}:
        raise OakError("引用解析 evidence.language 非法。")
    if evidence.get("language_basis") not in {"user", "auto_sufficient", "auto_insufficient"}:
        raise OakError("引用解析 evidence.language_basis 非法。")
    if not isinstance(evidence.get("language_sufficient"), bool):
        raise OakError("引用解析 evidence.language_sufficient 非法。")
    for field in _COUNT_EVIDENCE_FIELDS:
        number = evidence.get(field)
        if isinstance(number, bool) or not isinstance(number, int) or number < 0:
            raise OakError(f"引用解析 evidence.{field} 非法。")
    for field in _PERCENT_EVIDENCE_FIELDS:
        number = evidence.get(field)
        if isinstance(number, bool) or not isinstance(number, int) or not 0 <= number <= 100:
            raise OakError(f"引用解析 evidence.{field} 非法。")
    if evidence["language_sample_chars"] != (
        evidence["language_cjk_chars"] + evidence["language_ascii_letters"]
    ):
        raise OakError("引用解析语言字符计数不一致。")

    coverage = value.get("coverage")
    if not isinstance(coverage, dict) or set(coverage) != {"signal_availability", "rule_ids"}:
        raise OakError("引用解析 coverage 字段集合非法。")
    if coverage.get("signal_availability") not in {"full", "partial"}:
        raise OakError("引用解析 signal_availability 非法。")
    rule_ids = coverage.get("rule_ids")
    if (
        not isinstance(rule_ids, list)
        or len(rule_ids) != len(set(rule_ids))
        or any(not isinstance(rule_id, str) or not _RULE_ID.fullmatch(rule_id) for rule_id in rule_ids)
    ):
        raise OakError("引用解析 coverage.rule_ids 非法。")

    if requested == "none":
        valid_shape = (
            mode == "disabled" and resolved == "none" and resolved_by == "user"
            and confidence is None and value.get("reason_code") == "user_disabled"
        )
    elif requested in SUPPORTED_STYLES:
        valid_shape = (
            mode == "style_specific" and resolved == requested and resolved_by == "user"
            and confidence is None and value.get("reason_code") == "user_selected"
        )
    elif mode == "structure_only":
        valid_shape = (
            requested == "default"
            and resolved is None
            and resolved_by == "default_resolver"
            and confidence == "low"
            and value.get("reason_code") in _STRUCTURE_ONLY_REASON_CODES
        )
    elif mode == "style_specific":
        valid_shape = (
            requested == "default"
            and resolved in SUPPORTED_STYLES
            and resolved_by in {"default_resolver", "legacy_mapping"}
            and (
                confidence in {"high", "medium"}
                if resolved_by == "default_resolver"
                else confidence is None
            )
            and (
                value.get("reason_code") == _STYLE_REASON_CODES[resolved]
                if resolved_by == "default_resolver"
                else value.get("reason_code") == "legacy_mapping"
            )
        )
    else:
        valid_shape = (
            requested == "default"
            and resolved == "none"
            and resolved_by in {"default_resolver", "legacy_mapping"}
            and confidence is None
            and value.get("reason_code") == (
                "ebook_no_citation_signals"
                if resolved_by == "default_resolver"
                else "legacy_mapping"
            )
        )
    if not valid_shape:
        raise OakError("引用解析字段间状态不一致。")
    if not isinstance(value.get("reason"), str) or value["reason"] != expected_resolution_reason(value):
        raise OakError("引用解析 reason 与固定模板不一致。")
    return value


def resolve_citation(
    doc: object,
    settings: dict,
    pack: dict,
    *,
    doc_format: str,
) -> dict:
    """Resolve a citation request to a deterministic, auditable contract."""
    requested, profile, requested_language = _validate_settings(settings)
    if doc_format not in SUPPORTED_FORMATS:
        raise OakError(f"不支持的引用信号格式：{doc_format}")
    if not isinstance(pack, dict):
        raise OakError("引用解析规则包必须是对象。")
    mapping = pack.get("citation_default_mapping")
    if not isinstance(mapping, dict):
        raise OakError("规则包缺少 citation_default_mapping。")
    resolver = _validate_resolver(mapping)
    metadata = _resolver_metadata(mapping, resolver)

    language_analysis = analyze_language(getattr(doc, "body_text", ""))
    if requested_language == "auto":
        language = language_analysis["language"]
        language_basis = language_analysis["basis"]
        language_sufficient = language_analysis["sufficient"]
    else:
        language = requested_language
        language_basis = "user"
        language_sufficient = True
    signals = extract_citation_signals(doc, doc_format=doc_format)
    evidence = {
        "check_profile": profile,
        "document_format": doc_format,
        "language": language,
        "language_basis": language_basis,
        "language_sample_chars": language_analysis["sample_chars"],
        "language_cjk_chars": language_analysis["cjk_chars"],
        "language_ascii_letters": language_analysis["ascii_letters"],
        "language_sufficient": language_sufficient,
        **{key: value for key, value in signals.items() if key != "signal_availability"},
    }
    availability = signals["signal_availability"]

    if requested == "none":
        return _base_result(
            requested=requested,
            mode="disabled",
            resolved_style="none",
            resolved_by="user",
            resolver_metadata=metadata,
            reason_code="user_disabled",
            reason="用户已明确选择暂不检查引用格式。",
            confidence=None,
            evidence=evidence,
            signal_availability=availability,
        )

    if requested != "default":
        if resolver is not None:
            _assert_style_capability(
                pack,
                resolver,
                requested,
                doc_format=doc_format,
                profile=profile,
                language=language,
            )
        return _base_result(
            requested=requested,
            mode="style_specific",
            resolved_style=requested,
            resolved_by="user",
            resolver_metadata=metadata,
            reason_code="user_selected",
            reason=f"用户已明确选择 {requested}；未运行自动体例判定。",
            confidence=None,
            evidence=evidence,
            signal_availability=availability,
        )

    if resolver is None:
        style = _legacy_style(mapping, profile, language)
        return _base_result(
            requested=requested,
            mode="disabled" if style == "none" else "style_specific",
            resolved_style=style,
            resolved_by="legacy_mapping",
            resolver_metadata=metadata,
            reason_code="legacy_mapping",
            reason=f"兼容旧规则包：按稿件类型与语言映射为 {style}。",
            confidence=None,
            evidence=evidence,
            signal_availability=availability,
        )

    def fallback(code: str, reason: str) -> dict:
        return _base_result(
            requested=requested,
            mode="structure_only",
            resolved_style=None,
            resolved_by="default_resolver",
            resolver_metadata=metadata,
            reason_code=code,
            reason=reason,
            confidence="low",
            evidence=evidence,
            signal_availability=availability,
        )

    if availability != "full":
        return fallback(
            "extractor_coverage_insufficient",
            "当前格式只能提取部分引用结构信号；本次仅执行引用结构与一致性检查。",
        )
    signal_total = (
        evidence["numeric_citation_unique"]
        + evidence["author_year_citation_unique"]
        + evidence["note_reference_unique"]
        + evidence["reference_heading_count"]
        + evidence["reference_entry_count"]
    )
    if profile == "ebook" and signal_total == 0:
        return _base_result(
            requested=requested,
            mode="disabled",
            resolved_style="none",
            resolved_by="default_resolver",
            resolver_metadata=metadata,
            reason_code="ebook_no_citation_signals",
            reason="电子书中未检测到引用结构信号；本次不运行引用格式检查。",
            confidence=None,
            evidence=evidence,
            signal_availability=availability,
        )
    if not language_sufficient:
        return fallback(
            "language_evidence_insufficient",
            "正文语言样本不足，无法可靠选择引用体例；本次仅执行引用结构与一致性检查。",
        )
    if evidence["reference_heading_count"] > 1:
        return fallback(
            "ambiguous_reference_sections",
            "检测到多个参考文献或书目部分，无法可靠选择单一体例。",
        )

    thresholds = resolver["thresholds"]
    family_levels = {
        "numeric": _family_level(
            evidence["numeric_citation_unique"],
            evidence["numeric_coverage_percent"],
            thresholds,
            companion_unique=evidence["numbered_entry_unique"],
            companion_coverage=evidence["numbered_entry_coverage_percent"],
        ),
        "author_year": _family_level(
            evidence["author_year_citation_unique"],
            evidence["author_year_coverage_percent"],
            thresholds,
            companion_unique=evidence["author_year_entry_matched_unique"],
        ),
        "notes": _family_level(
            evidence["note_reference_unique"],
            evidence["note_coverage_percent"],
            thresholds,
            companion_unique=(
                evidence["reference_entry_count"]
                if evidence["reference_heading_count"] == 1
                else 0
            ),
        ),
    }
    qualified = [
        family for family, level in family_levels.items() if level in {"strong", "moderate"}
    ]
    if len(qualified) > 1:
        return fallback(
            "conflicting_structures",
            "检测到多个达到中等阈值的引用结构家族，无法可靠选择单一体例。",
        )
    if not qualified:
        return fallback(
            "insufficient_evidence",
            "引用结构证据未达到中等阈值，无法可靠选择体例。",
        )

    family = qualified[0]
    candidate = None
    reason_code = ""
    if family == "numeric" and profile == "paper" and language == "zh":
        candidate = "gbt7714-2025"
        reason_code = "numeric_reference_structure"
    elif family == "author_year" and profile == "paper" and language == "en":
        candidate = "apa-7"
        reason_code = "author_year_structure"
    elif family == "notes" and profile == "print_book":
        candidate = "chicago-18-nb"
        reason_code = "notes_bibliography_structure"
    elif family == "author_year" and profile == "print_book" and language == "en":
        candidate = "chicago-18-ad"
        reason_code = "author_year_structure"
    if candidate is None:
        return fallback(
            "signal_profile_mismatch",
            "引用结构信号与稿件类型或主要语言不吻合，无法可靠选择体例。",
        )

    _assert_style_capability(
        pack,
        resolver,
        candidate,
        doc_format=doc_format,
        profile=profile,
        language=language,
    )
    level = family_levels[family]
    confidence = "high" if level == "strong" else "medium"
    if family == "numeric":
        detail = (
            f"检测到 {evidence['numeric_citation_unique']} 个唯一编号引用，"
            f"对应覆盖率 {evidence['numeric_coverage_percent']}%。"
        )
    elif family == "author_year":
        detail = (
            f"检测到 {evidence['author_year_citation_unique']} 个唯一作者—年份引用，"
            f"对应覆盖率 {evidence['author_year_coverage_percent']}%。"
        )
    else:
        detail = (
            f"检测到 {evidence['note_reference_unique']} 个唯一注释引用，"
            f"对应覆盖率 {evidence['note_coverage_percent']}%。"
        )
    return _base_result(
        requested=requested,
        mode="style_specific",
        resolved_style=candidate,
        resolved_by="default_resolver",
        resolver_metadata=metadata,
        reason_code=reason_code,
        reason=f"{detail}默认采用 {candidate}。",
        confidence=confidence,
        evidence=evidence,
        signal_availability=availability,
    )


__all__ = [
    "analyze_language",
    "expected_resolution_reason",
    "extract_citation_signals",
    "resolve_citation",
    "validate_citation_resolution",
]
