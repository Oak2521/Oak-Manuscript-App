"""白名单机械修复（方案 §5.4）。

纪律：
- 只接受 WHITELIST 内的 fix_id，其余一律拒绝（OakError）；
- 只改写传入路径的文件（调用方保证它是 working 副本，且已建检查点）；
- 幂等：对已修复文件再次运行，计数全为 0 且字节不变；
- 保留段内格式：以 run 为单位做文本级改写，不合并、不重排 run。
"""

from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from .errors import OakError
from .safety import open_zip_safely

_W_URI = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = "{" + _W_URI + "}"
_XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

_DOCX_FIXES = frozenset({"FIX-SPACE-001", "FIX-TAB-001", "FIX-EMPTYPARA-001", "FIX-PUNCT-001"})
_EPUB_FIXES = frozenset({"FIX-EPUB-MIME-001", "FIX-EPUB-LANG-001"})
WHITELIST = _DOCX_FIXES | _EPUB_FIXES

_PUNCT_SET = "。，、；：？！"
_REPEAT_PUNCT = re.compile(r"([。，、；：？！])\1+")
_MULTI_SPACE = re.compile(r" {2,}")
_MIMETYPE_VALUE = b"application/epub+zip"


def apply_fixes(path: Path | str, fix_ids: set[str]) -> dict[str, int]:
    """按文件格式分发白名单修复，返回每项修复的操作计数。

    与文件格式不匹配的白名单 fix_id 记 0 且不改动文件（如对 EPUB 传 DOCX 修复）。
    """
    path = Path(path)
    fix_ids = set(fix_ids)
    unknown = fix_ids - WHITELIST
    if unknown:
        raise OakError(
            f"拒绝执行白名单之外的修复：{sorted(unknown)}。"
            "自动修复仅限规则包冻结的白名单（方案 §24 第 8 条）。"
        )
    counts = {fid: 0 for fid in sorted(fix_ids)}
    ext = path.suffix.lower()
    if ext == ".docx":
        if fix_ids & _DOCX_FIXES:
            _apply_docx_fixes(path, fix_ids & _DOCX_FIXES, counts)
    elif ext == ".epub":
        if fix_ids & _EPUB_FIXES:
            _apply_epub_fixes(path, fix_ids & _EPUB_FIXES, counts)
    else:
        raise OakError(f"「{ext}」格式没有可用的自动修复。文件未被修改。")
    return counts


def _apply_docx_fixes(path: Path, fix_ids: set[str], counts: dict[str, int]) -> None:
    with open_zip_safely(path) as zf:
        infos = zf.infolist()
        raw = {info.filename: zf.read(info.filename) for info in infos}
    if "word/document.xml" not in raw:
        raise OakError(f"「{path.name}」缺少 word/document.xml，无法修复。文件未被修改。")

    root = ET.fromstring(raw["word/document.xml"])
    body = root.find(f"{W}body")
    if body is None:
        raise OakError(f"「{path.name}」缺少文档主体，无法修复。文件未被修改。")

    paragraphs = list(body.iter(f"{W}p"))

    # 处理顺序固定：制表符 → 重复标点 → 连续空格 → 空段落（保证组合结果确定）
    if "FIX-TAB-001" in fix_ids:
        for p in paragraphs:
            counts["FIX-TAB-001"] += _replace_tabs(p)
    if "FIX-PUNCT-001" in fix_ids:
        for p in paragraphs:
            counts["FIX-PUNCT-001"] += _collapse_repeated_punct(p)
    if "FIX-SPACE-001" in fix_ids:
        for p in paragraphs:
            counts["FIX-SPACE-001"] += _collapse_spaces(p)
    if "FIX-EMPTYPARA-001" in fix_ids:
        counts["FIX-EMPTYPARA-001"] += _collapse_empty_paragraphs(body)

    if sum(counts.values()) == 0:
        return  # 零改动：不重写文件，保证字节级幂等

    _normalize_space_attrs(root)
    ET.register_namespace("w", _W_URI)
    new_doc = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + ET.tostring(root, encoding="unicode")
    ).encode("utf-8")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as out:
        for info in infos:
            data = new_doc if info.filename == "word/document.xml" else raw[info.filename]
            out.writestr(info, data)
    path.write_bytes(buf.getvalue())


# ---- EPUB 修复（M3）----

