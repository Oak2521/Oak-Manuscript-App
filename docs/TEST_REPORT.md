# TEST_REPORT — 测试报告

> 最近更新：2026-07-28。只记录真实执行结果；未运行项不得写成通过。

## 最新验证结论：0.1.0-alpha.18 Electron 与 Windows builder 来源机器证据检查点

验证日期：2026-07-28。工作区：`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`。用户已明确允许下载；Electron 证据使用 GitHub 官方 release/API/SHASUMS256 与 npm checksums，builder 证据使用 GitHub 官方 release API 和仓库内已有的三份已验哈希归档。所有 packaged GUI 进程隐藏执行，实际安装器未运行。

| 命令 / 检查 | 结果 | 关键事实 |
|---|---|---|
| `npm run verify:provenance:electron:win` | **PASS** | 官方 ZIP 144,237,574 字节 / `a07dc1e3…09f0`；GitHub server digest、SHASUMS256、npm checksums 同值；官方 ZIP 与本地 runtime 均 75 文件 / 364,083,658 字节，75/75 原字节一致；证据 SHA-256 `5f850b7a…075` |
| Electron 签名/许可边界 | **机器范围有界 PASS，人工范围待办** | 官方 release 没有 detached signature 资产，状态 `not_provided_as_release_asset`；许可、Chromium 第三方通知、商标与再分发义务未由具名人员签核 |
| `npm run verify:provenance:builder:win` | **PASS** | 三份官方归档/API 与 `app-builder-lib 26.15.3` 固定选择逻辑已绑定；受控重组 385 文件 / 19,150,116 字节，与当前工具树 385/385 一致；证据 SHA-256 `c1651839…bb5`，tracked lock SHA-256 `ccb2701b…c1a` |
| builder 签名/许可边界 | **机器范围有界 PASS，人工范围待办** | 三个 legacy release API 不提供 digest 或签名；组装树只保留 NSIS `COPYING`，所选 nsis-resources/winCodeSign 载荷无具名许可证文件；未伪称正式再分发审计通过 |
| 最终 `npm test` | **PASS** | 墙钟 162 秒；Node 344 total / 337 pass / 0 fail / 7 skip（3.280 秒）；Python 351 total / 0 failures / 0 errors / 3 skipped（104.368 秒） |
| 首次 Node 全量 | **4 个旧 fixture 失败，已修复后重跑** | 旧夹具只允许 `*_PROVENANCE_AUDIT_REQUIRED`；兼容真实新 `*_HUMAN_SIGNOFF_REQUIRED` 后最终全量 0 失败，未掩盖失败记录 |
| 外层隐藏 `npm run build:win` | **PASS** | 213.4 秒；JRE/Ace staging、源资源、9 fuse、NSIS/ZIP、packaged 资源、原始隐藏 smoke 与发布证据同链退出码 0；electron-builder 同时提示 `package.json` 缺 `author`，该售卖元数据仍待配置 |
| `npm run release:evidence:verify:win` | **PASS** | NSIS/ZIP、SHA256SUMS 与 canonical manifest 全量交叉复验 |
| `npm run verify:install-lifecycle:win` | **PASS（只读预检）** | 当前 alpha.18 与归档 alpha.12 的哈希/大小/manifest/PE 匹配；`authorized=false`、`ready_for_authorized_run=true`；未启动安装器 |
| packaged 资源门禁 | **PASS（alpha）** | 70 个应用 loose 文件、真实 `app.asar` 锚点、全 9 fuse 与五类 provenance/运行资源通过；packaged sale blocker 仍为 11 项 |
| 真实安装生命周期 | **未运行** | 会写 HKCU、Desktop 与 Start Menu；仍需另行系统写入授权，不能写成通过 |

最终 packaged smoke 运行根：`out/packaged-smoke/runs/ms4vbk2z-11762cedd25847f4/projects/`。

| 项目 | APP/core | 检查 | 修复批次 | 应用 issue fixes | 检查点 | 当前问题 | PDF 字节 | 引用模式 | 外部验证 | 原稿 |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| `ui-smoke-docx` | 0.1.0-alpha.18 | 4 | 1 | 5 | 3 | 13 | 251,661 | `structure_only` | 不适用 | unchanged |
| `ui-smoke-epub` | 0.1.0-alpha.18 | 4 | 1 | 2 | 3 | 5 | 178,234 | `structure_only` | EpubCheck failed：0 fatal / 5 error / 0 warning；Ace failed：8 项断言 | unchanged |

最终制品：

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `Oak-Manuscript-0.1.0-alpha.18-Windows-x64.exe` | 189,984,819 | `d55899aa6681d420d90523a7c8e3fa46d91f8342cce64ea2435f9e71b8351e05` |
| `Oak-Manuscript-0.1.0-alpha.18-Windows-x64.zip` | 233,800,734 | `34c26fab7d1c733acda82b34047bea9d7b36d5f247c54ec970a9c6ec0250547a` |
| `SHA256SUMS.txt` | 224 | `ce0b771be470db5ed3a3c61adb037d9f443bfdfb89554f8cabb4ae1e7a8f65d6` |

证据边界：Electron 与 Windows builder 的机器来源证据已成立，但 `human_review_status=pending`。两个 blocker 均由 `*_PROVENANCE_AUDIT_REQUIRED` 收窄为 `*_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，总数没有下降；源码/packaged blocker 仍为 16/11。制品未签名，真实安装生命周期、干净机、macOS/Web、生产服务及正式售卖元数据均未验收。

## 历史验证结论：0.1.0-alpha.17 Temurin/JRE 来源机器证据与 Windows 制品检查点

验证日期：2026-07-28。工作区：`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`。用户已明确允许下载；本轮从 Eclipse Adoptium 官方 GitHub release 获取 Temurin 21.0.11+10 ZIP、checksum、build metadata、detached signature、release API JSON，并从官方 Adoptium 端点获取公钥。所有 packaged GUI 进程隐藏执行，实际安装器未运行。

| 命令 / 检查 | 结果 | 关键事实 |
|---|---|---|
| `npm run verify:provenance:jre:win` | **PASS** | 官方 ZIP 205,073,954 字节 / `d3625e7c…0a64`；GitHub server digest、checksum 和 build metadata 匹配；官方 ZIP与本机 JDK 均 490 文件 / 343,822,457 字节，490/490 原字节一致；证据 SHA-256 `dbbf5e47…d676` |
| jlink 派生与许可材料 | **机器范围有界 PASS，人工范围待办** | 固定模块/参数生成 207 文件 / 52,384,264 字节；94 个 NOTICE/legal 文件原字节保留；detached signature 与公钥已固定但本机无 OpenPGP verifier，状态 `not_verified_no_openpgp_tool` |
| 最终 `npm test` | **PASS** | 墙钟 168 秒；Node 338 total / 331 pass / 0 fail / 7 skip（3.315 秒）；Python 351 total / 0 failures / 0 errors / 3 skipped（113.909 秒） |
| 首轮受限 `npm run build:win` | **packaged provenance 阶段退出 1** | 前序 staging/source/fuse/build 已通过；新校验器误按源码 `tools/jre-win32-x64/manifest.json` 读取打包后重映射为 `tools/jre/manifest.json` 的文件，正确 fail-closed；修复后独立 packaged 门禁通过 |
| 受限 GUI smoke 对照 | **按环境退出，不计产品失败或通过** | 文件沙箱内 Electron GPU 子进程以 `0xC0000135` 退出；Electron 75 文件锁与二进制完整。没有采用 `--no-sandbox` 或图形开关弱化验收；获准外层隐藏原始 smoke 33.1 秒 PASS |
| 最终外层隐藏 `npm run build:win` | **PASS** | 206.5 秒；JRE/Ace staging、源资源、9 fuse、NSIS/ZIP、packaged 资源、原始隐藏 smoke 与发布证据同链退出码 0 |
| `npm run release:evidence:verify:win` | **PASS** | NSIS/ZIP、SHA256SUMS 与 canonical manifest 全量交叉复验 |
| `npm run verify:install-lifecycle:win` | **PASS（只读预检）** | 当前 alpha.17 与归档 alpha.12 的哈希/大小/manifest/PE 匹配；`authorized=false`、`ready_for_authorized_run=true`；未启动安装器 |
| packaged 资源门禁 | **PASS（alpha）** | 66 个应用 loose 文件、真实 `app.asar` 锚点、全 9 fuse 与 CPython/EpubCheck/Temurin-JRE provenance 通过；packaged sale blocker 仍为 11 项 |
| 真实安装生命周期 | **未运行** | 会写 HKCU、Desktop 与 Start Menu；未取得本轮系统写入授权，不能写成通过 |

最终 packaged smoke 运行根：`out/packaged-smoke/runs/ms4tv80b-a5166595d558e0e3/projects/`。

| 项目 | APP/core | 检查 | 修复批次 | 应用 issue fixes | 检查点 | 当前问题 | PDF 字节 | 引用模式 | 外部验证 | 原稿 |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| `ui-smoke-docx` | 0.1.0-alpha.17 | 4 | 1 | 5 | 3 | 13 | 251,667 | `structure_only` | 不适用 | unchanged |
| `ui-smoke-epub` | 0.1.0-alpha.17 | 4 | 1 | 2 | 3 | 5 | 178,243 | `structure_only` | EpubCheck failed：0 fatal / 5 error / 0 warning；Ace failed：8 项断言 | unchanged |

最终制品：

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `Oak-Manuscript-0.1.0-alpha.17-Windows-x64.exe` | 189,974,477 | `88f9a97e619cb9bd82f024a788a2c7b1780cab467098fe07b87975c0bae1b06f` |
| `Oak-Manuscript-0.1.0-alpha.17-Windows-x64.zip` | 233,789,900 | `d995766daaf96b72a46680c72b924228b964d38eab6e5bf7a8ed63b152be95a3` |
| `SHA256SUMS.txt` | 224 | `2d02b825aadd645ee38aeeebd4db0c93a8aef46cc1373a98558c81c289102b34` |

证据边界：Temurin/JRE 来源的机器证据已成立，但 `human_review_status=pending`，OpenPGP 未验签。packaged blocker 从 `JRE_SOURCE_PROVENANCE_AUDIT_REQUIRED` 收窄为 `JRE_SOURCE_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，总数没有下降；源码/packaged blocker 仍为 16/11。制品仍未签名，真实安装生命周期、干净机、macOS/Web 与生产服务均未验收。

## 历史验证结论：0.1.0-alpha.16 EpubCheck 来源机器证据与 Windows 制品检查点

