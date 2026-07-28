# CHANGELOG — 湖岸稿件（Oak Manuscript）

记录仓库与规则包的版本变更。规则包版本独立于 APP 版本（见 `config/rule-packs/`）。

## [未发布]

### 2026-07-28 — 0.1.0-alpha.11（ChatGPT ASAR 资源信任根检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.11`。该标签只表示经本地验证的源码状态；当前没有 alpha.11 安装包、ZIP、签名或真实产品 `app.asar` 证据。

**资源信任根**

- 新增 canonical `app-resources-v1.json`，精确固定将作为 loose extraResources 分发的 Python 核心、配置、标准和样本；当前覆盖 58 个文件、1,873,018 字节；
- 新增随代码进入 `app.asar` 的 `resource-trust-anchor.json`，固定应用资源清单原始字节摘要及 win32-x64 的 Python、EpubCheck、JRE、Ace tracked lock 摘要；
- 打包资源门禁必须从真实 `app.asar` 读取锚点，拒绝 loose 伪锚点、资源增删改、锁替换、平台替换、链接/硬链接和读取身份漂移；
- 打包应用启动在标准存储与窗口创建前复核锚点和完整 loose 资源，失败即退出；显式 `--update-lock` 使用受控 tracked-file 事务替换并写后复验；
- 只有真实 packaged ASAR 证据存在时才关闭 5 个资源可信根 blocker。源码门禁仍保留 17 项，不能用构造 fixture 冒充产品制品。

**验证**

- `npm test` PASS：Node 301 total / 294 pass / 0 fail / 7 skip；Python 351 total / 0 failures / 0 errors / 3 skipped；墙钟 171.3 秒；
- `verify:resource-trust`、`verify:standards`、`stage:ace`、`verify:electron-runtime`、`verify:resources:win` 与 `verify:fuses:config` 全部 PASS；
- 真实 `app.asar` 构造集成测试证明 packaged 门禁可把 17 项缩至 12 项，并在 `app.asar` 缺失时失败关闭；该结果不是 alpha.11 安装包证据；
- alpha.11 独立隐藏源码 UI smoke PASS：`out/source-smoke/runs/ms4eowx9-64e0aab5311e2a99/projects/`；DOCX/EPUB 各 4 次检查、1 个修复批次、3 个检查点，应用 fixes 5/2，PDF 251,654/178,235 字节，原稿哈希不变；EPUB 实得 EpubCheck 5 error 与 Ace 8 项失败断言；
- 本轮未联网、未构建、未签名；上述 smoke 是源码 UI 证据，不是 alpha.11 安装包证据。

### 2026-07-28 — 0.1.0-alpha.10（ChatGPT Ace 受控 utilityProcess 与 RunAsNode 关闭检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.10`。该标签只表示经本地验证的源码状态；当前没有 alpha.10 安装包、ZIP 或真实打包二进制证据。

**受控外部验证**

- Renderer 只提交项目路径；主进程生成绑定项目/working/标准与 Java、JAR、Ace、Chrome 文件身份的计划，prepare 清理安全输出后才运行固定 helper，finalize 重验同一计划并解析报告；
- Ace 迁移到 Electron `utilityProcess`，固定入口/参数、净化环境、64 KiB 输出上限和 5 分钟超时；目录换入、工具替换、状态漂移、异常退出或非法报告均 fail-closed；
- 主进程新增受控 Chrome controller：固定隐藏参数、独立 profile、随机 loopback DevTools 端点、精确子进程停止和清理；Ace utility 只连接这个本地端点；
- Electron Fuse 将 `RunAsNode` 从临时 `true` 改为 `false`。Electron 43 未知索引 8 仍按 alpha blocker / sale fail-closed，不猜测语义。

**验证**

- `npm test` PASS：Node 295 total / 288 pass / 0 fail / 7 skip；Python 351 total / 0 failures / 0 errors / 3 skipped；
- 标准、Ace stage、Electron runtime、Windows alpha 资源和 Fuse 配置门禁全部 PASS；17 项 sale blocker 未减少；
- 隐藏条件源码 smoke PASS：`out/source-smoke/runs/ms4cz6o9-c2ad021ca7e2e83c/projects/`；DOCX/EPUB 各 4 次检查、1 次修复、3 个检查点，问题 13/5、应用 fixes 5/2、PDF 251,649/178,228 字节，原稿哈希不变；
- EPUB 缺陷样本真实得到 EpubCheck 5 error 和 Ace 8 项失败断言，结束后无 Chrome profile 残留；
- 发布证据与 packaged fuse 门禁按设计拒绝缺失 alpha.10 制品。本轮未联网、未下载 builder、未构建或签名。

