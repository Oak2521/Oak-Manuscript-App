# DEVELOPMENT_STATUS — 开发状态（唯一状态来源）

> 更新日期：2026-08-17。新记录在上；“已完成”必须有本地测试或构建证据。

## 当前版本与基线

- 当前版本：`0.1.0-alpha.63`
- 当前分支：`codex/oak-10-manuscript-account`
- 当前源码标签：尚未创建；最新真实 Windows packaged 检查点为本分支的未签名 `0.1.0-alpha.63`
- GitHub：`Oak2521/Oak-Manuscript-App` 为 public；PR #2 已将 alpha.58 与 OSS 基础合并到默认分支 `main`，merge commit 为 `d4505e93da297ebedf45096a74a04e3f4e21ea95`。远端未配置提交状态 checks，合并证据是 GitHub mergeable 判定与本地全量测试，不冒充远端 CI
- 开源协作基础：Apache-2.0 `LICENSE`、英文 README 概览、`CONTRIBUTING.md`、`SECURITY.md` 和 npm 仓库/官网元数据已补齐并在远端 `main` 复核；未创建 GitHub Release，公开与合并状态均不改变 production-ready 判定
- 商业版权威方案：`docs/湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md`
- 只读 Claude 基线：0.0.1，提交 `16736147ed734a3be3535d43152719cf4b97a07e`，标签 `claude-0.0.1-baseline`
- 当前内置标准为 `oak-standards 2.1.0` / `oak-rules 2.1.0`（release sequence 3）：39 条规则、6 个白名单机械 fixer；alpha.58 新增 4 条不可自动修复的 TXT/Markdown 保守空白卫生提示。
- OAK-10 冻结合同：只读 Account Center 提交 `6aea9986539a0f55b2961426fa08e486a9e30b19`，状态 `FROZEN_FOR_CONSUMER_IMPLEMENTATION`；本仓库消费副本固定 16 个文件的字节与 SHA-256。仓库默认无 Production URL、真实公钥或凭据。

## GitHub Hosted 源码门候选（2026-08-17）

- `.github/workflows/hosted-ci.yml` 为 public repository 建立 Ubuntu 24.04 与 Windows 2025 双平台源码门：锁定安装、workflow 自校验、Electron runtime/迁移/标准/fuse 源码输入门、统一 Node/Python 测试。
- 权限固定 `contents: read`，checkout 不保留凭据，不读取 secrets，不上传 artifact，不发布或部署；官方 actions 固定完整 SHA。
- workflow 验证器以 TDD 建立：专项 2/2、本地自校验和 YAML 结构解析通过。远端 PR checks 尚待实际运行；在其完成前 `Hosted=false`。
- 此门不打包 Windows，不构建 macOS，也不关闭签名、公证、Staging、Production 或可售卖门禁。

## OAK-10 OAK-16 runtime 对齐补件（2026-08-17）

- 从 HEAD `97a7958aee29f8433e174b1a8fcf9edb059c0086` 的 10 文件未提交现场恢复；全部原文件保留并逐项审计。旧 HEAD 叠加新账户测试的隔离副本为 15 total / 4 pass / 11 fail，失败精确落在 Ed25519→ES256 与 revoke 响应契约，重建了遗留实现的 RED 证据。
- 冻结 Desktop Application Login 1.0 合同与 provenance 未改写；消费者对齐 OAK-16 已验收 runtime 的 ES256/P-256 JWKS、P1363 签名和 exact `{revoked:true}`。默认账号配置仍无 URL、公钥、凭据；新增真实 Staging consumer 测试默认跳过。
- 修复 Web verifier 信任锚可变性：构造时把受信 JWK 编译为独立 `KeyObject`，调用方事后替换 `x/y` 不再改变信任集合；TDD 先复现替换密钥签名被错误接受，再转绿。
- 最终 `npm test`：Node 767/760/0/7，Python 368/0/0/3。资源信任 131 文件 / 2,244,237 字节，manifest `e03de88c…cb68`、anchor `11d122fd…5380`。
- Alpha.63 离线 Windows 全链、packaged smoke、9 fuse、ASAR/资源探针和 schema v2 发行证据通过；NSIS `5ac3dc23…eb35`，ZIP `861fd3af…6a42`，unpacked EXE `210705cb…6036`。两份 EXE 均 `NotSigned`。
- Alpha.62 已完整归档到 `release/archive/0.1.0-alpha.62/`；安装验收从过期 Alpha.12 基线更新为 Alpha.62，13/13 单测与 Alpha.62→Alpha.63 只读预检通过。没有运行安装器。
- 状态保持：implemented=true、tested=true、packaged unsigned Windows=true；真实 Staging、deployed、signed、macOS packaged、production-ready、可售卖均为 false/未验证。OAK-10 仍为 `in_review`。

## OAK-10 重启恢复补件（2026-08-15）

- 权威 Taskboard 复核为 project `oak` / OAK-10 `in_review`；总控只接受 implemented/tested/packaged unsigned Windows alpha，不接受 staging/signed/deployed/production-ready。
- 恢复前 HEAD 为 `f7d14f027623975799224da4eb824e080aa451de`，工作树原为干净；Alpha.62 NSIS、ZIP、unpacked EXE 和 `SHA256SUMS.txt` 的字节/摘要与 2026-08-14 发行证据一致。
- 唯一明确仓库内补件是审计文档两处尾随空格，已修复。重启后合同、Node 761 项、fuse、packaged 资源/运行时探针、smoke 证据和 schema v2 发行证据全部复验通过。
- 受限 shell 首轮 Node 因临时目录创建被拒绝而 `EPERM`；诊断证明 PowerShell 和 Node 在同一项目路径均无法新建文件/目录，获准非受限运行后即恢复 755 pass / 0 fail。未因该环境假失败修改产品代码。
- 真实 Staging、Supabase/替代架构、干净机安装、签名、公证、部署、法务和可售卖身份仍是未授权/未通过门禁。

## 商业正式版路线状态

