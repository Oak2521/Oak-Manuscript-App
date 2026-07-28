# AI_HANDOFF — 湖岸稿件（Oak Manuscript）项目交接说明

> 最近更新：2026-07-28
> 当前开发方：ChatGPT Codex
> 当前版本：`0.1.0-alpha.11`
> 当前分支：`chatgpt/commercial-v1`
> 源码检查点标签：`chatgpt-v0.1.0-alpha.11`（只标记源码与本地验证状态，不代表安装包或正式发行）

## 1. 权威入口与工作区

商业正式版的唯一需求权威是：

`docs/湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md`

Claude v1.2 方案和 0.0.1 实现是历史基线，不再覆盖 v2.0 的商业化、跨端、账号、同步和标准升级决策。

当前独立开发克隆：

`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`

只读完整基线：

`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\baseline\claude-0.0.1-full`

基线来源说明及哈希：

`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\BASELINE_PROVENANCE.md`

源 Claude 仓库、`oak-publishing-system`、`netlify-site` 和商业计划书目录均只读。所有开发、测试和构建产物只能留在当前克隆目录。

## 2. 当前现场事实

### 已完成：0.1.0-alpha.11 ASAR 资源信任根

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.11`；标准内容、35 条规则、6 个 fixer、账号和同步合同未变化；
- `config/tool-manifests/app-resources-v1.json` 以 canonical 字节固定 58 个将 loose 分发的应用文件，共 1,873,018 字节；`electron/resource-trust-anchor.json` 位于应用代码 ASAR 内，固定该清单及 win32-x64 Python/EpubCheck/JRE/Ace 四份平台锁的原始 SHA-256；
- packaged 门禁只接受从真实 `app.asar` 读取的锚点，不信任 resources 目录内的同名 loose 文件；完整验证拒绝资源或锁增删改、平台替换、链接/硬链接及读取竞态；
- 打包应用在初始化标准存储和创建窗口前运行同一资源信任验证；失败记录错误并以退出码 1 终止；
- `--update-lock` 改用仓库既有 tracked-file 事务安全替换并写后复验。两文件之间若第二步失败会保持 fail-closed，重新显式执行即可恢复一致；
- 构造的真实 `app.asar` 集成测试在证据成立时只关闭 5 个可信根 blocker，剩余 12 个不变；源码门禁仍完整列出 17 个 blocker，当前没有产品 `app.asar`，不能宣称正式可信根已关闭。

### 现场验证（2026-07-28，alpha.11）

- 最终统一 `npm test`：**PASS，退出码 0，墙钟 171.3 秒**；Node 301 total / 294 pass / 0 fail / 7 skip（3.313 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（110.355 秒）；
- `verify:resource-trust`、`verify:standards`、`stage:ace`、`verify:electron-runtime`、`verify:resources:win` 和 `verify:fuses:config` 均 **PASS**；锚点 SHA-256 为 `1b52a14f82f80e9ef4596b83b4abf3f2ddc821fe8f8ee8aedd7e996c1e80c644`；
- Windows 源码 alpha 资源门禁实际执行 Python/JRE/EpubCheck 探针，core 返回 `0.1.0-alpha.11`，并仍如实列出 17 项 sale blocker；
- 本轮未联网、未运行 builder、未生成安装器/ZIP/发布证据，也未重跑 alpha.11 UI smoke；最近一次 alpha.10 隐藏 UI smoke 只能作为历史证据。

### 已完成：0.1.0-alpha.10 Ace 受控 utilityProcess 与 RunAsNode 关闭（历史检查点）

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.10`；标准内容、35 条规则、6 个 fixer、账号和同步合同未变化；
- Renderer 的外部验证只提交受路径门禁保护的项目目录；主进程生成绑定项目/working/报告/标准与 Java、JAR、Ace、Chrome 文件身份的计划，准备输出后才启动固定 helper，完成后再由 Python 重验计划并解析报告；
- Ace 在 Electron `utilityProcess` 中运行固定入口和参数；环境清除 Node/Electron/Puppeteer/Oak/Ace 注入，合并输出上限 64 KiB、最长 5 分钟，目录身份换入、路径替换、超时、异常退出或报告非法均 fail-closed；
- 系统 Chrome 由主进程以固定隐藏参数、独立 profile、随机 loopback DevTools 端点启动；utility 只能连接该严格本地端点，结束后停止精确子进程并清理 profile；这不是互联网传输，也不等于 OS 级无网沙箱；
- Electron fuse 已改为 `RunAsNode=false`；配置门禁与 wire 合同相应更新。Electron 43 未知索引 8 仍按 alpha blocker / sale fail-closed 处理；
- `ACE_CONTROLLED_HELPER_PENDING` 没有被伪关闭：源码 helper 和真实源码 UI 功能已验证，但缺真实打包制品上的功能、安全与 fuse 联合证据。

### 现场验证（2026-07-28，alpha.10）

- 最终统一 `npm test`：**PASS，退出码 0，墙钟 119.4 秒**；Node 295 total / 288 pass / 0 fail / 7 skip（2.461 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（112.121 秒）；
- `verify:standards`、`stage:ace`、`verify:electron-runtime`、`verify:resources:win` 和 `verify:fuses:config` 均 **PASS**；Fuse 报告 `run_as_node_disabled=true`，Windows alpha 资源门禁仍如实列出 17 项 sale blocker；
- 独立隐藏条件源码 smoke：**SMOKE-RESULT PASS**，运行根 `out/source-smoke/runs/ms4cz6o9-c2ad021ca7e2e83c/projects/`；DOCX/EPUB 均 4 次检查、1 次修复、3 个检查点、原稿哈希不变，当前问题 13/5、应用 fixes 5/2、PDF 251,649/178,228 字节；
- 同一 smoke 中 EPUB 缺陷样本实际执行 EpubCheck 5.3.0 和 Ace 1.4.6：EpubCheck `failed`（0 fatal / 5 error / 0 warning），Ace `failed`（整体 fail，8 项断言）；运行结束没有遗留 `oak-ace-chrome-*` profile；
- `release:evidence:verify:win` 与 `verify:packaged:fuses:win` 按设计拒绝缺失 alpha.10 安装包/`win-unpacked`；没有用源码运行冒充 packaged 证据；
- 本轮没有联网、没有下载 builder 归档、没有运行 electron-builder，也没有生成安装器、ZIP 或发布证据。