验证日期：2026-07-28。工作区：`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`。用户已明确允许下载；本轮只从 W3C/DAISY 官方 GitHub release 获取 EpubCheck 5.3.0 审计输入。Windows 构建使用仓库内已锁定工具；所有 packaged GUI 进程隐藏执行，实际安装器未运行。

| 命令 / 检查 | 结果 | 关键事实 |
|---|---|---|
| `npm run verify:provenance:epubcheck` | **PASS** | 官方 ZIP 33,071,108 字节 / `6c07e685…f6c5`；GitHub release API 服务端 digest 同值；官方/本地均 49 文件 / 36,263,890 字节，49/49 原字节一致；证据 SHA-256 `2f519114…35b0` |
| EpubCheck 许可/签名范围 | **机器范围有界 PASS，人工范围待办** | 随包/仓库为 BSD-3-Clause，当前官网首页为 MIT，`license_signal_consistent=false`；tag 签名与生成 ZIP 的直接绑定未独立验证；第三方再分发义务未签核 |
| 最终 `npm test` | **PASS** | 墙钟 154.3 秒；Node 334 total / 327 pass / 0 fail / 7 skip（3.231 秒）；Python 351 total / 0 failures / 0 errors / 3 skipped（103.297 秒） |
| 首份 alpha.16 构建与审读 | **构建 PASS，制品随后作废** | 初始全链通过后，代码审读发现 ZIP 哈希与外部“官方解压目录”之间缺直接绑定；没有将该弱证据保留为最终制品，原五文件逐项验哈希后归档到 `release/archive/0.1.0-alpha.16-superseded-pre-zip-binding/` |
| `npm run build:win` | **PASS** | 193.8 秒；JRE/Ace staging、源资源、9 fuse、NSIS/ZIP、packaged 资源、隐藏 smoke 与发布证据全链退出码 0 |
| `npm run release:evidence:verify:win` | **PASS** | NSIS/ZIP、SHA256SUMS 与 canonical manifest 全量交叉复验 |
| `npm run verify:install-lifecycle:win` | **PASS（只读预检）** | 当前 alpha.16 与归档 alpha.12 的哈希/大小/manifest/PE 匹配；`authorized=false`、`ready_for_authorized_run=true`；未启动安装器 |
| packaged 资源门禁 | **PASS（alpha）** | 64 个应用 loose 文件、真实 `app.asar` 锚点、全 9 fuse 与五类运行资源通过；packaged sale blocker 仍为 11 项 |
| 真实安装生命周期 | **未运行** | 会写 HKCU、Desktop 与 Start Menu；仍需另行系统写入授权，不能写成通过 |

最终 packaged smoke 运行根：`out/packaged-smoke/runs/ms4se5k4-0d1d2a33a1dd2017/projects/`。

| 项目 | APP/core | 检查 | 修复批次 | 应用 issue fixes | 检查点 | 当前问题 | PDF 字节 | 引用模式 | 外部验证 | 原稿 |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| `ui-smoke-docx` | 0.1.0-alpha.16 | 4 | 1 | 5 | 3 | 13 | 251,656 | `structure_only` | 不适用 | unchanged |
| `ui-smoke-epub` | 0.1.0-alpha.16 | 4 | 1 | 2 | 3 | 5 | 178,238 | `structure_only` | EpubCheck failed：0 fatal / 5 error / 0 warning；Ace failed：8 项断言 | unchanged |

最终制品：

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `Oak-Manuscript-0.1.0-alpha.16-Windows-x64.exe` | 189,956,597 | `c5d02da1fcf64f44f75e22b2d884d64660f6669932e8cce0499711051ca02d02` |
| `Oak-Manuscript-0.1.0-alpha.16-Windows-x64.zip` | 233,770,875 | `74ac191bfdc3feb1585f1760326ffa31a9f489912143f7810743ffda021842dd` |
| `SHA256SUMS.txt` | 224 | `122d42aa2e8bf3505dd7b7700d0f74f65cf02f07d5f3b16c99e195ebe2aec567` |

证据边界：EpubCheck 来源的机器证据已成立，但 `human_review_status=pending`。packaged blocker 由 `EPUBCHECK_PROVENANCE_AUDIT_REQUIRED` 收窄为 `EPUBCHECK_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，总数没有下降；源码/packaged blocker 仍为 16/11。制品仍未签名，安装生命周期、干净机、macOS/Web 与生产服务均未验收。

## 历史验证结论：0.1.0-alpha.15 CPython 来源机器证据与 Windows 制品检查点

验证日期：2026-07-28。工作区：`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`。用户已明确允许下载；本轮只从 Python 官方站点获取 CPython 3.13.14 审计输入。Windows 构建使用仓库内已锁定工具；所有 packaged GUI 进程隐藏执行，实际安装器未运行。

| 命令 / 检查 | 结果 | 关键事实 |
|---|---|---|
| `npm run verify:provenance:python:win` | **PASS** | 官方 ZIP 10,964,839 字节 / `90b4e5b9…d907`；34 个官方文件与 34 个本地文件，33 个原字节一致，唯一受控差异为 `_pth` 精确追加；证据 SHA-256 `b198a727…3176` |
| CPython Sigstore/SPDX | **机器范围 PASS，人工范围待办** | artifact digest、leaf signature、证书 identity、Rekor body 与 SPDX supplier/license 通过；完整 Fulcio/Rekor 信任链和 GPG 未验证；上游 tlog entry/proof index 不一致已原样保留 |
| 最终 `npm test` | **PASS** | 墙钟 111.8 秒；Node 329 total / 322 pass / 0 fail / 7 skip（3.203 秒）；Python 351 total / 0 failures / 0 errors / 3 skipped（103.904 秒） |
| 首次 `npm run build:win` | **最后一步退出 1** | builder、9 fuse、packaged 资源和 smoke 已全部 PASS；发布摘要生成器因根 `release/` 混有已归档 alpha.14 制品而正确拒绝，未生成不完整证据 |
| 归档复核与 `npm run release:evidence:win` | **PASS** | 根/归档 alpha.14 三个制品逐文件哈希一致后，仅删除根旧制品；对前序门禁和 smoke 已通过的 alpha.15 字节生成 canonical 摘要 |
| `npm run release:evidence:verify:win` | **PASS** | NSIS/ZIP、SHA256SUMS 与 canonical manifest 全量交叉复验 |
| `npm run verify:install-lifecycle:win` | **PASS（只读预检）** | 当前 alpha.15 与归档 alpha.12 的哈希/大小/manifest/PE 匹配；`authorized=false`、`ready_for_authorized_run=true`；未启动安装器 |
| packaged 资源门禁 | **PASS（alpha）** | 62 个应用 loose 文件、真实 `app.asar` 锚点、全 9 fuse 与五类运行资源通过；packaged sale blocker 仍为 11 项 |
| 真实安装生命周期 | **未运行** | 会写 HKCU、Desktop 与 Start Menu；仍需另行系统写入授权，不能写成通过 |

最终 packaged smoke 运行根：`out/packaged-smoke/runs/ms4qixuz-15ab5ab26e07949e/projects/`。

| 项目 | APP/core | 检查 | 修复批次 | 应用 issue fixes | 检查点 | 当前问题 | PDF 字节 | 引用模式 | 外部验证 | 原稿 |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| `ui-smoke-docx` | 0.1.0-alpha.15 | 4 | 1 | 5 | 3 | 13 | 251,656 | `structure_only` | 不适用 | unchanged |
| `ui-smoke-epub` | 0.1.0-alpha.15 | 4 | 1 | 2 | 3 | 5 | 178,401 | `structure_only` | EpubCheck failed：0 fatal / 5 error / 0 warning；Ace failed：8 项断言 | unchanged |

最终制品：

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `Oak-Manuscript-0.1.0-alpha.15-Windows-x64.exe` | 189,951,730 | `d701bf0fee5766a17ba33c351ec46a3cafd00da147154cf4006d2711cabbb15e` |
| `Oak-Manuscript-0.1.0-alpha.15-Windows-x64.zip` | 233,765,446 | `9ac0252699b77bf80bc14ce1f7119526c29b22e79fde4171760541fbbf0f5511` |
| `SHA256SUMS.txt` | 224 | `aa281383f8cada7c641dccf8648f94a6bd6e306980bfb9206ca94df2fd08f697` |

证据边界：CPython 来源的机器证据已成立，但 `human_review_status=pending`；packaged blocker 由 `PYTHON_RUNTIME_PROVENANCE_AUDIT_REQUIRED` 收窄为 `PYTHON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，总数没有下降。制品仍未签名，安装生命周期、干净机、macOS/Web 与生产服务均未验收。

## 历史验证结论：0.1.0-alpha.14 Windows 安装生命周期验收工具检查点

验证日期：2026-07-28。工作区：`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`。本轮没有联网。实际安装器未运行；所有 packaged GUI 进程隐藏执行。

| 命令 / 检查 | 结果 | 关键事实 |
|---|---|---|
| 安装生命周期专项 | **12/12 PASS** | 旧制品/证据篡改、完整 SemVer、x86 NSIS/x64 APP、零授权零启动、路径边界、完整九阶段、回装未启动、降级成功时 fail-closed 与清理重试 |
| 最终 `npm test` | **PASS** | 墙钟 110.8 秒；Node 323 total / 316 pass / 0 fail / 7 skip（3.032 秒）；Python 351 total / 0 failures / 0 errors / 3 skipped（103.078 秒） |
| 两次受限 `npm run build:win` | **在 packaged smoke 阶段退出 1** | electron-builder、afterPack 9 fuse、packaged 资源均已通过；Codex 外层受限令牌阻止 Electron sandbox 子进程，GPU/Renderer 返回 `0xC0000135`；失败时没有生成新发布证据 |
| alpha.13 归档制品同环境对照 | **同样 `0xC0000135`** | 排除 alpha.14 代码/打包漂移；诊断性 `--no-sandbox` 能进入项目流程，但不作为验收证据 |
| 外层隐藏 `npm run smoke:packaged:win` | **SMOKE-RESULT PASS** | 34.7 秒；Electron `sandbox: true` 保持开启；强制应用内 EpubCheck/Ace；运行根见下 |
| `npm run release:evidence:win` + verify | **PASS** | 只在真实 smoke PASS 后生成；NSIS/ZIP、SHA256SUMS、canonical manifest 交叉绑定 |
| `npm run verify:install-lifecycle:win` | **PASS（只读预检）** | 当前 alpha.14 与归档 alpha.12 哈希/大小/manifest/PE 全部匹配；`authorized=false`；未创建生命周期运行目录或启动安装器 |
| 真实安装生命周期 | **未运行** | 会写 HKCU、Desktop、Start Menu，尚未取得本轮单独系统写入授权；不能写成通过 |