| 工作流 | 状态 | 现场事实 |
|---|---|---|
| OAK-10：Oak Account application-login | **完成（本地源码与 packaged）** | 系统浏览器、随机 loopback、PKCE S256、300 秒内存 access token、OS 加密轮换 refresh、v1 安全清除和生命周期失败关闭均有正反测试；默认待配置，不等于真实账号联调 |
| OAK-10：统一 owner 与 Pro 分离 | **完成（本地生产形状）** | 四个 Web 生产组合根本地验签 Oak access token，只用 `oak_account_id` 派生 owner；身份 claims 不授予 Pro，独立 signed entitlement 失败回落 Free；真实 Staging/数据库/撤销传播未验收 |
| OAK-10：显式同步与直传保留 | **完成（本地生产形状）** | 同步逐字段预览、一次确认、加密失败队列、幂等补偿、跨账号隔离和 S3 短期直传/一次领取/清扫均通过；无真实 endpoint、migration、桶/CORS 或官网 E2E |
| 开源许可与社区治理 | **完成（源码层）** | Apache-2.0 全文/SPDX、英文项目概览、贡献指南和私密漏洞报告政策已入库；不代表制品许可审计、签名或商业发布完成 |
| P0：集中预览与一次批量确认 | **完成（代码与测试）** | `plan-fixes` 只读；`fix` 强制 `plan_id`；全部离散修改可见；取消零写入 |
| P0：事务批量修复 | **完成（正常异常模型）** | working / issues / project 失败回滚；已有 5 个检查点时恢复被裁剪目录 |
| P0：检查点列表、撤销与恢复 | **完成（代码与测试）** | 完整状态快照；恢复前安全点；损坏项 UI 禁用；恢复失败项目树不变 |
| P0：默认引用体例与确认 | **完成（代码、迁移与 UI）** | 本地结构信号解析；证据不足退回 `structure_only`；`plan-citation` 只读并要求 `citation_plan_id` 确认；项目/报告记录原因、置信度与解析器版本 |
| P0：Node + Python 统一测试 | **完成（最新统一入口通过）** | alpha.63 Node 767 total / 760 pass / 0 fail / 7 skip；Python 368 total / 0 failures / 0 errors / 3 skip；见 TEST_REPORT |
| P0：真实桌面 UI 冒烟 | **完成（alpha.63 packaged）** | 最终 Windows 全链内隐藏 packaged smoke PASS，主进程与恢复进程标志唯一；不等于干净机安装或生产网络验收 |
| P0：文档与测试基线纠错 | **完成** | 权威改为 v2.0；纠正“185 + Ace = 186”错误 |
| Windows alpha 运行资源 | **完成（源码资源门禁）** | Python/JRE/EpubCheck/Ace 均有全量哈希/锁；Python 与 EpubCheck 双向探针实际执行并通过 |
| CPython 3.13.14 来源证据 | **机器验证完成，人工签署待办** | 官方 ZIP/Sigstore/SPDX、34 文件树、33 个原字节文件、1 个受控 `_pth` 追加与 PSF 许可保留已绑定；完整 Sigstore/GPG 与具名法律/再分发签署未完成 |
| EpubCheck 5.3.0 来源证据 | **机器验证完成，人工签署待办** | 官方 ZIP、GitHub 服务端 SHA-256 与本地 49/49 原字节文件已绑定；官网 MIT 与随包/仓库 BSD-3-Clause 矛盾、tag/ZIP 绑定及第三方义务待具名审阅 |
| Temurin 21.0.11 / JRE 来源证据 | **机器验证完成，人工签署待办** | 官方 ZIP/digest/checksum/build metadata、490/490 源 JDK、本机 JDK、207 文件 jlink runtime 和 94 份原字节许可材料已绑定；OpenPGP 未验签，许可/商标/源码提供与再分发签署待办 |
| Electron 43.1.0 来源证据 | **机器验证完成，人工签署待办** | 官方 GitHub release/ZIP/SHASUMS256、npm checksums 与本地 75/75 文件已绑定；release 未提供 detached signature，许可、Chromium 第三方通知、商标与再分发待具名签核 |
| Windows builder 来源证据 | **机器验证完成，人工签署待办** | 三份官方归档、GitHub release API、`app-builder-lib 26.15.3` 固定选择逻辑与 385/385 重组树已绑定；旧 release 无 digest/签名，部分所选载荷无具名许可证文件 |
| Ace 正式发布条件 | **部分完成** | tracked full lock、受控 `utilityProcess`、loopback Chrome、两阶段计划、真实 packaged 好/坏结果及本地哈希绑定证据已验证；自带浏览器、OS 网络隔离、代码签名/可信见证及全闭包人工审计未完成 |
| Windows NSIS / ZIP | **完成（未签名 alpha）** | alpha.63 NSIS/ZIP 已离线生成；全链退出 0，schema v2 发行证据复验通过；Authenticode 为 `NotSigned` |
| Windows 发布制品证据 | **完成（alpha.63 schema v2）** | SHA256SUMS + canonical manifest 与真实 NSIS/ZIP、packaged-smoke EXE/输出树交叉复验 |
| Windows 安装生命周期 | **Alpha.62→Alpha.63 只读预检完成，真实运行待授权** | 九阶段编排、证据 v1、HKCU/快捷方式探针和专项 13/13 完成；两版 manifest/installer 精确复验；未执行真实安装、升级、回装探测或卸载 |
| Electron ASAR / fuse 硬化 | **真实制品 9 项全验** | `@electron/fuses 2.1.3` 识别 `WasmTrapHandlers`；afterPack 严格写入全部 9 项并回读；真实 EXE 无未知 fuse |
| ASAR 资源信任根 | **alpha.63 源码与 packaged 已验证** | 源码锚点固定 131 个 loose 文件；真实 `app.asar`、packaged 全树与发布证据同属 alpha.63 |
| 发行商/销售主体元数据 | **源码/生产 ASAR 契约完成，真实身份待确认** | 已知产品/品牌/appId/官网固定；packaged 门禁读取真实 `app.asar/package.json` 的 `oakReleaseIdentity`；法定主体、链接、版权、签名主体和具名复核待定，sale fail-closed |
| Windows sale 门禁 | **未通过（如实阻断）** | 源码/packaged 资源门禁为 17/12 项；新增发行身份 blocker；签名、来源/许可审计、自带浏览器与 OS 隔离未完成 |
| macOS arm64/x64 安装版 | **基础设施完成，发行未完成** | 已拆原生 x64/arm64 runner；静态聚合不执行探针；缺 Electron/Python/JRE、`.app`/DMG、签名、公证和真实硬件证据 |
| 标准包验证、升级、撤回与回滚 | **桌面+服务端源码链完成；生产未配置** | 内置 2.1.0 / sequence 3；v1→v2→v3 历史 CAS、能力子集、签名/回滚/撤回和项目七字段 pin 验证通过。默认端点与 trust pin 仍为空 |
| 标准与规则补全 | **新增 TXT/Markdown 保守覆盖；内容补全未完成** | 14 标准/39 规则/6 fixer 映射一致；active 10、under_review 4、verified 0、pending 13、unavailable 1，仍禁止“完整标准库”表述 |
| 湖岸统一账号 / Free+Pro / 结果同步 | **Oak Account 本地生产形状与 packaged 完成，生产未配置/未联调** | alpha.63 保持冻结 application-login 合同并对齐 OAK-16 ES256 runtime，系统浏览器/loopback/PKCE、refresh-only 存储、`oak_account_id` owner、独立 Pro 和明确同步链均通过；默认配置无 Production URL/公钥/凭据，支付商、Staging、迁移/API/官网部署未完成 |
| 三模式 AI / 用户自带 AI | **compatible 源码链完成；Ollama 与 LM Studio 各一固定组合窄验收通过** | alpha.43 以 llmster 0.0.20+1 + Qwen3 4B 验证成功、静默模型替换拒绝、超时和不落盘，并修复 LM Studio 响应模型核对与空 `tool_calls: []`。其他组合/硬件/多模型语义、多规则质量、官方云、Web 会话凭据和湖岸 AI 仍无证据 |
| Web 服务端统一处理 | **直传/直取源码闭环完成；部署与隔离执行待办** | alpha.61 的 v2 公开控制面签发 30—300 秒 Supabase S3 PUT/GET，浏览器不再经 Function 缓冲稿件；staging→input ETag 绑定、单次 result claim、005 迁移、对象清扫、浏览器独立 Storage origin pin 和 v2 准入均有测试。仓库 pin 默认留空并关闭稿件控件；真实桶/CORS/迁移、隔离 worker、告警、生命周期/零留存与官网 E2E 未验证 |
| 可售卖正式版发布 | **未达到** | 缺跨端产物、生产账号/支付、条款、签名、公证、内测和网站联调 |

