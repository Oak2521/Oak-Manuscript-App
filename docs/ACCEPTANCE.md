# ACCEPTANCE — 验收标准

> 当前依据：商业正式版方案 v2.0；下方 M1—M3 与旧阶段 2/3 条目保留为历史基线。勾选必须以真实运行证据为准（命令 + 输出记录在 TEST_REPORT.md），不得凭实现意图勾选。

## 0.1.0-alpha.18 Electron 与 Windows builder 来源机器证据验收（2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.18`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] Electron 43.1.0 官方 release API、ZIP、GitHub digest、SHASUMS256 与 npm checksums 由 exact schema/canonical evidence 固定；官方 ZIP 与本地 runtime 均为 75 文件、364,083,658 字节，75/75 原字节一致；
- [x] Electron provenance、runtime lock、应用资源清单与 ASAR 锚点逐层绑定；验证器拒绝自批准、未知字段、非 canonical 字节、官方摘要/运行时树/锁漂移；
- [x] Windows builder 三份官方归档/API、`app-builder-lib 26.15.3` 固定选择逻辑、受控解压重组与 385 文件工具树由 exact schema/canonical evidence 固定；
- [x] builder provenance、tool manifest 与 tracked lock 双向绑定；重新导入后工具树为 385 文件、19,150,116 字节，完整树复验通过；
- [x] 最终全量 Node 344 / Python 351，0 失败；外层隐藏完整 `npm run build:win` 213.4 秒退出 0；alpha.18 NSIS/ZIP、真实 packaged 资源、9 fuse、EpubCheck/Ace smoke、发布摘要及安装生命周期只读预检均通过；
- [x] 两个原 provenance audit blocker 均只收窄为具名人工签核 blocker；源码/packaged 总数保持 16/11，没有把机器证据冒充正式许可或再分发签署；
- [ ] Electron 许可、Chromium 第三方通知、商标与再分发义务已由具名人员签署；官方 release 无 detached signature 的边界已审阅；
- [ ] builder 三个 legacy release 无 digest/签名、部分所选载荷无具名许可证文件等边界已由具名人员签署；
- [ ] CPython、EpubCheck 与 Temurin/JRE 的剩余人工来源/许可门禁已签署；
- [ ] 真实 alpha.12 → alpha.18 安装、升级、旧版回装探测、卸载、HKCU/Desktop/Start Menu 清理和 userData 保留已在获准系统环境执行并产生 PASS 证据；
- [ ] `package.json` 正式 seller/author 元数据、Windows Authenticode、干净机、macOS/Web、生产账号/订阅/同步和全部 sale 门禁完成；因此本节仍不是正式发行验收。

## 0.1.0-alpha.17 Temurin/JRE 来源机器证据与 Windows 制品验收（历史，2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.17`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] Eclipse Adoptium 官方 Temurin 21.0.11+10 Windows x64 ZIP 的 URL、大小、本地/GitHub SHA-256、checksum、build metadata 和 release API 原始摘要由 exact schema 与 canonical JSON 固定；
- [x] 官方 ZIP 与本机源 JDK 均为 490 文件、343,822,457 字节，490/490 路径、大小与 SHA-256 一致；直接 ZIP 解析拒绝路径逃逸、多卷、ZIP64、加密和链接；
- [x] 固定 `jlink` 模块/参数生成 207 文件、52,384,264 字节的 JRE；94 个 `NOTICE`/`legal/` 文件与官方 JDK 原字节一致；manifest、运行时锁、provenance、应用资源清单和 ASAR 锚点逐层绑定；
- [x] 验证器拒绝自批准、未知字段、非 canonical 字节、官方资产/文件树/JDK/JRE/锁/许可材料漂移；源码和打包后的 JRE 路径重映射均实测通过；
- [x] 最终全量 Node 338 / Python 351，0 失败；最终外层隐藏完整 `npm run build:win` 206.5 秒退出 0；alpha.17 NSIS/ZIP、真实 packaged 资源、9 fuse、EpubCheck/Ace smoke、发布摘要和安装生命周期只读预检均通过；
- [ ] detached signature 已由批准的 OpenPGP 工具和受信 Adoptium key/fingerprint 独立验证；
- [ ] GPLv2/Classpath/Assembly Exception、第三方 notice、商标、源码提供和再分发义务已由具名人员签署；
- [ ] CPython 与 EpubCheck 的剩余人工来源/许可门禁已签署；
- [ ] 真实 alpha.12 → alpha.17 安装、升级、旧版回装探测、卸载、HKCU/Desktop/Start Menu 清理和 userData 保留已在获准系统环境执行并产生 PASS 证据；
- [ ] Windows Authenticode、干净机、macOS/Web、生产账号/订阅/同步和全部 sale 门禁完成；因此本节仍不是正式发行验收。

