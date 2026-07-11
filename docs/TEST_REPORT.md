# TEST_REPORT — 测试报告

> 每次里程碑级测试运行后更新。记录命令、环境、结果与失败处理。未运行的项目标注「未运行」，不得声称通过。

## 最新一次运行（2026-07-11，M3 验收 / 阶段 1 完成）

- 环境：Windows 11 Pro，Python 3.13.14（要求 3.11+，零第三方依赖）
- 命令：`python scripts/run_tests.py`
- 结果：**175 项测试，0 失败，0 错误**（2.1 秒）

### 覆盖矩阵

| 测试模块 | 项数 | 覆盖 |
|---|---|---|
| tests/test_project.py | 13 | 创建 / 只读原稿 / SHA-256 / 检查点上限与恢复 / 完整性验证 / 篡改检测 |
| tests/test_docx_reader.py | 11 | 段落 / 标题级别 / 制表符 / 脚注（含分隔符排除）/ 损坏文件 / ZIP 穿越与三类上限 |
| tests/test_rulepack.py | 13 | 规则包冻结校验 / 白名单纪律 / 语言识别四态 / 默认体例映射五组合 |
| tests/test_rules.py | 26 | 23 条 M1 规则逐条正例 + 白名单反例（省略号 / 版本号 / 著录符号等不误报） |
| tests/test_engine.py | 8 | 好样本 0 误报 / 缺陷样本恰好 19 规则 / 结构样本恰好 4 规则 / 确定性 / 字段完备 / M2 M3 如实跳过 |
| tests/test_fixes.py | 14 | 4 项白名单修复正确性 / 跨 run 边界 / 幂等（字节级）/ 越权拒绝 / 修复后复检 |
| tests/test_reports_export.py | 10 | check→fix→recheck 编排 / 拒绝状态穿越复检 / 报告章节完备 / HTML 转义 / 导出 |
| tests/test_cli.py | 3 | 子进程真实闭环（六命令 + 退出码语义）/ 不支持格式 / 篡改检测退出码 2 |
| tests/test_text_readers.py | 7 | （M2）Markdown ATX 标题 / 分段 / 围栏豁免 / 尾部井号；TXT 分段 / BOM / CRLF |
| tests/test_rules_m2.py | 17 | （M2）6 条规则逐条正例 + 反例（目录页码引导符、分页阈值、APA 双作者与 et al.） |
| tests/test_engine_m2.py | 7 | （M2）书稿绿色基线 0 误报 / 三缺陷样本触发集精确断言 / txt 空跑 / 确定性 / 仅剩 M3 未启用 |
| tests/test_reports_export.py（增） | +1 | md 项目 ops 全流程；损坏 epub 可理解报错 |
| tests/test_epub_reader.py | 11 | （M3）mimetype 三要件 / container→OPF / 元数据 / nav / lang / img alt / 链接锚点 / 损坏包报错 |
| tests/test_rules_m3.py | 11 | （M3）6 条 EPUB 规则正例 + 反例（alt="" 留空合法、外链不查） |
| tests/test_fixes_m3.py | 10 | （M3）mimetype 重建 / lang 补齐 / 幂等（字节级）/「无 dc:language 不修」反例 / 格式分发 |
| tests/test_engine_m3.py | 8 | （M3）EPUB 绿基线 0 误报 / 缺陷样本 6 规则全中 / ops 闭环 / 外部工具 not_run / 基础 EPUB 导出自检 |

### 实机验收（非自动化，2026-07-11）

**M1**
- `out/demo-project` CLI 实跑闭环：check 退出码 1（存在 error）→ fix → recheck（白名单问题清零）→ export 4 文件 → verify 退出码 0、原稿哈希不变；
- Microsoft Word（COM）只读打开导出的修订稿：正常打开，段落 26 → 25（空段合并），正文无双空格与重复标点，脚注 4 条完好。

**M2**
- `out/demo-m2-book`（print_book DOCX）：check 退出码 0（仅 warning），触发集 = {BOOK-STRUCT-002}，状态「可在订正后提交」，导出 4 文件；
- `out/demo-m2-md`（APA Markdown）：check 退出码 0，触发集 = {MD-STRUCT-001, REF-APA-001}，体例记录「本次按 apa-7 体例检查（由默认规则 v1.0.0 选定）」，导出 + verify 通过。

**M3**
- `out/demo-m3-epub`（ebook EPUB 缺陷样本）：check 退出码 1（MIME/OPF/NAV 为 error）→ fix（MIME+LANG 各 1 处）→ recheck 退出码 1（OPF/NAV 等仍在，符合预期）→ export 4 文件 → verify 退出码 0；
- `out/demo-m3-preview`（paper DOCX + --epub-preview）：export 5 文件，`preview.epub` 生成并经本核心 EPUB 检查自检零问题。

## 外部工具验证状态

| 工具 | 用途 | 状态 |
|---|---|---|
| EpubCheck | EPUB 标准验证（M3） | 未运行 |
| Ace by DAISY | EPUB 可访问性（M3） | 未运行 |

## 历史记录

- 2026-07-11：M1 验收运行，103/103 通过（见上）。