## 最新测试基线

- alpha.63 最终统一回归：`npm test` **PASS**；Node 767 total / 760 pass / 0 fail / 7 skip，Python 368 total / 0 failures / 0 errors / 3 skipped。定向账户/合同/Web 组合 37 total / 36 pass / 0 fail / 1 skip；唯一新增跳过是无外部授权的 OAK-16 真实 Staging consumer。
- alpha.63 资源信任：131 文件 / 2,244,237 字节，manifest `e03de88c…cb68`、anchor `11d122fd…5380`。离线 Windows 全链退出 0；packaged smoke run `msxhfjrn-167d5b76cd673e8b`，输出树 76 文件 / 1,378,019 字节 / `181eea1e…fc5`。
- alpha.63 NSIS 190,078,315 字节 / `5ac3dc23…eb35`，ZIP 233,925,031 字节 / `861fd3af…6a42`，unpacked EXE 225,449,472 字节 / `210705cb…6036`；schema v2 发行证据独立复验通过，两份 EXE 均 `NotSigned`。Alpha.62→Alpha.63 安装生命周期只读预检通过，真实安装未运行。
- alpha.62 最终统一回归：`npm test` **PASS**；Node 761 total / 755 pass / 0 fail / 6 skip（5.862 秒），Python 368 total / 0 failures / 0 errors / 3 skipped（43.921 秒），墙钟 54.3 秒。最终 `npm run build:win` 305.1 秒退出 0；packaged smoke 运行根 `out/packaged-smoke/runs/msslwfuj-5c4e1e4dc65c88fc/projects/`，76 文件 / 1,378,165 字节 / `e0235b95…01a7`。
- alpha.62 资源信任：131 文件 / 2,243,858 字节，manifest `9b00c85b…bbc`、anchor `bc69e8c3…5e16`；NSIS `3a3c74da…bb64`、ZIP `9263fb67…2f5c`，schema v2 发行证据复验通过。两份 Windows EXE 均 `NotSigned`。
- alpha.61 最终统一回归：`npm test` **PASS**；Node 744 total / 737 pass / 0 fail / 7 skip（7.109 秒），Python 368 total / 0 failures / 0 errors / 3 skipped（111.050 秒），墙钟 123.4 秒。直传 credential、S3 promotion/download/sweep、HTTP v2、持久状态、浏览器客户端、005 migration、v2 admission 和 runtime composition 均纳入 Node 全量。Web 生产依赖联网审计为 0 漏洞；真实 Supabase/worker/生产网络未运行。
- alpha.61 独立隐藏 Electron source smoke PASS，运行根 `out/source-smoke/runs/mso27a8x-665bbb0e3713f795/projects/`；独立隐藏 Chromium Web client smoke 在修正已自然过期的匿名测试权益日期后 PASS，desktop/390px、设备撤销、空 Storage origin pin 时六个稿件控件 fail-closed 和 0 外部网络请求均通过。

