"""检查报告渲染：Markdown 与自包含 HTML（JSON 由 ops 直接落盘）。

红线（方案 §6.4）：不出现夸张承诺；未运行的外部工具只写「未运行」；
出版评估入口只出现在报告末尾，措辞克制。
"""

from __future__ import annotations

import html as _html

_EXTERNAL_LABEL = {"not_run": "未运行", "passed": "已运行", "failed": "已运行（发现问题）"}
_SEVERITY_SECTIONS = (
    ("error", "必须处理的问题"),
    ("warning", "建议处理的问题"),
    ("suggestion", "可选改进"),
)

_EVALUATION_BLOCK = (
    "想进一步判断稿件是否适合出版？湖岸橡树可在您主动提交后，"
    "结合稿件类型、篇幅和本次检查摘要提供出版评估。APP 不会自动上传您的稿件。"
)


def _loc(issue: dict) -> str:
    loc = issue["location"]
    if loc.get("resource"):
        return loc["resource"]
    if loc["part"] == "footnotes":
        return f"脚注 {loc['note_id']}"
    if loc["paragraph"] is not None:
        return f"正文第 {loc['paragraph']} 段"
    return "文档"


def _pending(issues: list[dict], severity: str) -> list[dict]:
    return [i for i in issues if i["severity"] == severity and i["status"] in ("open", "accepted")]


def render_markdown(report: dict) -> str:
    lines: list[str] = []
    lines.append("# 湖岸稿件检查报告")
    lines.append("")
    lines.append(f"- 文件：{report['file']}")
    lines.append(f"- 稿件类型：{report['manuscript_type']}")
    lines.append(f"- 检查时间：{report['check']['finished_at']}（{report['check']['kind']}）")
    lines.append(f"- 规则包：{report['rulepack']['name']} {report['rulepack']['version']}")
    lines.append(f"- 引用体例：{report['citation_note']}")
    lines.append("")
    lines.append("## 结论摘要")
    lines.append("")
    p = report["pending_counts"]
    lines.append(f"**{report['status_level']}**")
    lines.append("")
    lines.append(
        f"未处理问题：必须处理 {p['error']} 项，建议处理 {p['warning']} 项，可选改进 {p['suggestion']} 项。"
    )
    lines.append("（状态级别仅由未处理问题的严重程度决定，条件公开透明。）")

    issues = report["issues"]
    for severity, title in _SEVERITY_SECTIONS:
        lines.append("")
        lines.append(f"## {title}")
        lines.append("")
        items = _pending(issues, severity)
        if not items:
            lines.append("（无）")
        for i in items:
            lines.append(f"- **{i['title']}**（{i['rule_id']}，{_loc(i)}）")
            lines.append(f"  - 预览：`{i['preview']}`" if i["preview"] else "  - 预览：（无）")
            lines.append(f"  - 说明：{i['explanation']}")
            lines.append(f"  - 标准依据:{'、'.join(i['standard_refs'])}")

    lines.append("")
    lines.append("## 已自动订正")
    lines.append("")
    if report["applied_fixes"]:
        for f in report["applied_fixes"]:
            lines.append(f"- {f['title']}（{f['rule_id']}）：{f['count']} 处")
        lines.append("（全部为白名单机械修复，修复前已自动创建检查点，可撤销。）")
    else:
        lines.append("（无）")

    low_conf = [
        i for i in issues if i["confidence"] != "high" and i["status"] in ("open", "accepted")
    ]
    lines.append("")
    lines.append("## 需要人工判断")
    lines.append("")
    if low_conf:
        lines.append(
            f"以下 {len(low_conf)} 项置信度为中/低，工具不自动修复，请逐项确认（已在上方列出）："
        )
        lines.append("、".join(sorted({i['rule_id'] for i in low_conf})))
    else:
        lines.append("（无）")

    lines.append("")
    lines.append("## 外部验证状态")
    lines.append("")
    for tool, status in report["external_tools"].items():
        label = _EXTERNAL_LABEL.get(status, status)
        lines.append(f"- {tool}：{label}")

    if report["skipped_rule_groups"]:
        lines.append("")
        lines.append("## 本版本未启用的检查")
        lines.append("")
        for g in report["skipped_rule_groups"]:
            lines.append(f"- {g['milestone']} 规则组：{g['reason']}")

    lines.append("")
    lines.append("## 使用的规则与标准")
    lines.append("")
    lines.append(f"- 规则包：{report['rulepack']['name']} {report['rulepack']['version']}")
    refs = sorted({r for i in issues for r in i["standard_refs"]})
    if refs:
        lines.append(f"- 涉及标准条目：{'、'.join(refs)}（详见 APP 标准资源页）")

    lines.append("")
    lines.append("## 隐私与限制声明")
    lines.append("")
    lines.append(report["disclaimer"])

    lines.append("")
    lines.append("## 湖岸橡树出版评估")
    lines.append("")
    lines.append(_EVALUATION_BLOCK)
    lines.append("")
    lines.append(f"—— 湖岸稿件 v{report['app_version']}，生成于 {report['generated_at']}")
    return "\n".join(lines) + "\n"


