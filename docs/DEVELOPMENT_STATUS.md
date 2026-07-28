# DEVELOPMENT_STATUS — 开发状态（唯一状态来源）

> 最近更新：2026-07-28。最新在上；“已完成”必须有本地测试或构建证据。

## 当前版本与基线

- 当前版本：`0.1.0-alpha.23`
- 当前分支：`chatgpt/commercial-v1`
- 本地检查点标签：`chatgpt-v0.1.0-alpha.23`；已有未签名 Windows x64 NSIS/ZIP 与真实 packaged 证据，不代表正式发行
- 商业版权威方案：`docs/湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md`
- 只读 Claude 基线：0.0.1，提交 `16736147ed734a3be3535d43152719cf4b97a07e`，标签 `claude-0.0.1-baseline`
- 当前内置标准为 `oak-standards 2.0.0` / `oak-rules 2.0.0`（release sequence 2）：35 条规则、6 个白名单机械 fixer；alpha.5 新增默认引用解析政策，alpha.6—alpha.23 未改变标准内容或自动修复白名单。

## 商业正式版路线状态

| 工作流 | 状态 | 现场事实 |
|---|---|---|
| P0：集中预览与一次批量确认 | **完成（代码与测试）** | `plan-fixes` 只读；`fix` 强制 `plan_id`；全部离散修改可见；取消零写入 |
| P0：事务批量修复 | **完成（正常异常模型）** | working / issues / project 失败回滚；已有 5 个检查点时恢复被裁剪目录 |
| P0：检查点列表、撤销与恢复 | **完成（代码与测试）** | 完整状态快照；恢复前安全点；损坏项 UI 禁用；恢复失败项目树不变 |
| P0：默认引用体例与确认 | **完成（代码、迁移与 UI）** | 本地结构信号解析；证据不足退回 `structure_only`；`plan-citation` 只读并要求 `citation_plan_id` 确认；项目/报告记录原因、置信度与解析器版本 |
| P0：Node + Python 统一测试 | **完成（最新统一回归通过）** | alpha.23 最终计数见下方“最新测试基线”；0 失败 |
| P0：真实桌面 UI 冒烟 | **完成（alpha.23 source + packaged 双启动 PASS）** | 保持 Electron sandbox，在外层隐藏进程完成 DOCX + EPUB 全闭环、EpubCheck/Ace、加密队列写入及第二进程恢复；原稿哈希不变 |
| P0：文档与测试基线纠错 | **完成** | 权威改为 v2.0；纠正“185 + Ace = 186”错误 |
| Windows alpha 运行资源 | **完成（源码资源门禁）** | Python/JRE/EpubCheck/Ace 均有全量哈希/锁；Python 与 EpubCheck 双向探针实际执行并通过 |
| CPython 3.13.14 来源证据 | **机器验证完成，人工签署待办** | 官方 ZIP/Sigstore/SPDX、34 文件树、33 个原字节文件、1 个受控 `_pth` 追加与 PSF 许可保留已绑定；完整 Sigstore/GPG 与具名法律/再分发签署未完成 |
| EpubCheck 5.3.0 来源证据 | **机器验证完成，人工签署待办** | 官方 ZIP、GitHub 服务端 SHA-256 与本地 49/49 原字节文件已绑定；官网 MIT 与随包/仓库 BSD-3-Clause 矛盾、tag/ZIP 绑定及第三方义务待具名审阅 |
| Temurin 21.0.11 / JRE 来源证据 | **机器验证完成，人工签署待办** | 官方 ZIP/digest/checksum/build metadata、490/490 源 JDK、本机 JDK、207 文件 jlink runtime 和 94 份原字节许可材料已绑定；OpenPGP 未验签，许可/商标/源码提供与再分发签署待办 |
| Electron 43.1.0 来源证据 | **机器验证完成，人工签署待办** | 官方 GitHub release/ZIP/SHASUMS256、npm checksums 与本地 75/75 文件已绑定；release 未提供 detached signature，许可、Chromium 第三方通知、商标与再分发待具名签核 |
| Windows builder 来源证据 | **机器验证完成，人工签署待办** | 三份官方归档、GitHub release API、`app-builder-lib 26.15.3` 固定选择逻辑与 385/385 重组树已绑定；旧 release 无 digest/签名，部分所选载荷无具名许可证文件 |
| Ace 正式发布条件 | **部分完成** | tracked full lock、受控 `utilityProcess`、loopback Chrome、两阶段计划及真实 packaged 好/坏结果已验证；自带浏览器、OS 网络隔离、签名绑定证据及全闭包人工审计未完成 |
| Windows NSIS / ZIP | **完成（未签名 alpha）** | 三归档验哈希导入；builder 独立全树锁成立；alpha.23 NSIS/ZIP 已生成并复验 |
| Windows 发布制品证据 | **完成（alpha.23）** | SHA256SUMS + canonical manifest 与真实 NSIS/ZIP 交叉复验通过 |
| Windows 安装生命周期 | **工具/alpha.23 预检完成，真实运行待授权** | 九阶段编排、证据 v1、HKCU/快捷方式探针和专项测试完成；alpha.23/alpha.12 安装器只读预检通过；未执行真实安装、升级、回装探测或卸载 |
| Electron ASAR / fuse 硬化 | **真实制品 9 项全验** | `@electron/fuses 2.1.3` 识别 `WasmTrapHandlers`；afterPack 严格写入全部 9 项并回读；真实 EXE 无未知 fuse |
| ASAR 资源信任根 | **真实 packaged 验证完成** | ASAR 锚点固定 78 个应用 loose 文件及四份平台锁；启动前全树复核；真实 packaged 关闭 5 个 loose 可信根 blocker |
| 发行商/销售主体元数据 | **源码/生产 ASAR 契约完成，真实身份待确认** | 已知产品/品牌/appId/官网固定；packaged 门禁读取真实 `app.asar/package.json` 的 `oakReleaseIdentity`；法定主体、链接、版权、签名主体和具名复核待定，sale fail-closed |
| Windows sale 门禁 | **未通过（如实阻断）** | 源码/packaged 资源门禁为 17/12 项；新增发行身份 blocker；签名、来源/许可审计、自带浏览器与 OS 隔离未完成 |
| macOS arm64/x64 安装版 | **基础设施完成，发行未完成** | 已拆原生 x64/arm64 runner；静态聚合不执行探针；缺 Electron/Python/JRE、`.app`/DMG、签名、公证和真实硬件证据 |
| 标准包本地验证、升级与回滚 | **完成（代码与测试）** | 内置 2.0.0；canonical manifest、签名/CAS/高水位/回滚、项目七字段 pin、差异确认、升级后强制重检均已实现；旧 release 缺失时 fail-closed；生产 trust pin 与联网传输未实现 |
| 标准与规则补全 | **治理结构完成，内容补全未完成** | 13 标准/35 规则/6 fixer 映射一致；外部来源核验 0 项，4 项仍 under_review，真实审校签核与多类标准深度不足 |
| 湖岸统一账号 / Free+Pro / 结果同步 | **加密本地队列完成，生产联调未开始** | PKCE 状态、Free/Pro/宽限、SyncRecord v1、逐字段四选一预览、按账户隔离的 safeStorage 加密队列及重启恢复已实现；无生产 Supabase/凭据/支付、网络 transport 或网站后台 |
| Web 服务端统一处理 | **同源 handler 边界完成，生产未开始** | exact 作业/错误/审计 schema、状态机、HTTPS/Origin/CSRF、上传前门禁和六个公开动作已实现；真实监听器/反向代理、生产会话、对象存储/容器、恶意文件门禁、计费与网站嵌入待实现 |
| 可售卖正式版发布 | **未达到** | 缺跨端产物、生产账号/支付、条款、签名、公证、内测和网站联调 |