- alpha.60 最终统一回归：`npm test` **PASS**；Node 726 total / 719 pass / 0 fail / 7 skip（8.927 秒），Python 368 total / 0 failures / 0 errors / 3 skipped（128.273 秒），统一墙钟 205.8 秒。具来源平台准入和 Supabase 服务端 key 专项为 29/29。
- alpha.59 最终统一回归：`npm test` **PASS**；Node 720 total / 713 pass / 0 fail / 7 skip（6.152 秒），Python 368 total / 0 failures / 0 errors / 3 skipped（125.882 秒）。修复前 Windows CRLF checkout 复现为 Node 719/683/29/7；升版后首次回归又暴露 1 个 Ollama 当前版本断言仍固定 alpha.58，更新为 alpha.59 后全量通过。
- 真实 LM Studio headless 补充验收：官方 `0.0.20-1-win32-x64.full.zip` 881,662,805 字节，SHA-512 匹配；llmster `0.0.20+1` / `a39c907b…9c43`，Qwen3 4B Q4_K_M / 2,497,280,480 字节 / `3e4cb141…4e4f`。最终 **PASS**：成功推理 18,956 ms、静默模型替换被 `AI_SERVICE_INCOMPATIBLE` 拒绝、100 ms 超时、失败 plan 不可重放、不落盘/不改稿；证据 1,661 字节 / `a5f1fb5b…b3e9`。
- 真实 Ollama 补充验收：官方 0.32.5 standalone ZIP 1,457,824,795 字节 / SHA-256 `7c941ae0…c7bb`；qwen3:4b manifest `359d7dd4…fae7`。最终 run4 为 **PASS**，推理 17,893 ms，证据 1,451 字节 / `767197c5…0f98`，并绑定 APP 0.1.0-alpha.42、规则包 `098b382e…97a4`、`DOCX-SPACE-001` / `FIX-SPACE-001` 和脚本摘要；预览 0 请求，成功/缺失模型/100 ms 超时均各 1 请求，建议不落盘且不改稿。前两次质量门禁失败及未绑定真实规则 ID 的 run3 均保留，不冒充最终证据。
- Web 客户端 smoke：alpha.61 实际 `web/client/index.html` 在隐藏 Chromium 中使用匿名内存假服务完成桌面/移动布局、设备撤销和空 Storage origin pin 的 fail-closed 控件验证，**PASS**；HTTP(S) 请求 0，证据在 `out/web-client-smoke/`。这仍不是生产账号/API/部署证据。
- 源码 Electron smoke：alpha.62 独立隐藏运行 **PASS**，输出 `out/source-smoke/runs/msskld5l-f0e0f3db10320791/projects/`，Renderer 仍为 sandbox；最终 packaged smoke 同样为 alpha.62。
- 发行身份专项纳入 Node 全量：当前仓库身份结构有效但 `complete=false`，11 个 Windows 完备性字段显式缺失；源码 `build.appId`、生产 `oakReleaseIdentity`、重复键、字段/顺序/schema/canonical 字节、占位文本、非官方 URL 和 package 漂移均 fail-closed。
- ASAR/资源信任专项已纳入 Node 全量：alpha.61 源码 `verify:resource-trust` PASS，112 文件 / 2,217,733 字节，应用清单 SHA-256 `de6471b0752411a9d06a5b859bf5726859e0e73965199b09b76a20d26b2c0115`，锚点 SHA-256 `6165a4301a2c10de7b39fe25edad53edfc0b23c53fe2e236004dd63de646bd51`；最新真实 packaged 仍为 alpha.58。
- CPython provenance 专项已纳入 Node 全量：tracked evidence、exact schema/canonical 字节、官方制品摘要、Sigstore leaf、SPDX、34/33/1 推导、证据/运行时清单绑定、真实 `python.exe` 漂移和原子更新故障均通过；证据保持 `machine_status=verified`、`human_review_status=pending`。
- EpubCheck provenance 专项已纳入 Node 全量：官方 ZIP/服务端 digest、本地 49/49 原字节文件、exact schema/canonical 字节、证据/分发/JRE/资源锚点绑定、自批准与漂移拒绝均通过；证据保持 `machine_status=verified`、`human_review_status=pending`、`license_signal_consistent=false`。
- Temurin/JRE provenance 专项已纳入 Node 全量：官方 ZIP/API/digest/checksum/build metadata、490/490 JDK 文件树、本机源 JDK、固定 jlink、207 文件 runtime、94 份许可材料、证据/锁/ASAR 绑定、自批准和漂移拒绝均通过；GPG 状态保持 `not_verified_no_openpgp_tool`，人工状态保持 pending。
- Electron provenance 专项已纳入 Node 全量：官方 ZIP/GitHub server digest/SHASUMS256/npm checksums、75/75 文件树、证据/runtime lock/ASAR 绑定、自批准和漂移拒绝均通过；证据 SHA-256 `5f850b7a…075`，签名状态保持 `not_provided_as_release_asset`，人工状态 pending。
- Windows builder provenance 专项已纳入 Node 全量：三份官方归档/API、固定选择逻辑、受控重解压重组和 385/385 工具树、证据/tool manifest/lock 绑定及反向路径均通过；证据 SHA-256 `c1651839…bb5`，旧 release digest 状态保持 unavailable，人工状态 pending。
- Ace utility/Chrome controller、两阶段外部验证、Fuse 与相关路径反向测试均纳入上述全量回归；afterPack 专项覆盖全 9 项严格写入、API 漂移、macOS arm64 临时签名和路径逃逸；真实 EXE 回读 `fully_known=true`、`unknown_fuses=[]`。
- 账号/权益/同步专项：既有明确确认/safeStorage 队列、服务/client/coordinator、PKCE/加密 token-store/main 接线继续通过；alpha.45—alpha.46 的签发/订阅/设备服务之上，alpha.47 新增 Web strict overview/revoke 契约、掩码展示、确认、失败恢复和退出竞态保护。相关客户端/服务 57/57，新增专项累计 12/12。所有网络/DB 仍为注入仿真或 SQL 静态检查，受信端点/公钥为空且仓库没有生产私钥。
- Web 链继续全通过；alpha.61 v2 直传部署需求 SHA-256 为 `84fa903a7fd5397549ef7628671e31bb552bed92be93893707d160184e304690`。alpha.60 的 Netlify/Supabase 缓冲 profile 仍以 9 项拒绝码保留历史反证；alpha.61 组合继续固定 `production_evidence_verified=false`、`production_ready=false`。真实 DB/store/migration/worker/deployment 仍未运行。
- packaged-smoke/发布证据专项纳入全量；canonical smoke 证据绑定实际 EXE、两次进程唯一成功标志/输出摘要和匿名输出树，覆盖输出漂移、EXE 漂移、伪造标志、陈旧路径/版本、隐藏名、链接/硬链接、schema/canonical 篡改；发布 manifest schema v2 强制消费证据，清除与联合提交失败均 fail-closed。
- downloader 专项：**11/11 通过**；覆盖显式联网授权、固定来源、重定向/容量/哈希门禁、零授权零写入、事务落盘/回滚及路径安全。
- Electron runtime 锁专项：**37 项、36 通过、0 失败、1 条件跳过**；hardlink 与 junction 反向路径本机实测通过，文件 symlink 因 Windows `EPERM` 条件跳过，不计作通过。
- alpha.54 source 与 packaged smoke 均强制应用内外部验证并 PASS；packaged 第二进程队列恢复、制品/输出树哈希证据精确属于 alpha.54。两者均保持 Electron sandbox，未使用 `--no-sandbox` 作为证据。
- `npm run verify:standards`：**PASS**；当前 2.1.0 / release sequence 3 manifest SHA-256 `88a60da2f55c6de13853e0af56389f56a591c5702e44de1a7943d31afbff0187`；39 条规则、6 个机械 fixer。外部来源核验与具名复核仍未完成。
- `npm run verify:electron-runtime`：**PASS**；Electron 43.1.0 win32-x64 固定锁覆盖 2 个目录、75 个文件、364,083,658 字节，manifest SHA-256 为 `f5c2c915633c1917bc37377f8232bde4259588eb138bc4072a3c7df976e27486`；tracked manifest 使用严格 JSON、exact schema 和 canonical UTF-8/LF 原始字节，并绑定 Electron provenance。
- 外层隐藏 `npm run smoke:packaged:win`：**SMOKE-RESULT + SYNC-RECOVERY PASS**；最终输出 `out/packaged-smoke/runs/ms629abp-11818f84be690e63/projects/`，运行真实 alpha.54 二进制 `release/win-unpacked/湖岸稿件 Oak Manuscript.exe`。证据绑定 EXE `d007f78a…d8d8c` 与输出树 76 文件 / 1,368,627 字节 / `3e018199…a264`。
- 当前测试环境：Windows 11，Python 3.14.6，Node 24.16.0，npm 11.13.0，Electron 43.1.0，Java 21.0.11。
- Windows alpha 资源门禁：**PASS**。
  - alpha.59 源码 loose 资源：112 个文件 / 2,217,733 字节，manifest `7e25e075…b496`、anchor `0d055104…9def`；最新真实 ASAR/packaged 全树证据仍属于 alpha.58；
  - Python：34 个文件 / 21,260,753 字节；
  - JRE：207 个文件 / 52,384,264 字节；
  - EpubCheck：49 个文件 / 36,263,890 字节；
  - Ace：236 个包 / 6,672 个文件 / 58,969,045 字节。
