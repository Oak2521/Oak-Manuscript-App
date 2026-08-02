"""规则注册表：rule_id → 判断函数。定义（规则包）与实现必须一一对应。"""

from __future__ import annotations

from typing import Callable

RULE_FUNCS: dict[str, Callable] = {}


def rule(rule_id: str):
    """注册规则实现。函数签名：fn(doc: DocxDocument, ctx: dict) -> list[finding]。"""

    def decorator(fn: Callable) -> Callable:
        if rule_id in RULE_FUNCS:
            raise RuntimeError(f"规则实现重复注册：{rule_id}")
        RULE_FUNCS[rule_id] = fn
        return fn

    return decorator


# 导入即注册（顺序无关，引擎按规则包顺序调度）
from . import whitespace, punctuation, structure, headings, notes, references, book, epub, text_hygiene  # noqa: E402,F401
