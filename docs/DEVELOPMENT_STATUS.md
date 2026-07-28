# DEVELOPMENT_STATUS — 开发状态（唯一状态来源）

> 最近更新：2026-07-28。最新在上；“已完成”必须有本地测试或构建证据。

## 当前版本与基线

- 当前版本：`0.1.0-alpha.8`
- 当前分支：`chatgpt/commercial-v1`
- 源码检查点标签：`chatgpt-v0.1.0-alpha.8`，只标记源码与本地验证状态；尚无同版本安装包或 ZIP
- 商业版权威方案：`docs/湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md`
- 只读 Claude 基线：0.0.1，提交 `16736147ed734a3be3535d43152719cf4b97a07e`，标签 `claude-0.0.1-baseline`
- 当前内置标准为 `oak-standards 2.0.0` / `oak-rules 2.0.0`（release sequence 2）：35 条规则、6 个白名单机械 fixer；alpha.5 新增默认引用解析政策，alpha.6—alpha.8 未改变标准内容或自动修复白名单。

## 商业正式版路线状态

| 工作流 | 状态 | 现场事实 |
|---|---|---|
| P0：集中预览与一次批量确认 | **完成（代码与测试）** | `plan-fixes` 只读；`fix` 强制 `plan_id`；全部离散修改可见；取消零写入 |
| P0：事务批量修复 | **完成（正常异常模型）** | working / issues / project 失败回滚；已有 5 个检查点时恢复被裁剪目录 |
| P0：检查点列表、撤销与恢复 | **完成（代码与测试）** | 完整状态快照；恢复前安全点；损坏项 UI 禁用；恢复失败项目树不变 |
| P0：默认引用体例与确认 | **完成（代码、迁移与 UI）** | 本地结构信号解析；证据不足退回 `structure_only`；`plan-citation` 只读并要求 `citation_plan_id` 确认；项目/报告记录原因、置信度与解析器版本 |
| P0：Node + Python 统一测试 | **完成（最新统一回归通过）** | alpha.8 最终计数见下方“最新测试基线”；0 失败 |
| P0：真实桌面 UI 冒烟 | **完成（alpha.8 PASS）** | 独立隐藏 Electron 完成 DOCX + EPUB 全闭环并断言未登录/Free/空同步队列；两项目均 4 次检查、1 次批量修复、3 个检查点且原稿哈希不变 |
| P0：文档与测试基线纠错 | **完成** | 权威改为 v2.0；纠正“185 + Ace = 186”错误 |
| Windows alpha 运行资源 | **完成（源码资源门禁）** | Python/JRE/EpubCheck/Ace 均有全量哈希/锁；Python 与 EpubCheck 双向探针实际执行并通过 |
| Ace 正式发布条件 | **部分完成** | tracked full lock、生产闭包、隔离替换、空许可证拒绝和真实好/坏样本已验证；全闭包人工审计、受控 helper、自带浏览器、OS 网络隔离与可信根未完成 |
| Windows NSIS / ZIP | **未完成** | 受控下载器与安全导入器已实现；本轮未联网，真实三归档、工具树与独立 tracked lock 缺失，未生成产物 |
| Windows 发布制品证据 | **生成/验证契约完成，真实证据待制品** | 固定当前版本 NSIS/ZIP，生成交叉绑定 SHA256SUMS + canonical manifest；构建开头清旧证据、packaged smoke 后才生成；真实空 release 按预期拒绝 |
| Windows sale 门禁 | **未通过（如实阻断）** | alpha 资源门禁运行探针通过；Electron 全树锁关闭 1 项，sale 门禁仍有 17 项 blocker，签名和正式审计未完成 |
| macOS arm64/x64 安装版 | **基础设施完成，发行未完成** | 已拆原生 x64/arm64 runner；静态聚合不执行探针；缺 Electron/Python/JRE、`.app`/DMG、签名、公证和真实硬件证据 |
| 标准包本地验证、升级与回滚 | **完成（代码与测试）** | 内置 2.0.0；canonical manifest、签名/CAS/高水位/回滚、项目七字段 pin、差异确认、升级后强制重检均已实现；旧 release 缺失时 fail-closed；生产 trust pin 与联网传输未实现 |
| 标准与规则补全 | **治理结构完成，内容补全未完成** | 13 标准/35 规则/6 fixer 映射一致；外部来源核验 0 项，4 项仍 under_review，真实审校签核与多类标准深度不足 |
| 湖岸统一账号 / Free+Pro / 结果同步 | **离线契约完成，生产联调未开始** | PKCE 状态、Free/Pro/宽限、SyncRecord v1/JSON Schema、逐字段四选一预览和当前进程幂等队列已实现；无生产 Supabase、凭据、支付、持久队列、transport 或网站后台 |
| Web 服务端统一处理 | **未开始编码** | 作业 API、隔离、TTL 删除、限额和网站嵌入均待实现 |
| 可售卖正式版发布 | **未达到** | 缺跨端产物、生产账号/支付、条款、签名、公证、内测和网站联调 |