- Windows sale 资源门禁：**按设计 FAIL**；源码为 17 项、真实 packaged 为 12 项；新增 `RELEASE_PUBLISHER_METADATA_PENDING`，原未知 fuse 兼容性阻断已独立关闭。
- 真实 alpha.54 `app.asar`、生产 package identity、9 项 fuse、loose 全树、Python/JRE/EpubCheck/Ace、CPython/EpubCheck/Temurin-JRE/Electron/builder provenance、双阶段应用 smoke、加密队列恢复及 schema v2 发布证据已验证；packaged 资源中 `.pyc` 为 0。
- alpha.54 Windows x64 离线构建、发布证据复验和对归档 alpha.12 的安装生命周期只读预检均 PASS；`authorized=false`，未启动安装器。精确制品字节数与摘要见 `docs/TEST_REPORT.md`。
- macOS：`verify:resources:mac:static` 可执行并按预期 FAIL，精确缺 darwin-x64/arm64 Electron dist、两架构 Python runtime 锁和两架构 JRE；未构建、未签名、未公证、未运行打包版 smoke。
- 详细证据与首次失败修复记录见 `docs/TEST_REPORT.md`。

## 本轮关键实现

- `.gitattributes` 从宿主相关的 `* text=auto` 收紧为 `* text=auto eol=lf`；Windows `core.autocrlf=true` 不再改变 tracked canonical JSON/SQL、迁移清单或资源信任输入；
- 新增 checkout 字节回归测试，固定属性文件自身与 CPython provenance、发行身份/schema、应用资源锁、Web migration manifest/SQL 的 LF 字节；
- 机械刷新现有工作树后 `git ls-files --eol` 的 `w/crlf` / `w/mixed` 为 0；按 LF 源码树重建 112 文件资源锁，不改变标准包 2.1.0 payload 或 alpha.58 兼容下限；
- alpha.59 仅为源码检查点；没有把 alpha.58 安装包、packaged smoke 或发布证据重新标记为新版本。

- 新增标准撤回独立 `revocation` 签名角色、canonical envelope/list、追加式持久集合和原子状态事务；active/候选/回滚命中即拒绝，检查途中落地的撤回在预览前优先，但保留 CAS、项目身份、既有结果与导出，并允许安全前进到更高未撤回 release；
- 新增固定内容无关撤回获取 service/HTTP/Fetch/桌面 client；真实测试 signed envelope 从假发布源贯通独立验签和原子应用。默认未接入 main/IPC/UI，普通运行零撤回网络；
- 新增跨端撤销纵向测试：同一匿名状态贯通网站账号控制器与桌面权益 client/provider；真实服务端 signer 和桌面 verifier 证明 active 缓存只在显式刷新后被 revoked 权益原子替换，降 Free 但不锁本地项目；

- 新增 `web/client/license-account-controller.js`：登录后读取 content-free 订阅/设备概览，只显示设备 ID 末尾掩码；逐台原生确认撤销，失败可见并恢复按钮，退出清空且旧响应不能回填；
- `web/client/client-contract.js` 新增 public overview/revoke exact parser、固定路径/负载与桌面一致的权益显示态；拒绝未知字段、重复/超量设备、非规范时间和客户端自报归属；
- 新增实际页面隐藏 Chromium 冒烟脚本和桌面/移动证据；使用匿名内存假服务，阻断并确认全部 HTTP(S) 为 0，不把该结果冒充真实 API 或部署；

- 新增 `subscription-event-service.js` / runtime 与三份 exact Schema：可信账单适配器只提交不含支付资料和 PII 的规范化权益快照；事件以 canonical SHA-256 幂等并区分 `applied|replayed|stale|conflict`；
- 新增账号权益 overview、设备列表与撤销 service/HTTP/runtime 及五份公开 Schema；GET/POST 均绑定 GoTrue Bearer owner，POST 强制同源，响应和审计不暴露账号、权益 ID、revision 或设备路由实值；
- 新增 `004_subscription_events_and_devices.sql` 与 repository 四 RPC 白名单；账号锁内处理订阅事件和设备撤销。SQL 仅做静态/注入验证，未在真实 PostgreSQL/Supabase 执行；

