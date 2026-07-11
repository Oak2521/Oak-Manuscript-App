"""生成匿名样本库（samples/）。零第三方依赖。

样本全部为构造文本，不含任何真实稿件内容（方案 §20.5）。
paper_needs_review.docx 的缺陷是有意种入的，与 M1 规则一一对应，
预期问题清单见 samples/README.md。
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "python"))

from tests.docx_factory import DocxBuilder  # noqa: E402

SAMPLES = REPO / "samples"


def build_paper_good() -> DocxBuilder:
    """干净论文样本：预期 0 条问题。"""
    b = DocxBuilder()
    b.p("示例研究：构造样本的检查基线")
    b.p("摘要：本文是湖岸稿件的匿名构造样本，用于验证检查核心的基线行为。"
        "全文不含真实研究内容，各节文字仅为占位而写，长度足以支撑语言识别。")
    b.p("关键词：构造样本；检查基线；湖岸稿件")
    b.p("1 引言", style="Heading1")
    b.p("研究写作中的技术规范问题常常被忽视，文献[1]指出规范准备不足会显著拖慢编辑流程。"
        "本样本正文刻意保持干净：没有多余空格，没有重复标点，段落结构完整。")
    b.p_runs([("t", "规范化的稿件能够降低沟通成本"), ("fnref", 1),
              ("t", "，这一点在文献[2]中有系统论述。")])
    b.p("2 方法", style="Heading1")
    b.p("2.1 数据", style="Heading2")
    b.p("本节文字为构造占位。我们使用完全虚构的描述来充实篇幅，"
        "以便语言识别取得足够的中文字符数量，同时不引入任何真实数据。")
    b.p("2.2 分析", style="Heading2")
    b.p("分析过程同样为占位文字。文献[3]提供了一个网络资源示例，"
        "用于验证电子文献著录格式的识别。")
    b.p("3 结论", style="Heading1")
    b.p("构造样本应当通过全部检查，作为回归测试的绿色基线。")
    b.p("参考文献", style="Heading1")
    b.p("[1] 张示. 学术稿件的规范准备[M]. 北京: 示例出版社, 2020.")
    b.p("[2] 李构. 编辑流程中的技术检查[J]. 示例学报, 2021.")
    b.p("[3] 王样. 电子文献著录示例[EB/OL], 2022.")
    b.footnote(1, "这是一条有内容的脚注，用于验证脚注基线。")
    return b


def build_paper_needs_review() -> DocxBuilder:
    """缺陷样本：每条 M1 规则至少触发一次（结构四规则除外，见 minimal 样本）。"""
    b = DocxBuilder()
    b.p("待修订样本：种入已知缺陷的论文")
    b.p("摘要：本样本用于验证检查核心能发现全部 M1 规则对应的问题。"
        "以下缺陷全部为有意构造，问题与规则的对应关系登记在样本库说明中。")
    b.p("关键词：缺陷样本；规则验证")
    b.p("1 引言", style="Heading1")
    b.p("1.1.1 跳级小节", style="Heading3")  # HEAD-STRUCT-001：H1 后直接 H3
    b.p("这里有  连续空格，还有下一处   三连空格。")  # DOCX-SPACE-001 ×2
    b.p_runs([("t", "这一行包含"), ("tab",), ("t", "一个制表符。")])  # DOCX-SPACE-002
    b.p("　这一段以全角空格开头，疑似手工缩进。")  # DOCX-SPACE-003
    b.p("重复标点会被发现。。而省略号……和破折号——不受影响。")  # DOCX-PUNCT-001
    b.p_empty()
    b.p_empty()  # DOCX-PARA-001：连续空段
    b.p("这是中文,句子里夹了半角逗号。")  # PUNCT-MIX-001
    b.p("这个术语(中文说明)使用了半角括号。")  # PUNCT-MIX-002
    b.p("2 方法", style="Heading1")
    b.p("2.1 数据", style="Heading2")
    b.p("2.3 模型", style="Heading2")  # HEAD-STRUCT-002：2.1 → 2.3 断号
    b.p_runs([("t", "正文引用文献[1]与[2]，"), ("fnref", 1),
              ("t", "还引用了文献[3]和一个不存在的[5]。")])  # REF-002：[5] 无条目
    b.p_runs([("t", "空注在此"), ("fnref", 2),
              ("t", "，重复注两处："), ("fnref", 4), ("t", "与"), ("fnref", 5), ("t", "。")])
    b.p("3 结论", style="Heading1")
    b.p("本样本的正文长度足以让语言识别判定为中文为主，从而按默认映射选定国标体例。")
    b.p("参考文献", style="Heading1")
    b.p("[1] 张示. 学术稿件的规范准备[M]. 北京: 示例出版社, 2020.")
    b.p("[2] 李构. 编辑流程中的技术检查. 示例学报, 2021.")  # REF-GBT-001：缺 [J]
    b.p("[3] 王样. 另一项占位研究[J]. 示例学报.")  # REF-GBT-002：缺年份
    b.p("[4] 张示. 学术稿件的规范准备[M]. 北京: 示例出版社, 2020.")  # REF-001：与 [1] 重复；REF-003：未被引用
    b.p("[6] 赵占，位. 混用标点的网络资源[EB/OL], 2021。")  # REF-004：断号；REF-003：未引用；REF-GBT-003：全半角混用
    b.footnote(1, "这是一条正常脚注。")
    b.footnote(2, "")  # NOTE-001：空注
    b.footnote(3, "这条注释从未被正文引用。")  # NOTE-002：孤立注
    b.footnote(4, "完全相同的注释内容。")  # NOTE-003
    b.footnote(5, "完全相同的注释内容。")  # NOTE-003
    return b


def build_paper_missing_parts() -> DocxBuilder:
    """结构缺失样本：触发 PAPER-STRUCT-001..004，其余保持干净。"""
    b = DocxBuilder()
    b.p("这个文档没有明确的题名段落，因为第一段就是一段很长的正文文字，"
        "长度明显超过了题名识别所允许的一百字符上限，看起来更像是直接开始叙述的正文内容，"
        "而不是一个简短的论文标题，按照冻结的判定规则，题名识别应当在这里给出不明确的提示，"
        "以便作者自行确认稿件开头的结构安排是否符合投稿要求。")  # PAPER-STRUCT-001（>100 字符）
    b.p("后续正文没有摘要，没有关键词，也没有参考文献部分。")
    b.p("这些结构要件的缺失应当分别被识别为独立的问题。")
    return b


MD_SAMPLE = """# 示例文稿（Markdown 样本）

本文件用于 M2 里程碑的 Markdown 输入冒烟测试，内容为匿名构造文字。

## 一节

占位段落。

## 二节

占位段落。
"""

TXT_SAMPLE = """示例文稿（纯文本样本）

本文件用于 M2 里程碑的 TXT 输入冒烟测试，内容为匿名构造文字。
"""


def main() -> None:
    SAMPLES.mkdir(exist_ok=True)
    outputs = {
        "paper_good.docx": build_paper_good().bytes(),
        "paper_needs_review.docx": build_paper_needs_review().bytes(),
        "paper_missing_parts.docx": build_paper_missing_parts().bytes(),
        "paper_sample.md": MD_SAMPLE.encode("utf-8"),
        "paper_sample.txt": TXT_SAMPLE.encode("utf-8"),
    }
    for name, data in outputs.items():
        path = SAMPLES / name
        path.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        print(f"{name}  {len(data)} bytes  sha256={digest[:16]}…")


if __name__ == "__main__":
    main()