def render_html(report: dict) -> str:
    e = _html.escape
    parts: list[str] = []
    parts.append("<!doctype html>")
    parts.append('<html lang="zh-CN"><head><meta charset="utf-8">')
    parts.append(f"<title>湖岸稿件检查报告 — {e(report['file'])}</title>")
    parts.append(
        "<style>body{font-family:system-ui,'Microsoft YaHei',sans-serif;max-width:52rem;"
        "margin:2rem auto;padding:0 1rem;line-height:1.6;color:#222}"
        "h1{border-bottom:2px solid #2f6f4f;padding-bottom:.3rem}"
        "h2{color:#2f6f4f;margin-top:1.6rem}"
        ".issue{border:1px solid #ddd;border-left:4px solid #ccc;padding:.5rem .8rem;margin:.5rem 0}"
        ".sev-error{border-left-color:#c0392b}.sev-warning{border-left-color:#d68910}"
        ".sev-suggestion{border-left-color:#2e86c1}"
        ".meta{color:#555}.preview{background:#f6f6f6;padding:.1rem .3rem;font-family:monospace}"
        "footer{margin-top:2rem;color:#777;font-size:.9rem}</style></head><body>"
    )
    parts.append("<h1>湖岸稿件检查报告</h1>")
    parts.append('<p class="meta">')
    parts.append(
        f"文件：{e(report['file'])} ｜ 稿件类型：{e(report['manuscript_type'])} ｜ "
        f"检查时间：{e(report['check']['finished_at'])} ｜ "
        f"规则包：{e(report['rulepack']['name'])} {e(report['rulepack']['version'])}<br>"
        f"引用体例：{e(report['citation_note'])}"
    )
    parts.append("</p>")
    p = report["pending_counts"]
    parts.append("<h2>结论摘要</h2>")
    parts.append(f"<p><strong>{e(report['status_level'])}</strong></p>")
    parts.append(
        f"<p>未处理问题：必须处理 {p['error']} 项，建议处理 {p['warning']} 项，"
        f"可选改进 {p['suggestion']} 项。</p>"
    )
    for severity, title in _SEVERITY_SECTIONS:
        items = _pending(report["issues"], severity)
        parts.append(f"<h2>{e(title)}</h2>")
        if not items:
            parts.append("<p>（无）</p>")
        for i in items:
            parts.append(f'<div class="issue sev-{e(severity)}">')
            parts.append(f"<strong>{e(i['title'])}</strong>（{e(i['rule_id'])}，{e(_loc(i))}）<br>")
            if i["preview"]:
                parts.append(f'预览：<span class="preview">{e(i["preview"])}</span><br>')
            parts.append(f"说明:{e(i['explanation'])}<br>")
            parts.append(f"标准依据:{e('、'.join(i['standard_refs']))}")
            parts.append("</div>")
    parts.append("<h2>已自动订正</h2>")
    if report["applied_fixes"]:
        parts.append("<ul>")
        for f in report["applied_fixes"]:
            parts.append(f"<li>{e(f['title'])}（{e(f['rule_id'])}）：{f['count']} 处</li>")
        parts.append("</ul><p>全部为白名单机械修复，修复前已自动创建检查点，可撤销。</p>")
    else:
        parts.append("<p>（无）</p>")
    parts.append("<h2>外部验证状态</h2><ul>")
    for tool, status in report["external_tools"].items():
        parts.append(f"<li>{e(tool)}：{e(_EXTERNAL_LABEL.get(status, status))}</li>")
    parts.append("</ul>")
    parts.append("<h2>隐私与限制声明</h2>")
    parts.append(f"<p>{e(report['disclaimer'])}</p>")
    parts.append("<h2>湖岸橡树出版评估</h2>")
    parts.append(f"<p>{e(_EVALUATION_BLOCK)}</p>")
    parts.append(
        f"<footer>湖岸稿件 v{e(report['app_version'])} ｜ 生成于 {e(report['generated_at'])}</footer>"
    )
    parts.append("</body></html>")
    return "\n".join(parts)
