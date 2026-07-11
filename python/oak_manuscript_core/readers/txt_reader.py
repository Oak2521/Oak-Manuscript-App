"""TXT 读取器（M2）：UTF-8（容忍 BOM 与 CRLF），空行分段，无结构识别。"""

from __future__ import annotations

from pathlib import Path

from ..model import Document
from .md_reader import _read_text, parse_plain_blocks


def read_txt(path: Path | str) -> Document:
    return parse_plain_blocks(_read_text(Path(path)))