## 最新测试基线

- 最终统一 `npm test`：**PASS，退出码 0，墙钟 110.2 秒**；Node 406/399/0/7（3.532 秒），Python 351/0 failures/0 errors/3 skipped（102.040 秒）。跳过项不计作通过。
- 发行身份专项纳入 Node 全量：当前仓库身份结构有效但 `complete=false`，12 个 Windows 完备性字段显式缺失；源码 `build.appId`、生产 `oakReleaseIdentity`、重复键、字段/顺序/schema/canonical 字节、占位文本、非官方 URL 和 package 漂移均 fail-closed。
- ASAR/资源信任专项已纳入 Node 全量：packaged 身份从真实 `app.asar/package.json` 读取；raw header、精确短读循环、同路径重建、loose 源码伪造、ASAR 内身份漂移、源码清单/锚点、四类运行资源和启动顺序均通过。`verify:resource-trust` PASS，78 文件 / 2,124,858 字节，应用清单 SHA-256 `0105de22837471dcf3ccd35749119b8bcefe6b3764e6068f6e9032342b449241`，锚点 SHA-256 `6826bcf221d1a0677ca1c11147326819d941cfac0b2c1fc07d4dbdabc3548d3c`。
- CPython provenance 专项已纳入 Node 全量：tracked evidence、exact schema/canonical 字节、官方制品摘要、Sigstore leaf、SPDX、34/33/1 推导、证据/运行时清单绑定、真实 `python.exe` 漂移和原子更新故障均通过；证据保持 `machine_status=verified`、`human_review_status=pending`。
- EpubCheck provenance 专项已纳入 Node 全量：官方 ZIP/服务端 digest、本地 49/49 原字节文件、exact schema/canonical 字节、证据/分发/JRE/资源锚点绑定、自批准与漂移拒绝均通过；证据保持 `machine_status=verified`、`human_review_status=pending`、`license_signal_consistent=false`。
- Temurin/JRE provenance 专项已纳入 Node 全量：官方 ZIP/API/digest/checksum/build metadata、490/490 JDK 文件树、本机源 JDK、固定 jlink、207 文件 runtime、94 份许可材料、证据/锁/ASAR 绑定、自批准和漂移拒绝均通过；GPG 状态保持 `not_verified_no_openpgp_tool`，人工状态保持 pending。
- Electron provenance 专项已纳入 Node 全量：官方 ZIP/GitHub server digest/SHASUMS256/npm checksums、75/75 文件树、证据/runtime lock/ASAR 绑定、自批准和漂移拒绝均通过；证据 SHA-256 `5f850b7a…075`，签名状态保持 `not_provided_as_release_asset`，人工状态 pending。
- Windows builder provenance 专项已纳入 Node 全量：三份官方归档/API、固定选择逻辑、受控重解压重组和 385/385 工具树、证据/tool manifest/lock 绑定及反向路径均通过；证据 SHA-256 `c1651839…bb5`，旧 release digest 状态保持 unavailable，人工状态 pending。
- Ace utility/Chrome controller、两阶段外部验证、Fuse 与相关路径反向测试均纳入上述全量回归；afterPack 专项覆盖全 9 项严格写入、API 漂移、macOS arm64 临时签名和路径逃逸；真实 EXE 回读 `fully_known=true`、`unknown_fuses=[]`。
- 账号/同步专项：Auth 状态机、Free/Pro 与离线宽限、SyncRecord/持久状态 exact schema、登录/明确确认门禁、按账户隔离、safeStorage 加密、原子提交/revision、重启恢复、幂等/取消/重试/删除、可信核心来源、IPC/preload 和 UI 均通过；未使用网络或生产服务。
- Web HTTP/作业状态机专项：**36/36 通过**；覆盖五份 exact schema、HTTPS/同源/会话/CSRF、重复头与非反射错误、上传前大小/MIME/并发预留、预留释放/并发接收拒绝、六个公开动作、主体隔离、TTL、取消/删除、部分删除失败与无内容审计。handler 未监听端口，未使用生产会话或存储。
- 发布证据专项：**6 项，5 通过、0 失败、1 条件跳过**；覆盖确定性输出、交叉摘要、坏格式/旧制品/版本漂移、链接/硬链接、篡改、联合提交回滚和安全清除预检。
- downloader 专项：**11/11 通过**；覆盖显式联网授权、固定来源、重定向/容量/哈希门禁、零授权零写入、事务落盘/回滚及路径安全。
- Electron runtime 锁专项：**37 项、36 通过、0 失败、1 条件跳过**；hardlink 与 junction 反向路径本机实测通过，文件 symlink 因 Windows `EPERM` 条件跳过，不计作通过。
- alpha.23 source 与 packaged smoke 均强制应用内外部验证和第二进程队列恢复，不依赖调用者设置环境变量；缺陷 EPUB 的 EpubCheck/Ace 均产生可解析失败结果。保持 Electron sandbox，在获准外层隐藏进程取得 PASS，未使用 `--no-sandbox` 作为证据。
- `npm run verify:standards`：**PASS**；2.0.0 manifest SHA-256 `0aff75eb181a62869147e9af27330c717bc808bdd23865197534fc9868568427`，规则包 SHA-256 `098b382e33c06ccddf154940fbbd51db384d8025cf235ed7f7e10e83d34897a4`，能力集 SHA-256 `af67d0aaf2ece431ec1b617934bdfa3627b6be1b1301a92fcf3b2b2f29ca232e`。
- `npm run verify:electron-runtime`：**PASS**；Electron 43.1.0 win32-x64 固定锁覆盖 2 个目录、75 个文件、364,083,658 字节，manifest SHA-256 为 `f5c2c915633c1917bc37377f8232bde4259588eb138bc4072a3c7df976e27486`；tracked manifest 使用严格 JSON、exact schema 和 canonical UTF-8/LF 原始字节，并绑定 Electron provenance。
- 外层隐藏 `npm run smoke:packaged:win`：**SMOKE-RESULT + SYNC-RECOVERY PASS**；最终输出 `out/packaged-smoke/runs/ms536bic-c319680eda532edb/projects/`。两个项目均为 `app_version=0.1.0-alpha.23`、`source_hash_ok=true`、4 次检查、1 个修复批次、3 个检查点；当前问题 13/5、应用 issue fixes 5/2、PDF 251,651/178,236 字节；EPUB EpubCheck 为 5 error，Ace 为 8 项失败断言。加密队列 1,960 字节，第二进程恢复通过。最终 `npm run smoke` 另在 `out/source-smoke/runs/ms53795z-b2585a5fb6c1720a/projects/` PASS。
- 当前测试环境：Windows 11，Python 3.14.6，Node 24.16.0，npm 11.13.0，Electron 43.1.0，Java 21.0.11。
- Windows alpha 资源门禁：**PASS**。
  - 应用 loose 资源：78 个文件 / 2,124,858 字节；ASAR 锚点与源码清单一致；
  - Python：34 个文件 / 21,260,753 字节；
  - JRE：207 个文件 / 52,384,264 字节；
  - EpubCheck：49 个文件 / 36,263,890 字节；
  - Ace：236 个包 / 6,672 个文件 / 58,969,045 字节。