## 最新测试基线

- 最终统一 `npm test`：**PASS，退出码 0，墙钟 93.7 秒**；Node 278/271/0/7（2.389 秒），Python 348/0 failures/0 errors/3 skipped（86.468 秒）。跳过项不计作通过。
- 账号/同步专项：Auth 状态机、Free/Pro 与离线宽限、SyncRecord 白名单/禁止字段、JSON Schema、登录/明确确认门禁、幂等/取消/重试/删除、可信核心来源、IPC/preload 和 UI 结构均通过；未使用网络或生产服务。
- 发布证据专项：**6 项，5 通过、0 失败、1 条件跳过**；覆盖确定性输出、交叉摘要、坏格式/旧制品/版本漂移、链接/硬链接、篡改、联合提交回滚和安全清除预检。
- downloader 专项：**11/11 通过**；覆盖显式联网授权、固定来源、重定向/容量/哈希门禁、零授权零写入、事务落盘/回滚及路径安全。
- Electron runtime 锁专项：**37 项、36 通过、0 失败、1 条件跳过**；hardlink 与 junction 反向路径本机实测通过，文件 symlink 因 Windows `EPERM` 条件跳过，不计作通过。
- 最新真实 Ace 隐藏 Chrome 证据仍来自 alpha.4：**312 项，0 失败、0 错误、1 项条件跳过，44.807 秒**。alpha.8 本轮未重跑 `OAK_TEST_ACE=1` 条件套件，不将旧结果冒充为当前运行。
- `npm run verify:standards`：**PASS**；2.0.0 manifest SHA-256 `0aff75eb181a62869147e9af27330c717bc808bdd23865197534fc9868568427`，规则包 SHA-256 `098b382e33c06ccddf154940fbbd51db384d8025cf235ed7f7e10e83d34897a4`，能力集 SHA-256 `af67d0aaf2ece431ec1b617934bdfa3627b6be1b1301a92fcf3b2b2f29ca232e`。
- `npm run verify:electron-runtime`：**PASS**；Electron 43.1.0 win32-x64 固定锁覆盖 2 个目录、75 个文件、364,083,658 字节，manifest SHA-256 为 `ae67132b95e21b62450fd0e34faaf00164514b38322076c56e37c0301c520d95`；tracked manifest 使用严格 JSON、exact schema 和 canonical UTF-8/LF 原始字节。
- 独立隐藏 Electron `npm run smoke`：**SMOKE-RESULT PASS**；最新输出为 `out/source-smoke/runs/ms48q9hr-05f6b99b193cf33d/projects/`，两个项目均为 `app_version=0.1.0-alpha.8`、`integrity.source_hash_ok=true`、4 次检查、1 次批量修复、3 个检查点；当前问题 13 / 5、报告 applied fixes 5 / 2，PDF 251,660 / 177,267 字节；未登录、Free 权益与空同步队列断言通过。沙箱内 GUI 子进程受限的失败不计作业务结果，最终证据来自获准的沙箱外隐藏运行。
- 当前测试环境：Windows 11，Python 3.14.6，Node 24.16.0，npm 11.13.0，Electron 43.1.0，Java 21.0.11。
- Windows alpha 资源门禁：**PASS**。
  - Python：34 个文件 / 21,260,753 字节；
  - JRE：207 个文件 / 52,384,264 字节；
  - EpubCheck：49 个文件 / 36,263,890 字节；
  - Ace：236 个包 / 6,672 个文件 / 58,964,235 字节。
