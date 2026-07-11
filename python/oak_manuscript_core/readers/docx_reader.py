"""DOCX 读取器：zipfile + xml.etree，产出统一文档模型（只读）。"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from ..errors import OakError
from ..model import DocxDocument, Footnote, Paragraph
from ..safety import ZipLimits, open_zip_safely

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_SEPARATOR_TYPES = {"separator", "continuationSeparator"}


def read_docx(path: Path | str, limits: ZipLimits | None = None) -> DocxDocument:
    path = Path(path)
    with open_zip_safely(path, limits) as zf:
        names = set(zf.namelist())
        if "word/document.xml" not in names:
            raise OakError(
                f"「{path.name}」缺少 word/document.xml，不是有效的 Word 文档。原文件未被修改。"
            )
        try:
            root = ET.fromstring(zf.read("word/document.xml"))
        except ET.ParseError as exc:
            raise OakError(
                f"「{path.name}」的文档主体无法解析（XML 损坏）。原文件未被修改。"
            ) from exc

        style_levels = _parse_style_levels(zf, names)
        footnotes = _parse_footnotes(zf, names, path.name)

    body = root.find(f"{W}body")
    if body is None:
        raise OakError(f"「{path.name}」缺少文档主体（w:body）。原文件未被修改。")

    doc = DocxDocument(footnotes=footnotes)
    for i, p_el in enumerate(body.iter(f"{W}p"), start=1):
        para = _parse_paragraph(p_el, i, style_levels)
        doc.paragraphs.append(para)
        doc.footnote_ref_ids.extend(para.footnote_refs)
    return doc


def _parse_style_levels(zf, names) -> dict[str, int]:
    """styleId → 标题级别（1 起）。依据 outlineLvl 或样式名 heading N / 标题 N。"""
    levels: dict[str, int] = {}
    if "word/styles.xml" not in names:
        return levels
    try:
        root = ET.fromstring(zf.read("word/styles.xml"))
    except ET.ParseError:
        return levels
    for style in root.iter(f"{W}style"):
        style_id = style.get(f"{W}styleId")
        if not style_id:
            continue
        level = None
        outline = style.find(f"{W}pPr/{W}outlineLvl")
        if outline is not None:
            try:
                level = int(outline.get(f"{W}val", "")) + 1
            except ValueError:
                level = None
        if level is None:
            name_el = style.find(f"{W}name")
            name = (name_el.get(f"{W}val", "") if name_el is not None else "").lower()
            for prefix in ("heading ", "标题 ", "标题"):
                if name.startswith(prefix):
                    tail = name[len(prefix):].strip()
                    if tail.isdigit():
                        level = int(tail)
                        break
        if level is not None and 1 <= level <= 9:
            levels[style_id] = level
    return levels


def _parse_footnotes(zf, names, filename: str) -> list[Footnote]:
    if "word/footnotes.xml" not in names:
        return []
    try:
        root = ET.fromstring(zf.read("word/footnotes.xml"))
    except ET.ParseError as exc:
        raise OakError(f"「{filename}」的脚注部分无法解析（XML 损坏）。原文件未被修改。") from exc
    notes: list[Footnote] = []
    for fn in root.iter(f"{W}footnote"):
        if fn.get(f"{W}type") in _SEPARATOR_TYPES:
            continue
        try:
            note_id = int(fn.get(f"{W}id", ""))
        except ValueError:
            continue
        text = "".join(t.text or "" for t in fn.iter(f"{W}t"))
        notes.append(Footnote(note_id=note_id, text=text))
    return notes


def _parse_paragraph(p_el, index: int, style_levels: dict[str, int]) -> Paragraph:
    style_el = p_el.find(f"{W}pPr/{W}pStyle")
    style_id = style_el.get(f"{W}val") if style_el is not None else None

    pieces: list[str] = []
    tab_count = 0
    has_drawing = False
    refs: list[int] = []
    for run in p_el.findall(f".//{W}r"):
        for child in run.iter():
            tag = child.tag
            if tag == f"{W}t":
                pieces.append(child.text or "")
            elif tag == f"{W}tab":
                pieces.append("\t")
                tab_count += 1
            elif tag == f"{W}footnoteReference":
                try:
                    refs.append(int(child.get(f"{W}id", "")))
                except ValueError:
                    pass
            elif tag in (f"{W}drawing", f"{W}pict"):
                has_drawing = True

    return Paragraph(
        part="document",
        index=index,
        text="".join(pieces),
        style_id=style_id,
        heading_level=style_levels.get(style_id) if style_id else None,
        tab_count=tab_count,
        has_drawing=has_drawing,
        has_sectpr=p_el.find(f"{W}pPr/{W}sectPr") is not None,
        footnote_refs=refs,
    )