- 新增 `web/sync-record-service.js`：服务端独立 SyncRecord v1 validator、可信账号绑定、容量、幂等创建/重放/冲突、单快照分页列表、读取和属主删除；不复用 Electron validator；
- 新增 `/manuscript/api/v1/sync-records` 同源 HTTPS handler、两份 exact HTTP schema 和生产形状 runtime；GoTrue Bearer/Cookie+CSRF、framing/容量、固定错误及 content-free audit 均 fail-closed；
- 新增 `web/supabase-sync-record-repository.js` 与 `web/supabase/002_sync_records.sql`：content-free 长期表、强制 RLS、浏览器零权限、四个 service-role-only RPC、账户 advisory transaction lock 与 owner-scoped 列表/读取/删除；未执行真实迁移；
- 新增 `desktop-auth-config.js`、`desktop-auth-provider.js`、`encrypted-auth-store.js` 与 `auth-http-client.js`；固定待配置零网络、系统浏览器 PKCE S256/state、OS 加密 token-store、深链和账号复核；main 只在配置完整时实例化 Sync coordinator，普通默认 APP 不联网；
- `release_identity.js` 默认只读，使用 exact/canonical 契约验证发行身份并交叉检查 `package.json`；待定字段不会自填，正式 sale 在 `RELEASE_PUBLISHER_METADATA_PENDING` 上失败；
- `windows_install_acceptance.js` 默认只读并绑定 `package.json` 当前版本；alpha.42 对归档 alpha.12 的预检已通过，`authorized=false`。实际系统变更仍必须同时提供 `--run --allow-system-mutation`；
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
- 新增账号/同步 IPC 与 preload 固定通道，Renderer 不能提交任意记录；导出后仅对已登录用户逐字段预览并四选一确认；safeStorage 加密队列按账户隔离并支持幂等、取消、重试、删除和重启恢复；固定 transport 源码已接线，但受信生产端点仍为空；

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
- Web 任务完成先删输入再开放短期结果；结果只能通过同源已认证 POST 一次性领取，服务在返回字节前删除 input/output 并提交终态墓碑。并发或二次领取失败；读取/删除失败不返回字节并保持 `deletion_pending/downloaded`。取消、用户删除和 TTL 清扫同样删除输入/输出并传递 `deleteAt`；终态幂等墓碑拒绝同键重建；
- Web 参考实现已有标准 Fetch 边界、GoTrue 验证器、未部署工作台、Netlify Blobs 内容适配器、Supabase/Postgres 持久任务/幂等迁移、上传结构/主动内容门禁、service-role-only 私有领取、身份最小化 worker 和固定 Python 共享核心子进程；内存状态机只保留为参考/测试。SQL 尚未在真实 Supabase 执行，结构门禁不是病毒库，本机进程隔离也不是生产容器/OS 禁网证明；计费未实现，Blobs metadata 不是平台原生 TTL，必须调度双清扫器。

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

按 v2.0 方案继续，不重做总体规划；OAK-10 已完成本地实现、回归和未签名 Windows packaged 检查点，但真实账号/执行面与部署证据仍为空。近期直接推进：

1. 用官方当前资料建立专用隔离 worker 候选 profile，逐项验证固定 Python/绝对 executable、private scratch、只读应用、OS 禁网、240 秒以上执行、调度、告警和秘密注入；
2. 真实 Oak Account Center、Supabase、支付商 webhook、迁移和网站联调仍需有效预生产配置；得到配置后先完成 application-login/生命周期/owner 联调，再执行隔离预生产迁移/RLS、精确 Storage origin/CORS、最小直传作业和双清扫证据；
3. OpenAI、Anthropic、Gemini 官方适配必须先核对当前官方协议；不得套用 compatible 形状或凭记忆猜测，但不排在账号/订阅主线之前；
4. 同时保留正式发行阻断：具名许可/再分发签核、发行法定身份、Ace 自带浏览器/OS 隔离、Authenticode、干净 Windows 安装生命周期、macOS 签名/公证与实机验证。

如构建需要联网下载、安装新依赖、签名或发布，先取得用户授权。

## 已知技术与产品欠账

- 批量修复与通用检查点恢复的多文件提交能覆盖可捕获异常，但尚无统一的强杀/断电恢复日志；标准 store 已有 pending 事务恢复，规则包升级以原子 project manifest 为提交点保证项目可打开，但二者不能被夸大为任意多文件 ACID；
- Ace 已脱离开发树依赖并取得真实 packaged utility helper 证据，但仍依赖用户系统 Chrome；自带浏览器、OS 级默认拒绝网络及代码签名未完成；
- Ace 有 18 个依赖包只有生成的许可证通知，且整个 236 包生产闭包的来源、许可证、版权与再分发义务均尚需正式人工审计；
- CPython、EpubCheck、Temurin/JRE、Electron 与 builder 均已有固定官方制品、完整文件树及下游锁的机器来源证据；但 CPython 信任链/index 异常、EpubCheck 许可信号矛盾、Temurin OpenPGP、Electron 第三方通知/商标以及 builder 旧 release 无 digest/签名和部分载荷无具名许可文件等边界仍需具名法律/再分发签核；
- Windows Authenticode 和安装包签名尚未完成；最新 alpha.62 制品仅供开发/内测；
- alpha.62 源码与 packaged 发行身份结构有效但 `complete=false`，均从真实 `package.json` / `app.asar` 验证身份。`author` 等缺口仍由 `RELEASE_PUBLISHER_METADATA_PENDING` 阻断；法定销售主体、正式 URL、版权、发行者、具名复核与签名证书主体尚未确认，不能自行猜填；
- 标准治理 schema、完整身份、本地升级链、用户可见治理摘要和 TXT/Markdown 基础卫生覆盖已实现，但没有任何外部来源完成核验，4 项外部标准仍在审阅，reviewer 仅为角色占位，GB/T、APA、Chicago、EPUB、纸质出版和可访问性覆盖仍不够；UI 已明确阻止“标准库完整”表述，但内容缺口本身仍未关闭；
- 标准包生产 release/revocation trust pin、真实发布/撤回源和联网联调尚未实现；alpha.49—alpha.53 已完成客户端、服务端发布、本地撤回状态、固定获取链以及 main/IPC/UI 安全恢复入口，但两个正式端点仍为空，本地签名包导入仍因无生产 trust pin 按设计禁用；
- Windows 开发机无法替代真实 macOS 构建、签名、公证和实机 smoke；
- 本机加密同步队列、确认后即时发送/失败留队、SyncRecord 服务/API/Supabase、桌面 application-login/refresh-only store/条件 main 接线和网站历史解析均已在本地生产形状 E2E 贯通；alpha.62 已把生产 owner 切到验签 `oak_account_id`，并保留 alpha.61 直传数据面。受信账号与 Storage origin 配置仍为空，真实 Account Center、迁移/容器、OS 禁网、平台恶意软件扫描、调度/告警、订阅、真实零留存与官网后台仍涉及生产系统，网站保持只读；
- “接入用户自己的 AI”的六项设计决定已经用户确认并写入 v2.0；三模式设置、OS 加密凭据、单条发送预览、建议人工审阅、有界 HTTP 底座以及 compatible transport 已实现；Ollama 0.32.5 与 LM Studio llmster 0.0.20+1 各一固定组合已完成单匿名规则窄验收，官方云三类、其他上游组合、宽泛质量、湖岸 AI 服务与 Web 会话凭据仍未实现。

