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
from pathlib import Path, PurePosixPath, PureWindowsPath

from .citation import REQUESTED_STYLES, SUPPORTED_STYLES, validate_citation_resolution
from .errors import OakError, ProjectValidationError
from .format_coverage import validate_format_coverage
from .project_lock import PROJECT_LOCK_FILENAME, validate_existing_lock_file
from .rulepack import validate_rulepack_identity
from .safety import is_link_or_reparse
from .util import now_iso, read_json, sha256_file, write_json

FORMAT_VERSION = "1.0"
SUPPORTED_FORMATS = {".docx": "docx", ".md": "md", ".txt": "txt", ".epub": "epub"}
SUBDIRS = ["source", "working", "checkpoints", "reports", "exports", "logs"]
MAX_CHECKPOINTS = 5
CHECKPOINT_STATE_VERSION = "1.0"
_CHECKPOINT_ID_RE = re.compile(r"^cp-[0-9]{4,}$")
_CHECK_ID_RE = re.compile(r"^check-[0-9]{4,}$")
_FIX_ID_RE = re.compile(r"^fix-[0-9]{4,}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_RULEPACK_CHANGE_ID_RE = re.compile(r"^rulepack-change-[0-9]{4,}$")
_RULEPACK_PLAN_ID_RE = re.compile(r"^rulepack-plan-[0-9a-f]{64}$")
_SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
_RULEPACK_ISSUES_ARCHIVE_RE = re.compile(
    r"^reports/issues\.before-rulepack-cp-[0-9]{4,}\.json$"
)
_RULEPACK_HISTORY_FIELDS = {
    "change_id",
    "direction",
    "applied_at",
    "from_rulepack",
    "to_rulepack",
    "plan_id",
    "diff_sha256",
    "checkpoint_id",
    "issues_archive",
}
_CHECKPOINT_STATE_FIELDS = (
    "settings",
    "rulepack",
    "checks",
    "check_seq",
    "issues_file",
    "fixes",
    "rulepack_check_required",
)

_DEFAULT_SETTINGS = {
    "manuscript_type": "paper",
    "language": "auto",
    "language_detected": None,
    "citation_style": "default",
    "citation_style_resolved": None,
    "citation_resolved_by": None,
    "citation_mapping_version": None,
    "citation_resolution": None,
    "check_depth": "full",
    "epub_preview": False,
}
_SETTINGS_FIELDS = set(_DEFAULT_SETTINGS)
_MANUSCRIPT_TYPES = {"paper", "print_book", "ebook"}
_LANGUAGES = {"auto", "zh", "en", "mixed"}
_CHECK_DEPTHS = {"quick", "full"}


class Project:
    def __init__(self, root: Path, data: dict) -> None:
        self.root = Path(root).resolve()
        self.data = data

    # ---- 项目路径信任边界 ----

    @staticmethod
    def _safe_basename(value: object, *, label: str = "文件名") -> str:
        if not isinstance(value, str) or not value or "\x00" in value:
            raise ProjectValidationError(f"{label}缺失或含 NUL，拒绝打开项目。")
        if value in {".", ".."} or "/" in value or "\\" in value or ":" in value:
            raise ProjectValidationError(f"{label}不是单一安全文件名，拒绝打开项目。")
        posix = PurePosixPath(value)
        windows = PureWindowsPath(value)
        if (
            posix.is_absolute()
            or windows.is_absolute()
            or windows.drive
            or posix.name != value
            or windows.name != value
        ):
            raise ProjectValidationError(f"{label}不是单一安全文件名，拒绝打开项目。")
        return value

    @staticmethod
    def _lstat(path: Path, *, label: str):
        try:
            return os.lstat(path)
        except OSError as exc:
            raise ProjectValidationError(f"{label}缺失或无法安全读取，拒绝打开项目。") from exc

    @classmethod
    def _validate_root_path(cls, root: Path) -> Path:
        info = cls._lstat(root, label="项目根目录")
        if is_link_or_reparse(root) or not stat.S_ISDIR(info.st_mode):
            raise ProjectValidationError("项目根目录是链接、目录联接或非常规目录，拒绝打开项目。")
        try:
            return root.resolve(strict=True)
        except OSError as exc:
            raise ProjectValidationError("项目根目录无法安全解析，拒绝打开项目。") from exc

    @classmethod
    def _validate_direct_child_dir(cls, root: Path, name: str) -> Path:
        candidate = root / name
        info = cls._lstat(candidate, label=f"固定子目录 {name}/")
        if is_link_or_reparse(candidate) or not stat.S_ISDIR(info.st_mode):
            raise ProjectValidationError(
                f"固定子目录 {name}/ 是链接、目录联接或非常规目录，拒绝打开项目。"
            )
        try:
            resolved = candidate.resolve(strict=True)
        except OSError as exc:
            raise ProjectValidationError(f"固定子目录 {name}/ 无法安全解析。") from exc
        if resolved.parent != root or resolved.name != name:
            raise ProjectValidationError(f"固定子目录 {name}/ 越出项目根目录，拒绝打开项目。")
        return resolved

    @classmethod
    def _validate_regular_file(
        cls,
        path: Path,
        *,
        parent: Path,
        label: str,
        required: bool = True,
    ) -> Path:
        if not os.path.lexists(path):
            if required:
                raise ProjectValidationError(f"{label}缺失，拒绝打开项目。")
            return path
        info = cls._lstat(path, label=label)
        if (
            is_link_or_reparse(path)
            or not stat.S_ISREG(info.st_mode)
            or getattr(info, "st_nlink", 1) != 1
        ):
            raise ProjectValidationError(f"{label}是链接、硬链接或非常规文件，拒绝打开项目。")
        try:
            resolved = path.resolve(strict=True)
        except OSError as exc:
            raise ProjectValidationError(f"{label}无法安全解析，拒绝打开项目。") from exc
        if resolved.parent != parent or resolved.name != path.name:
            raise ProjectValidationError(f"{label}越出固定目录，拒绝打开项目。")
        return resolved

    def _safe_root(self) -> Path:
        resolved = self._validate_root_path(self.root)
        if resolved != self.root:
            raise ProjectValidationError("项目根目录身份在操作期间发生变化，拒绝继续写入。")
        return resolved

    def safe_subdir(self, name: str) -> Path:
        if name not in SUBDIRS:
            raise ProjectValidationError(f"未知固定子目录：{name}")
        return self._validate_direct_child_dir(self._safe_root(), name)

    def manifest_path(self, *, required: bool = True) -> Path:
        root = self._safe_root()
        return self._validate_regular_file(
            root / "project.json",
            parent=root,
            label="项目清单 project.json",
            required=required,
        )

    def report_path(self, relative: object, *, required: bool = True) -> Path:
        if not isinstance(relative, str) or "\\" in relative or "\x00" in relative:
            raise ProjectValidationError("检查记录中的结果路径非法。")
        pure = PurePosixPath(relative)
        if pure.is_absolute() or len(pure.parts) != 2 or pure.parts[0] != "reports":
            raise ProjectValidationError(f"检查结果路径越界：{relative}")
        filename = self._safe_basename(pure.parts[1], label="检查结果文件名")
        reports = self.safe_subdir("reports")
        return self._validate_regular_file(
            reports / filename,
            parent=reports,
            label=f"检查结果文件 {relative}",
            required=required,
        )

    def issues_path(self, *, required: bool = True) -> Path:
        return self.report_path("reports/issues.json", required=required)

    def safe_report_directory(self, name: str) -> Path:
        """返回 reports/ 下一个直接受控目录；存在时拒绝链接/联接。"""
        safe_name = self._safe_basename(name, label="报告目录名")
        reports = self.safe_subdir("reports")
        candidate = reports / safe_name
        if os.path.lexists(candidate):
            info = self._lstat(candidate, label=f"报告目录 reports/{safe_name}")
            if is_link_or_reparse(candidate) or not stat.S_ISDIR(info.st_mode):
                raise ProjectValidationError(
                    f"报告目录 reports/{safe_name} 不是安全的常规目录。"
                )
            resolved = candidate.resolve(strict=True)
            if resolved.parent != reports or resolved.name != safe_name:
                raise ProjectValidationError(f"报告目录 reports/{safe_name} 越界。")
            return resolved
        return candidate

    def _validate_layout(self, *, require_manifest: bool = True) -> None:
        root = self._safe_root()
        if require_manifest:
            self.manifest_path(required=True)
        for sub in SUBDIRS:
            self._validate_direct_child_dir(root, sub)

    @staticmethod
    def _nonnegative_int(value: object) -> bool:
        return isinstance(value, int) and not isinstance(value, bool) and value >= 0

    @classmethod
    def _validate_settings(
        cls,
        settings: object,
        *,
        allow_legacy_missing_resolution: bool = True,
    ) -> dict:
        """验证项目/检查点设置，并只补齐 alpha.4 缺少的新可空字段。"""
        if not isinstance(settings, dict):
            raise ProjectValidationError("项目 settings 字段必须是对象。")
        if "citation_resolution" not in settings and allow_legacy_missing_resolution:
            settings["citation_resolution"] = None
        if set(settings) != _SETTINGS_FIELDS:
            raise ProjectValidationError("项目 settings 字段集合非法。")
        if settings["manuscript_type"] not in _MANUSCRIPT_TYPES:
            raise ProjectValidationError("项目 manuscript_type 设置非法。")
        if settings["language"] not in _LANGUAGES:
            raise ProjectValidationError("项目 language 设置非法。")
        if settings["citation_style"] not in REQUESTED_STYLES:
            raise ProjectValidationError("项目 citation_style 设置非法。")
        if settings["check_depth"] not in _CHECK_DEPTHS:
            raise ProjectValidationError("项目 check_depth 设置非法。")
        if not isinstance(settings["epub_preview"], bool):
            raise ProjectValidationError("项目 epub_preview 设置必须是布尔值。")

        detected = settings["language_detected"]
        if detected not in {None, "zh", "en", "mixed"}:
            raise ProjectValidationError("项目 language_detected 设置非法。")
        resolved_style = settings["citation_style_resolved"]
        if resolved_style not in {None, "none", *SUPPORTED_STYLES}:
            raise ProjectValidationError("项目 citation_style_resolved 设置非法。")
        resolved_by = settings["citation_resolved_by"]
        if resolved_by not in {None, "user", "default_mapping", "default_resolver"}:
            raise ProjectValidationError("项目 citation_resolved_by 设置非法。")
        mapping_version = settings["citation_mapping_version"]
        if mapping_version is not None and (
            not isinstance(mapping_version, str) or not _SEMVER_RE.fullmatch(mapping_version)
        ):
            raise ProjectValidationError("项目 citation_mapping_version 设置非法。")

        resolution = settings["citation_resolution"]
        if resolution is None:
            if resolved_style is None:
                if resolved_by is not None or mapping_version is not None:
                    raise ProjectValidationError("项目未检查引用状态的兼容字段不一致。")
                return settings
            if resolved_by is None:
                raise ProjectValidationError("项目已解析引用体例但缺少解析来源。")
            if resolved_by == "default_resolver":
                raise ProjectValidationError("项目缺少结构化引用解析记录。")
            if resolved_by == "default_mapping":
                if settings["citation_style"] != "default" or mapping_version is None:
                    raise ProjectValidationError("旧项目默认体例映射状态不一致。")
            elif mapping_version is not None:
                raise ProjectValidationError("用户指定体例不应保存默认映射版本。")
            if (
                settings["citation_style"] in set(SUPPORTED_STYLES) | {"none"}
                and resolved_style != settings["citation_style"]
            ):
                raise ProjectValidationError("旧项目用户请求与已解析体例不一致。")
            return settings

        try:
            validate_citation_resolution(resolution)
        except OakError as exc:
            raise ProjectValidationError(f"项目 citation_resolution 非法：{exc.message}") from exc
        if resolution["requested_style"] != settings["citation_style"]:
            raise ProjectValidationError("项目引用请求与结构化解析记录不一致。")
        if resolution["resolved_style"] != resolved_style:
            raise ProjectValidationError("项目最终引用体例与结构化解析记录不一致。")
        projected_by = (
            "default_mapping"
            if resolution["resolved_by"] == "legacy_mapping"
            else resolution["resolved_by"]
        )
        if projected_by != resolved_by:
            raise ProjectValidationError("项目引用解析来源与兼容字段不一致。")
        expected_mapping = (
            resolution["resolver"]["policy_version"]
            if resolution["requested_style"] == "default"
            else None
        )
        if mapping_version != expected_mapping:
            raise ProjectValidationError("项目引用解析策略版本与兼容字段不一致。")
        if detected != resolution["evidence"]["language"]:
            raise ProjectValidationError("项目语言解析与引用解析证据不一致。")
        return settings

    # ---- 便捷属性 ----

    @property
    def stored_filename(self) -> str:
        source = self.data.get("source")
        if not isinstance(source, dict):
            raise ProjectValidationError("项目清单 source 字段损坏。")
        return self._safe_basename(source.get("stored_filename"), label="原稿存储文件名")

    @property
    def source_path(self) -> Path:
        parent = self.safe_subdir("source")
        return self._validate_regular_file(
            parent / self.stored_filename,
            parent=parent,
            label="原稿副本",
            required=True,
        )

    @property
    def working_path(self) -> Path:
        parent = self.safe_subdir("working")
        return self._validate_regular_file(
            parent / self.stored_filename,
            parent=parent,
            label="工作副本",
            required=True,
        )

    @property
    def source_sha256(self) -> str:
        value = self.data.get("source", {}).get("sha256")
        if not isinstance(value, str) or not _SHA256_RE.fullmatch(value):
            raise ProjectValidationError("项目清单中的原稿 SHA-256 非法。")
        return value

    @property
    def source_format(self) -> str:
        value = self.data.get("source", {}).get("format")
        if value not in set(SUPPORTED_FORMATS.values()):
            raise ProjectValidationError("项目清单中的原稿格式非法。")
        return value

    # ---- 创建 / 打开 ----

    @staticmethod
    def _input_identity(info: os.stat_result) -> tuple[int, int, int, int]:
        return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)

    @classmethod
    def _open_input_source(cls, input_path: Path):
        """跟随云盘 reparse/symlink，只接受最终可打开的常规只读来源。"""
        try:
            stream = open(input_path, "rb")
        except OSError as exc:
            raise OakError(
                f"找不到输入文件或无法读取：{input_path.name}。未发生任何项目写入。"
            ) from exc
        try:
            opened_info = os.fstat(stream.fileno())
            if not stat.S_ISREG(opened_info.st_mode):
                raise OakError("输入最终目标必须是常规文件；未发生任何项目写入。")
            resolved = input_path.resolve(strict=True)
            resolved_info = os.stat(resolved, follow_symlinks=True)
            if (
                not stat.S_ISREG(resolved_info.st_mode)
                or (resolved_info.st_dev, resolved_info.st_ino)
                != (opened_info.st_dev, opened_info.st_ino)
            ):
                raise OakError("输入路径在打开期间发生变化，未发生任何项目写入。")
            return stream, cls._input_identity(opened_info)
        except Exception:
            stream.close()
            raise

    @classmethod
    def _validate_create_input_extension(cls, input_path: Path) -> str:
        ext = input_path.suffix.lower()
        if ext not in SUPPORTED_FORMATS:
            raise OakError(
                f"不支持的文件格式「{ext}」。支持：.docx / .md / .txt / .epub。"
                "旧版 .doc 请先在 Word 中另存为 .docx。"
            )
        return ext

    @classmethod
    def _validate_create_target(cls, project_dir: Path) -> None:
        if not os.path.lexists(project_dir):
            return
        try:
            target_info = os.lstat(project_dir)
        except OSError as exc:
            raise OakError("项目目标目录无法安全读取；未发生任何写入。") from exc
        if is_link_or_reparse(project_dir) or not stat.S_ISDIR(target_info.st_mode):
            raise OakError("项目目标必须是非链接的常规目录；未发生任何写入。")
        entries = list(project_dir.iterdir())
        if not entries:
            return
        if len(entries) == 1 and entries[0].name == PROJECT_LOCK_FILENAME:
            # 仅接受本应用上一次留下的完整协议锁。普通同名文件属于用户数据，
            # 必须在加锁前拒绝且保持原字节。
            validate_existing_lock_file(entries[0])
            return
        raise OakError(
            f"项目目录不为空：{project_dir}。请选择空目录，避免覆盖已有内容。"
        )

    @classmethod
    def preflight_create(
        cls,
        input_path: Path | str,
        project_dir: Path | str,
    ) -> None:
        """纯只读创建门禁；通过前不得创建目录或写锁文件。"""
        input_path = Path(input_path)
        project_dir = Path(project_dir)
        cls._validate_create_input_extension(input_path)
        input_stream, _identity = cls._open_input_source(input_path)
        input_stream.close()
        cls._validate_create_target(project_dir)

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
        rulepack_identity: dict | None = None,
    ) -> "Project":
        input_path = Path(input_path)
        project_dir = Path(project_dir)
        # 所有用户设置先于目录创建、文件复制和清单写入严格验证。Python API
        # 与 Electron/CLI 使用同一门禁，不能靠 argparse 或前端白名单兜底。
        requested_settings = dict(_DEFAULT_SETTINGS)
        requested_settings.update(
            {
                "manuscript_type": manuscript_type,
                "language": language,
                "citation_style": citation_style,
                "check_depth": check_depth,
                "epub_preview": epub_preview,
            }
        )
        cls._validate_settings(
            requested_settings,
            allow_legacy_missing_resolution=False,
        )
        if rulepack_identity is None:
            # ``Project.create`` is also a public Python entrypoint used outside
            # the CLI.  A newly-created project must never start life with the
            # old ``name=None/version=None`` sentinel: such a project cannot be
            # resolved without guessing later.  Resolve and verify the same
            # active release as the CLI, while keeping the import local to avoid
            # making the project model depend on the standards-store module at
            # import time.
            from .standards_store import resolve_active_release

            rulepack_identity = resolve_active_release().identity
        validate_rulepack_identity(rulepack_identity)
        # 正式 Electron spawn 会注入已经由主进程验签的 exact identity；即使
        # Python API 调用方显式传入 identity，也不得绕过该单次进程绑定。
        from .standards_store import assert_expected_standard_identity

        assert_expected_standard_identity(rulepack_identity)
        # CLI 在加锁前跑过纯只读门禁；锁内重验扩展名和目标，但输入正文
        # 只打开一次。随后始终从该文件描述符复制到 source，再从受控 source
        # 生成 working，避免检查/复制两次打开之间的来源替换竞态。
        ext = cls._validate_create_input_extension(input_path)
        cls._validate_create_target(project_dir)
        input_stream, input_identity = cls._open_input_source(input_path)
        created_root: tuple[Path, tuple[int, int]] | None = None
        created_dirs: list[tuple[Path, tuple[int, int]]] = []
        created_files: list[tuple[Path, tuple[int, int]]] = []

        def remember(path: Path, info: os.stat_result) -> tuple[int, int]:
            identity = (info.st_dev, info.st_ino)
            return identity

        def cleanup_created() -> None:
            for path, identity in reversed(created_files):
                try:
                    info = os.lstat(path)
                    if (
                        (info.st_dev, info.st_ino) == identity
                        and stat.S_ISREG(info.st_mode)
                        and not is_link_or_reparse(path)
                        and getattr(info, "st_nlink", 1) == 1
                    ):
                        try:
                            os.chmod(path, stat.S_IWRITE)
                        except OSError:
                            pass
                        path.unlink()
                except OSError:
                    pass
            for path, identity in reversed(created_dirs):
                try:
                    info = os.lstat(path)
                    if (
                        (info.st_dev, info.st_ino) == identity
                        and stat.S_ISDIR(info.st_mode)
                        and not is_link_or_reparse(path)
                    ):
                        path.rmdir()
                except OSError:
                    pass
            if created_root is not None:
                root_path, identity = created_root
                try:
                    info = os.lstat(root_path)
                    if (
                        (info.st_dev, info.st_ino) == identity
                        and stat.S_ISDIR(info.st_mode)
                        and not is_link_or_reparse(root_path)
                    ):
                        root_path.rmdir()
                except OSError:
                    pass

        try:
            if project_dir.exists():
                if is_link_or_reparse(project_dir) or not project_dir.is_dir():
                    raise OakError(f"项目目录不是安全的常规目录：{project_dir}")
                unexpected = [
                    child for child in project_dir.iterdir()
                    if child.name != PROJECT_LOCK_FILENAME
                ]
                if unexpected:
                    raise OakError(
                        f"项目目录不为空：{project_dir}。请选择空目录，避免覆盖已有内容。"
                    )
            else:
                project_dir.mkdir(parents=True, exist_ok=False)
                root_info = os.lstat(project_dir)
                created_root = (project_dir.absolute(), remember(project_dir, root_info))
            project_dir = cls._validate_root_path(project_dir)
            for sub in SUBDIRS:
                subdir = project_dir / sub
                subdir.mkdir()
                created_dirs.append((subdir, remember(subdir, os.lstat(subdir))))

            stored = cls._safe_basename(input_path.name, label="原稿文件名")
            source_copy = project_dir / "source" / stored
            source_target = open(source_copy, "xb")
            created_files.append(
                (source_copy, remember(source_copy, os.fstat(source_target.fileno())))
            )
            with source_target:
                shutil.copyfileobj(input_stream, source_target)
                source_target.flush()
                os.fsync(source_target.fileno())
            if cls._input_identity(os.fstat(input_stream.fileno())) != input_identity:
                raise OakError("输入稿件在复制期间发生变化，项目创建已安全中止。")

            digest = sha256_file(source_copy)
            # 原稿副本设为只读（语义保护；哈希验证才是硬保证）
            os.chmod(source_copy, stat.S_IREAD)
            working_copy = project_dir / "working" / stored
            working_target = open(working_copy, "xb")
            created_files.append(
                (working_copy, remember(working_copy, os.fstat(working_target.fileno())))
            )
            with open(source_copy, "rb") as controlled_source, working_target:
                shutil.copyfileobj(controlled_source, working_target)
                working_target.flush()
                os.fsync(working_target.fileno())

            settings = requested_settings
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
                "rulepack": copy.deepcopy(rulepack_identity),
                "rulepack_history": [],
                "rulepack_check_required": False,
                "checks": [],
                "check_seq": 0,
                "issues_file": None,
                "checkpoints": [],
                "checkpoint_seq": 0,
                "fixes": [],
                "sync": {
                    "schema_version": "1.0",
                    "preference": "never_asked",
                    "history": [],
                },
                "integrity": {"last_verified_at": None, "source_hash_ok": True},
            }
            manifest_path = project_dir / "project.json"
            manifest_placeholder = open(manifest_path, "xb")
            created_files.append(
                (manifest_path, remember(manifest_path, os.fstat(manifest_placeholder.fileno())))
            )
            manifest_placeholder.close()
            proj = cls(project_dir, data)
            proj.save(touch=False)
            proj._validate_manifest_and_files(validate_source_hash=True)
            return proj
        except Exception:
            cleanup_created()
            raise
        finally:
            input_stream.close()

    @classmethod
    def open(cls, project_dir: Path | str) -> "Project":
        project_dir = Path(project_dir)
        root = cls._validate_root_path(project_dir)
        manifest = cls._validate_regular_file(
            root / "project.json",
            parent=root,
            label="项目清单 project.json",
            required=True,
        )
        try:
            data = read_json(manifest)
        except (OSError, UnicodeError, ValueError) as exc:
            raise ProjectValidationError("项目清单不是有效的 UTF-8 JSON，拒绝打开项目。") from exc
        if not isinstance(data, dict):
            raise ProjectValidationError("项目清单顶层必须是对象，拒绝打开项目。")
        if data.get("format_version") != FORMAT_VERSION:
            raise ProjectValidationError(
                f"项目格式版本「{data.get('format_version')}」不受本版本支持（支持 {FORMAT_VERSION}）。"
            )
        project = cls(root, data)
        project._validate_manifest_and_files(validate_source_hash=True)
        return project

    def save(self, *, touch: bool = True, _validate_source_hash: bool = True) -> None:
        if touch:
            self.data["updated_at"] = now_iso()
        self._validate_manifest_and_files(validate_source_hash=_validate_source_hash)
        write_json(self.manifest_path(required=False), self.data)

    def _validate_manifest_and_files(self, *, validate_source_hash: bool) -> None:
        """完整验证清单 schema 与所有清单控制路径；任何业务写入前重跑。"""
        self._validate_layout(require_manifest=False)
        data = self.data
        if not isinstance(data, dict) or data.get("format_version") != FORMAT_VERSION:
            raise ProjectValidationError("项目清单版本或顶层结构非法。")
        if not isinstance(data.get("app_version"), str) or not data["app_version"]:
            raise ProjectValidationError("项目清单 app_version 非法。")
        if not isinstance(data.get("project_id"), str) or not re.fullmatch(
            r"[0-9a-f]{16}", data["project_id"]
        ):
            raise ProjectValidationError("项目清单 project_id 非法。")
        for field in ("settings", "rulepack", "sync", "integrity"):
            if not isinstance(data.get(field), dict):
                raise ProjectValidationError(f"项目清单 {field} 字段必须是对象。")
        self._validate_settings(data["settings"])
        try:
            validate_rulepack_identity(
                data["rulepack"],
                allow_legacy=True,
                allow_uninitialized=True,
            )
        except OakError as exc:
            raise ProjectValidationError(f"项目清单 rulepack 身份非法：{exc.message}") from exc
        rulepack_history = data.get("rulepack_history", [])
        if not isinstance(rulepack_history, list):
            raise ProjectValidationError("项目清单 rulepack_history 字段必须是数组。")
        if not isinstance(data.get("rulepack_check_required", False), bool):
            raise ProjectValidationError("项目清单 rulepack_check_required 字段必须是布尔值。")
        change_ids: set[str] = set()
        previous_to_rulepack = None
        for index, change in enumerate(rulepack_history, start=1):
            if not isinstance(change, dict) or set(change) != _RULEPACK_HISTORY_FIELDS:
                raise ProjectValidationError("项目规则包升级历史字段非法。")
            change_id = change.get("change_id")
            if not isinstance(change_id, str) or not _RULEPACK_CHANGE_ID_RE.fullmatch(change_id):
                raise ProjectValidationError("项目规则包升级历史 change_id 非法。")
            if change_id in change_ids:
                raise ProjectValidationError(f"项目规则包升级历史 change_id 重复：{change_id}")
            change_ids.add(change_id)
            if change_id != f"rulepack-change-{index:04d}":
                raise ProjectValidationError("项目规则包升级历史 change_id 序列不连续。")
            if change.get("direction") not in {"upgrade", "rollback"}:
                raise ProjectValidationError(f"项目规则包升级历史 direction 非法：{change_id}")
            if not isinstance(change.get("applied_at"), str) or not change["applied_at"]:
                raise ProjectValidationError(f"项目规则包升级历史 applied_at 非法：{change_id}")
            try:
                validate_rulepack_identity(change.get("from_rulepack"))
                validate_rulepack_identity(change.get("to_rulepack"))
            except OakError as exc:
                raise ProjectValidationError(
                    f"项目规则包升级历史 pin 非法：{change_id}：{exc.message}"
                ) from exc
            if change["from_rulepack"] == change["to_rulepack"]:
                raise ProjectValidationError(f"项目规则包升级历史没有身份变化：{change_id}")
            if (
                change["to_rulepack"]["release_sequence"]
                == change["from_rulepack"]["release_sequence"]
            ):
                raise ProjectValidationError(f"项目规则包升级历史 release_sequence 未变化：{change_id}")
            sequence_increased = (
                change["to_rulepack"]["release_sequence"]
                > change["from_rulepack"]["release_sequence"]
            )
            if sequence_increased != (change["direction"] == "upgrade"):
                raise ProjectValidationError(f"项目规则包升级历史方向与序号不一致：{change_id}")
            if (
                previous_to_rulepack is not None
                and change["from_rulepack"] != previous_to_rulepack
            ):
                raise ProjectValidationError(f"项目规则包升级历史 pin 链不连续：{change_id}")
            previous_to_rulepack = copy.deepcopy(change["to_rulepack"])
            if not isinstance(change.get("plan_id"), str) or not _RULEPACK_PLAN_ID_RE.fullmatch(
                change["plan_id"]
            ):
                raise ProjectValidationError(f"项目规则包升级历史 plan_id 非法：{change_id}")
            if not isinstance(change.get("diff_sha256"), str) or not _SHA256_RE.fullmatch(
                change["diff_sha256"]
            ):
                raise ProjectValidationError(f"项目规则包升级历史 diff_sha256 非法：{change_id}")
            if not isinstance(change.get("checkpoint_id"), str) or not _CHECKPOINT_ID_RE.fullmatch(
                change["checkpoint_id"]
            ):
                raise ProjectValidationError(f"项目规则包升级历史 checkpoint_id 非法：{change_id}")
            archive = change.get("issues_archive")
            if archive is not None and (
                not isinstance(archive, str) or not _RULEPACK_ISSUES_ARCHIVE_RE.fullmatch(archive)
            ):
                raise ProjectValidationError(f"项目规则包升级历史 issues_archive 非法：{change_id}")
            if archive is not None:
                self.report_path(archive, required=True)
        if rulepack_history and rulepack_history[-1]["to_rulepack"] != data["rulepack"]:
            raise ProjectValidationError("项目当前 rulepack pin 与升级历史末项不一致。")
        for field in ("checks", "checkpoints", "fixes"):
            if not isinstance(data.get(field), list):
                raise ProjectValidationError(f"项目清单 {field} 字段必须是数组。")
        for field in ("check_seq", "checkpoint_seq"):
            if not self._nonnegative_int(data.get(field)):
                raise ProjectValidationError(f"项目清单 {field} 字段非法。")

        source = data.get("source")
        if not isinstance(source, dict):
            raise ProjectValidationError("项目清单 source 字段必须是对象。")
        stored = self.stored_filename
        source_format = self.source_format
        expected_format = SUPPORTED_FORMATS.get(Path(stored).suffix.lower())
        if expected_format != source_format:
            raise ProjectValidationError("原稿文件扩展名与清单 format 不一致。")
        if not self._nonnegative_int(source.get("size_bytes")):
            raise ProjectValidationError("项目清单中的原稿 size_bytes 非法。")
        source_file = self.source_path
        working_file = self.working_path
        try:
            if os.path.samefile(source_file, working_file):
                raise ProjectValidationError("原稿副本与工作副本指向同一文件，拒绝打开项目。")
        except OSError as exc:
            raise ProjectValidationError("无法证明原稿副本与工作副本相互独立。") from exc
        if validate_source_hash and source_file.stat().st_size != source["size_bytes"]:
            raise ProjectValidationError("原稿副本大小与项目清单不一致，拒绝打开项目。")
        expected_hash = self.source_sha256
        if validate_source_hash and sha256_file(source_file) != expected_hash:
            raise ProjectValidationError("原稿副本 SHA-256 与项目清单不一致，拒绝打开项目。")

        issues_file = data.get("issues_file")
        if issues_file not in (None, "reports/issues.json"):
            raise ProjectValidationError("项目清单 issues_file 路径非法。")
        if issues_file is not None:
            self.issues_path(required=True)

        check_ids: set[str] = set()
        max_check_sequence = 0
        for check in data["checks"]:
            if not isinstance(check, dict):
                raise ProjectValidationError("项目清单中的检查记录必须是对象。")
            check_id = check.get("check_id")
            if not isinstance(check_id, str) or not _CHECK_ID_RE.fullmatch(check_id):
                raise ProjectValidationError("项目清单中的 check_id 非法。")
            if check_id in check_ids:
                raise ProjectValidationError(f"项目清单中的 check_id 重复：{check_id}")
            check_ids.add(check_id)
            max_check_sequence = max(max_check_sequence, int(check_id[6:]))
            expected_result = f"reports/{check_id}.json"
            if check.get("result_file") != expected_result:
                raise ProjectValidationError(f"检查结果路径与 check_id 不一致：{check_id}")
            self.report_path(expected_result, required=True)
        if data["check_seq"] < max_check_sequence:
            raise ProjectValidationError("项目清单 check_seq 小于既有检查记录序号。")

        checkpoint_ids: set[str] = set()
        max_checkpoint_sequence = 0
        for entry in data["checkpoints"]:
            if not isinstance(entry, dict):
                raise ProjectValidationError("项目清单中的检查点记录必须是对象。")
            checkpoint_id = self._validate_checkpoint_id(entry.get("checkpoint_id"))
            if checkpoint_id in checkpoint_ids:
                raise ProjectValidationError(f"项目清单中的检查点 ID 重复：{checkpoint_id}")
            checkpoint_ids.add(checkpoint_id)
            max_checkpoint_sequence = max(max_checkpoint_sequence, int(checkpoint_id[3:]))
            if entry.get("path") != f"checkpoints/{checkpoint_id}":
                raise ProjectValidationError(f"检查点路径与 ID 不一致：{checkpoint_id}")
            self._checkpoint_dir(entry)
        if data["checkpoint_seq"] < max_checkpoint_sequence:
            raise ProjectValidationError("项目清单 checkpoint_seq 小于既有检查点序号。")

        fix_ids: set[str] = set()
        for fix in data["fixes"]:
            if not isinstance(fix, dict):
                raise ProjectValidationError("项目清单中的修复记录必须是对象。")
            fix_id = fix.get("fix_run_id")
            if not isinstance(fix_id, str) or not _FIX_ID_RE.fullmatch(fix_id):
                raise ProjectValidationError("项目清单中的 fix_run_id 非法。")
            if fix_id in fix_ids:
                raise ProjectValidationError(f"项目清单中的 fix_run_id 重复：{fix_id}")
            fix_ids.add(fix_id)
            checkpoint_id = fix.get("checkpoint_id")
            if checkpoint_id is not None:
                if not isinstance(checkpoint_id, str) or not _CHECKPOINT_ID_RE.fullmatch(
                    checkpoint_id
                ):
                    raise ProjectValidationError(
                        f"修复记录引用的检查点 ID 非法：{fix_id}"
                    )
            if "applied" in fix and not isinstance(fix.get("applied"), list):
                raise ProjectValidationError(f"修复记录 applied 字段非法：{fix_id}")

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

        checkpoint_root = self.safe_subdir("checkpoints")
        candidate = checkpoint_root / checkpoint_id
        if (
            not candidate.is_dir()
            or is_link_or_reparse(candidate)
        ):
            raise OakError(f"检查点目录缺失或不安全：{checkpoint_id}")
        resolved = candidate.resolve()
        if resolved.parent != checkpoint_root or resolved.name != checkpoint_id:
            raise OakError(f"检查点路径越出项目范围：{checkpoint_id}")
        return resolved

    @staticmethod
    def _checkpoint_file(cp_dir: Path, relative: str, *, required: bool = True) -> Path | None:
        candidate = cp_dir / relative
        if not candidate.exists():
            if required:
                raise OakError(f"检查点文件缺失：{relative}")
            return None
        try:
            info = os.lstat(candidate)
        except OSError as exc:
            raise OakError(f"检查点文件无法安全读取：{relative}") from exc
        if (
            not stat.S_ISREG(info.st_mode)
            or is_link_or_reparse(candidate)
            or getattr(info, "st_nlink", 1) != 1
        ):
            raise OakError(f"检查点文件不安全：{relative}")
        try:
            candidate.resolve().relative_to(cp_dir.resolve())
        except ValueError as exc:
            raise OakError(f"检查点文件路径越界：{relative}") from exc
        return candidate

    def _report_path(self, relative: object, *, required: bool) -> Path:
        return self.report_path(relative, required=required)

    def _snapshot_project_state(self) -> dict:
        return {
            field: copy.deepcopy(
                self.data.get(field, False)
                if field == "rulepack_check_required"
                else self.data.get(field)
            )
            for field in _CHECKPOINT_STATE_FIELDS
        }

    def _validate_checkpoint_state(self, state_doc: object, checkpoint_id: str) -> dict:
        if not isinstance(state_doc, dict) or state_doc.get("schema_version") != CHECKPOINT_STATE_VERSION:
            raise OakError(f"检查点状态文件版本不受支持：{checkpoint_id}")
        state = state_doc.get("project_state")
        if not isinstance(state, dict):
            raise OakError(f"检查点状态文件损坏：{checkpoint_id}")
        for field in _CHECKPOINT_STATE_FIELDS:
            if field == "rulepack_check_required":
                continue
            if field not in state:
                raise OakError(f"检查点状态缺少字段 {field}：{checkpoint_id}")
        if not isinstance(state["settings"], dict) or not isinstance(state["rulepack"], dict):
            raise OakError(f"检查点设置状态损坏：{checkpoint_id}")
        try:
            self._validate_settings(state["settings"])
        except ProjectValidationError as exc:
            raise OakError(f"检查点设置状态损坏：{checkpoint_id}：{exc.message}") from exc
        if not isinstance(state["checks"], list) or not isinstance(state["fixes"], list):
            raise OakError(f"检查点历史状态损坏：{checkpoint_id}")
        if not isinstance(state["check_seq"], int) or state["check_seq"] < 0:
            raise OakError(f"检查点检查序号损坏：{checkpoint_id}")
        if state["issues_file"] not in (None, "reports/issues.json"):
            raise OakError(f"检查点问题文件路径非法：{checkpoint_id}")
        if "rulepack_check_required" in state:
            if not isinstance(state["rulepack_check_required"], bool):
                raise OakError(f"检查点复检状态非法：{checkpoint_id}")
        else:
            # 兼容旧 checkpoint state：只有最近一次 check 明确绑定同一完整
            # identity 时才能证明结论仍适用；其它历史快照一律要求重新检查。
            last_check = state["checks"][-1] if state["checks"] else None
            state = copy.deepcopy(state)
            state["rulepack_check_required"] = not (
                isinstance(last_check, dict)
                and last_check.get("rulepack") == state["rulepack"]
            )

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

    def _delete_checkpoint_directories(
        self,
        entries: list[dict],
        *,
        ignore_errors: bool = True,
    ) -> None:
        checkpoint_root = self.safe_subdir("checkpoints")
        for entry in entries:
            try:
                cp_dir = self._checkpoint_dir(entry)
            except OakError:
                checkpoint_id = self._validate_checkpoint_id(entry.get("checkpoint_id"))
                cp_dir = checkpoint_root / checkpoint_id
                if cp_dir.exists() and (
                    is_link_or_reparse(cp_dir)
                    or cp_dir.resolve().parent != checkpoint_root
                ):
                    raise ProjectValidationError(
                        f"待删除检查点目录不安全：{checkpoint_id}"
                    )
            shutil.rmtree(cp_dir, ignore_errors=ignore_errors)

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
            checkpoint_root = self.safe_subdir("checkpoints")
            cp_dir = checkpoint_root / checkpoint_id
            if checkpoint_id not in known_ids and not cp_dir.exists():
                break
            sequence += 1

        checkpoint_root = self.safe_subdir("checkpoints")
        stage_dir = checkpoint_root / f".{checkpoint_id}-{secrets.token_hex(6)}.tmp"
        state = self._snapshot_project_state()
        state_doc = {
            "schema_version": CHECKPOINT_STATE_VERSION,
            "project_state": state,
            "check_results": [],
        }
        issues_path = self.issues_path(required=False)
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
                issues_target = self.issues_path(required=False)
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
                self.issues_path(required=False).unlink(missing_ok=True)
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
        target_state = target_snapshot.get("state")
        if (
            isinstance(target_state, dict)
            and target_state.get("rulepack") != self.data.get("rulepack")
        ):
            raise OakError(
                "检查点属于另一规则包身份；规则包回退必须先生成并确认显式升级/回退计划，"
                "不能通过 restore-checkpoint 静默切换。"
            )
        source_hash_before = self._assert_source_intact()

        operation_data = copy.deepcopy(self.data)
        checkpoint_root = self.safe_subdir("checkpoints")
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
        layout_safe = True
        try:
            self._safe_root()
            self.manifest_path(required=True)
        except ProjectValidationError as exc:
            problems.append(str(exc))
            return problems
        for sub in SUBDIRS:
            try:
                self.safe_subdir(sub)
            except ProjectValidationError:
                problems.append(f"缺少或不安全的固定子目录：{sub}/")
                layout_safe = False
        if not layout_safe:
            # 不能证明 project.json 的固定父目录仍安全时，绝不写完整性状态。
            return problems
        try:
            source_path = self.source_path
            actual = sha256_file(source_path)
            if actual != self.source_sha256:
                problems.append(
                    "原稿 SHA-256 与创建时记录不一致：原稿副本可能被外部修改。"
                    "请勿继续在本项目上操作，可从原始文件重建项目。"
                )
        except ProjectValidationError:
            problems.append("原稿副本缺失或不安全（source/ 中找不到安全常规文件）。")
        try:
            self.working_path
        except ProjectValidationError:
            problems.append("工作副本缺失或不安全（working/ 中找不到安全常规文件）。")
        for check in self.data.get("checks", []):
            check_id = check.get("check_id")
            relative = check.get("result_file")
            try:
                result_path = self.report_path(relative, required=True)
            except (ProjectValidationError, OakError):
                problems.append(f"检查结果文件缺失：{relative}")
                continue
            try:
                result = read_json(result_path)
            except (OSError, UnicodeError, ValueError, RecursionError):
                problems.append(f"检查结果文件不是有效 UTF-8 JSON：{relative}")
                continue
            if not isinstance(result, dict):
                problems.append(f"检查结果文件顶层必须是 JSON 对象：{relative}")
                continue
            if result.get("schema_version") != "1.0":
                problems.append(f"检查结果 schema_version 非法：{relative}")
            if result.get("check_id") != check_id:
                problems.append(f"检查结果 check_id 与检查记录不一致：{relative}")

            settings_snapshot = result.get("settings_snapshot")
            if settings_snapshot is not None and not isinstance(settings_snapshot, dict):
                problems.append(f"检查结果 settings_snapshot 非法：{relative}")
            elif isinstance(settings_snapshot, dict):
                try:
                    self._validate_settings(copy.deepcopy(settings_snapshot))
                except ProjectValidationError:
                    problems.append(f"检查结果 settings_snapshot 非法：{relative}")
            if "citation_resolution" in result:
                citation_resolution = result.get("citation_resolution")
                try:
                    validate_citation_resolution(citation_resolution)
                except OakError:
                    problems.append(f"检查结果 citation_resolution 非法：{relative}")
                else:
                    if (
                        not isinstance(settings_snapshot, dict)
                        or settings_snapshot.get("citation_resolution") != citation_resolution
                    ):
                        problems.append(
                            f"检查结果 citation_resolution 与设置快照不一致：{relative}"
                        )
            elif (
                isinstance(settings_snapshot, dict)
                and settings_snapshot.get("citation_resolution") is not None
            ):
                problems.append(f"检查结果缺少 citation_resolution：{relative}")

            if "format_coverage" in result:
                try:
                    validate_format_coverage(result.get("format_coverage"), allow_none=True)
                except OakError:
                    problems.append(f"检查结果 format_coverage 非法：{relative}")

            if "rulepack" in check:
                check_identity = check["rulepack"]
                try:
                    validate_rulepack_identity(check_identity)
                except OakError:
                    problems.append(f"检查记录规则包身份非法：{check_id}")
                    continue
                if check.get("rulepack_version") != check_identity["version"]:
                    problems.append(f"检查记录规则包显示版本与完整身份不一致：{check_id}")
                if result.get("rulepack") != check_identity:
                    problems.append(f"检查结果规则包身份与检查记录不一致：{relative}")
                continue

            # alpha.2 及更早的 format 1.0 检查记录没有完整 rulepack 字段；
            # 对应报告只保存 {name, version}。旧记录只能证明这组有限身份，
            # 不得把项目当前 pin 倒填成从未记录过的七字段历史身份。
            legacy_version = check.get("rulepack_version")
            report_identity = result.get("rulepack")
            if (
                not isinstance(report_identity, dict)
                or set(report_identity) != {"name", "version"}
                or not isinstance(legacy_version, str)
                or report_identity.get("version") != legacy_version
            ):
                problems.append(f"旧检查结果规则包身份与检查记录不一致：{relative}")
                continue
            try:
                validate_rulepack_identity(
                    {
                        "name": report_identity.get("name"),
                        "version": report_identity.get("version"),
                        "pinned": True,
                    },
                    allow_legacy=True,
                )
            except OakError:
                problems.append(f"旧检查结果规则包身份非法：{relative}")
        for cp in self.data.get("checkpoints", []):
            try:
                self._checkpoint_dir(cp)
            except (ProjectValidationError, OakError):
                problems.append(f"检查点目录缺失：{cp['path']}")
        self.data["integrity"] = {
            "last_verified_at": now_iso(),
            "source_hash_ok": not any("SHA-256" in p for p in problems),
        }
        self.save(_validate_source_hash=False)
        return problems


def _app_version() -> str:
    from . import __version__

    return __version__
