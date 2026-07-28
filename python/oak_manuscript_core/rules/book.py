"""纸质出版物规则（M2）：BOOK-STRUCT-001/002、BOOK-PAGE-001、REF-CHI-001。"""

from __future__ import annotations

import re

from ..model import Document
from . import rule
from .common import finding, make_preview
from .structure import is_ref_heading

_TOC_TITLES = {"目录", "目 录", "contents", "table of contents"}
# 手工分页/分节的聚合提示阈值（低于此数量不打扰作者）
_PAGE_BREAK_THRESHOLD = 3
# 目录条目归一化：去尾部引导符（点线）与页码
_TOC_TAIL = re.compile(r"[ .·…‥]+\d+$")


def _normalize_toc(text: str) -> str:
    norm = re.sub(r"\s+", " ", text.strip())
    return _TOC_TAIL.sub("", norm).strip()


@rule("BOOK-STRUCT-001")
def no_chapter_structure(doc: Document, ctx: dict) -> list[dict]:
    if any(p.heading_level is not None for p in doc.paragraphs):
        return []
    if not any(p.text.strip() for p in doc.paragraphs):
        return []  # 空文档不重复报（读取层已保证可读）
    return [finding(paragraph=1, preview="全文未使用任何标题样式划分章节")]


@rule("BOOK-STRUCT-002")
def toc_heading_mismatch(doc: Document, ctx: dict) -> list[dict]:
    toc_pos = None
    for pos, para in enumerate(doc.paragraphs):
        if para.text.strip().lower() in _TOC_TITLES:
            toc_pos = pos
            break
    if toc_pos is None:
        return []

    entries = []
    for para in doc.paragraphs[toc_pos + 1:]:
        if para.heading_level is not None:
            break
        if para.text.strip():
            entries.append(para)

    heading_texts = {
        _normalize_toc(p.text) for p in doc.paragraphs if p.heading_level is not None
    }
    findings = []
    for para in entries:
        norm = _normalize_toc(para.text)
        if norm and norm not in heading_texts:
            findings.append(
                finding(paragraph=para.index,
                        preview=make_preview(f"目录条目「{norm}」未找到对应章节标题"))
            )
    return findings


@rule("BOOK-PAGE-001")
def manual_page_breaks(doc: Document, ctx: dict) -> list[dict]:
    total = 0
    first_index = None
    for para in doc.paragraphs:
        hits = para.page_break_count + (1 if para.has_sectpr else 0)
        if hits and first_index is None:
            first_index = para.index
        total += hits
    if total < _PAGE_BREAK_THRESHOLD:
        return []
    return [
        finding(paragraph=first_index,
                preview=f"共 {total} 处手工分页符 / 分节符（阈值 {_PAGE_BREAK_THRESHOLD}）")
    ]


@rule("REF-CHI-001")
def chicago_notes_bibliography(doc: Document, ctx: dict) -> list[dict]:
    # 只有正文实际引用、且对应定义非空的注释才构成 Chicago 注释结构。
    # 未引用的残留定义与空注释由其它规则处理，不能让本规则误判为“有注释”。
    nonempty_note_ids = {
        note.note_id for note in doc.footnotes if note.text.strip()
    }
    referenced_nonempty_note_ids = {
        note_id for note_id in doc.footnote_ref_ids if note_id in nonempty_note_ids
    }
    has_notes = bool(referenced_nonempty_note_ids)
    has_biblio = any(is_ref_heading(p.text) for p in doc.paragraphs)
    if has_notes and not has_biblio:
        return [
            finding(paragraph=1,
                    preview=f"发现 {len(referenced_nonempty_note_ids)} 条正文实际引用且非空的注释，"
                            "但未找到书目（参考文献）部分")
        ]
    if has_biblio and not has_notes:
        return [
            finding(
                paragraph=1,
                preview="存在书目部分，但未发现正文实际引用且非空的脚注 / 尾注",
            )
        ]
    return []
