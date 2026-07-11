"""规则实现的共用工具。findings 为轻量字典，引擎负责组装成完整 Issue。"""

from __future__ import annotations

PREVIEW_MAX = 60


def make_preview(text: str, start: int | None = None, end: int | None = None) -> str:
    """截断脱敏预览：围绕命中位置截取，总长 ≤ PREVIEW_MAX。"""
    text = text.replace("\t", "⇥")
    if not text:
        return ""
    if start is None:
        snippet = text[:PREVIEW_MAX]
        return snippet + ("…" if len(text) > PREVIEW_MAX else "")
    end = end if end is not None else start
    span = end - start
    margin = max((PREVIEW_MAX - span) // 2, 4)
    lo = max(start - margin, 0)
    hi = min(end + margin, len(text))
    snippet = text[lo:hi]
    if lo > 0:
        snippet = "…" + snippet[1:]
    if hi < len(text):
        snippet = snippet[:-1] + "…"
    return snippet[:PREVIEW_MAX]


def finding(*, paragraph: int | None = None, note_id: int | None = None,
            part: str = "document", preview: str = "",
            resource: str | None = None) -> dict:
    """resource：EPUB 等包格式的包内资源路径（M3 起，可选）。"""
    return {"part": part, "paragraph": paragraph, "note_id": note_id,
            "resource": resource, "preview": preview}