- Windows sale 资源门禁：**按设计 FAIL**；源码为 17 项、真实 packaged 为 12 项；新增 `RELEASE_PUBLISHER_METADATA_PENDING`，原未知 fuse 兼容性阻断已独立关闭。
- 真实 alpha.23 `app.asar`、生产 package identity、9 项 fuse、loose 全树、Python/JRE/EpubCheck/Ace、CPython/EpubCheck/Temurin-JRE/Electron/builder provenance、双阶段应用 smoke 与加密队列恢复已验证；packaged 资源中 `.pyc` 为 0。
- 首次受限环境 build 在 packaged smoke 因 Electron GPU 子进程缺失依赖退出而失败，未生成证据；随后沙箱外完整 build 199.8 秒退出 0。最终 NSIS 189,995,462 字节 / SHA-256 `3ae05010…ad3d`；ZIP 233,814,202 字节 / `625b0fea…8d05`；发布证据和独立复验通过，并按相同字节归档至 `release/archive/0.1.0-alpha.23-final/`。
- macOS：`verify:resources:mac:static` 可执行并按预期 FAIL，精确缺 darwin-x64/arm64 Electron dist、两架构 Python runtime 锁和两架构 JRE；未构建、未签名、未公证、未运行打包版 smoke。
- 详细证据与首次失败修复记录见 `docs/TEST_REPORT.md`。