### 2026-07-28 — 0.1.0-alpha.9（ChatGPT Electron ASAR 与 fuse 发布硬化检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.9`。该标签只表示经本地验证的源码状态；当前没有 alpha.9 安装包、ZIP 或真实打包二进制 fuse 证据。

**打包硬化合同**

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.9`；标准 release、规则、fixer、账号和同步契约未变化；
- 新增 `electron_fuse_policy.js`，明确要求 `asar=true`、禁止关闭 ASAR integrity，并固定 8 个已知 Electron fuse 与 `ResetAdHocDarwinSignature`；配置缺项、多项、漂移、inherit 或 removed 均 fail-closed；
- Windows/macOS 构建在 electron-builder 前验证配置，在 builder 后立即读取真实应用二进制的 fuse wire，再进入打包资源门禁、packaged smoke 和发布证据阶段；
- 二进制验证拒绝仓库外路径、不安全父链、链接、硬链接、空文件和读取竞态；已知 fuse 必须逐项精确匹配；
- 本机 Electron 43.1.0 暴露 9 个 wire 项，而当前 `@electron/fuses` 1.8.0 只定义前 8 项。未知索引 8 不猜测：alpha 返回 `ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING`，sale 直接失败；
- `RunAsNode=true` 仅为现有 Ace helper 的临时兼容状态，受控 helper 完成并实测后必须改为 `false`，不能作为可售卖配置。

**验证与边界**

- fuse 专项 **6/6 PASS**；配置门禁、已知 wire、未知项 alpha/sale 分流、文件身份与构建顺序均有正反向覆盖；
- 最终 `npm test` PASS：Node 284/277/0/7（2.350 秒），Python 348/0/0/3（114.170 秒），墙钟 121.2 秒；
- 标准、Electron runtime、Windows alpha 资源门禁通过；既有 Windows sale 资源门禁仍有 17 项 blocker，未知打包 fuse 是独立的条件阻断；
- alpha.9 隐藏源码 smoke PASS：`out/source-smoke/runs/ms49yas5-9ccb167e78f033a2/projects/`；DOCX/EPUB 各 4 次检查、1 次修复、3 个检查点且原稿哈希不变，PDF 251,650 / 177,417 字节；
- 本轮没有联网、没有下载 builder 归档、没有运行真实 packaged fuse 验证，也没有生成 NSIS、ZIP、SHA 文件或 release manifest。

### 2026-07-28 — 0.1.0-alpha.8（ChatGPT 统一账号与 SyncRecord v1 离线契约检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.8`。该标签只表示经本地验证的源码状态；生产账号、同步服务、安装包和可售卖发行版均不存在。

**账号、权益与同步边界**

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.8`；标准 release、35 条规则和 6 个白名单机械 fixer 未变化；
- AuthProvider 固定系统浏览器 PKCE 生产模式并实现可测试的登录/退出/过期/撤销状态；生产未配置时不打开页面、不联网；
- LicenseProvider 固化 Free/Pro 能力矩阵和有效期/宽限期状态计算；模拟授权不冒充签名证据，过期不锁本地项目或既有导出；
- 新增 Python 只读 `sync-source`、Electron `SyncRecord v1` exact validator 和 tracked JSON Schema；正文、标题、摘要、预览、文件名、路径、参考文献原文、哈希和内容指纹均无允许字段并有反向测试；
- 新增同步 IPC/preload：Renderer 只能请求可信项目来源并提交固定选择/队列 ID，不能拼装 payload、持有令牌或发起网络；
- 导出后仅在 authenticated 状态非阻断打开逐字段预览；四种选择为仅本次、同步本次以后仍询问、暂不同步、不再询问此项目；
- 当前进程内队列支持幂等、取消、重试和删除，状态固定为 `pending_transport`；生产 transport、持久队列、Supabase、支付和网站后台仍未实现。

**验证与边界**

- 账号/同步专项、IPC、UI、Python 核心来源和 JSON Schema 一致性测试通过；最终统一测试计数见 `docs/TEST_REPORT.md`；
- 标准、Electron runtime 和 Windows alpha 资源门禁通过；Windows sale 门禁仍保留 17 项 blocker，macOS 静态门禁仍拒绝缺失双架构资源；
- alpha.8 沙箱外隐藏源码 smoke PASS：`out/source-smoke/runs/ms48q9hr-05f6b99b193cf33d/projects/`；DOCX/EPUB 各 4 次检查、1 次修复、3 个检查点且原稿哈希不变，PDF 251,660 / 177,267 字节；
- 本轮没有联网、没有下载 builder 归档、没有生产账号/同步请求，也没有 alpha.8 NSIS、ZIP、SHA 文件或 release manifest。

### 2026-07-28 — 0.1.0-alpha.7（ChatGPT Windows 发布制品证据链检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.7`。该标签只表示经本地验证的源码状态；当前没有 alpha.7 安装包、ZIP 或可售卖发行版。

