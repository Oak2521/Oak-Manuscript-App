# DEVELOPMENT_STATUS — 开发状态（唯一状态来源）

> 每个阶段 / 里程碑完成后更新。最新在上。

## 当前状态（2026-07-11）

| 阶段 | 状态 |
|---|---|
| 阶段 0：产品与规则基线 | **完成**（2026-07-11） |
| 阶段 1 M1：DOCX + 论文 + GB/T 7714 命令行闭环 | **完成**（2026-07-11，验收见 ACCEPTANCE.md） |
| 阶段 1 M2：纸质出版物 + APA 7 / Chicago 18 + MD/TXT | **完成**（2026-07-11，验收见 ACCEPTANCE.md） |
| 阶段 1 M3：EPUB 输入与电子书配置 + 基础 EPUB 导出 | 未开始（下一步） |
| 阶段 2：桌面 APP MVP | 未开始 |
| 阶段 3—5 | 未开始 |

### 测试基线

- 统一入口：`python scripts/run_tests.py`（unittest，零第三方依赖）
- 当前：**135 项测试，0 失败 0 错误**（含 CLI 子进程端到端闭环）
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

### M3 待办（进入前先读方案 §18 M3 与 §6.2 电子书格式）

- EPUB 读取器：容器 / mimetype / OPF / manifest / spine / nav 解析（复用 safety ZIP 防护）；
- 6 条 M3 规则实现：EPUB-MIME-001（可修复）、EPUB-OPF-001、EPUB-NAV-001、EPUB-LANG-001（可修复）、EPUB-IMG-001、EPUB-LINK-001；
- 白名单扩展 FIX-EPUB-MIME-001 / FIX-EPUB-LANG-001（需反例 + 幂等测试，方案 §24 第 8 条）；
- 基础 EPUB 导出（DOCX/MD → EPUB）；
- EpubCheck / Ace 外部工具接入点（未运行如实标注，绝不虚报通过）；
- 匿名 EPUB 样本（good / 缺陷），引擎 IMPLEMENTED_MILESTONES 扩至 {M1, M2, M3}。

## 历史记录

- 2026-07-11：**M2 完成**。Markdown / TXT 读取器（ATX 标题、围栏豁免、BOM/CRLF 容错）、6 条 M2 规则（书稿结构 / 目录一致性 / 分页聚合 / MD 标题 / APA 括注核对 / Chicago 注释书目一致）、4 个新样本、ops/CLI 支持 md/txt 全流程。135 项测试。
- 2026-07-11：**M1 完成**。项目管理（哈希/检查点）、DOCX 读取器（stdlib + ZIP 安全）、确定性规则引擎 + 23 条 M1 规则、4 项白名单幂等修复、三格式报告与修订稿导出、CLI 闭环、103 项测试。Word COM 实测修订稿正常打开。
- 2026-07-11：阶段 0 完成。冻结项目格式 / 三模型 / 规则包 v1.0.0（35 条）/ 默认体例映射 v1.0.0；建匿名样本库。
- 2026-07-11：仓库基线建立。代码从零开始（旧实现已放弃，不参考）。
