"""Web 上传的内容无关安全预检。

该模块只做确定性的格式、压缩结构和主动内容门禁，不声称替代杀毒引擎。
检查发生在临时对象存储和共享稿件核心之前，绝不解压到磁盘。
"""

from __future__ import annotations

import os
import stat
import unicodedata
import zipfile
import zlib
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree

from .errors import OakError

MAX_INPUT_BYTES = 50 * 1024 * 1024
MAX_MEMBERS = 4096
MAX_MEMBER_BYTES = 64 * 1024 * 1024
MAX_EXPANDED_BYTES = 256 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200

_FORMATS = frozenset({"docx", "md", "txt", "epub"})
_ZIP_FORMATS = frozenset({"docx", "epub"})
_ALLOWED_COMPRESSION = frozenset({zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED})
_EXECUTABLE_SUFFIXES = (
    ".bat", ".class", ".cmd", ".com", ".dll", ".exe", ".hta", ".jar",
    ".js", ".jse", ".lnk", ".mjs", ".msi", ".ps1", ".scr", ".vbs", ".vbe",
)
_DOCX_DENIED_PREFIXES = ("customui/", "word/activex/", "word/embeddings/")
_DOCX_DENIED_SUFFIXES = ("vbaproject.bin", "vbadata.xml")
_EPUB_MARKUP_SUFFIXES = (".xhtml", ".html", ".htm", ".svg")


def _unsafe(reason: str) -> None:
    raise OakError(f"Web 上传安全门禁拒绝该文档：{reason}。原文件未被修改。")


def _safe_member_name(raw_name: str, seen: set[str]) -> str:
    if not raw_name or "\x00" in raw_name or "\\" in raw_name or ":" in raw_name:
        _unsafe("压缩成员名称非法")
    normalized = unicodedata.normalize("NFC", raw_name)
    if normalized != raw_name or any(unicodedata.category(ch) == "Cc" for ch in normalized):
        _unsafe("压缩成员名称包含非规范或控制字符")
    path_text = normalized[:-1] if normalized.endswith("/") else normalized
    raw_parts = path_text.split("/")
    if not path_text or any(part in {"", ".", ".."} for part in raw_parts):
        _unsafe("压缩成员路径包含空段、点段或上级段")
    path = PurePosixPath(normalized)
    if normalized.startswith("/") or path.is_absolute() or ".." in path.parts:
        _unsafe("压缩成员路径可能逃逸")
    key = normalized.rstrip("/").casefold()
    if not key or key in seen:
        _unsafe("压缩成员名称重复或冲突")
    seen.add(key)
    return normalized.rstrip("/")


def _reject_active_member(name: str, document_format: str) -> None:
    folded = name.casefold()
    if folded.endswith(_EXECUTABLE_SUFFIXES):
        _unsafe("压缩包包含可执行或脚本成员")
    if document_format == "docx" and (
        folded.startswith(_DOCX_DENIED_PREFIXES) or folded.endswith(_DOCX_DENIED_SUFFIXES)
    ):
        _unsafe("DOCX 包含宏、ActiveX 或嵌入对象")


def _inspect_epub_markup(archive: zipfile.ZipFile, infos: list[zipfile.ZipInfo]) -> None:
    for info in infos:
        name = info.filename.rstrip("/")
        if info.is_dir() or not name.casefold().endswith(_EPUB_MARKUP_SUFFIXES):
            continue
        try:
            root = ElementTree.fromstring(archive.read(info))
        except (ElementTree.ParseError, OSError, RuntimeError, zipfile.BadZipFile) as exc:
            _unsafe("EPUB 标记文件损坏或不是安全 XML")
        for element in root.iter():
            if element.tag.rsplit("}", 1)[-1].casefold() == "script":
                _unsafe("EPUB 包含脚本元素")
            for key, value in element.attrib.items():
                attr = key.rsplit("}", 1)[-1].casefold()
                if attr.startswith("on") or (isinstance(value, str) and value.lstrip().casefold().startswith("javascript:")):
                    _unsafe("EPUB 包含事件处理器或 javascript URL")


