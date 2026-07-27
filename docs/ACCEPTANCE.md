# ACCEPTANCE — 验收标准

> 当前依据：商业正式版方案 v2.0；下方 M1—M3 与旧阶段 2/3 条目保留为历史基线。勾选必须以真实运行证据为准（命令 + 输出记录在 TEST_REPORT.md），不得凭实现意图勾选。

## 0.1.0-alpha.1 P0 可信批量修复验收（2026-07-26）

> 证据：`npm test`、Ace 启用全套 Python、`npm run smoke` 和故障注入测试；详见 `TEST_REPORT.md`。

- [x] `plan-fixes` 严格只读，计划 ID 绑定项目、working 哈希、完整问题状态和规则包；
- [x] 一个界面集中显示本批全部修改前/修改后预览，取消或 Esc 不产生任何修复写入；
- [x] CLI / IPC 不允许缺少 `plan_id` 的直接批量修复；过期、异项目或不完整确认集合均拒绝；
- [x] 每个离散 TAB 修改独立显示；其它 fixer 已审计为逐命中片段、逐资源或明确的连续组；
- [x] 任一同类自动修复问题被拒绝时，整类全文 fixer 不进入计划，不修改未确认位置；
- [x] 正常异常模型下批量提交不留下部分 working / issues / project 写入；已有 5 个检查点时失败可恢复被裁剪目录；
- [x] 检查点保存完整状态和检查结果哈希，可列表、撤销和恢复；恢复前安全点使恢复操作本身可撤销；
- [x] 恢复换入或最终保存失败时完整项目树不变；损坏/越界/重复检查点在核心拒绝且 UI 禁用；
- [x] Electron preload 在 `sandbox: true` 下真实加载；Renderer 无直接 fix 通道；
- [x] Node 12 项、Python 210 项、Ace 启用套件和 DOCX/EPUB 真实 UI 冒烟全部通过；
- [ ] 0.1.x Windows 安装包/便携包已重新构建并在打包版通过同一 smoke；
- [ ] 进程被强杀或断电后的持久化事务恢复已实现并验证。

## M1 验收（阶段 1 第一里程碑：DOCX + 论文 + GB/T 7714—2025 命令行闭环）

> 验收日期：2026-07-11。证据：统一测试 103 项全通过（含 CLI 子进程端到端闭环）；
> `out/demo-project` 实跑闭环 + Word COM 打开修订稿验证。详见 TEST_REPORT.md。

- [x] 用匿名 DOCX 样本，不借助桌面 UI，完整走通：创建项目 → 检查 → 白名单修复 → 复检 → 导出修订稿与报告 → 项目完整性验证（tests/test_cli.py + 实跑）；
- [x] 原稿 SHA-256 在全部操作前后不变（verify 命令证明，退出码 0）；
- [x] 修复前自动创建检查点；最多 5 个检查点，超出清理最旧（tests/test_project.py）；
- [x] 连续两次修复结果一致（幂等，字节级验证，tests/test_fixes.py）；
- [x] 每条问题包含严重程度、解释、位置、标准引用与修复能力标记（tests/test_engine.py）;
- [x] 只有白名单规则被自动修复（4 条白名单；非白名单 fix_id 一律拒绝）；
- [x] 「默认」引用体例按映射表确定性选定，实际体例与映射版本写入 project.json 与报告；
- [x] 报告（JSON / Markdown / HTML）均生成，含规则包版本、检查时间与隐私声明；
- [x] 修订稿 DOCX 可由 Word 正常打开，仅白名单修复项发生变化（Word COM 实测：段落 26→25，双空格/重复标点清零，脚注完好）；
- [x] 导出文件只写入项目目录或用户指定目录（ensure_within 防逃逸）；
- [x] 路径逃逸、ZIP 穿越、解压上限的防护测试通过（tests/test_docx_reader.py）；
- [x] 损坏 / 不支持文件给出可理解错误且不损伤已有项目；
- [x] 统一测试入口 `python scripts/run_tests.py` 一条命令全部通过（103 项）。