最终 packaged smoke 运行根：`out/packaged-smoke/runs/ms4oftya-1a2f6ac1ad56c4cd/projects/`。

| 项目 | APP/core | 检查 | 修复批次 | 应用 fixes | 检查点 | 当前问题 | PDF 字节 | 引用模式 | 外部验证 | 原稿 |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| `ui-smoke-docx` | 0.1.0-alpha.14 | 4 | 1 | 5 | 3 | 13 | 251,659 | `structure_only` | 不适用 | unchanged |
| `ui-smoke-epub` | 0.1.0-alpha.14 | 4 | 1 | 2 | 3 | 5 | 178,401 | `structure_only` | EpubCheck failed：0 fatal / 5 error / 0 warning；Ace failed：8 项断言 | unchanged |

最终制品：

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `Oak-Manuscript-0.1.0-alpha.14-Windows-x64.exe` | 189,946,367 | `e8ff13a093aa48d25de74afbbd9311676ec8afb9037bcafee946d4bcdac21647` |
| `Oak-Manuscript-0.1.0-alpha.14-Windows-x64.zip` | 233,759,796 | `15e8a34e5ee35806d12e452b991ff1c7db867827278262af7ba931c5f631da9b` |
| `SHA256SUMS.txt` | 224 | `131e76c4e2797db8692c21ed857313f28de970c0225a10402cfa76d0b7716d11` |

证据边界：安装编排器已经实现且预检通过，不等于安装器已执行。历史 alpha.12 NSIS 是否会覆盖 alpha.14 当前未知；真实探测必须在另行授权后进行。Windows 制品仍未签名，packaged 资源门禁仍保留 11 项 sale blocker。

## 历史验证结论：0.1.0-alpha.13 Electron 43 全 fuse 固定检查点

验证日期：2026-07-28。工作区：`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`。用户已批准本轮依赖下载；实际 Windows 构建使用仓库内已锁定离线工具，Electron 与 Chrome 均以隐藏进程运行。

| 命令 / 检查 | 结果 | 关键事实 |
|---|---|---|
| `npm install --save-exact @electron/fuses@2.1.3` | **完成** | 顶层锁定 2.1.3；electron-builder 内部 1.8.0 保持隔离；未执行 `audit fix --force` |
| fuse / afterPack / packaging 定向测试 | **PASS** | 42 total / 41 pass / 0 fail / 1 skip；含全 9 项写入、单 wire/未来未知项、API 漂移、实际 Framework 路径与 macOS arm64 临时签名策略 |
| 最终 `npm test` | **PASS** | 墙钟 157.8 秒；Node 310 total / 303 pass / 0 fail / 7 skip（3.236 秒）；Python 351 total / 0 failures / 0 errors / 3 skipped（104.469 秒） |
| `npm run verify:resource-trust` | **PASS** | 59 文件 / 1,942,368 字节；manifest `1117ec70…4397`；ASAR anchor `89d17399…2179` |
| 最终 `npm run build:win` | **PASS** | 300.3 秒；afterPack 文件身份复核、独立 fuse 回读、packaged 资源、隐藏 smoke 和证据生成全部通过 |
| `npm run verify:packaged:fuses:win` | **PASS** | Electron 43 wire v1 索引 0—8 全部精确匹配；`WasmTrapHandlers=true`；unknown 0、blocker 0、fully known |
| `npm run verify:packaged:win` | **PASS（alpha）** | 真实 `app.asar` 锚点、59 个 loose 应用文件和四类运行锁通过；packaged blocker 11 项 |
| `npm run smoke:packaged:win` | **SMOKE-RESULT PASS** | 强制应用内 EpubCheck/Ace；DOCX/EPUB 全闭环；项目路径进程残留 0 |
| `npm run release:evidence:verify:win` | **PASS** | 独立稳定读取 NSIS/ZIP、SHA256SUMS 与 canonical manifest 并交叉核对 |

最终 packaged smoke 运行根：`out/packaged-smoke/runs/ms4mqaar-f6f3d43d55a2726d/projects/`。

| 项目 | APP/core | 检查 | 修复批次 | 应用 fixes | 检查点 | 当前问题 | PDF 字节 | 引用模式 | 外部验证 | 原稿 |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| `ui-smoke-docx` | 0.1.0-alpha.13 | 4 | 1 | 5 | 3 | 13 | 251,655 | `structure_only` | 不适用 | unchanged |
| `ui-smoke-epub` | 0.1.0-alpha.13 | 4 | 1 | 2 | 3 | 5 | 178,394 | `structure_only` | EpubCheck failed：0 fatal / 5 error / 0 warning；Ace failed：8 项断言 | unchanged |

最终制品：

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `Oak-Manuscript-0.1.0-alpha.13-Windows-x64.exe` | 189,944,918 | `2a5ffcfa2ca47e925f1b65b3e44521038fc20fc760cbfdd86307ec0ae50e1851` |
| `Oak-Manuscript-0.1.0-alpha.13-Windows-x64.zip` | 233,758,073 | `0ecbbcd5eae20af3da5d50c9d398d64f76c3d93d3f978a3fa103ebd27745ddae` |
| `SHA256SUMS.txt` | 224 | `c37b7a4cee9ca2ca8617fd913c9293f74fbc55fc7ea3bc0d6ad0fc5d7076fed4` |

证据边界：

- 第一次全量回归按设计发现版本变更后的受信资源清单陈旧；使用显式 `resource_trust_manifest.js --update-lock` 事务更新后复验和全量回归通过，没有放宽校验；
- 顶层新版工具明确索引 8 为 `WasmTrapHandlers`。afterPack 设置 `strictlyRequireAllFuses=true`，写后立即回读；真实 EXE 的独立回读同样无未知项；
- packaged 资源门禁仍保留 11 项 sale blocker，制品未签名；fuse 兼容性 blocker 已关闭不等于可售卖；
- 打包资源 `.pyc` 为 0，烟测退出后项目路径进程为 0；
- 尚未执行干净 Windows 安装、升级、卸载、无开发环境验证或 Authenticode；macOS/Web/生产账号同步也未验收；
- `npm install` 报告 28 项依赖审计告警（11 moderate、17 high）。本轮没有用自动强制修复改写依赖树；正式依赖来源/漏洞/许可证审计仍是 sale blocker 的一部分。

## 历史验证结论：0.1.0-alpha.12 Windows 可安装 alpha

验证日期：2026-07-28。工作区：`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`。用户已批准下载；构建、Electron 与 Chrome 均以隐藏进程运行。

| 命令 / 检查 | 结果 | 关键事实 |
|---|---|---|
| `npm run download:builder:win` | **PASS** | 固定 NSIS、NSIS resources、winCodeSign 三归档下载并逐份匹配大小/SHA-256 |
| builder 安全导入 + 独立锁 | **PASS** | 只选择 Windows winCodeSign payload；385 文件 / 19,150,116 字节；lock SHA-256 `8bb0221d…1aa4` |
| `npm test` | **PASS** | 墙钟 89.434 秒；Node 306 total / 300 pass / 0 fail / 6 skip（3.096 秒）；Python 351 total / 0 failures / 0 errors / 3 skipped（39.652 秒） |
| `npm run build:win` | **PASS** | 最终重建退出码 0；真实 fuse、packaged 资源、隐藏 smoke 和证据生成全部通过 |
| `npm run verify:packaged:fuses:win` | **PASS（alpha）** | 8 个已知 fuse 精确匹配；索引 8 未知，保留 `ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING` |
| `npm run verify:packaged:win` | **PASS（alpha）** | 真实 `app.asar` 锚点、59 个 loose 应用文件和四类运行锁通过；packaged blocker 11 项 |
| `npm run smoke:packaged:win` | **SMOKE-RESULT PASS** | 强制应用内 EpubCheck/Ace；DOCX/EPUB 全闭环；项目路径进程残留 0 |
| `npm run release:evidence:verify:win` | **PASS** | 重新稳定读取 NSIS/ZIP、SHA256SUMS 与 canonical manifest 并交叉核对 |

最终 packaged smoke 运行根：`out/packaged-smoke/runs/ms4lg2cv-ab0de58b69b46495/projects/`。

| 项目 | APP/core | 检查 | 修复批次 | 应用 fixes | 检查点 | 当前问题 | PDF 字节 | 引用模式 | 外部验证 | 原稿 |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| `ui-smoke-docx` | 0.1.0-alpha.12 | 4 | 1 | 5 | 3 | 13 | 251,654 | `structure_only` | 不适用 | unchanged |
| `ui-smoke-epub` | 0.1.0-alpha.12 | 4 | 1 | 2 | 3 | 5 | 178,232 | `structure_only` | EpubCheck failed：0 fatal / 5 error / 0 warning；Ace failed：8 项断言 | unchanged |

最终制品：

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `Oak-Manuscript-0.1.0-alpha.12-Windows-x64.exe` | 189,944,468 | `42c38acaeb98cf98e4871ad1a8d7fc1225bdab3bd6c1c2149b3bf27ff03603bf` |
| `Oak-Manuscript-0.1.0-alpha.12-Windows-x64.zip` | 233,758,044 | `d99052ac1b803a58859f64b9c8874a9ef5de3118f7155f77b1789d5cc884adf2` |
| `SHA256SUMS.txt` | 224 | `a3bd9c58662fd92bbfa19b681c3c42ae95a43e7552bd8283cc51eec2a0ddfed3` |

证据边界：

- Python 调用使用 `-I -B -S -X utf8`；打包资源探针和烟测后 `release/win-unpacked/resources` 内 `.pyc`/`__pycache__` 数为 0；
- `GrantFileProtocolExtraPrivileges=false` 时，直接 `file://...app.asar/...` 会由 Electron 43 返回 `ERR_FILE_NOT_FOUND`；受限 `oak-manuscript://` 只提供四个固定渲染文件并已通过真实 packaged smoke；
- packaged 资源门禁的 11 项 blocker与未知 fuse、未签名状态都仍有效；生成安装器不等于可售卖正式版；
- 尚未执行干净 Windows 安装、升级、卸载、无开发环境验证或 Authenticode；macOS/Web/生产账号同步也未验收。

## 历史验证结论：0.1.0-alpha.11 ASAR 资源信任根

验证日期：2026-07-28。工作区：`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`。本轮未联网、未运行 electron-builder、未生成安装器/ZIP/发布证据；已按授权在独立隐藏窗口运行 alpha.11 源码 UI smoke。

