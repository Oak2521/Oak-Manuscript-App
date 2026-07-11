"""标点类规则：DOCX-PUNCT-001、PUNCT-MIX-001/002。"""

from __future__ import annotations

import re

from ..model import DocxDocument
from . import rule
from .common import finding, make_preview

# 重复全角标点；省略号（……）与破折号（——）不在字符集内，天然豁免
_REPEATED = re.compile(r"([。，、；：？！])\1+")
# 中文字符紧邻半角标点（两侧都是 CJK 才算，版本号 3.11、著录符号「. 」不命中）
_HALF_BETWEEN_CJK = re.compile(r"(?<=[一-鿿])[,.;:?!](?=[一-鿿])")
# 半角括号包裹含中文的内容
_HALF_PARENS_CJK = re.compile(r"\([^()\n]*[一-鿿][^()\n]*\)")


@rule("DOCX-PUNCT-001")
def repeated_punctuation(doc: DocxDocument, ctx: dict) -> list[dict]:
    findings = []
    for para in doc.paragraphs:
        for m in _REPEATED.finditer(para.text):
            findings.append(
                finding(paragraph=para.index, preview=make_preview(para.text, m.start(), m.end()))
            )
    return findings


@rule("PUNCT-MIX-001")
def halfwidth_in_cjk(doc: DocxDocument, ctx: dict) -> list[dict]:
    findings = []
    for para in doc.paragraphs:
        for m in _HALF_BETWEEN_CJK.finditer(para.text):
            findings.append(
                finding(paragraph=para.index, preview=make_preview(para.text, m.start(), m.end()))
            )
    return findings


@rule("PUNCT-MIX-002")
def halfwidth_parens_cjk(doc: DocxDocument, ctx: dict) -> list[dict]:
    findings = []
    for para in doc.paragraphs:
        for m in _HALF_PARENS_CJK.finditer(para.text):
            findings.append(
                finding(paragraph=para.index, preview=make_preview(para.text, m.start(), m.end()))
            )
    return findings