## 0.1.0-alpha.16 EpubCheck 来源机器证据与 Windows 制品验收（2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.16`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] W3C/DAISY 官方 EpubCheck 5.3.0 release ZIP 的 URL、大小、本地 SHA-256 与 GitHub release API 服务端 digest 由 exact schema 与 canonical JSON 固定；
- [x] 官方 ZIP 与本地分发均为 49 文件、36,263,890 字节，49/49 逐字节一致；证据绑定分发 manifest、JRE 双向探针锁、应用资源清单与 ASAR 锚点；
- [x] 验证器拒绝自批准、schema/顺序/原始字节/官方制品摘要/本地文件树漂移；EpubCheck 专项和相关反向路径纳入 Node 全量；
- [x] 随包/仓库 BSD-3-Clause 与当前官网 MIT 的矛盾以 `license_signal_consistent=false` 保留；没有把 tag 签名冒充生成 ZIP 的直接签名；
- [x] 最终全量 Node 334 / Python 351，0 失败；alpha.16 NSIS/ZIP、真实 packaged 资源、9 fuse、EpubCheck/Ace smoke、发布摘要和安装生命周期只读预检均通过；
- [ ] EpubCheck tag/制品密码学绑定、许可证信号矛盾和第三方再分发义务已由具名人员签署；
- [ ] CPython 完整信任链和 PSF 再分发义务已由具名人员签署；
- [ ] 真实 alpha.12 → alpha.16 安装、升级、旧版回装探测、卸载、HKCU/Desktop/Start Menu 清理和 userData 保留已在获准系统环境执行并产生 PASS 证据；
- [ ] Windows Authenticode、干净机、macOS/Web、生产账号/订阅/同步和全部 sale 门禁完成；因此本节仍不是正式发行验收。

## 0.1.0-alpha.15 CPython 来源机器证据与 Windows 制品验收（2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.15`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] PSF 官方 CPython 3.13.14 Windows x64 embeddable ZIP 的 URL、大小、SHA-256、Sigstore、SPDX 和 GPG 旁证元数据由 exact schema 与 canonical JSON 固定；
- [x] 官方 34 个文件与本地 34 个文件全量对照：33 个逐字节一致，唯一差异为 `python313._pth` 精确追加 `..\python\r\n`；官方 `LICENSE.txt` 原样保留；
- [x] 证据生成/验证拒绝自批准、未知字段、非 canonical 字节、顺序漂移、运行时增删改、链接/身份换入和原子提交失败；运行时 manifest 与 packaged 门禁绑定证据原始 SHA-256；
- [x] Sigstore artifact digest、leaf signature、证书 identity 和 Rekor canonical body 绑定，以及 SPDX artifact digest、supplier 和 `PSF-2.0` 已机器复验；
- [x] 上游 Sigstore bundle 的 tlog entry/proof index 不一致、完整信任链未重放和 GPG 未验证均被如实保留，未写成完整签名验证通过；
- [x] 最终全量 Node 329 / Python 351，0 失败；alpha.15 NSIS/ZIP、真实 packaged 资源、9 fuse、EpubCheck/Ace smoke、发布摘要和安装生命周期只读预检均通过；
- [ ] CPython 完整 Sigstore 或 GPG 独立验证、上游 index 异常处置、PSF 再分发义务和修改披露已由具名人员签署；
- [ ] 真实 alpha.12 → alpha.15 安装、升级、旧版回装探测、卸载、HKCU/Desktop/Start Menu 清理和 userData 保留已在获准系统环境执行并产生 PASS 证据；
- [ ] Windows Authenticode、干净机无开发运行时、其余 packaged sale blocker、macOS/Web/生产账号与同步门禁全部关闭。