| 命令 / 检查 | 结果 | 关键事实 |
|---|---|---|
| `npm test` | **PASS** | 墙钟 171.3 秒；Node 301 total / 294 pass / 0 fail / 7 skip（3.313 秒）；Python 351 total / 0 failures / 0 errors / 3 skipped（110.355 秒） |
| `npm run verify:resource-trust` | **PASS** | 58 个应用 loose 文件、1,873,018 字节；manifest `377f03b0…f95e`；ASAR anchor `1b52a14f…c644` |
| `npm run verify:standards` | **PASS** | `oak-standards 2.0.0`，manifest SHA-256 `0aff75eb181a62869147e9af27330c717bc808bdd23865197534fc9868568427` |
| `npm run stage:ace` | **PASS** | Ace 1.4.6：236 包、6,672 文件、58,969,045 字节；stage 与 tracked lock 一致 |
| `npm run verify:electron-runtime` | **PASS** | Electron 43.1.0 win32-x64：2 目录、75 文件、364,083,658 字节 |
| `npm run verify:resources:win` | **PASS（alpha）** | Python core `0.1.0-alpha.11`；运行探针通过；源码证据仍完整报告 17 项 sale blocker |
| `npm run verify:fuses:config` | **PASS** | ASAR/integrity/known fuses exact；`run_as_node_disabled=true` |
| 资源信任 + packaging + fuse 定向测试 | **42 pass / 0 fail / 1 skip** | 包括真实 `app.asar` 读取、loose 伪锚点拒绝、资源/锁/平台漂移与启动顺序 |
| `$env:OAK_SMOKE_EXTERNAL_VALIDATION='1'; npm run smoke` | **SMOKE-RESULT PASS** | 78.1 秒；alpha.11 DOCX/EPUB 全闭环；EPUB 真实运行 EpubCheck/Ace；退出后 profile/Electron 进程均为 0 |

alpha.11 隐藏 smoke 运行根：`out/source-smoke/runs/ms4eowx9-64e0aab5311e2a99/projects/`。

| 项目 | APP/core | 检查 | 修复批次 | 应用 fixes | 检查点 | 当前问题 | PDF 字节 | 引用模式 | 外部验证 | 原稿 |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| `ui-smoke-docx` | 0.1.0-alpha.11 | 4 | 1 | 5 | 3 | 13 | 251,654 | `structure_only` | 不适用 | unchanged |
| `ui-smoke-epub` | 0.1.0-alpha.11 | 4 | 1 | 2 | 3 | 5 | 178,235 | `structure_only` | EpubCheck failed：0 fatal / 5 error / 0 warning；Ace failed：8 项断言 | unchanged |

资源信任证据边界：

- `config/tool-manifests/app-resources-v1.json` 精确固定 Python 核心、`config/` 和 `samples/` 将 loose 分发的文件；清单自身排除以避免自引用；
- `electron/resource-trust-anchor.json` 随代码进入 ASAR，固定应用清单原始摘要和 win32-x64 Python/EpubCheck/JRE/Ace 四份 tracked lock 摘要；
- packaged 门禁通过 `@electron/asar` 从实际 `app.asar` 读取锚点，并在前后复核 ASAR 身份；资源树拒绝额外/缺失/变更文件、平台替换、symlink/reparse、hardlink 与竞态；
- 构造 packaged fixture 使用真实生成的 `app.asar`，完整证据下 blocker 从 17 减到 12；删除 `app.asar` 后验证失败。该测试只证明代码路径，不是 `release/` 中的产品包、fuse wire、代码签名或安装验收；
- 源码 `verify:resources:win` 的锚点证据明确标记 `packaged=false`、`protected_by_app_asar=false`，所以 5 个可信根 blocker 一个也没有提前关闭；
- 当前没有 macOS 四份目标锁，锚点只含 win32-x64；macOS 打包尝试必须失败关闭，不能复用 Windows 目标。
- smoke 标志之后又直接读取两个 `project.json`、最新检查报告与 PDF 交叉核对；两项目 `source_hash_ok=true`，各有 4 次检查、1 个批量修复记录和 3 个检查点，且没有遗留 `oak-ace-chrome-*` profile 或 Electron 进程。该证据仍是源码 UI，不是 packaged 资源或安装器证据。

## 历史验证结论：0.1.0-alpha.10 Ace 受控 utilityProcess 与 RunAsNode 关闭

验证日期：2026-07-28。工作区：`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`。本轮未联网、未下载 builder 归档、未运行 electron-builder，也未生成安装器、ZIP 或发布证据。

| 命令 / 检查 | 结果 | 关键事实 |
|---|---|---|
| `npm test` | **PASS** | 墙钟 119.4 秒；Node 295 total / 288 pass / 0 fail / 7 skip（2.461 秒）；Python 351 total / 0 failures / 0 errors / 3 skipped（112.121 秒） |
| `npm run verify:standards` | **PASS** | `oak-standards 2.0.0`，manifest SHA-256 `0aff75eb181a62869147e9af27330c717bc808bdd23865197534fc9868568427` |
| `npm run stage:ace` | **PASS** | Ace 1.4.6：236 包、6,672 文件、58,969,045 字节；stage 与 tracked lock 一致 |
| `npm run verify:electron-runtime` | **PASS** | Electron 43.1.0 win32-x64：2 目录、75 文件、364,083,658 字节 |
| `npm run verify:fuses:config` | **PASS** | ASAR/integrity/known fuses exact；`run_as_node_disabled=true` |
| `npm run verify:resources:win` | **PASS（alpha）** | Python core `0.1.0-alpha.10`；运行探针通过；17 项 sale blocker 仍机器可读保留 |
| `$env:OAK_SMOKE_EXTERNAL_VALIDATION='1'; npm run smoke` | **PASS** | 隐藏 Electron 完成 DOCX/EPUB UI 闭环，并真实执行 EPUB 外部验证 |
| `npm run release:evidence:verify:win` | **按设计退出 1** | 缺 `Oak-Manuscript-0.1.0-alpha.10-Windows-x64.exe`；没有生成伪证据 |
| `npm run verify:packaged:fuses:win` | **按设计退出 1** | `release/win-unpacked` 不存在；没有真实 packaged fuse 证据 |

真实隐藏 smoke 运行根：`out/source-smoke/runs/ms4cz6o9-c2ad021ca7e2e83c/projects/`。

| 项目 | 格式 | APP/core | 检查次数 | 修复批次 | 检查点 | 当前问题 | 实际应用 fixes | PDF 字节 | 外部验证 | 原稿 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| `ui-smoke-docx` | DOCX | 0.1.0-alpha.10 | 4 | 1 | 3 | 13 | 5 | 251,649 | 不适用 | unchanged |
| `ui-smoke-epub` | EPUB | 0.1.0-alpha.10 | 4 | 1 | 3 | 5 | 2 | 178,228 | EpubCheck failed：0 fatal / 5 error / 0 warning；Ace failed：整体 fail、8 项断言 | unchanged |

本轮新增证据边界：

- Renderer 不能提交 Ace 模块、命令、环境或状态；主进程生成并持有绑定项目状态、标准身份和工具文件身份的计划，Python prepare/finalize 复核同一计划；
- Ace 只在固定 Electron `utilityProcess` 中执行；合并输出上限 64 KiB，最长 5 分钟，净化注入环境；主进程启动精确系统 Chrome，使用独立 profile 和随机 loopback DevTools 端点，结束后 profile 残留为 0；
- 源码 smoke 证明受控链路能真实运行并正确报告缺陷，但不证明打包路径、ASAR/fuse 联合边界、自带浏览器或 OS 级网络隔离；因此 `ACE_CONTROLLED_HELPER_PENDING` 仍作为 packaged 证据 blocker 保留；
- Electron 43 未知 fuse 仍是资源门禁之外的独立 sale 条件阻断；本轮没有猜测其语义。

## 历史验证结论：0.1.0-alpha.9 Electron ASAR 与 fuse 发布硬化合同

验证日期：2026-07-28。工作区：`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`。本轮未联网、未下载 builder 归档、未运行 electron-builder，也未生成安装器、ZIP 或发布证据。

| 命令 / 检查 | 结果 | 关键事实 |
|---|---|---|
| `node --test tests/electron_fuse_policy.test.js` | **6/6 PASS** | exact 构建配置、已知 wire、未知 fuse 的 alpha/sale 分流、不安全/缺失/硬链接二进制拒绝及构建顺序 |
| `npm run verify:fuses:config` | **PASS** | ASAR 开启、ASAR integrity 未禁用；8 个已知 fuse 与 Darwin 签名选项逐项固定；`RunAsNode=true` 明确为临时值 |
| fuse/packaging/release 定向 Node 测试 | **49 total / 48 pass / 1 skip / 0 fail** | 新合同与已有打包、资源、发布证据链兼容；跳过项不计作通过 |
| `npm test` | **PASS，退出码 0；墙钟 121.2 秒** | Node 284/277/0/7（2.350 秒）；Python 348/0 failures/0 errors/3 skipped（114.170 秒） |
| `npm run verify:standards` | **PASS** | `oak-standards 2.0.0` sequence 2；manifest `0aff75eb…8427` |
| `npm run verify:electron-runtime` | **PASS** | Electron 43.1.0 win32-x64：2 目录、75 文件、364,083,658 字节 |
| `npm run verify:resources:win` | **PASS（alpha）** | Python core `0.1.0-alpha.9`；JRE/EpubCheck 探针通过；既有 17 项 sale blocker 仍报告 |
| Windows `sale` 资源门禁 | **按设计退出 1** | 17 项既有资源 blocker 未关闭；这是独立于 packaged fuse 兼容性门禁的结果 |
| `npm run verify:resources:mac:static` | **按设计退出 1** | 缺 darwin x64/arm64 Electron dist、两架构 Python runtime manifest 与 JRE |
| `npm run release:evidence:verify:win` | **按设计退出 1** | 缺 `Oak-Manuscript-0.1.0-alpha.9-Windows-x64.exe`；没有生成伪证据 |
| 沙箱外隐藏 `npm run smoke` | **SMOKE-RESULT PASS** | `out/source-smoke/runs/ms49yas5-9ccb167e78f033a2/projects/`；DOCX/EPUB 全闭环 |

### Fuse 证据与限制