## 本轮关键实现

- `release_identity.js` 默认只读，使用 exact/canonical 契约验证发行身份并交叉检查 `package.json`；待定字段不会自填，正式 sale 在 `RELEASE_PUBLISHER_METADATA_PENDING` 上失败；
- `windows_install_acceptance.js` 默认只读验证当前 alpha.23 与归档 alpha.12 的 release manifest、SHA256SUMS、大小、摘要和 PE；实际系统变更必须同时提供 `--run --allow-system-mutation`；
- 授权运行固定九阶段，并把安装目录、测试 userData、temp 与 canonical JSON 证据全部限制在 `out/install-acceptance/`；系统集成探针只读取并验证 HKCU InstallLocation/DisplayVersion、Desktop 与 Start Menu 快捷方式；失败时尽力运行精确卸载清理并仍记录 FAIL；
- 新增 Windows 安装证据 v1 JSON Schema、运行时 exact validator 与 canonical 文件复验。历史 alpha.12 是否能覆盖当前版本仍须真实探测，当前不宣称具备降级保护；
- smoke 模式在 ready 前禁用硬件加速，普通启动不变；受限 Codex 令牌的 sandbox 子进程故障通过同版对照定位，最终证据保持 Electron sandbox 并在外层隐藏进程取得；

- 新增 `resource_trust_manifest.js`、canonical 应用资源清单和 ASAR 内固定锚点；锚点绑定应用清单与目标平台 Python/EpubCheck/JRE/Ace tracked lock 的原始 SHA-256；
- 新增 EpubCheck provenance v1：exact schema/canonical evidence 固定官方 release ZIP、GitHub 服务端 digest 与 49/49 原字节文件，并由分发 manifest、JRE 探针锁、70 文件应用清单和 ASAR 锚点逐层绑定；官网 MIT 与随包/仓库 BSD-3-Clause 矛盾保持人工待签核；
- 新增 Electron provenance v1：exact schema/canonical evidence 固定 GitHub release API、官方 ZIP、SHASUMS256、npm checksums 和 75/75 原字节运行时，并由 Electron runtime lock、应用清单和 ASAR 锚点逐层绑定；
- 新增 Windows builder provenance v1：固定三份官方 release/API 与 `app-builder-lib 26.15.3` 选择逻辑，受控重组为 385/385 文件工具树并绑定 tool manifest/tracked lock；旧 release 无 digest/签名和所选载荷许可证缺口原样保留；
- 新增 packaged/runtime `resource-trust` 验证：只从真实 `app.asar` 取锚点，精确复核所有 loose 资源并拒绝增删改、链接/硬链接、目标替换和身份漂移；应用在标准存储与窗口前验证，失败退出；
- 五个 loose 资源可信根 blocker 已由真实 packaged ASAR 与各树锁关闭；builder 独立锁另关闭源码 builder 可信根项；provenance、许可、helper 证据绑定、浏览器、OS 隔离和签名不提前关闭；

