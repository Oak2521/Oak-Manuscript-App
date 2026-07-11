"""规则包与标准注册表加载、语言识别、「默认」体例映射（均为确定性逻辑）。"""

from __future__ import annotations

from pathlib import Path

from .errors import OakError
from .util import read_json

_REQUIRED_RULE_FIELDS = (
    "rule_id", "milestone", "applies_to", "severity", "confidence",
    "auto_fixable", "fix_id", "title", "explanation", "standard_refs",
    "enabled_by_default", "since_pack_version",
)

# CJK 统一表意文字（基本区 + 扩展 A）
_CJK_RANGES = ((0x3400, 0x4DBF), (0x4E00, 0x9FFF))


def load_rulepack(path: Path | str) -> dict:
    path = Path(path)
    if not path.is_file():
        raise OakError(f"规则包文件不存在：{path.name}")
    data = read_json(path)
    for key in ("pack_name", "pack_version", "citation_default_mapping", "rules"):
        if key not in data:
            raise OakError(f"规则包缺少必需字段「{key}」：{path.name}")
    seen: set[str] = set()
    for rule in data["rules"]:
        for field in _REQUIRED_RULE_FIELDS:
            if field not in rule:
                raise OakError(f"规则 {rule.get('rule_id', '?')} 缺少字段「{field}」")
        if rule["rule_id"] in seen:
            raise OakError(f"规则包中 rule_id 重复：{rule['rule_id']}")
        seen.add(rule["rule_id"])
        if rule["auto_fixable"] and rule["confidence"] != "high":
            raise OakError(f"规则 {rule['rule_id']} 标记可自动修复但置信度不是 high，违反白名单纪律")
    return data


def load_standards(path: Path | str) -> dict:
    data = read_json(Path(path))
    if "standards" not in data:
        raise OakError("标准注册表缺少 standards 字段")
    return data


def _is_cjk(ch: str) -> bool:
    code = ord(ch)
    return any(lo <= code <= hi for lo, hi in _CJK_RANGES)


def detect_language(text: str, *, dominance_ratio: int = 4, min_sample_chars: int = 200) -> str:
    """冻结算法（SPEC_MODELS §5）：CJK 与 ASCII 字母计数比。样本不足按 mixed。"""
    cjk = 0
    ascii_letters = 0
    for ch in text:
        if _is_cjk(ch):
            cjk += 1
        elif ("a" <= ch <= "z") or ("A" <= ch <= "Z"):
            ascii_letters += 1
    if cjk + ascii_letters < min_sample_chars:
        return "mixed"
    if cjk >= dominance_ratio * ascii_letters:
        return "zh"
    if ascii_letters >= dominance_ratio * cjk:
        return "en"
    return "mixed"


def resolve_citation_style(pack: dict, manuscript_type: str, language: str) -> tuple[str, str]:
    """按冻结映射表解析「默认」体例。返回 (体例, 映射版本)。"""
    mapping = pack["citation_default_mapping"]
    for entry in mapping["map"]:
        if entry["manuscript_type"] == manuscript_type and language in entry["languages"]:
            return entry["citation_style"], mapping["version"]
    raise OakError(
        f"默认体例映射表（v{mapping['version']}）没有覆盖组合：{manuscript_type} × {language}"
    )
