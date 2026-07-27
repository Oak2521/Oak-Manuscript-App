# CHANGELOG — 湖岸稿件（Oak Manuscript）

记录仓库与规则包的版本变更。规则包版本独立于 APP 版本（见 `config/rule-packs/`）。

## [未发布]

### 2026-07-26 — 0.1.0-alpha.1（ChatGPT 商业正式版开发线）

**可信批量修复 P0**

- 新增只读 `plan-fixes` 和强制 `plan_id` 的 `fix` 契约；UI 在一个可滚动界面集中展示本批全部修改前/后内容，一次确认后整批执行；取消零写入；
- 离散 TAB 逐位置展示，任一 rejected 同类问题会阻断整个全文 fixer，避免修改未展示或已拒绝位置；
- 修复在临时 working 副本执行，working / issues / project 提交失败时回滚；已有 5 个检查点时恢复被裁剪目录；
- 检查点升级为 working + issues + 项目状态 + 检查结果快照，新增列表、安全恢复、撤销上次批量修复和损坏项禁用；
- 新增 `list-checkpoints` / `restore-checkpoint` CLI，Electron 只暴露四个固定 P0 IPC；修复 sandbox preload 本地模块引用回归；
- APP、Python 核心与 lockfile 版本统一为 `0.1.0-alpha.1`；测试统一入口改为 `npm test`。

**方案与审计**

- 新增商业正式版权威方案 `v2.0-ChatGPT`：Windows/macOS/Web、统一湖岸账号、有限 Free+Pro、结果与元数据同步、服务端 Web 处理、签名标准升级和正式发布门禁；
- 新增内置标准完整性审计：当前 13 条注册表 / 35 条规则是最小库，不得宣传为完整标准库；
- 修正旧报告“185 + Ace = 186”错误；Claude 0.0.1 现场结果是同一套 185 项在启用 Ace 后从跳过变为执行。

**验证**

- Node：12/12；Python：210 项，默认 1 项 Ace 跳过，启用 Ace 后 210 项无跳过；
- 隐藏 Electron smoke：DOCX 21→5→16、EPUB 7→2→5，覆盖取消、确认、撤销、重新应用、导出、PDF 和 verify，PASS；
- 0.1.x Windows 新包、NSIS、macOS、Web、账号/订阅/同步和标准更新器仍未完成，不属于本条已完成范围。

### 2026-07-11 — 阶段 2 完成 + 阶段 3 部分完成（0.0.1 内部开发版）

**阶段 2：桌面 APP MVP**
- Electron 43 壳：安全基线全项（contextIsolation / sandbox / IPC 白名单 + 输入验证 / shell=false / CSP / 导航拦截 / 外链白名单）；python-bridge（UTF-8 JSON 契约直连核心 CLI）；Provider 全占位不联网；
- 七个中文主页面（§7.1）：欢迎隐私 / 创建项目 / 检查目标 / 阶段式进度 / 问题双栏（接受·拒绝·暂不处理）/ 导出中心 / 标准资源与设置；登录入口「即将开放」；
- PDF 审阅样张（printToPDF ≤16 页）；`npm run smoke`：DOCX + EPUB 双闭环走真实 UI 代码路径，PASS；
- 修复：productName 含斜杠导致 Electron userData 路径初始化崩溃（0xC0000005）。

**外部验证与导出补全**
- EpubCheck 5.3.0 下载接入（Java 21）：`external` 子命令 + UI 按钮，状态真实写回报告（passed/failed/not_run + 明细）；其发现并修复了生成器缺 dcterms:modified 的真实缺口；
- Ace 1.4.6 接入（跳过内置 Chromium，本机 Chrome 驱动）；
- 新增脱敏出版评估摘要导出（§8.4 字段白名单 + 泄露断言测试）。

**阶段 3：打包**
- Windows x64 便携 ZIP（electron-builder）：捆绑 Python 3.13.14 嵌入式运行时 + 核心 + 规则包 + 样本 + EpubCheck，解压即用；应用图标（零依赖生成）；SHA-256 校验值与发布说明（RELEASE_NOTES_0.0.1.md）；打包版 --smoke 双闭环 PASS。

测试：175 → **185 项**（+Ace 慢测 1 项按需启用）。

### 2026-07-11 — 阶段 1 M3 完成（阶段 1 收官）

- EPUB 读取器：mimetype 三要件校验、container→OPF、必需元数据、nav、内容文档 lang / img / 链接锚点（复用 ZIP 安全层）；
- 6 条 EPUB 规则实现（冻结定义零变更）；Issue location 新增可选 `resource` 字段与 `package` 部位（向后兼容扩展，见 SPEC_MODELS 附注）；
- 白名单按纪律扩至 6 条封顶：FIX-EPUB-MIME-001（重建首位不压缩）、FIX-EPUB-LANG-001（按 dc:language 补齐，语言未知不补写）；`apply_fixes` 按格式分发；
- 基础 EPUB 导出（`--epub-preview`）：产物经本核心 EPUB 检查自检零问题；
- EpubCheck / Ace 保持「未运行」如实标注（真实接入待用户授权外部工具下载）；
- 新增 epub_good / epub_needs_review 样本；测试 135 → **175 项**全通过；CLI 实跑 EPUB 闭环与预览导出验收。

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