- 新增主进程 `external-validation-ipc`、`ace-utility-runner` 与 `chrome-controller`：Renderer 不得提交工具、参数、环境或结果；Python 的 plan/prepare/finalize 三段合同绑定项目状态、标准身份及 Java/JAR/Ace/Chrome 文件身份；
- Ace 固定 helper 在 Electron `utilityProcess` 中运行，输出/时间有界并净化环境；主进程独立启动固定隐藏 Chrome，只暴露随机 loopback DevTools 端点，精确停止子进程并清理 profile；路径换入、报告替换、状态漂移和异常退出均 fail-closed；
- Ace 上游补丁在 utility 模式只连接受控 loopback Chrome；开发 CLI 仍保留独立 profile fallback。Electron Fuse 的 `RunAsNode` 已从临时 `true` 改为 `false`；

- Electron ASAR/fuse 合同已升级：顶层精确锁定 `@electron/fuses 2.1.3`，确认索引 8 为 `WasmTrapHandlers=true`；`afterPack` 用 `strictlyRequireAllFuses=true` 写入全部 9 项并立即回读；
- 配置、工具 API、未来 wire 新项、二进制/Framework 路径、父链、文件类型、链接数和读取前后身份均 fail-closed；macOS arm64 按工具合同重置临时 ad-hoc 签名；

