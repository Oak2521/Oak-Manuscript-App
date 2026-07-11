"""标题规则：HEAD-STRUCT-001 层级跳级、HEAD-STRUCT-002 编号断裂。"""

from __future__ import annotations

import re

from ..model import DocxDocument
from . import rule
from .common import finding, make_preview

# 阿拉伯数字点分编号开头：1 / 1.1 / 2.3.4，后随空白、点、顿号或括号
_NUM_PREFIX = re.compile(r"^(\d+(?:\.\d+)*)(?=[\s.．、）)]|$)")


@rule("HEAD-STRUCT-001")
def heading_level_jump(doc: DocxDocument, ctx: dict) -> list[dict]:
    findings = []
    prev_level = None
    for para in doc.paragraphs:
        if para.heading_level is None:
            continue
        if prev_level is not None and para.heading_level > prev_level + 1:
            findings.append(
                finding(paragraph=para.index, preview=make_preview(para.text))
            )
        prev_level = para.heading_level
    return findings


@rule("HEAD-STRUCT-002")
def heading_numbering_gap(doc: DocxDocument, ctx: dict) -> list[dict]:
    findings = []
    last_at_prefix: dict[tuple, int] = {}
    for para in doc.paragraphs:
        if para.heading_level is None:
            continue
        m = _NUM_PREFIX.match(para.text.strip())
        if not m:
            continue
        numbers = tuple(int(x) for x in m.group(1).split("."))
        prefix = numbers[:-1]
        last = last_at_prefix.get(prefix)
        if last is not None and numbers[-1] > last + 1:
            findings.append(finding(paragraph=para.index, preview=make_preview(para.text)))
        last_at_prefix[prefix] = numbers[-1]
    return findings
