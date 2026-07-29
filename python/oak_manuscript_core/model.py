"""统一文档模型：读取器产出、规则引擎消费。只读视图，修复不经过本模型。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TextLine:
    """TXT/Markdown 原始行的只读、格式感知视图。

    ``protected_context`` 只使用固定枚举，不保存推断标签或用户信息；
    ``inline_code_ranges`` 使用半开区间，供机械空白检查排除 Markdown
    行内代码。段落模型继续承担引用与结构检查，两者互不替代。
    """

    number: int
    text: str
    protected_context: str | None = None  # fenced_code | table
    layout_sensitive: bool = False
    inline_code_ranges: tuple[tuple[int, int], ...] = ()
    hard_break_start: int | None = None


@dataclass
class Paragraph:
    part: str            # document | footnotes
    index: int           # 部内 1 起序号
    text: str            # 合并后的段落文本，制表符呈现为 \t
    style_id: str | None = None
    heading_level: int | None = None   # 1..9；非标题为 None
    tab_count: int = 0
    page_break_count: int = 0          # 段内手工分页符（w:br type=page）数
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
class Document:
    paragraphs: list[Paragraph] = field(default_factory=list)
    footnotes: list[Footnote] = field(default_factory=list)
    footnote_ref_ids: list[int] = field(default_factory=list)  # 正文引用顺序
    source_lines: list[TextLine] = field(default_factory=list)

    @property
    def body_text(self) -> str:
        return "\n".join(p.text for p in self.paragraphs)


# 兼容别名：M1 期代码与测试使用的名称（模型自 M2 起对 DOCX/MD/TXT 通用）
DocxDocument = Document