- `package.json` 明确要求 `asar=true`、`disableAsarIntegrity=false`，并固定所有本地工具已知 fuse；构建脚本在 builder 前执行配置校验，在 builder 后首先验证真实应用二进制；
- 验证器拒绝仓库外路径、不安全父链、symlink/reparse、hardlink、空文件和读取期间身份变化；wire 版本和每个已知状态都必须精确匹配；
- 本机 `node_modules/electron/dist/electron.exe` 为 Electron 43.1.0，实际 fuse wire 版本 1、索引 0—8 共 9 项；`@electron/fuses` 1.8.0 只定义索引 0—7；
- 未知索引 8 的原始状态为 `49`（enabled）。本地没有可信定义可判断名称/语义，因此测试和文档都不猜测；alpha 返回 `ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING`，sale 抛错；
- `RunAsNode=true` 仍用于当前 Ace helper；它通过“当前固定配置”测试不代表达到正式硬化目标。受控 helper 完成后必须改为 `false`；
- 仓库没有 alpha.9 打包产物，所以 `verify:packaged:fuses:*` **未在真实应用二进制上运行**。源码 Electron runtime 的调查结果只证明工具兼容性缺口，不是 packaged fuse 验收证据；
- 既有 Windows sale 资源门禁仍明确列出 17 项 blocker；未知 packaged fuse 是构建后验证器的额外条件阻断，不把它加入或伪改既有 17 项统计。

### 真实 smoke 证据

| 项目 | 格式 | APP | 检查 | 修复记录 | 检查点 | 当前问题 | applied fixes | PDF 字节 | 源稿哈希 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| `ui-smoke-docx` | DOCX | 0.1.0-alpha.9 | 4 | 1 | 3 | 13 | 5 | 251,650 | unchanged |
| `ui-smoke-epub` | EPUB | 0.1.0-alpha.9 | 4 | 1 | 3 | 5 | 2 | 177,417 | unchanged |

## 最新验证结论：0.1.0-alpha.8 统一账号、权益与 SyncRecord v1 离线契约

验证日期：2026-07-28。工作区：`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`。本轮未联网，未调用生产账号/支付/同步服务，未下载 builder 归档，未生成安装器、ZIP 或发布证据。

| 命令 / 检查 | 结果 | 关键事实 |
|---|---|---|
| 账号/同步定向 Node 测试 | **PASS** | Auth 登录/退出/过期/撤销状态、Free/Pro/宽限、SyncRecord allowlist/禁止字段、JSON Schema 一致性、登录/确认门禁、幂等/取消/重试/删除、可信 IPC/preload 与安全 UI |
| `python -m unittest python.tests.test_sync_source` | **4/4 PASS** | `sync-source` exact allowlist、结构问题记录、内容/路径/文件名/哈希反泄露、无检查/非法事件 fail-closed |
| `npm test` | **PASS，退出码 0；墙钟 93.7 秒** | Node 278/271/0/7（2.389 秒）；Python 348/0 failures/0 errors/3 skipped（86.468 秒） |
| `npm run verify:standards` | **PASS** | `oak-standards 2.0.0` sequence 2；manifest `0aff75eb…8427` |
| `npm run verify:electron-runtime` | **PASS** | Electron 43.1.0 win32-x64：2 目录、75 文件、364,083,658 字节 |
| `npm run verify:resources:win` | **PASS（alpha）** | Python core 探针返回 `0.1.0-alpha.8`；JRE/EpubCheck 好坏样本矩阵通过；17 项 sale blocker 仍作为 blocker 报告 |
| Windows `sale` 资源门禁 | **按设计退出 1** | 17 项 blocker 未关闭；账号/同步离线契约不减少来源、许可、可信根、Ace 隔离或签名阻断 |
| `npm run verify:resources:mac:static` | **按设计退出 1** | 缺 darwin x64/arm64 Electron dist、两架构 Python runtime manifest 与 JRE |
| `npm run release:evidence:verify:win` | **按设计退出 1** | 缺 `Oak-Manuscript-0.1.0-alpha.8-Windows-x64.exe`；没有生成伪证据 |
| 沙箱外隐藏 `npm run smoke` | **SMOKE-RESULT PASS** | `out/source-smoke/runs/ms48q9hr-05f6b99b193cf33d/projects/`；DOCX/EPUB 全闭环，另断言未登录、Free 权益、空同步队列 |

### 同步安全证据

- Python `sync-source` 由项目路径与标准身份门禁保护，只返回随机项目 ID、检查 ID、文件格式/类型/配置/语言/长度枚举、引用枚举、版本、结构化问题五字段、外部验证和导出状态；不返回标题、解释、位置、预览、文件名、项目路径、用户名、引用原文或哈希；
- 主进程再用 `buildSyncRecordV1` 精确取字段并调用 `validateSyncRecordV1`；tracked `config/schemas/sync-record-v1.schema.json` 的根属性和 required 集与运行时样本有一致性测试；
- 未知字段、`filename`、`path`、`title`、`preview`、`sha256`、`content_fingerprint` 注入均被 validator 拒绝；构造器面对带内容的原始 issue 也只输出 `rule_id/severity/dimension/status/fixable`；
- Renderer 的 preload 没有“发送任意 payload”接口。预览 IPC 只接收可信项目路径、`check|export` 与布尔选项，确认 IPC 只接收已缓存预览的幂等 ID 和四种固定选择；伪造 record 被忽略；
- 未登录时预览失败且队列保持空；只打开预览不入队；`not_now` 与 `never_for_project` 不入队；同一幂等 ID 重复确认只有一个队列项；取消、重试、删除状态有测试；
- 未登录请求在调用 Python `sync-source` 前即拒绝；缓存预览绑定当时账号，退出会清空全部预览，切换账号后旧预览失效；
- UI 使用 `textContent` 与 `replaceChildren` 逐字段显示，不用同步数据拼 `innerHTML`。导出完成后异步询问失败只更新提示，不改变已完成的本地导出。

### 当前实现边界（不得省略）

- 生产 Auth 未配置，真实 `beginLogin` 返回 `configuration_required`，不开网页、不联网；测试模拟登录不是生产登录；
- 模拟 License 没有签名证据，`signatureVerified=false`；生产签名授权缓存、设备服务和支付不存在；
- 同步队列只存在于当前 Electron 进程，`pending_transport` 不是上传成功；没有加密持久队列、网络 transport、Supabase 表、网站用户后台或云端查看/导出/删除；
- `project.json.sync` 继续保持既有 `never_asked` / 空历史格式；alpha.8 没有把当前进程模拟队列伪写为云端同步历史；
- 默认 Electron session 继续拒绝网络。未来生产 Provider 必须使用独立最小权限传输，不能修改这条基线。

### 真实 smoke 证据

| 项目 | 格式 | APP | 检查 | 修复记录 | 检查点 | 当前问题 | applied fixes | PDF 字节 | 源稿哈希 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| `ui-smoke-docx` | DOCX | 0.1.0-alpha.8 | 4 | 1 | 3 | 13 | 5 | 251,660 | unchanged |
| `ui-smoke-epub` | EPUB | 0.1.0-alpha.8 | 4 | 1 | 3 | 5 | 2 | 177,267 | unchanged |

首次在普通沙箱内启动 GUI smoke 时，Electron GPU 子进程因沙箱环境退出，业务步骤尚未开始、项目目录为空；临时 GPU 绕行导致 Renderer 不进入业务流程，已全部撤回。随后按用户已授权的隐藏窗口方式在沙箱外运行原始 smoke 配置并通过。只有后者计作本轮业务证据；没有残留 Electron 进程。

## 最新验证结论：0.1.0-alpha.7 Windows 发布制品证据链

环境：Windows 11；Python 3.14.6；Node 24.16.0；npm 11.13.0；Electron 43.1.0；Java 21.0.11。

| 命令 | 结果 | 说明 |
|---|---|---|
| `node --test tests/release_artifact_manifest.test.js` | **6 项：5 通过、0 失败、1 跳过；0.162 秒** | 确定性 SHA/manifest、坏 PE/ZIP、旧制品、版本漂移、链接/硬链接、篡改、两文件回滚和 clear 全预检；文件 symlink 因本机 `EPERM` 条件跳过 |
| `npm run test:node` | **267 项：260 通过、0 失败、7 跳过；2.597 秒** | 分项终检；新增 6 项发布证据测试，跳过项不计作通过 |
| `npm run test:python` | **344 项：0 失败、0 错误、3 跳过；83.537 秒** | 分项终检；核心版本为 alpha.7 |
| 最终 `npm test` | **PASS；退出码 0；墙钟 88.1 秒** | Node 267/260/0/7（2.487 秒）；Python 344/0/0/3（80.833 秒） |
| `npm run verify:standards` | **PASS** | `oak-standards 2.0.0` sequence 2，manifest `0aff75eb…8427` |
| `npm run verify:electron-runtime` | **PASS** | Electron 43.1.0 win32-x64：2 目录、75 文件、364,083,658 字节 |
| `npm run verify:resources:win` | **PASS（alpha）** | 实际执行 Python/JRE/EpubCheck 探针；Python core `0.1.0-alpha.7`；仍返回 17 项 sale blocker |
| `npm run verify:resources:mac:static` | **按预期退出 1** | 缺 darwin-x64/arm64 Electron dist、Python runtime manifest 与 JRE；未执行探针 |
| 独立隐藏窗口 `npm run smoke` | **SMOKE-RESULT PASS** | `out/source-smoke/runs/ms47c3l8-9b6bf78452308a33/projects/`；DOCX/EPUB 均 4 次检查、1 次修复、3 个检查点、原稿哈希不变，问题 13/5、applied fixes 4/2、PDF 251,656/177,263 字节 |
| `npm run release:evidence:verify:win` | **按预期退出 1** | 真实 `release/` 只有 `.gitkeep`，明确拒绝缺失的 `Oak-Manuscript-0.1.0-alpha.7-Windows-x64.exe`，没有创建证据 |

发布证据专项证明：

- package.json、package-lock 根版本与应用身份必须一致；只接受精确当前版本 `Oak-Manuscript-<version>-Windows-x64.exe/.zip`，同系列旧文件不被忽略；
- 制品在单一文件描述符上分块哈希，并在打开前、打开后和读取后核对文件身份、大小、单链接和真实路径；NSIS 至少通过 MZ/PE 结构，ZIP 同时通过头部与 EOCD 结构；
- `SHA256SUMS.txt` 固定有序的两条摘要；canonical manifest 固定产品、appId、版本、win32/x64、种类、字节数/摘要，并固定 SHA 文件原始字节摘要；验证器重读当前制品、SHA 文件和 manifest 全量交叉核对；
- 两份证据用独占候选和 `fsync` 写入后联合提交；第二次 rename 或最终复验失败会恢复两份旧文件。clear 会在删除第一份前预检两份目标，链接/硬链接不会被删除；
- `build:win` 首项清除旧证据，末尾顺序为 packaged 资源门禁 → 隐藏 packaged smoke → 新证据生成。任何前序失败均不会产生本次发布证据。