## 0.1.0-alpha.14 Windows 安装生命周期工具验收（历史，2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.14`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 默认只读预检交叉验证当前 alpha.14 与归档 alpha.12 的 canonical manifest、SHA256SUMS、版本、大小、SHA-256 和 NSIS PE；预检不创建 `out/`、不启动子进程；
- [x] 实际运行必须同时携带 `--run --allow-system-mutation`；所有安装目录、测试 userData、临时文件、日志和证据固定在项目 `out/install-acceptance/`，安装/卸载进程均 `shell=false`、隐藏运行；
- [x] PASS 证据严格要求九阶段等序全绿：旧版安装/冒烟、当前版升级/冒烟、数据保留、降级探测后仍为当前版、卸载和系统集成清理；JSON Schema、exact validator 与 canonical 文件复验已实现；
- [x] 12 项专项测试覆盖旧制品篡改、完整 SemVer、x86 NSIS/x64 APP 区分、零授权零启动、路径逃逸、隐藏阶段、回装未启动、降级成功时失败及清理重试；最终全量 Node 323 / Python 351，0 失败；
- [x] alpha.14 NSIS/ZIP、9 fuse、packaged 资源、外层隐藏且 Electron sandbox 保持开启的 packaged smoke、SHA256SUMS 与 release manifest 均已验证；
- [ ] 真实 alpha.12 → alpha.14 安装、升级、旧版回装探测、卸载、HKCU/Desktop/Start Menu 清理和 userData 保留已在获准系统环境执行并产生 PASS 证据；
- [ ] 历史 alpha.12 若能回退 alpha.14，已实现并验证产品侧阻止机制；当前结果未知，不得预先勾选；
- [ ] Windows Authenticode、干净机无开发运行时、其余 11 项 packaged sale blocker、macOS/Web/生产账号与同步门禁全部关闭。

## 0.1.0-alpha.13 Electron 43 全 fuse 固定验收（2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.13`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 顶层精确锁定 `@electron/fuses 2.1.3`，索引 8 由可信本地工具定义为 `WasmTrapHandlers=true`；
- [x] electron-builder 注册 `afterPack`，以 `strictlyRequireAllFuses=true` 写入全部 9 项并立即回读；未来新项和 API/索引漂移 fail-closed；
- [x] Windows 真实 EXE 独立回读 9 项全部匹配，unknown 0、blocker 0；路径、链接/硬链接和 macOS 实际 Framework 身份纳入门禁；
- [x] 最终 `npm test` 为 Node 310 / Python 351，0 失败；真实 NSIS/ZIP、packaged 资源、强制 EpubCheck/Ace smoke 与发布证据通过；
- [x] NSIS/ZIP/SHA256SUMS 的精确字节数和 SHA-256 记录在 `TEST_REPORT.md`，并已独立复验；
- [ ] Windows Authenticode、干净机安装/升级/卸载及无开发运行时验收完成；
- [ ] packaged 资源门禁其余 11 项、macOS/Web/生产账号与同步正式门禁全部关闭。

## 0.1.0-alpha.12 Windows 可安装 alpha 验收（历史，2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.12`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 三份固定 Windows builder 归档下载并验哈希；安全导入 Windows payload，生成受版本控制的 385 文件独立全树锁；
- [x] 构建只使用受验证 Electron dist、本地固定 7-Zip 和仓库内 cache/temp；调用者不能覆盖 trusted dist 或触发下载回退；
- [x] 隔离 Python 显式 `-B`；真实 packaged 资源门禁和 smoke 后无 `.pyc`/`__pycache__`；
- [x] `GrantFileProtocolExtraPrivileges=false` 保持关闭；受限 `oak-manuscript://` 只提供四个固定渲染文件，真实打包 UI 可启动；
- [x] alpha.12 NSIS/ZIP、已知 fuse、真实 `app.asar` 锚点、loose 全树、应用身份、强制 EpubCheck/Ace packaged smoke 与发布证据全部通过；
- [x] 最终 `npm test`：Node 306/300/0/6，Python 351/0 failures/0 errors/3 skipped；
- [ ] Electron 43 未知 fuse 已由官方工具识别并逐项固定；
- [ ] 干净 Windows 安装、升级、卸载、无系统 Python/Node 和 Authenticode 已验证；
- [ ] 11 项 packaged sale blocker、macOS/Web、生产账号/订阅/同步及正式条款全部关闭。

## 0.1.0-alpha.11 ASAR 资源信任根验收（2026-07-28）

> 本节验收源码清单、ASAR 读取与构造 packaged 门禁；当前没有 alpha.11 产品安装包，不把测试生成的 `app.asar` 冒充真实发行证据。