- Windows sale 资源门禁：**按设计 FAIL**，17 项正式发布 blocker 尚未关闭；`ELECTRON_RUNTIME_TRUST_ROOT_NOT_HARDENED` 已由本次全树锁证据关闭，Electron provenance 与签名仍保留。
- `npm run release:evidence:verify:win` 在真实 `release/` 上按预期退出 1，明确缺 `Oak-Manuscript-0.1.0-alpha.8-Windows-x64.exe`；没有生成 SHA 或 manifest 冒充发布证据。
- 本轮未执行联网下载或 `build:win`；真实工具树和 tracked lock 仍缺失，构建包装器会在 electron-builder 启动前 fail-closed；没有 alpha.8 安装包或 ZIP。
- macOS：`verify:resources:mac:static` 可执行并按预期 FAIL，精确缺 darwin-x64/arm64 Electron dist、两架构 Python runtime 锁和两架构 JRE；未构建、未签名、未公证、未运行打包版 smoke。
- 详细证据与首次失败修复记录见 `docs/TEST_REPORT.md`。

## 本轮关键实现

- 新增 `AuthProvider` 本地状态机和生产 `system_browser_pkce` 固定边界；生产未配置时 fail-closed，不打开页面、不联网；
- 新增 Free/Pro 能力矩阵与 `validUntil`/`graceUntil` 离线宽限计算；模拟授权明确无签名证据，过期只降级新权益，不锁已有本地项目或导出；
- 新增 Python `sync-source`，Electron `buildSyncRecordV1` / exact validator、`config/schemas/sync-record-v1.schema.json` 和 `docs/SYNC_RECORD_V1.md`；正文、标题、文件名、路径、预览、哈希等无允许字段并有反向测试；
- 新增账号/同步 IPC 与 preload 固定通道，Renderer 不能提交任意记录；导出后仅对已登录用户逐字段预览并四选一确认；当前进程内队列支持幂等、取消、重试、删除，但没有生产 transport 或持久化；

- 新增 `release_artifact_manifest.js`：对精确当前版本 NSIS/ZIP 做稳定身份读取、PE/ZIP 结构门禁、大小与 SHA-256 计算，拒绝旧制品、链接/硬链接与版本漂移；联合事务生成/验证 `SHA256SUMS.txt` 和 canonical release manifest；
- `build:win` 开头先安全清除旧证据，只有 packaged 资源门禁和隐藏 smoke 成功后才运行发布证据生成器；新增显式 generate/verify/clear 命令；
- 新增 `download_windows_builder_archives.js`：必须显式 `--allow-network`，固定官方 URL/HTTPS 主机/文件名/SHA-256，输出限定仓库内；独占候选、容量/超时/重定向上限、全量验哈希后事务提交，错误旧文件与并发碰撞不覆盖；
- 新增 `npm run download:builder:win` 唯一便捷联网入口；普通 test/build/dist 保持离线，下载不会自动触发导入；
- 新增 `citation.py` 确定性解析器：仅记录结构计数、覆盖率、枚举与原因，不保存稿件片段；支持四种具体体例、`structure_only` 和用户禁用模式，具体体例只在当前格式/类型/语言确有启用规则能力时返回；
- 新增只读 `plan-citation`、确定性 `citation-plan-*` 和 `check --citation-plan-id`；Renderer 在检查前显示解析模式、体例、理由、置信度、证据统计与实际检查规则，取消不写入；
- 新增 `oak-standards 2.0.0` / `oak-rules 2.0.0`（sequence 2），标准存储可在 CAS 中同时保留和校验 1.0.0 历史 release；旧项目仅能从这个已验证历史身份迁移，缺失即 fail-closed；
- 项目、检查报告、导出报告和出版摘要均持久化结构化 `citation_resolution`；用户显式体例在规则包升级时保留，默认结果置空并在新包下重算；
- 切换输入稿件或项目目录时清空上一项目的 session 状态，消除连续处理多稿时复用旧项目的缺陷；