本轮没有用户联网授权，没有执行 `download:builder:win` 或 `build:win`。真实三归档、工具树、独立 tracked lock、NSIS、ZIP、packaged smoke、干净系统和签名仍未完成；因此真实 `SHA256SUMS.txt` 与 release manifest 也不存在。源码检查点标签为 `chatgpt-v0.1.0-alpha.7`，不代表二进制发行。

## 上一检查点：0.1.0-alpha.6 Windows builder 受控下载入口

环境：Windows 11；Python 3.14.6；Node 24.16.0；npm 11.13.0；Electron 43.1.0；Java 21.0.11。

| 命令 | 结果 | 说明 |
|---|---|---|
| `node --test tests/builder_archive_download.test.js` | **11/11 PASS** | 固定 URL、显式联网、零授权零写入、受限重定向、容量/哈希、事务提交/回滚、旧文件/未知条目、路径/链接均有正反向覆盖；测试使用注入的内存/本地响应，没有联网 |
| `npm run test:node` | **261 项：255 通过、0 失败、6 跳过；2.683 秒** | 分项终检；跳过项不计作通过 |
| `npm run test:python` | **344 项：0 失败、0 错误、3 跳过；95.203 秒** | 分项终检；核心版本已推进到 alpha.6 |
| 最终 `npm test` | **PASS；退出码 0；墙钟 97.2 秒** | Node 261/255/0/6（2.627 秒）；Python 344/0/0/3（89.446 秒） |
| `npm run verify:standards` | **PASS** | 标准内容未变化：`oak-standards 2.0.0` sequence 2，manifest `0aff75eb…8427` |
| `npm run verify:electron-runtime` | **PASS** | Electron 43.1.0 win32-x64：2 目录、75 文件、364,083,658 字节 |
| `npm run verify:resources:win` | **PASS（alpha）** | 实际执行 Python/JRE/EpubCheck 探针；Python core 报告 `0.1.0-alpha.6`；仍返回 17 项 sale blocker |
| `npm run verify:resources:mac:static` | **按预期退出 1** | 缺 darwin-x64/arm64 Electron dist、Python runtime manifest 与 JRE；未执行探针 |
| 独立隐藏窗口 `npm run smoke` | **SMOKE-RESULT PASS** | `out/source-smoke/runs/ms46fhdh-230a41fd46481179/projects/`；DOCX/EPUB 均 4 次检查、1 次批量修复、3 个检查点、原稿哈希不变，PDF 251,661 / 177,434 字节 |

下载器专项证明：

- `SOURCE_ARCHIVES` 同时固定三份 electron-builder 官方 GitHub release URL、文件名和 SHA-256；信任值不从响应或下载内容生成；
- 无 `--allow-network` 时先于目录创建和请求失败；`build:win`、`dist` 和 test 脚本不引用下载器；
- 初始 URL 只接受 HTTPS 固定仓库路径；重定向限于明确的 GitHub release asset 主机、最多 5 次，拒绝凭据、非 HTTPS 和 fragment；
- 默认输出 `out/downloads/windows-builder/`，禁止仓库外路径、链接父链、未知条目和覆盖错误既有文件；
- 每档限制 128 MiB、30 秒闲置，使用独占候选和 `fsync`；三份全部验 SHA-256 后才提交，并发目标碰撞会回滚本事务已安装文件而保留外来文件。

本轮**没有用户联网授权**，所以没有执行 `npm run download:builder:win`，没有发出网络请求，也没有下载三份真实归档。真实工具树、独立 tracked lock、NSIS、ZIP、packaged smoke、干净系统和签名仍均未完成。源码检查点标签为 `chatgpt-v0.1.0-alpha.6`，不代表二进制发行。

## 1. 上一检查点：0.1.0-alpha.5 引用解析、标准包 2.0.0 与 Windows alpha 资源