def _apply_epub_fixes(path: Path, fix_ids: set[str], counts: dict[str, int]) -> None:
    from .readers.epub_reader import read_epub

    book = read_epub(path)
    with open_zip_safely(path) as zf:
        entries = [(info, zf.read(info.filename)) for info in zf.infolist()]

    changed = False

    # FIX-EPUB-LANG-001：仅当 OPF 声明了 dc:language 才补写；语言未知不擅自猜测
    if "FIX-EPUB-LANG-001" in fix_ids and book.language:
        targets = {d.href for d in book.docs if not d.has_lang}
        if targets:
            new_entries = []
            for info, data in entries:
                if info.filename in targets:
                    data = _add_lang_to_xhtml(data, book.language)
                    counts["FIX-EPUB-LANG-001"] += 1
                    changed = True
                new_entries.append((info, data))
            entries = new_entries

    # FIX-EPUB-MIME-001：重建为「第一个成员、不压缩、内容准确」
    if "FIX-EPUB-MIME-001" in fix_ids and not book.mimetype_ok:
        entries = [(info, data) for info, data in entries if info.filename != "mimetype"]
        info = zipfile.ZipInfo("mimetype", date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_STORED
        entries.insert(0, (info, _MIMETYPE_VALUE))
        counts["FIX-EPUB-MIME-001"] += 1
        changed = True

    if not changed:
        return  # 零改动不重写，字节级幂等

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as out:
        for info, data in entries:
            out.writestr(info, data)
    path.write_bytes(buf.getvalue())


def _add_lang_to_xhtml(data: bytes, language: str) -> bytes:
    ET.register_namespace("", "http://www.w3.org/1999/xhtml")
    ET.register_namespace("epub", "http://www.idpf.org/2007/ops")
    root = ET.fromstring(data)
    root.set("lang", language)
    root.set("{http://www.w3.org/XML/1998/namespace}lang", language)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


# ---- 段内文本流（保持 run 边界） ----

def _text_stream(p):
    """按文档顺序产出段内 w:t / w:tab 节点（w:pPr 中的制表位定义不在其列）。"""
    for run in p.findall(f".//{W}r"):
        for child in run:
            if child.tag in (f"{W}t", f"{W}tab"):
                yield run, child


def _replace_tabs(p) -> int:
    changed = 0
    for run, child in list(_text_stream(p)):
        if child.tag == f"{W}tab":
            pos = list(run).index(child)
            run.remove(child)
            t = ET.Element(f"{W}t")
            t.text = " "
            t.set(_XML_SPACE, "preserve")
            run.insert(pos, t)
            changed += 1
    return changed


def _collapse_repeated_punct(p) -> int:
    changed = 0
    last = ""
    for _run, node in _text_stream(p):
        if node.tag == f"{W}tab":
            last = "\t"
            continue
        text = node.text or ""
        text, n = _REPEAT_PUNCT.subn(r"\1", text)
        changed += n
        while text and last in _PUNCT_SET and text[0] == last:
            text = text[1:]
            changed += 1
        node.text = text
        if text:
            last = text[-1]
    return changed


def _collapse_spaces(p) -> int:
    changed = 0
    last = ""
    for _run, node in _text_stream(p):
        if node.tag == f"{W}tab":
            last = "\t"
            continue
        text = node.text or ""
        text, n = _MULTI_SPACE.subn(" ", text)
        changed += n
        if last == " " and text.startswith(" "):
            text = text.lstrip(" ")
            changed += 1
        node.text = text
        if text:
            last = text[-1]
    return changed


# ---- 空段落 ----

def _paragraph_is_empty(p) -> bool:
    if p.find(f"{W}pPr/{W}sectPr") is not None:
        return False
    for run in p.findall(f".//{W}r"):
        for child in run:
            tag = child.tag
            if tag == f"{W}t" and (child.text or "").strip():
                return False
            if tag in (f"{W}tab", f"{W}drawing", f"{W}pict", f"{W}footnoteReference"):
                return False
    return True


def _collapse_empty_paragraphs(body) -> int:
    """body 直接子级中，连续空段保留第一个、删除其余。"""
    removed = 0
    run: list = []
    for el in list(body):
        if el.tag == f"{W}p" and _paragraph_is_empty(el):
            run.append(el)
        else:
            for extra in run[1:]:
                body.remove(extra)
                removed += 1
            run = []
    for extra in run[1:]:
        body.remove(extra)
        removed += 1
    return removed


def _normalize_space_attrs(root) -> None:
    """凡文本含首尾空白的 w:t 标注 xml:space=preserve，防止 Word 吞空格。"""
    for t in root.iter(f"{W}t"):
        text = t.text or ""
        if text != text.strip():
            t.set(_XML_SPACE, "preserve")
