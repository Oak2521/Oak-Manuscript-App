"""电子书规则（M3）：EPUB-MIME/OPF/NAV/LANG/IMG/LINK。

输入为 EpubBook（readers/epub_reader.py）。本组规则是本地结构检查，
不替代 EpubCheck / Ace；外部工具未运行时报告如实标注「未运行」。
"""

from __future__ import annotations

import posixpath

from ..readers.epub_reader import EpubBook
from . import rule
from .common import finding, make_preview

_EXTERNAL_PREFIXES = ("http://", "https://", "mailto:", "tel:", "data:")


@rule("EPUB-MIME-001")
def mimetype_misplaced(book: EpubBook, ctx: dict) -> list[dict]:
    if book.mimetype_ok:
        return []
    return [finding(part="package", resource="mimetype",
                    preview=make_preview(book.mimetype_problem or "mimetype 异常"))]


@rule("EPUB-OPF-001")
def missing_required_metadata(book: EpubBook, ctx: dict) -> list[dict]:
    findings = []
    for field_name, value in (("dc:title", book.title),
                              ("dc:language", book.language),
                              ("dc:identifier", book.identifier)):
        if value is None:
            findings.append(
                finding(part="package", resource=book.opf_path,
                        preview=f"包文档缺少必需元数据 {field_name}")
            )
    return findings


@rule("EPUB-NAV-001")
def missing_nav(book: EpubBook, ctx: dict) -> list[dict]:
    if book.has_nav:
        return []
    return [finding(part="package", resource=book.opf_path,
                    preview="manifest 中没有声明 properties=\"nav\" 的导航文档")]


@rule("EPUB-LANG-001")
def missing_html_lang(book: EpubBook, ctx: dict) -> list[dict]:
    return [
        finding(part="document", resource=doc.href,
                preview="html 元素缺少 lang / xml:lang 属性")
        for doc in book.docs
        if not doc.has_lang
    ]


@rule("EPUB-IMG-001")
def image_without_alt(book: EpubBook, ctx: dict) -> list[dict]:
    findings = []
    for doc in book.docs:
        for img in doc.images:
            if not img["has_alt"]:
                findings.append(
                    finding(part="document", resource=doc.href,
                            preview=make_preview(f"图片缺少 alt 属性：{img['src']}"))
                )
    return findings


@rule("EPUB-LINK-001")
def broken_internal_links(book: EpubBook, ctx: dict) -> list[dict]:
    anchors_by_href = {doc.href: doc.anchor_ids for doc in book.docs}
    findings = []
    for doc in book.docs:
        base_dir = posixpath.dirname(doc.href)
        for raw in doc.links:
            if raw.startswith(_EXTERNAL_PREFIXES) or not raw.strip():
                continue
            target_part, _, anchor = raw.partition("#")
            if not target_part:  # 本文档内锚点
                if anchor and anchor not in doc.anchor_ids:
                    findings.append(
                        finding(part="document", resource=doc.href,
                                preview=make_preview(f"链接锚点不存在：#{anchor}"))
                    )
                continue
            target = posixpath.normpath(posixpath.join(base_dir, target_part))
            if target not in book.member_names:
                findings.append(
                    finding(part="document", resource=doc.href,
                            preview=make_preview(f"链接目标文件不存在：{raw}"))
                )
                continue
            if anchor:
                target_anchors = anchors_by_href.get(target)
                if target_anchors is not None and anchor not in target_anchors:
                    findings.append(
                        finding(part="document", resource=doc.href,
                                preview=make_preview(f"链接锚点不存在：{raw}"))
                    )
    return findings