环境：Windows 11；Python 3.14.6；Node 24.16.0；npm 11.13.0；Electron 43.1.0；Java 21.0.11。

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run test:node` | **TAP 250 项：244 通过、0 失败、6 跳过；2.650 秒** | 新增引用计划 IPC/UI、packaged smoke 确认顺序和切换稿件会话清理回归；跳过项不计作通过 |
| Electron runtime 锁专项 | **37 项：36 通过、0 失败、1 跳过** | hardlink 与 junction 反向路径本机实测通过；文件 symlink 因 Windows `EPERM` 条件跳过，不计作通过 |
| `npm run test:python` | **344 项：0 失败、0 错误、3 跳过；80.191 秒** | 含结构信号、引用计划、报告、升级重算、历史 CAS 与缺失 release fail-closed 回归 |
| 最终 `npm test` | **PASS；退出码 0；墙钟 160.5 秒** | Node 250/244/0/6（2.675 秒）；Python 344 项、0 失败、0 错误、3 跳过（88.790 秒）；不以较早超时运行代替本次完整证据 |
| `npm run verify:standards` | **PASS** | `oak-standards 2.0.0` / `oak-rules 2.0.0`（sequence 2）；manifest/rulepack/capability SHA-256 为 `0aff75eb…8427` / `098b382e…97a4` / `af67d0aa•320e` |
| `npm run verify:electron-runtime` | **PASS** | Electron 43.1.0 win32-x64：2 目录、75 文件、364,083,658 字节；manifest SHA-256 `ae67132b…520d95` |
| 沙箱外隐藏 Electron `npm run smoke` | **SMOKE-RESULT PASS** | 最新运行根 `out/source-smoke/runs/ms44nzhb-8186d1b3c5148eba/projects/`；DOCX/EPUB 先确认引用解析、各 4 次检查、`source_hash_ok=true`，PDF 为 251,646 / 177,416 字节 |
| `npm run verify:resources:win` | **PASS（alpha）** | Windows x64 Python/JRE/EpubCheck/Ace 全量文件和真实探针通过 |
| `node scripts/verify_packaged_resources.js --platform win32 --arch x64 --release-tier sale --no-runtime-probe` | **预期退出 1：17 blockers** | Electron 全树锁只关闭 trust-root 缺失项；正式来源审计、builder、Ace 隔离和签名仍未完成 |
| `node scripts/run_electron_builder.js --win --x64` | **预期退出 1** | 真实 builder 工具树和 tracked lock 缺失；在 electron-builder 启动前 fail-closed，未联网、未生成安装包或 ZIP |
| `npm run verify:resources:mac:static` | **按预期 FAIL，不执行探针** | 精确缺 darwin-x64/arm64 Electron dist、两架构 Python runtime 锁、`tools/jre-darwin-x64` 与 `tools/jre-darwin-arm64`；静态逻辑可执行不等于 macOS 可构建 |

当前 `0.1.0-alpha.5` 的源码检查点标签为 `chatgpt-v0.1.0-alpha.5`，用途仅是标记源码与本地验证状态。测试没有产生同版本 NSIS、ZIP 或其他可分发二进制；本轮没有联网。

## 2. alpha.5 引用解析、标准可信链、运行资源与发布门禁覆盖

### 默认引用体例解析与确认

- Python 单元/集成测试覆盖语言样本阈值、编号引用、作者—年份、注释—书目、体例能力门禁、结构冲突、低置信度、EPUB 部分提取和用户显式选择；
- `plan-citation` 经 CLI 子进程验证为严格只读；`citation_plan_id` 绑定项目 manifest、source/working、问题、当前标准身份与解析结果，旧计划或状态改变均拒绝；
- Renderer/IPC 回归验证检查前先显示全部解析结果、取消不检查，确认后才携带 plan ID；packaged smoke 契约也必须先走同一确认流程；
- 报告与导出回归确认 `citation_resolution` 在 project settings、settings snapshot、check result、JSON/Markdown/HTML 和出版摘要中一致；证据只含数量、百分比和枚举；
- 规则包升级回归证明：用户显式体例保留，默认解析清空后在新包重算；旧项目需要当时的已验证 release 仍在本地 CAS，否则 fail-closed，不静默换成 active release；
- 真实 UI smoke 首轮因漏确认引用计划失败，修正后 DOCX 通过；随后暴露切换到 EPUB 时复用 DOCX 项目，通过在切换输入/目录时清空 session 修复，最终双样本 PASS。

### Electron 运行时完整树锁

- `config/tool-manifests/electron-43.1.0-win32-x64.json` 固定 2 个目录、75 个文件、364,083,658 字节，原始文件 SHA-256 为 `ae67132b95e21b62450fd0e34faaf00164514b38322076c56e37c0301c520d95`；
- tracked manifest 必须通过严格 JSON 重复键拒绝、owned levels 的 exact schema 和生成器定义的唯一 canonical UTF-8/LF 原始字节校验；
- 锁同时核对 package-lock 的 Electron 版本、resolved 与 integrity，以及实际 dist 的必需文件、目录集合、文件集合、大小和逐文件 SHA-256；默认命令只读，只有显式 `--update-lock` 才写入；
- `--update-lock` 在任何写入前验证安全父链与 realpath 并拒绝目标 symlink/hardlink；候选文件独占创建、写入后 `fsync`，复核父链/目标身份后原子替换，再做换入后严格 JSON/schema/canonical 字节及全树验证。失败恢复旧字节；回滚自身失败会明确报错并保留候选/备份等事务证据；
- Node 反向测试覆盖文件增删/篡改、目录多出、manifest 重复/多列、非 canonical 字节、package-lock 漂移、硬链接、junction/symlink、cross-dist marker 自刷、tracked-file 更新故障和 `electronDist` 禁下载 sentinel；专项结果为 37/36/0/1，hardlink/junction 本机实测通过，文件 symlink 因 Windows `EPERM` 条件跳过；
- 源码和 packaged 资源门禁都重验仓库源码构建输入。有效锁证据仅关闭 `ELECTRON_RUNTIME_TRUST_ROOT_NOT_HARDENED`；官方来源、校验和、再分发与签名责任仍保留。

### Windows builder 固定归档导入与独立 lock

- 来源合同独立固定三份归档：`nsis-3.0.4.1.7z` SHA-256 `9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa`、`nsis-resources-3.4.1.7z` SHA-256 `593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103`、`winCodeSign-2.6.0.7z` SHA-256 `cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4`；
- 显式导入器固定本地 7z EXE/DLL，预检归档技术清单，拒绝 UNC/device 来源、逃逸/绝对/保留/冲突路径、链接、备用流、加密/反条目和容量异常；解压后再核对全树、大小、realpath、硬链接与归档哈希；
- 组装的 manifest 和 `config/tool-manifests/electron-builder-win32-x64.json` 独立 lock 交叉绑定来源归档、manifest 原始字节和完整工具树。只有显式 `--update-lock` 才能联合事务提交；普通 build/test 不会导入或刷新；
- 反向测试覆盖缺档/多档/错哈希、路径与链接、缺关键载荷、严格 JSON/schema、manifest 字节漂移、不安全祖先 junction、旧 tree/lock 硬链接，以及 4 个前向/4 个回滚 rename 故障；回滚自身失败会保留事务恢复证据；
- 本机没有真实三归档，所以没有实际工具树或 tracked lock。导入测试使用构造载荷验证算法，不是正式来源或可打包证据。

### 标准包身份、存储与项目升级

- 当前 `config/standard-packs/oak-standards-2.0.0.manifest.json` canonical SHA-256 为 `0aff75eb181a62869147e9af27330c717bc808bdd23865197534fc9868568427`；规则包原始字节 SHA-256 为 `098b382e33c06ccddf154940fbbd51db384d8025cf235ed7f7e10e83d34897a4`，capability digest 为 `af67d0aaf2ece431ec1b617934bdfa3627b6be1b1301a92fcf3b2b2f29ca232e`；1.0.0 manifest `d33534f0…d7af` 是精确 rollback target，仅在已验证历史 CAS release 存在时可用；
- Node 正向/反向测试覆盖严格重复键与 Unicode/深度/大小/日期/HTTPS 校验、能力映射、Ed25519 门槛签名、内容寻址存储、bundle/版本/序列唯一性、高水位、撤回/过期/APP 兼容性、精确 rollback target、跨进程 owner token、崩溃恢复与未知状态 fail-closed；
- 内置 release 离线 bootstrap、重新验证 active identity、本地签名包预览/安装与全局回滚路径通过；由于生产 trust digest 为空，真实本地签名包导入按设计禁用，未被误记为可用；
- Python 测试覆盖 manifest/payload/CAS 重验、七字段项目 pin、Electron `OAK_EXPECTED_STANDARD_IDENTITY` 精确绑定、历史 release 解析、升级/降级差异、计划过期、写锁争用、检查点、issues 归档、原子提交、升级后强制重检，以及检查/报告/修复/导出拒绝陈旧身份；
- migration-source 回归证明撤回、过期与 APP 兼容性可以在显式迁移路径中受控放宽，但 capability digest 和逐规则 milestone/auto-fix/fix ID 映射永不放宽；
- Renderer/IPC 测试证明项目目标 digest 由主进程选择，UI 只显示项目与 active 的完整差异并一次确认。全局升级不会静默改变已有项目；
- 当前没有标准包在线检查、下载、断网重试或生产签名/撤回服务，因此这些网络路径没有运行，也不能写成通过。

### Windows Python 运行时

- 受版本控制的清单覆盖 **34 个文件、21,260,753 字节**，逐文件固定相对路径、大小和 SHA-256；
- 检查平台/架构、PE 文件、Python 版本、必需 DLL/ZIP/许可证及 `python313._pth` 隔离语义；
- 缺文件、多文件、哈希篡改和不安全 `_pth` 配置均有 Node 反向测试并会被拒绝；
- 只有全量资源和所有全局门禁均无错误后才允许执行 Python 探针；本轮 Windows alpha 门禁已实际执行探针并读到核心版本 `0.1.0-alpha.5`；
- Electron、smoke 与资源探针统一通过净化环境及 `-I -S -X utf8` 固定 bootstrap 调用核心，拒绝工作目录、用户 site 和继承的 Python/OAK 环境注入；
- macOS x64/arm64 CPython 目标版本均固定为 `3.13.14`；这是清单契约与反向测试证据，不是实际 macOS 运行时已经到位的证据。

### JRE 与 EpubCheck

- JRE 清单覆盖 **207 个文件、52,384,264 字节**；固定来源 JDK 输入锁、裁剪模块、Java 版本、平台/架构、许可证和全部文件哈希；
- EpubCheck 5.3.0 完整分发清单覆盖 **49 个文件、36,263,890 字节**，包括 JAR、依赖、schemas 和许可证；缺失、多余、篡改或符号链接均拒绝；
- JRE 内 EpubCheck 探针同时执行好样本和缺陷样本：好样本必须退出 0 且零错误，缺陷样本必须非零退出且报告错误；任何一边结果不符均不通过；
- JRE 的 staged runtime 与受版本控制 lock 作为同一事务提交；目录换入或 lock 提交失败会恢复旧运行时和旧 lock 的原始字节；
- macOS 锁文件按 `darwin-x64` / `darwin-arm64` 分开选择，不会复用 Windows 锁；对应资源尚未准备，所以 macOS 门禁如实失败。

### Ace

- 阶段包覆盖 **236 个包、6,672 个文件、58,964,235 字节**，仅含生产依赖闭包；受版本控制的 `ace-1.4.6.json` full lock 固定 stage manifest 哈希、包数、文件数和字节数；
- 所有包、文件、许可证材料和依赖可达性均校验；staging 与资源 gate 都拒绝空许可证文件；stage 与 tracked lock 事务失败会恢复旧目录和旧 lock；
- 固定、审核并哈希校验一个 XHTML 隔离替换：作者 XHTML 在 JavaScript 禁用状态下加载，作者脚本/事件处理器/危险嵌入被移除，加载协议限制到受控范围；
- packaged 模式只能使用随包资源，不会回退到开发树或 PATH；非零 Ace 退出一律记为 `not_run`，不把运行异常伪装成“发现无障碍问题”；
- 最新沙箱外隐藏 Chrome `OAK_TEST_ACE=1` 已真实执行 Ace 好/坏样本并通过；同轮受限运行器没有生成安全报告，两个 Ace 断言如实得到 `not_run`，随后在原生隐藏浏览器环境重跑通过。18 个使用生成元数据通知的包仍缺原始许可证审计，全部 236 包仍缺来源、许可证、版权和再分发义务人工审计；OS 级网络隔离、受控 helper 和自带浏览器也仍属于正式发布阻断项。
- tracked full lock 同时固定解析语义与 `tools/ace/manifest.json` 原始字节 SHA-256；仅改变空白/序列化而保持 JSON 语义等价也会被拒绝。

### 确定性清单与 macOS 执行边界

- 文件清单、模块数组和 canonical JSON 统一使用 JavaScript UTF-16 code-unit 比较，不依赖宿主 locale、ICU 或用户排序规则；参与字节级锁定的清单和 Ace 替换固定 LF checkout；
- `build:mac:x64` 与 `build:mac:arm64` 只能在相应 darwin 原生 runner 执行资源探针和构建；聚合 `build:mac` 只派发当前主机的原生架构，不伪造另一架构；
- `verify:resources:mac:static` 是跨主机静态聚合，显式设置 `--no-runtime-probe`；报告必须保持 `runtime_probe_executed=false`；
- 当前两架构 Electron/Python/JRE 资源均不完整，因而静态聚合失败是正确结果，不能写成 macOS 构建或运行通过。

### Windows sale 门禁

alpha 门禁实际执行运行时探针并通过；当前源码 sale 门禁以以下 16 项机器可读 blocker 按设计失败，真实 alpha.18 packaged ASAR 关闭其中 5 个 loose 可信根项后保留 11 项：

1. `FORMAL_LICENSE_AUDIT_REQUIRED`：Ace 18 个依赖包仍需正式人工许可证审计；
2. `PYTHON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
3. `EPUBCHECK_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
4. `JRE_SOURCE_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
5. `EPUBCHECK_TRUST_ROOT_NOT_HARDENED`；
6. `JRE_TRUST_ROOT_NOT_HARDENED`；
7. `PYTHON_RUNTIME_TRUST_ROOT_NOT_HARDENED`；
8. `APP_RESOURCES_TRUST_ROOT_NOT_HARDENED`；
9. `ELECTRON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
10. `BUILDER_TOOLCHAIN_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
11. `ACE_FULL_LICENSE_AUDIT_REQUIRED`：Ace 完整生产依赖闭包的正式人工审计；
12. `ACE_TRUST_ROOT_NOT_HARDENED`；
13. `ACE_CONTROLLED_HELPER_PENDING`；
14. `ACE_BROWSER_RUNTIME_PENDING`；
15. `ACE_OS_NETWORK_ISOLATION_PENDING`；
16. `WINDOWS_CODE_SIGNING_PENDING`。

packaged 门禁关闭上列第 5、6、7、8、12 项；关闭依据是真实资源/ASAR 锚点复验，不是人工豁免。

因此当前只可表述为“Windows alpha 源码资源门禁通过”，不能表述为“安装包已完成”“正式版已通过”或“可售卖”。

## 3. alpha.5 项目、路径、IPC 与桌面安全覆盖

### Electron 默认离线与 PDF 隔离

- 正常启动在 `app.ready` 前应用固定离线 Chromium switches，并在默认 session 取消 `http/https/ws/wss/ftp` 请求；Renderer 固定 CSP 继续禁止远程脚本和主动嵌入；
- 未来获用户授权的联网 Provider 必须使用独立受限传输/session，不能解除默认 session 的进程级离线基线；
- 源码 smoke 只接受仓库内 Electron，项目、临时目录、userData、缓存、HOME/APPDATA/XDG 与 crash dumps 均固定在 `out/source-smoke/`；越界输入在启动 Electron 前拒绝；
- PDF 样张使用不带 `persist:` 的专用内存 session，`cache=false`，并设置 `javascript=false`；PDF CSP 只为自包含报告保留内联样式和 `data:` 图片，禁止脚本、连接、对象、frame、媒体、表单和 base；
- PDF 窗口拒绝导航、重定向和新窗口。`report.html` 在加载前记录真实路径/文件身份，加载后再次核对未变化；输出只允许 `exports/report_preview.pdf`，父目录与目标身份在写入前后复核，链接、联接、硬链接、目录换入和项目根逃逸均 fail-closed，同目录暂存后原子换入。

### 项目 schema、跨进程写锁与无污染创建

