# RULESET_V1 — 第一版最小规则集（冻结）

> 冻结日期：2026-07-11（阶段 0）。机器可读定义以 `config/rule-packs/oak-rules-1.0.0.json` 为准，本文件为人类可读摘要。
> 共 **35 条**（方案要求 20—40 条）：M1 23 条、M2 6 条、M3 6 条。规则来源：oak-publishing-system 检查工具判断逻辑的提炼（见《可复用资产清单》第五节来源优先级）+ 湖岸风格指南。
> **变更纪律**：第一版期间不加新规则；修改严重程度 / 置信度 / 白名单须升规则包版本并附样本与测试（方案 §9.3、§24）。

## 自动修复白名单（M1 仅 4 条）

| fix_id | 规则 | 操作 | 幂等保证 |
|---|---|---|---|
| FIX-SPACE-001 | DOCX-SPACE-001 | 连续空格合并为一个 | 二次运行零变更 |
| FIX-TAB-001 | DOCX-SPACE-002 | 正文制表符替换为一个空格 | 二次运行零变更 |
| FIX-EMPTYPARA-001 | DOCX-PARA-001 | 连续空段合并为至多一个（含分节符 / 图片的段落豁免） | 二次运行零变更 |
| FIX-PUNCT-001 | DOCX-PUNCT-001 | 重复全角标点合并为单个（省略号……、破折号——豁免） | 二次运行零变更 |

M3 两条（已于 2026-07-11 随 M3 实现，白名单就此 6 条封顶）：FIX-EPUB-MIME-001（重建 mimetype 为首位不压缩）、FIX-EPUB-LANG-001（按 OPF dc:language 补齐 html lang；**语言未声明时不修**）。其余 29 条一律不自动修复（语境敏感或涉及作者取舍）。

## M1 规则（23 条，DOCX + 论文 + GB/T 7714—2025）

| rule_id | 标题 | 严重程度 | 置信度 | 自动修复 |
|---|---|---|---|---|
| DOCX-SPACE-001 | 连续空格 | warning | high | ✔ |
| DOCX-SPACE-002 | 正文段落中的制表符 | warning | high | ✔ |
| DOCX-SPACE-003 | 段首手工空格缩进 | suggestion | high | ✘ |
| DOCX-PARA-001 | 连续空段落 | warning | high | ✔ |
| DOCX-PUNCT-001 | 重复标点 | warning | high | ✔ |
| PUNCT-MIX-001 | 中文语境中的半角标点 | warning | medium | ✘ |
| PUNCT-MIX-002 | 半角括号包裹中文内容 | suggestion | medium | ✘ |
| PAPER-STRUCT-001 | 题名不明确 | warning | medium | ✘ |
| PAPER-STRUCT-002 | 缺少摘要 | warning | high | ✘ |
| PAPER-STRUCT-003 | 缺少关键词 | warning | high | ✘ |
| PAPER-STRUCT-004 | 缺少参考文献部分 | warning | high | ✘ |
| HEAD-STRUCT-001 | 标题层级跳级 | warning | high | ✘ |
| HEAD-STRUCT-002 | 标题编号不连续 | warning | medium | ✘ |
| NOTE-001 | 空脚注 / 尾注 | warning | high | ✘ |
| NOTE-002 | 未被正文引用的注释定义 | warning | high | ✘ |
| NOTE-003 | 重复的注释内容 | suggestion | medium | ✘ |
| REF-001 | 参考文献条目重复 | warning | high | ✘ |
| REF-002 | 文内引用编号无对应文献条目 | **error** | high | ✘ |
| REF-003 | 文献条目未被文内引用 | warning | medium | ✘ |
| REF-004 | 参考文献编号不连续 | warning | high | ✘ |
| REF-GBT-001 | 条目缺少文献类型标识 | warning | high | ✘ |
| REF-GBT-002 | 条目疑似缺少年份 | warning | medium | ✘ |
| REF-GBT-003 | 文献条目内全半角标点混用 | suggestion | medium | ✘ |

## M2 规则（6 条，纸质出版物 + APA/Chicago + MD/TXT）

BOOK-STRUCT-001 缺少章节标题结构、BOOK-STRUCT-002 目录与章节标题不一致、BOOK-PAGE-001 手工分页与分节风险、MD-STRUCT-001 Markdown 标题层级跳级、REF-APA-001 APA 括注对应检查、REF-CHI-001 Chicago 注释—书目一致性。

## M3 规则（6 条，EPUB）

EPUB-MIME-001 mimetype 存放错误（error，可修复）、EPUB-OPF-001 缺少必需元数据（error）、EPUB-NAV-001 缺少导航文档（error）、EPUB-LANG-001 HTML 语言属性缺失（可修复）、EPUB-IMG-001 图片缺少替代文本（不自动补写）、EPUB-LINK-001 内部链接锚点断裂。

## 设计原则备忘

- 「默认」体例映射 v1.0.0 随本规则包发布（paper×zh/mixed→GB/T 7714—2025；paper×en→APA 7；print_book→Chicago 18 注释—书目；ebook→暂不检查）；
- 所有规则确定性：同输入 + 同包版本 = 同结果；medium/low 置信度一律不进白名单；
- 引擎对未实现里程碑的规则组在报告中如实列「未启用」，绝不静默跳过。
