# TEST_REPORT — 测试报告

> 每次里程碑级测试运行后更新。记录命令、环境、结果与失败处理。未运行的项目标注「未运行」，不得声称通过。

## 最新一次运行（2026-07-11，M1 验收）

- 环境：Windows 11 Pro，Python 3.13.14（要求 3.11+，零第三方依赖）
- 命令：`python scripts/run_tests.py`
- 结果：**103 项测试，0 失败，0 错误**（1.4 秒）

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

### 实机验收（非自动化，2026-07-11）

- `out/demo-project` CLI 实跑闭环：check 退出码 1（存在 error）→ fix → recheck（白名单问题清零）→ export 4 文件 → verify 退出码 0、原稿哈希不变；
- Microsoft Word（COM）只读打开导出的修订稿：正常打开，段落 26 → 25（空段合并），正文无双空格与重复标点，脚注 4 条完好。

## 外部工具验证状态

| 工具 | 用途 | 状态 |
|---|---|---|
| EpubCheck | EPUB 标准验证（M3） | 未运行 |
| Ace by DAISY | EPUB 可访问性（M3） | 未运行 |

## 历史记录

- 2026-07-11：M1 验收运行，103/103 通过（见上）。