## M2 验收（阶段 1 第二里程碑：纸质出版物 + APA 7 / Chicago 18 + Markdown、TXT 输入）

> 验收日期：2026-07-11。证据：统一测试 135 项全通过；`out/demo-m2-book`（print_book DOCX）
> 与 `out/demo-m2-md`（APA Markdown）CLI 实跑闭环，退出码与触发集符合预期。

- [x] Markdown 输入：ATX 标题解析、空行分段、围栏代码块不误判结构（tests/test_text_readers.py）；
- [x] TXT 输入：空行分段、BOM 与 CRLF 容错；无 txt 专属规则时检查空跑不报错；
- [x] 纸质出版物配置独立运行：print_book × DOCX 走完整检查（默认体例 → chicago-18-nb）；
- [x] M2 六条规则全部实现并逐条测试（含反例）：BOOK-STRUCT-001 / 002、BOOK-PAGE-001（≥3 聚合阈值）、MD-STRUCT-001、REF-APA-001（括注→条目单向核对）、REF-CHI-001（注释↔书目存在性一致）；
- [x] 书稿绿色基线（book_good.docx）0 误报；缺陷样本触发集精确等于预期（tests/test_engine_m2.py）；
- [x] APA 体例经「默认」映射选定（paper × en → apa-7）并写入报告；
- [x] md 项目全流程（create → check → export → verify）经 ops 层与 CLI 实跑验证；
- [x] .epub 输入仍明确提示 M3 支持，不误报支持；
- [x] 引擎「未启用检查」如实缩减为仅 M3；
- [x] 统一测试入口一条命令全部通过（135 项）。

## M3 验收（阶段 1 第三里程碑：EPUB 输入与电子书配置 + 基础 EPUB 导出）

> 验收日期：2026-07-11。证据：统一测试 175 项全通过；`out/demo-m3-epub` CLI 实跑
> EPUB 闭环（check 1 → fix → recheck 1 → export → verify 0）；`out/demo-m3-preview`
> 从 DOCX 项目导出 preview.epub 并经自身检查核心自检零问题。
> **至此阶段 1（M1+M2+M3）全部完成**：四种输入格式、三类检查配置、35 条规则全部落地。

- [x] EPUB 读取器：mimetype 三要件校验、container→OPF、必需元数据、nav 声明、内容文档 lang / img / 链接锚点解析；复用 ZIP 安全防护；
- [x] M3 六条规则全部实现并逐条测试（含反例）：EPUB-MIME-001 / OPF-001 / NAV-001 / LANG-001 / IMG-001（alt="" 视为有意留空不报）/ LINK-001（断文件与断锚点，外链不查）；
- [x] 白名单按纪律扩两条（共 6 条封顶）：FIX-EPUB-MIME-001（重建首位不压缩）、FIX-EPUB-LANG-001（按 OPF dc:language 补齐；**语言未知不擅自补写**——反例测试）；均幂等（字节级）；
- [x] EPUB 绿色基线 0 误报；缺陷样本恰好触发全部 6 条规则；修复后复检 MIME/LANG 消失、OPF/NAV/IMG/LINK 保留；
- [x] 基础 EPUB 导出（--epub-preview）：mimetype 首位不压缩、元数据齐全、nav 一级标题目录、标题锚点——**用本核心自检零问题**；
- [x] 外部工具 EpubCheck / Ace 如实标注「未运行」，报告绝不出现「通过」字样（自动化断言）；
- [x] 「未启用检查」列表随三个里程碑全部实现而清空（如实报告机制保留）；
- [x] 统一测试入口一条命令全部通过（175 项）。

## 阶段 2 验收（桌面 APP MVP，2026-07-11）

> 完成标准（方案 §18）：匿名 DOCX 与 EPUB 均能在 UI 中完成完整闭环。
> 证据：`npm run smoke` 冒烟驱动真实 UI 代码路径（与按钮同一 actions + 真实 IPC + 真实核心），
> DOCX 与 EPUB 双闭环 PASS；打包版同样 PASS。

