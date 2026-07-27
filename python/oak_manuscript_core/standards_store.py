"""签名标准发布包的本地只读解析与项目规则包固定。

Electron/Node 负责验签和原子安装；本模块不信任安装状态中的任何“已验证”
布尔值，而是在每次使用前重新验证：

* ``active.json`` 的严格 schema；
* CAS 目录名与 ``manifest.json`` 原始字节 SHA-256；
* ``standards.json`` / ``rulepack.json`` 的大小与 SHA-256；
* 受应用保护的 capability set；
* APP 兼容范围、撤回清单及项目完整 pin。

更新包路径由 ``OAK_STANDARDS_STORE`` 指向；没有该环境变量时，只解析随 APP
发布的 ``config/standard-packs/*.manifest.json``。所有路径都 fail-closed，拒绝
符号链接、junction/reparse、硬链接、目录逃逸和读取期间的身份变化。
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import stat
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from . import __version__
from .errors import OakError, StructuredOakError
from .rulepack import (
    LoadedRulepack,
    RULEPACK_IDENTITY_FIELDS,
    attach_rulepack_identity,
    load_rulepack,
    load_rulepack_bytes,
    load_standards_bytes,
    validate_rulepack_identity,
    validate_standard_rule_mapping,
)
from .safety import is_link_or_reparse

STORE_ENV = "OAK_STANDARDS_STORE"
EXPECTED_IDENTITY_ENV = "OAK_EXPECTED_STANDARD_IDENTITY"
ACTIVE_SCHEMA_VERSION = "1.0"
RELEASE_SCHEMA_VERSION = "1.0"
CAPABILITY_SCHEMA_VERSION = "1.0"
_RESOURCES_ROOT = Path(__file__).resolve().parents[2]
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_BUNDLE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
_RFC3339_UTC_RE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$"
)
_SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
_MAX_JSON_BYTES = 16 * 1024 * 1024
_MAX_MANIFESTS = 256
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024
_MAX_TOTAL_PAYLOAD_BYTES = 12 * 1024 * 1024
_MAX_ENVELOPE_BYTES = 24 * 1024 * 1024
_MAX_EXPECTED_IDENTITY_BYTES = 4096

_RELEASE_ENVELOPE_KIND = "oak-standards-envelope"
_BUNDLED_ENVELOPE_KIND = "oak-standards-bundled-envelope"
_ENVELOPE_SCHEMA_VERSION = "1.0"
_RELEASE_ENVELOPE_FIELDS = {
    "schema_version", "kind", "manifest_b64", "signatures", "files",
}
_BUNDLED_ENVELOPE_FIELDS = {
    "schema_version", "kind", "manifest_b64", "files",
}
_ENVELOPE_FILE_FIELDS = {"path", "payload_b64"}
_ENVELOPE_SIGNATURE_FIELDS = {"keyid", "alg", "sig_b64"}

# Bundled envelopes are not signed as update releases.  A historical bundled
# package copied into the mutable CAS is trusted only when its manifest digest
# remains anchored in application code.  Every formal APP release that changes
# the bundled standard must retain still-supported historical digests here.
# The exact expected identity supplied by the already-verifying Electron main
# process is also accepted for the command it launches (see EXPECTED_IDENTITY_ENV).
TRUSTED_BUNDLED_MANIFEST_SHA256S = frozenset(
    {
        "d33534f081b2122a90652ee03304a0e71177a7fd0d3130fffe77b0fea807d7af",
    }
)

_MANIFEST_FIELDS = {
    "schema_version",
    "kind",
    "bundle_id",
    "release_sequence",
    "version",
    "channel",
    "released_at",
    "expires_at",
    "min_app",
    "max_app_exclusive",
    "signing_role",
    "files",
    "rulepack",
    "rollback_target",
    "change_summary",
}
_FILE_FIELDS = {"path", "size_bytes", "sha256", "media_type"}
_RULEPACK_FIELDS = {
    "name", "version", "sha256", "capability_set_sha256",
}
_ROLLBACK_FIELDS = {"manifest_sha256", "release_sequence"}
_ACTIVE_FIELDS = {
    "schema_version",
    "active",
    "previous",
    "highest_seen_sequence",
    "revoked_manifest_sha256s",
}
_ACTIVE_REF_FIELDS = {
    "bundle_id", "release_sequence", "version", "manifest_sha256", "source",
}
_CAPABILITY_FIELDS = {"schema_version", "pack_name", "capabilities"}
_CAPABILITY_ENTRY_FIELDS = {"rule_id", "milestone", "auto_fixable", "fix_id"}


@dataclass(frozen=True)
class ResolvedStandardRelease:
    manifest: dict
    manifest_sha256: str
    standards: dict
    rulepack: LoadedRulepack
    identity: dict
    source: str
    release_root: Path


def _failure(code: str, message: str, **details) -> StructuredOakError:
    return StructuredOakError(
        message,
        code=code,
        retryable=False,
        details=details,
    )


def _is_positive_int(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 1 <= value <= _MAX_SAFE_INTEGER
    )


def _is_nonnegative_int(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value <= _MAX_SAFE_INTEGER
    )


def _parse_semver(value: object, label: str) -> tuple[int, int, int, tuple[str, ...] | None]:
    if not isinstance(value, str) or len(value) > 128:
        raise _failure("STANDARD_RELEASE_INVALID", f"{label} 必须是严格 SemVer。")
    match = _SEMVER_RE.fullmatch(value)
    if match is None:
        raise _failure("STANDARD_RELEASE_INVALID", f"{label} 不是严格 SemVer：{value}")
    prerelease = match.group(4)
    identifiers = tuple(prerelease.split(".")) if prerelease is not None else None
    if identifiers is not None:
        for item in identifiers:
            if item.isdigit() and len(item) > 1 and item.startswith("0"):
                raise _failure("STANDARD_RELEASE_INVALID", f"{label} 的预发布数字含前导零：{value}")
    core = tuple(int(match.group(index)) for index in (1, 2, 3))
    if any(component > _MAX_SAFE_INTEGER for component in core):
        raise _failure(
            "STANDARD_RELEASE_INVALID",
            f"{label} 的 major/minor/patch 超过跨运行时安全整数上限。",
        )
    return core[0], core[1], core[2], identifiers


def _compare_semver(left: str, right: str) -> int:
    l_major, l_minor, l_patch, l_pre = _parse_semver(left, "版本")
    r_major, r_minor, r_patch, r_pre = _parse_semver(right, "版本")
    l_core = (l_major, l_minor, l_patch)
    r_core = (r_major, r_minor, r_patch)
    if l_core != r_core:
        return -1 if l_core < r_core else 1
    if l_pre is None or r_pre is None:
        if l_pre is r_pre:
            return 0
        return 1 if l_pre is None else -1
    for l_item, r_item in zip(l_pre, r_pre):
        if l_item == r_item:
            continue
        l_numeric = l_item.isdigit()
        r_numeric = r_item.isdigit()
        if l_numeric and r_numeric:
            return -1 if int(l_item) < int(r_item) else 1
        if l_numeric != r_numeric:
            return -1 if l_numeric else 1
        return -1 if l_item < r_item else 1
    if len(l_pre) == len(r_pre):
        return 0
    return -1 if len(l_pre) < len(r_pre) else 1


def _parse_z_time(value: object, label: str, *, nullable: bool = False) -> datetime | None:
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not _RFC3339_UTC_RE.fullmatch(value):
        raise _failure("STANDARD_RELEASE_INVALID", f"{label} 必须是 UTC ISO-8601（Z）。")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise _failure("STANDARD_RELEASE_INVALID", f"{label} 不是有效时间。") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise _failure("STANDARD_RELEASE_INVALID", f"{label} 必须使用 UTC。")
    return parsed


def _safe_directory(path: Path, label: str) -> Path:
    lexical = path.absolute()
    chain = list(reversed((lexical, *lexical.parents)))
    for item in chain:
        if not os.path.lexists(item):
            continue
        try:
            info = os.lstat(item)
        except OSError as exc:
            raise _failure("STANDARD_STORE_UNSAFE", f"{label}父链无法安全读取：{item}") from exc
        if is_link_or_reparse(item) or not stat.S_ISDIR(info.st_mode):
            raise _failure(
                "STANDARD_STORE_UNSAFE",
                f"{label}父链含链接、junction/reparse 或非常规目录：{item}",
            )
    if not os.path.lexists(lexical):
        raise _failure("STANDARD_STORE_MISSING", f"{label}不存在：{lexical}")
    try:
        return lexical.resolve(strict=True)
    except OSError as exc:
        raise _failure("STANDARD_STORE_UNSAFE", f"{label}无法安全解析：{lexical}") from exc


def _safe_read_file(
    path: Path,
    *,
    parent: Path,
    label: str,
    max_bytes: int = _MAX_JSON_BYTES,
    require_nonempty: bool = True,
) -> bytes:
    if path.parent != parent:
        raise _failure("STANDARD_STORE_UNSAFE", f"{label}不在预期目录中。")
    if not os.path.lexists(path):
        raise _failure("STANDARD_STORE_MISSING", f"{label}缺失：{path.name}")
    try:
        before = os.lstat(path)
    except OSError as exc:
        raise _failure("STANDARD_STORE_UNSAFE", f"{label}无法安全读取：{path.name}") from exc
    if (
        is_link_or_reparse(path)
        or not stat.S_ISREG(before.st_mode)
        or getattr(before, "st_nlink", 1) != 1
    ):
        raise _failure(
            "STANDARD_STORE_UNSAFE",
            f"{label}必须是单链接常规文件：{path.name}",
        )
    if before.st_size > max_bytes or (require_nonempty and before.st_size <= 0):
        raise _failure("STANDARD_RELEASE_INVALID", f"{label}大小非法：{path.name}")
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise _failure("STANDARD_STORE_UNSAFE", f"{label}无法安全解析：{path.name}") from exc
    if resolved.parent != parent or resolved.name != path.name:
        raise _failure("STANDARD_STORE_UNSAFE", f"{label}路径逃逸：{path.name}")

    try:
        with open(path, "rb") as stream:
            opened = os.fstat(stream.fileno())
            if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
                raise _failure("STANDARD_STORE_CHANGED", f"{label}在打开期间发生变化。")
            payload = stream.read(max_bytes + 1)
            after_fd = os.fstat(stream.fileno())
    except StructuredOakError:
        raise
    except OSError as exc:
        raise _failure("STANDARD_STORE_UNSAFE", f"{label}读取失败：{path.name}") from exc
    if len(payload) > max_bytes or (require_nonempty and not payload):
        raise _failure("STANDARD_RELEASE_INVALID", f"{label}超过允许大小或为空。")
    try:
        after_path = os.lstat(path)
    except OSError as exc:
        raise _failure("STANDARD_STORE_CHANGED", f"{label}读取后消失。") from exc
    identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    identity_fd = (after_fd.st_dev, after_fd.st_ino, after_fd.st_size, after_fd.st_mtime_ns)
    identity_path = (
        after_path.st_dev,
        after_path.st_ino,
        after_path.st_size,
        after_path.st_mtime_ns,
    )
    if identity_before != identity_fd or identity_before != identity_path:
        raise _failure("STANDARD_STORE_CHANGED", f"{label}在读取期间发生变化。")
    return payload


def _decode_json(raw: bytes, label: str) -> dict:
    if raw.startswith(b"\xef\xbb\xbf"):
        raise _failure("STANDARD_RELEASE_INVALID", f"{label}不得包含 UTF-8 BOM。")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise _failure("STANDARD_RELEASE_INVALID", f"{label}不是有效 UTF-8 JSON。") from exc
    if not isinstance(value, dict):
        raise _failure("STANDARD_RELEASE_INVALID", f"{label}顶层必须是对象。")
    return value


def _strict_fields(value: dict, expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise _failure(
            "STANDARD_RELEASE_INVALID",
            f"{label}字段不符合 schema（缺少 {missing}；多余 {extra}）。",
        )


def _expected_standard_identity() -> dict | None:
    """解析 Electron main 为单次 Python 调用注入的完整身份。"""
    raw = os.environ.get(EXPECTED_IDENTITY_ENV)
    if raw in (None, ""):
        return None
    try:
        encoded = raw.encode("utf-8")
    except UnicodeError as exc:  # pragma: no cover - Python 环境字符串通常已是 Unicode
        raise _failure(
            "EXPECTED_STANDARD_IDENTITY_INVALID",
            f"{EXPECTED_IDENTITY_ENV} 不是有效 UTF-8。",
        ) from exc
    if len(encoded) > _MAX_EXPECTED_IDENTITY_BYTES or raw.startswith("\ufeff"):
        raise _failure(
            "EXPECTED_STANDARD_IDENTITY_INVALID",
            f"{EXPECTED_IDENTITY_ENV} 大小非法或含 BOM。",
        )
    try:
        value = json.loads(raw)
    except ValueError as exc:
        raise _failure(
            "EXPECTED_STANDARD_IDENTITY_INVALID",
            f"{EXPECTED_IDENTITY_ENV} 不是有效 JSON 对象。",
        ) from exc
    if not isinstance(value, dict) or set(value) != set(RULEPACK_IDENTITY_FIELDS):
        raise _failure(
            "EXPECTED_STANDARD_IDENTITY_INVALID",
            f"{EXPECTED_IDENTITY_ENV} 必须精确包含规则包身份的 7 个字段。",
        )
    try:
        validate_rulepack_identity(value)
    except OakError as exc:
        raise _failure(
            "EXPECTED_STANDARD_IDENTITY_INVALID",
            f"{EXPECTED_IDENTITY_ENV} 身份非法：{exc.message}",
        ) from exc
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    if raw != canonical:
        raise _failure(
            "EXPECTED_STANDARD_IDENTITY_INVALID",
            f"{EXPECTED_IDENTITY_ENV} 必须是 canonical JSON（无空白、键排序固定）。",
        )
    return value


def assert_expected_standard_identity(identity: dict) -> None:
    """若 main 注入 expected identity，则与本进程实际身份逐字段比较。"""
    expected = _expected_standard_identity()
    if expected is not None and identity != expected:
        raise _failure(
            "EXPECTED_STANDARD_IDENTITY_MISMATCH",
            "Electron 已验签标准身份与 Python 实际解析身份不一致，拒绝继续。",
            expected=expected,
            actual=identity,
        )


def _assert_expected_standard_identity(
    release: ResolvedStandardRelease,
) -> ResolvedStandardRelease:
    assert_expected_standard_identity(release.identity)
    return release


def _trusted_bundled_manifest_sha256s() -> frozenset[str]:
    trusted = set(TRUSTED_BUNDLED_MANIFEST_SHA256S)
    # 对实际业务命令，Electron 已对 expected identity 对应的精确 CAS package
    # 完成验签。允许该 digest 作为本次 spawn 的附加锚；status 探测不注入该
    # 环境变量，仍只能依赖代码保留的历史 allowlist。
    expected = _expected_standard_identity()
    if expected is not None:
        trusted.add(expected["manifest_sha256"])
    return frozenset(trusted)


def _strict_base64(value: object, label: str, *, max_bytes: int) -> bytes:
    if not isinstance(value, str) or not value or len(value) > max_bytes * 2:
        raise _failure("STANDARD_RELEASE_INVALID", f"{label} 不是大小受限的 Base64 字符串。")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise _failure("STANDARD_RELEASE_INVALID", f"{label} 不是严格 Base64。") from exc
    if len(raw) > max_bytes or base64.b64encode(raw).decode("ascii") != value:
        raise _failure("STANDARD_RELEASE_INVALID", f"{label} 不是 canonical Base64。")
    return raw


def _validate_cas_envelope(
    raw: bytes,
    *,
    manifest_raw: bytes,
    standards_raw: bytes,
    rulepack_raw: bytes,
    manifest_sha256: str,
) -> str:
    """验证 CAS envelope 的类型与内嵌字节，返回 bundled|installed。"""
    envelope = _decode_json(raw, "release.envelope.json")
    kind = envelope.get("kind")
    if kind == _RELEASE_ENVELOPE_KIND:
        _strict_fields(envelope, _RELEASE_ENVELOPE_FIELDS, "release envelope")
        source = "installed"
    elif kind == _BUNDLED_ENVELOPE_KIND:
        _strict_fields(envelope, _BUNDLED_ENVELOPE_FIELDS, "bundled envelope")
        source = "bundled"
        canonical = (
            json.dumps(envelope, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            + "\n"
        ).encode("utf-8")
        if raw != canonical:
            raise _failure(
                "STANDARD_RELEASE_INVALID",
                "bundled release.envelope.json 必须是 canonical UTF-8 + LF。",
            )
        if manifest_sha256 not in _trusted_bundled_manifest_sha256s():
            raise _failure(
                "STANDARD_BUNDLED_TRUST_MISSING",
                "历史 bundled 标准包摘要不在 APP 代码信任清单中。",
                manifest_sha256=manifest_sha256,
            )
    else:
        raise _failure(
            "STANDARD_RELEASE_INVALID",
            "release.envelope.json kind 未知，拒绝猜测 package 来源。",
        )

    if envelope.get("schema_version") != _ENVELOPE_SCHEMA_VERSION:
        raise _failure("STANDARD_RELEASE_INVALID", "release envelope schema_version 不受支持。")
    embedded_manifest = _strict_base64(
        envelope.get("manifest_b64"),
        "release envelope.manifest_b64",
        max_bytes=_MAX_JSON_BYTES,
    )
    if embedded_manifest != manifest_raw:
        raise _failure("STANDARD_MANIFEST_TAMPERED", "CAS manifest 与 envelope 内嵌字节不一致。")

    files = envelope.get("files")
    expected_payloads = (
        ("standards.json", standards_raw),
        ("rulepack.json", rulepack_raw),
    )
    if not isinstance(files, list) or len(files) != len(expected_payloads):
        raise _failure("STANDARD_RELEASE_INVALID", "release envelope.files 必须精确包含两个 payload。")
    for index, (expected_path, expected_raw) in enumerate(expected_payloads):
        item = files[index]
        if not isinstance(item, dict):
            raise _failure("STANDARD_RELEASE_INVALID", "release envelope.files 条目必须是对象。")
        _strict_fields(item, _ENVELOPE_FILE_FIELDS, "release envelope.files 条目")
        if item.get("path") != expected_path:
            raise _failure("STANDARD_RELEASE_INVALID", "release envelope.files 顺序或路径非法。")
        embedded = _strict_base64(
            item.get("payload_b64"),
            f"release envelope {expected_path}",
            max_bytes=_MAX_PAYLOAD_BYTES,
        )
        if embedded != expected_raw:
            raise _failure(
                "STANDARD_PAYLOAD_TAMPERED",
                f"CAS {expected_path} 与 envelope 内嵌字节不一致。",
            )

    if source == "installed":
        signatures = envelope.get("signatures")
        if not isinstance(signatures, list) or not signatures or len(signatures) > 32:
            raise _failure("STANDARD_RELEASE_INVALID", "release envelope.signatures 数量非法。")
        seen: set[str] = set()
        for signature in signatures:
            if not isinstance(signature, dict):
                raise _failure("STANDARD_RELEASE_INVALID", "release envelope signature 必须是对象。")
            _strict_fields(signature, _ENVELOPE_SIGNATURE_FIELDS, "release envelope signature")
            keyid = signature.get("keyid")
            if not isinstance(keyid, str) or not _SHA256_RE.fullmatch(keyid) or keyid in seen:
                raise _failure("STANDARD_RELEASE_INVALID", "release envelope signature keyid 非法或重复。")
            seen.add(keyid)
            if signature.get("alg") != "ed25519":
                raise _failure("STANDARD_RELEASE_INVALID", "release envelope signature alg 必须是 ed25519。")
            signature_raw = _strict_base64(
                signature.get("sig_b64"),
                "release envelope signature",
                max_bytes=64,
            )
            if len(signature_raw) != 64:
                raise _failure("STANDARD_RELEASE_INVALID", "Ed25519 signature 必须是 64 字节。")
    return source


def _validate_manifest(
    manifest: dict,
    *,
    source: str,
    app_version: str,
    now: datetime,
    enforce_compatibility: bool = True,
    enforce_expiry: bool = True,
) -> dict[str, dict]:
    _strict_fields(manifest, _MANIFEST_FIELDS, "release manifest")
    if manifest["schema_version"] != RELEASE_SCHEMA_VERSION:
        raise _failure("STANDARD_RELEASE_INVALID", "release manifest schema_version 不受支持。")
    if manifest["kind"] != "oak-standard-release":
        raise _failure("STANDARD_RELEASE_INVALID", "release manifest kind 非法。")
    if not isinstance(manifest["bundle_id"], str) or not _BUNDLE_ID_RE.fullmatch(
        manifest["bundle_id"]
    ):
        raise _failure("STANDARD_RELEASE_INVALID", "release manifest bundle_id 非法。")
    if not _is_positive_int(manifest["release_sequence"]):
        raise _failure("STANDARD_RELEASE_INVALID", "release_sequence 必须是大于等于 1 的整数。")
    _parse_semver(manifest["version"], "release manifest version")
    if manifest["channel"] != "stable":
        raise _failure("STANDARD_RELEASE_INVALID", "首版只接受 stable 标准发布。")
    released_at = _parse_z_time(manifest["released_at"], "released_at")
    if released_at > now:
        raise _failure("STANDARD_RELEASE_NOT_YET_VALID", "标准发布尚未到 released_at。")
    expires_at = _parse_z_time(manifest["expires_at"], "expires_at", nullable=True)
    if expires_at is not None and expires_at <= released_at:
        raise _failure("STANDARD_RELEASE_INVALID", "expires_at 必须晚于 released_at。")
    if enforce_expiry and expires_at is not None and now >= expires_at:
        raise _failure("STANDARD_RELEASE_EXPIRED", "标准发布 manifest 已过期，拒绝用于新检查。")
    _parse_semver(manifest["min_app"], "min_app")
    _parse_semver(manifest["max_app_exclusive"], "max_app_exclusive")
    if _compare_semver(manifest["min_app"], manifest["max_app_exclusive"]) >= 0:
        raise _failure("STANDARD_RELEASE_INVALID", "APP 兼容版本范围为空或反向。")
    _parse_semver(app_version, "当前 APP 版本")
    if enforce_compatibility and (
        _compare_semver(app_version, manifest["min_app"]) < 0
        or _compare_semver(app_version, manifest["max_app_exclusive"]) >= 0
    ):
        raise _failure(
            "STANDARD_RELEASE_INCOMPATIBLE",
            f"标准包 {manifest['version']} 不兼容当前 APP {app_version}。",
        )
    expected_role = "bundled" if source == "bundled" else "release"
    if manifest["signing_role"] != expected_role:
        raise _failure(
            "STANDARD_RELEASE_INVALID",
            f"{source} 标准包 signing_role 必须是 {expected_role}。",
        )

    files = manifest["files"]
    if not isinstance(files, list) or len(files) != 2:
        raise _failure("STANDARD_RELEASE_INVALID", "files 必须精确列出两个 payload。")
    indexed: dict[str, dict] = {}
    expected_paths = ("standards.json", "rulepack.json")
    total_size = 0
    for index, item in enumerate(files):
        if not isinstance(item, dict):
            raise _failure("STANDARD_RELEASE_INVALID", "files 条目必须是对象。")
        _strict_fields(item, _FILE_FIELDS, "files 条目")
        path = item["path"]
        if path != expected_paths[index] or path in indexed:
            raise _failure(
                "STANDARD_RELEASE_INVALID",
                "files 必须按 standards.json、rulepack.json 的顺序精确列出。",
            )
        if (
            not _is_positive_int(item["size_bytes"])
            or item["size_bytes"] > _MAX_PAYLOAD_BYTES
        ):
            raise _failure("STANDARD_RELEASE_INVALID", f"{path} size_bytes 非法。")
        if not isinstance(item["sha256"], str) or not _SHA256_RE.fullmatch(item["sha256"]):
            raise _failure("STANDARD_RELEASE_INVALID", f"{path} sha256 非法。")
        if item["media_type"] != "application/json":
            raise _failure("STANDARD_RELEASE_INVALID", f"{path} media_type 必须是 application/json。")
        indexed[path] = item
        total_size += item["size_bytes"]
    if set(indexed) != {"standards.json", "rulepack.json"}:
        raise _failure("STANDARD_RELEASE_INVALID", "files payload 集合不完整。")
    if total_size > _MAX_TOTAL_PAYLOAD_BYTES:
        raise _failure("STANDARD_RELEASE_INVALID", "manifest payload 总大小超过上限。")

    rulepack = manifest["rulepack"]
    if not isinstance(rulepack, dict):
        raise _failure("STANDARD_RELEASE_INVALID", "manifest.rulepack 必须是对象。")
    _strict_fields(rulepack, _RULEPACK_FIELDS, "manifest.rulepack")
    if not isinstance(rulepack["name"], str) or not _BUNDLE_ID_RE.fullmatch(
        rulepack["name"]
    ):
        raise _failure("STANDARD_RELEASE_INVALID", "manifest.rulepack.name 非法。")
    _parse_semver(rulepack["version"], "manifest.rulepack.version")
    for field in ("sha256", "capability_set_sha256"):
        if not isinstance(rulepack[field], str) or not _SHA256_RE.fullmatch(rulepack[field]):
            raise _failure("STANDARD_RELEASE_INVALID", f"manifest.rulepack.{field} 非法。")
    if rulepack["version"] != manifest["version"]:
        raise _failure("STANDARD_RELEASE_INVALID", "release version 与 rulepack version 不一致。")
    if rulepack["sha256"] != indexed["rulepack.json"]["sha256"]:
        raise _failure("STANDARD_RELEASE_INVALID", "rulepack SHA-256 在 manifest 内自相矛盾。")

    rollback = manifest["rollback_target"]
    if rollback is not None:
        if not isinstance(rollback, dict):
            raise _failure("STANDARD_RELEASE_INVALID", "rollback_target 必须是对象或 null。")
        _strict_fields(rollback, _ROLLBACK_FIELDS, "rollback_target")
        if not isinstance(rollback["manifest_sha256"], str) or not _SHA256_RE.fullmatch(
            rollback["manifest_sha256"]
        ):
            raise _failure("STANDARD_RELEASE_INVALID", "rollback_target.manifest_sha256 非法。")
        if not _is_positive_int(rollback["release_sequence"]):
            raise _failure("STANDARD_RELEASE_INVALID", "rollback_target.release_sequence 非法。")
        if rollback["release_sequence"] >= manifest["release_sequence"]:
            raise _failure("STANDARD_RELEASE_INVALID", "rollback_target 必须指向更早 release_sequence。")

    summary = manifest["change_summary"]
    if not isinstance(summary, list) or not summary or len(summary) > 128 or any(
        not isinstance(item, str) or not item.strip() or len(item) > 4096 for item in summary
    ):
        raise _failure("STANDARD_RELEASE_INVALID", "change_summary 必须是非空字符串数组。")
    return indexed


def _load_capabilities(config_root: Path) -> tuple[dict, str]:
    config_root = _safe_directory(config_root, "APP config 目录")
    path = config_root / "rule-capabilities.json"
    raw = _safe_read_file(path, parent=config_root, label="规则能力表")
    value = _decode_json(raw, "规则能力表")
    _strict_fields(value, _CAPABILITY_FIELDS, "规则能力表")
    if value["schema_version"] != CAPABILITY_SCHEMA_VERSION:
        raise _failure("STANDARD_CAPABILITY_INVALID", "规则能力表 schema_version 不受支持。")
    if not isinstance(value["pack_name"], str) or not value["pack_name"]:
        raise _failure("STANDARD_CAPABILITY_INVALID", "规则能力表 pack_name 非法。")
    entries = value["capabilities"]
    if not isinstance(entries, list) or not entries:
        raise _failure("STANDARD_CAPABILITY_INVALID", "规则能力表 capabilities 必须是非空数组。")
    previous = None
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise _failure("STANDARD_CAPABILITY_INVALID", "规则能力条目必须是对象。")
        _strict_fields(entry, _CAPABILITY_ENTRY_FIELDS, "规则能力条目")
        rule_id = entry["rule_id"]
        if not isinstance(rule_id, str) or not rule_id or not rule_id.isascii():
            raise _failure("STANDARD_CAPABILITY_INVALID", "规则能力 rule_id 必须是非空 ASCII。")
        if previous is not None and rule_id <= previous:
            raise _failure("STANDARD_CAPABILITY_INVALID", "规则能力必须按 ASCII rule_id 严格排序。")
        previous = rule_id
        if rule_id in seen:
            raise _failure("STANDARD_CAPABILITY_INVALID", f"规则能力重复：{rule_id}")
        seen.add(rule_id)
        if not isinstance(entry["milestone"], str) or not entry["milestone"]:
            raise _failure("STANDARD_CAPABILITY_INVALID", f"规则能力 {rule_id} milestone 非法。")
        if not isinstance(entry["auto_fixable"], bool):
            raise _failure("STANDARD_CAPABILITY_INVALID", f"规则能力 {rule_id} auto_fixable 非法。")
        if entry["fix_id"] is not None and not isinstance(entry["fix_id"], str):
            raise _failure("STANDARD_CAPABILITY_INVALID", f"规则能力 {rule_id} fix_id 非法。")

    canonical = (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode("utf-8")
    if raw != canonical:
        raise _failure("STANDARD_CAPABILITY_INVALID", "规则能力表不是冻结的 canonical UTF-8 + LF 字节。")

    # 受保护能力表也必须与本 APP 实际注册实现和机械修复白名单一致。
    from .fixes import WHITELIST
    from .rules import RULE_FUNCS

    if seen != set(RULE_FUNCS):
        raise _failure("STANDARD_CAPABILITY_INVALID", "规则能力表与本 APP 的规则实现集合不一致。")
    for entry in entries:
        if entry["auto_fixable"]:
            if entry["fix_id"] not in WHITELIST:
                raise _failure(
                    "STANDARD_CAPABILITY_INVALID",
                    f"规则能力 {entry['rule_id']} 的 fix_id 不在本 APP 白名单。",
                )
        elif entry["fix_id"] is not None:
            raise _failure(
                "STANDARD_CAPABILITY_INVALID",
                f"规则能力 {entry['rule_id']} 不可自动修复但声明了 fix_id。",
            )
    return value, hashlib.sha256(raw).hexdigest()


def _validate_pack_capabilities(pack: dict, capability_doc: dict) -> None:
    if pack["pack_name"] != capability_doc["pack_name"]:
        raise _failure("STANDARD_CAPABILITY_MISMATCH", "规则包名称与 APP 能力表不一致。")
    capabilities = {entry["rule_id"]: entry for entry in capability_doc["capabilities"]}
    for rule in pack["rules"]:
        capability = capabilities.get(rule["rule_id"])
        if capability is None:
            raise _failure(
                "STANDARD_CAPABILITY_MISMATCH",
                f"规则 {rule['rule_id']} 不在本 APP 受保护能力集合中。",
            )
        for field in ("milestone", "auto_fixable", "fix_id"):
            if rule[field] != capability[field]:
                raise _failure(
                    "STANDARD_CAPABILITY_MISMATCH",
                    f"规则 {rule['rule_id']} 的 {field} 与本 APP 能力声明不一致。",
                )


def _payload_matches(raw: bytes, record: dict, label: str) -> None:
    if len(raw) != record["size_bytes"]:
        raise _failure("STANDARD_PAYLOAD_TAMPERED", f"{label}大小与 manifest 不一致。")
    actual = hashlib.sha256(raw).hexdigest()
    if actual != record["sha256"]:
        raise _failure("STANDARD_PAYLOAD_TAMPERED", f"{label} SHA-256 与 manifest 不一致。")


def _load_release(
    *,
    manifest_path: Path,
    standards_path: Path,
    rulepack_path: Path,
    source: str | None,
    release_root: Path,
    config_root: Path,
    envelope_path: Path | None,
    expected_manifest_sha256: str | None,
    app_version: str,
    now: datetime,
    enforce_compatibility: bool = True,
    enforce_expiry: bool = True,
    enforce_capabilities: bool = True,
) -> ResolvedStandardRelease:
    manifest_parent = _safe_directory(manifest_path.parent, "标准 manifest 目录")
    manifest_raw = _safe_read_file(
        manifest_path,
        parent=manifest_parent,
        label="release manifest",
    )
    manifest_sha256 = hashlib.sha256(manifest_raw).hexdigest()
    if expected_manifest_sha256 is not None and manifest_sha256 != expected_manifest_sha256:
        raise _failure("STANDARD_MANIFEST_TAMPERED", "manifest 原始字节 SHA-256 与索引不一致。")
    standards_parent = _safe_directory(standards_path.parent, "标准 payload 目录")
    rulepack_parent = _safe_directory(rulepack_path.parent, "规则包 payload 目录")
    standards_raw = _safe_read_file(
        standards_path,
        parent=standards_parent,
        label="standards.json",
    )
    rulepack_raw = _safe_read_file(
        rulepack_path,
        parent=rulepack_parent,
        label="rulepack.json",
    )

    actual_source = source
    if envelope_path is not None:
        envelope_parent = _safe_directory(envelope_path.parent, "标准 envelope 目录")
        envelope_raw = _safe_read_file(
            envelope_path,
            parent=envelope_parent,
            label="release.envelope.json",
            max_bytes=_MAX_ENVELOPE_BYTES,
        )
        envelope_source = _validate_cas_envelope(
            envelope_raw,
            manifest_raw=manifest_raw,
            standards_raw=standards_raw,
            rulepack_raw=rulepack_raw,
            manifest_sha256=manifest_sha256,
        )
        if actual_source is not None and envelope_source != actual_source:
            raise _failure(
                "STANDARD_RELEASE_SOURCE_MISMATCH",
                "CAS envelope 类型与声明的 package source 不一致。",
                expected=actual_source,
                actual=envelope_source,
            )
        actual_source = envelope_source
    if actual_source not in {"bundled", "installed"}:
        raise _failure("STANDARD_RELEASE_INVALID", "无法确定标准包可信来源类型。")

    manifest = _decode_json(manifest_raw, "release manifest")
    file_records = _validate_manifest(
        manifest,
        source=actual_source,
        app_version=app_version,
        now=now,
        enforce_compatibility=enforce_compatibility,
        enforce_expiry=enforce_expiry,
    )
    _payload_matches(standards_raw, file_records["standards.json"], "standards.json")
    _payload_matches(rulepack_raw, file_records["rulepack.json"], "rulepack.json")

    try:
        # 解析前面已经安全读取并完成 manifest 摘要核对的同一份字节，避免在
        # 校验与解析之间再次按路径打开而留下 TOCTOU 换入窗口。
        standards = load_standards_bytes(standards_raw, label="standards.json")
        pack = load_rulepack_bytes(rulepack_raw, label="rulepack.json")
    except OakError as exc:
        raise _failure("STANDARD_RELEASE_INVALID", exc.message) from exc
    if standards["registry_version"] != manifest["version"]:
        raise _failure("STANDARD_RELEASE_INVALID", "registry_version 与 release version 不一致。")
    if pack["pack_name"] != manifest["rulepack"]["name"]:
        raise _failure("STANDARD_RELEASE_INVALID", "规则包名称与 manifest 不一致。")
    if pack["pack_version"] != manifest["rulepack"]["version"]:
        raise _failure("STANDARD_RELEASE_INVALID", "规则包版本与 manifest 不一致。")
    if hashlib.sha256(rulepack_raw).hexdigest() != manifest["rulepack"]["sha256"]:
        raise _failure("STANDARD_PAYLOAD_TAMPERED", "规则包身份与 manifest 不一致。")

    if enforce_capabilities:
        capability_doc, capability_sha256 = _load_capabilities(config_root)
        if manifest["rulepack"]["capability_set_sha256"] != capability_sha256:
            raise _failure(
                "STANDARD_CAPABILITY_MISMATCH",
                "标准包针对的 capability set 与本 APP 不一致。",
            )
        _validate_pack_capabilities(pack, capability_doc)
    validate_standard_rule_mapping(standards, pack)

    identity = {
        "name": pack["pack_name"],
        "version": pack["pack_version"],
        "pinned": True,
        "sha256": manifest["rulepack"]["sha256"],
        "bundle_id": manifest["bundle_id"],
        "release_sequence": manifest["release_sequence"],
        "manifest_sha256": manifest_sha256,
    }
    pack = attach_rulepack_identity(pack, identity)
    return ResolvedStandardRelease(
        manifest=manifest,
        manifest_sha256=manifest_sha256,
        standards=standards,
        rulepack=pack,
        identity=identity,
        source=actual_source,
        release_root=release_root,
    )


def _store_root(explicit: Path | str | None) -> Path | None:
    raw = explicit if explicit is not None else os.environ.get(STORE_ENV)
    if raw in (None, ""):
        return None
    path = Path(raw)
    if not path.is_absolute():
        raise _failure("STANDARD_STORE_UNSAFE", f"{STORE_ENV} 必须是绝对路径。")
    return _safe_directory(path, "标准存储根目录")


def _validate_active_ref(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise _failure("STANDARD_ACTIVE_INVALID", f"{label} 必须是对象。")
    _strict_fields(value, _ACTIVE_REF_FIELDS, label)
    if not isinstance(value["bundle_id"], str) or not _BUNDLE_ID_RE.fullmatch(value["bundle_id"]):
        raise _failure("STANDARD_ACTIVE_INVALID", f"{label}.bundle_id 非法。")
    if not _is_positive_int(value["release_sequence"]):
        raise _failure("STANDARD_ACTIVE_INVALID", f"{label}.release_sequence 非法。")
    _parse_semver(value["version"], f"{label}.version")
    if not isinstance(value["manifest_sha256"], str) or not _SHA256_RE.fullmatch(
        value["manifest_sha256"]
    ):
        raise _failure("STANDARD_ACTIVE_INVALID", f"{label}.manifest_sha256 非法。")
    if value["source"] not in {"bundled", "installed"}:
        raise _failure("STANDARD_ACTIVE_INVALID", f"{label}.source 非法。")
    return value


def _load_active_state(store_root: Path) -> dict:
    raw = _safe_read_file(
        store_root / "active.json",
        parent=store_root,
        label="active.json",
    )
    state = _decode_json(raw, "active.json")
    _strict_fields(state, _ACTIVE_FIELDS, "active.json")
    if state["schema_version"] != ACTIVE_SCHEMA_VERSION:
        raise _failure("STANDARD_ACTIVE_INVALID", "active.json schema_version 不受支持。")
    active = _validate_active_ref(state["active"], "active")
    previous = state["previous"]
    if previous is not None:
        _validate_active_ref(previous, "previous")
    if not _is_positive_int(state["highest_seen_sequence"]):
        raise _failure("STANDARD_ACTIVE_INVALID", "highest_seen_sequence 非法。")
    if active["release_sequence"] > state["highest_seen_sequence"]:
        raise _failure("STANDARD_ACTIVE_INVALID", "active 超过 highest_seen_sequence。")
    if previous is not None and previous["release_sequence"] > state["highest_seen_sequence"]:
        raise _failure("STANDARD_ACTIVE_INVALID", "previous 超过 highest_seen_sequence。")
    revoked = state["revoked_manifest_sha256s"]
    if not isinstance(revoked, list) or any(
        not isinstance(item, str) or not _SHA256_RE.fullmatch(item) for item in revoked
    ):
        raise _failure("STANDARD_ACTIVE_INVALID", "revoked_manifest_sha256s 非法。")
    if len(revoked) != len(set(revoked)):
        raise _failure("STANDARD_ACTIVE_INVALID", "撤回清单包含重复 manifest SHA-256。")
    if revoked != sorted(revoked):
        raise _failure("STANDARD_ACTIVE_INVALID", "撤回清单必须按 SHA-256 升序排列。")
    return state


def _bundled_manifest_paths(config_root: Path) -> list[Path]:
    manifests_root = _safe_directory(config_root / "standard-packs", "内置标准 manifest 目录")
    entries = list(manifests_root.iterdir())
    if len(entries) > _MAX_MANIFESTS:
        raise _failure("STANDARD_STORE_UNSAFE", "内置标准 manifest 数量超过上限。")
    result: list[Path] = []
    for entry in entries:
        if not entry.name.endswith(".manifest.json"):
            raise _failure("STANDARD_STORE_UNSAFE", f"内置标准 manifest 目录含未知条目：{entry.name}")
        _safe_read_file(entry, parent=manifests_root, label="内置 release manifest")
        result.append(entry)
    if not result:
        raise _failure("STANDARD_STORE_MISSING", "APP 未包含任何标准 release manifest。")
    return sorted(result, key=lambda item: item.name)


def _find_bundled_rulepack(config_root: Path, manifest: dict) -> Path:
    packs_root = _safe_directory(config_root / "rule-packs", "内置规则包目录")
    matches: list[Path] = []
    for entry in packs_root.iterdir():
        if not entry.name.endswith(".json"):
            continue
        raw = _safe_read_file(entry, parent=packs_root, label="内置规则包候选")
        if hashlib.sha256(raw).hexdigest() != manifest["rulepack"]["sha256"]:
            continue
        try:
            pack = load_rulepack(entry)
        except OakError as exc:
            raise _failure("STANDARD_RELEASE_INVALID", exc.message) from exc
        if (
            pack["pack_name"] == manifest["rulepack"]["name"]
            and pack["pack_version"] == manifest["rulepack"]["version"]
        ):
            matches.append(entry)
    if len(matches) != 1:
        raise _failure(
            "STANDARD_STORE_AMBIGUOUS",
            "内置 manifest 无法唯一映射到现有规则包文件。",
        )
    return matches[0]


def _load_bundled_by_path(
    manifest_path: Path,
    *,
    config_root: Path,
    expected_manifest_sha256: str | None,
    app_version: str,
    now: datetime,
    enforce_compatibility: bool = True,
    enforce_expiry: bool = True,
    enforce_capabilities: bool = True,
) -> ResolvedStandardRelease:
    manifest_parent = _safe_directory(manifest_path.parent, "内置标准 manifest 目录")
    raw = _safe_read_file(manifest_path, parent=manifest_parent, label="内置 release manifest")
    value = _decode_json(raw, "内置 release manifest")
    # 先做 schema 解析，才能按受控哈希映射物理 payload。
    _validate_manifest(
        value,
        source="bundled",
        app_version=app_version,
        now=now,
        enforce_compatibility=enforce_compatibility,
        enforce_expiry=enforce_expiry,
    )
    rulepack_path = _find_bundled_rulepack(config_root, value)
    first_read_sha256 = hashlib.sha256(raw).hexdigest()
    return _load_release(
        manifest_path=manifest_path,
        standards_path=config_root / "standards.json",
        rulepack_path=rulepack_path,
        source="bundled",
        release_root=config_root,
        config_root=config_root,
        envelope_path=None,
        expected_manifest_sha256=expected_manifest_sha256 or first_read_sha256,
        app_version=app_version,
        now=now,
        enforce_compatibility=enforce_compatibility,
        enforce_expiry=enforce_expiry,
        enforce_capabilities=enforce_capabilities,
    )


def _load_bundled_by_hash(
    manifest_sha256: str,
    *,
    config_root: Path,
    app_version: str,
    now: datetime,
    enforce_compatibility: bool = True,
    enforce_expiry: bool = True,
    enforce_capabilities: bool = True,
) -> ResolvedStandardRelease:
    matches: list[Path] = []
    for manifest_path in _bundled_manifest_paths(config_root):
        parent = manifest_path.parent.resolve(strict=True)
        raw = _safe_read_file(manifest_path, parent=parent, label="内置 release manifest")
        if hashlib.sha256(raw).hexdigest() == manifest_sha256:
            matches.append(manifest_path)
    if len(matches) != 1:
        raise _failure(
            "STANDARD_RELEASE_MISSING",
            f"找不到唯一的内置标准版本：{manifest_sha256}",
        )
    return _load_bundled_by_path(
        matches[0],
        config_root=config_root,
        expected_manifest_sha256=manifest_sha256,
        app_version=app_version,
        now=now,
        enforce_compatibility=enforce_compatibility,
        enforce_expiry=enforce_expiry,
        enforce_capabilities=enforce_capabilities,
    )


def _load_cas_by_hash(
    store_root: Path,
    manifest_sha256: str,
    *,
    config_root: Path,
    app_version: str,
    now: datetime,
    expected_source: str | None = None,
    enforce_compatibility: bool = True,
    enforce_expiry: bool = True,
    enforce_capabilities: bool = True,
) -> ResolvedStandardRelease:
    packages_root = _safe_directory(store_root / "packages", "标准 CAS packages 目录")
    release_root = _safe_directory(
        packages_root / manifest_sha256,
        "标准 CAS release 目录",
    )
    if release_root.parent != packages_root or release_root.name != manifest_sha256:
        raise _failure("STANDARD_STORE_UNSAFE", "标准 CAS release 目录逃逸。")
    names = {entry.name for entry in release_root.iterdir()}
    expected = {
        "manifest.json", "standards.json", "rulepack.json", "release.envelope.json",
    }
    if names != expected:
        raise _failure(
            "STANDARD_RELEASE_INVALID",
            f"标准 CAS release 文件集合非法（缺少 {sorted(expected - names)}；多余 {sorted(names - expected)}）。",
        )
    return _load_release(
        manifest_path=release_root / "manifest.json",
        standards_path=release_root / "standards.json",
        rulepack_path=release_root / "rulepack.json",
        source=expected_source,
        release_root=release_root,
        config_root=config_root,
        envelope_path=release_root / "release.envelope.json",
        expected_manifest_sha256=manifest_sha256,
        app_version=app_version,
        now=now,
        enforce_compatibility=enforce_compatibility,
        enforce_expiry=enforce_expiry,
        enforce_capabilities=enforce_capabilities,
    )


def _assert_pointer_matches(pointer: dict, release: ResolvedStandardRelease) -> None:
    expected = {
        "bundle_id": release.identity["bundle_id"],
        "release_sequence": release.identity["release_sequence"],
        "version": release.manifest["version"],
        "manifest_sha256": release.manifest_sha256,
        "source": release.source,
    }
    if pointer != expected:
        raise _failure("STANDARD_ACTIVE_INVALID", "active.json 指针与实际 release identity 不一致。")


def _assert_not_revoked(manifest_sha256: str, revoked: Iterable[str]) -> None:
    if manifest_sha256 in set(revoked):
        raise _failure(
            "STANDARD_RELEASE_REVOKED",
            "该标准/规则版本已被签名控制清单撤回，拒绝用于新检查；旧报告仍可保留。",
            manifest_sha256=manifest_sha256,
        )


def resolve_active_release(
    *,
    store_root: Path | str | None = None,
    resources_root: Path | str = _RESOURCES_ROOT,
    app_version: str = __version__,
    now: datetime | None = None,
) -> ResolvedStandardRelease:
    """解析新项目应固定的 active stable release。"""
    current_time = now or datetime.now(timezone.utc)
    root = _store_root(store_root)
    config_root = _safe_directory(Path(resources_root) / "config", "APP config 目录")
    if root is None:
        releases = [
            _load_bundled_by_path(
                path,
                config_root=config_root,
                expected_manifest_sha256=None,
                app_version=app_version,
                now=current_time,
            )
            for path in _bundled_manifest_paths(config_root)
        ]
        highest = max(release.identity["release_sequence"] for release in releases)
        winners = [release for release in releases if release.identity["release_sequence"] == highest]
        if len(winners) != 1:
            raise _failure("STANDARD_STORE_AMBIGUOUS", "内置 active release_sequence 不唯一。")
        return _assert_expected_standard_identity(winners[0])

    state = _load_active_state(root)
    pointer = state["active"]
    release = _load_cas_by_hash(
        root,
        pointer["manifest_sha256"],
        config_root=config_root,
        app_version=app_version,
        now=current_time,
        expected_source=pointer["source"],
    )
    _assert_pointer_matches(pointer, release)
    _assert_not_revoked(release.manifest_sha256, state["revoked_manifest_sha256s"])
    return _assert_expected_standard_identity(release)


def resolve_release_by_manifest_sha256(
    manifest_sha256: str,
    *,
    store_root: Path | str | None = None,
    resources_root: Path | str = _RESOURCES_ROOT,
    app_version: str = __version__,
    now: datetime | None = None,
) -> ResolvedStandardRelease:
    """按显式 manifest digest 解析目标 release，绝不回退到 active。"""
    if not isinstance(manifest_sha256, str) or not _SHA256_RE.fullmatch(manifest_sha256):
        raise _failure(
            "STANDARD_RELEASE_INVALID",
            "目标 manifest_sha256 必须是 64 位小写十六进制摘要。",
        )
    current_time = now or datetime.now(timezone.utc)
    root = _store_root(store_root)
    config_root = _safe_directory(Path(resources_root) / "config", "APP config 目录")
    revoked: list[str] = []
    if root is not None:
        revoked = _load_active_state(root)["revoked_manifest_sha256s"]

    installed_error: StructuredOakError | None = None
    if root is not None:
        try:
            release = _load_cas_by_hash(
                root,
                manifest_sha256,
                config_root=config_root,
                app_version=app_version,
                now=current_time,
            )
        except StructuredOakError as exc:
            if exc.code not in {"STANDARD_STORE_MISSING"}:
                installed_error = exc
            release = None
        if release is not None:
            _assert_not_revoked(manifest_sha256, revoked)
            return release

    try:
        release = _load_bundled_by_hash(
            manifest_sha256,
            config_root=config_root,
            app_version=app_version,
            now=current_time,
        )
    except StructuredOakError as bundled_error:
        if installed_error is not None:
            raise installed_error
        raise _failure(
            "STANDARD_RELEASE_MISSING",
            "显式指定的目标标准包未安装，拒绝改用 active 或其它版本。",
            manifest_sha256=manifest_sha256,
        ) from bundled_error
    _assert_not_revoked(manifest_sha256, revoked)
    return release


def _installed_manifest_hashes(store_root: Path) -> list[str]:
    packages_root = _safe_directory(store_root / "packages", "标准 CAS packages 目录")
    entries = list(packages_root.iterdir())
    if len(entries) > _MAX_MANIFESTS:
        raise _failure("STANDARD_STORE_UNSAFE", "已安装标准版本数量超过上限。")
    hashes: list[str] = []
    for entry in entries:
        if not _SHA256_RE.fullmatch(entry.name):
            raise _failure("STANDARD_STORE_UNSAFE", f"标准 CAS packages 含非法目录：{entry.name}")
        _safe_directory(entry, "标准 CAS release 目录")
        hashes.append(entry.name)
    return sorted(hashes)


def _all_releases(
    *,
    store_root: Path | None,
    config_root: Path,
    app_version: str,
    now: datetime,
) -> list[ResolvedStandardRelease]:
    releases: dict[str, ResolvedStandardRelease] = {}
    for path in _bundled_manifest_paths(config_root):
        release = _load_bundled_by_path(
            path,
            config_root=config_root,
            expected_manifest_sha256=None,
            app_version=app_version,
            now=now,
        )
        releases[release.manifest_sha256] = release
    if store_root is not None:
        for manifest_sha256 in _installed_manifest_hashes(store_root):
            release = _load_cas_by_hash(
                store_root,
                manifest_sha256,
                config_root=config_root,
                app_version=app_version,
                now=now,
            )
            releases.setdefault(release.manifest_sha256, release)
    return list(releases.values())


def resolve_project_rulepack(
    project_identity: dict,
    *,
    store_root: Path | str | None = None,
    resources_root: Path | str = _RESOURCES_ROOT,
    app_version: str = __version__,
    now: datetime | None = None,
    _allow_inactive_for_migration: bool = False,
) -> ResolvedStandardRelease:
    """按项目完整 pin 解析 release；旧 name+version 仅允许唯一匹配补齐。"""
    state_kind = validate_rulepack_identity(
        project_identity,
        allow_legacy=True,
        allow_uninitialized=True,
    )
    if state_kind == "uninitialized":
        raise _failure(
            "PROJECT_RULEPACK_UNPINNED",
            "旧项目没有可唯一识别的规则包名称与版本，拒绝猜测默认版本。",
        )
    current_time = now or datetime.now(timezone.utc)
    root = _store_root(store_root)
    config_root = _safe_directory(Path(resources_root) / "config", "APP config 目录")
    revoked: list[str] = []
    if root is not None:
        revoked = _load_active_state(root)["revoked_manifest_sha256s"]

    if state_kind == "full":
        manifest_sha256 = project_identity["manifest_sha256"]
        installed_error: StructuredOakError | None = None
        if root is not None:
            try:
                release = _load_cas_by_hash(
                    root,
                    manifest_sha256,
                    config_root=config_root,
                    app_version=app_version,
                    now=current_time,
                    enforce_compatibility=not _allow_inactive_for_migration,
                    enforce_expiry=not _allow_inactive_for_migration,
                    enforce_capabilities=True,
                )
            except StructuredOakError as exc:
                if exc.code not in {"STANDARD_STORE_MISSING"}:
                    installed_error = exc
                release = None
            if release is not None:
                if not _allow_inactive_for_migration:
                    _assert_not_revoked(manifest_sha256, revoked)
                if any(
                    release.identity[field] != project_identity[field]
                    for field in release.identity
                ):
                    raise _failure("PROJECT_RULEPACK_MISMATCH", "项目规则包 pin 与安装包身份不一致。")
                return _assert_expected_standard_identity(release)
        try:
            release = _load_bundled_by_hash(
                manifest_sha256,
                config_root=config_root,
                app_version=app_version,
                now=current_time,
                enforce_compatibility=not _allow_inactive_for_migration,
                enforce_expiry=not _allow_inactive_for_migration,
                enforce_capabilities=True,
            )
        except StructuredOakError as bundled_error:
            if installed_error is not None:
                raise installed_error
            raise _failure(
                "PROJECT_RULEPACK_MISSING",
                "项目固定的规则包未安装，拒绝改用 active 或其它版本。",
                manifest_sha256=manifest_sha256,
            ) from bundled_error
        if not _allow_inactive_for_migration:
            _assert_not_revoked(manifest_sha256, revoked)
        if any(
            release.identity[field] != project_identity[field]
            for field in release.identity
        ):
            raise _failure("PROJECT_RULEPACK_MISMATCH", "项目规则包 pin 与内置包身份不一致。")
        return _assert_expected_standard_identity(release)

    # 旧 format 1.0 只有 name+version。只有唯一内容身份时才允许补齐；绝不取 active。
    candidates = [
        release
        for release in _all_releases(
            store_root=root,
            config_root=config_root,
            app_version=app_version,
            now=current_time,
        )
        if release.identity["name"] == project_identity["name"]
        and release.identity["version"] == project_identity["version"]
    ]
    if len(candidates) != 1:
        raise _failure(
            "PROJECT_RULEPACK_AMBIGUOUS" if candidates else "PROJECT_RULEPACK_MISSING",
            "旧项目的规则包名称与版本无法唯一映射到一个已验证内容身份。",
            name=project_identity["name"],
            version=project_identity["version"],
            matches=len(candidates),
        )
    release = candidates[0]
    if not _allow_inactive_for_migration:
        _assert_not_revoked(release.manifest_sha256, revoked)
    return _assert_expected_standard_identity(release)


__all__ = [
    "ACTIVE_SCHEMA_VERSION",
    "ResolvedStandardRelease",
    "STORE_ENV",
    "EXPECTED_IDENTITY_ENV",
    "TRUSTED_BUNDLED_MANIFEST_SHA256S",
    "assert_expected_standard_identity",
    "resolve_active_release",
    "resolve_release_by_manifest_sha256",
    "resolve_project_rulepack",
]