**发布制品证据链**

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.7`；标准 release 与规则能力均未变化；
- 新增 `release_artifact_manifest.js`，只接受当前 `package.json` / lockfile 一致版本的精确 Windows x64 NSIS 与 ZIP 文件名，拒绝缺失、格式错误、同系列旧制品、链接/硬链接、路径逃逸和读取期间身份变化；
- `SHA256SUMS.txt` 以固定顺序记录两件制品的完整 SHA-256；canonical `release-manifest-win32-x64.json` 同时固定产品/appId/版本/目标、种类、字节数、制品摘要与 SHA 文件原始字节摘要；验证器重新读取制品并交叉复核全部字段；
- 两份证据以独占候选、`fsync` 和联合提交生成；第二次换入或最终复验失败会恢复两份旧证据。构建开头先预检并清除旧证据，只有 packaged 资源门禁与隐藏 smoke 成功后才生成新证据；
- 新增显式 `release:evidence:clear:win`、`release:evidence:win` 和 `release:evidence:verify:win` 命令；真实 `release/` 因缺 alpha.7 NSIS 而按预期 fail-closed。

**验证与边界**

- 发布证据专项 6 项：5 通过、0 失败、1 项因 Windows 文件 symlink 权限条件跳过；统一 `npm test` 为 Node 267/260/0/7（2.487 秒）、Python 344/0/0/3（80.833 秒），墙钟 88.1 秒；
- 标准、Electron runtime 与 Windows alpha 资源门禁均 PASS；Windows sale 门禁仍有 17 项 blocker，macOS 静态门禁仍精确拒绝两架构缺失资源；
- alpha.7 独立隐藏源码 smoke PASS：`out/source-smoke/runs/ms47c3l8-9b6bf78452308a33/projects/`；DOCX/EPUB 均 4 次检查、1 次修复、3 个检查点且原稿哈希不变，PDF 251,656 / 177,263 字节；
- 本轮没有联网、没有下载 builder 归档、没有真实工具树/tracked lock，也没有生成 NSIS、ZIP、SHA 文件或 release manifest。

### 2026-07-28 — 0.1.0-alpha.6（ChatGPT Windows builder 受控下载检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.6`。该标签只表示经本地验证的源码状态，不表示已经下载真实构建工具、生成安装包或正式发行。

**受控归档取得**

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.6`；标准 release 保持 `oak-standards 2.0.0` / `oak-rules 2.0.0`；
- 三份 builder 来源合同新增固定 electron-builder 官方 GitHub release URL；只允许 HTTPS、固定仓库路径/文件名及 GitHub release asset 主机重定向；
- 新增 `npm run download:builder:win` 显式联网入口；CLI 缺少 `--allow-network` 时在创建目录或请求前失败，普通 build/test/dist 不调用下载器；
- 下载候选限定在仓库内，采用独占创建、容量/超时/重定向上限和 `fsync`；三份候选全部验 SHA-256 后才事务提交，已有正确文件复用，错误文件、未知条目、链接、路径逃逸或并发碰撞均 fail-closed，不覆盖既有文件；
- 新增 11 项下载器测试，覆盖无授权零写入、URL/redirect 边界、错误哈希零落盘、提交回滚和目录安全。

**验证与边界**

- 最终 `npm test`：PASS；Node 261/255/0/6（2.627 秒），Python 344/0 failures/0 errors/3 skipped（89.446 秒），墙钟 97.2 秒；
- `verify:standards`、`verify:electron-runtime`、Windows alpha 资源门禁均 PASS；macOS 静态门禁仍按预期失败，Windows sale 门禁仍有 17 项 blocker；
- 独立隐藏 Electron 源码 smoke PASS：`out/source-smoke/runs/ms46fhdh-230a41fd46481179/projects/`；DOCX/EPUB 均完成 4 次检查、1 次批量修复、3 个检查点并保持原稿哈希，PDF 251,661 / 177,434 字节；
- 本轮未获联网授权，未发出网络请求、未下载三份真实归档，未生成工具树、tracked lock、NSIS、ZIP 或任何可分发制品。

### 2026-07-27 — 0.1.0-alpha.5（ChatGPT 默认引用解析与标准包 2.0.0 检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.5`。该标签只表示经本地验证的源码状态，不表示已经生成安装包或正式发行。

