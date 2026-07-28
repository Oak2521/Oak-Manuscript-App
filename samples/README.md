# samples/ — 匿名样本库

> 全部为**构造样本**：由 `scripts/make_samples.py`（零依赖，可复现，固定 ZIP 时间戳）生成，不含任何真实稿件内容（方案 §20.5）。重新生成：`python scripts/make_samples.py`。
> 这是仓库测试**唯一允许**的语料来源。

## 样本清单与预期行为

| 文件 | 用途 | 预期 |
|---|---|---|
| `paper_good.docx` | 论文绿色基线 | **0 条问题**；2.0.0 默认解析为 gbt7714-2025 / high / `numeric_reference_structure` |
| `paper_needs_review.docx` | 论文缺陷样本 | 2.0.0 默认因 `conflicting_structures` 退回 `structure_only`，首检 18 个 issue、16 种规则；4 条白名单类型可自动修复且幂等 |
| `paper_missing_parts.docx` | 结构缺失 | 仅触发 PAPER-STRUCT-001 / 002 / 003 / 004 |
| `book_good.docx` | 书稿绿色基线（M2） | **0 条问题**；2.0.0 信号未达阈值，默认退回 `structure_only` / `insufficient_evidence`；1.0.0 legacy 回归仍映射 chicago-18-nb |
| `book_no_structure.docx` | 书稿缺陷一（M2） | 仅触发 {BOOK-STRUCT-001, BOOK-PAGE-001}（2 分页符 + 1 分节符 = 3 处，达聚合阈值） |
| `book_toc_mismatch.docx` | 书稿缺陷二（M2） | 仅触发 {BOOK-STRUCT-002}（目录「第二章 转折」vs 标题「第二章 转机」） |
| `paper_apa_citations.md` | APA + MD 缺陷（M2） | 触发 {MD-STRUCT-001, REF-APA-001}；2.0.0 默认解析为 apa-7 / medium / `author_year_structure`；(Jones, 2021) 无条目 |
| `epub_good.epub` | 电子书绿色基线（M3 + 外部工具好样本） | **0 条核心问题**；EPUB 目前只能部分提取引用信号，2.0.0 默认退回 `structure_only` / `extractor_coverage_insufficient`；固定 EpubCheck/Ace 真实结果均为 `passed` |
| `epub_needs_review.epub` | 电子书缺陷样本（M3 + 外部工具坏样本） | 同样退回 `structure_only`；触发全部 6 条 EPUB 规则（其中断链×2）；MIME 与 LANG 可修复；固定 EpubCheck/Ace 真实结果均为 `failed` |
| `paper_sample.md` / `paper_sample.txt` | 输入冒烟 | 干净输入；txt 无适用规则，检查空跑为 0 问题；短文本默认解析因语言证据不足返回 `structure_only` |

## paper_needs_review.docx 种入缺陷 ↔ 规则对照

下表是样本内全部可检缺陷。在 2.0.0 默认解析的 `structure_only` 模式下，最后三条 GB/T 专属规则不会调度；显式选择 GB/T 或 1.0.0 legacy 回归时才会触发。

| 规则 | 种入位置（构造时注释一致） |
|---|---|
| DOCX-SPACE-001 | 「这里有␣␣连续空格」段（两处） |
| DOCX-SPACE-002 | 含制表符 run 的段 |
| DOCX-SPACE-003 | 全角空格开头段 |
| DOCX-PUNCT-001 | 「。。」段（省略号……与破折号——为反例，不得触发） |
| DOCX-PARA-001 | 两个连续空段 |
| PUNCT-MIX-001 | 「中文,句子」段 |
| PUNCT-MIX-002 | 「术语(中文说明)」段 |
| HEAD-STRUCT-001 | H1「1 引言」后直接 H3「1.1.1」 |
| HEAD-STRUCT-002 | H2「2.1」后直接 H2「2.3」 |
| NOTE-001 | 脚注 2（空） |
| NOTE-002 | 脚注 3（未被引用） |
| NOTE-003 | 脚注 4 与 5（内容相同） |
| REF-001 | 条目 [4] 与 [1] 重复 |
| REF-002（error） | 正文引用 [5] 无对应条目 |
| REF-003 | 条目 [4]、[6] 未被引用 |
| REF-004 | 条目 [4] 之后直接 [6] |
| REF-GBT-001 | 条目 [2] 缺 [J] 标识 |
| REF-GBT-002 | 条目 [3] 缺年份 |
| REF-GBT-003 | 条目 [6] 全半角标点混用 |

## 反例（不得误报）

- 省略号「……」、破折号「——」不算重复标点；
- 「3.11」等版本号 / 小数不算中文语境半角标点（两侧非中文）；
- GB/T 条目内「. 」「: 」后带空格的半角著录符号不触发 PUNCT-MIX-001；
- 含图片 / 分节符的段落不算空段（生成器暂未覆盖，实现时以单测覆盖）。

## 外部验证契约

`epub_good.epub` 和 `epub_needs_review.epub` 同时是资源门禁的好/坏矩阵，不只是核心规则样本：

- EpubCheck 5.3.0：好样本退出 0 且 fatal/error 为 0；缺陷样本退出 1 且存在 error；
- Ace 1.4.6：好样本生成 `earl:outcome=pass`；缺陷样本生成 `earl:outcome=fail`；
- 工具没有运行、报告非法或退出码不符合契约时必须记录 `not_run`，不能把它算作上述通过/失败证据。

上述 Ace 证据只在受版本控制的 `ace-1.4.6` full lock 与实际 stage 完全一致、且 Python 运行路径重新核对 236 包闭包/补丁/全部文件后成立。EpubCheck 的好/坏矩阵同样只能由目标 platform/arch 的原生 JRE 探针产生；`--no-runtime-probe` 静态检查不能替代该证据。

好样本中的额外无障碍元数据是构造基线的一部分，目的是让真正的 Ace 好样本成立；它不代表应用已经完成对所有 EPUB Accessibility 1.1 要求的内建检查。重新生成样本后必须同时重跑核心、EpubCheck 和显式启用的 Ace 测试，不能只比较内部六条 M3 规则。

桌面 smoke 使用这些样本创建真实项目，并读取 `project.json` 及其引用的检查报告，核对 Python core 版本、check ID，以及 APP/项目/检查/报告的规则包名称、版本、固定标志、规则包 SHA-256、bundle ID、release sequence 与 manifest SHA-256；因此样本流程通过不能只由 Renderer 返回值证明。