### 已完成：0.1.0-alpha.9 Electron ASAR 与 fuse 发布硬化合同（历史检查点）

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.9`；标准内容、35 条规则、6 个 fixer、账号和同步合同未变化；
- 新增 `scripts/electron_fuse_policy.js`：要求 `build.asar=true`、`disableAsarIntegrity=false`，并精确固定全部本地已知 fuse；配置缺项、多项、漂移、inherit 或 removed 状态均拒绝；
- Windows/macOS 构建链在 electron-builder 前验证配置，在 builder 后立即读取真实打包二进制 fuse wire，然后才允许进入打包资源门禁、packaged smoke 与发布证据；
- 二进制验证限定仓库内安全父链、常规非空单链接文件，并在 fuse 读取前后验证稳定身份；已知 fuse 必须逐项匹配；
- `RunAsNode=true` 只是当前 Ace helper 的临时兼容状态，仍是正式发布欠账；受控 helper 完成后必须切到 `false` 并重新验证；
- 本机 Electron 43.1.0 暴露 wire 索引 0—8，而 `@electron/fuses` 1.8.0 只定义 0—7。索引 8 的状态字节为 `49`，但名称/语义本地不可验证，禁止猜测；alpha 返回 `ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING`，sale 失败关闭；完整合同见 `docs/ELECTRON_FUSE_POLICY.md`。

### 现场验证（2026-07-28，alpha.9）

- fuse 专项 `node --test tests/electron_fuse_policy.test.js`：**6/6 PASS**；`npm run verify:fuses:config`：**PASS**；
- 最终统一 `npm test`：**PASS，退出码 0，墙钟 121.2 秒**；Node 284/277/0/7（2.350 秒），Python 348/0 failures/0 errors/3 skipped（114.170 秒）；
- `verify:standards`、`verify:electron-runtime`、Windows alpha 资源门禁均 **PASS**；core 为 `0.1.0-alpha.9`，既有 sale 资源门禁仍为 17 项 blocker；未知 packaged fuse 是独立的条件阻断；
- macOS 静态门禁按设计拒绝缺失双架构资源；`release:evidence:verify:win` 按设计拒绝缺失 `Oak-Manuscript-0.1.0-alpha.9-Windows-x64.exe`；
- 沙箱外独立隐藏 `npm run smoke`：**SMOKE-RESULT PASS**，运行根 `out/source-smoke/runs/ms49yas5-9ccb167e78f033a2/projects/`；DOCX/EPUB 均 4 次检查、1 次修复、3 个检查点、原稿哈希不变，当前问题 13/5、报告 applied fixes 5/2、PDF 251,650/177,417 字节；
- 本轮没有联网、没有下载 builder 归档、没有运行真实 packaged fuse 验证，也没有生成安装器、ZIP 或发布证据。

### 已完成：0.1.0-alpha.8 统一账号、权益与同步离线契约

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.8`；规则包、标准内容和自动修复白名单未变化；
- `AuthProvider` 已从“即将开放”占位升级为可测试状态机，固定生产登录方式为系统浏览器 PKCE；正式服务未配置时明确返回 `configuration_required`，不打开页面、不联网；测试模拟覆盖登录、退出、过期和设备撤销，生产 UI 不开放模拟入口；
- `LicenseProvider` 固化 Free/Pro 能力矩阵及 `validUntil`/`graceUntil` 离线宽限计算；模拟授权明确 `signatureVerified=false`，过期仅降级新权益，`localProjectsLocked=false` 永久成立；
- Python 新增严格只读 `sync-source`，只返回随机项目 ID、检查 ID、枚举、版本、计数所需的结构化问题记录和状态；不返回标题、解释、位置、预览、文件名、路径或哈希；
- Electron `buildSyncRecordV1` 和 `validateSyncRecordV1` 使用 exact schema、交叉计数和禁止字段反向门禁；`config/schemas/sync-record-v1.schema.json` 作为未来网站服务端复用的 JSON Schema 2020-12 合同；
- Renderer 不能提交任意同步 payload，只能提交项目句柄和固定枚举。已登录用户在导出后可看到逐字段安全预览，并选择仅本次、同步本次以后仍询问、暂不同步或不再询问此项目；未登录不询问；失败不影响导出；
- `SyncProvider` 提供幂等的当前进程内 `pending_transport` 队列以及取消、重试、删除契约。生产 transport 与持久队列未实现，因此当前真实 APP 不会上传，重启后模拟队列不保留；完整边界见 `docs/SYNC_RECORD_V1.md`。

### 现场验证（2026-07-28，alpha.8）