- [x] APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.11`；标准 release、规则/fixer、账号与同步合同未变化；
- [x] canonical 应用资源清单精确固定 58 个 Python/配置/标准/样本文件和 1,873,018 字节；默认验证只读，更新必须显式 `--update-lock`；
- [x] ASAR 内固定锚点绑定应用清单以及 win32-x64 Python/EpubCheck/JRE/Ace 四份 tracked lock 的原始 SHA-256；
- [x] packaged 验证从真实 `app.asar` 读取锚点，不接受 loose 同名伪造；资源/锁增删改、目标替换、链接/硬链接与读取身份漂移 fail-closed；
- [x] 打包启动在标准存储和窗口创建前执行完整资源信任验证，失败退出；
- [x] 构造的真实 `app.asar` 集成测试证明证据成立时只关闭 5 个可信根 blocker，缺失 `app.asar` 时拒绝；源码资源门禁仍保留 17 项；
- [x] 最终 `npm test` 为 Node 301 / Python 351，0 失败；六项只读资源/标准/Ace/Electron/fuse 门禁均通过；
- [x] alpha.11 独立隐藏源码 UI smoke 完成 DOCX/EPUB 全闭环：各 4 次检查、1 个批次、3 个检查点，应用 fixes 5/2，原稿哈希不变；EPUB 实得 EpubCheck 5 error 与 Ace 8 项失败断言，退出无 profile/Electron 残留；
- [ ] 已在真实 alpha.11 Windows 安装包/ZIP 和两个 macOS `.app` 上取得 ASAR、fuse、资源、功能及签名联合证据；
- [ ] 其余 12 项 Windows 资源 blocker、Electron 未知 fuse 和正式发布门禁全部关闭。

## 0.1.0-alpha.10 Ace 受控 utilityProcess 与 RunAsNode 关闭验收（历史，2026-07-28）

> 本节验收源码实现与真实隐藏 Electron UI 链路；没有 alpha.10 安装包，不把源码 smoke 冒充 packaged fuse、安装器或正式发布证据。

- [x] APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.10`；标准 release、规则/fixer、账号与同步合同未变化；
- [x] Renderer 的外部验证 IPC 只接受受控项目路径，不能提交模块、命令、环境、退出状态或报告结论；
- [x] Python `external-plan` / `external-prepare` / `external-finalize` 绑定项目状态、标准身份及 Java/JAR/Ace/Chrome 文件身份，状态漂移或路径替换 fail-closed；
- [x] Ace 使用固定 Electron `utilityProcess`，固定入口/参数、净化环境、64 KiB 输出上限和 5 分钟超时均有正反向测试；
- [x] 主进程以固定隐藏参数启动精确 Chrome，使用独立 profile 和随机 loopback DevTools 端点；utility 只能连接严格本地端点，退出后精确停止并清理；
- [x] `RunAsNode=false` 已由配置门禁和测试固定；
- [x] 最终 `npm test` 为 Node 295 / Python 351，0 失败；标准、Ace、Electron runtime、Windows alpha 资源和 fuse 配置门禁均通过；
- [x] 隐藏条件源码 smoke 真实执行 EpubCheck/Ace：缺陷 EPUB 得到 EpubCheck 5 error 与 Ace 8 项失败断言，原稿哈希不变，无 profile 残留；
- [ ] 已对真实 alpha.10 Windows EXE 和两个 macOS `.app` 二进制运行 packaged fuse 与 Ace 功能/安全回归并留存证据；
- [ ] Electron 43 未知 fuse 已有可信工具定义并固定期望状态；
- [ ] Ace 自带校验浏览器、OS 级默认拒绝网络、可信根和许可证/来源人工审计已完成；
- [ ] 17 项 Windows sale blocker、签名和正式发布门禁全部关闭。

## 0.1.0-alpha.9 Electron ASAR 与 fuse 发布硬化验收（历史，2026-07-28）

> 本节只验收源码配置、验证器和构建顺序；没有真实 alpha.9 打包产物，不把源码 Electron runtime 或构造 wire 冒充 packaged fuse 证据。

