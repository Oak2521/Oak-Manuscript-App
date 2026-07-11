"""零依赖 DOCX 构造器（测试夹具工厂 + 匿名样本生成共用）。

只用标准库 zipfile 构造最小合法 OOXML 包：document.xml、styles.xml、
footnotes.xml。仅覆盖检查核心所需的特征（段落、run、标题样式、制表符、
脚注引用与定义），不追求 Word 全功能。
"""

from __future__ import annotations

import io
import zipfile

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class DocxBuilder:
    """按顺序累积段落与脚注，build() 产出 DOCX 字节。"""

    def __init__(self) -> None:
        self._paras: list[dict] = []
        # fid -> 文本；None 表示空注（只有空段落）
        self._footnotes: dict[int, str] = {}

    # ---- 段落 API ----

    def p(self, text: str = "", style: str | None = None) -> "DocxBuilder":
        """单文本 run 的段落；text 为空即空段落。"""
        runs = [("t", text)] if text else []
        self._paras.append({"style": style, "runs": runs})
        return self

    def p_runs(self, tokens: list[tuple], style: str | None = None) -> "DocxBuilder":
        """多 token 段落。token: ("t", 文本) | ("tab",) | ("fnref", 脚注id)。"""
        self._paras.append({"style": style, "runs": list(tokens)})
        return self

    def p_empty(self) -> "DocxBuilder":
        return self.p("")

    def footnote(self, fid: int, text: str | None) -> "DocxBuilder":
        """登记脚注定义。text=None 或 "" 生成空注。"""
        self._footnotes[fid] = text or ""
        return self

    # ---- XML 生成 ----

    def _run_xml(self, token: tuple) -> str:
        kind = token[0]
        if kind == "t":
            return f'<w:r><w:t xml:space="preserve">{_esc(token[1])}</w:t></w:r>'
        if kind == "tab":
            return "<w:r><w:tab/></w:r>"
        if kind == "fnref":
            return f'<w:r><w:footnoteReference w:id="{token[1]}"/></w:r>'
        raise ValueError(f"unknown token: {token!r}")

    def _para_xml(self, para: dict) -> str:
        ppr = ""
        if para["style"]:
            ppr = f'<w:pPr><w:pStyle w:val="{para["style"]}"/></w:pPr>'
        runs = "".join(self._run_xml(t) for t in para["runs"])
        return f"<w:p>{ppr}{runs}</w:p>"

    def _document_xml(self) -> str:
        body = "".join(self._para_xml(p) for p in self._paras)
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}">'
            f"<w:body>{body}<w:sectPr/></w:body></w:document>"
        )

    def _styles_xml(self) -> str:
        styles = []
        for level in (1, 2, 3):
            styles.append(
                f'<w:style w:type="paragraph" w:styleId="Heading{level}">'
                f'<w:name w:val="heading {level}"/>'
                f'<w:pPr><w:outlineLvl w:val="{level - 1}"/></w:pPr>'
                "</w:style>"
            )
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:styles xmlns:w="{W_NS}">{"".join(styles)}</w:styles>'
        )

    def _footnotes_xml(self) -> str:
        notes = [
            f'<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>',
            f'<w:footnote w:type="continuationSeparator" w:id="0">'
            "<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>",
        ]
        for fid in sorted(self._footnotes):
            text = self._footnotes[fid]
            run = f'<w:r><w:t xml:space="preserve">{_esc(text)}</w:t></w:r>' if text else ""
            notes.append(f'<w:footnote w:id="{fid}"><w:p>{run}</w:p></w:footnote>')
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:footnotes xmlns:w="{W_NS}">{"".join(notes)}</w:footnotes>'
        )

    # ---- 打包 ----

    def bytes(self) -> bytes:
        content_types = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
            "</Types>"
        )
        root_rels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            "</Relationships>"
        )
        doc_rels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'
            "</Relationships>"
        )
        members = [
            ("[Content_Types].xml", content_types),
            ("_rels/.rels", root_rels),
            ("word/document.xml", self._document_xml()),
            ("word/_rels/document.xml.rels", doc_rels),
            ("word/styles.xml", self._styles_xml()),
            ("word/footnotes.xml", self._footnotes_xml()),
        ]
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, data in members:
                # 固定时间戳：同一构造两次生成的字节完全一致（可哈希回归）
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(info, data)
        return buf.getvalue()

    def save(self, path: str) -> None:
        with open(path, "wb") as fh:
            fh.write(self.bytes())
