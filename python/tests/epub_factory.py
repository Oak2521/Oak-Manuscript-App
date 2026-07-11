"""零依赖 EPUB 3 构造器（测试夹具 + 匿名样本共用）。

可按参数种入缺陷：mimetype 位置/压缩/缺失、必需元数据缺失、无 nav、
章节缺 lang、图片缺 alt、断链。全部输出确定性字节（固定时间戳）。
"""

from __future__ import annotations

import io
import zipfile

XHTML_NS = "http://www.w3.org/1999/xhtml"


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class EpubBuilder:
    def __init__(
        self,
        *,
        title: str | None = "示例电子书",
        language: str | None = "zh",
        identifier: str | None = "urn:oak:sample-epub-0001",
        mimetype_present: bool = True,
        mimetype_first: bool = True,
        mimetype_stored: bool = True,
        include_nav: bool = True,
    ) -> None:
        self.title = title
        self.language = language
        self.identifier = identifier
        self.mimetype_present = mimetype_present
        self.mimetype_first = mimetype_first
        self.mimetype_stored = mimetype_stored
        self.include_nav = include_nav
        # (filename, lang 或 None, body_html)
        self._chapters: list[tuple[str, str | None, str]] = []

    def chapter(self, filename: str, body_html: str, *, lang: str | None = "zh") -> "EpubBuilder":
        self._chapters.append((filename, lang, body_html))
        return self

    # ---- 各部件 ----

    def _container_xml(self) -> str:
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" '
            'media-type="application/oebps-package+xml"/></rootfiles></container>'
        )

    def _opf(self) -> str:
        meta = []
        if self.identifier is not None:
            meta.append(f'<dc:identifier id="pub-id">{_esc(self.identifier)}</dc:identifier>')
        if self.title is not None:
            meta.append(f"<dc:title>{_esc(self.title)}</dc:title>")
        if self.language is not None:
            meta.append(f"<dc:language>{_esc(self.language)}</dc:language>")
        items = []
        spine = []
        if self.include_nav:
            items.append(
                '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
            )
        for i, (fn, _lang, _body) in enumerate(self._chapters, start=1):
            items.append(f'<item id="c{i}" href="{fn}" media-type="application/xhtml+xml"/>')
            spine.append(f'<itemref idref="c{i}"/>')
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">'
            '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
            + "".join(meta)
            + "</metadata><manifest>"
            + "".join(items)
            + "</manifest><spine>"
            + "".join(spine)
            + "</spine></package>"
        )

    def _nav(self) -> str:
        lis = "".join(
            f'<li><a href="{fn}">{_esc(fn)}</a></li>' for fn, _l, _b in self._chapters
        )
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            f'<html xmlns="{XHTML_NS}" xmlns:epub="http://www.idpf.org/2007/ops" '
            'lang="zh" xml:lang="zh"><head><title>目录</title></head>'
            f'<body><nav epub:type="toc"><ol>{lis}</ol></nav></body></html>'
        )

    def _chapter_xhtml(self, lang: str | None, body: str) -> str:
        lang_attrs = f' lang="{lang}" xml:lang="{lang}"' if lang else ""
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            f'<html xmlns="{XHTML_NS}"{lang_attrs}>'
            "<head><title>章节</title></head>"
            f"<body>{body}</body></html>"
        )

    def bytes(self) -> bytes:
        members: list[tuple[str, bytes, int]] = []  # (name, data, compress_type)
        mimetype = ("mimetype", b"application/epub+zip",
                    zipfile.ZIP_STORED if self.mimetype_stored else zipfile.ZIP_DEFLATED)
        rest: list[tuple[str, bytes, int]] = [
            ("META-INF/container.xml", self._container_xml().encode("utf-8"), zipfile.ZIP_DEFLATED),
            ("OEBPS/content.opf", self._opf().encode("utf-8"), zipfile.ZIP_DEFLATED),
        ]
        if self.include_nav:
            rest.append(("OEBPS/nav.xhtml", self._nav().encode("utf-8"), zipfile.ZIP_DEFLATED))
        for fn, lang, body in self._chapters:
            rest.append(
                (f"OEBPS/{fn}", self._chapter_xhtml(lang, body).encode("utf-8"), zipfile.ZIP_DEFLATED)
            )
        if self.mimetype_present:
            members = [mimetype] + rest if self.mimetype_first else rest[:1] + [mimetype] + rest[1:]
        else:
            members = rest

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            for name, data, ctype in members:
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = ctype
                zf.writestr(info, data)
        return buf.getvalue()

    def save(self, path: str) -> None:
        with open(path, "wb") as fh:
            fh.write(self.bytes())