- [x] APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.9`；标准 release、规则/fixer、账号与同步合同未变化；
- [x] `build.asar=true`、`disableAsarIntegrity=false`，全部本地已知 fuse 和 `ResetAdHocDarwinSignature` 均显式固定；缺项、多项、漂移、inherit 或 removed fail-closed；
- [x] 打包二进制验证器限定仓库内安全父链、常规非空单链接文件，拒绝路径逃逸、symlink/reparse、hardlink 和读取竞态；
- [x] wire 版本与所有已知 fuse 状态逐项精确验证；未知 fuse 在 alpha 返回机器可读 blocker，在 sale 直接失败；
- [x] Windows/macOS 构建顺序固定为配置验证 → builder → 真实二进制 fuse → 打包资源 → packaged smoke → 发布证据；
- [x] fuse 专项 6/6、最终 Node 284/277/0/7 与 Python 348/0/0/3、标准/Electron runtime/Windows alpha 门禁及隐藏双样本 smoke 均通过；
- [x] Electron 43.1.0 wire 的未知索引 8 如实记录为工具兼容性阻断，未猜测名称或用 enabled 状态冒充安全结论；
- [ ] 已对真实 alpha.9 Windows EXE 和两个 macOS `.app` 二进制运行 packaged fuse 验证并留存证据；
- [ ] 使用经验证的兼容工具识别索引 8，明确期望值并关闭 `ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING`；
- [ ] Ace 受控 helper 完成，`RunAsNode` 改为 `false` 并完成功能与安全回归；
- [ ] ASAR integrity/fuse 与代码签名、资源可信根、干净系统/实机验证一起通过正式 sale 门禁。

## 0.1.0-alpha.8 统一账号、权益与 SyncRecord v1 离线契约验收（2026-07-28）

> 本节只验收离线接口、隐私白名单和模拟状态；不把模拟登录、`pending_transport` 队列或 UI 预览写成生产账号/网站同步已完成。

- [x] APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.8`；标准 release、35 条规则和 6 个白名单 fixer 未变化；
- [x] AuthProvider 固定生产登录为系统浏览器 PKCE；未配置时明确失败且不打开页面、不联网；测试模拟覆盖 authenticated/signed_out/expired/revoked，生产 UI 不暴露模拟入口；
- [x] LicenseProvider 提供 Free/Pro 能力矩阵，并按有效期/宽限期计算 active/grace/expired；模拟授权不冒充签名证据，任何状态都不锁已有本地项目和导出；
- [x] Python `sync-source` 严格只读且只返回结构化脱敏字段；标题、解释、位置、预览、文件名、路径、用户名、引用原文、正文与哈希不在输出中；
- [x] `SyncRecord v1` 使用 exact runtime validator 与 tracked JSON Schema；未知字段、内容字段、路径和哈希注入反向测试均 fail-closed；计数、issues 数量与幂等 ID有交叉约束；
- [x] Renderer 不能提交任意 payload、令牌或网络目标；主进程只接受可信项目路径、固定事件/选择和已缓存预览 ID；
- [x] 导出后询问非阻断；未登录不询问；已登录时逐字段安全显示完整本次负载，并提供仅本次、同步本次以后仍询问、暂不同步、不再询问此项目四项；
- [x] 当前进程队列同一幂等 ID 不重复，支持取消、重试、删除；预览、暂不同步或不再询问均不会误入队；
- [x] 账号/同步 Node/Python/IPC/UI 测试、统一 `npm test`、标准、Electron runtime、Windows alpha 资源门禁及沙箱外隐藏双样本 smoke 均通过；原稿哈希不变；
- [x] `pending_transport`、未签名模拟权益、非持久队列与生产未配置状态在 UI/文档中明确，不声称已上传或已接入网站；
- [ ] 系统浏览器真实 PKCE、OS 安全凭据、生产签名授权缓存和设备撤销完成；
- [ ] 加密持久队列、独立网络 transport、Supabase/支付/网站后台、云端查看/导出/删除和双端 schema 验证完成；
- [ ] 生产隐私/安全测试、账号删除、跨端验收与真实用户授权流程通过。

## 0.1.0-alpha.7 Windows 发布制品证据链验收（2026-07-28）

> 本节只验收尚未有真实制品时可证明的生成/验证契约与流水线顺序；不把构造测试制品或源码 smoke 写成安装包证据。