- 最终统一 `npm test`：**PASS，退出码 0，墙钟 93.7 秒**；Node 278/271/0/7（2.389 秒），Python 348/0 failures/0 errors/3 skipped（86.468 秒）；
- `npm run verify:standards`、`npm run verify:electron-runtime`、`npm run verify:resources:win`：**PASS**；Windows alpha 探针读到 core `0.1.0-alpha.8`，sale 门禁仍有 17 项 blocker；
- `npm run verify:resources:mac:static`：按预期退出 1，仍精确缺两架构 Electron dist、Python runtime manifest 与 JRE；
- 沙箱外独立隐藏 `npm run smoke`：**SMOKE-RESULT PASS**，运行根 `out/source-smoke/runs/ms48q9hr-05f6b99b193cf33d/projects/`；DOCX/EPUB 均 4 次检查、1 次修复、3 个检查点、原稿哈希不变，当前问题 13/5、报告 applied fixes 5/2、PDF 251,660/177,267 字节；未登录、Free 权益和空同步队列断言通过；
- `release:evidence:verify:win` 按预期拒绝缺失的 alpha.8 NSIS；本轮没有联网、没有下载 builder 归档、没有生产账号/同步调用，也没有生成安装器、ZIP 或发布证据。

### 已完成：0.1.0-alpha.7 Windows 发布制品证据链

- APP、Python 核心和 lockfile 已统一到 `0.1.0-alpha.7`；标准内容和自动修复白名单未变化；
- 新增 Windows x64 发布证据生成/验证器，只接受与 package/lock 当前版本精确匹配的 NSIS EXE 与 ZIP；坏 PE/ZIP、缺档、同系列旧制品、symlink/reparse、hardlink、路径逃逸或哈希期间身份变化均 fail-closed；
- `SHA256SUMS.txt` 固定两件制品有序摘要；canonical `release-manifest-win32-x64.json` 固定产品、appId、版本、目标、类型、大小/摘要，以及 SHA 文件原始字节摘要；验证时重新读取全部制品并交叉核对；
- 两份证据采用独占候选、`fsync` 与联合提交，第二次 rename 或换入后复验失败会恢复两份旧证据；清除旧证据前先预检两份文件，拒绝链接/硬链接；
- `build:win` 现在先清除旧证据，只有 electron-builder、packaged 资源门禁与隐藏 packaged smoke 全部成功后才生成新证据；失败构建不会留下本次新证据；
- 真实 `release/` 只有 `.gitkeep`，`release:evidence:verify:win` 已按预期拒绝缺失的 alpha.7 NSIS；没有生成伪造 SHA 或 manifest。

### 现场验证（2026-07-28，alpha.7）

- 发布证据专项：6 项，5 通过、0 失败、1 项因本机文件 symlink 权限条件跳过；hardlink、坏格式、旧制品、版本漂移、篡改、联合提交回滚与清除预检均实测；
- 最终统一 `npm test`：**PASS，退出码 0，墙钟 88.1 秒**；Node 267/260/0/7（2.487 秒），Python 344/0 failures/0 errors/3 skipped（80.833 秒）；
- `npm run verify:standards`、`npm run verify:electron-runtime`、`npm run verify:resources:win`：**PASS**；Windows alpha 探针读到 core `0.1.0-alpha.7`，sale 门禁仍保留 17 项 blocker；
- `npm run verify:resources:mac:static`：按预期退出 1，精确缺两架构 Electron dist、Python runtime manifest 与 JRE；
- 独立隐藏 `npm run smoke`：**PASS**，运行根 `out/source-smoke/runs/ms47c3l8-9b6bf78452308a33/projects/`；DOCX/EPUB 均 4 次检查、1 次修复、3 个检查点、原稿哈希不变，当前问题 13/5、报告 applied fixes 4/2、PDF 251,656/177,263 字节；
- 本轮没有联网、没有下载 builder 归档、没有工具树/tracked lock，也没有 alpha.7 NSIS、ZIP 或发布证据文件。

### 已完成：0.1.0-alpha.6 Windows builder 受控归档下载入口

- APP、Python 核心和 lockfile 已统一到 `0.1.0-alpha.6`；标准内容未变化，继续使用已验证的 `oak-standards 2.0.0` / `oak-rules 2.0.0`（sequence 2）；
- 来源合同除三份固定文件名和 SHA-256 外，同时固定 electron-builder 官方 GitHub release URL；下载只接受 HTTPS、固定仓库路径和文件名，重定向只允许明确的 GitHub release asset 主机；
- 联网默认关闭：CLI 必须显式携带 `--allow-network`，唯一便捷入口为 `npm run download:builder:win`；普通 `build:win`、`dist` 和全部 test 不调用下载器；
- 输出只能位于仓库内，默认 `out/downloads/windows-builder/`；目录父链拒绝链接/逃逸，已有正确归档按哈希复用，已有错误归档和未知条目 fail-closed 且绝不覆盖；
- 三份候选全部完成并逐一核对大小/SHA-256 后才提交；候选使用独占创建、128 MiB 上限、30 秒闲置超时、最多 5 次受限重定向和显式 `fsync`，提交竞争或中途失败只回滚本事务文件；
- 本轮没有用户联网授权，因此只实现并测试入口，**没有发出网络请求、没有下载真实归档、没有生成工具树/tracked lock/NSIS/ZIP**。

### 现场验证（2026-07-28，alpha.6）

- 最终统一 `npm test`：**PASS，退出码 0，墙钟 97.2 秒**；Node 261/255/0/6（2.627 秒），Python 344/0 failures/0 errors/3 skipped（89.446 秒）；
- downloader 专项 11 项全通过，覆盖固定 URL、显式授权、零授权零写入、受限重定向、容量/哈希门禁、事务提交、并发碰撞回滚、错误旧文件/未知归档拒绝、仓库边界与链接拒绝；
- `npm run verify:standards`、`npm run verify:electron-runtime`、`npm run verify:resources:win`：**PASS**；Windows alpha 探针读到 core `0.1.0-alpha.6`，sale 门禁仍保留 17 项 blocker；
- `npm run verify:resources:mac:static`：按预期退出 1，仍精确缺两架构 Electron dist、Python runtime manifest 和 JRE；
- 独立隐藏窗口 `npm run smoke`：`SMOKE-RESULT: PASS`，输出根 `out/source-smoke/runs/ms46fhdh-230a41fd46481179/projects/`；DOCX/EPUB 均为 4 次检查、1 次批量修复、3 个检查点、`source_hash_ok=true`，引用分别以 `conflicting_structures` / `extractor_coverage_insufficient` 退回 `structure_only`，当前问题 13 / 5，PDF 251,661 / 177,434 字节。