def _inspect_docx_active_markup(archive: zipfile.ZipFile) -> None:
    try:
        content_types = archive.read("[Content_Types].xml").lower()
        document = ElementTree.fromstring(archive.read("word/document.xml"))
    except (KeyError, ElementTree.ParseError, OSError, RuntimeError, zipfile.BadZipFile):
        _unsafe("DOCX 核心 XML 损坏")
    if any(marker in content_types for marker in (
        b"macroenabled", b"vbaproject", b"activex", b"oleobject",
    )):
        _unsafe("DOCX 内容类型声明了宏或主动对象")
    for element in document.iter():
        local = element.tag.rsplit("}", 1)[-1].casefold()
        if local == "altchunk":
            _unsafe("DOCX 包含外部替代内容")
        if local == "instrtext" and isinstance(element.text, str):
            instruction = element.text.lstrip().casefold()
            if instruction == "dde" or instruction.startswith(("dde ", "ddeauto")):
                _unsafe("DOCX 包含 DDE 字段")


def _inspect_zip(path: Path, document_format: str) -> tuple[int, int]:
    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as exc:
        _unsafe("文件不是有效 ZIP 包格式")
    try:
        infos = archive.infolist()
        if not infos or len(infos) > MAX_MEMBERS:
            _unsafe("压缩成员数量为空或超过 Web 安全上限")
        total = 0
        seen: set[str] = set()
        safe_names: set[str] = set()
        for info in infos:
            name = _safe_member_name(info.filename, seen)
            safe_names.add(name.casefold())
            if info.flag_bits & 0x1:
                _unsafe("压缩包包含加密成员")
            mode = (info.external_attr >> 16) & 0o170000
            if mode == stat.S_IFLNK:
                _unsafe("压缩包包含符号链接成员")
            if mode not in {0, stat.S_IFREG, stat.S_IFDIR}:
                _unsafe("压缩包包含特殊文件成员")
            if info.compress_type not in _ALLOWED_COMPRESSION:
                _unsafe("压缩包使用未批准的压缩算法")
            if info.file_size < 0 or info.compress_size < 0 or info.file_size > MAX_MEMBER_BYTES:
                _unsafe("压缩成员大小非法或超过 Web 安全上限")
            total += info.file_size
            if total > MAX_EXPANDED_BYTES:
                _unsafe("压缩包总展开大小超过 Web 安全上限")
            if info.file_size > 0:
                if info.compress_size == 0 or info.file_size > info.compress_size * MAX_COMPRESSION_RATIO:
                    _unsafe("压缩成员膨胀比超过 Web 安全上限")
            if not info.is_dir():
                _reject_active_member(name, document_format)

        required = ({"[content_types].xml", "_rels/.rels", "word/document.xml"}
                    if document_format == "docx"
                    else {"mimetype", "meta-inf/container.xml"})
        if not required.issubset(safe_names):
            _unsafe(f"{document_format.upper()} 缺少必需包成员")
        if document_format == "epub":
            try:
                if archive.read("mimetype") != b"application/epub+zip":
                    _unsafe("EPUB mimetype 内容非法")
            except KeyError:
                _unsafe("EPUB 缺少 mimetype")
            _inspect_epub_markup(archive, infos)
        else:
            _inspect_docx_active_markup(archive)
        try:
            corrupt = archive.testzip()
        except (OSError, RuntimeError, zipfile.BadZipFile, zlib.error):
            _unsafe("压缩包展开或 CRC 校验失败")
        if corrupt is not None:
            _unsafe("压缩包成员 CRC 校验失败")
        return len(infos), total
    finally:
        archive.close()
def inspect_web_document(path: Path, document_format: str) -> dict:
    """检查 Web 上传并只返回内容无关统计。"""
    source = Path(path)
    if document_format not in _FORMATS:
        _unsafe("文档格式不受支持")
    try:
        info = os.lstat(source)
    except OSError:
        _unsafe("输入文件不可读取")
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        _unsafe("输入不是安全常规文件")
    if info.st_size < 1 or info.st_size > MAX_INPUT_BYTES:
        _unsafe("输入大小超过 Web 安全上限")
    with source.open("rb") as handle:
        prefix = handle.read(4)
    if document_format in _ZIP_FORMATS:
        if prefix != b"PK\x03\x04":
            _unsafe("压缩文档文件头与声明格式不一致")
        members, expanded = _inspect_zip(source, document_format)
    else:
        try:
            data = source.read_bytes()
        except OSError:
            _unsafe("输入文件不可读取")
        if b"\x00" in data:
            _unsafe("文本包含 NUL 字节")
        try:
            data.decode("utf-8-sig", errors="strict")
        except UnicodeDecodeError:
            _unsafe("文本不是有效 UTF-8")
        members, expanded = 0, len(data)
    return {
        "ok": True,
        "schema_version": "1.0",
        "inspection_type": "oak_manuscript_web_upload_inspection",
        "format": document_format,
        "size_bytes": info.st_size,
        "package_members": members,
        "expanded_bytes": expanded,
    }