**默认引用体例解析**

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.5`；内置标准 release 升级为 `oak-standards 2.0.0` / `oak-rules 2.0.0`（sequence 2），35 条规则和 6 个机械 fixer 的能力范围不变；
- 新增纯本地、确定性的引用结构信号解析器，根据编号引用、作者—年份、注释—书目和语言证据选择 GB/T 7714—2025、APA 7、Chicago 18 注释—书目或作者—日期；强/中阈值固定为 3/2 个唯一信号与 80%/50% 覆盖率；
- 结构冲突、证据不足或 EPUB 只能部分提取时不强行套用体例，退回 `structure_only`；报告记录模式、原因、置信度、解析器版本和纯数量证据，不保存稿件片段、姓名、引用原文或本地路径；
- 新增严格只读的 `plan-citation`、绑定项目/工作稿/规则包/解析结果的 `citation-plan-*` 计划，以及 `check --citation-plan-id`。Renderer 会在检查前集中展示解析体例、理由、置信度和实际规则范围，用户一次确认后才检查；
- 六个用户选项保持为 `default | gbt7714-2025 | apa-7 | chicago-18-nb | chicago-18-ad | none`；显式选择原样保留，默认解析在标准包升级后重算。

**标准身份、迁移与界面上下文**

- 2.0.0 canonical manifest SHA-256 为 `0aff75eb181a62869147e9af27330c717bc808bdd23865197534fc9868568427`，规则包为 `098b382e33c06ccddf154940fbbd51db384d8025cf235ed7f7e10e83d34897a4`，能力集为 `af67d0aaf2ece431ec1b617934bdfa3627b6be1b1301a92fcf3b2b2f29ca232e`；rollback target 精确指向 1.0.0 manifest `d33534f0…d7af`；
- 旧项目迁移依赖本地 CAS 中仍保留且通过验证的历史 release；如旧 release 缺失则 fail-closed，不把最新包冒充历史身份；
- `citation_resolution` 作为向后兼容字段写入项目设置、检查快照、机器报告和导出摘要；旧 1.0 项目可缺失该字段，但新检查结果必须相互一致；
- 切换稿件或项目目录时清空上一项目的会话、引用计划与结果状态，修复第二份稿件误复用前一项目的真实 UI 缺陷。

**验证与界限**

- Node 分项回归：250 项、244 通过、0 失败、6 条件跳过、2.650 秒；Python：344 项、0 失败、0 错误、3 条件跳过、80.191 秒；
- `verify:standards`、`verify:electron-runtime` 与 Windows alpha 资源门禁 PASS；Windows sale 门禁仍以 17 项 blocker 失败，macOS 静态门禁仍因双架构 Electron/Python/JRE 资源缺失失败；
- 隐藏 Electron 源码 smoke PASS，运行根 `out/source-smoke/runs/ms44nzhb-8186d1b3c5148eba/projects/`；DOCX/EPUB 均完成引用计划确认、4 次检查、原稿哈希复验、批量修复/恢复/导出/PDF 闭环；PDF 分别为 251,646 / 177,416 字节；
- 本轮未联网，未生成 alpha.5 NSIS、ZIP 或 macOS 制品，未运行 packaged smoke、干净系统、签名、公证或可售卖验收。

### 2026-07-27 — 0.1.0-alpha.4（ChatGPT Electron 与 builder 构建输入可信链检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.4`。该标签只表示经测试的源码状态，不表示已经生成安装包或正式发行。