### 已完成：0.1.0-alpha.5 默认引用解析、显式确认与标准包 2.0.0

- APP、Python 核心和 lockfile 已统一到 `0.1.0-alpha.5`；内置标准为 `oak-standards 2.0.0` / `oak-rules 2.0.0`，release sequence 2，仍是 35 条规则和 6 个白名单机械 fixer；
- 默认解析器纯本地、确定性运行：只根据编号引用、作者—年份、注释—书目、语言和提取能力作决定；强/中阈值固定为 3/2 个唯一信号与 80%/50% 覆盖率；结果不含稿件文字、姓名、引用串、路径或哈希；
- 确有当前格式/类型/语言规则能力时才选定 `gbt7714-2025 | apa-7 | chicago-18-nb | chicago-18-ad`；冲突、证据不足或 EPUB 仅部分可提取时退回 `structure_only`，而非猜测具体体例；
- 新增只读 `plan-citation`、绑定项目全状态的 `citation-plan-*` 和 `check --citation-plan-id`；UI 在实际检查前集中显示体例/模式、理由、置信度、数量证据与实际覆盖规则，用户一次确认后才运行；
- `citation_resolution` 写入项目设置、检查快照、机器报告、Markdown/HTML 报告和导出摘要；旧 1.0 项目容许缺失该字段。标准升级时保留用户显式体例，但清空旧默认解析并按新包重算；
- 2.0.0 manifest/规则包/能力集 SHA-256 分别为 `0aff75eb…8427` / `098b382e…97a4` / `af67d0aa•320e`；rollback target 为 1.0.0 manifest `d33534f0…d7af`。旧项目仅能使用本地 CAS 内仍存在且已验证的历史 release 迁移，缺失时 fail-closed，不用最新包冒充；
- 切换稿件或项目目录时 Renderer 清空上一项目会话，修复连续处理 DOCX/EPUB 时复用旧项目的真实 smoke 缺陷。

### 现场验证（2026-07-27，alpha.5）

- `npm run test:node`：**PASS**，250 项、244 通过、0 失败、6 条件跳过，2.650 秒；
- `npm run test:python`：**PASS**，344 项、0 失败、0 错误、3 条件跳过，80.191 秒；最终统一 `npm test`：**PASS，退出码 0，墙钟 160.5 秒**，Node 段 250/244/0/6（2.675 秒），Python 段 344/0/0/3（88.790 秒）；
- `npm run verify:standards`、`npm run verify:electron-runtime`、`npm run verify:resources:win`：**PASS**；Windows sale 门禁仍按设计以 17 项 blocker 退出 1；
- `npm run verify:resources:mac:static`：按预期退出 1，仍缺 darwin-x64/arm64 Electron dist、两架构 Python runtime manifest 和 JRE；
- 沙箱外独立隐藏 Electron `npm run smoke`：`SMOKE-RESULT: PASS`。输出根 `out/source-smoke/runs/ms44nzhb-8186d1b3c5148eba/projects/`；DOCX/EPUB 均先确认引用计划、各 4 次检查且 `source_hash_ok=true`；两者分别因 `conflicting_structures` / `extractor_coverage_insufficient` 安全退回 `structure_only`；PDF 分别为 251,646 / 177,416 字节；
- 本轮未联网，未下载 builder 归档，未生成 alpha.5 制品，未运行 packaged smoke、干净系统或签名验收。

### 已完成：0.1.0-alpha.4 Electron 与 Windows builder 构建输入可信链

- APP、Python 核心和 lockfile 已统一到 `0.1.0-alpha.4`；标准内容没有变化，仍是 `oak-rules 1.0.0`、release sequence 1；
- Windows x64 Electron 43.1.0 新增受版本控制的完整树锁：2 个目录、75 个文件、364,083,658 字节，manifest SHA-256 为 `ae67132b95e21b62450fd0e34faaf00164514b38322076c56e37c0301c520d95`；默认命令只读验证，tracked manifest 以严格 JSON 拒绝重复键，以 exact schema 拒绝未知字段，并要求生成器定义的唯一 canonical UTF-8/LF 原始字节；
- `electronDist` 和源码/packaged 资源门禁都会在使用前核对 package-lock、运行时完整目录树、大小和 SHA-256。缺失、多出、篡改、硬链接、Node 可识别的 symlink/junction/reparse 或路径逃逸均 fail-closed，electron-builder 不会回退下载；只有显式 `--update-lock` 才能重写 tracked manifest，更新前验证安全父链并拒绝目标 symlink/hardlink，使用独占候选文件、`fsync`、原子替换和换入后复验；失败恢复旧字节，回滚自身失败则明确报错并保留事务证据；
- 新增 Windows builder 安全导入器，独立固定三份归档及 SHA-256：`nsis-3.0.4.1.7z`（`9877df…c5fa`）、`nsis-resources-3.4.1.7z`（`593a9a…4103`）、`winCodeSign-2.6.0.7z`（`cdaec7…43a4`）；
- 导入器固定本地 7z 组件，解压前后拒绝路径逃逸、链接、冲突/保留名、备用流、加密/反条目、异常容量、硬链接和清单漂移；UNC/device 目录在读取前拒绝。工具树 manifest 与受版本控制独立 lock 交叉绑定，且仅显式 `--update-lock` 才能作为同一事务换入；普通 build/test 不调用导入器；
- 安全复核发现的两项 P1 已修复：verifier 遇到不安全祖先路径会在读取前停止；旧工具树/旧 lock 在任何 rename 前做父链、realpath、单链接和全树预检。4 个前向与 4 个回滚 rename 均有故障注入，回滚自身失败会明确报错并保留恢复证据；
- 本机没有三份真实归档，因此**没有**真实 builder 工具树、独立 tracked lock、NSIS 或 ZIP。该边界是当前正确的 fail-closed 状态，不得伪造 lock 或把导入器实现写成制品完成。

