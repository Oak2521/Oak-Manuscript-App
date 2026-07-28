"""项目级标准/规则包显式升级与回退计划。

全局 StandardsProvider 只决定哪些 release 已验证并可用；项目 pin 的变化是另一
个必须由用户明确确认的事务。本模块因此把升级和回退统一为同一个两阶段协议：

1. ``plan_rulepack_upgrade`` 严格只读，生成绑定当前项目全部相关状态的确定性计划；
2. ``apply_rulepack_upgrade`` 重新解析目标、重算计划、创建检查点后原子更新项目 pin。

任何方向的版本切换都不得隐式选择 active，也不得沿用旧 issues/check 结论。
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
import stat
import tempfile
from pathlib import Path

from .errors import OakError, StructuredOakError
from .project import Project
from .rulepack import validate_rulepack_identity
from .safety import is_link_or_reparse
from .standards_store import (
    resolve_project_rulepack,
    resolve_release_by_manifest_sha256,
)
from .util import now_iso, read_json, sha256_file

PLAN_SCHEMA_VERSION = "1.0"
PLAN_KIND = "oak-rulepack-upgrade-plan"


def _upgrade_failure(code: str, message: str, **details) -> StructuredOakError:
    return StructuredOakError(
        message,
        code=code,
        retryable=False,
        details=details,
    )


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _canonical_sha256(value: object) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _resolver_kwargs(
    *,
    store_root=None,
    resources_root=None,
    app_version=None,
    now=None,
) -> dict:
    values = {
        "store_root": store_root,
        "resources_root": resources_root,
        "app_version": app_version,
        "now": now,
    }
    return {key: value for key, value in values.items() if value is not None}


def _changed_fields(before: dict, after: dict) -> list[str]:
    return sorted(
        key
        for key in set(before) | set(after)
        if before.get(key) != after.get(key)
    )


def _indexed_diff(before_items: list[dict], after_items: list[dict], id_field: str) -> dict:
    before = {item[id_field]: item for item in before_items}
    after = {item[id_field]: item for item in after_items}
    before_ids = set(before)
    after_ids = set(after)
    added = [copy.deepcopy(after[item_id]) for item_id in sorted(after_ids - before_ids)]
    removed = [copy.deepcopy(before[item_id]) for item_id in sorted(before_ids - after_ids)]
    changed = []
    for item_id in sorted(before_ids & after_ids):
        if before[item_id] == after[item_id]:
            continue
        changed.append(
            {
                id_field: item_id,
                "changed_fields": _changed_fields(before[item_id], after[item_id]),
                "before": copy.deepcopy(before[item_id]),
                "after": copy.deepcopy(after[item_id]),
            }
        )
    return {"added": added, "removed": removed, "changed": changed}


def _release_diff(current, target) -> dict:
    rules = _indexed_diff(
        current.rulepack["rules"],
        target.rulepack["rules"],
        "rule_id",
    )
    standards = _indexed_diff(
        current.standards["standards"],
        target.standards["standards"],
        "standard_id",
    )
    current_registry = {
        key: value for key, value in current.standards.items() if key != "standards"
    }
    target_registry = {
        key: value for key, value in target.standards.items() if key != "standards"
    }
    current_mapping = current.rulepack["citation_default_mapping"]
    target_mapping = target.rulepack["citation_default_mapping"]
    diff = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "rules": rules,
        "standards": {
            **standards,
            "registry_changed": current_registry != target_registry,
            "registry_before": copy.deepcopy(current_registry),
            "registry_after": copy.deepcopy(target_registry),
        },
        "citation_mapping": {
            "changed": current_mapping != target_mapping,
            "before": copy.deepcopy(current_mapping),
            "after": copy.deepcopy(target_mapping),
        },
        "release": {
            "before_version": current.manifest["version"],
            "after_version": target.manifest["version"],
            "target_change_summary": copy.deepcopy(target.manifest["change_summary"]),
        },
    }
    diff["summary"] = {
        "rules_added": len(rules["added"]),
        "rules_removed": len(rules["removed"]),
        "rules_changed": len(rules["changed"]),
        "standards_added": len(standards["added"]),
        "standards_removed": len(standards["removed"]),
        "standards_changed": len(standards["changed"]),
        "citation_mapping_changed": diff["citation_mapping"]["changed"],
    }
    return diff


def _project_bindings(project: Project) -> dict:
    manifest_path = project.manifest_path(required=True)
    source_sha256 = sha256_file(project.source_path)
    if source_sha256 != project.source_sha256:
        raise OakError("原稿 SHA-256 与项目记录不一致，拒绝生成规则包变更计划。")
    if not project.working_path.is_file() or project.working_path.is_symlink():
        raise OakError("工作副本缺失或不安全，拒绝生成规则包变更计划。")

    issues_path = project.issues_path(required=False)
    has_issues = issues_path.is_file()
    pointer_has_issues = project.data.get("issues_file") == "reports/issues.json"
    if has_issues != pointer_has_issues:
        raise OakError("项目 issues_file 指针与 reports/issues.json 实际状态不一致。")
    issues_sha256 = None
    issue_count = 0
    if has_issues:
        try:
            issues = read_json(issues_path)
        except (OSError, UnicodeError, ValueError) as exc:
            raise OakError("当前 reports/issues.json 损坏，拒绝生成升级计划。") from exc
        if not isinstance(issues, list):
            raise OakError("当前 reports/issues.json 顶层不是数组。")
        issues_sha256 = sha256_file(issues_path)
        issue_count = len(issues)

    result_hashes = []
    for check in project.data.get("checks", []):
        result_path = project.report_path(check["result_file"], required=True)
        result_hashes.append(
            {
                "check_id": check["check_id"],
                "sha256": sha256_file(result_path),
            }
        )
    check_state = {
        "check_seq": project.data.get("check_seq"),
        "checks": copy.deepcopy(project.data.get("checks", [])),
        "issues_file": project.data.get("issues_file"),
        "result_hashes": result_hashes,
    }
    return {
        "project_manifest_sha256": sha256_file(manifest_path),
        "project_state_sha256": _canonical_sha256(project.data),
        "source_sha256": source_sha256,
        "working_sha256": sha256_file(project.working_path),
        "issues_sha256": issues_sha256,
        "issue_count": issue_count,
        "check_state_sha256": _canonical_sha256(check_state),
    }


def plan_rulepack_upgrade(
    project: Project,
    target_manifest_sha256: str,
    *,
    store_root=None,
    resources_root=None,
    app_version=None,
    now=None,
) -> dict:
    """生成确定性、严格只读的项目规则包升级或回退计划。"""
    try:
        state_kind = validate_rulepack_identity(project.data.get("rulepack"))
    except OakError as exc:
        raise _upgrade_failure(
            "RULEPACK_UPGRADE_CURRENT_UNPINNED",
            "项目必须先具有完整规则包 pin，才能生成升级/回退计划。",
        ) from exc
    if state_kind != "full":  # pragma: no cover - validate 的防御性分支
        raise _upgrade_failure(
            "RULEPACK_UPGRADE_CURRENT_UNPINNED",
            "项目规则包 pin 不完整。",
        )

    resolver_args = _resolver_kwargs(
        store_root=store_root,
        resources_root=resources_root,
        app_version=app_version,
        now=now,
    )
    current = resolve_project_rulepack(
        project.data["rulepack"],
        _allow_inactive_for_migration=True,
        **resolver_args,
    )
    if current.identity["manifest_sha256"] == target_manifest_sha256:
        raise _upgrade_failure(
            "RULEPACK_UPGRADE_NOT_NEEDED",
            "目标 release 已是项目当前规则包，无需生成变更计划。",
            manifest_sha256=target_manifest_sha256,
        )
    try:
        target = resolve_release_by_manifest_sha256(
            target_manifest_sha256,
            **resolver_args,
        )
    except StructuredOakError as exc:
        if exc.code in {"STANDARD_RELEASE_MISSING", "STANDARD_STORE_MISSING"}:
            raise _upgrade_failure(
                "RULEPACK_UPGRADE_TARGET_MISSING",
                "显式指定的目标规则包未安装，无法生成升级/回退计划。",
                manifest_sha256=target_manifest_sha256,
            ) from exc
        raise
    if current.identity["bundle_id"] != target.identity["bundle_id"]:
        raise _upgrade_failure(
            "RULEPACK_UPGRADE_BUNDLE_MISMATCH",
            "目标 release 属于另一标准包 bundle，拒绝切换项目 pin。",
        )
    current_sequence = current.identity["release_sequence"]
    target_sequence = target.identity["release_sequence"]
    if current_sequence == target_sequence:
        raise _upgrade_failure(
            "RULEPACK_UPGRADE_SEQUENCE_CONFLICT",
            "当前与目标 release_sequence 相同但身份不同，拒绝横向替换。",
        )
    direction = "upgrade" if target_sequence > current_sequence else "rollback"

    diff = _release_diff(current, target)
    diff_sha256 = _canonical_sha256(diff)
    body = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "kind": PLAN_KIND,
        "project_id": project.data["project_id"],
        "direction": direction,
        "current_rulepack": copy.deepcopy(current.identity),
        "target_rulepack": copy.deepcopy(target.identity),
        "bindings": _project_bindings(project),
        "diff_sha256": diff_sha256,
        "diff": diff,
        "requires_recheck": True,
    }
    return {
        **body,
        "plan_id": f"rulepack-plan-{_canonical_sha256(body)}",
    }


def _is_same_safe_file(path: Path, identity: tuple[int, int]) -> bool:
    try:
        info = os.lstat(path)
    except OSError:
        return False
    return (
        (info.st_dev, info.st_ino) == identity
        and stat.S_ISREG(info.st_mode)
        and getattr(info, "st_nlink", 1) == 1
        and not is_link_or_reparse(path)
    )


def _safe_unlink_created(path: Path, identity: tuple[int, int] | None) -> None:
    if identity is not None and _is_same_safe_file(path, identity):
        path.unlink(missing_ok=True)


def _stage_json(destination: Path, value: object) -> tuple[Path, tuple[int, int]]:
    fd, raw_path = tempfile.mkstemp(
        prefix=f".{destination.name}.",
        suffix=".rulepack-upgrade.tmp",
        dir=destination.parent,
    )
    staged = Path(raw_path)
    identity: tuple[int, int] | None = None
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or getattr(opened, "st_nlink", 1) != 1:
            raise OakError("规则包升级 project.json 暂存文件身份不安全。")
        identity = (opened.st_dev, opened.st_ino)
        payload = (
            json.dumps(value, ensure_ascii=False, indent=2) + "\n"
        ).encode("utf-8")
        with os.fdopen(fd, "wb") as stream:
            fd = -1
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
            after_fd = os.fstat(stream.fileno())
            if (after_fd.st_dev, after_fd.st_ino) != identity:
                raise OakError("规则包升级 project.json 暂存文件在写入期间发生变化。")
        if not _is_same_safe_file(staged, identity):
            raise OakError("规则包升级 project.json 暂存目录项在写入后发生变化。")
    except Exception:
        if fd >= 0:
            try:
                os.close(fd)
            except OSError:
                pass
        _safe_unlink_created(staged, identity)
        raise
    return staged, identity


def _commit_project_manifest(
    staged: Path,
    manifest_path: Path,
    identity: tuple[int, int],
) -> None:
    """独立提交点，便于故障注入验证事务回滚。"""
    if not _is_same_safe_file(staged, identity):
        raise OakError("规则包升级 project.json 暂存文件在提交前发生变化。")
    os.replace(staged, manifest_path)


def _write_exclusive_bytes(destination: Path, payload: bytes) -> tuple[int, int]:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_BINARY"):
        flags |= os.O_BINARY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(destination, flags, 0o600)
    identity: tuple[int, int] | None = None
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or getattr(opened, "st_nlink", 1) != 1:
            raise OakError("规则包升级归档文件身份不安全。")
        identity = (opened.st_dev, opened.st_ino)
        with os.fdopen(fd, "wb") as stream:
            fd = -1
            view = memoryview(payload)
            while view:
                written = stream.write(view)
                if written is None or written <= 0:
                    raise OSError("无法完整写入规则包升级归档")
                view = view[written:]
            stream.flush()
            os.fsync(stream.fileno())
            after_fd = os.fstat(stream.fileno())
            if (after_fd.st_dev, after_fd.st_ino) != identity:
                raise OakError("规则包升级归档在写入期间发生变化。")
        if not _is_same_safe_file(destination, identity):
            raise OakError("规则包升级归档目录项在写入后发生变化。")
        return identity
    except Exception:
        if fd >= 0:
            try:
                os.close(fd)
            except OSError:
                pass
        _safe_unlink_created(destination, identity)
        raise


def _atomic_restore_bytes(destination: Path, payload: bytes) -> None:
    fd, raw_path = tempfile.mkstemp(
        prefix=f".{destination.name}.",
        suffix=".rollback.tmp",
        dir=destination.parent,
    )
    staged = Path(raw_path)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(staged, destination)
    finally:
        staged.unlink(missing_ok=True)


def apply_rulepack_upgrade(
    project: Project,
    target_manifest_sha256: str,
    *,
    plan_id: str,
    store_root=None,
    resources_root=None,
    app_version=None,
    now=None,
) -> dict:
    """应用已确认计划；升级与回退共享同一 fail-closed 事务。"""
    if not isinstance(plan_id, str) or not plan_id:
        raise _upgrade_failure(
            "RULEPACK_UPGRADE_PLAN_REQUIRED",
            "缺少已确认的规则包升级/回退 plan_id。",
        )
    plan = plan_rulepack_upgrade(
        project,
        target_manifest_sha256,
        store_root=store_root,
        resources_root=resources_root,
        app_version=app_version,
        now=now,
    )
    if plan_id != plan["plan_id"]:
        raise _upgrade_failure(
            "RULEPACK_UPGRADE_PLAN_STALE",
            "规则包升级/回退计划已过期、目标不匹配或不属于当前项目；请重新生成并确认。",
        )

    # 再次重算，封闭调用方在第一次校验后改变项目状态的常规竞态窗口。
    if plan_rulepack_upgrade(
        project,
        target_manifest_sha256,
        store_root=store_root,
        resources_root=resources_root,
        app_version=app_version,
        now=now,
    )["plan_id"] != plan_id:
        raise _upgrade_failure(
            "RULEPACK_UPGRADE_PLAN_STALE",
            "规则包升级/回退计划在执行前已过期。",
        )

    manifest_path = project.manifest_path(required=True)
    manifest_before = manifest_path.read_bytes()
    data_before = copy.deepcopy(project.data)
    source_sha256_before = plan["bindings"]["source_sha256"]
    working_sha256_before = plan["bindings"]["working_sha256"]
    issues_path = project.issues_path(required=False)
    issues_before = issues_path.read_bytes() if issues_path.is_file() else None
    checkpoint_root = project.safe_subdir("checkpoints")
    checkpoint_names_before = {entry.name for entry in checkpoint_root.iterdir()}
    checkpoint = None
    archive_path: Path | None = None
    archive_identity: tuple[int, int] | None = None
    staged_manifest: Path | None = None
    staged_manifest_identity: tuple[int, int] | None = None
    pruned_entries: list[dict] = []
    cleanup_warning = None

    try:
        checkpoint = project.make_checkpoint(
            reason=f"before_rulepack_upgrade:{plan['target_rulepack']['version']}",
            _defer_pruning=True,
            _defer_save=True,
        )

        # ``make_checkpoint`` 只增加独立快照，尚未改 project.json。重新从磁盘
        # 打开并重算一次，封闭第一次确认后到检查点落盘之间的 project/issues/
        # check-result 竞态；新增但尚未引用的检查点目录不参与计划身份。
        disk_project = Project.open(project.root)
        if plan_rulepack_upgrade(
            disk_project,
            target_manifest_sha256,
            store_root=store_root,
            resources_root=resources_root,
            app_version=app_version,
            now=now,
        )["plan_id"] != plan_id:
            raise _upgrade_failure(
                "RULEPACK_UPGRADE_PLAN_STALE",
                "规则包升级/回退计划在创建安全检查点期间已过期。",
            )

        if issues_before is not None:
            reports_root = project.safe_subdir("reports")
            archive_path = reports_root / (
                f"issues.before-rulepack-{checkpoint['checkpoint_id']}.json"
            )
            if (
                hashlib.sha256(issues_before).hexdigest()
                != plan["bindings"]["issues_sha256"]
                or checkpoint.get("issues_sha256") != plan["bindings"]["issues_sha256"]
                or sha256_file(issues_path) != plan["bindings"]["issues_sha256"]
            ):
                raise _upgrade_failure(
                    "RULEPACK_UPGRADE_PLAN_STALE",
                    "当前问题或检查点问题快照与已确认计划不一致。",
                )
            try:
                archive_identity = _write_exclusive_bytes(archive_path, issues_before)
            except FileExistsError as exc:
                raise _upgrade_failure(
                    "RULEPACK_UPGRADE_ARCHIVE_CONFLICT",
                    "规则包升级 issues 归档目标已存在，拒绝覆盖。",
                ) from exc
            if sha256_file(archive_path) != plan["bindings"]["issues_sha256"]:
                raise OakError("规则包升级 issues 归档写入后哈希不一致。")

        applied_at = now_iso()
        project.data["rulepack"] = copy.deepcopy(plan["target_rulepack"])
        project.data["issues_file"] = None
        project.data["rulepack_check_required"] = True
        settings = project.data["settings"]
        # 结构化解析绑定旧规则包身份与能力覆盖；升级或回退后必须重算。
        settings["citation_resolution"] = None
        if settings.get("citation_style") == "default":
            for field in (
                "citation_style_resolved",
                "citation_resolved_by",
                "citation_mapping_version",
            ):
                settings[field] = None

        history = project.data.setdefault("rulepack_history", [])
        history_entry = {
            "change_id": f"rulepack-change-{len(history) + 1:04d}",
            "direction": plan["direction"],
            "applied_at": applied_at,
            "from_rulepack": copy.deepcopy(plan["current_rulepack"]),
            "to_rulepack": copy.deepcopy(plan["target_rulepack"]),
            "plan_id": plan_id,
            "diff_sha256": plan["diff_sha256"],
            "checkpoint_id": checkpoint["checkpoint_id"],
            "issues_archive": (
                f"reports/{archive_path.name}" if archive_path is not None else None
            ),
        }
        history.append(history_entry)
        project.data["updated_at"] = applied_at

        # 只更新将提交的元数据；旧检查点目录在 project.json 成功换入前不删除。
        pruned_entries = project._prune_checkpoints(
            protected_ids={checkpoint["checkpoint_id"]},
            delete_directories=False,
        )
        if sha256_file(project.source_path) != source_sha256_before:
            raise _upgrade_failure(
                "RULEPACK_UPGRADE_PLAN_STALE",
                "规则包升级期间原稿发生变化。",
            )
        if sha256_file(project.working_path) != working_sha256_before:
            raise _upgrade_failure(
                "RULEPACK_UPGRADE_PLAN_STALE",
                "规则包升级期间工作副本发生变化，计划已过期。",
            )
        project._validate_manifest_and_files(validate_source_hash=True)
        staged_manifest, staged_manifest_identity = _stage_json(manifest_path, project.data)
        _commit_project_manifest(
            staged_manifest,
            manifest_path,
            staged_manifest_identity,
        )
        staged_manifest = None
        staged_manifest_identity = None

        # 从磁盘重新打开，证明提交后的完整项目仍满足 schema 与路径不变量。
        committed = Project.open(project.root)
        if committed.data["rulepack"] != plan["target_rulepack"]:
            raise OakError("规则包升级提交后的项目 pin 与目标不一致。")
        if sha256_file(project.source_path) != source_sha256_before:
            raise OakError("规则包升级提交后原稿 SHA-256 发生变化。")
        if sha256_file(project.working_path) != working_sha256_before:
            raise OakError("规则包升级提交后工作副本 SHA-256 发生变化。")

        # 新清单已经原子提交且明确 issues_file=null；现在删除旧 live issues。
        # 若进程在此前退出，旧 issues 只是未引用的安全冗余，项目仍可打开。
        if issues_before is not None:
            if (
                not issues_path.is_file()
                or sha256_file(issues_path) != plan["bindings"]["issues_sha256"]
            ):
                raise OakError("规则包升级提交后 live issues 状态发生变化。")
            issues_path.unlink()
    except Exception as exc:
        rollback_error = None
        try:
            if issues_before is not None and not os.path.lexists(issues_path):
                _atomic_restore_bytes(issues_path, issues_before)

            if manifest_path.read_bytes() != manifest_before:
                _atomic_restore_bytes(manifest_path, manifest_before)
            if archive_path is not None and archive_identity is not None:
                _safe_unlink_created(archive_path, archive_identity)
            project.data = data_before
            for child in checkpoint_root.iterdir():
                if child.name not in checkpoint_names_before:
                    if child.is_dir():
                        shutil.rmtree(child)
                    else:
                        child.unlink(missing_ok=True)
        except Exception as rollback_exc:  # pragma: no cover - 极端磁盘/对抗故障
            rollback_error = rollback_exc
        if rollback_error is not None:
            raise _upgrade_failure(
                "RULEPACK_UPGRADE_ROLLBACK_FAILED",
                f"规则包升级/回退失败，且项目事务回滚也失败：{rollback_error}",
            ) from exc
        if isinstance(exc, OakError):
            raise
        raise _upgrade_failure(
            "RULEPACK_UPGRADE_TRANSACTION_FAILED",
            f"规则包升级/回退失败：{exc}",
        ) from exc
    finally:
        if staged_manifest is not None:
            _safe_unlink_created(staged_manifest, staged_manifest_identity)

    try:
        project._delete_checkpoint_directories(pruned_entries, ignore_errors=False)
    except Exception as exc:  # 已提交项目仍完整，仅留下不可达旧目录供后续清理。
        cleanup_warning = f"旧检查点目录清理未完成：{exc}"

    result = {
        "ok": True,
        "change": copy.deepcopy(project.data["rulepack_history"][-1]),
        "rulepack": copy.deepcopy(project.data["rulepack"]),
        "rulepack_check_required": True,
        "archived_issues": project.data["rulepack_history"][-1]["issues_archive"],
    }
    if cleanup_warning is not None:
        result["cleanup_warning"] = cleanup_warning
    return result


__all__ = [
    "PLAN_KIND",
    "PLAN_SCHEMA_VERSION",
    "apply_rulepack_upgrade",
    "plan_rulepack_upgrade",
]
