"""项目管理：创建 / 打开 / 检查点 / 完整性验证。

安全不变量（方案 §6.1）：
- source/ 中的原稿副本在创建后绝不被本模块之外的任何代码写入；
- 原稿 SHA-256 记录于 project.json，verify() 随时可证明不变；
- 检查点最多 5 个，清理只删最旧，绝不触碰 source/。
"""

from __future__ import annotations

import copy
import os
import re
import secrets
import shutil
import stat
from pathlib import Path

from .errors import OakError
from .util import now_iso, read_json, sha256_file, write_json

FORMAT_VERSION = "1.0"
SUPPORTED_FORMATS = {".docx": "docx", ".md": "md", ".txt": "txt", ".epub": "epub"}
SUBDIRS = ["source", "working", "checkpoints", "reports", "exports", "logs"]
MAX_CHECKPOINTS = 5
CHECKPOINT_STATE_VERSION = "1.0"
_CHECKPOINT_ID_RE = re.compile(r"^cp-[0-9]{4,}$")
_CHECKPOINT_STATE_FIELDS = (
    "settings",
    "rulepack",
    "checks",
    "check_seq",
    "issues_file",
    "fixes",
)

_DEFAULT_SETTINGS = {
    "manuscript_type": "paper",
    "language": "auto",
    "language_detected": None,
    "citation_style": "default",
    "citation_style_resolved": None,
    "citation_resolved_by": None,
    "citation_mapping_version": None,
    "check_depth": "full",
    "epub_preview": False,
}