### 已完成：0.1.0-alpha.3 标准包可信链、项目固定版本与显式升级（历史检查点）

- APP、Python 核心和 lockfile 版本已推进到 `0.1.0-alpha.3`；规则包继续是 `oak-rules 1.0.0`、发布序列 1，本轮没有借 APP 版本变化伪造标准内容版本；
- `standards.json` 升级为治理 schema 2.0，保留 13 项标准；`rule-capabilities.json` 对 35 条规则与 6 个机械 fixer 做精确能力映射；canonical manifest 固定 payload、APP 兼容范围、release sequence、规则包哈希与能力集哈希；
- manifest SHA-256 为 `d33534f081b2122a90652ee03304a0e71177a7fd0d3130fffe77b0fea807d7af`；规则包 SHA-256 为 `7ac5a5bdb126e9f5148a040ce42a634b1a95295c27d7a72c774db54bf7129542`；
- Electron 标准存储实现严格 JSON/payload 校验、Ed25519 门槛签名、内容寻址存储、release sequence 高水位、撤回/过期/兼容性检查、签署的精确回滚目标、跨进程事务锁和确定性崩溃恢复；未知或身份不一致状态一律 fail-closed；
- 当前内置包可离线验证并启动；本地签名包预览、安装和全局回滚路径已实现，但生产 trust pin 尚未配置，所以真实本地签名包导入默认禁用；联网检查、下载与自动升级尚未实现；
- 新项目直接绑定当前已验证包；已有项目先运行一次不带身份绑定的只读 `project-standard-status` 预检以发现 pin（预检前仍先验证全局标准存储），Electron 随后精确核验项目所指 CAS release。真正的业务或变更命令再以净化环境变量携带完全相同的 canonical 七字段身份，由 Python 复核；
- `project-standard-status`、`plan-rulepack-upgrade` 与 `upgrade-rulepack` 已实现。升级计划绑定项目清单、状态、source/working、issues、最新检查和目标身份；UI 集中显示完整差异并一次确认，目标 digest 由主进程选择；升级创建检查点、归档旧 issues、原子提交新 pin，并强制重检；
- 全局包更新不会静默改变已有项目。过期、撤回或 APP 不兼容的旧包只可作为受控迁移源，不能放宽签名、路径、payload、能力映射、未来 release 或身份校验；
- `app:info`、源码 smoke 和打包 smoke 契约核对 APP、项目、检查记录与导出报告的完整七字段身份；源码 smoke 每次使用独立 `out/source-smoke/runs/<run-id>/`，不会被旧 userData 或标准存储污染；
**继承并回归的 alpha.2 离线资源、安全与发布门禁能力：**

- Electron 正常启动即对默认 session 应用离线 Chromium switches 和 `http/https/ws/wss/ftp` 请求拦截，Renderer CSP 继续禁止远程脚本；未来获授权的联网 Provider 必须使用独立受限通道，不能放宽默认 session；
- PDF 审阅样张使用非持久、无缓存的隔离 session，禁用 JavaScript、导航、新窗口和网络，并在加载 HTML 后复核文件身份；PDF 通过父目录/目标身份验证后在 `exports/` 同目录暂存、`fsync` 并原子换入；
- Python 项目打开已改为完整 schema 与路径 fail-closed 验证；项目根、固定子目录、manifest、source/working、报告与检查点均拒绝逃逸、链接/联接、硬链接和身份混淆；所有变更型 CLI 命令共用非阻塞跨进程内核写锁，争用时返回可重试的结构化 `PROJECT_WRITE_LOCKED`；
- `create` 在加锁前只读预检，不会污染非法或非空目标；锁内只打开一次用户输入，以同一文件描述符复制到 `source`，再由受控 `source` 生成 `working`。只读输入可位于 OneDrive/reparse/symlink 路径，但最终打开对象必须是常规文件；复制期间来源变化或任一步失败都会按本事务文件身份精确清理，并保留用户已有空目录或恢复旧协议锁原字节；
- 自选 `out_dir` 导出逐级拒绝链接/联接，项目内部只允许落在 `exports/`；所有目标在首个导出字节前统一预检，已有硬链接/非常规目标直接拒绝，每个文件同目录暂存、`fsync` 后原子换入；
- Electron 桥将退出码 1 保留为有效业务结果、退出码 2 视为运行错误；Python 的结构化错误 `code/message/retryable/details` 可原样穿过 IPC；
- Windows x64 的嵌入式 Python、裁剪 JRE、EpubCheck 完整分发和 Ace 生产依赖闭包均由受版本控制的全量文件清单、大小和 SHA-256 校验；
- Python 运行时清单覆盖 34 个文件、21,260,753 字节；JRE 覆盖 207 个文件、52,384,264 字节；EpubCheck 覆盖 49 个文件、36,263,890 字节；Ace 覆盖 236 个包、6,672 个文件、58,964,235 字节；
- EpubCheck 用“好样本 0 错误 + 缺陷样本非零错误”的双向探针验证；Python/JRE 只有在全量资源校验无误后才允许执行；
- Ace 使用固定生产闭包和审核过的 XHTML 隔离替换：作者脚本先移除、作者文档加载阶段禁用 JavaScript、资源协议限制为受控范围；新增受版本控制的完整阶段 lock，资源门禁同时验证 lock 与 Python 运行时，空许可证文件直接拒绝；真实 Ace 好/坏样本条件测试均已通过；
- Windows 与 macOS 共用 `-I -S -X utf8` 的固定 Python bootstrap 和净化环境，不从工作目录、用户 site 或继承的 Python/OAK 环境注入核心；运行探针同时核对 `sys.implementation`、完整三段版本、`releaselevel=final` 与 `serial=0`，不是只比较版本字符串；macOS x64/arm64 CPython 版本均固定为 `3.13.14`；
- 所有信任清单使用与 locale/ICU 无关的 UTF-16 code-unit 顺序；JRE 的 runtime+tracked lock、Ace 的 stage+tracked lock 都以事务换入，失败时恢复原目录与原锁字节；
- Ace tracked lock 不仅固定解析后的 manifest 语义，还固定 `tools/ace/manifest.json` 原始字节哈希；语义等价但字节漂移同样拒绝；
- macOS 构建拆为 x64/arm64 原生 runner；跨主机聚合只能做不执行探针的静态检查，不能把 Windows 上的静态配置结果写成 macOS 运行验证；
- Windows alpha 资源门禁实际执行 Python 与 JRE/EpubCheck 探针并通过；sale 门禁按设计拒绝并列出 18 项未完成的正式发布责任，不会把 alpha 资源完备误判为可售卖版本；
- 经批准的提升权限 `build:win` 已完成本地 JRE/Ace staging 和 Windows alpha 资源探针，随后仅因 `tools/electron-builder/win32-x64` 缺失而明确停止；未联网下载，也没有产生 alpha.3 安装包或 ZIP。