- [x] APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.7`；标准 release 保持 2.0.0；
- [x] 生成器只接受 package/lock 版本一致的精确当前 Windows x64 NSIS/ZIP 文件名，拒绝缺失、同系列旧版本、坏 PE/ZIP、链接/硬链接、路径逃逸和读取竞态；
- [x] `SHA256SUMS.txt` 固定两件制品完整摘要与顺序；canonical manifest 固定产品、appId、版本、平台/架构、种类、大小、制品摘要及 SHA 文件原始字节摘要，验证时重新读取并交叉复核；
- [x] 两份证据联合事务提交；候选独占创建并 `fsync`，提交/复验失败恢复旧证据；清除操作在删除首个文件前预检两份旧证据；
- [x] `build:win` 先清除旧证据，且只有 electron-builder、packaged 资源门禁和隐藏 packaged smoke 成功后才生成新证据；
- [x] 证据专项 6 项为 5 通过/0 失败/1 条件跳过；最终统一 `npm test` 为 Node 267/260/0/7、Python 344/0/0/3，退出码 0；
- [x] 标准、Electron runtime、Windows alpha 资源门禁与 alpha.7 隐藏源码 smoke 通过；原稿哈希不变；
- [x] 在真实空 `release/` 上运行验证器明确拒绝缺失的 `Oak-Manuscript-0.1.0-alpha.7-Windows-x64.exe`；未生成虚假证据；
- [ ] 已生成真实 alpha.7 NSIS/ZIP，且构建尾部产生的 SHA 文件和 release manifest 复验通过；
- [ ] packaged smoke、干净 Windows、签名、正式审计及 17 项 sale blocker 全部关闭。

## 0.1.0-alpha.6 Windows builder 受控下载验收（2026-07-28）

> 本节只验收显式联网入口及其本地安全契约；本轮没有联网，没有真实归档、工具树、安装包或正式发行证据。

- [x] APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.6`；标准 release 仍为 `oak-standards 2.0.0` / `oak-rules 2.0.0`；
- [x] 三份归档的官方 HTTPS URL、文件名和 SHA-256 由仓库合同固定，不从远端响应、node_modules 或已下载文件动态建立信任；
- [x] CLI 缺少 `--allow-network` 时在创建输出目录或发出请求前失败；普通 test/build/dist 不调用下载器；
- [x] 初始请求只允许固定 GitHub 仓库 release 路径；重定向只允许 HTTPS、无凭据/fragment及明确的 GitHub release asset 主机，最多 5 次；
- [x] 输出目录必须在仓库内且父链无链接/逃逸；已有正确归档按哈希复用，已有错误归档、未知条目、链接或多链接文件拒绝且不覆盖；
- [x] 单档最大 128 MiB、30 秒闲置超时、独占候选、`fsync` 和全量 SHA-256 复核；三份候选全部通过后才提交，提交碰撞会回滚本事务已安装文件；
- [x] downloader 专项 11 项通过；最终统一 `npm test` 为 Node 261/255/0/6、Python 344/0/0/3，退出码 0；
- [x] Windows alpha 资源门禁和隐藏 alpha.6 源码 smoke 通过；DOCX/EPUB 原稿哈希不变；
- [ ] 已取得三份真实上游归档并验证哈希；
- [ ] 已安全导入真实工具树并提交独立 tracked lock；
- [ ] alpha.6 NSIS/ZIP、packaged smoke、干净系统、代码签名和 sale 门禁全部通过。

## 0.1.0-alpha.5 默认引用解析与标准包 2.0.0 验收（2026-07-27）

> 本节只验收 alpha.5 源码、本地标准 release 和引用确认闭环，不代表安装包、在线标准更新或可售卖正式版。

