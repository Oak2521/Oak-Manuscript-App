"""注释规则：NOTE-001 空注、NOTE-002 孤立注、NOTE-003 重复注。"""

from __future__ import annotations

from ..model import DocxDocument
from . import rule
from .common import finding, make_preview


@rule("NOTE-001")
def empty_notes(doc: DocxDocument, ctx: dict) -> list[dict]:
    return [
        finding(part="footnotes", note_id=n.note_id, preview="（脚注内容为空）")
        for n in doc.footnotes
        if not n.text.strip()
    ]


@rule("NOTE-002")
def orphan_notes(doc: DocxDocument, ctx: dict) -> list[dict]:
    referenced = set(doc.footnote_ref_ids)
    return [
        finding(part="footnotes", note_id=n.note_id, preview=make_preview(n.text))
        for n in doc.footnotes
        if n.note_id not in referenced and n.text.strip()
    ]


@rule("NOTE-003")
def duplicate_notes(doc: DocxDocument, ctx: dict) -> list[dict]:
    groups: dict[str, list[int]] = {}
    for n in doc.footnotes:
        key = n.text.strip()
        if key:
            groups.setdefault(key, []).append(n.note_id)
    findings = []
    for text, ids in groups.items():
        if len(ids) >= 2:
            findings.append(
                finding(part="footnotes", note_id=ids[1],
                        preview=make_preview(f"与注 {ids[0]} 内容相同：{text}"))
            )
    return findings