**Electron 运行时固定锁**

- 将 APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.4`；规则包与标准内容不变，仍为 `oak-rules 1.0.0`、release sequence 1；
- 新增 `config/tool-manifests/electron-43.1.0-win32-x64.json` 与只读默认验证器，固定 2 个目录、75 个文件、364,083,658 字节；manifest SHA-256 为 `ae67132b95e21b62450fd0e34faaf00164514b38322076c56e37c0301c520d95`；
- tracked manifest 使用严格 JSON 拒绝重复键、以 exact schema 拒绝未知字段，并要求生成器定义的唯一 canonical UTF-8/LF 原始字节；
- `electronDist` 在把本地 Electron 交给 electron-builder 前强制验证 package-lock、完整目录/文件树、大小和 SHA-256；缺失、多出、篡改、硬链接、Node 可识别的 symlink/junction/reparse 或路径逃逸均拒绝，并返回不存在的 sentinel，禁止下载回退；
- 显式 `--update-lock` 先验证安全父链并拒绝目标 symlink/hardlink，再以独占候选文件、`fsync`、原子替换和换入后复验更新；任何失败恢复旧字节，回滚自身失败则明确报错并保留事务证据；
- 源码与打包资源门禁都重新核对仓库源码构建输入，不信任可写 packaged resources 自报；因此仅关闭 `ELECTRON_RUNTIME_TRUST_ROOT_NOT_HARDENED`，官方来源/再分发审计和签名阻断继续保留。

**Windows builder 安全导入合同**

- 固定 `nsis-3.0.4.1.7z`、`nsis-resources-3.4.1.7z`、`winCodeSign-2.6.0.7z` 的名称与 SHA-256，新增显式、一次性的离线安全导入器；普通 build/test 不会调用、下载或自动刷新它；
- 导入器固定本地 7z 可执行文件和 DLL，解压前后拒绝路径逃逸、Windows 保留名、冲突路径、链接、备用流、加密/反条目、异常容量、硬链接及清单漂移；UNC/device 归档目录在任何读取前拒绝；
- 工具树 `manifest.json` 与 `config/tool-manifests/electron-builder-win32-x64.json` 独立 tracked lock 交叉绑定来源归档、原始 manifest 字节和完整文件树。只有显式 `--update-lock` 才能写入 tracked lock；工具树和 lock 作为同一事务换入；
- 修复安全审计发现的两项 P1：不安全祖先路径在读取前立即终止；旧工具树和旧 lock 在任何 rename 前执行父链、realpath、单链接及全树检查。四个前向 rename 与四个回滚 rename 均有故障注入；前向失败完整恢复，回滚自身失败明确报错并保留恢复证据。

**验证与边界**

- 最终 `npm test` 统一回归：Node 239 项、233 通过、0 失败、6 条件跳过、2.606 秒；Python 312 项、0 失败、0 错误、3 跳过、80.125 秒；
- Electron runtime 锁专项为 37 项、36 通过、0 失败、1 条件跳过；hardlink 与 junction 反向路径在本机实测通过，文件 symlink 因 Windows `EPERM` 条件跳过，不计作通过；
- 沙箱外隐藏 Chrome 真实 Ace：312 项、0 失败、0 错误、1 跳过、44.807 秒；受限沙箱无法产生安全报告时按设计失败，不能冒充通过；
- 隐藏 Electron 源码 smoke PASS，输出为 `out/source-smoke/runs/ms37h0mu-201a90896825d190/projects/`；DOCX/EPUB 均保持原稿哈希、各含 4 次检查，PDF 分别为 258,404 / 161,836 字节；
- `verify:standards`、`verify:electron-runtime` 与 Windows alpha 资源门禁 PASS；sale 门禁仍按设计以 17 项 blocker 失败；macOS 静态门禁仍因两架构 Electron/Python/JRE 资源缺失失败；
- 本机没有三份真实 builder 归档，因此没有生成工具树、独立 tracked lock、NSIS 或 ZIP；builder 包装器在 electron-builder 启动前 fail-closed。全程未联网，也未运行 packaged smoke、干净系统或签名验收。

### 2026-07-27 — 0.1.0-alpha.3（ChatGPT 标准可信链与项目升级检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.3`。该标签只表示经测试的源码状态，不表示已经生成安装包或正式发行。

**标准资产与可信存储**

