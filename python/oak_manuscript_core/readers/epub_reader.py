"""EPUB 读取器（M3）：容器 / OPF / nav / 内容文档的只读结构解析。

复用 safety 的 ZIP 防护。仅做本地结构检查所需的解析，
不替代 EpubCheck / Ace 的标准合规验证（未运行时报告如实标注）。
"""

from __future__ import annotations

import posixpath
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from ..errors import OakError
from ..safety import ZipLimits, open_zip_safely

_CONTAINER_NS = "{urn:oasis:names:tc:opendocument:xmlns:container}"
_OPF_NS = "{http://www.idpf.org/2007/opf}"
_DC_NS = "{http://purl.org/dc/elements/1.1/}"
_XHTML_NS = "{http://www.w3.org/1999/xhtml}"
_XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"

_MIMETYPE_VALUE = b"application/epub+zip"


@dataclass
class EpubXhtml:
    href: str                       # 包内完整路径
    has_lang: bool = False
    text: str = ""
    images: list[dict] = field(default_factory=list)   # {"src", "has_alt"}
    links: list[str] = field(default_factory=list)     # 原始 href 值，按出现顺序
    anchor_ids: set[str] = field(default_factory=set)


@dataclass
class EpubBook:
    member_names: set[str] = field(default_factory=set)
    mimetype_ok: bool = False
    mimetype_problem: str | None = None
    opf_path: str = ""
    title: str | None = None
    language: str | None = None
    identifier: str | None = None
    has_nav: bool = False
    docs: list[EpubXhtml] = field(default_factory=list)
    footnotes: list = field(default_factory=list)      # 与统一模型形状兼容（EPUB 不用）

    @property
    def body_text(self) -> str:
        return "\n".join(d.text for d in self.docs)


def read_epub(path: Path | str, limits: ZipLimits | None = None) -> EpubBook:
    path = Path(path)
    book = EpubBook()
    with open_zip_safely(path, limits) as zf:
        infos = zf.infolist()
        names = [i.filename for i in infos]
        book.member_names = set(names)

        # 1. mimetype：必须是第一个成员、不压缩、内容准确
        if "mimetype" not in book.member_names:
            book.mimetype_problem = "缺少 mimetype 文件"
        elif names[0] != "mimetype":
            book.mimetype_problem = "mimetype 不是压缩包第一个成员"
        elif infos[0].compress_type != zipfile.ZIP_STORED:
            book.mimetype_problem = "mimetype 被压缩存储（应为不压缩）"
        elif zf.read("mimetype").strip() != _MIMETYPE_VALUE:
            book.mimetype_problem = "mimetype 内容不是 application/epub+zip"
        book.mimetype_ok = book.mimetype_problem is None

        # 2. container → OPF
        if "META-INF/container.xml" not in book.member_names:
            raise OakError(
                f"「{path.name}」缺少 META-INF/container.xml，不是有效的 EPUB。原文件未被修改。"
            )
        try:
            container = ET.fromstring(zf.read("META-INF/container.xml"))
        except ET.ParseError as exc:
            raise OakError(f"「{path.name}」的 container.xml 无法解析。原文件未被修改。") from exc
        rootfile = container.find(f".//{_CONTAINER_NS}rootfile")
        if rootfile is None or not rootfile.get("full-path"):
            raise OakError(f"「{path.name}」的 container.xml 未声明包文档路径。原文件未被修改。")
        book.opf_path = rootfile.get("full-path")
        if book.opf_path not in book.member_names:
            raise OakError(f"「{path.name}」声明的包文档不存在：{book.opf_path}。原文件未被修改。")

        # 3. OPF：元数据 + manifest
        try:
            opf = ET.fromstring(zf.read(book.opf_path))
        except ET.ParseError as exc:
            raise OakError(f"「{path.name}」的包文档（OPF）无法解析。原文件未被修改。") from exc
        book.title = _dc_text(opf, "title")
        book.language = _dc_text(opf, "language")
        book.identifier = _dc_text(opf, "identifier")

        opf_dir = posixpath.dirname(book.opf_path)
        xhtml_hrefs: list[str] = []
        for item in opf.iter(f"{_OPF_NS}item"):
            props = (item.get("properties") or "").split()
            if "nav" in props:
                book.has_nav = True
            if item.get("media-type") == "application/xhtml+xml" and item.get("href"):
                xhtml_hrefs.append(posixpath.normpath(posixpath.join(opf_dir, item.get("href"))))

        # 4. 内容文档
        for href in xhtml_hrefs:
            if href not in book.member_names:
                continue  # 缺失资源由链接/清单类检查处理，不在读取层报错
            try:
                root = ET.fromstring(zf.read(href))
            except ET.ParseError as exc:
                raise OakError(
                    f"「{path.name}」的内容文档无法解析：{href}。原文件未被修改。"
                ) from exc
            book.docs.append(_parse_xhtml(href, root))
    return book


def _dc_text(opf, tag: str) -> str | None:
    el = opf.find(f".//{_DC_NS}{tag}")
    if el is None:
        return None
    text = (el.text or "").strip()
    return text or None


def _parse_xhtml(href: str, root) -> EpubXhtml:
    doc = EpubXhtml(href=href)
    doc.has_lang = bool(root.get("lang") or root.get(_XML_LANG))
    texts: list[str] = []
    for el in root.iter():
        if el.text and el.text.strip():
            texts.append(el.text.strip())
        anchor = el.get("id")
        if anchor:
            doc.anchor_ids.add(anchor)
        tag = el.tag
        if tag == f"{_XHTML_NS}img":
            doc.images.append({"src": el.get("src") or "", "has_alt": el.get("alt") is not None})
        elif tag == f"{_XHTML_NS}a":
            href_val = el.get("href")
            if href_val:
                doc.links.append(href_val)
    doc.text = "\n".join(texts)
    return doc
