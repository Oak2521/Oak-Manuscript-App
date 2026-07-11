"""统一文档模型：读取器产出、规则引擎消费。只读视图，修复不经过本模型。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Paragraph:
    part: str            # document | footnotes
    index: int           # 部内 1 起序号
    text: str            # 合并后的段落文本，制表符呈现为 \t
    style_id: str | None = None
    heading_level: int | None = None   # 1..9；非标题为 None
    tab_count: int = 0
    has_drawing: bool = False
    has_sectpr: bool = False
    footnote_refs: list[int] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return (
            not self.text.strip()
            and self.tab_count == 0
            and not self.has_drawing
            and not self.footnote_refs
            and not self.has_sectpr
        )


@dataclass
class Footnote:
    note_id: int
    text: str


@dataclass
class DocxDocument:
    paragraphs: list[Paragraph] = field(default_factory=list)
    footnotes: list[Footnote] = field(default_factory=list)
    footnote_ref_ids: list[int] = field(default_factory=list)  # 正文引用顺序

    @property
    def body_text(self) -> str:
        return "\n".join(p.text for p in self.paragraphs)
