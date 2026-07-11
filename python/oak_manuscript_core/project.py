"""项目管理：创建 / 打开 / 检查点 / 完整性验证。

安全不变量（方案 §6.1）：
- source/ 中的原稿副本在创建后绝不被本模块之外的任何代码写入；
- 原稿 SHA-256 记录于 project.json，verify() 随时可证明不变；
- 检查点最多 5 个，清理只删最旧，绝不触碰 source/。
"""

from __future__ import annotations

import os
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

    def make_checkpoint(self, *, reason: str) -> dict:
        self.data["checkpoint_seq"] += 1
        cp_id = f"cp-{self.data['checkpoint_seq']:04d}"
        cp_dir = self.root / "checkpoints" / cp_id
        cp_dir.mkdir(parents=True)
        shutil.copyfile(self.working_path, cp_dir / self.stored_filename)
        issues = self.root / "reports" / "issues.json"
        if issues.is_file():
            shutil.copyfile(issues, cp_dir / "issues.json")
        entry = {
            "checkpoint_id": cp_id,
            "created_at": now_iso(),
            "reason": reason,
            "path": f"checkpoints/{cp_id}",
            "working_sha256": sha256_file(self.working_path),
        }
        self.data["checkpoints"].append(entry)
        while len(self.data["checkpoints"]) > MAX_CHECKPOINTS:
            oldest = self.data["checkpoints"].pop(0)
            shutil.rmtree(self.root / oldest["path"], ignore_errors=True)
        self.save()
        return entry

    def restore_checkpoint(self, checkpoint_id: str) -> None:
        entry = next(
            (c for c in self.data["checkpoints"] if c["checkpoint_id"] == checkpoint_id), None
        )
        if entry is None:
            raise OakError(f"检查点不存在：{checkpoint_id}")
        cp_dir = self.root / entry["path"]
        shutil.copyfile(cp_dir / self.stored_filename, self.working_path)
        cp_issues = cp_dir / "issues.json"
        if cp_issues.is_file():
            shutil.copyfile(cp_issues, self.root / "reports" / "issues.json")
        self.save()

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