class Project:
    def __init__(self, root: Path, data: dict) -> None:
        self.root = Path(root)
        self.data = data

    # ---- 便捷属性 ----

    @property
    def stored_filename(self) -> str:
        return self.data["source"]["stored_filename"]

    @property
    def source_path(self) -> Path:
        return self.root / "source" / self.stored_filename

    @property
    def working_path(self) -> Path:
        return self.root / "working" / self.stored_filename

    @property
    def source_sha256(self) -> str:
        return self.data["source"]["sha256"]

    @property
    def source_format(self) -> str:
        return self.data["source"]["format"]

    # ---- 创建 / 打开 ----

    @classmethod
    def create(
        cls,
        input_path: Path | str,
        project_dir: Path | str,
        *,
        manuscript_type: str = "paper",
        language: str = "auto",
        citation_style: str = "default",
        check_depth: str = "full",
        epub_preview: bool = False,
    ) -> "Project":
        input_path = Path(input_path)
        project_dir = Path(project_dir)

        if not input_path.is_file():
            raise OakError(f"找不到输入文件：{input_path.name}。原稿未被读取，也未发生任何写入。")
        ext = input_path.suffix.lower()
        if ext not in SUPPORTED_FORMATS:
            raise OakError(
                f"不支持的文件格式「{ext}」。支持：.docx / .md / .txt / .epub。"
                "旧版 .doc 请先在 Word 中另存为 .docx。"
            )
        if project_dir.exists() and any(project_dir.iterdir()):
            raise OakError(f"项目目录不为空：{project_dir}。请选择空目录，避免覆盖已有内容。")

        project_dir.mkdir(parents=True, exist_ok=True)
        for sub in SUBDIRS:
            (project_dir / sub).mkdir()

        stored = input_path.name
        source_copy = project_dir / "source" / stored
        shutil.copyfile(input_path, source_copy)
        digest = sha256_file(source_copy)
        # 原稿副本设为只读（语义保护；哈希验证才是硬保证）
        os.chmod(source_copy, stat.S_IREAD)
        shutil.copyfile(input_path, project_dir / "working" / stored)

        settings = dict(_DEFAULT_SETTINGS)
        settings.update(
            {
                "manuscript_type": manuscript_type,
                "language": language,
                "citation_style": citation_style,
                "check_depth": check_depth,
                "epub_preview": epub_preview,
            }
        )
        now = now_iso()
        data = {
            "format_version": FORMAT_VERSION,
            "app_version": _app_version(),
            "project_id": secrets.token_hex(8),
            "created_at": now,
            "updated_at": now,
            "source": {
                "stored_filename": stored,
                "format": SUPPORTED_FORMATS[ext],
                "sha256": digest,
                "size_bytes": source_copy.stat().st_size,
            },
            "settings": settings,
            "rulepack": {"name": None, "version": None, "pinned": True},
            "checks": [],
            "check_seq": 0,
            "issues_file": None,
            "checkpoints": [],
            "checkpoint_seq": 0,
            "fixes": [],
            "sync": {"schema_version": "1.0", "preference": "never_asked", "history": []},
            "integrity": {"last_verified_at": None, "source_hash_ok": True},
        }
        proj = cls(project_dir, data)
        proj.save(touch=False)
        return proj

    @classmethod
    def open(cls, project_dir: Path | str) -> "Project":
        project_dir = Path(project_dir)
        manifest = project_dir / "project.json"
        if not manifest.is_file():
            raise OakError(f"该目录不是湖岸稿件项目（缺少 project.json）：{project_dir}")
        data = read_json(manifest)
        if data.get("format_version") != FORMAT_VERSION:
            raise OakError(
                f"项目格式版本「{data.get('format_version')}」不受本版本支持（支持 {FORMAT_VERSION}）。"
            )
        return cls(project_dir, data)

    def save(self, *, touch: bool = True) -> None:
        if touch:
            self.data["updated_at"] = now_iso()
        write_json(self.root / "project.json", self.data)

    # ---- 检查点 ----

    def _assert_source_intact(self) -> str:
        if not self.source_path.is_file():
            raise OakError("原稿副本缺失，拒绝执行检查点操作。")
        actual = sha256_file(self.source_path)
        if actual != self.source_sha256:
            raise OakError("原稿 SHA-256 已变化，拒绝执行检查点操作。")
        return actual

    @staticmethod
    def _checkpoint_sequence(checkpoint_id: object) -> int:
        if not isinstance(checkpoint_id, str) or not _CHECKPOINT_ID_RE.fullmatch(checkpoint_id):
            return -1
        return int(checkpoint_id[3:])

    @staticmethod
    def _validate_checkpoint_id(checkpoint_id: object) -> str:
        if not isinstance(checkpoint_id, str) or not _CHECKPOINT_ID_RE.fullmatch(checkpoint_id):
            raise OakError("检查点 ID 非法。")
        return checkpoint_id

    def _checkpoint_dir(self, entry: dict) -> Path:
        checkpoint_id = self._validate_checkpoint_id(entry.get("checkpoint_id"))
        raw_path = entry.get("path")
        expected = f"checkpoints/{checkpoint_id}"
        if not isinstance(raw_path, str) or raw_path.replace("\\", "/") != expected:
            raise OakError(f"检查点路径非法：{checkpoint_id}")
        if Path(raw_path).is_absolute() or ".." in Path(raw_path).parts:
            raise OakError(f"检查点路径越界：{checkpoint_id}")

        project_root = self.root.resolve()
        checkpoint_root = (self.root / "checkpoints").resolve()
        try:
            checkpoint_root.relative_to(project_root)
        except ValueError as exc:
            raise OakError("检查点根目录越出项目范围。") from exc

        candidate = self.root / raw_path
        if not candidate.is_dir() or candidate.is_symlink():
            raise OakError(f"检查点目录缺失或不安全：{checkpoint_id}")
        resolved = candidate.resolve()
        try:
            resolved.relative_to(checkpoint_root)
        except ValueError as exc:
            raise OakError(f"检查点路径越出项目范围：{checkpoint_id}") from exc
        return candidate

    @staticmethod
    def _checkpoint_file(cp_dir: Path, relative: str, *, required: bool = True) -> Path | None:
        candidate = cp_dir / relative
        if not candidate.exists():
            if required:
                raise OakError(f"检查点文件缺失：{relative}")
            return None
        if not candidate.is_file() or candidate.is_symlink():
            raise OakError(f"检查点文件不安全：{relative}")
        try:
            candidate.resolve().relative_to(cp_dir.resolve())
        except ValueError as exc:
            raise OakError(f"检查点文件路径越界：{relative}") from exc
        return candidate

    def _report_path(self, relative: object, *, required: bool) -> Path:
        if not isinstance(relative, str):
            raise OakError("检查记录中的结果路径非法。")
        normalized = relative.replace("\\", "/")
        if not normalized.startswith("reports/") or Path(relative).is_absolute() or ".." in Path(relative).parts:
            raise OakError(f"检查结果路径越界：{relative}")
        candidate = self.root / relative
        try:
            candidate.resolve().relative_to((self.root / "reports").resolve())
        except ValueError as exc:
            raise OakError(f"检查结果路径越界：{relative}") from exc
        if required and (not candidate.is_file() or candidate.is_symlink()):
            raise OakError(f"检查结果文件缺失或不安全：{relative}")
        return candidate

    def _snapshot_project_state(self) -> dict:
        return {field: copy.deepcopy(self.data.get(field)) for field in _CHECKPOINT_STATE_FIELDS}

    def _validate_checkpoint_state(self, state_doc: object, checkpoint_id: str) -> dict:
        if not isinstance(state_doc, dict) or state_doc.get("schema_version") != CHECKPOINT_STATE_VERSION:
            raise OakError(f"检查点状态文件版本不受支持：{checkpoint_id}")
        state = state_doc.get("project_state")
        if not isinstance(state, dict):
            raise OakError(f"检查点状态文件损坏：{checkpoint_id}")
        for field in _CHECKPOINT_STATE_FIELDS:
            if field not in state:
                raise OakError(f"检查点状态缺少字段 {field}：{checkpoint_id}")
        if not isinstance(state["settings"], dict) or not isinstance(state["rulepack"], dict):
            raise OakError(f"检查点设置状态损坏：{checkpoint_id}")
        if not isinstance(state["checks"], list) or not isinstance(state["fixes"], list):
            raise OakError(f"检查点历史状态损坏：{checkpoint_id}")
        if not isinstance(state["check_seq"], int) or state["check_seq"] < 0:
            raise OakError(f"检查点检查序号损坏：{checkpoint_id}")
        if state["issues_file"] not in (None, "reports/issues.json"):
            raise OakError(f"检查点问题文件路径非法：{checkpoint_id}")

        result_snapshots = state_doc.get("check_results")
        if not isinstance(result_snapshots, list):
            raise OakError(f"检查点检查结果清单损坏：{checkpoint_id}")
        expected_results = {
            check.get("result_file")
            for check in state["checks"]
            if isinstance(check, dict) and isinstance(check.get("result_file"), str)
        }
        if len(expected_results) != len(state["checks"]):
            raise OakError(f"检查点检查记录损坏：{checkpoint_id}")
        listed_results = {
            item.get("path")
            for item in result_snapshots
            if isinstance(item, dict) and isinstance(item.get("path"), str)
        }
        if listed_results != expected_results or len(listed_results) != len(result_snapshots):
            raise OakError(f"检查点检查结果清单与项目状态不一致：{checkpoint_id}")
        return state

    def _load_checkpoint_snapshot(self, entry: dict) -> dict:
        if not isinstance(entry, dict):
            raise OakError("检查点元数据损坏。")
        checkpoint_id = self._validate_checkpoint_id(entry.get("checkpoint_id"))
        cp_dir = self._checkpoint_dir(entry)

        working = self._checkpoint_file(cp_dir, self.stored_filename)
        expected_working_hash = entry.get("working_sha256")
        if not isinstance(expected_working_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_working_hash):
            raise OakError(f"检查点工作稿哈希缺失或非法：{checkpoint_id}")
        actual_working_hash = sha256_file(working)
        if actual_working_hash != expected_working_hash:
            raise OakError(f"检查点工作稿已损坏：{checkpoint_id}")

        issues_path = self._checkpoint_file(cp_dir, "issues.json", required=False)
        has_issues = issues_path is not None
        declared_has_issues = entry.get("has_issues")
        if declared_has_issues not in (None, True, False):
            raise OakError(f"检查点问题状态非法：{checkpoint_id}")
        if declared_has_issues is not None and declared_has_issues != has_issues:
            raise OakError(f"检查点问题快照缺失或多余：{checkpoint_id}")
        issues = None
        if issues_path is not None:
            expected_issues_hash = entry.get("issues_sha256")
            if expected_issues_hash is not None and sha256_file(issues_path) != expected_issues_hash:
                raise OakError(f"检查点问题快照已损坏：{checkpoint_id}")
            try:
                issues = read_json(issues_path)
            except (OSError, ValueError) as exc:
                raise OakError(f"检查点问题快照不是有效 JSON：{checkpoint_id}") from exc
            if not isinstance(issues, list):
                raise OakError(f"检查点问题快照格式非法：{checkpoint_id}")
        elif entry.get("issues_sha256") is not None:
            raise OakError(f"检查点问题快照缺失：{checkpoint_id}")

        state_path = self._checkpoint_file(cp_dir, "state.json", required=False)
        state_doc = None
        state = None
        result_files: list[dict] = []
        if state_path is not None:
            expected_state_hash = entry.get("state_sha256")
            if expected_state_hash is not None and sha256_file(state_path) != expected_state_hash:
                raise OakError(f"检查点状态快照已损坏：{checkpoint_id}")
            try:
                state_doc = read_json(state_path)
            except (OSError, ValueError) as exc:
                raise OakError(f"检查点状态快照不是有效 JSON：{checkpoint_id}") from exc
            state = self._validate_checkpoint_state(state_doc, checkpoint_id)
            for item in state_doc["check_results"]:
                relative = item["path"]
                expected_hash = item.get("sha256")
                if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
                    raise OakError(f"检查点检查结果哈希非法：{checkpoint_id}")
                snapshot_file = self._checkpoint_file(cp_dir, relative)
                if sha256_file(snapshot_file) != expected_hash:
                    raise OakError(f"检查点检查结果已损坏：{checkpoint_id}")
                result_files.append({"path": relative, "source": snapshot_file, "sha256": expected_hash})
        elif entry.get("state_sha256") is not None:
            raise OakError(f"检查点状态快照缺失：{checkpoint_id}")

        if state is not None:
            expected_issues_file = "reports/issues.json" if has_issues else None
            if state["issues_file"] != expected_issues_file:
                raise OakError(f"检查点问题状态与文件不一致：{checkpoint_id}")

        return {
            "checkpoint_id": checkpoint_id,
            "entry": entry,
            "directory": cp_dir,
            "working": working,
            "working_sha256": actual_working_hash,
            "issues": issues_path,
            "issues_data": issues,
            "has_issues": has_issues,
            "state": state,
            "state_doc": state_doc,
            "result_files": result_files,
        }

    def list_checkpoints(self, *, newest_first: bool = True) -> list[dict]:
        """返回不暴露内部路径的稳定检查点元数据；损坏项保留并标为不可恢复。"""
        entries = list(self.data.get("checkpoints", []))
        id_counts: dict[str, int] = {}
        for entry in entries:
            if isinstance(entry, dict) and isinstance(entry.get("checkpoint_id"), str):
                checkpoint_id = entry["checkpoint_id"]
                id_counts[checkpoint_id] = id_counts.get(checkpoint_id, 0) + 1

        indexed = list(enumerate(entries))
        indexed.sort(
            key=lambda pair: (self._checkpoint_sequence(pair[1].get("checkpoint_id") if isinstance(pair[1], dict) else None), pair[0]),
            reverse=newest_first,
        )
        result: list[dict] = []
        for _index, entry in indexed:
            checkpoint_id = entry.get("checkpoint_id") if isinstance(entry, dict) else None
            errors: list[str] = []
            snapshot = None
            if isinstance(checkpoint_id, str) and id_counts.get(checkpoint_id, 0) > 1:
                errors.append("检查点 ID 重复。")
            try:
                snapshot = self._load_checkpoint_snapshot(entry)
            except (OakError, OSError) as exc:
                errors.append(str(exc))
            result.append(
                {
                    "checkpoint_id": checkpoint_id,
                    "created_at": entry.get("created_at") if isinstance(entry, dict) else None,
                    "reason": entry.get("reason") if isinstance(entry, dict) else None,
                    "working_sha256": entry.get("working_sha256") if isinstance(entry, dict) else None,
                    "working_size_bytes": (
                        snapshot["working"].stat().st_size if snapshot is not None else None
                    ),
                    "has_issues": snapshot["has_issues"] if snapshot is not None else None,
                    "issue_count": (
                        len(snapshot["issues_data"] or []) if snapshot is not None else None
                    ),
                    "state_version": (
                        CHECKPOINT_STATE_VERSION if snapshot is not None and snapshot["state"] is not None else None
                    ),
                    "can_restore": not errors,
                    "validation_errors": errors,
                }
            )
        return result

    def _delete_checkpoint_directories(self, entries: list[dict]) -> None:
        for entry in entries:
            try:
                cp_dir = self._checkpoint_dir(entry)
            except OakError:
                cp_dir = self.root / "checkpoints" / str(entry.get("checkpoint_id", "invalid"))
            shutil.rmtree(cp_dir, ignore_errors=True)

    def _prune_checkpoints(
        self,
        *,
        protected_ids: set[str] | None = None,
        delete_directories: bool = True,
    ) -> list[dict]:
        protected = protected_ids or set()
        checkpoints = self.data.setdefault("checkpoints", [])
        removed: list[dict] = []
        while len(checkpoints) > MAX_CHECKPOINTS:
            index = next(
                (i for i, item in enumerate(checkpoints) if item.get("checkpoint_id") not in protected),
                None,
            )
            if index is None:
                raise OakError("受保护的检查点过多，无法执行最多 5 个的清理策略。")
            removed.append(checkpoints.pop(index))
        if delete_directories:
            self._delete_checkpoint_directories(removed)
        return removed

    def make_checkpoint(
        self,
        *,
        reason: str,
        _protected_checkpoint_ids: set[str] | None = None,
        _defer_pruning: bool = False,
        _defer_save: bool = False,
    ) -> dict:
        if not isinstance(reason, str) or not reason.strip():
            raise OakError("检查点原因不能为空。")
        self._assert_source_intact()
        if not self.working_path.is_file() or self.working_path.is_symlink():
            raise OakError("工作副本缺失或不安全，无法创建检查点。")

        sequence = int(self.data.get("checkpoint_seq", 0)) + 1
        known_ids = {
            item.get("checkpoint_id")
            for item in self.data.get("checkpoints", [])
            if isinstance(item, dict)
        }
        while True:
            checkpoint_id = f"cp-{sequence:04d}"
            cp_dir = self.root / "checkpoints" / checkpoint_id
            if checkpoint_id not in known_ids and not cp_dir.exists():
                break
            sequence += 1

        stage_dir = self.root / "checkpoints" / f".{checkpoint_id}-{secrets.token_hex(6)}.tmp"
        state = self._snapshot_project_state()
        state_doc = {
            "schema_version": CHECKPOINT_STATE_VERSION,
            "project_state": state,
            "check_results": [],
        }
        issues_path = self.root / "reports" / "issues.json"
        try:
            stage_dir.mkdir(parents=False)
            staged_working = stage_dir / self.stored_filename
            shutil.copyfile(self.working_path, staged_working)

            has_issues = issues_path.is_file()
            issues_sha256 = None
            issue_count = 0
            if has_issues:
                try:
                    issues_data = read_json(issues_path)
                except (OSError, ValueError) as exc:
                    raise OakError("当前问题文件损坏，无法创建安全检查点。") from exc
                if not isinstance(issues_data, list):
                    raise OakError("当前问题文件格式非法，无法创建安全检查点。")
                shutil.copyfile(issues_path, stage_dir / "issues.json")
                issues_sha256 = sha256_file(stage_dir / "issues.json")
                issue_count = len(issues_data)
            expected_issues_file = "reports/issues.json" if has_issues else None
            if state["issues_file"] != expected_issues_file:
                raise OakError("项目问题状态与 reports/issues.json 不一致，无法创建安全检查点。")

            for check in state["checks"]:
                if not isinstance(check, dict):
                    raise OakError("项目检查记录损坏，无法创建安全检查点。")
                relative = check.get("result_file")
                source_result = self._report_path(relative, required=True)
                staged_result = stage_dir / relative
                staged_result.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source_result, staged_result)
                state_doc["check_results"].append(
                    {"path": relative, "sha256": sha256_file(staged_result)}
                )

            self._validate_checkpoint_state(state_doc, checkpoint_id)
            write_json(stage_dir / "state.json", state_doc)
            entry = {
                "checkpoint_id": checkpoint_id,
                "created_at": now_iso(),
                "reason": reason.strip(),
                "path": f"checkpoints/{checkpoint_id}",
                "working_sha256": sha256_file(staged_working),
                "working_size_bytes": staged_working.stat().st_size,
                "has_issues": has_issues,
                "issues_sha256": issues_sha256,
                "issue_count": issue_count,
                "state_version": CHECKPOINT_STATE_VERSION,
                "state_sha256": sha256_file(stage_dir / "state.json"),
            }
            os.replace(stage_dir, cp_dir)
        except Exception:
            shutil.rmtree(stage_dir, ignore_errors=True)
            raise

        self.data.setdefault("checkpoints", []).append(entry)
        self.data["checkpoint_seq"] = sequence
        protected = set(_protected_checkpoint_ids or set())
        protected.add(checkpoint_id)
        if not _defer_pruning:
            self._prune_checkpoints(protected_ids=protected)
        if not _defer_save:
            self.save()
        return copy.deepcopy(entry)

    def _replace_files_from_snapshot(self, snapshot: dict) -> None:
        token = secrets.token_hex(6)
        staged: list[tuple[Path, Path, str]] = []
        try:
            working_stage = self.working_path.parent / f".{self.stored_filename}.{token}.restore"
            shutil.copyfile(snapshot["working"], working_stage)
            staged.append((working_stage, self.working_path, snapshot["working_sha256"]))

            if snapshot["has_issues"]:
                issues_target = self.root / "reports" / "issues.json"
                issues_stage = issues_target.parent / f".issues.{token}.restore"
                shutil.copyfile(snapshot["issues"], issues_stage)
                staged.append((issues_stage, issues_target, sha256_file(snapshot["issues"])))

            for item in snapshot["result_files"]:
                target = self._report_path(item["path"], required=False)
                stage = target.parent / f".{target.name}.{token}.restore"
                shutil.copyfile(item["source"], stage)
                staged.append((stage, target, item["sha256"]))

            for stage, _target, expected_hash in staged:
                if sha256_file(stage) != expected_hash:
                    raise OakError("恢复暂存文件哈希验证失败。")
            for stage, target, _expected_hash in staged:
                os.replace(stage, target)
            if not snapshot["has_issues"]:
                (self.root / "reports" / "issues.json").unlink(missing_ok=True)
        finally:
            for stage, _target, _expected_hash in staged:
                stage.unlink(missing_ok=True)

    def _apply_checkpoint_state(self, snapshot: dict) -> bool:
        state = snapshot["state"]
        if state is None:
            # 兼容旧检查点：无法还原完整历史，但至少使问题指针和修复记录与工作稿一致。
            self.data["issues_file"] = (
                "reports/issues.json" if snapshot["has_issues"] else None
            )
            target_sequence = self._checkpoint_sequence(snapshot["checkpoint_id"])
            self.data["fixes"] = [
                item
                for item in self.data.get("fixes", [])
                if self._checkpoint_sequence(item.get("checkpoint_id")) < target_sequence
            ]
            return False

        current_check_seq = int(self.data.get("check_seq", 0))
        for field in _CHECKPOINT_STATE_FIELDS:
            if field == "check_seq":
                continue
            self.data[field] = copy.deepcopy(state[field])
        # 序号只增不减，避免恢复后覆盖仍保留在 reports/ 中的较新检查结果。
        self.data["check_seq"] = max(current_check_seq, state["check_seq"])
        return True

    def restore_checkpoint(
        self,
        checkpoint_id: str,
        *,
        create_safety_checkpoint: bool = True,
    ) -> dict:
        """安全恢复检查点；默认先保存当前状态，返回可用于撤销本次恢复的检查点 ID。"""
        checkpoint_id = self._validate_checkpoint_id(checkpoint_id)
        matches = [
            item
            for item in self.data.get("checkpoints", [])
            if isinstance(item, dict) and item.get("checkpoint_id") == checkpoint_id
        ]
        if len(matches) != 1:
            if not matches:
                raise OakError(f"检查点不存在：{checkpoint_id}")
            raise OakError(f"检查点 ID 重复，拒绝恢复：{checkpoint_id}")

        # 在任何写入（包括安全检查点）前完整验证目标和原稿。
        target_snapshot = self._load_checkpoint_snapshot(matches[0])
        source_hash_before = self._assert_source_intact()

        operation_data = copy.deepcopy(self.data)
        checkpoint_root = self.root / "checkpoints"
        original_checkpoint_entries = {child.name for child in checkpoint_root.iterdir()}
        safety_entry = None
        safety_snapshot = None
        pruned_entries: list[dict] = []

        try:
            if create_safety_checkpoint:
                # 安全检查点先只写独立快照并加入内存状态；恢复成功提交前，
                # 不裁剪旧检查点、不改 project.json，确保失败可以完整回滚。
                safety_entry = self.make_checkpoint(
                    reason=f"before_restore:{checkpoint_id}",
                    _protected_checkpoint_ids={checkpoint_id},
                    _defer_pruning=True,
                    _defer_save=True,
                )
                safety_snapshot = self._load_checkpoint_snapshot(safety_entry)

            self._replace_files_from_snapshot(target_snapshot)
            state_restored = self._apply_checkpoint_state(target_snapshot)
            self.data["integrity"] = {
                "last_verified_at": now_iso(),
                "source_hash_ok": True,
            }
            protected_ids = {checkpoint_id}
            if safety_entry is not None:
                protected_ids.add(safety_entry["checkpoint_id"])
            # 先只计算并更新将提交的清单；旧目录在 project.json 成功保存、
            # 原稿再次验证通过之前都不删除。
            pruned_entries = self._prune_checkpoints(
                protected_ids=protected_ids,
                delete_directories=False,
            )
            self.save()
            if self._assert_source_intact() != source_hash_before:
                raise OakError("恢复期间原稿 SHA-256 发生变化。")
        except Exception as exc:
            rollback_error = None
            try:
                if safety_snapshot is not None:
                    self._replace_files_from_snapshot(safety_snapshot)
                self.data = operation_data
                self.save(touch=False)
                # 删除本次操作新增的安全检查点或未完成暂存，原有目录一律保留。
                for child in checkpoint_root.iterdir():
                    if child.name not in original_checkpoint_entries:
                        if child.is_dir():
                            shutil.rmtree(child, ignore_errors=True)
                        else:
                            child.unlink(missing_ok=True)
            except Exception as rollback_exc:  # pragma: no cover - 极端磁盘故障
                rollback_error = rollback_exc
            if rollback_error is not None:
                raise OakError(f"恢复失败，且安全回滚也失败：{rollback_error}") from exc
            if isinstance(exc, OakError):
                raise
            raise OakError(f"恢复检查点失败：{exc}") from exc

        # project.json 已提交且原稿验证通过，至此才永久删除被淘汰的旧目录。
        self._delete_checkpoint_directories(pruned_entries)

        return {
            "restored_checkpoint_id": checkpoint_id,
            "safety_checkpoint_id": (
                safety_entry["checkpoint_id"] if safety_entry is not None else None
            ),
            "working_sha256": sha256_file(self.working_path),
            "issues_restored": target_snapshot["has_issues"],
            "state_restored": state_restored,
        }

    # ---- 完整性验证 ----

    def verify(self) -> list[str]:
        problems: list[str] = []
        for sub in SUBDIRS:
            if not (self.root / sub).is_dir():
                problems.append(f"缺少子目录：{sub}/")
        if self.source_path.is_file():
            actual = sha256_file(self.source_path)
            if actual != self.source_sha256:
                problems.append(
                    "原稿 SHA-256 与创建时记录不一致：原稿副本可能被外部修改。"
                    "请勿继续在本项目上操作，可从原始文件重建项目。"
                )
        else:
            problems.append("原稿副本缺失（source/ 中找不到文件）。")
        if not self.working_path.is_file():
            problems.append("工作副本缺失（working/ 中找不到文件）。")
        for check in self.data.get("checks", []):
            if not (self.root / check["result_file"]).is_file():
                problems.append(f"检查结果文件缺失：{check['result_file']}")
        for cp in self.data.get("checkpoints", []):
            if not (self.root / cp["path"]).is_dir():
                problems.append(f"检查点目录缺失：{cp['path']}")
        self.data["integrity"] = {
            "last_verified_at": now_iso(),
            "source_hash_ok": not any("SHA-256" in p for p in problems),
        }
        self.save()
        return problems


def _app_version() -> str:
    from . import __version__

    return __version__
