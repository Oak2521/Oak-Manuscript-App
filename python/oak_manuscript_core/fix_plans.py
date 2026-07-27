"""批量机械修复计划：生成可集中确认、可验证且无落盘副作用的预览。

计划 ID 不是数据库句柄，而是当前修复上下文的确定性摘要。它同时绑定：

- 项目 ID 与 working 文件 SHA-256；
- reports/issues.json 的完整问题集（含状态）；
- 规则包名称、版本与完整内容 SHA-256；
- 本批次全部候选及其前后预览。

因此调用方可先展示一次完整列表，再把 ``plan_id`` 原样交回 ``fix``；
任一受绑定内容发生变化，旧计划都会自然失效。
"""

from __future__ import annotations

import json
import re
from copy import deepcopy

from .errors import OakError
from .fixes import WHITELIST
from .util import now_iso, sha256_bytes, sha256_file

PLAN_SCHEMA_VERSION = "1.0"
_PENDING_STATUSES = frozenset({"open", "accepted"})
_REPEAT_PUNCT = re.compile(r"([。，、；：？！])\1+")
_MULTI_SPACE = re.compile(r" {2,}")


def _canonical_sha256(value) -> str:
    raw = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return sha256_bytes(raw)


def _preview_before(issue: dict) -> str:
    """把不可见控制字符转换成明确的 UI 预览符号。"""
    before = issue.get("preview") or ""
    if issue.get("fix_id") == "FIX-TAB-001":
        # 规则层通常已把 TAB 显示为 ⇥；这里也兼容手工/旧问题文件中的真实 \t。
        return before.replace("\t", "⇥")
    return before


def _preview_after(issue: dict, settings: dict) -> str:
    """给集中确认界面提供保守、确定的机械变化预览。"""
    before = _preview_before(issue)
    fix_id = issue.get("fix_id")
    if fix_id == "FIX-SPACE-001":
        return _MULTI_SPACE.sub(" ", before)
    if fix_id == "FIX-TAB-001":
        # 用 ␠ 明示替换后的单个普通空格，避免 UI 中空格不可见。
        if "【⇥】" in before:
            return before.replace("【⇥】", "【␠】", 1)
        return before.replace("⇥", "␠", 1)
    if fix_id == "FIX-PUNCT-001":
        return _REPEAT_PUNCT.sub(r"\1", before)
    if fix_id == "FIX-EMPTYPARA-001":
        return "连续空段落将折叠为 1 个（其余空段删除）"
    if fix_id == "FIX-EPUB-MIME-001":
        return (
            "mimetype 将移至 EPUB 首项、改为不压缩，并写为 "
            "application/epub+zip"
        )
    if fix_id == "FIX-EPUB-LANG-001":
        language = settings.get("language_detected") or "OPF dc:language 的声明值"
        return f"为该 XHTML 根元素补写 lang 与 xml:lang（{language}）"
    return before


def _candidate_items(issues: list[dict], pack: dict, settings: dict) -> list[dict]:
    """只接受同时得到问题记录、规则包和冻结白名单授权的候选。"""
    rules = {rule["rule_id"]: rule for rule in pack["rules"]}
    items: list[dict] = []
    seen_issue_ids: set[str] = set()

    # fixer 按 fix_id 扫描全文，不能只跳过一个已拒绝的位置。只要同类中有一项
    # rejected，整类都不进入本次计划，确保未展示/已拒绝的位置不会被顺带修改。
    blocked_fix_ids = {
        issue.get("fix_id")
        for issue in issues
        if (
            issue.get("status") == "rejected"
            and issue.get("auto_fixable") is True
            and issue.get("fix_id") in WHITELIST
        )
    }
    for issue in issues:
        issue_id = issue.get("issue_id")
        if not issue_id:
            continue
        if issue_id in seen_issue_ids:
            raise OakError(f"问题集含重复 issue_id，无法安全生成修复计划：{issue_id}")
        seen_issue_ids.add(issue_id)
        rule = rules.get(issue.get("rule_id"))
        fix_id = issue.get("fix_id")
        if not (
            issue.get("status") in _PENDING_STATUSES
            and issue.get("auto_fixable") is True
            and fix_id in WHITELIST
            and fix_id not in blocked_fix_ids
            and rule is not None
            and rule.get("auto_fixable") is True
            and rule.get("fix_id") == fix_id
        ):
            continue
        before = _preview_before(issue)
        items.append({
            "issue_id": issue_id,
            "rule_id": issue["rule_id"],
            "fix_id": fix_id,
            "title": rule.get("title") or issue.get("title") or issue["rule_id"],
            "location": deepcopy(issue.get("location") or {}),
            "before_preview": before,
            "after_preview": _preview_after(issue, settings),
        })
    return sorted(items, key=lambda item: item["issue_id"])


def build_fix_plan(project, pack: dict, issues: list[dict]) -> dict:
    """构造当前批量修复计划；只读，不写项目或稿件文件。"""
    items = _candidate_items(issues, pack, project.data["settings"])
    rulepack = {
        "name": pack["pack_name"],
        "version": pack["pack_version"],
        "sha256": _canonical_sha256(pack),
    }
    binding = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "project_id": project.data["project_id"],
        "working_sha256": sha256_file(project.working_path),
        "issues_sha256": _canonical_sha256(issues),
        "rulepack": rulepack,
        "candidates_sha256": _canonical_sha256(items),
        "candidate_issue_ids": [item["issue_id"] for item in items],
    }
    return {
        **binding,
        "plan_id": f"fix-plan-{_canonical_sha256(binding)}",
        "generated_at": now_iso(),
        "candidate_count": len(items),
        "items": items,
    }
