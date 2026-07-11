# CHANGELOG — 湖岸稿件（Oak Manuscript）

记录仓库与规则包的版本变更。规则包版本独立于 APP 版本（见 `config/rule-packs/`）。

## [未发布]

### 2026-07-11 — 阶段 1 M2 完成

- Markdown / TXT 读取器：ATX 标题、空行分段、围栏代码豁免、BOM/CRLF 容错；文档模型正名 `Document`（保留 `DocxDocument` 别名），段落新增 `page_break_count`；
- 6 条 M2 规则实现（定义沿用冻结规则包，无一变更）：BOOK-STRUCT-001 / BOOK-STRUCT-002（目录归一化比对，容页码引导符）/ BOOK-PAGE-001（≥3 处聚合提示）/ MD-STRUCT-001 / REF-APA-001（括注→条目单向核对，支持 & 与 et al.）/ REF-CHI-001（注释↔书目存在性一致）；
- 引擎里程碑扩至 {M1, M2}；ops/CLI 全流程支持 md / txt 输入，.epub 明确提示 M3；
- 新增 4 个匿名样本（book_good / book_no_structure / book_toc_mismatch / paper_apa_citations.md）；
- 测试 103 → **135 项**全通过；CLI 实跑书稿与 APA Markdown 双闭环验收（TEST_REPORT.md）。

### 2026-07-11 — 阶段 0 完成 + 阶段 1 M1 完成

**阶段 0（基线冻结）**

- 冻结项目文件格式 v1.0（SPEC_PROJECT_FORMAT.md）与问题 / 规则 / 标准三模型 v1.0（SPEC_MODELS.md）；
- 冻结规则包 oak-rules 1.0.0：35 条规则（M1 23 / M2 6 / M3 6），自动修复白名单 4 条；「默认」体例映射 v1.0.0；
- 标准注册表 standards.json（12 条：官方 4 + 湖岸解释 8）；
- 匿名样本库：确定性生成脚本 + 3 个 DOCX 样本（好 / 缺陷 / 结构缺失，缺陷↔规则对照登记）+ MD/TXT。

**阶段 1 M1（DOCX + 论文 + GB/T 7714—2025 命令行闭环）**

- 检查核心 `oak_manuscript_core`（Python 3.11+，零第三方依赖）：项目管理（只读原稿 + SHA-256 + 检查点≤5）、DOCX 读取器（ZIP 三类上限与穿越防护）、确定性规则引擎、白名单机械修复（幂等）、三格式报告 + 修订稿导出、CLI（create/check/fix/recheck/export/verify/issue，UTF-8 JSON 契约）；
- 统一测试入口 `python scripts/run_tests.py`：103 项测试全通过；
- M1 验收全项达成（ACCEPTANCE.md），Word COM 实测修订稿正常打开。

**文档与方案**

- 方案升级 v1.2：完成 oak-publishing-system 与 netlify-site 只读核对，落实全部「待核实」标注；
- 仓库基线：§19 目录骨架、AGENTS.md、七份 docs 骨架。