- 新增 `AuthProvider` 本地状态机和生产 `system_browser_pkce` 固定边界；生产未配置时 fail-closed，不打开页面、不联网；
- 新增 Free/Pro 能力矩阵与 `validUntil`/`graceUntil` 离线宽限计算；模拟授权明确无签名证据，过期只降级新权益，不锁已有本地项目或导出；
- 新增 Python `sync-source`，Electron `buildSyncRecordV1` / exact validator、`config/schemas/sync-record-v1.schema.json` 和 `docs/SYNC_RECORD_V1.md`；正文、标题、文件名、路径、预览、哈希等无允许字段并有反向测试；
- 新增账号/同步 IPC 与 preload 固定通道，Renderer 不能提交任意记录；导出后仅对已登录用户逐字段预览并四选一确认；safeStorage 加密队列按账户隔离并支持幂等、取消、重试、删除和重启恢复，但没有生产网络 transport；

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
- 当前 packaged 资源门禁的 12 项 sale blocker 仍机器可读保留；其中发行身份 blocker 明确绑定待确认字段，fuse 未知项已为 0，不允许用该进展掩盖其余正式售卖责任。
- 新增 `web/job-contract.js` 内存参考状态机和三份 exact schema：可信主体与创建请求分离，单任务同意/时效、幂等、并发、大小/MIME 和 UUID 碰撞在接收内容前门禁；公开状态不含主体或稿件元数据；
- Web 任务完成先删输入再开放短期结果；取消、用户删除和 TTL 清扫删除输入/输出并传递 `deleteAt`。删除部分失败进入 `deletion_pending`，准确报告保留状态且不生成成功回执；终态幂等墓碑拒绝同键重建；
- Web 参考实现不启动 HTTP、不持久化任务、不连接 Supabase/网站，也没有对象存储、隔离执行、恶意文件门禁或计费；它只交付生产实现必须遵守的服务端契约和测试夹具。

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

1. CPython、EpubCheck、Temurin/JRE、Electron 与 builder 的机器来源证据已完成；继续具名人工许可/再分发签核，代码不能替代该责任；
2. Ace 的来源/全闭包许可、自带浏览器、OS 级网络隔离和签名绑定 smoke 仍待完成；扩大证明范围前确认正式验收口径；
3. 在有权人员确认法定销售主体、正式 URL、版权、平台签名主体和具名复核后补全发行身份；未确认前保持 `null` / `pending`；
4. 在干净 Windows 环境完成安装、升级、卸载和无系统 Python/Node 验证；该步骤写仓库外，执行前另获授权；
5. 逐项关闭 12 个 packaged sale blocker 并完成 Authenticode；alpha 产物不得表述为可售卖正式版；
6. 在现有本机加密同步队列和 Web 作业 exact 契约上继续生产账号/同步、同源 HTTPS、隔离对象存储/执行、短时下载、真实零留存、macOS 与官网嵌入的实现和环境验收。

如构建需要联网下载、安装新依赖、签名或发布，先取得用户授权。

## 已知技术与产品欠账