### 已完成：0.1.0-alpha.1 P0 可信批量修复闭环（保留历史）

- `plan-fixes` 严格只读，返回绑定项目、工作稿哈希、问题状态和规则包的确定性 `plan_id`；
- UI 在一个可滚动界面集中列出本批全部修改前/修改后预览，取消或 Esc 不写入；
- `fix` 强制要求已确认的 `plan_id`，旧计划、异项目计划和不完整确认集合均拒绝；
- TAB 等离散修改逐位置生成问题和预览；任一同类问题被拒绝时，整类全文 fixer 从计划排除，避免顺带修改未展示内容；
- 修复先在临时工作副本执行，正常异常路径不留下部分 working / issues / project 写入；
- 达到 5 个检查点时，批量修复提交失败会恢复被裁剪的旧检查点；
- 检查点保存 working、issues、项目状态和检查结果快照，可列表、恢复并在恢复前创建安全检查点；
- 检查点恢复在文件换入或最终保存失败时恢复完整项目树；损坏或不可恢复项在 UI 中禁用；
- Electron preload 保持 `sandbox: true`，没有直接修复 IPC，只有计划、确认应用、列表和恢复四个固定 P0 通道；
- 当时 APP / Python 核心 / package 版本统一为 `0.1.0-alpha.1`；Node 与 Python 已统一到 `npm test`。

### 现场验证（2026-07-27，alpha.4）

- `npm run test:node`：**PASS**，239 项、233 通过、0 失败、6 条件跳过，2.606 秒；新增覆盖 Electron 全树锁、严格 JSON/exact schema/canonical 字节、安全 tracked-file 更新事务，以及 builder 独立 lock、旧资产预检和全部前向/回滚 rename 故障；
- Electron runtime 锁专项：**37 项、36 通过、0 失败、1 跳过**；hardlink 与 junction 反向路径在本机实测通过，文件 symlink 因 Windows `EPERM` 条件跳过，不计作通过；
- 最终 `npm test`：**PASS**，Node 239/233/0/6；Python 312 项、0 失败、0 错误、3 条件跳过，Python 段 80.125 秒；
- 沙箱外隐藏 Chrome 的 `$env:OAK_TEST_ACE='1'; npm run test:python`：**PASS**，312 项、0 失败、0 错误、1 条件跳过，44.807 秒；受限沙箱运行曾因未生成安全报告得到 2 个 `not_run` 断言失败，随后沙箱外实跑通过，这不是工具通过证据的替代；
- `npm run verify:standards` 与 `npm run verify:electron-runtime`：**PASS**；Electron 固定锁统计与上述 digest 一致；
- `npm run verify:resources:win`：**PASS**，实际执行 Python 与 JRE/EpubCheck 探针，Python core 报告 `0.1.0-alpha.4`；当前 sale 门禁按设计以 17 项 blocker 退出 1；
- 沙箱外独立隐藏 Electron `npm run smoke`：`SMOKE-RESULT: PASS`。输出根为 `out/source-smoke/runs/ms37h0mu-201a90896825d190/projects/`；DOCX/EPUB 均为 `app_version=0.1.0-alpha.4`、`source_hash_ok=true`、4 次检查，四方七字段标准身份一致；PDF 分别为 258,404 / 161,836 字节；
- macOS 静态门禁按预期退出 1：仍缺 darwin x64/arm64 Electron dist、两架构 Python runtime lock 和两架构 JRE；
- `node scripts/run_electron_builder.js --win --x64` 在启动 electron-builder 前按预期退出 1，理由是没有真实工具树与 tracked lock。全程未联网、未生成 alpha.4 制品，也未运行 packaged smoke、干净系统或签名验收。

### 现场验证（2026-07-27，alpha.3 历史检查点）