- [x] APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.5`；内置 release 为 `oak-standards 2.0.0` / `oak-rules 2.0.0`（sequence 2），保持 35 条规则和 6 个白名单 fixer；
- [x] 六个用户选项为 `default | gbt7714-2025 | apa-7 | chicago-18-nb | chicago-18-ad | none`；显式选择不被默认解析器覆盖；
- [x] 默认解析仅使用本地结构信号，决策阈值、原因码、置信度和体例能力映射版本化；结果不保存稿件片段、姓名、文件名、路径或哈希；
- [x] 结构冲突、证据不足、语言不足或 EPUB 部分提取时 fail-safe 退回 `structure_only`；不将低置信度判断冒充为具体体例；
- [x] `plan-citation` 严格只读，`citation_plan_id` 绑定项目、工作稿、问题、规则包与解析结果；状态变化使旧计划失效；
- [x] Renderer 在检查前一次性展示模式/体例、理由、置信度、结构数量和实际覆盖规则；取消不运行检查，确认后才携带 plan ID；
- [x] `citation_resolution` 在项目设置、检查快照、报告与出版摘要中一致；旧 1.0 项目可缺失该字段；
- [x] 规则包升级保留用户显式体例，清空默认解析以便在新包重算；旧项目必须能在本地 CAS 重验原 release，缺失时 fail-closed；
- [x] 2.0.0 manifest/规则包/能力集 SHA-256 为 `0aff75eb…8427` / `098b382e…97a4` / `af67d0aa•320e`，rollback target 精确指向 sequence 1 manifest `d33534f0…d7af`；
- [x] Node 分项 **250/244/0/6（2.650 秒）**、Python 分项 **344/0/0/3（80.191 秒）**、`verify:standards`、`verify:electron-runtime` 和 Windows alpha 资源门禁均通过；最终统一 `npm test` 退出码 0，Node 250/244/0/6（2.675 秒）、Python 344/0/0/3（88.790 秒），墙钟 160.5 秒；
- [x] alpha.5 隐藏 Electron 源码 smoke PASS；运行根 `out/source-smoke/runs/ms44nzhb-8186d1b3c5148eba/projects/`，DOCX/EPUB 均先确认引用计划、各 4 次检查且原稿哈希不变，PDF 分别 251,646 / 177,416 字节；
- [x] 切换稿件/项目目录会清空前一项目会话；该真实 UI 缺陷已有 Node 回归与双样本 smoke 证据；
- [ ] alpha.5 Windows NSIS / ZIP 已生成并通过 packaged 资源门禁、packaged smoke、SHA-256、干净系统和签名验收；
- [ ] 生产标准 trust pin、在线获取/下载、签名撤回分发与官方来源内容审核完成；
- [ ] macOS、Web、统一账号、订阅、结果同步与正式售卖全量门禁通过。

## 0.1.0-alpha.4 Electron 与 builder 构建输入可信链验收（2026-07-27）

> 本节只验收 alpha.4 源码、构建输入锁与本机 alpha 门禁，不代表安装包、代码签名或可售卖正式版。

- [x] APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.4`；规则包/标准内容保持 `oak-rules 1.0.0`、release sequence 1；
- [x] Electron 43.1.0 win32-x64 由受版本控制的完整树锁固定：2 个目录、75 个文件、364,083,658 字节，manifest SHA-256 为 `ae67132…520d95`；tracked manifest 使用严格 JSON、exact schema 和唯一 canonical UTF-8/LF 原始字节；
- [x] Electron 锁默认只读验证，缺失、多出、篡改、硬链接、Node 可识别的 symlink/junction/reparse、路径逃逸或 package-lock 漂移均 fail-closed；失败时 electron-builder 不会下载回退；
- [x] Electron 锁只有显式 `--update-lock` 才能更新；写入前验证安全父链并拒绝目标 symlink/hardlink，随后以独占候选文件、`fsync`、原子替换和换入后复验提交；失败恢复旧字节，回滚自身失败保留事务证据并明确报错；
- [x] 源码和 packaged 资源门禁均重验仓库源码 Electron 构建输入；只有存在有效全树锁证据时才关闭 `ELECTRON_RUNTIME_TRUST_ROOT_NOT_HARDENED`，provenance 与签名阻断仍保留；
- [x] Windows builder 导入器独立固定三份归档名称/完整 SHA-256，并固定本地 7z EXE/DLL；普通 build/test 不调用导入器；
- [x] 导入器在解压前后拒绝路径逃逸、绝对/保留/冲突路径、链接、备用流、加密/反条目、异常容量、清单外文件和哈希漂移；UNC/device 路径在读取前拒绝；
- [x] 工具树 manifest 与受版本控制独立 tracked lock 交叉绑定来源归档、manifest 原始字节和完整树；只有显式 `--update-lock` 才能写 lock，并与工具树联合事务换入；
- [x] 不安全祖先路径在读取前短路；旧工具树/旧 lock 在任何 rename 前通过父链、realpath、单链接和全树预检；
- [x] 四个前向 rename 失败均恢复旧 tree/lock；四个回滚 rename 自身失败均明确报错并保留恢复证据；
- [x] Node **239/233/0/6（2.606 秒）**、Python 默认 **312/0/0/3（80.125 秒）**、沙箱外隐藏 Chrome 真实 Ace **312/0/0/1** 均通过；
- [x] Electron runtime 锁专项 **37/36/0/1**；hardlink 与 junction 在本机实测通过，文件 symlink 因 Windows `EPERM` 条件跳过，不计作通过；
- [x] alpha.4 隐藏 Electron 源码 smoke PASS；运行根为 `out/source-smoke/runs/ms37h0mu-201a90896825d190/projects/`，DOCX/EPUB 均保持原稿哈希、各有 4 次检查，APP/项目/检查/报告七字段身份一致，PDF 分别为 258,404 / 161,836 字节；
- [x] Windows alpha 资源门禁实际执行运行时探针并通过；sale 门禁按设计以 17 项 blocker 失败；macOS 静态门禁因两架构资源缺失按设计失败；
- [ ] 三份真实 builder 归档已取得并通过安全导入，真实 tracked lock 已生成（当前没有联网授权，未取得）；
- [ ] alpha.4 Windows NSIS / ZIP 已生成并通过 packaged 资源门禁、packaged smoke、SHA-256、干净系统及签名验收；
- [ ] macOS、Web、统一账号、订阅、结果同步与正式售卖全量门禁通过。

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
- [x] 该检查点默认回归为 Node **186/181/0/5**、Python **312/0/0/3**；真实 Ace 条件套件为 **312/0/0/1**；隐藏 Electron smoke 为 PASS；
- [x] 该检查点 Windows alpha 资源门禁通过；sale 门禁以当时 18 项 blocker 按设计失败；macOS 静态门禁因两架构资源缺失按设计失败；
- [ ] alpha.3 Windows NSIS / ZIP 已生成并通过 packaged smoke（该检查点当时缺本地 builder 工具，未生成）；
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