- 批量修复与通用检查点恢复的多文件提交能覆盖可捕获异常，但尚无统一的强杀/断电恢复日志；标准 store 已有 pending 事务恢复，规则包升级以原子 project manifest 为提交点保证项目可打开，但二者不能被夸大为任意多文件 ACID；
- Ace 已脱离开发树依赖并取得真实 packaged utility helper 证据，但仍依赖用户系统 Chrome；自带浏览器、OS 级默认拒绝网络及代码签名未完成；
- Ace 有 18 个依赖包只有生成的许可证通知，且整个 236 包生产闭包的来源、许可证、版权与再分发义务均尚需正式人工审计；
- CPython、EpubCheck、Temurin/JRE、Electron 与 builder 均已有固定官方制品、完整文件树及下游锁的机器来源证据；但 CPython 信任链/index 异常、EpubCheck 许可信号矛盾、Temurin OpenPGP、Electron 第三方通知/商标以及 builder 旧 release 无 digest/签名和部分载荷无具名许可文件等边界仍需具名法律/再分发签核；
- Windows Authenticode 和安装包签名尚未完成；alpha.23 制品仅供开发/内测；
- alpha.23 继续从真实 `app.asar/package.json` 验证发行身份，但 `author` 等缺口仍由 `RELEASE_PUBLISHER_METADATA_PENDING` 阻断；法定销售主体、正式 URL、版权、发行者、具名复核与签名证书主体尚未确认，不能自行猜填；
- 标准治理 schema、完整身份和本地升级链已实现，但没有任何外部来源完成核验，4 项外部标准仍在审阅，reviewer 仅为角色占位，GB/T、APA、Chicago、EPUB、TXT/Markdown、纸质出版和可访问性覆盖仍不够，不能宣传为“标准库完整”；
- 标准包生产 trust pin、联网检查/下载和签名撤回分发尚未实现；当前本地签名包导入按设计禁用；
- Windows 开发机无法替代真实 macOS 构建、签名、公证和实机 smoke；
- 本机加密同步队列、Web 作业状态机和同源 HTTP handler 已实现；生产账号、OS 凭据、订阅、网络 transport、真实监听器/反向代理、对象存储/容器、真实零留存和网站 UI 仍涉及生产系统，尚未获得网站写入授权；
- “接入用户自己的 AI”的六项设计决定已确认，但尚未获用户明确批准正式写入 v2.0 方案或实现，不在当前实现范围。

## 历史里程碑

