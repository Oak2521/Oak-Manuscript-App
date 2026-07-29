"""TXT/Markdown 的保守空白卫生规则；全部只提示，不自动修复。"""

from __future__ import annotations

import re

from ..model import DocxDocument, TextLine
from . import rule
from .common import finding, make_preview

_MULTI_SPACE = re.compile(r" {2,}")


def _lines(doc: DocxDocument) -> list[TextLine]:
    return list(getattr(doc, "source_lines", ()))


def _protected(line: TextLine) -> bool:
    return line.protected_context is not None or line.layout_sensitive


def _overlaps(start: int, end: int, ranges: tuple[tuple[int, int], ...]) -> bool:
    return any(start < protected_end and end > protected_start
               for protected_start, protected_end in ranges)


@rule("TEXT-EMPTY-001")
def empty_text_document(doc: DocxDocument, ctx: dict) -> list[dict]:
    lines = _lines(doc)
    if any(line.text.strip() for line in lines):
        return []
    return [finding(line=1, preview="文件没有可检查的文字内容")]


@rule("TEXT-SPACE-001")
def repeated_spaces_in_text(doc: DocxDocument, ctx: dict) -> list[dict]:
    findings: list[dict] = []
    for line in _lines(doc):
        if _protected(line):
            continue
        for match in _MULTI_SPACE.finditer(line.text):
            if line.hard_break_start is not None and match.start() >= line.hard_break_start:
                continue
            if _overlaps(match.start(), match.end(), line.inline_code_ranges):
                continue
            findings.append(finding(
                line=line.number,
                preview=make_preview(line.text, match.start(), match.end()),
            ))
    return findings


@rule("TEXT-TAB-001")
def tabs_in_text(doc: DocxDocument, ctx: dict) -> list[dict]:
    findings: list[dict] = []
    for line in _lines(doc):
        if _protected(line):
            continue
        for match in re.finditer("\t", line.text):
            if _overlaps(match.start(), match.end(), line.inline_code_ranges):
                continue
            marked = line.text[:match.start()] + "【⇥】" + line.text[match.end():]
            findings.append(finding(
                line=line.number,
                preview=make_preview(marked, match.start(), match.start() + len("【⇥】")),
            ))
    return findings


@rule("TEXT-BLANK-001")
def excessive_blank_lines(doc: DocxDocument, ctx: dict) -> list[dict]:
    lines = _lines(doc)
    if not any(line.text.strip() for line in lines):
        return []
    findings: list[dict] = []
    cursor = 0
    while cursor < len(lines):
        if lines[cursor].text.strip() or lines[cursor].protected_context is not None:
            cursor += 1
            continue
        start = cursor
        while cursor < len(lines) and (
            not lines[cursor].text.strip()
            and lines[cursor].protected_context is None
        ):
            cursor += 1
        run = lines[start:cursor]
        if len(run) < 3:
            continue
        previous = lines[start - 1] if start > 0 else None
        following = lines[cursor] if cursor < len(lines) else None
        if ((previous and previous.layout_sensitive) or
                (following and following.layout_sensitive)):
            continue
        findings.append(finding(
            line=run[0].number,
            preview=f"从第 {run[0].number} 行起连续 {len(run)} 个空行",
        ))
    return findings
