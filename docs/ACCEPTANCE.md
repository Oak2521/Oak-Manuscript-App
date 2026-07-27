# ACCEPTANCE — 验收标准

> 当前依据：商业正式版方案 v2.0；下方 M1—M3 与旧阶段 2/3 条目保留为历史基线。勾选必须以真实运行证据为准（命令 + 输出记录在 TEST_REPORT.md），不得凭实现意图勾选。

## 0.1.0-alpha.3 标准可信链与项目升级验收（2026-07-27）

> 本节验收 alpha.3 源码、标准身份链与项目升级，不代表安装包或可售卖正式版。证据以 `TEST_REPORT.md` 为准。

- [x] APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.3`；规则包仍为独立版本 `oak-rules 1.0.0`、release sequence 1；
- [x] standards schema 2.0 含 13 项标准，能力清单与规则包 35 条规则、6 个 fixer 精确一致；重复/缺失/多余 rule ID 或 fixer 漂移均拒绝；
- [x] canonical manifest 固定 bundle、版本、发布序列、APP 兼容范围、文件大小/哈希和 capability digest；manifest 与规则包 SHA-256 分别为 `d33534f…d7af` / `7ac5a5bd…9542`；
- [x] payload 对重复键、深度/大小、Unicode 控制字符/非配对 surrogate、日期、canonical HTTPS URL、路径与字段集合严格校验；恶意或模糊输入 fail-closed；
- [x] 非内置包须满足 Ed25519 门槛签名；磁盘 trust store 原始字节摘要必须由代码固定。当前没有生产 trust pin，真实本地签名包导入按设计禁用；
- [x] 内容寻址存储、active/previous、高水位、bundle/version/sequence 唯一性、撤回/过期/APP 兼容性和 manifest/payload 身份均在每次使用前重验；
- [x] 非初始 release 必须签署精确 `rollback_target`；安装、激活和回滚不能绕过目标 digest/sequence/CAS/撤回校验；
- [x] 同一标准根操作串行化；跨进程事务使用原子 pending 目录、PID 与随机进程 token。活 owner 返回 busy，死 owner 只按严格 intent 恢复，未知变更拒绝猜测；
- [x] 内置 release 离线启动、本地包预览/安装骨架和全局回滚通过测试；标准包联网检查、下载及生产撤回通道尚未实现，不计作通过；
- [x] 新项目绑定当前已验证 release；已有项目固定七字段身份 `name/version/pinned/sha256/bundle_id/release_sequence/manifest_sha256`，全局 active 改变不静默换项目规则；
- [x] 新项目直接绑定已验证 active release；已有项目只允许一次未绑定、只读的 `project-standard-status` 预检来发现 pin，预检前先验证全局存储，预检后精确验证项目 CAS；所有实际业务/变更命令通过 canonical `OAK_EXPECTED_STANDARD_IDENTITY` 绑定，Python 拒绝缺字段、多字段、摘要、序列或 bundle 漂移；
- [x] `project-standard-status`、`plan-rulepack-upgrade` 和 `upgrade-rulepack` 已实现；计划严格只读并绑定项目 manifest、状态、source/working、issues、最新检查与目标身份；
- [x] Renderer 只能请求主进程选择的当前 active 目标，集中显示完整差异并一次确认；取消不写入，旧计划、异项目计划或状态变化均拒绝；
- [x] 升级创建检查点、哈希归档旧 issues、原子提交新 pin、清空陈旧 live issues、记录连续 history，并设置 `rulepack_check_required=true`；升级成功后 UI 自动重检；
- [x] 升级/降级故障注入、写锁争用、进程中断安全状态、历史 release、撤回/过期迁移源和升级后陈旧报告/修复/导出拒绝均有回归覆盖；
- [x] `app:info`、项目、检查记录与导出 `report.json` 的完整七字段身份一致；源码 smoke 每次使用 `out/source-smoke/runs/<run-id>/` 独立状态；
- [x] 最新默认回归为 Node **186/181/0/5**、Python **312/0/0/3**；真实 Ace 条件套件为 **312/0/0/1**；隐藏 Electron smoke 为 PASS；
- [x] Windows alpha 资源门禁继续通过；sale 门禁仍以 18 项 blocker 按设计失败；macOS 静态门禁仍因两架构资源缺失按设计失败；
- [ ] alpha.3 Windows NSIS / ZIP 已生成并通过 packaged smoke（当前缺本地 builder 工具，未生成）；
- [ ] 生产标准 trust pin、在线获取/下载、签名撤回分发及外部官方来源核验已完成；
- [ ] macOS、Web、统一账号、订阅、结果同步与正式售卖全量门禁通过。

## 0.1.0-alpha.2 Windows alpha 资源与发布门禁验收（2026-07-27，历史检查点）

> 本节验收的是源码检查点与 Windows alpha 资源，不是安装包、ZIP 或可售卖正式版。最终命令结果以 `TEST_REPORT.md` 为准。

- [x] 该检查点的 APP、Python 核心和 lockfile 版本统一为 `0.1.0-alpha.2`；源码/打包 smoke 契约会通过 `app:info` 和真实项目/报告核对实际版本；
- [x] 该检查点默认分项回归为 Node TAP **99 项：96 通过、0 失败、3 条件跳过**；Python **270 项：0 失败、0 错误、3 条件跳过**；
- [x] 该检查点的真实 Ace 条件套件和隐藏 Electron 源码 smoke 已复跑：沙箱外隐藏 Chrome 为 270 项、0 失败、0 错误、1 条件跳过；隐藏 Electron 为 `SMOKE-RESULT: PASS`，两个项目均保持 `source_hash_ok=true`；
- [x] Electron 默认 session 启动即应用离线 switches 并阻断网络 scheme；Renderer 固定 CSP 不放宽，源码 smoke 所有状态路径限定在 `out/source-smoke/`；
- [x] PDF 样张使用非持久、无缓存隔离 session，禁 JavaScript/导航/网络，并在 HTML 身份复核后通过项目/`exports` 路径身份校验和同目录原子写生成；
- [x] `Project.open()` 完整验证项目 schema、固定目录和全部清单控制路径，拒绝链接/联接/reparse、硬链接、逃逸、source/working 同一文件与原稿大小/哈希失配；
- [x] 全部变更型 CLI 命令使用单项目非阻塞跨进程内核写锁；争用返回结构化、可重试的 `PROJECT_WRITE_LOCKED`，崩溃后由内核释放，不同项目不互阻；
- [x] `create` 锁前纯预检失败零污染；锁内只打开一次输入，以同一 FD 生成 `source` 再由 `source` 生成 `working`，允许最终对象为常规文件的只读 OneDrive/reparse 输入；复制变化或故障精确清理并保留已有空目标/恢复旧协议锁字节；
- [x] 自选 `out_dir` 逐级验证，项目内只允许 `exports/`；全部目标在首个字节前预检，链接/硬链接目标拒绝，每个文件同目录暂存、`fsync`、原子换入；
- [x] Electron 桥区分退出码 1 的有效业务结果与退出码 2 错误，并保留结构化错误 `code/message/retryable/details`；
- [x] CPython 3.13.14、EpubCheck 5.3.0、Temurin JRE 21.0.11+10 和 Ace 1.4.6 均由受版本控制的全量锁覆盖；多文件、少文件、篡改和链接均 fail-closed；
- [x] Python 运行时锁按 `platform/arch` 选择，Windows `python313._pth` 只启用标准库 ZIP、当前目录与受控核心路径，不导入 `site`；
- [x] JRE 仓库锁按 `platform/arch` 选择，同时固定源 JDK 树、构建工具哈希、EpubCheck 分发清单哈希和生成 JRE manifest；
- [x] Ace 仓库锁固定 stage manifest 原始字节哈希、236 包闭包、补丁及全部文件；Node 门禁和 Python 实际运行路径都拒绝缺锁、自修改锁、语义等价的字节漂移或 stage/lock 不一致；
- [x] JRE 与 Ace 的 stage/lock 更新采用事务提交；目录或锁换入失败时恢复旧目录和旧锁；普通 staging 不能静默更新锁；
- [x] 哈希清单和锁统一按 locale-independent UTF-16 code unit 排序，同一输入不因 OS、ICU 或用户 locale 改变字节；
- [x] 空 `package.json license`、`UNKNOWN` 声明和空许可证文件均被拒绝；有原始许可证文件不等于正式审计完成，Ace 全部 236 包仍保留逐包人工审计阻断；
- [x] Electron 桥和资源探针共用 `-I -S -X utf8` 固定 bootstrap，显式把受控 core 绝对目录插入 `sys.path[0]`，不依赖工作目录或用户 site/PYTHONPATH；CPython 探针核对 implementation、三段版本、releaselevel 与 serial；
- [x] 资源门禁先完成全部非执行静态检查；只有全局静态错误为零才执行 Python 和 JRE 探针，静态失败时测试证明不会启动运行时；
- [x] 运行探针要求 host platform/arch 与 target 完全一致；非原生 runner fail-closed，纯静态验证必须显式 `--no-runtime-probe`；
- [x] JRE/EpubCheck 探针矩阵真实验证：`epub_good.epub` 退出 0 且零 fatal/error，`epub_needs_review.epub` 退出 1 且检出 error；
- [x] Ace 受控 runner 在 JavaScript 禁用状态下清洗作者 XHTML，再限制到 EPUB `basedir` 内 `file:` 与必要本地协议；危险 DOM、处理指令、事件属性、URL、协议和路径逃逸测试通过；
- [x] 固定 EpubCheck 组合真实运行：好 EPUB 报告 `passed`，缺陷 EPUB 报告 `failed`；Ace 解析与异常契约由默认回归覆盖，工具异常、报告非法或退出码不符合契约时标为 `not_run`；最新 Ace 真实好/坏样本执行仍受上方待办约束；
- [x] Windows **alpha** 源码资源门禁通过，并如实返回未清零的正式发布阻断项；
- [x] **sale** 门禁会把许可证/来源审计、可信根、helper、浏览器运行时和签名阻断项提升为错误，不允许误发正式版；
- [x] 打包 smoke 包装器会校验固定 EXE、Windows x64 PE32+、唯一 PASS 标志和仓库内输出目录；UI 闭环同时核对 `appVersion`、`app.isPackaged`，并从真实 `project.json`/检查报告证明 Python core 版本及规则包身份一致；
- [x] macOS 构建入口按当前原生 host 拆分为 x64/arm64 runner；跨架构聚合只允许显式纯静态检查，不计入运行探针或构建证据；
- [ ] alpha.2 Windows NSIS / ZIP 已生成并通过打包后资源门禁与打包 smoke（当前 `release/` 没有 alpha.2 制品）；
- [ ] macOS x64/arm64 Python/JRE 资源及锁、DMG 构建、签名、公证、Gatekeeper 和实机 smoke 已完成；
- [ ] 正式售卖 `sale` 门禁已通过。

当前 Windows sale 门禁的 18 类机器码为：

1. `FORMAL_LICENSE_AUDIT_REQUIRED`；
2. `PYTHON_RUNTIME_PROVENANCE_AUDIT_REQUIRED`；
3. `EPUBCHECK_PROVENANCE_AUDIT_REQUIRED`；
4. `JRE_SOURCE_PROVENANCE_AUDIT_REQUIRED`；
5. `EPUBCHECK_TRUST_ROOT_NOT_HARDENED`；
6. `JRE_TRUST_ROOT_NOT_HARDENED`；
7. `PYTHON_RUNTIME_TRUST_ROOT_NOT_HARDENED`；
8. `APP_RESOURCES_TRUST_ROOT_NOT_HARDENED`；
9. `ELECTRON_RUNTIME_PROVENANCE_AUDIT_REQUIRED`；
10. `ELECTRON_RUNTIME_TRUST_ROOT_NOT_HARDENED`；
11. `BUILDER_TOOLCHAIN_PROVENANCE_AUDIT_REQUIRED`；
12. `BUILDER_TOOLCHAIN_TRUST_ROOT_NOT_HARDENED`；
13. `ACE_FULL_LICENSE_AUDIT_REQUIRED`；
14. `ACE_TRUST_ROOT_NOT_HARDENED`；
15. `ACE_CONTROLLED_HELPER_PENDING`；
16. `ACE_BROWSER_RUNTIME_PENDING`；
17. `ACE_OS_NETWORK_ISOLATION_PENDING`；
18. `WINDOWS_CODE_SIGNING_PENDING`。

正式发布前必须以当次 sale 门禁实际输出复核，不能把本清单当作永久豁免列表。`FORMAL_LICENSE_AUDIT_REQUIRED` 记录缺少上游原始许可证文件而使用元数据通知的包；`ACE_FULL_LICENSE_AUDIT_REQUIRED` 独立要求对全部 236 包逐一核对来源、许可证文本、版权声明和再分发义务。

## 0.1.0-alpha.1 P0 可信批量修复验收（2026-07-26，历史检查点）

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
- [ ] 当前 0.1.x Windows 安装包/便携包已重新构建并在打包版通过同一 smoke；
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

## 阶段 2 验收（桌面 APP MVP，2026-07-11，0.0.1 历史基线）

> 完成标准（方案 §18）：匿名 DOCX 与 EPUB 均能在 UI 中完成完整闭环。
> 证据：`npm run smoke` 冒烟驱动真实 UI 代码路径（与按钮同一 actions + 真实 IPC + 真实核心），
> DOCX 与 EPUB 双闭环 PASS；旧 `0.0.1` 打包版历史结果同样 PASS，不能替代当前 alpha.3 打包验收。

- [x] Electron 壳安全基线：contextIsolation / sandbox / nodeIntegration=false / IPC 固定通道 + 输入验证 / 子进程 shell=false / CSP / 导航与新窗口拦截 / 外链仅 HTTPS 白名单域名；
- [x] 七个主页面（中文 UI）：欢迎隐私 / 创建项目 / 检查目标 / 进度（阶段式，无虚假百分比）/ 问题双栏（接受·拒绝·暂不处理）/ 导出中心 / 标准资源与设置；
- [x] 登录入口占位「即将开放」；未登录不出现任何同步询问（冒烟自动断言）；
- [x] 出版评估软转化位按 §8.1–8.2 位置与文案，仅打开白名单网站页面；
- [x] PDF 审阅样张（printToPDF，≤16 页，标注非印前文件）；
- [x] 匿名样本体验入口；错误以可理解文案呈现（toast + 文件安全说明）。

## 阶段 3 验收（打包与内测准备，2026-07-11，0.0.1 历史基线）

- [x] `0.0.1` Windows 便携 ZIP（electron-builder）：捆绑 Python 3.13.14 嵌入式运行时 + 核心 + 规则包 + 样本 + EpubCheck，历史上完成解压运行；
- [x] `0.0.1` 打包版首启验证：便携包在本机以 `--smoke` 完成 DOCX + EPUB 双闭环；
- [x] `0.0.1` 应用图标、版本信息、SHA-256 校验值（历史 RELEASE_NOTES）；
- [x] 外部验证真实接入：EpubCheck 5.3.0（好样本真实通过 / 缺陷样本真实失败 / **基础 EPUB 导出产物真实通过**）；Ace 1.4.6（本机 Chrome 驱动，真实运行并如实报告）；
- [x] 依赖安全审计基线：npm audit 记录（见 TEST_REPORT）；
- [ ] macOS `.app` / DMG（本机为 Windows，无法构建——待 macOS 环境）；
- [ ] Windows 安装器与代码签名、macOS 公证（待证书与账号）；
- [ ] 5—10 位作者受控内测（人工环节，待用户组织）。

## 商业正式版全量验收（方案 §21，按当前 0.1.x 开发线）

- [ ] 当前 0.1.x Windows 能安装或解压启动，并完成匿名 DOCX 主流程（旧 0.0.1 历史结果不替代本项）
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
- [ ] 正式发布包候选的 Python 单元/集成 + CLI 端到端 + UI 冒烟 E2E 全部通过（alpha.3 源码基线、真实 Ace 与隐藏源码 smoke 已通过；因尚无 alpha.3 安装包或 ZIP，打包版 E2E 仍未运行）
- [ ] 当前正式发布包有版本、说明、校验值和已知限制（`RELEASE_NOTES_0.0.1.md` 仅是历史资料）