- Electron 43.1.0 win32-x64 由受版本控制的完整树锁固定；tracked manifest 严格拒绝重复键/未知字段并固定 canonical UTF-8/LF 字节；默认验证只读，`electronDist` 验证失败返回不存在 sentinel，禁止 builder 下载回退；packaged 资源门禁重验仓库源码构建输入而不信任可写包内自报；
- Electron manifest 的显式 `--update-lock` 先验证安全父链并拒绝目标 symlink/hardlink，再以独占候选文件、`fsync`、原子替换和换入后复验提交；失败恢复旧字节，回滚自身失败会明确报错并保留事务证据；
- Windows builder 导入器独立固定三份 legacy 归档名称/哈希与本地 7z 字节；解压前后做清单、路径、链接、大小及哈希门禁，拒绝 UNC/device 来源；工具树 manifest 与 tracked lock 双向绑定，只有显式 `--update-lock` 才能联合事务换入；
- builder verifier 对不安全祖先路径在任何读取前 fail-closed；旧工具树/lock 在 rename 前做完整预检；4 个前向和 4 个回滚 rename 失败均有故障注入，前向失败恢复旧资产，回滚自身失败保留恢复证据；
- 标准资产采用 schema 2.0 注册表、35 规则能力映射和 canonical release manifest；内置 release 的 manifest/规则包摘要分别固定为 `d33534f…d7af` / `7ac5a5bd…9542`；
- Electron `StandardsStore` 对严格 payload、Ed25519 门槛签名、内容寻址目录、高水位、撤回/过期/兼容范围、签署回滚目标、跨进程事务 owner token 与崩溃恢复做 fail-closed 验证；未知状态或 identity 撕裂不自动修复；
- `StandardsProvider` 支持离线内置启动、本地签名包预览/安装和全局回滚；当前没有代码固定的生产 trust digest，所以真实本地签名包导入默认禁用；没有标准包联网检查或下载；
- 项目规则包 pin 扩为七字段完整身份；新项目直接绑定已验证 active release，已有项目只用一次未绑定的只读状态预检发现 pin，Electron 精确验证对应 CAS 后再以 canonical 环境绑定所有实际业务/变更命令；Python 重验 manifest/payload/CAS 与期望身份，拒绝只比较名称/版本；
- 项目标准状态、只读差异计划和一次确认升级 CLI/IPC/UI 已实现。计划绑定所有关键状态；升级创建检查点、归档旧 issues、原子提交 pin、设置 `rulepack_check_required` 并自动重检；全局标准变化不会静默改变旧项目；
- Electron 正常启动即对默认 session 应用离线 Chromium switches，并阻断 `http/https/ws/wss/ftp`；Renderer 保持固定 CSP。获授权的未来联网 Provider 必须走独立受限通道，不能放宽默认 session；
- 源码 smoke 每次把项目、标准 store、临时目录、userData、缓存、HOME/APPDATA/XDG 和 crash dumps 隔离在 `out/source-smoke/runs/<run-id>/`，项目外 Electron 或输出路径 fail-closed；
- PDF 样张使用非持久、无缓存专用 session，禁用 JavaScript、导航、新窗口和网络；HTML 加载后复核身份，PDF 目标逐段校验项目/`exports` 父链并同目录暂存、`fsync`、原子换入；
- Python 项目打开执行完整 schema 与所有清单控制路径验证，拒绝根目录/固定子目录/manifest/source/working/报告/检查点的路径逃逸、链接/联接、硬链接和身份混淆；
- `create/check/recheck/fix/export/verify/restore-checkpoint/external/issue/upgrade-rulepack` 共用非阻塞跨进程内核写锁；争用立即返回结构化 `PROJECT_WRITE_LOCKED`，进程崩溃由内核自动释放互斥，不按陈旧 PID 删除锁；
- `create` 锁前只读预检且失败零污染；锁内只打开一次输入，以同一 FD 写入 `source`，再从受控 `source` 生成 `working`。只读 OneDrive/reparse/symlink 来源在最终对象为常规文件时允许；复制期间变化或失败会按 inode/文件身份精确清理、保留用户原有空目录并恢复旧协议锁原字节；
- 自选 `out_dir` 逐级拒绝链接/联接，项目内部只允许 `exports/`；全部输出目标在首个字节前预检，硬链接或非常规目标拒绝，每个文件同目录暂存、`fsync` 后原子换入；
- IPC 保留退出码 1 的有效业务 JSON，退出码 2 作为错误；Python 结构化错误的 `code/message/retryable/details` 可传到 Renderer；
- 新增 EpubCheck 完整分发、Windows JRE 和 Python 运行时的受版本控制全量清单；平台、架构、文件集合、大小、哈希和许可证材料不一致即拒绝；
- EpubCheck/JRE 以好样本和缺陷样本构成双向探针；Python `_pth` 隔离语义纳入门禁；任何全局资源错误发生时不执行未验证运行时；Windows alpha 门禁已实际执行探针；
- Ace 阶段包通过受版本控制的 full lock 固定生产依赖闭包、全部文件哈希和许可证清单；以受审核替换禁用作者加载期 JavaScript、移除作者脚本并限制资源协议；stage 和 gate 均拒绝空许可证；
- packaged 模式禁止从 PATH 或开发树回退；打包后资源门禁和 smoke 入口按固定路径运行；
- Electron、smoke 与资源探针统一以净化环境和 `-I -S -X utf8` bootstrap 调用 Python；CPython 探针核对 implementation、三段版本、releaselevel 和 serial；macOS x64/arm64 CPython 均固定为 `3.13.14`；
- 构建包装器清除签名/联网凭据，强制仓库本地 cache、临时目录和离线 builder 工具预检；工具缺失时提前、明确失败；
- 字节级信任锁涉及的 manifest 与 Ace 隔离替换强制 LF checkout；Ace full lock 还固定 stage manifest 原始字节哈希，语义等价的重新排版也拒绝；所有清单采用固定 UTF-16 code-unit 排序，并有跨平台字节稳定性测试；
- JRE 的 runtime+tracked lock 与 Ace 的 stage+tracked lock 均事务换入，任一提交失败会恢复原目录和原锁；
- macOS 采用 x64/arm64 分架构 Python/JRE 锁、原生构建/探针 runner 和不执行探针的跨主机静态聚合，不把 Windows 资源或静态结果误写为 macOS 运行验证；
- Electron smoke 分别断言 Electron `appVersion`、Python 核心实际 manifest/report 的 `app_version`，以及 APP/项目/检查/导出报告的七字段标准身份；打包版模式还必须证明 `app.isPackaged`；
- 当前 17 项 sale blocker 由门禁机器可读地保留，不允许 alpha 通过掩盖正式售卖责任。