- [x] Electron 壳安全基线：contextIsolation / sandbox / nodeIntegration=false / IPC 固定通道 + 输入验证 / 子进程 shell=false / CSP / 导航与新窗口拦截 / 外链仅 HTTPS 白名单域名；
- [x] 七个主页面（中文 UI）：欢迎隐私 / 创建项目 / 检查目标 / 进度（阶段式，无虚假百分比）/ 问题双栏（接受·拒绝·暂不处理）/ 导出中心 / 标准资源与设置；
- [x] 登录入口占位「即将开放」；未登录不出现任何同步询问（冒烟自动断言）；
- [x] 出版评估软转化位按 §8.1–8.2 位置与文案，仅打开白名单网站页面；
- [x] PDF 审阅样张（printToPDF，≤16 页，标注非印前文件）；
- [x] 匿名样本体验入口；错误以可理解文案呈现（toast + 文件安全说明）。

## 阶段 3 验收（打包与内测准备，2026-07-11，部分完成）

- [x] Windows 便携 ZIP（electron-builder）：捆绑 Python 3.13.14 嵌入式运行时 + 核心 + 规则包 + 样本 + EpubCheck，**解压即用，无需安装任何依赖**；
- [x] 打包版首启验证：便携包在本机以 `--smoke` 完成 DOCX + EPUB 双闭环；
- [x] 应用图标、版本信息、SHA-256 校验值（release/SHA256SUMS.txt + RELEASE_NOTES）；
- [x] 外部验证真实接入：EpubCheck 5.3.0（好样本真实通过 / 缺陷样本真实失败 / **基础 EPUB 导出产物真实通过**）；Ace 1.4.6（本机 Chrome 驱动，真实运行并如实报告）；
- [x] 依赖安全审计基线：npm audit 记录（见 TEST_REPORT）；
- [ ] macOS `.app` / DMG（本机为 Windows，无法构建——待 macOS 环境）；
- [ ] Windows 安装器与代码签名、macOS 公证（待证书与账号）；
- [ ] 5—10 位作者受控内测（人工环节，待用户组织）。

## 基础版全量验收（方案 §21）

- [x] Windows 能安装或解压启动，并完成匿名 DOCX 主流程（打包版冒烟）
- [ ] macOS 能生成可运行包，并在实机完成同一流程（无 macOS 环境）
- [x] DOCX、EPUB、Markdown、TXT 均可导入
- [x] 不支持或损坏文件显示可理解错误
- [x] 原稿在全部操作前后 SHA-256 不变
- [x] 论文、纸质出版物、电子书配置可独立运行
- [x] 四种引用格式可选择，且不会伪造引用内容
- [x] 每条问题包含严重程度、解释、位置、标准和修复能力
- [x] 只有白名单机械问题可自动修复（6 条封顶）
- [x] 修复可撤销（检查点）、可复检且幂等
- [x] 导出修订稿、EPUB、三种报告和 PDF 样张
- [x] 脱敏摘要不含正文、标题、文件名、路径和参考文献原文（字段白名单 + 泄露断言测试）
- [x] 未运行外部验证时不得宣称通过（自动化断言；真实运行后如实报 passed/failed）
- [x] 出版评估入口只出现在结果相关位置
- [x] 核心离线可运行，默认不上传稿件
- [x] 授权到期或网站故障不会锁住本地文件（LicenseProvider 本地免费，无锁定逻辑）
- [x] 引用体例「默认」选项按映射表确定性选定，并在报告中说明
- [x] 未登录状态下全部核心流程可完成，且不出现同步询问（冒烟断言）
- [ ] 任何结果同步只在登录用户逐字段确认后发生；负载不含稿件、正文/预览、标题、文件名、路径、参考文献原文或哈希（真实同步上线时验收；当前占位不联网）
- [ ] 网站后台可查看并删除已同步记录（阶段 4 验收）
- [x] Python 单元/集成 + CLI 端到端 + UI 冒烟 E2E 全部通过（Node 侧以冒烟 E2E 覆盖）
- [x] 发布包有版本、说明、校验值和已知限制（docs/RELEASE_NOTES_0.0.1.md）