## 历史里程碑

- 2026-08-14：推进到 `0.1.0-alpha.62` 未签名 Windows packaged 检查点；冻结 Oak Account application-login 合同，完成桌面系统浏览器/PKCE/refresh-only、Web `oak_account_id` owner、独立 Pro 与显式同步接入；修复 Ace 双重关闭竞态；Node 761、Python 368、最终 Windows 全链和发行证据零失败；未联网、部署、推送、签名或运行安装器。
- 2026-08-10：推进到 `0.1.0-alpha.60` 源码检查点；联网核对 Netlify/Supabase/PostgreSQL 官方当前资料，新增真实候选 profile 与证据记录，以 9 个稳定拒绝码否决当前 50/100 MiB 缓冲协议原样部署到 Netlify Functions；补齐 Supabase `sb_secret_` apikey-only 兼容；Node 726、Python 368、关键门禁和独立隐藏 Electron smoke 零失败；未迁移、部署、推送或重新打包。
- 2026-08-10：推进到 `0.1.0-alpha.59` 源码检查点；修复 Windows `core.autocrlf=true` 导致 canonical JSON/SQL、迁移和资源信任门禁失败的问题，新增 checkout 回归并重建 LF 资源锁；Node 720、Python 368、关键源码门禁与沙箱外独立隐藏 Electron smoke 零失败；未联网、部署、推送或重新打包，最新 Windows packaged 仍为未签名 alpha.58。
- 2026-07-29：推进到 `0.1.0-alpha.58` packaged 检查点；新增 TXT/Markdown 4 条不可自动修复的保守空白提示、行号和格式覆盖矩阵，标准包升 2.1.0，历史 v1/v2 CAS 继续可验证；Node 719、Python 368、源码/Web/packaged smoke 和 Windows 发布证据通过；未联网、部署、推送或执行真实安装，制品未签名，macOS 静态门禁仍缺双架构资源。
- 2026-07-29：推进到 `0.1.0-alpha.57` 源码检查点；从已验证注册表派生 exact 治理摘要，标准页分列审阅/来源核验并在 0 verified、4 under_review 时明确阻止“完整”表述；Node 716、Python 362、标准/资源门禁与独立隐藏 Electron smoke 零失败；未改标准 payload，未联网、部署、迁移、推送或打包。
- 2026-07-29：推进到 `0.1.0-alpha.56` 源码检查点；完成平台无关 Web 部署需求、exact 非敏感 profile、稳定违规报告及 runtime 强制绑定；Node 711、Python 362、隐藏 Electron smoke 与资源信任零失败；未联网核对厂商、迁移、部署、推送或打包。
- 2026-07-29：推进到 `0.1.0-alpha.55` 源码检查点；完成 Web 临时作业 exact 生产组合、四份 SQL 顺序/精确字节门禁与去敏 fail-closed readiness；Node 706、Python 362、Web/Electron 隐藏 smoke 与资源信任全部零失败；未联网、迁移、部署、推送或重新打包，最新 Windows packaged 仍为 alpha.54。
- 2026-07-29：推进到 `0.1.0-alpha.54` packaged 检查点；在既有账号同步闭环之上离线生成 Windows NSIS/ZIP，真实 ASAR/9-fuse/资源、双进程 smoke、schema v2 发布证据与 alpha.54→alpha.12 只读安装预检通过；未签名、未执行真实安装，未联网、使用真实账号/数据库、部署或推送。
- 2026-07-29：推进到 `0.1.0-alpha.53`；完成同源 exact 双端点配置、main 原子启用、一次点击“先验撤回、后查更新”、active 撤回后的安全恢复 UI 及恢复状态竞态有界失败；Node 697、Python 362、资源信任与隐藏源码 smoke 全部零失败；未联网、配置生产密钥/真实发布源、部署或打包。
- 2026-07-29：推进到 `0.1.0-alpha.52`；完成固定内容无关撤回 service/HTTP/Fetch/桌面 client 与真实测试签名原子应用 E2E；Node 693、Python 362、资源信任与隐藏源码 smoke 全部零失败；未联网、配置生产密钥/真实发布源、接入 main/IPC/UI、部署或打包。
- 2026-07-29：推进到 `0.1.0-alpha.51`；完成独立角色签名撤回 exact 契约、追加式原子状态、active/候选拒绝、检查途中并发撤回优先、安全前进恢复和历史结果保留；Node 682、Python 362、资源信任与隐藏源码 smoke 全部零失败；未联网、配置生产密钥/撤回 transport、部署或打包。
- 2026-07-29：推进到 `0.1.0-alpha.50`；完成标准更新公开 fixed HTTP/Fetch 契约、发布记录摘要复核、content-free 错误/审计和真实测试 Ed25519 包到桌面原子安装 E2E；Node 675、Python 362、资源信任与隐藏源码 smoke 全部零失败；未联网、配置生产密钥/发布源、部署或打包。
- 2026-07-29：推进到 `0.1.0-alpha.49`；完成默认零网络的标准更新 exact 配置、24 MiB 有界 HTTPS transport、签名/哈希/schema/兼容性复验、10 分钟一次性计划、原生确认与既有项目不静默升级；Node 666、Python 362、资源信任与隐藏源码 smoke 全部零失败；未联网、部署、注入生产 trust pin 或打包。
- 2026-07-29：推进到 `0.1.0-alpha.48`；用同一匿名状态贯通网站撤销设备与桌面显式刷新 signed revoked 权益，保持旧缓存不被静默改写且本地项目不锁定；Node 655、Python 362、Web/Electron 隐藏 smoke 与资源门禁零失败；未做生产联调或打包。
- 2026-07-29：推进到 `0.1.0-alpha.43`；完成 LM Studio headless `llmster 0.0.20+1` + Qwen3 4B 的成功/静默替换拒绝/超时/不落盘窄验收，修复响应模型核对和空 `tool_calls` 兼容；Node 599、Python 362、资源信任与隐藏源码 smoke 全部零失败；未部署、推送或重构建 Windows 制品。
- 2026-07-29：推进到 `0.1.0-alpha.41`；接入 OpenAI-compatible、Ollama、LM Studio 非流式 Chat Completions 主进程纵向链，保持逐条完整预览、一次确认、只读内存建议和不回退；聚焦 34、Node 586、Python 362、资源信任与隐藏源码 smoke 全部零失败；未联网、调用真实模型、部署或打包。
- 2026-07-29：推进到 `0.1.0-alpha.40`；闭合浏览器失败清理、登录/回调并发、pending 跨重启、回调单次消费、refresh 暂时失败，以及远端成功/本地提交失败的显式幂等重试；Node 581、Python 362、资源信任与隐藏源码 smoke 全部零失败；未联网、迁移、部署或打包。
- 2026-07-29：推进到 `0.1.0-alpha.39`；新增严格待配置账号资源、系统浏览器 PKCE S256/state、OS 加密 token-store、Windows/macOS 深链、账号绑定 access-token provider、条件 main coordinator 和逐项显式发送/重试 UI；Node 576、Python 362、资源信任与隐藏源码 smoke 全部零失败；未联网、未用真实端点/账号、未迁移、未部署或打包。
- 2026-07-28：推进到 `0.1.0-alpha.38`；新增 SyncRecord 独立服务验证、同源 API、Supabase repository/002 迁移、生产形状 runtime 与未接线桌面 Bearer client/coordinator；专项 37/37、Web 130/130、Node 560、Python 362 和隐藏源码 smoke 均零失败；未联网、未迁移、未部署或打包，最新真实 Windows 制品仍为 alpha.37。
- 2026-07-28：推进到 `0.1.0-alpha.37`；发布清单升级 schema v2 并绑定 canonical packaged-smoke 证据、实际 EXE、匿名输出树和第二进程恢复结果；生成未签名 Windows NSIS/ZIP，Node 523、Python 362、source/packaged smoke、证据复验和安装生命周期只读预检均零失败；哈希证据仍不替代签名。
- 2026-07-28：推进到 `0.1.0-alpha.36`；生成并复验未签名 Windows x64 NSIS/ZIP、真实 packaged 资源/ASAR/9-fuse、隐藏 smoke、发布摘要及 alpha.36→alpha.12 安装生命周期只读预检；Node 517、Python 362 全量零失败；未执行真实安装、签名、macOS/Web 或生产联网能力。
- 2026-07-28：推进到 `0.1.0-alpha.35`；新增未接线的供应商无关有界 HTTP client 与适配路由，生产仍 `transport:null`；Node 517、Python 362 与隐藏源码 smoke 全通过；未联网或打包。
- 2026-07-28：推进到 `0.1.0-alpha.34`；新增最多 8 个、30 分钟、一次处理的 AI 建议人工审阅会话，采纳只记录人工处理状态，不保存模型文本或写稿；Node 504、Python 362 与隐藏源码 smoke 全通过。
- 2026-07-28：推进到 `0.1.0-alpha.33`；新增单条问题最小 AI 上下文、完整发送预览和一次确认契约；生产 transport 仍关闭；Node 501、Python 362 与隐藏源码 smoke 全通过。
- 2026-07-28：推进到 `0.1.0-alpha.32`；实现无 AI/湖岸 AI/我的 AI 三模式设置、safeStorage 加密凭据和 Pro/不回退边界；Node 492、Python 357 与隐藏源码 smoke 全通过。
- 2026-07-28：推进到 `0.1.0-alpha.31`；删除待办可在 TTL 前由第八个 service-role-only RPC 领取，对象扫描增加硬上限/截断，私有协调器完成任务—对象—任务三阶段且只输出计数；Web 104/104、Node 474、Python 357 全量零失败；未部署、未连接真实平台，生产零留存标志固定为 false。
- 2026-07-28：推进到 `0.1.0-alpha.30`；结果领取改为同源已认证 POST，第一个领取者 CAS 独占，删除对象与提交终态墓碑后才返回；并发/二次领取失败，删除失败不返回字节并可重试；Web 97/97、Node 467、Python 357 全量零失败；未部署、未连接真实平台或证明三路零留存。
- 2026-07-28：推进到 `0.1.0-alpha.29`；新增上传前固定 Python 结构/主动内容门禁，拒绝危险 ZIP、宏/ActiveX/嵌入/DDE 与脚本 EPUB，失败零字节入库且不暴露身份；Web 94/94、Node 464、Python 357 全量零失败；未使用病毒库、未部署、未做生产容器/OS 隔离或真实平台 E2E。
- 2026-07-28：推进到 `0.1.0-alpha.28`；新增 service-role-only `SKIP LOCKED` 原子领取、完整租约窗、身份最小化私有 worker、固定 Python 子进程和共享核心 `web-check`；本机真实 TXT 烟测输入哈希不变且 scratch 零残留；Web 91/91、Node 462、Python 352 全量零失败；未执行真实迁移、容器/OS 禁网验证、部署或打包。
- 2026-07-28：推进到 `0.1.0-alpha.27`；新增 Supabase/Postgres RLS/RPC 迁移、固定 service-role repository、revision CAS、跨实例上传预留、exact lease/过期接管、终态墓碑与持久服务；Web 85/85、Node 455、Python 351 全量零失败；未执行真实迁移、连接生产服务、部署或打包。
- 2026-07-28：推进到 `0.1.0-alpha.26`；新增 Netlify Blobs 强一致条件写、exact metadata、删除复验与到期清扫适配器；SDK 独立子包锁定 10.1.0 且生产审计 0 漏洞；Web 69/69、Node 439、Python 351 全量零失败；未连接生产 store、部署或打包。
- 2026-07-28：推进到 `0.1.0-alpha.25`；新增有界 GoTrue verifier、Fetch 桥和保留统一账号入口的 Web 工作台，完成无文件名创建、单任务同意、默认引用、上传/轮询/取消/下载；Web 61/61、Node 431、Python 351 全量零失败；桌面/390px 隔离渲染通过，未部署或打包。
- 2026-07-28：推进到 `0.1.0-alpha.24`；只读核对官网 Supabase Bearer/GoTrue 模式，新增唯一 Authorization→exact principal 适配及 Bearer/Cookie 安全分流；Node 413、Python 351 全量零失败；未重复打包，最新制品仍为 alpha.23。
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