上一阶段保留的批量修复实现：

- 新增 `fix_plans.py`，计划 ID 绑定项目、working 哈希、完整问题状态、规则包内容和候选清单；
- 同一 fixer 中存在 rejected 问题时整类阻断，避免全文 fixer 修改未确认位置；
- TAB 改为每个位置独立 finding，并用 `【⇥】 → 【␠】` 明示；
- 批量修复先在临时稿执行，再提交 working / issues / project；异常恢复检查点树；
- 检查点快照增加状态和检查结果哈希，提供 `list-checkpoints` / `restore-checkpoint`；
- UI 新增集中确认对话框、检查点列表、“撤销上一次批量修复”和恢复选定检查点；
- IPC 不再暴露无计划直接修复；CLI/IPC 错误不会被包装为成功；
- preload 保持沙箱兼容；真实 Electron 冒烟已验证。

## 当前下一项

按 v2.0 方案直接继续 Windows 可安装 alpha 和正式发布阻断项，不重新规划总体路线：

1. 经用户授权联网后，显式运行 `npm run download:builder:win`，仅取得合同固定的三份官方归档；
2. 下载器全量验哈希后运行 `node scripts/import_windows_builder_toolchain.js --archive-dir out/downloads/windows-builder --update-lock`，提交并复核真实工具树独立 lock；
3. 生成 alpha.8 NSIS + ZIP，逐个执行打包后资源门禁、版本/packaged 身份断言和完整 smoke；成功后由流水线生成并复验 SHA256SUMS + canonical release manifest；
4. 在干净 Windows 环境完成安装、升级、卸载和无系统 Python/Node 验证；
5. 逐项关闭 17 个 sale blocker；源码标签和 alpha 产物不得表述为可售卖正式版。

如构建需要联网下载、安装新依赖、签名或发布，先取得用户授权。

## 已知技术与产品欠账

