"""参考文献规则：REF-001..004、REF-GBT-001..003（顺序编码制，M1）。

仅做结构性一致性检查：不判断条目内容真实性，不猜测文献类型。
文内引用识别限于单个编号形式 [n]；区间与并列（[1-3]、[1,2]）留待后续版本，
届时须升规则包版本并补样本（方案 §9.3）。
"""

from __future__ import annotations

import re

from ..model import DocxDocument, Paragraph
from . import rule
from .common import finding, make_preview
from .structure import is_ref_heading

_CITE = re.compile(r"\[(\d+)\]")
_ENTRY_NUM = re.compile(r"^\[(\d+)\]\s*(.*)$", re.S)
_TYPE_CODE = re.compile(r"\[[A-Z]{1,2}(?:/[A-Z]{2})?\]")
_YEAR = re.compile(r"(?:19|20)\d{2}")
_FULLWIDTH_PUNCT = re.compile(r"[，。；：、]")
_HALFWIDTH_PUNCT = re.compile(r"[,.;:]")


def _section_pos(doc: DocxDocument) -> int | None:
    for pos, para in enumerate(doc.paragraphs):
        if is_ref_heading(para.text):
            return pos
    return None


def _entries(doc: DocxDocument, section_pos: int) -> list[tuple[Paragraph, int | None, str]]:
    """(段落, 编号或 None, 去编号后的条目文本)。到下一个标题或文档结束为止。"""
    entries = []
    for para in doc.paragraphs[section_pos + 1:]:
        if para.heading_level is not None:
            break
        text = para.text.strip()
        if not text:
            continue
        m = _ENTRY_NUM.match(text)
        if m:
            entries.append((para, int(m.group(1)), m.group(2).strip()))
        else:
            entries.append((para, None, text))
    return entries


def _citations(doc: DocxDocument, section_pos: int) -> list[tuple[int, Paragraph, re.Match]]:
    cites = []
    for para in doc.paragraphs[:section_pos]:
        for m in _CITE.finditer(para.text):
            cites.append((int(m.group(1)), para, m))
    return cites


@rule("REF-001")
def duplicate_entries(doc: DocxDocument, ctx: dict) -> list[dict]:
    pos = _section_pos(doc)
    if pos is None:
        return []
    seen: dict[str, Paragraph] = {}
    findings = []
    for para, _num, body in _entries(doc, pos):
        key = re.sub(r"\s+", "", body).casefold()
        if not key:
            continue
        if key in seen:
            findings.append(
                finding(paragraph=para.index,
                        preview=make_preview(f"与第 {seen[key].index} 段条目重复：{body}"))
            )
        else:
            seen[key] = para
    return findings


@rule("REF-002")
def citation_without_entry(doc: DocxDocument, ctx: dict) -> list[dict]:
    pos = _section_pos(doc)
    if pos is None:
        return []
    entry_nums = {num for _p, num, _b in _entries(doc, pos) if num is not None}
    findings = []
    for num, para, m in _citations(doc, pos):
        if num not in entry_nums:
            findings.append(
                finding(paragraph=para.index,
                        preview=make_preview(para.text, m.start(), m.end()))
            )
    return findings


@rule("REF-003")
def entry_never_cited(doc: DocxDocument, ctx: dict) -> list[dict]:
    pos = _section_pos(doc)
    if pos is None:
        return []
    cites = _citations(doc, pos)
    if not cites:
        return []  # 正文没有任何编号引用时，不假定顺序编码制
    cited = {num for num, _p, _m in cites}
    findings = []
    for para, num, body in _entries(doc, pos):
        if num is not None and num not in cited:
            findings.append(
                finding(paragraph=para.index, preview=make_preview(f"[{num}] {body}"))
            )
    return findings


@rule("REF-004")
def entry_numbering_gap(doc: DocxDocument, ctx: dict) -> list[dict]:
    pos = _section_pos(doc)
    if pos is None:
        return []
    findings = []
    prev = None
    for para, num, _body in _entries(doc, pos):
        if num is None:
            continue
        if prev is not None and num != prev + 1:
            findings.append(
                finding(paragraph=para.index,
                        preview=make_preview(f"编号从 [{prev}] 跳到 [{num}]"))
            )
        prev = num
    return findings


@rule("REF-GBT-001")
def missing_type_code(doc: DocxDocument, ctx: dict) -> list[dict]:
    pos = _section_pos(doc)
    if pos is None:
        return []
    findings = []
    for para, num, body in _entries(doc, pos):
        if not _TYPE_CODE.search(body):
            findings.append(finding(paragraph=para.index, preview=make_preview(body)))
    return findings


@rule("REF-GBT-002")
def missing_year(doc: DocxDocument, ctx: dict) -> list[dict]:
    pos = _section_pos(doc)
    if pos is None:
        return []
    findings = []
    for para, _num, body in _entries(doc, pos):
        if not _YEAR.search(body):
            findings.append(finding(paragraph=para.index, preview=make_preview(body)))
    return findings


# v2 通用作者—年份括注：
# - APA：      (Smith, 2020)
# - Chicago：  (Smith 2020)
# - 中文作者： （王小明，2020）/（王小明 2020）
# 只核对首位作者与年份；多引文并列及叙述式引用仍不在本规则范围内。
# 该模式与 citation signal extractor 1.0.0 保持相同的结构边界。
_AUTHOR = r"(?:[A-Z][A-Za-z'\u2019-]{0,79}|[\u3400-\u9fff]{2,8})"
_AUTHOR_YEAR_CITE = re.compile(
    rf"[\(\uff08]\s*({_AUTHOR})"
    rf"(?:\s*(?:&|and|与|和)\s*{_AUTHOR})?"
    r"(?:\s+et\s+al\.|\s*等)?"
    r"\s*(?:[,\uff0c]\s*|\s+)"
    r"((?:19|20)\d{2})[a-z]?\s*[\)\uff09]",
    re.I,
)


def _entry_has_author_year(body: str, author: str, year: str) -> bool:
    if year not in body:
        return False
    if any("\u3400" <= character <= "\u9fff" for character in author):
        return author in body
    author_pattern = re.compile(
        rf"(?<![A-Za-z]){re.escape(author)}(?![A-Za-z])",
        re.I,
    )
    return author_pattern.search(body) is not None


@rule("REF-APA-001")
def apa_citation_without_entry(doc: DocxDocument, ctx: dict) -> list[dict]:
    """文内作者—年份括注 → 参考文献条目的单向结构核对。"""
    pos = _section_pos(doc)
    if pos is None:
        return []
    entries = _entries(doc, pos)
    findings = []
    for para in doc.paragraphs[:pos]:
        for m in _AUTHOR_YEAR_CITE.finditer(para.text):
            author, year = m.group(1), m.group(2)
            matched = any(_entry_has_author_year(body, author, year)
                          for _p, _num, body in entries)
            if not matched:
                findings.append(
                    finding(paragraph=para.index,
                            preview=make_preview(para.text, m.start(), m.end()))
                )
    return findings


@rule("REF-GBT-003")
def mixed_width_punctuation(doc: DocxDocument, ctx: dict) -> list[dict]:
    pos = _section_pos(doc)
    if pos is None:
        return []
    findings = []
    for para, _num, body in _entries(doc, pos):
        if _FULLWIDTH_PUNCT.search(body) and _HALFWIDTH_PUNCT.search(body):
            findings.append(finding(paragraph=para.index, preview=make_preview(body)))
    return findings