- `Project.open()` 在任何业务写入前验证项目根、六个固定子目录、`project.json`、source/working、检查结果、issues、检查点和修复记录的 schema、ID、序号、精确相对路径、类型、独立文件身份、大小与 SHA-256；链接、目录联接、reparse、硬链接、绝对路径、`..` 或清单路径逃逸均拒绝；
- `create/check/recheck/fix/export/verify/restore-checkpoint/external/issue` 统一进入单项目、非阻塞跨进程内核写锁；`plan-fixes` 与 `list-checkpoints` 保持只读。Windows 使用固定字节区内核锁，macOS/POSIX 使用 `flock`；进程崩溃由内核自动释放互斥，持久锁文件只作诊断，不依据可能陈旧的 PID 删除；
- 争用立即返回 `PROJECT_WRITE_LOCKED`，包括 `retryable=true` 与当前 owner 的 PID、命令、取得时间和进程 token；失败方不覆盖项目或锁元数据；不同项目不互相阻塞；
- 创建命令在锁前完成纯只读门禁。缺输入、不支持格式、非空目标、普通同名锁文件或不安全目标失败时，目标树结构、类型、大小、mtime 与内容哈希保持不变；
- 锁内只打开一次用户输入。最终打开对象必须为常规文件，允许 OneDrive/reparse/symlink 只读入口；同一 FD 复制并 `fsync` 到 `source`，复制后复核 dev/inode/size/mtime，再仅从受控 `source` 生成 `working`。复制期间变化或任一步失败时，只按本事务记录的文件身份回收；新根无残留、用户原有空目录保留且恢复为空、旧协议锁恢复原始字节；
- 自选 `out_dir` 的完整父链逐级拒绝链接、联接和非常规目录；项目内自选目录只允许位于 `exports/`。修订稿、报告、摘要和可选 EPUB 的全部目标在写入首个字节前统一预检；已有链接/硬链接目标拒绝，每个文件同目录暂存、`fsync` 后原子换入。

### CLI / IPC 结果与回归证据

- Python 结构化错误固定为 `code/message/retryable/details`；项目验证、锁争用和锁协议异常不再只返回不可分类字符串；
- `Project.verify()` 逐份读取对应检查报告，拒绝坏 JSON、非对象、错误 schema/check ID 与规则包身份漂移；新记录严格核对七字段，真实旧 `1.0` 记录按 `{name, version}` 降级证明兼容，规则包升级后的新旧两代历史报告可并存；
- Electron 桥保留退出码 1 的有效业务 JSON（包括 `verify` 的非致命完整性结果），退出码 2 或 `ok=false` 错误按失败处理；结构化错误字段完整传到 IPC 外层；
- 主要反向测试位于 `tests/offline_policy.test.js`、`tests/renderer_security.test.js`、`tests/pdf_preview.test.js`、`tests/path_policy.test.js`、`tests/core_result.test.js`、`tests/p0_ipc_contract.test.js`、`python/tests/test_project_validation.py` 和 `python/tests/test_project_write_lock.py`；当前计数见第 1 节。

## 4. P0 批量修复覆盖（alpha.1 起，alpha.5 默认回归通过）

### 批量计划与确认

- `plan-fixes` 不写 working、issues、project 或检查点；
- 计划 ID 绑定项目 ID、working SHA-256、完整问题集、规则包名称/版本/内容哈希和完整候选集合；
- 缺失、错误、异项目或过期 `plan_id` 均拒绝；
- UI 声明数量与预览行数不一致时拒绝应用；
- 取消计划后复检数量不变；
- 同一 `fix_id` 中存在 rejected 问题时整类排除，全文 fixer 不会顺带修改已拒绝位置；
- TAB 每个实际位置生成独立 issue；3 个 TAB = 3 个预览项 = 3 次替换；
- SPACE / PUNCT 每个连续命中片段一项，空段按“连续 N 个”整组说明，EPUB lang 每资源一项，MIME 每包一项。

### 事务与检查点

- 格式解析和机械修改先在临时 working 副本完成；
- 注入 working / issues / project 提交失败后，工作稿、问题文件、manifest 和内存状态恢复；
- 已有 5 个检查点时，注入新检查点后的提交失败，被裁剪旧目录会恢复，完整检查点树不变；
- 检查点保存 working、issues、项目状态和被引用的检查结果，并逐文件校验哈希；
- 恢复前建立安全检查点；目标换入后失败或最终 save 失败时，完整项目树逐字节恢复；
- 成功恢复仍最多保留 5 个检查点，并保护目标与安全检查点；
- 缺失、损坏、重复 ID、路径越界或符号链接项在核心拒绝；UI 标为不可恢复并禁止选择；
- `list-checkpoints` 与 `restore-checkpoint` 的 CLI 子进程测试通过。

### 批量修复 IPC 契约

- preload 实际在只允许 `require("electron")` 的 VM 沙箱测试中加载；
- Renderer 无直接 `fix()` 通道，只能 `planFixes` → `applyFixPlan(planId)`；
- P0 主进程对项目绝对路径和 opaque ID 做白名单校验；
- CLI `json.ok=false` 或退出码 2 不再被外层包装为成功；退出码 1 的有效检查 JSON 仍兼容；
- Electron 保持 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。

## 5. alpha.5 真实 UI 冒烟历史结果

沙箱外隐藏 Electron 最终结果：

```text
两类：先展示默认引用解析计划，确认后才检查
DOCX：因 conflicting_structures 退回 structure_only；最终当前问题 13
EPUB：因 extractor_coverage_insufficient 退回 structure_only；最终当前问题 5
两类：取消计划零写入 → 确认 → 检查点列表 → 撤销 → 重新计划并应用
两类：导出 5 文件 + PDF 样张 + verify 通过
Provider：未登录、不同步占位纪律通过；标准 Provider 离线验证通过
Electron：appVersion = 0.1.0-alpha.5；源码模式 packaged = false
Python core：项目 manifest.app_version = 0.1.0-alpha.5；检查报告 app_version = 0.1.0-alpha.5
标准身份：APP / 项目 / 检查记录 / 导出 report.json 七字段完全一致
SMOKE-RESULT: PASS
```

该次冒烟运行在 `show: false` 的独立隐藏窗口，不抢占用户当前应用窗口。当时的包装器把项目、缓存、临时目录、用户数据和崩溃目录全部限制在 `out/source-smoke/`；路径契约与完整 UI 均已实际验证。

alpha.5 当时的实际输出根为 `out/source-smoke/runs/ms44nzhb-8186d1b3c5148eba/projects/`；DOCX 与 EPUB 的 `project.json` 均记录 `app_version=0.1.0-alpha.5`、`integrity.source_hash_ok=true`，各有 4 次检查记录、1 次修复运行和 3 个检查点。`report_preview.pdf` 分别为 251,646 字节和 177,416 字节。完整身份为 `oak-rules 2.0.0`、`pinned=true`、release sequence 2，以及第 2 节列出的规则包/manifest digest。

### 失败与修复记录

alpha.5 首次冒烟在检查后直接断言问题数，未先确认新的引用解析计划；补齐该交互后 DOCX 通过。第二次在切换 EPUB 时暴露 Renderer 仍复用 DOCX 项目目录；新增切换稿件/项目目录时的会话重置并加入 Node 回归后，第三次双样本 PASS。

以下是 alpha.1 历史失败记录：

第一次 P0 冒烟真实失败：`Cannot read properties of undefined (reading 'listSamples')`。原因是 sandboxed preload 新增了本地 `require("./preload-p0-api")`；Electron 沙箱不允许该引用，导致整个 `window.oak` 未注入。

处理：保持 `sandbox: true` 不变，把四个 P0 方法直接放回 preload 固定白名单；Node 测试改为实际在受限 VM 中加载 preload。随后重跑真实 Electron 冒烟，PASS。

运行环境仍输出 Chromium cache / GPU cache 的“拒绝访问”诊断，但进程退出码为 0，功能、导出和 verify 全部通过。该诊断不等同于产品测试失败；打包版与干净系统测试时仍需复核。

## 6. 外部工具状态

| 工具 | 本轮事实 | 发布包事实 |
|---|---|---|
| EpubCheck 5.3.0 | alpha.7 Windows 资源门禁在 Java 21 环境真实运行；好样本通过、缺陷样本报告错误，双向状态矩阵通过 | 完整分发和 JRE 已进入资源门禁，但尚无 alpha.7 包；来源/再分发和可信根审计未完成 |
| Ace by DAISY 1.4.6 | tracked full lock、manifest 原始字节身份、空许可证拒绝和事务 stage 由默认回归覆盖；最新真实好/坏样本 Chrome 证据仍来自 alpha.4 检查点，alpha.7 本轮未重跑该条件套件 | 生产闭包和隔离替换通过 alpha.7 Windows 资源门禁，但尚无 alpha.7 包；helper/browser/OS 网络隔离/可信根、18 包原始许可证及全闭包人工审计未完成 |

因此当前可以说“alpha.7 源码、引用解析、标准身份链、Electron 构建输入、Windows 资源集和制品证据生成契约已固定，开发环境 EpubCheck 探针与 alpha 门禁通过”，不能说“alpha.7 发布包或 SHA 清单已经生成”，更不能说已通过正式售卖验收。

## 7. 尚未运行或尚未通过的发布级测试

- 0.1.0-alpha.7 Windows unpacked / ZIP / NSIS：**未生成**，因此打包后资源门禁、packaged smoke 和真实发布证据生成 **未运行**；
- Windows 干净系统首次安装、卸载、升级、无 Python/Node 环境运行：**未运行**；
- Windows 代码签名与 SmartScreen 信誉：**未运行**；
- macOS arm64 / x64：原生 runner、静态聚合、分架构 lock 路径和 CPython `3.13.14` 固定契约已实现；实际 Electron/Python/JRE 仍缺，构建、签名、公证、staple、Gatekeeper 和实机 smoke **未运行**；
- Web 服务端并发、隔离、TTL 删除、零留存、限额和账号联调：**未运行**；
- Free/Pro 订阅、支付 webhook、离线宽限和账号删除：**未运行**；
- 标准包严格校验、损坏/恶意包拒绝、本地签名存储、回滚、项目版本固定与显式升级：**已实现并通过自动化测试**；生产 trust pin、在线检查/下载、断网重试和服务端签名撤回分发：**未实现，未运行**；
- 受控作者/编辑人工内测：**未运行**。

## 8. 历史基线纠错

Claude 0.0.1 的现场基线复跑为：

- 默认：185 项，0 失败、0 错误、Ace 1 项跳过；
- `OAK_TEST_ACE=1`：仍是 185 项，0 失败、0 错误、无跳过。

旧报告“185 + Ace = 186 项”把同一条件测试重复相加，属于文档错误，现已废止。旧 0.0.1 打包版 smoke 的历史结果仍为 PASS，但不能替代当前 0.1.x 重新打包验证。
