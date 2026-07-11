"""文件与压缩包安全（方案 §12.4）：ZIP 上限、路径穿越、导出目录校验。"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .errors import OakError

_DRIVE_RE = re.compile(r"^[A-Za-z]:")


@dataclass
class ZipLimits:
    max_members: int = 10_000
    max_member_bytes: int = 209_715_200      # 200 MB
    max_total_bytes: int = 1_073_741_824     # 1 GB


def open_zip_safely(path: Path, limits: ZipLimits | None = None) -> zipfile.ZipFile:
    """打开 ZIP 并做安全校验。失败抛 OakError，绝不写入任何文件。"""
    limits = limits or ZipLimits()
    try:
        zf = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise OakError(
            f"无法读取「{Path(path).name}」：不是有效的压缩文档，文件可能已损坏。"
            "原文件未被修改。可尝试用 Word 重新另存后再检查。"
        ) from exc

    infos = zf.infolist()
    if len(infos) > limits.max_members:
        zf.close()
        raise OakError(f"压缩包成员数量（{len(infos)}）超过安全上限（{limits.max_members}），已拒绝处理。")

    total = 0
    for info in infos:
        name = info.filename
        parts = PurePosixPath(name.replace("\\", "/")).parts
        if name.startswith(("/", "\\")) or _DRIVE_RE.match(name) or ".." in parts:
            zf.close()
            raise OakError(f"压缩包内存在不安全的成员路径「{name}」，已拒绝处理（防路径穿越）。")
        if info.file_size > limits.max_member_bytes:
            zf.close()
            raise OakError(
                f"压缩包成员「{name}」解压后大小超过安全上限"
                f"（{info.file_size} > {limits.max_member_bytes} 字节），已拒绝处理。"
            )
        total += info.file_size
    if total > limits.max_total_bytes:
        zf.close()
        raise OakError(
            f"压缩包总解压大小（{total} 字节）超过安全上限（{limits.max_total_bytes} 字节），已拒绝处理。"
        )
    return zf


def ensure_within(base: Path, candidate: Path) -> Path:
    """校验 candidate（解析后）位于 base 之内，防目录逃逸。返回解析后的路径。"""
    base_resolved = Path(base).resolve()
    resolved = Path(candidate).resolve()
    try:
        resolved.relative_to(base_resolved)
    except ValueError:
        raise OakError(f"目标路径超出允许目录范围，已拒绝写入：{resolved}") from None
    return resolved