当前源码 Windows sale 门禁为 16 类机器码；真实 alpha.18 packaged ASAR 会关闭其中 5 个 loose 可信根项，保留 11 类：

1. `FORMAL_LICENSE_AUDIT_REQUIRED`；
2. `PYTHON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
3. `EPUBCHECK_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
4. `JRE_SOURCE_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
5. `EPUBCHECK_TRUST_ROOT_NOT_HARDENED`；
6. `JRE_TRUST_ROOT_NOT_HARDENED`；
7. `PYTHON_RUNTIME_TRUST_ROOT_NOT_HARDENED`；
8. `APP_RESOURCES_TRUST_ROOT_NOT_HARDENED`；
9. `ELECTRON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
10. `BUILDER_TOOLCHAIN_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
11. `ACE_FULL_LICENSE_AUDIT_REQUIRED`；
12. `ACE_TRUST_ROOT_NOT_HARDENED`；
13. `ACE_CONTROLLED_HELPER_PENDING`；
14. `ACE_BROWSER_RUNTIME_PENDING`；
15. `ACE_OS_NETWORK_ISOLATION_PENDING`；
16. `WINDOWS_CODE_SIGNING_PENDING`。

packaged 门禁会关闭上列第 5、6、7、8、12 项，保留 11 项；这些关闭来自真实 `app.asar`、JRE、Python、EpubCheck 与 Ace 锚点复验，不是人工豁免。

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
> DOCX 与 EPUB 双闭环 PASS；旧 `0.0.1` 打包版历史结果同样 PASS，不能替代当前 alpha.11 打包验收。

- [x] Electron 壳安全基线：contextIsolation / sandbox / nodeIntegration=false / IPC 固定通道 + 输入验证 / 子进程 shell=false / CSP / 导航与新窗口拦截 / 外链仅 HTTPS 白名单域名；
- [x] 七个主页面（中文 UI）：欢迎隐私 / 创建项目 / 检查目标 / 进度（阶段式，无虚假百分比）/ 问题双栏（接受·拒绝·暂不处理）/ 导出中心 / 标准资源与设置；
- [x] 历史 0.0.1 登录入口为「即将开放」占位；当前 alpha.11 继承不联网的账号/同步离线契约，alpha.10 冒烟已断言未登录不出现同步询问；
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
- [x] 授权到期或网站故障不会锁住本地文件（LicenseProvider Free/Pro/宽限/过期状态均保持 `localProjectsLocked=false`）
- [x] 引用体例「默认」选项按映射表确定性选定，并在报告中说明
- [x] 未登录状态下全部核心流程可完成，且不出现同步询问（冒烟断言）
- [x] 登录、逐字段确认、负载白名单和当前进程入队契约已验证；未登录不询问，负载不含稿件、正文/预览、标题、文件名、路径、参考文献原文或哈希
- [ ] 生产网络同步仍只在上述明确确认后发生，并通过服务端同 schema、账号归属、持久队列、撤销/删除与真实隐私验收
- [ ] 网站后台可查看并删除已同步记录（阶段 4 验收）
- [ ] 正式发布包候选的 Python 单元/集成 + CLI 端到端 + UI 冒烟 E2E 全部通过（alpha.8 源码全量基线与隐藏源码 smoke 已通过；因尚无 alpha.8 安装包或 ZIP，打包版 E2E 仍未运行）
- [ ] 当前正式发布包有版本、说明、校验值和已知限制（`RELEASE_NOTES_0.0.1.md` 仅是历史资料）
