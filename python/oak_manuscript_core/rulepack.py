"""规则包与标准注册表加载、身份绑定与「默认」体例映射。

规则包文件本身是项目检查结果的一部分，不能只用可重复声明的版本号识别。
本模块因此同时保留两类摘要：

* ``sha256``：规则包文件的原始字节 SHA-256（发布包/项目 pin 使用）；
* canonical SHA-256：当前内存对象的确定性摘要（防止调用方加载后再改字典）。

签名验证属于 Electron ``StandardsProvider`` 的安装边界；Python 在每次使用时
重新核对 manifest、payload 与项目 pin，绝不信任可写状态文件中的“已验证”标记。
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from .errors import OakError

_REQUIRED_RULE_FIELDS = (
    "rule_id", "milestone", "applies_to", "severity", "confidence",
    "auto_fixable", "fix_id", "title", "explanation", "standard_refs",
    "enabled_by_default", "since_pack_version",
)

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_SAFE_PACK_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
_RULE_ID_RE = re.compile(r"^[A-Z0-9][A-Z0-9._-]{0,127}$")
_STANDARD_ID_RE = re.compile(r"^[A-Z0-9][A-Z0-9._-]{0,127}$")
_DATE_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9/_-]{0,255}$")
_SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
_RULEPACK_TOP_FIELDS = {
    "pack_name",
    "pack_version",
    "frozen_at",
    "description",
    "citation_default_mapping",
    "rules",
}
_RULE_FIELDS = set(_REQUIRED_RULE_FIELDS)
_APPLIES_TO_FIELDS = {"formats", "manuscript_types", "languages", "citation_styles"}
_CITATION_MAPPING_FIELDS_V1 = {"version", "standard_ref", "map"}
_CITATION_MAPPING_FIELDS_V2 = {
    "version", "standard_ref", "map", "resolver",
}
_CITATION_MAP_ENTRY_FIELDS = {"manuscript_type", "languages", "citation_style"}
_CITATION_RESOLVER_FIELDS = {
    "id", "version", "signal_extractor_version", "thresholds",
    "style_capability_rules",
}
_CITATION_THRESHOLD_FIELDS = {
    "strong_min_unique",
    "moderate_min_unique",
    "strong_min_coverage_percent",
    "moderate_min_coverage_percent",
}
_STANDARDS_TOP_FIELDS = {"schema_version", "registry_version", "updated_at", "standards"}
_CHANGE_HISTORY_FIELDS = {"changed_at", "change_type", "summary"}
RULEPACK_IDENTITY_FIELDS = (
    "name",
    "version",
    "pinned",
    "sha256",
    "bundle_id",
    "release_sequence",
    "manifest_sha256",
)

_STANDARD_REQUIRED_FIELDS = (
    "standard_id",
    "title",
    "source_type",
    "official_source_url",
    "oak_resource_slug",
    "version",
    "updated_at",
    "scope",
    "summary",
    "status",
    "publisher",
    "reviewed_by",
    "copyright_use",
    "supersedes",
    "superseded_by",
    "rule_ids",
    "source_verified_at",
    "source_verification_status",
    "change_history",
)


class LoadedRulepack(dict):
    """带来源字节身份的 dict；保持旧 ``dict`` API 完全兼容。"""

    _oak_raw_sha256: str
    _oak_canonical_sha256: str
    _oak_identity: dict | None


def _canonical_json_sha256(value: object) -> str:
    raw = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _plain_rulepack(pack: dict) -> dict:
    # LoadedRulepack 的信任元数据保存在对象属性中，不进入规则定义。
    return dict(pack)


def _is_strict_semver(value: object) -> bool:
    if not isinstance(value, str) or len(value) > 128:
        return False
    match = _SEMVER_RE.fullmatch(value)
    if match is None:
        return False
    if any(int(match.group(index)) > _MAX_SAFE_INTEGER for index in (1, 2, 3)):
        return False
    prerelease = match.group(4)
    if prerelease is not None and any(
        item.isdigit() and len(item) > 1 and item.startswith("0")
        for item in prerelease.split(".")
    ):
        return False
    return True


def _compare_semver(left: str, right: str) -> int:
    left_match = _SEMVER_RE.fullmatch(left)
    right_match = _SEMVER_RE.fullmatch(right)
    if left_match is None or right_match is None:
        raise OakError("无法比较非法 SemVer")
    left_core = tuple(int(left_match.group(index)) for index in (1, 2, 3))
    right_core = tuple(int(right_match.group(index)) for index in (1, 2, 3))
    if left_core != right_core:
        return -1 if left_core < right_core else 1
    left_pre = left_match.group(4)
    right_pre = right_match.group(4)
    if left_pre is None or right_pre is None:
        if left_pre is right_pre:
            return 0
        return 1 if left_pre is None else -1
    left_parts = left_pre.split(".")
    right_parts = right_pre.split(".")
    for left_part, right_part in zip(left_parts, right_parts):
        if left_part == right_part:
            continue
        left_numeric = left_part.isdigit()
        right_numeric = right_part.isdigit()
        if left_numeric and right_numeric:
            if len(left_part) != len(right_part):
                return -1 if len(left_part) < len(right_part) else 1
            return -1 if left_part < right_part else 1
        if left_numeric != right_numeric:
            return -1 if left_numeric else 1
        return -1 if left_part < right_part else 1
    if len(left_parts) == len(right_parts):
        return 0
    return -1 if len(left_parts) < len(right_parts) else 1


def validate_rulepack_identity(
    value: object,
    *,
    allow_legacy: bool = False,
    allow_uninitialized: bool = False,
) -> str:
    """验证项目中的规则包 pin；返回 ``full|legacy|uninitialized``。"""
    if not isinstance(value, dict):
        raise OakError("项目规则包身份必须是对象。")
    name = value.get("name")
    version = value.get("version")
    pinned = value.get("pinned")
    fields = set(value)
    legacy_fields = set(RULEPACK_IDENTITY_FIELDS[:3])
    full_fields = set(RULEPACK_IDENTITY_FIELDS)
    extended_present = any(field in value for field in RULEPACK_IDENTITY_FIELDS[3:])

    if name is None and version is None and not extended_present:
        if allow_uninitialized and pinned is True and fields == legacy_fields:
            return "uninitialized"
        raise OakError("项目尚未固定规则包，拒绝继续。")
    if not isinstance(name, str) or not name or not isinstance(version, str) or not version:
        raise OakError("项目规则包名称或版本非法。")
    if pinned is not True:
        raise OakError("项目规则包必须显式标记 pinned=true。")
    if not _is_strict_semver(version):
        raise OakError(f"项目规则包版本不是严格 SemVer：{version}")

    if not extended_present:
        if allow_legacy and fields == legacy_fields:
            return "legacy"
        if fields != legacy_fields:
            raise OakError("旧项目规则包身份含未知字段，拒绝继续。")
        raise OakError("项目规则包缺少完整内容身份，拒绝继续。")

    missing = [field for field in RULEPACK_IDENTITY_FIELDS if field not in value]
    if missing:
        raise OakError(f"项目规则包身份缺少字段：{', '.join(missing)}")
    if fields != full_fields:
        raise OakError("项目规则包完整身份含未知字段，拒绝继续。")
    if not _SHA256_RE.fullmatch(str(value.get("sha256", ""))):
        raise OakError("项目规则包 sha256 非法。")
    if not _SHA256_RE.fullmatch(str(value.get("manifest_sha256", ""))):
        raise OakError("项目规则包 manifest_sha256 非法。")
    if not isinstance(value.get("bundle_id"), str) or not value["bundle_id"]:
        raise OakError("项目规则包 bundle_id 非法。")
    sequence = value.get("release_sequence")
    if (
        isinstance(sequence, bool)
        or not isinstance(sequence, int)
        or not 1 <= sequence <= _MAX_SAFE_INTEGER
    ):
        raise OakError("项目规则包 release_sequence 必须是大于等于 1 的安全整数。")
    return "full"


def attach_rulepack_identity(pack: dict, identity: dict) -> LoadedRulepack:
    """把经 release manifest 验证的身份绑定到已加载规则包。"""
    validate_rulepack_identity(identity)
    if not isinstance(pack, LoadedRulepack):
        wrapped = LoadedRulepack(pack)
        wrapped._oak_raw_sha256 = _canonical_json_sha256(pack)
        wrapped._oak_canonical_sha256 = _canonical_json_sha256(pack)
        wrapped._oak_identity = None
        pack = wrapped
    current = _canonical_json_sha256(_plain_rulepack(pack))
    if current != pack._oak_canonical_sha256:
        raise OakError("规则包在加载后被修改，拒绝绑定发布身份。")
    if pack._oak_raw_sha256 != identity["sha256"]:
        raise OakError("规则包原始字节 SHA-256 与发布身份不一致。")
    if pack._oak_identity is not None and pack._oak_identity != identity:
        raise OakError("规则包已绑定另一 release identity，拒绝重新绑定。")
    pack._oak_identity = copy.deepcopy(identity)
    return pack


def rulepack_identity(pack: dict) -> dict:
    """取得当前 pack 的完整身份，并拒绝加载后的内存篡改。"""
    if not isinstance(pack, dict):
        raise OakError("规则包必须是对象。")
    canonical = _canonical_json_sha256(_plain_rulepack(pack))
    if isinstance(pack, LoadedRulepack):
        if canonical != pack._oak_canonical_sha256:
            raise OakError("规则包内容在加载后发生变化，拒绝继续。")
        if pack._oak_identity is not None:
            validate_rulepack_identity(pack._oak_identity)
            return copy.deepcopy(pack._oak_identity)
        raw_sha256 = pack._oak_raw_sha256
    else:
        # 兼容既有直接传 dict 的内部 API/测试。CLI 与正式 APP 不走此分支。
        raw_sha256 = canonical

    name = pack.get("pack_name")
    version = pack.get("pack_version")
    if not isinstance(name, str) or not name or not isinstance(version, str) or not version:
        raise OakError("规则包缺少可识别的名称或版本。")
    descriptor = {
        "kind": "legacy-unmanaged-rulepack",
        "name": name,
        "version": version,
        "sha256": raw_sha256,
    }
    # 仅供保持旧 Python API；正式 CLI 必须由 standards_store 绑定真实 manifest。
    return {
        "name": name,
        "version": version,
        "pinned": True,
        "sha256": raw_sha256,
        "bundle_id": f"legacy-unmanaged-{name}",
        "release_sequence": 1,
        "manifest_sha256": _canonical_json_sha256(descriptor),
    }

# CJK 统一表意文字（基本区 + 扩展 A）
_CJK_RANGES = ((0x3400, 0x4DBF), (0x4E00, 0x9FFF))


def load_rulepack_bytes(raw: bytes, *, label: str = "rulepack.json") -> LoadedRulepack:
    """从已经过调用方身份校验的原始字节解析规则包。"""
    if not isinstance(raw, bytes):
        raise OakError(f"规则包原始内容必须是 bytes：{label}")
    try:
        if raw.startswith(b"\xef\xbb\xbf"):
            raise OakError(f"规则包必须是无 BOM 的 UTF-8 JSON：{label}")
        data = json.loads(raw.decode("utf-8"))
    except OakError:
        raise
    except (UnicodeError, ValueError) as exc:
        raise OakError(f"规则包不是有效的 UTF-8 JSON：{label}") from exc
    if not isinstance(data, dict):
        raise OakError(f"规则包顶层必须是对象：{label}")
    if set(data) != _RULEPACK_TOP_FIELDS:
        raise OakError(f"规则包顶层字段不符合冻结 schema：{label}")
    if not isinstance(data["pack_name"], str) or not _SAFE_PACK_ID_RE.fullmatch(
        data["pack_name"]
    ):
        raise OakError(f"规则包 pack_name 非法：{label}")
    if not _is_strict_semver(data["pack_version"]):
        raise OakError(f"规则包 pack_version 不是严格 SemVer：{label}")
    if (
        not isinstance(data["frozen_at"], str)
        or not _DATE_RE.fullmatch(data["frozen_at"])
        or not isinstance(data["description"], str)
        or not data["description"].strip()
    ):
        raise OakError(f"规则包 frozen_at 或 description 非法：{label}")
    if not isinstance(data["rules"], list) or not 1 <= len(data["rules"]) <= 1024:
        raise OakError(f"规则包 rules 必须是非空数组：{label}")
    seen: set[str] = set()
    for rule in data["rules"]:
        if not isinstance(rule, dict):
            raise OakError(f"规则包包含非对象规则：{label}")
        if set(rule) != _RULE_FIELDS:
            raise OakError(f"规则 {rule.get('rule_id', '?')} 字段不符合冻结 schema")
        for field in _REQUIRED_RULE_FIELDS:
            if field not in rule:
                raise OakError(f"规则 {rule.get('rule_id', '?')} 缺少字段「{field}」")
        if not isinstance(rule["rule_id"], str) or not _RULE_ID_RE.fullmatch(rule["rule_id"]):
            raise OakError("规则 rule_id 必须是非空字符串")
        if rule["rule_id"] in seen:
            raise OakError(f"规则包中 rule_id 重复：{rule['rule_id']}")
        seen.add(rule["rule_id"])
        if not isinstance(rule["severity"], str) or rule["severity"] not in {
            "error", "warning", "suggestion",
        }:
            raise OakError(f"规则 {rule['rule_id']} severity 非法")
        if not isinstance(rule["confidence"], str) or rule["confidence"] not in {
            "high", "medium", "low",
        }:
            raise OakError(f"规则 {rule['rule_id']} confidence 非法")
        if not isinstance(rule["milestone"], str) or rule["milestone"] not in {
            "M1", "M2", "M3",
        }:
            raise OakError(f"规则 {rule['rule_id']} milestone 非法")
        if not isinstance(rule["auto_fixable"], bool):
            raise OakError(f"规则 {rule['rule_id']} auto_fixable 必须是布尔值")
        if not isinstance(rule["standard_refs"], list) or any(
            not isinstance(ref, str) or not _STANDARD_ID_RE.fullmatch(ref)
            for ref in rule["standard_refs"]
        ):
            raise OakError(f"规则 {rule['rule_id']} standard_refs 非法")
        if len(rule["standard_refs"]) != len(set(rule["standard_refs"])):
            raise OakError(f"规则 {rule['rule_id']} standard_refs 重复")
        applies = rule["applies_to"]
        if not isinstance(applies, dict) or set(applies) != _APPLIES_TO_FIELDS:
            raise OakError(f"规则 {rule['rule_id']} applies_to 必须是对象")
        allowed_values = {
            "formats": {"docx", "md", "txt", "epub"},
            "manuscript_types": {"paper", "print_book", "ebook"},
            "languages": {"*", "zh", "en", "mixed"},
            "citation_styles": {
                "*", "gbt7714-2025", "apa-7", "chicago-18-nb",
                "chicago-18-ad", "none", "structure-only",
            },
        }
        for field in ("formats", "manuscript_types", "languages", "citation_styles"):
            values = applies.get(field)
            if not isinstance(values, list) or not values or any(
                not isinstance(value, str) or value not in allowed_values[field]
                for value in values
            ):
                raise OakError(f"规则 {rule['rule_id']} applies_to.{field} 非法")
            if len(values) != len(set(values)):
                raise OakError(f"规则 {rule['rule_id']} applies_to.{field} 重复")
        if rule["auto_fixable"] and rule["confidence"] != "high":
            raise OakError(f"规则 {rule['rule_id']} 标记可自动修复但置信度不是 high，违反白名单纪律")
        if rule["auto_fixable"] and (
            not isinstance(rule["fix_id"], str) or not rule["fix_id"]
        ):
            raise OakError(f"规则 {rule['rule_id']} 可自动修复但 fix_id 非法")
        if not rule["auto_fixable"] and rule["fix_id"] is not None:
            raise OakError(f"规则 {rule['rule_id']} 不可自动修复但仍声明 fix_id")
        if not isinstance(rule["enabled_by_default"], bool):
            raise OakError(f"规则 {rule['rule_id']} enabled_by_default 必须是布尔值")
        if not _is_strict_semver(rule["since_pack_version"]):
            raise OakError(f"规则 {rule['rule_id']} since_pack_version 非法")
        if _compare_semver(rule["since_pack_version"], data["pack_version"]) > 0:
            raise OakError(f"规则 {rule['rule_id']} since_pack_version 晚于规则包")
        for field in ("title", "explanation"):
            if not isinstance(rule[field], str) or not rule[field].strip():
                raise OakError(f"规则 {rule['rule_id']} {field} 非法")

    mapping = data["citation_default_mapping"]
    if (
        not isinstance(mapping, dict)
        or frozenset(mapping) not in {
            frozenset(_CITATION_MAPPING_FIELDS_V1),
            frozenset(_CITATION_MAPPING_FIELDS_V2),
        }
        or not _is_strict_semver(mapping.get("version"))
    ):
        raise OakError("规则包 citation_default_mapping 非法")
    if not isinstance(mapping.get("standard_ref"), str) or not _STANDARD_ID_RE.fullmatch(
        mapping["standard_ref"]
    ):
        raise OakError("规则包 citation_default_mapping.standard_ref 非法")
    if not isinstance(mapping.get("map"), list) or not mapping["map"]:
        raise OakError("规则包 citation_default_mapping.map 必须是非空数组")
    covered: set[tuple[str, str]] = set()
    mapping_types = {"paper", "print_book", "ebook"}
    mapping_languages = {"zh", "en", "mixed"}
    mapping_styles = {
        "gbt7714-2025", "apa-7", "chicago-18-nb", "chicago-18-ad", "none",
    }
    for entry in mapping["map"]:
        if not isinstance(entry, dict) or set(entry) != _CITATION_MAP_ENTRY_FIELDS:
            raise OakError("规则包 citation_default_mapping.map 条目 schema 非法")
        if (
            not isinstance(entry["manuscript_type"], str)
            or entry["manuscript_type"] not in mapping_types
        ):
            raise OakError("规则包默认体例 manuscript_type 非法")
        if not isinstance(entry["languages"], list) or not entry["languages"] or any(
            not isinstance(language, str) or language not in mapping_languages
            for language in entry["languages"]
        ):
            raise OakError("规则包默认体例 languages 非法")
        if len(entry["languages"]) != len(set(entry["languages"])):
            raise OakError("规则包默认体例 languages 重复")
        if (
            not isinstance(entry["citation_style"], str)
            or entry["citation_style"] not in mapping_styles
        ):
            raise OakError("规则包默认体例 citation_style 非法")
        for language in entry["languages"]:
            key = (entry["manuscript_type"], language)
            if key in covered:
                raise OakError("规则包默认体例映射重复覆盖")
            covered.add(key)
    expected_coverage = {
        (manuscript_type, language)
        for manuscript_type in mapping_types
        for language in mapping_languages
    }
    if covered != expected_coverage:
        raise OakError("规则包默认体例映射未完整覆盖稿件类型与语言")

    resolver = mapping.get("resolver")
    if resolver is not None:
        if not isinstance(resolver, dict) or set(resolver) != _CITATION_RESOLVER_FIELDS:
            raise OakError("规则包默认体例 resolver schema 非法")
        if (
            not isinstance(resolver.get("id"), str)
            or not _SAFE_PACK_ID_RE.fullmatch(resolver["id"])
            or not _is_strict_semver(resolver.get("version"))
            or not _is_strict_semver(resolver.get("signal_extractor_version"))
        ):
            raise OakError("规则包默认体例 resolver 身份非法")
        thresholds = resolver.get("thresholds")
        if not isinstance(thresholds, dict) or set(thresholds) != _CITATION_THRESHOLD_FIELDS:
            raise OakError("规则包默认体例 resolver thresholds schema 非法")
        if any(
            isinstance(value, bool) or not isinstance(value, int)
            for value in thresholds.values()
        ):
            raise OakError("规则包默认体例 resolver thresholds 必须是整数")
        if not (
            1 <= thresholds["moderate_min_unique"]
            <= thresholds["strong_min_unique"] <= 1000
            and 1 <= thresholds["moderate_min_coverage_percent"]
            <= thresholds["strong_min_coverage_percent"] <= 100
        ):
            raise OakError("规则包默认体例 resolver thresholds 次序或范围非法")

        capability_rules = resolver.get("style_capability_rules")
        expected_styles = mapping_styles - {"none"}
        if not isinstance(capability_rules, dict) or set(capability_rules) != expected_styles:
            raise OakError("规则包默认体例 resolver style_capability_rules schema 非法")
        rule_defs = {rule["rule_id"]: rule for rule in data["rules"]}
        for style, rule_ids in capability_rules.items():
            if (
                not isinstance(rule_ids, list)
                or not rule_ids
                or len(rule_ids) != len(set(rule_ids))
                or any(not isinstance(rule_id, str) or rule_id not in seen for rule_id in rule_ids)
            ):
                raise OakError(f"默认体例 {style} 的能力规则列表非法")
            if any(
                style not in rule_defs[rule_id]["applies_to"]["citation_styles"]
                for rule_id in rule_ids
            ):
                raise OakError(f"默认体例 {style} 的能力规则未声明该体例")

    loaded = LoadedRulepack(data)
    loaded._oak_raw_sha256 = hashlib.sha256(raw).hexdigest()
    loaded._oak_canonical_sha256 = _canonical_json_sha256(data)
    loaded._oak_identity = None
    return loaded


def load_rulepack(path: Path | str) -> LoadedRulepack:
    path = Path(path)
    if not path.is_file():
        raise OakError(f"规则包文件不存在：{path.name}")
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise OakError(f"无法读取规则包文件：{path.name}") from exc
    return load_rulepack_bytes(raw, label=path.name)


def load_standards_bytes(raw: bytes, *, label: str = "standards.json") -> dict:
    """从已经过调用方身份校验的原始字节解析标准注册表。"""
    if not isinstance(raw, bytes):
        raise OakError(f"标准注册表原始内容必须是 bytes：{label}")
    if raw.startswith(b"\xef\xbb\xbf"):
        raise OakError(f"标准注册表必须是无 BOM 的 UTF-8 JSON：{label}")
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise OakError(f"标准注册表不是有效的 UTF-8 JSON：{label}") from exc
    if (
        not isinstance(data, dict)
        or set(data) != _STANDARDS_TOP_FIELDS
        or data.get("schema_version") != "2.0"
    ):
        raise OakError("标准注册表必须使用 schema_version 2.0")
    if not _is_strict_semver(data.get("registry_version")):
        raise OakError("标准注册表 registry_version 必须是严格 SemVer")
    if not isinstance(data.get("updated_at"), str) or not _DATE_RE.fullmatch(
        data["updated_at"]
    ):
        raise OakError("标准注册表 updated_at 非法")
    if (
        not isinstance(data.get("standards"), list)
        or not 1 <= len(data["standards"]) <= 1024
    ):
        raise OakError("标准注册表 standards 必须是非空数组")
    seen: set[str] = set()
    for standard in data["standards"]:
        if not isinstance(standard, dict):
            raise OakError("标准注册表包含非对象条目")
        if set(standard) != set(_STANDARD_REQUIRED_FIELDS):
            raise OakError(
                f"标准 {standard.get('standard_id', '?')} 字段不符合 schema_version 2.0"
            )
        standard_id = standard["standard_id"]
        if not isinstance(standard_id, str) or not _STANDARD_ID_RE.fullmatch(standard_id):
            raise OakError("标准 standard_id 必须是非空字符串")
        if standard_id in seen:
            raise OakError(f"标准注册表 standard_id 重复：{standard_id}")
        seen.add(standard_id)
        if not isinstance(standard["status"], str) or standard["status"] not in {
            "active", "superseded", "under_review", "deprecated",
        }:
            raise OakError(f"标准 {standard_id} status 非法")
        if not isinstance(standard["source_type"], str) or standard["source_type"] not in {
            "official", "technical_spec", "oak_interpretation",
        }:
            raise OakError(f"标准 {standard_id} source_type 非法")
        if not isinstance(standard["copyright_use"], str) or standard["copyright_use"] not in {
            "metadata_only", "short_excerpt", "open_license"
        }:
            raise OakError(f"标准 {standard_id} copyright_use 非法")
        if (
            not isinstance(standard["source_verification_status"], str)
            or standard["source_verification_status"] not in {
            "verified", "pending", "unavailable"
            }
        ):
            raise OakError(f"标准 {standard_id} source_verification_status 非法")
        for field in ("reviewed_by", "supersedes", "rule_ids", "change_history"):
            if not isinstance(standard[field], list):
                raise OakError(f"标准 {standard_id} {field} 必须是数组")
        if not standard["reviewed_by"] or any(
            not isinstance(item, str) or not item.strip() for item in standard["reviewed_by"]
        ):
            raise OakError(f"标准 {standard_id} reviewed_by 非法")
        if len(standard["reviewed_by"]) != len(set(standard["reviewed_by"])):
            raise OakError(f"标准 {standard_id} reviewed_by 重复")
        if any(
            not isinstance(item, str) or not _STANDARD_ID_RE.fullmatch(item)
            for item in standard["supersedes"]
        ):
            raise OakError(f"标准 {standard_id} supersedes 非法")
        if len(standard["supersedes"]) != len(set(standard["supersedes"])):
            raise OakError(f"标准 {standard_id} supersedes 重复")
        if any(
            not isinstance(item, str) or not _RULE_ID_RE.fullmatch(item)
            for item in standard["rule_ids"]
        ):
            raise OakError(f"标准 {standard_id} rule_ids 非法")
        if len(standard["rule_ids"]) != len(set(standard["rule_ids"])):
            raise OakError(f"标准 {standard_id} rule_ids 重复")
        if standard["superseded_by"] is not None and (
            not isinstance(standard["superseded_by"], str)
            or not _STANDARD_ID_RE.fullmatch(standard["superseded_by"])
        ):
            raise OakError(f"标准 {standard_id} superseded_by 非法")
        if standard["status"] == "superseded" and standard["superseded_by"] is None:
            raise OakError(f"标准 {standard_id} 已 superseded 但缺少 superseded_by")
        if standard["source_verified_at"] is not None and (
            not isinstance(standard["source_verified_at"], str)
            or not _DATE_RE.fullmatch(standard["source_verified_at"])
        ):
            raise OakError(f"标准 {standard_id} source_verified_at 非法")
        if (
            standard["source_verification_status"] == "verified"
            and standard["source_verified_at"] is None
        ):
            raise OakError(f"标准 {standard_id} 声明 verified 但没有核验日期")
        if not isinstance(standard["updated_at"], str) or not _DATE_RE.fullmatch(
            standard["updated_at"]
        ):
            raise OakError(f"标准 {standard_id} updated_at 非法")
        if not isinstance(standard["oak_resource_slug"], str) or not _SLUG_RE.fullmatch(
            standard["oak_resource_slug"]
        ):
            raise OakError(f"标准 {standard_id} oak_resource_slug 非法")
        for field in ("title", "version", "scope", "summary", "publisher"):
            if not isinstance(standard[field], str) or not standard[field].strip():
                raise OakError(f"标准 {standard_id} {field} 必须是非空字符串")
        if re.search(r"(?:placeholder|待补充|占位|TODO)", standard["summary"], re.I):
            raise OakError(f"标准 {standard_id} summary 仍含占位内容")
        official_url = standard["official_source_url"]
        if not isinstance(official_url, str):
            raise OakError(f"标准 {standard_id} official_source_url 非法")
        if official_url:
            try:
                parsed_url = urlsplit(official_url)
            except ValueError as exc:
                raise OakError(f"标准 {standard_id} official_source_url 非法") from exc
            if (
                parsed_url.scheme != "https"
                or not parsed_url.netloc
                or parsed_url.username is not None
                or parsed_url.password is not None
            ):
                raise OakError(f"标准 {standard_id} official_source_url 必须是无凭据 HTTPS")
        elif standard["source_type"] != "oak_interpretation" and not (
            standard["status"] == "under_review"
            and standard["source_verification_status"] == "unavailable"
        ):
            raise OakError(f"标准 {standard_id} 缺少外部官方来源且未标为不可核验")
        if not 1 <= len(standard["change_history"]) <= 128:
            raise OakError(f"标准 {standard_id} change_history 数量非法")
        for change in standard["change_history"]:
            if not isinstance(change, dict) or set(change) != _CHANGE_HISTORY_FIELDS:
                raise OakError(f"标准 {standard_id} change_history 条目 schema 非法")
            if any(
                not isinstance(change[field], str) or not change[field].strip()
                for field in _CHANGE_HISTORY_FIELDS
            ):
                raise OakError(f"标准 {standard_id} change_history 条目非法")
            if not _DATE_RE.fullmatch(change["changed_at"]):
                raise OakError(f"标准 {standard_id} change_history 日期非法")
    entries = {standard["standard_id"]: standard for standard in data["standards"]}
    for standard_id, standard in entries.items():
        related = [*standard["supersedes"]]
        if standard["superseded_by"] is not None:
            related.append(standard["superseded_by"])
        if any(item == standard_id or item not in entries for item in related):
            raise OakError(f"标准 {standard_id} 的替代关系引用非法")
    return data


def load_standards(path: Path | str) -> dict:
    path = Path(path)
    if not path.is_file():
        raise OakError(f"标准注册表文件不存在：{path.name}")
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise OakError(f"无法读取标准注册表文件：{path.name}") from exc
    return load_standards_bytes(raw, label=path.name)


def validate_standard_rule_mapping(standards: dict, pack: dict) -> None:
    """标准 ``rule_ids`` 与规则 ``standard_refs`` 必须双向精确一致。"""
    entries = {item["standard_id"]: item for item in standards["standards"]}
    expected: dict[str, set[str]] = {standard_id: set() for standard_id in entries}
    for rule in pack["rules"]:
        for standard_id in rule["standard_refs"]:
            if standard_id not in entries:
                raise OakError(
                    f"规则 {rule['rule_id']} 引用了未注册标准 {standard_id}"
                )
            expected[standard_id].add(rule["rule_id"])
    mapping_ref = pack["citation_default_mapping"]["standard_ref"]
    if mapping_ref not in entries:
        raise OakError(f"默认体例映射引用了未注册标准 {mapping_ref}")
    for standard_id, standard in entries.items():
        actual = set(standard["rule_ids"])
        if actual != expected[standard_id]:
            raise OakError(
                f"标准 {standard_id} 的 rule_ids 与规则 standard_refs 不一致"
            )


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
