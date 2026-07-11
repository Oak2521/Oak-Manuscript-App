"""论文结构规则：PAPER-STRUCT-001..004。仅检查存在性，不评价内容。"""

from __future__ import annotations

from ..model import DocxDocument, Paragraph
from . import rule
from .common import finding, make_preview

_TITLE_MAX_CHARS = 100


def _first_nonempty(doc: DocxDocument) -> Paragraph | None:
    for para in doc.paragraphs:
        if para.text.strip():
            return para
    return None


def _has_para_starting(doc: DocxDocument, zh_prefixes: tuple[str, ...],
                       en_prefixes: tuple[str, ...]) -> bool:
    for para in doc.paragraphs:
        t = para.text.strip()
        if not t:
            continue
        if any(t.startswith(p) for p in zh_prefixes):
            return True
        low = t.lower()
        if any(low.startswith(p) for p in en_prefixes):
            return True
    return False


def is_ref_heading(text: str) -> bool:
    t = text.strip()
    if not t:
        return False
    if t.startswith("参考文献") and len(t) <= 8:
        return True
    return t.lower() in ("references", "reference", "bibliography")


@rule("PAPER-STRUCT-001")
def unclear_title(doc: DocxDocument, ctx: dict) -> list[dict]:
    first = _first_nonempty(doc)
    if first is None:
        return [finding(paragraph=1, preview="文档没有任何文字内容")]
    if len(first.text.strip()) > _TITLE_MAX_CHARS:
        return [finding(paragraph=first.index, preview=make_preview(first.text))]
    return []


@rule("PAPER-STRUCT-002")
def missing_abstract(doc: DocxDocument, ctx: dict) -> list[dict]:
    if _has_para_starting(doc, ("摘要",), ("abstract",)):
        return []
    return [finding(paragraph=1, preview="未找到「摘要」/ Abstract 段落")]


@rule("PAPER-STRUCT-003")
def missing_keywords(doc: DocxDocument, ctx: dict) -> list[dict]:
    if _has_para_starting(doc, ("关键词", "关键字"), ("keywords", "key words")):
        return []
    return [finding(paragraph=1, preview="未找到「关键词」/ Keywords 段落")]


@rule("PAPER-STRUCT-004")
def missing_references_section(doc: DocxDocument, ctx: dict) -> list[dict]:
    if any(is_ref_heading(p.text) for p in doc.paragraphs):
        return []
    return [finding(paragraph=1, preview="未找到「参考文献」/ References 部分")]