- 2026-07-28：推进到 `0.1.0-alpha.23`；完成同源 HTTPS handler、会话/CSRF、上传前预留、稳定错误与无内容审计 exact schema；Node 406、Python 351、source/packaged smoke、完整 Windows build、发行摘要和只读安装预检通过；真实会话/监听器/存储/隔离执行/官网仍待办。
- 2026-07-28：推进到 `0.1.0-alpha.22`；完成 Web 作业 exact schema、可信主体隔离、单任务同意、幂等/并发/TTL 与惰性过期门禁、内容与元数据分道及删除失败可见的内存参考状态机；Node 387、Python 351、source/packaged smoke、完整 Windows build、发行摘要和只读安装预检通过；真实 HTTPS/存储/隔离执行/零留存/官网仍待办。
- 2026-07-28：推进到 `0.1.0-alpha.21`；完成 safeStorage 加密持久队列、账户隔离、exact schema、原子 revision 提交、设置页管理和 source/packaged 第二进程恢复证据；Node 370、Python 351、真实 Windows build/packaged smoke/发行摘要通过；生产 transport、真实安装和销售门禁仍待办。
- 2026-07-28：推进到 `0.1.0-alpha.20`；把发行身份与真实 `app.asar/package.json` 及 production `oakReleaseIdentity` 绑定，并用 raw header + 精确读取循环消除缓存/短读不确定性；Node 359、Python 351、source/packaged smoke、完整 Windows build、发行证据和安装生命周期只读预检通过；未执行安装器，法定身份仍待确认。
- 2026-07-28：推进到 `0.1.0-alpha.19`；新增发行身份 exact/canonical 契约与 sale fail-closed 门禁，源码/packaged blocker 为 17/12；Node 355、Python 351、完整 Windows build/packaged/9 fuse/smoke、发布摘要和安装生命周期只读预检通过；未执行安装器，法定身份仍待确认。
- 2026-07-28：推进到 `0.1.0-alpha.18`；把 Electron 43.1.0 官方 ZIP/SHASUMS256/npm checksums 与 75/75 运行时文件、三份 Windows builder 官方归档与 385/385 重组工具树精确绑定，保留无签名/digest与许可人工签核边界；Node 344、Python 351、完整 Windows build/packaged/9 fuse/smoke、发布摘要和安装生命周期只读预检通过；未执行安装器。
- 2026-07-28：推进到 `0.1.0-alpha.17`；把 Temurin 21.0.11+10 官方 ZIP、490/490 源 JDK、本机 JDK、207 文件 jlink runtime 与 94 份许可材料精确绑定，保留 OpenPGP 未验签和人工签核；Node 338、Python 351、完整 Windows build/packaged/9 fuse/smoke、发布摘要和安装生命周期只读预检通过；未执行安装器。
- 2026-07-28：推进到 `0.1.0-alpha.16`；把 EpubCheck 5.3.0 精确绑定到官方 release ZIP、GitHub 服务端摘要与 49/49 原字节文件，保留许可证矛盾和人工签核门禁；Node 334、Python 351、真实 packaged 资源/9 fuse/smoke、发布摘要和安装生命周期只读预检通过；未执行安装器。
- 2026-07-28：推进到 `0.1.0-alpha.15`；把 Windows CPython 3.13.14 精确绑定到 PSF 官方 ZIP/Sigstore/SPDX 与 34/33/1 文件推导，保留人工许可/信任链签署门禁；Node 329、Python 351、真实 packaged 资源/9 fuse/smoke、发布摘要和安装生命周期只读预检通过；未执行安装器。
- 2026-07-28：推进到 `0.1.0-alpha.14`；新增 Windows 安装生命周期九阶段编排、证据 v1 和默认只读预检；生成并复验未签名 NSIS/ZIP，保持 Electron sandbox 的外层隐藏 packaged smoke 与全量回归通过；真实安装生命周期仍待另行授权。
- 2026-07-28：`0.1.0-alpha.13` 锁定 `@electron/fuses 2.1.3`，识别并固定 `WasmTrapHandlers`，新增严格 afterPack 全 9 项写入/回读和未来 fuse fail-closed；真实 Windows NSIS/ZIP、packaged smoke、发布摘要与全量回归通过；仍未签名。
- 2026-07-28：推进到 `0.1.0-alpha.12`；完成真实 Windows builder 导入/独立锁、固定离线 7-Zip、受限 app 协议、Python `-B`、NSIS/ZIP、真实 packaged fuse/资源/强制外部验证 smoke 与发布哈希证据；Node 306、Python 351 全绿；仍未签名。
- 2026-07-28：推进到 `0.1.0-alpha.11`；完成 ASAR 内资源锚点、58 文件应用清单、四类运行锁绑定、启动前全树复核和真实 `app.asar` 构造门禁；Node 301、Python 351、六项只读门禁及含真实 EpubCheck/Ace 的隐藏双样本源码 smoke 通过；没有联网或新二进制。
- 2026-07-28：推进到 `0.1.0-alpha.10`；把 Ace 外部验证迁移到主进程绑定的两阶段计划、固定 utilityProcess 与受控 loopback Chrome，关闭 `RunAsNode`；Node 295、Python 351 与含真实 EpubCheck/Ace 的隐藏双样本 smoke 通过；没有联网或新二进制。
- 2026-07-28：推进到 `0.1.0-alpha.9`；完成 ASAR integrity、已知 Electron fuse 固定策略、真实打包二进制身份/wire 验证和构建顺序门禁；发现 Electron 43 的未知索引 8 并按 alpha blocker/sale fail-closed 处理；Node 284、Python 348 与隐藏双样本 smoke 通过；没有联网或新二进制。
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
