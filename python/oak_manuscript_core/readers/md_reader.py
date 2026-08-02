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
from ..model import Document, Paragraph, TextLine

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
    doc = Document(source_lines=_classify_source_lines(text, markdown=parse_headings))
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


def _inline_code_ranges(line: str) -> tuple[tuple[int, int], ...]:
    """保守识别反引号代码跨度；未闭合时保护到行尾以避免误报。"""
    ranges: list[tuple[int, int]] = []
    cursor = 0
    while cursor < len(line):
        start = line.find("`", cursor)
        if start < 0:
            break
        width = 1
        while start + width < len(line) and line[start + width] == "`":
            width += 1
        marker = "`" * width
        end = line.find(marker, start + width)
        if end < 0:
            ranges.append((start, len(line)))
            break
        ranges.append((start, end + width))
        cursor = end + width
    return tuple(ranges)


def _looks_like_table(line: str) -> bool:
    """宁可少报也不在疑似 Markdown 表格中报告空白问题。"""
    stripped = line.strip()
    if not stripped or "|" not in stripped:
        return False
    unescaped = sum(
        1 for index, char in enumerate(stripped)
        if char == "|" and (index == 0 or stripped[index - 1] != "\\")
    )
    return stripped.startswith("|") or stripped.endswith("|") or unescaped >= 2


def _short_layout_block(lines: list[TextLine]) -> bool:
    if len(lines) < 3:
        return False
    texts = [line.text.strip() for line in lines]
    if any(not text or len(text) > 40 or text.startswith("#") for text in texts):
        return False
    terminal = re.compile(r"[。！？.!?；;：:]$")
    return sum(1 for text in texts if not terminal.search(text)) >= 2


def _classify_source_lines(text: str, *, markdown: bool) -> list[TextLine]:
    """生成供提示型规则使用的原始行视图，不改变既有段落解析。"""
    raw_lines = text.splitlines()
    classified: list[TextLine] = []
    in_fence = False
    for number, line in enumerate(raw_lines, start=1):
        stripped = line.strip()
        protected: str | None = None
        fence = markdown and bool(_FENCE.match(stripped))
        if fence:
            protected = "fenced_code"
            in_fence = not in_fence
        elif markdown and in_fence:
            protected = "fenced_code"
        elif markdown and _looks_like_table(line):
            protected = "table"

        trailing = len(line) - len(line.rstrip(" "))
        classified.append(TextLine(
            number=number,
            text=line,
            protected_context=protected,
            layout_sensitive=bool(line) and line[0] in {" ", "\t", "　"},
            inline_code_ranges=_inline_code_ranges(line) if markdown and protected is None else (),
            hard_break_start=(len(line) - trailing if markdown and trailing >= 2 else None),
        ))

    # 连续三行以上的短行块可能是诗歌、题词或刻意保留的行式。这里仅
    # 扩大豁免，不据此宣称识别了体裁；误判只会少报，不会改写内容。
    start = 0
    while start < len(classified):
        while start < len(classified) and (
            not classified[start].text.strip()
            or classified[start].protected_context is not None
        ):
            start += 1
        end = start
        while end < len(classified) and (
            classified[end].text.strip()
            and classified[end].protected_context is None
        ):
            end += 1
        block = classified[start:end]
        if block and (_short_layout_block(block) or any(line.layout_sensitive for line in block)):
            for index in range(start, end):
                line = classified[index]
                classified[index] = TextLine(
                    number=line.number,
                    text=line.text,
                    protected_context=line.protected_context,
                    layout_sensitive=True,
                    inline_code_ranges=line.inline_code_ranges,
                    hard_break_start=line.hard_break_start,
                )
        start = max(end, start + 1)
    return classified