- 原生/沙箱外 `npm test` 统一入口：**PASS**。Node TAP 共 186 项，181 通过、0 失败、5 项条件跳过；Python 共 312 项，0 失败、0 错误、3 项条件跳过；
- `python scripts/run_tests.py`：共 312 项，0 失败、0 错误、3 项条件跳过，用时 77.755 秒；
- 沙箱外隐藏 Chrome 的 `$env:OAK_TEST_ACE='1'; python scripts\run_tests.py`：312 项，0 失败、0 错误、1 项条件跳过，用时 46.321 秒；早期同类受限运行器诊断无法生成安全报告，核心按设计返回 `not_run`，不写成工具通过或代码失败；
- `npm run verify:standards`：**PASS**，产出上述 manifest/规则包 digest；
- 沙箱外隐藏 Electron `npm run smoke`：`SMOKE-RESULT: PASS`。最新运行根为 `out/source-smoke/runs/ms34lrwa-cf3ac49f857dc7fc/projects/`；DOCX/EPUB 均完成检查→集中预览→批量确认修复→恢复→再次修复闭环，两个项目均为 `app_version=0.1.0-alpha.3`、`integrity.source_hash_ok=true`，各含 4 次检查记录，APP/项目/当前检查/报告七字段身份一致；PDF 分别为 258,400 和 161,845 字节；
- Windows alpha 资源门禁实际执行运行时探针并通过；sale 门禁有 18 项 blocker；提升权限 `build:win` 完成本地 JRE/Ace staging 和资源探针后，仅在缺少 `tools/electron-builder/win32-x64` 处停止，未联网、未生成制品；
- `npm run verify:resources:mac:static` 在 Windows 上按预期 FAIL，精确缺少 darwin-x64/arm64 Electron dist、两架构 Python runtime 锁和 `tools/jre-darwin-x64` / `tools/jre-darwin-arm64`；这证明跨主机静态逻辑可执行，不证明 macOS 可构建或已发行。两架构仍没有产物、签名、公证或打包版 smoke 证据。

完整证据见 `docs/TEST_REPORT.md`。

## 3. 已确认、不得反复重开讨论的产品决策

1. 最终目标是可售卖订阅的正式版，不把当前 alpha 或旧 0.0.1 便携包包装成正式版；
2. Windows 安装版、macOS 安装版和嵌入湖岸官网的 Web 版共用确定性检查契约；
3. Web 版采用服务端统一处理；生产实现必须有临时任务、加密、TTL、删除和零留存验证；
4. 三端统一使用湖岸橡树官网账号；访客仍可使用基础本地功能；
5. 订阅为有限 Free + Pro，具体价格尚未拍板；
6. 同步只允许检查结果和必要元数据，不同步稿件、正文、摘录、文件名、路径或哈希；登录用户必须明确选择是否同步；
7. 引用体例保留“默认”，由确定性映射自动选择，并在报告中说明；
8. 标准文件需要签名清单、下载校验、版本固定、回滚和升级提示；已有项目不得被静默换规则；
9. “接入用户自己的 AI”已确认六项设计：无 AI / 湖岸 AI / 我的 AI 三模式；支持云 API、自托管 OpenAI-compatible 服务和 Ollama/LM Studio；凭据永不同步且 Web 仅会话保存；AI 只给建议、绝不静默改稿；属于 Pro 且不消耗湖岸 AI 配额；失败时不静默回退。用户尚未明确批准把它写入 v2.0 方案或开始实现，当前不得擅自扩展范围；
10. 不进行 AI 语义改写，自动修复仍只限冻结白名单机械操作。

## 4. 已核实但尚未解决的缺口

- 打包版 Ace：alpha.11 已有受控 `utilityProcess`、主进程 Chrome controller、两阶段计划绑定和 ASAR 资源锚点；alpha.10 有真实源码 UI 运行证据。正式版仍缺真实打包制品上的联合验证、自带且校验过的浏览器运行时、OS 级默认拒绝网络、代码签名和正式人工许可审计；
- Windows：当前只有旧 0.0.1 便携 ZIP 的历史构建；alpha.11 尚无安装器或 ZIP，未做真实打包 fuse/ASAR 资源、packaged smoke、干净系统安装/升级/卸载或签名。受控下载/导入及构建尾部发布证据链已实现，但本轮未联网，三份固定归档、真实工具树和独立 tracked lock 尚缺；
- macOS：已有 x64/arm64 原生 runner、静态聚合和两架构 CPython `3.13.14` 固定策略，但缺对应 Electron/Python/JRE 实际资源；尚无 `.app` / DMG、签名、公证或真实硬件探针证据；
- Web：服务端任务 API、隔离执行、限额、零留存和官网嵌入尚未实现；
- 账号/订阅/同步：离线 Provider 状态机、Free/Pro/宽限、SyncRecord v1、逐字段预览和当前进程队列契约已实现；生产 Supabase、OS 凭据存储、签名授权、支付、持久队列、网络 transport 和网站后台未连接；
- 标准库：治理结构和引用解析政策已完成，13 项标准、35 条规则和 6 个 fixer 映射一致；但外部来源核验仍为 0 项（12 pending、1 unavailable），4 项外部标准仍为 `under_review`，reviewer 仅是角色占位，内容深度与真实人工签核仍不完整；
- 标准升级：本地验证、签名包导入/回滚骨架、项目固定与显式升级已编码；生产 trust pin、在线获取/下载、签名撤回分发与联网自动更新未实现；
- 正式发布仍缺隐私/条款最终文本、证书、生产密钥、人工内测、macOS 硬件和网站联调。

### Windows sale 门禁的 17 项明确阻断

