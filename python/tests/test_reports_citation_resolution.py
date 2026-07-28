"""引用解析结果在 Markdown/HTML/PDF 源报告中的渲染契约。"""

from __future__ import annotations

import copy
import unittest

from oak_manuscript_core.reports import render_html, render_markdown


def report_data() -> dict:
    return {
        "file": "anonymous.md",
        "manuscript_type": "paper",
        "check": {"finished_at": "2026-07-27T12:00:00Z", "kind": "check"},
        "rulepack": {"name": "oak-rules", "version": "2.0.0"},
        "citation_note": "默认解析器已选择 APA 7。",
        "citation_resolution": {
            "requested_style": "default",
            "resolved_style": "apa-7",
            "mode": "style_specific",
            "reason": "检测到 3 个唯一作者—年份引用，对应覆盖率 100%。默认采用 apa-7。",
            "confidence": "high",
            "resolver": {"version": "1.0.0"},
        },
        "pending_counts": {"error": 0, "warning": 0, "suggestion": 0},
        "status_level": "可继续处理",
        "issues": [],
        "applied_fixes": [],
        "external_tools": {"EpubCheck": "not_run", "Ace": "not_run"},
        "external_tools_detail": {},
        "skipped_rule_groups": [],
        "disclaimer": "本报告不评价学术质量。",
        "app_version": "0.1.0-alpha.5",
        "generated_at": "2026-07-27T12:00:01Z",
    }


class CitationResolutionReportTest(unittest.TestCase):
    def test_markdown_displays_complete_structured_resolution(self):
        rendered = render_markdown(report_data())
        for fragment in (
            "## 引用体例解析",
            "请求体例：默认（default）",
            "最终体例：APA 7（apa-7）",
            "检查模式：体例专项检查（style_specific）",
            "选择理由：检测到 3 个唯一作者—年份引用",
            "置信度：高（high）",
            "解析器版本：1.0.0",
        ):
            self.assertIn(fragment, rendered)

    def test_structure_only_explicitly_says_no_style_was_resolved(self):
        report = report_data()
        report["citation_resolution"].update({
            "resolved_style": None,
            "mode": "structure_only",
            "reason": "证据不足；本次仅执行引用结构与一致性检查。",
            "confidence": "low",
        })
        rendered = render_markdown(report)
        self.assertIn("最终体例：未确定具体体例", rendered)
        self.assertIn("仅引用结构与一致性检查（structure_only）", rendered)
        self.assertIn("置信度：低（low）", rendered)

    def test_html_escapes_every_structured_resolution_value(self):
        report = report_data()
        report["citation_resolution"].update({
            "requested_style": "<script>requested()</script>",
            "resolved_style": "<img src=x onerror=resolved()>",
            "mode": "<svg onload=mode()>",
            "reason": "<script>reason()</script>",
            "confidence": "<b>confidence</b>",
            "resolver": {"version": "<iframe>version</iframe>"},
        })
        rendered = render_html(report)
        for unsafe in (
            "<script>requested()</script>",
            "<img src=x onerror=resolved()>",
            "<svg onload=mode()>",
            "<script>reason()</script>",
            "<b>confidence</b>",
            "<iframe>version</iframe>",
        ):
            self.assertNotIn(unsafe, rendered)
        self.assertIn("&lt;script&gt;reason()&lt;/script&gt;", rendered)
        self.assertIn("&lt;iframe&gt;version&lt;/iframe&gt;", rendered)

    def test_legacy_report_without_structured_resolution_still_renders(self):
        report = copy.deepcopy(report_data())
        del report["citation_resolution"]
        markdown = render_markdown(report)
        html = render_html(report)
        self.assertIn("引用体例：默认解析器已选择 APA 7。", markdown)
        self.assertNotIn("## 引用体例解析", markdown)
        self.assertIn("默认解析器已选择 APA 7。", html)
        self.assertNotIn("<h2>引用体例解析</h2>", html)


if __name__ == "__main__":
    unittest.main()