- 将 APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.3`；规则包仍独立保持 `oak-rules 1.0.0`、release sequence 1；
- 将标准注册表升级为 schema 2.0，补充生命周期、发布者、审核角色、版权使用、替代关系、规则反向关联、来源核验状态与变更历史，删除书稿/EPUB 占位摘要；
- 新增 35 规则/6 fixer 精确能力清单和 canonical standard release manifest；manifest SHA-256 为 `d33534f081b2122a90652ee03304a0e71177a7fd0d3130fffe77b0fea807d7af`，规则包 SHA-256 为 `7ac5a5bdb126e9f5148a040ce42a634b1a95295c27d7a72c774db54bf7129542`；
- 新增严格 JSON/payload 校验、Ed25519 门槛签名、内容寻址存储、release sequence 高水位、撤回/过期/兼容性、签署 rollback target 与内置 release 对账；重复键、非配对 surrogate、路径/URL/日期歧义、未知字段、能力漂移和同序列异身份均 fail-closed；
- 标准根操作进程内串行；跨进程事务使用原子 pending 目录、PID 与随机 process token。活 owner 不抢占，死 owner 仅按严格 intent 恢复，未知变更拒绝猜测；
- `StandardsProvider` 支持离线内置启动、本地签名包预览/安装和全局回滚。生产 trust digest 尚未配置，因此真实本地签名包导入默认禁用；在线检查/下载和生产撤回通道尚未实现。

**项目固定版本与显式升级**

- 项目规则包 pin 扩为七字段 `name/version/pinned/sha256/bundle_id/release_sequence/manifest_sha256`；已有项目先用一次只读、未绑定的 `project-standard-status` 发现 pin，Electron 精确验证对应 release 后，所有实际业务/变更命令均携带 canonical 期望身份，Python 再重验 manifest/payload/CAS；
- 新增 `project-standard-status`、`plan-rulepack-upgrade`、`upgrade-rulepack`。计划绑定项目 manifest/state、source/working、issues、最新检查与目标身份；过期、异项目或横向替换计划拒绝；
- 升级建立检查点、哈希归档旧 issues、原子提交新 pin、记录连续 history，并设置强制重检；全局 active 改变不会静默改变旧项目；
- Renderer 标准页显示项目 pin 与当前 active 的完整差异，只允许一次确认；目标 digest 由主进程选择。升级后清除陈旧状态并自动重检；
- `app:info`、项目、检查记录和导出 `report.json` 的完整身份加入 smoke；源码/打包 smoke 按 `out/*-smoke/runs/<run-id>/` 隔离 userData、标准 store 和项目，防止旧状态污染。
- 修复迁移源错误放宽能力映射的漏洞：迁移仅可放宽撤回、过期与 APP 兼容性，规则 capability digest 和逐规则 milestone/fixer 映射始终强制校验；
- `Project.verify()` 现在逐份解析历史检查报告，校验 UTF-8 JSON 对象、schema、check ID 与各自检查记录的规则包身份；alpha.3 严格核对七字段，alpha.2 及更早记录仅按其真实 `{name, version}` 证据兼容，不把当前 pin 倒填成历史身份。

**验证与边界**

- 原生/沙箱外 `npm test` PASS：Node 186 项、181 通过、0 失败、5 条件跳过；Python 312 项、0 失败、0 错误、3 条件跳过；
- 沙箱外隐藏 Chrome 的真实 Ace 条件套件：312 项、0 失败、0 错误、1 跳过、46.321 秒；受限运行器无法生成安全报告时按设计 `not_run`；隐藏 Electron 源码 smoke PASS，DOCX/EPUB 当前四方身份一致，PDF 为 258,400 / 161,845 字节；
- `verify:standards` 和 Windows alpha 资源门禁 PASS；sale 门禁仍按设计保留 18 项 blocker；macOS 静态门禁仍因两架构资源缺失失败；
- `build:win` 完成 JRE/Ace staging 与资源探针后，仅因仓库缺 `tools/electron-builder/win32-x64` 停止；未联网、未生成 alpha.3 NSIS/ZIP，未运行打包 smoke、干净系统或签名验收；
- 标准内容仍非完整：外部来源核验 0 项（12 pending、1 unavailable），4 项外部标准 under_review，真实编辑签核、默认体例结构信号、生产 trust pin 和联网更新均待完成。

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