以下 17 项来自**源码**资源门禁。alpha.11 的真实 packaged ASAR 锚点证据若成立，只关闭其中第 5、6、7、8、13 项，剩余 12 项不变；当前没有产品 `app.asar`，所以现场仍是 17 项。除此之外，真实打包二进制若仍暴露当前工具无法识别的 fuse，还会由独立验证器产生 `ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING` 并阻止 sale；两者不得混算。

以下机器码来自当前 `verify_packaged_resources.js` 与实测 sale 输出，不得合并或省略：

1. `FORMAL_LICENSE_AUDIT_REQUIRED`：Ace 18 个生成元数据通知包的原始许可证审计；
2. `PYTHON_RUNTIME_PROVENANCE_AUDIT_REQUIRED`；
3. `EPUBCHECK_PROVENANCE_AUDIT_REQUIRED`；
4. `JRE_SOURCE_PROVENANCE_AUDIT_REQUIRED`；
5. `EPUBCHECK_TRUST_ROOT_NOT_HARDENED`；
6. `JRE_TRUST_ROOT_NOT_HARDENED`；
7. `PYTHON_RUNTIME_TRUST_ROOT_NOT_HARDENED`；
8. `APP_RESOURCES_TRUST_ROOT_NOT_HARDENED`；
9. `ELECTRON_RUNTIME_PROVENANCE_AUDIT_REQUIRED`；
10. `BUILDER_TOOLCHAIN_PROVENANCE_AUDIT_REQUIRED`；
11. `BUILDER_TOOLCHAIN_TRUST_ROOT_NOT_HARDENED`；
12. `ACE_FULL_LICENSE_AUDIT_REQUIRED`：Ace 全部生产依赖闭包的正式人工审计；
13. `ACE_TRUST_ROOT_NOT_HARDENED`；
14. `ACE_CONTROLLED_HELPER_PENDING`；
15. `ACE_BROWSER_RUNTIME_PENDING`；
16. `ACE_OS_NETWORK_ISOLATION_PENDING`；
17. `WINDOWS_CODE_SIGNING_PENDING`。

## 5. 下一执行顺序

不要重新做宽泛规划，按 v2.0 方案继续：

1. 经用户联网授权后显式运行 `npm run download:builder:win`，仅从合同固定的 electron-builder 官方 GitHub release URL 下载三份归档到仓库 `out/downloads/windows-builder/`；
2. 下载器全部验哈希后运行 `node scripts/import_windows_builder_toolchain.js --archive-dir out/downloads/windows-builder --update-lock`，提交并复核真实独立 lock；
3. 生成 alpha.11 NSIS 安装器与 ZIP；构建链必须依次通过资源锚点、fuse 配置、真实打包二进制 fuse、打包资源门禁、应用身份断言、含 EpubCheck/Ace 的隐藏 packaged smoke，最后生成并复验 `SHA256SUMS.txt` 与 canonical release manifest；
4. 完成 Windows 代码签名，并逐项关闭 provenance、许可证、可信根、Ace helper/browser 等 sale blocker；
5. 经联网授权核验标准官方来源，配置生产 trust pin、在线包获取和签名撤回通道；任何新规则必须有反例、匿名样本、回归测试和真实审校签核；
6. 在 macOS 分别准备 x64/arm64 Electron、Python、JRE，构建后完成签名、公证、staple、Gatekeeper 和实机 smoke；
7. 在现有 Auth / License / Sync 离线契约上实现持久安全凭据/队列与独立网络 transport，再经授权连接 Supabase、支付和网站后台；
8. 实现服务端统一处理的 Web 作业 API、零留存和官网嵌入；完成 Free/Pro、支付、隐私、内测和正式发布门禁。

涉及联网、依赖下载、生产账号、证书、签名、发布、远端推送或网站写入时，必须先向用户取得明确授权。

## 6. 常用验证命令

```powershell
npm test
npm run test:node
npm run test:python
$env:OAK_TEST_ACE='1'; python scripts\run_tests.py
npm run verify:resource-trust
npm run verify:electron-runtime
npm run verify:fuses:config
npm run download:builder:win  # 仅在用户明确批准联网后
npm run smoke
npm run verify:resources:win
npm run build:win
npm run release:evidence:verify:win
git diff --check
```

CLI 的 P0 新契约：

```powershell
python -m oak_manuscript_core plan-fixes --project <项目目录>
python -m oak_manuscript_core fix --project <项目目录> --plan-id <计划ID>
python -m oak_manuscript_core plan-citation --project <项目目录> --citation default
python -m oak_manuscript_core check --project <项目目录> --citation default --citation-plan-id <引用计划ID>
python -m oak_manuscript_core list-checkpoints --project <项目目录>
python -m oak_manuscript_core restore-checkpoint --project <项目目录> --checkpoint-id <检查点ID>
python -m oak_manuscript_core project-standard-status --project <项目目录>
python -m oak_manuscript_core plan-rulepack-upgrade --project <项目目录> --to-manifest-sha256 <摘要>
python -m oak_manuscript_core upgrade-rulepack --project <项目目录> --to-manifest-sha256 <摘要> --plan-id <计划ID>
python -m oak_manuscript_core sync-source --project <项目目录> --event export
```

## 7. 交接纪律

- 动手前读 `AGENTS.md`、本文件、`docs/DEVELOPMENT_STATUS.md`、v2.0 方案、`docs/ACCEPTANCE.md` 和 `docs/TEST_REPORT.md`；
- 以实际文件和现场测试为准，历史文档只作追溯；
- 不修改真实原稿，不把真实作者内容放进仓库；
- 功能、测试、构建或分发状态变化后，同步更新交接、状态、测试、验收和变更记录；
- 不把计划项写成已完成事实，不把开发机成功等同于干净系统、macOS 或正式发布成功。
