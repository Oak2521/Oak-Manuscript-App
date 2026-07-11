"""基础 EPUB 3 导出（M3，方案 §5.5）。

从统一文档模型生成最小合规 EPUB：mimetype（首位、不压缩）、container、
OPF（完整必需元数据）、nav（一级标题目录）、单一内容文档（标题带锚点）。
产物必须能通过本核心自身的 EPUB 检查（引擎自检零问题），
但**不宣称**通过 EpubCheck / Ace（外部工具未运行时报告如实标注）。
"""

from __future__ import annotations

import html as _html
import io
import zipfile

from .model import Document

_XHTML_NS = "http://www.w3.org/1999/xhtml"
_TIMESTAMP = (2026, 1, 1, 0, 0, 0)  # 确定性输出


def build_basic_epub(doc: Document, *, title: str, language: str, identifier: str) -> bytes:
    e = _html.escape
    body_parts: list[str] = []
    toc: list[tuple[str, str]] = []  # (anchor, 标题文本)
    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        if para.heading_level is not None:
            level = min(max(para.heading_level, 1), 6)
            anchor = f"h-{para.index}"
            body_parts.append(f'<h{level} id="{anchor}">{e(text)}</h{level}>')
            if level == 1:
                toc.append((anchor, text))
        else:
            body_parts.append(f"<p>{e(text)}</p>")

    lang_attrs = f' lang="{e(language)}" xml:lang="{e(language)}"'
    content = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<html xmlns="{_XHTML_NS}"{lang_attrs}>'
        f"<head><title>{e(title)}</title></head>"
        f"<body>{''.join(body_parts)}</body></html>"
    )

    if toc:
        lis = "".join(
            f'<li><a href="content.xhtml#{anchor}">{e(text)}</a></li>' for anchor, text in toc
        )
    else:
        lis = '<li><a href="content.xhtml">正文</a></li>'
    nav = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<html xmlns="{_XHTML_NS}" xmlns:epub="http://www.idpf.org/2007/ops"{lang_attrs}>'
        "<head><title>目录</title></head>"
        f'<body><nav epub:type="toc"><ol>{lis}</ol></nav></body></html>'
    )

    opf = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f'<dc:identifier id="pub-id">{e(identifier)}</dc:identifier>'
        f"<dc:title>{e(title)}</dc:title>"
        f"<dc:language>{e(language)}</dc:language>"
        "</metadata><manifest>"
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
        '<item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>'
        "</manifest><spine>"
        '<itemref idref="content"/>'
        "</spine></package>"
    )

    container = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
        '<rootfiles><rootfile full-path="OEBPS/content.opf" '
        'media-type="application/oebps-package+xml"/></rootfiles></container>'
    )

    members = [
        ("mimetype", b"application/epub+zip", zipfile.ZIP_STORED),
        ("META-INF/container.xml", container.encode("utf-8"), zipfile.ZIP_DEFLATED),
        ("OEBPS/content.opf", opf.encode("utf-8"), zipfile.ZIP_DEFLATED),
        ("OEBPS/nav.xhtml", nav.encode("utf-8"), zipfile.ZIP_DEFLATED),
        ("OEBPS/content.xhtml", content.encode("utf-8"), zipfile.ZIP_DEFLATED),
    ]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data, ctype in members:
            info = zipfile.ZipInfo(name, date_time=_TIMESTAMP)
            info.compress_type = ctype
            zf.writestr(info, data)
    return buf.getvalue()
