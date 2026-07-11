# DEVELOPMENT_STATUS — 开发状态（唯一状态来源）

> 每个阶段 / 里程碑完成后更新。最新在上。

## 当前状态（2026-07-11）

| 阶段 | 状态 |
|---|---|
| 阶段 0：产品与规则基线 | **完成**（2026-07-11） |
| 阶段 1 M1：DOCX + 论文 + GB/T 7714 命令行闭环 | **完成**（2026-07-11，验收见 ACCEPTANCE.md） |
| 阶段 1 M2：纸质出版物 + APA 7 / Chicago 18 + MD/TXT | 未开始（下一步） |
| 阶段 1 M3：EPUB | 未开始 |
| 阶段 2：桌面 APP MVP | 未开始 |
| 阶段 3—5 | 未开始 |

### 测试基线

- 统一入口：`python scripts/run_tests.py`（unittest，零第三方依赖）
- 当前：**103 项测试，0 失败 0 错误**（含 CLI 子进程端到端闭环）
- 样本再生成：`python scripts/make_samples.py`（确定性，固定 ZIP 时间戳）

### 关键交付物索引

| 交付物 | 位置 |
|---|---|
| 冻结规格 | docs/SPEC_PROJECT_FORMAT.md、docs/SPEC_MODELS.md、docs/RULESET_V1.md |
| 规则包 v1.0.0（35 条） | config/rule-packs/oak-rules-1.0.0.json |
| 标准注册表 | config/standards.json |
| 匿名样本库 | samples/（3 DOCX + MD + TXT，缺陷↔规则对照见 samples/README.md） |
| 检查核心 | python/oak_manuscript_core/（CLI：create/check/fix/recheck/export/verify/issue） |
| 架构决策 | docs/ARCHITECTURE.md（AD-001 零依赖、AD-002 CLI 契约、AD-003 规则包分离） |

### M2 待办（进入前先读方案 §18 M2）

- Markdown / TXT 读取器（含结构映射到统一文档模型）；
- print_book 配置与 BOOK-* 规则实现（3 条）；
- REF-APA-001 / REF-CHI-001 引用检查；MD-STRUCT-001；
- 引擎 IMPLEMENTED_MILESTONES 扩展为 {M1, M2} 并补样本与测试。

## 历史记录

- 2026-07-11：**M1 完成**。项目管理（哈希/检查点）、DOCX 读取器（stdlib + ZIP 安全）、确定性规则引擎 + 23 条 M1 规则、4 项白名单幂等修复、三格式报告与修订稿导出、CLI 闭环、103 项测试。Word COM 实测修订稿正常打开。
- 2026-07-11：阶段 0 完成。冻结项目格式 / 三模型 / 规则包 v1.0.0（35 条）/ 默认体例映射 v1.0.0；建匿名样本库。
- 2026-07-11：仓库基线建立。代码从零开始（旧实现已放弃，不参考）。
