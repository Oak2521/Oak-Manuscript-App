"""Markdown 读取器（M2）：ATX 标题 + 空行分段，围栏代码块不解析结构。

确定性约定（冻结于实现，改动须升规则包版本并补样本）：
- 仅识别 ATX 标题（# .. ######，后随空格），尾部收尾 # 会被剥除；
- Setext 标题（=== / --- 下划线）不识别，作普通段落处理；
- 围栏代码块（``` 或 ~~~）整块作为一个普通段落，块内 # 不算标题；
- 连续非空行合并为一个段落，行间以单个空格连接。
"""

from __future__ import annotations

import re
from pathlib import Path

from ..errors import OakError
from ..model import Document, Paragraph

_ATX = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_FENCE = re.compile(r"^(```|~~~)")


def read_md(path: Path | str) -> Document:
    return _parse(_read_text(Path(path)), parse_headings=True)


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as exc:
        raise OakError(
            f"「{path.name}」不是 UTF-8 文本，无法读取。请先转换编码为 UTF-8。原文件未被修改。"
        ) from exc
    except OSError as exc:
        raise OakError(f"无法读取「{path.name}」：{exc}") from exc


def _parse(text: str, *, parse_headings: bool) -> Document:
    doc = Document()
    index = 0
    block: list[str] = []
    in_fence = False

    def flush():
        nonlocal index, block
        if block:
            index += 1
            doc.paragraphs.append(
                Paragraph(part="document", index=index, text=" ".join(block))
            )
            block = []

    def emit_heading(level: int, title: str):
        nonlocal index
        index += 1
        doc.paragraphs.append(
            Paragraph(part="document", index=index, text=title, heading_level=level)
        )

    for raw in text.splitlines():
        line = raw.rstrip("\n")
        if parse_headings and _FENCE.match(line.strip()):
            if in_fence:
                block.append(line.strip())
                flush()
                in_fence = False
            else:
                flush()
                in_fence = True
                block.append(line.strip())
            continue
        if in_fence:
            block.append(line)
            continue
        if not line.strip():
            flush()
            continue
        if parse_headings:
            m = _ATX.match(line)
            if m:
                flush()
                emit_heading(len(m.group(1)), m.group(2))
                continue
        block.append(line.strip())
    flush()
    return doc


def parse_plain_blocks(text: str) -> Document:
    """纯文本模式：只做空行分段（供 txt_reader 复用）。"""
    return _parse(text, parse_headings=False)
