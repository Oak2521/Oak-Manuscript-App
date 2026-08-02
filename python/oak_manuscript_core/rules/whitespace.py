"""空白类规则：DOCX-SPACE-001/002/003、DOCX-PARA-001。"""

from __future__ import annotations

import re

from ..model import DocxDocument
from . import rule
from .common import finding, make_preview

_MULTI_SPACE = re.compile(r" {2,}")
_LEADING = (" ", "　")


@rule("DOCX-SPACE-001")
def multiple_spaces(doc: DocxDocument, ctx: dict) -> list[dict]:
    findings = []
    for para in doc.paragraphs:
        for m in _MULTI_SPACE.finditer(para.text):
            findings.append(
                finding(paragraph=para.index, preview=make_preview(para.text, m.start(), m.end()))
            )
    return findings


@rule("DOCX-SPACE-002")
def tabs_in_body(doc: DocxDocument, ctx: dict) -> list[dict]:
    findings = []
    for para in doc.paragraphs:
        # fixer 会替换全文中的每一个 TAB，因此必须逐个生成 finding；否则一个段落
        # 含多个 TAB 时，集中预览只展示一项却会实际修改多处。
        for match in re.finditer("\t", para.text):
            pos = match.start()
            marked = para.text[:pos] + "【⇥】" + para.text[pos + 1:]
            findings.append(
                finding(paragraph=para.index,
                        preview=make_preview(marked, pos, pos + len("【⇥】")))
            )
    return findings


@rule("DOCX-SPACE-003")
def leading_indent_spaces(doc: DocxDocument, ctx: dict) -> list[dict]:
    findings = []
    for para in doc.paragraphs:
        if para.text and para.text[0] in _LEADING and para.text.strip():
            findings.append(finding(paragraph=para.index, preview=make_preview(para.text, 0, 1)))
    return findings


@rule("DOCX-PARA-001")
def consecutive_empty_paragraphs(doc: DocxDocument, ctx: dict) -> list[dict]:
    findings = []
    run_start = None
    run_len = 0
    for para in doc.paragraphs:
        if para.is_empty:
            if run_start is None:
                run_start = para.index
            run_len += 1
        else:
            if run_start is not None and run_len >= 2:
                findings.append(finding(paragraph=run_start, preview=f"连续 {run_len} 个空段落"))
            run_start, run_len = None, 0
    if run_start is not None and run_len >= 2:
        findings.append(finding(paragraph=run_start, preview=f"连续 {run_len} 个空段落"))
    return findings
