# CHANGELOG — 湖岸稿件（Oak Manuscript）

记录仓库与规则包的版本变更。规则包版本独立于 APP 版本（见 `config/rule-packs/`）。

## [未发布]

### 2026-07-27 — 0.1.0-alpha.2（ChatGPT Windows 离线资源检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.2`。该标签只表示经测试的源码状态，不表示已经生成安装包或正式发行。

**Windows alpha 运行资源与可信门禁**

- 将 APP、Python 核心和 lockfile 版本统一为 `0.1.0-alpha.2`；源码 smoke 新增应用版本身份断言，防止旧包或旧源码冒充当前版本；
- Windows x64 嵌入式 Python 运行时纳入 34 个文件、21,260,753 字节的受版本控制全量哈希清单，并校验 `_pth` 隔离语义；只有全部资源校验通过后才运行探针；
- Temurin JRE 纳入 207 个文件、52,384,264 字节的锁定清单；EpubCheck 5.3.0 纳入 49 个文件、36,263,890 字节的完整分发清单，并以好样本/缺陷样本双向验证状态和错误数；
- Ace 1.4.6 形成 236 包、6,672 文件、58,964,235 字节的生产闭包；新增受版本控制的完整阶段 lock，固定所有文件哈希、许可证材料和一个受审核的 XHTML 隔离替换，移除作者脚本并限制加载协议；stage/lock 事务失败会恢复旧目录与旧锁；
- Ace staging 与资源门禁均拒绝空许可证文件；18 个依赖包的生成元数据通知仍不能代替原始许可证审计，且全部生产依赖闭包仍需正式人工审计；
- Python/EpubCheck/JRE/Ace 的 packaged 路径不再静默回退到系统 PATH 或开发树；资源缺失、增删、篡改、平台/架构不匹配均由门禁拒绝；
- Electron、源码 smoke 和资源探针统一用净化环境及 `-I -S -X utf8` bootstrap 调用 Python 核心；macOS x64/arm64 CPython 均固定为 `3.13.14`；
- JRE 运行目录与 tracked lock 作为一个事务换入，目录或锁提交失败时恢复原运行时和原锁字节；
- 对参与字节级信任锁的 manifest 与 Ace 隔离替换强制 Git checkout 使用 LF，并加入跨平台字节稳定性测试，避免 Windows `core.autocrlf` 破坏固定哈希；
- 信任清单与模块列表统一采用与系统 locale/ICU 无关的 UTF-16 code-unit 顺序；
- macOS 已拆分 x64/arm64 原生 runner，并提供明确不执行运行时探针的跨主机静态聚合；对应 Electron/Python/JRE 资源尚未准备，不能据此声称 macOS 已通过运行验证、可构建或可安装。

**项目、IPC 与桌面安全收口**

- Electron 默认 session 启动即应用离线 Chromium switches，并拦截 `http/https/ws/wss/ftp`；Renderer 继续使用固定 CSP，未来获授权的联网 Provider 不得放宽默认 session；
- 源码 smoke 的项目、临时目录、用户数据、缓存与崩溃目录全部收敛到 `out/source-smoke/`，并拒绝项目外 Electron 或输出路径；
- PDF 样张迁入非持久、无缓存隔离 session，禁用 JavaScript、导航、新窗口与网络；加载的 HTML 在打印前复核文件身份，PDF 经项目/`exports` 父链身份验证后同目录暂存、`fsync` 并原子换入；
- Python 项目打开增加完整 schema、固定子目录、清单控制路径、source/working 独立性、链接/联接/硬链接与哈希校验；所有变更型 CLI 命令统一使用非阻塞跨进程内核写锁，争用返回结构化 `PROJECT_WRITE_LOCKED`；
- `create` 锁前只读预检且失败零污染；锁内只打开一次用户输入，以同一文件描述符复制到 `source`，再由受控 `source` 生成 `working`。允许最终目标为常规文件的只读 OneDrive/reparse/symlink 输入，复制期间变化或失败时只清理本事务创建内容，并保留已有空目录或恢复旧协议锁字节；
- 自选导出目录逐级拒绝链接/联接，项目内自选目录只允许位于 `exports/`；全部目标在首个字节前预检，硬链接目标 fail-closed，每个输出文件以同目录暂存和原子换入；
- Electron 桥明确区分退出码 1 的有效业务结果与退出码 2 的运行错误，并保留 Python 结构化错误的 `code/message/retryable/details`；
- CPython 探针改为核对 implementation、完整三段版本、releaselevel 和 serial；Ace full lock 同时固定 manifest 原始字节身份，语义等价的字节漂移也拒绝。

**验证与发布边界**

- 原生/沙箱外 `npm test` 统一入口 PASS：Node TAP 共 99 项，96 通过、0 失败、3 项 Windows symlink/junction 权限条件跳过；Python 默认共 270 项，0 失败、0 错误、3 项条件跳过；
- 沙箱外隐藏 Chrome 的 `OAK_TEST_ACE=1`：270 项、0 失败、0 错误、1 项条件跳过、36.112 秒；受限沙箱内 Chrome 超时按设计 fail-closed，不作为工具通过或代码失败；
- 沙箱外隐藏 Electron 源码 smoke：`SMOKE-RESULT: PASS`；输出严格位于 `out/source-smoke/projects/`，DOCX/EPUB 完成检查、集中预览、批量修复、恢复和再次修复，两个项目均保持 `source_hash_ok=true`；PDF 为 258,394 / 161,830 字节；
- Windows alpha 资源门禁实际执行运行时探针并通过；sale 门禁按设计以 18 项 blocker 失败，覆盖许可证/来源审计、运行与应用资源可信根、Electron/builder 输入、Ace helper/browser/OS 网络隔离和 Windows 签名；
- 经批准的提升权限 `build:win` 完成本地 JRE/Ace staging 和 Windows alpha 资源探针后，仅在缺少 `tools/electron-builder/win32-x64` 处停止；没有联网，也没有生成 alpha.2 NSIS 或 ZIP；打包版 smoke、干净系统验证和签名尚未运行；
- macOS 跨主机静态门禁可执行但按预期 FAIL：缺 darwin-x64/arm64 Electron dist、两架构 Python runtime 锁和两架构 JRE；不能据此声称 macOS 可构建或已发行；
- 本条只记录源码、资源和门禁进展；旧 0.0.1 分发物不是 alpha.2 产物，可售卖正式版仍未达到。

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