- 批量修复与通用检查点恢复的多文件提交能覆盖可捕获异常，但尚无统一的强杀/断电恢复日志；标准 store 已有 pending 事务恢复，规则包升级以原子 project manifest 为提交点保证项目可打开，但二者不能被夸大为任意多文件 ACID；
- Ace 已脱离开发树依赖，但仍使用通用 helper 和用户系统 Chrome；最小权限 helper、自带浏览器、OS 级默认拒绝网络及可信根加固未完成；
- Ace 有 18 个依赖包只有生成的许可证通知，且整个 236 包生产闭包的来源、许可证、版权与再分发义务均尚需正式人工审计；
- CPython、EpubCheck、Temurin JDK/JRE、Electron 与 builder 工具链的官方来源和再分发/校验证据尚需人工审计；Python、EpubCheck、JRE、Ace、Electron 和 loose app resources 等信任根尚未完成签名/asar integrity/fuses 加固；
- Windows Authenticode 和安装包签名尚未完成；alpha.8 没有安装包或 ZIP；
- 标准治理 schema、完整身份和本地升级链已实现，但没有任何外部来源完成核验，4 项外部标准仍在审阅，reviewer 仅为角色占位，GB/T、APA、Chicago、EPUB、TXT/Markdown、纸质出版和可访问性覆盖仍不够，不能宣传为“标准库完整”；
- 标准包生产 trust pin、联网检查/下载和签名撤回分发尚未实现；当前本地签名包导入按设计禁用；
- Windows 开发机无法替代真实 macOS 构建、签名、公证和实机 smoke；
- 账号、订阅、同步和 Web 作业涉及生产系统，尚未获得本轮联网/网站写入授权；
- “接入用户自己的 AI”的六项设计决定已确认，但尚未获用户明确批准正式写入 v2.0 方案或实现，不在当前实现范围。

## 历史里程碑

- 2026-07-28：推进到 `0.1.0-alpha.8`；完成统一账号状态、Free/Pro/宽限、SyncRecord v1/JSON Schema、可信核心来源、逐字段预览和当前进程幂等队列契约；完整回归与隐藏 Electron 双样本 smoke 通过；没有联网、生产账号/同步服务或新二进制。
- 2026-07-28：推进到 `0.1.0-alpha.7`；完成 Windows NSIS/ZIP 的稳定身份读取、交叉绑定 SHA256SUMS/canonical manifest、联合事务提交及构建前清除/packaged smoke 后生成顺序；Node 267、Python 344 与隐藏 Electron 双样本 smoke 通过；真实空 release 按预期拒绝，仍无制品。
- 2026-07-28：推进到 `0.1.0-alpha.6`；完成固定官方 URL、显式联网开关、仓库内受控下载、全量验哈希后事务落盘和 11 项反向测试；统一 Node 261/Python 344 与隐藏 Electron 双样本 smoke 通过；本轮未联网，真实归档、工具树和制品仍缺。
- 2026-07-27：推进到 `0.1.0-alpha.5`；完成默认引用体例的本地结构解析、显式计划确认、`structure_only` 安全退回、项目/报告追溯、标准包 2.0.0 与历史 CAS 迁移；Node 250、Python 344 及隐藏 Electron 双样本 smoke 通过；仍无新二进制或联网更新。
- 2026-07-27：推进到 `0.1.0-alpha.4`；完成 Electron 43.1.0 Windows 全树锁、严格/canonical tracked manifest 与安全原子更新事务，以及 Windows builder 固定归档安全导入器、独立 tracked lock 合同、旧资产预检及完整 rename/rollback 故障矩阵；Node 239、Python 312、真实 Ace 与隐藏 Electron smoke 通过；sale blocker 降为 17；真实 builder 归档和二进制仍缺。
- 2026-07-27：推进到 `0.1.0-alpha.3`；完成 standards schema 2.0、canonical manifest、能力映射、本地签名/CAS/高水位/回滚存储、七字段项目 pin、显式升级、强制重检与逐报告身份诊断；统一回归 Node 186、Python 312，真实 Ace 与隐藏 Electron smoke 通过；仍无 alpha.3 二进制、生产标准 trust pin 或联网更新。
- 2026-07-27：推进到 `0.1.0-alpha.2`；完成 Windows Python/JRE/EpubCheck/Ace 全量资源锁、运行探针 alpha 门禁、默认离线 Electron、受限 PDF、项目 schema/路径验证、跨进程写锁、无污染单 FD 创建与安全导出；保留 18 项 sale blocker；建立 macOS 分架构原生 runner 与静态聚合边界；因 `tools/electron-builder/win32-x64` 缺失，未生成新二进制。
- 2026-07-26：完成 `0.1.0-alpha.1` P0 可信批量修复、检查点恢复、Node 测试和真实 UI 冒烟。
- 2026-07-26：建立 Claude 0.0.1 完整只读基线和独立 ChatGPT 商业开发克隆；完成标准缺口审计与 v2.0 商业正式版方案。
- 2026-07-11：Claude 0.0.1 完成四种输入、三类配置、35 条规则、桌面 MVP 和 Windows 便携 ZIP。
