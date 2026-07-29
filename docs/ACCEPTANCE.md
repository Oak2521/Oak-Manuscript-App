# ACCEPTANCE — 验收标准

> 当前依据：商业正式版方案 v2.0；下方 M1—M3 与旧阶段 2/3 条目保留为历史基线。勾选必须以真实运行证据为准（命令 + 输出记录在 TEST_REPORT.md），不得凭实现意图勾选。

## 0.1.0-alpha.44 签名订阅权益与网站账号后台源码验收（2026-07-29）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.44`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 桌面权益配置为 exact/canonical 受信资源；默认 `pending_configuration` 没有 endpoint/issuer/key，状态读取和普通启动零权益网络请求；
- [x] signed-entitlement v1 exact Schema、Ed25519 验签、issuer/audience/账号/设备/时间绑定成立；未知字段、篡改、错号、错设备、错 key、未生效和撤销均 fail-closed；
- [x] `OAKLIC1` safeStorage 缓存具备 revision CAS、独占候选、`fsync`、原子替换、换入复验和文件身份门禁；无效响应不覆盖有效缓存；
- [x] 只有已登录用户明确点击设置页刷新才允许固定 HTTPS/Bearer 请求；请求前后复核账号稳定；所有失效状态降为 Free，永不锁已有本地项目；
- [x] 网站客户端源码能为当前账号 strict parse、列表、刷新和属主删除 SyncRecord；使用安全 DOM 文本渲染，退出即清空，临时 Web 作业不自动同步；
- [x] `npm test` Node 615 / Python 362 全量零失败；资源信任 88 文件 / 2,150,289 字节；独立隐藏 alpha.44 源码 smoke PASS；
- [ ] 服务端签发、支付/退款、设备管理、生产公私钥轮换、真实 OAuth/数据库迁移/RLS/API/网站部署及端到端订阅验收完成；
- [ ] alpha.44 Windows/macOS 安装包、代码签名、公证、真实安装生命周期与可售卖正式版门禁完成；最新 packaged 证据仍为未签名 alpha.42。

## 0.1.0-alpha.43 LM Studio headless 窄验收与模型身份拒绝（2026-07-29）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.43`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] LM Studio 官方安装脚本固定 `llmster 0.0.20-1`；full ZIP 881,662,805 字节且官方 SHA-512 匹配；ZIP 路径审计通过；没有执行安装脚本或修改真实用户 PATH/启动项；
- [x] HOME/APPDATA/TEMP、bootstrap、模型硬链接、日志和证据全部在仓库 `out/`；API 只绑定 `127.0.0.1:12400`，测试后模型/API/daemon 已停止且源 GGUF SHA-256 不变；
- [x] 固定 `llmster 0.0.20+1` / SHA-256 `a39c907b…9c43` 与 Qwen3 4B Q4_K_M / 2,497,280,480 字节 / `3e4cb141…4e4f`；原生和 compatible 模型清单均确认固定 API identifier；
- [x] 真实成功路径证明预览 0 请求、确认后 1 请求、`memory_only`、不自动写回，人工接受不改稿、不保存建议正文；100 ms 超时映射 `AI_SERVICE_TIMEOUT` 且 plan 不可重放；
- [x] 真实发现未知 model 会被服务端静默替换；alpha.43 强制 LM Studio 响应 model 与请求一致，替换映射 `AI_SERVICE_INCOMPATIBLE`；普通文本只允许精确空 `tool_calls: []`，非空/非数组工具调用仍拒绝；
- [x] canonical 证据 1,661 字节 / SHA-256 `a5f1fb5b…b3e9`，不含建议正文；完整回归 Node 599 / Python 362 零失败；独立隐藏 alpha.43 源码 smoke PASS；
- [ ] `llmster.exe` 无 Authenticode 签名；桌面 GUI、其他版本/模型/硬件、多模型语义、macOS、远程 TLS、宽泛质量与再分发许可仍未验收；最新 Windows 安装包仍为未签名 alpha.42。

## 0.1.0-alpha.42 真实 Ollama 外部兼容补充验收（2026-07-29）

- [x] 官方 Windows standalone ZIP 固定为 Ollama `0.32.5`，1,457,824,795 字节及 SHA-256 与 release asset digest 一致；服务 `/api/version` 精确返回 `0.32.5`；
- [x] `qwen3:4b` 本地 manifest SHA-256 固定为 `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`，API 报告 2,497,293,931 字节；
- [x] 运行包、模型、状态、日志和临时目录全部隔离在仓库 `out/`；服务只绑定 `127.0.0.1:11435`，结束后进程已退出、端口已关闭；
- [x] 匿名单问题真实推理证明预览零请求、确认后恰好一次请求、建议 `memory_only`、自动写回 false、人工接受不改稿且不持久化模型文本；
- [x] 真实缺失模型映射为 `AI_SERVICE_REJECTED`，100 ms 真实推理超时映射为 `AI_SERVICE_TIMEOUT`；两条失败均消费旧 plan，重放为 `AI_PLAN_STALE` 且不产生第二次请求；
- [x] 建议质量窄判据与当前连续空格规则一致；首次错误判据、第二次不完整上下文和未绑定真实规则 ID 的 run3 均保留，最终 run4 证据绑定 APP/规则包/`DOCX-SPACE-001`/`FIX-SPACE-001`/脚本摘要，为 1,451 字节 / SHA-256 `767197c5d2748f216b5006e85efb49ffbcb957b3e9dd9df88c4f5625320b0f98`；
- [x] 新增脚本单测 5/5、AI 定向 36/36；最终 `npm test` 为 Node 595 / Python 362，全量零失败；
- [ ] LM Studio、其他 Ollama 版本/模型/硬件、远程 HTTPS、macOS、多规则/真实稿件建议质量和产品级兼容矩阵未验收；本补充不得表述成“全面支持 Ollama”。

## 0.1.0-alpha.42 compatible AI 故障恢复与 loopback 验收（2026-07-29）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.42`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 连接失败、超时、服务拒绝、重定向、响应不兼容、超限和凭据回显映射为稳定用户错误；未知上游异常、正文和凭据不进入 IPC/Renderer；
- [x] 失败消费原一次性计划；界面只允许重新生成零请求预览，必须再次确认后才发送，不自动重试、不静默回退、不改稿或配置；
- [x] 真实 `127.0.0.1` HTTP 测试证明预览零请求、确认后一次固定 POST、内存建议与人工审阅，并以真实连接重置证明可操作失败和计划单次消费；
- [x] AI 聚焦 38/38；`npm test` Node 590 / Python 362 全量零失败；资源清单 84 文件 / 2,145,925 字节；独立隐藏 alpha.42 源码 smoke PASS；
- [x] alpha.42 Windows x64 NSIS/ZIP、packaged 资源/ASAR、Electron 9 fuse、双进程隐藏 smoke、schema v2 发布证据与 alpha.12 安装生命周期只读预检通过；
- [x] Ollama 0.32.5 + qwen3:4b 的一条匿名问题、缺失模型和超时路径已完成窄范围真实验收；
- [ ] LM Studio、其他 Ollama/OpenAI-compatible 组合、真实凭据/TLS、宽泛模型质量、Windows 签名、真实系统安装/升级/卸载和干净机验收仍未完成。

## 0.1.0-alpha.41 OpenAI-compatible“我的 AI”纵向链验收（2026-07-29）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.41`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 只注册 `openai_compatible`、`ollama`、`lm_studio`；固定 `/chat/completions`、系统/用户双消息和 `stream:false`；远程 HTTPS、本机 loopback、容量/超时/媒体/禁重定向/Cookie/代理门禁继续成立；
- [x] 可选 Bearer 凭据不进入 URL、请求 JSON、Renderer、项目、同步或响应；唯一非空 assistant 字符串之外的多结果、工具调用、错误角色和数组内容均拒绝；
- [x] 保存/预览/取消零请求；只有用户完整预览后确认一次才可发送；建议仅内存展示，接受/放弃均不把模型文本写回稿件或项目；
- [x] 聚焦 34/34；`npm test` Node 586 / Python 362 全量零失败；资源清单 84 文件 / 2,145,925 字节；独立隐藏 alpha.41 源码 smoke PASS；
- [ ] 真实 OpenAI-compatible/Ollama/LM Studio 服务兼容和建议质量未验收；OpenAI/Anthropic/Gemini 官方云未实现；alpha.41 未打包，最新真实 Windows 制品仍为 alpha.37。

## 0.1.0-alpha.40 登录故障恢复与同步幂等收敛验收（2026-07-29）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.40`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 浏览器打开失败清除 pending verifier，并发登录启动被拒绝；合法 pending 可跨应用重启继续；
- [x] 回调在 token exchange 前单次消费，并发或失败后的同一回调不能重放；refresh 暂时失败保留原加密会话供重试；
- [x] 远端成功而本机队列提交失败时保留显式可重试记录，同一幂等 ID 的 `replayed` 回执可最终删除本机项；
- [x] `npm test` Node 581 / Python 362 全量零失败；资源清单 84 文件 / 2,145,925 字节；独立隐藏 alpha.40 源码 smoke PASS；
- [ ] 真实 OAuth/OIDC/GoTrue/RLS/数据库迁移/网站后台/远端同步未运行；alpha.40 未打包，最新真实 Windows 制品仍为 alpha.37。

## 0.1.0-alpha.39 桌面 PKCE 与显式同步主进程接线验收（2026-07-29）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.39`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] exact 桌面账号配置与 schema 进入资源信任清单；默认 `pending_configuration` 的授权/token/user/API origin/client/key 全为 null，登录和同步无可调用网络目标；
- [x] PKCE S256/state、verifier 先加密落盘再开系统浏览器、固定深链、Windows second-instance/macOS open-url、严格 code exchange/user identity 与回调拒绝契约通过离线测试；
- [x] access/refresh token 与 verifier 只保存到独立 `OAKAUTH1` safeStorage 密文；canonical/revision/路径/单链接/原子替换门禁成立，Renderer、项目、报告和 SyncRecord 无令牌；
- [x] 主进程仅在配置完整且系统加密可用时实例化账号与 Sync coordinator；发送/重试逐项明确触发，不后台 flush，账号错绑与变化均 fail-closed；
- [x] `npm test` Node 576 / Python 362 全量零失败；资源清单 84 文件 / 2,145,925 字节；独立隐藏 alpha.39 源码 smoke PASS；
- [ ] 正式 OAuth/OIDC 契约（包括是否需要 nonce/ID-token）、真实 PKCE/刷新/退出/撤销、Supabase 迁移/API/网站后台和生产无密钥泄露 E2E 已完成；
- [ ] alpha.39 Windows/macOS 安装包、签名、公证与真实安装生命周期完成；最新真实 packaged 证据仍为 alpha.37。

## 0.1.0-alpha.38 SyncRecord 服务端与桌面 transport 源码验收（2026-07-28）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.38`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 服务端独立 exact validator 不信任 Electron 结论，拒绝正文/标题/路径/文件名/哈希及未知字段；可信主体绑定、容量、幂等创建/重放/冲突、快照列表、读取和属主删除通过离线测试；
- [x] `/manuscript/api/v1/sync-records` 固定 HTTPS/同源/Fetch Metadata、Bearer 或 Cookie+CSRF、JSON framing/64 KiB、非反射错误和 content-free audit；同步/异步审计接收器失败不改变 HTTP 结果；
- [x] Supabase repository 只调用四个固定 service-role RPC，响应归属/canonical/容量有界；`002_sync_records.sql` 强制 RLS、撤销浏览器权限、递归禁止内容键并用账户 advisory transaction lock 原子创建/重放；列表单次返回 `{rows,total}`；
- [x] 桌面 client 只允许固定规范 HTTPS origin、固定路径、Bearer、无 Cookie/重定向和有界响应；coordinator 保证单项单在途、账号稳定，只有远端 created/replayed 后才删除精确本地项；
- [x] 六组 Sync 专项 37/37 通过；桌面 token 必须与当前队列账号精确绑定，错绑在 transport 前拒绝；应用资源清单更新为 81 文件 / 2,142,090 字节，manifest SHA-256 `fbc0ca36bcb670156a34769d743607590062878f583c6edc7dfcb66d37130ab2`，anchor SHA-256 `f90b54f365293c6386135d1bf7daf28637131c1731146227b9e189a8bddd0b87`；
- [x] 最终顺序 `npm test`：Node 560 / Python 362 全量零失败；alpha.38 独立隐藏源码 smoke PASS；本轮不重新打包，最新真实 Windows 制品保持 alpha.37；
- [ ] 生产系统浏览器 PKCE/token 安全存储、main 接线、真实 PostgreSQL/Supabase 迁移、GoTrue/RLS/多实例 E2E、官网同步后台、删除/备份审计和无密钥泄露验收完成。

## 0.1.0-alpha.37 packaged smoke 证据绑定验收（2026-07-28）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.37`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] Windows x64 NSIS、ZIP 与 unpacked 应用真实生成；packaged 资源门禁、ASAR production identity、Electron 43 全 9 fuse 和隐藏双进程 smoke 均通过；
- [x] canonical smoke 证据绑定实际 EXE、主 smoke/第二进程恢复唯一成功标志与四个输出摘要、匿名输出树逐文件哈希；EXE 漂移、输出漂移、伪造标志、路径/版本漂移、其他隐藏名、链接/硬链接及 schema/canonical 篡改均有拒绝测试；
- [x] 发布 manifest schema v2 强制消费 smoke 证据文件摘要、EXE 摘要和输出树摘要；生成与独立 `--verify`/`--verify-live` 均通过，历史 schema v1 只为安装归档严格兼容；
- [x] 当前 NSIS 190,013,357 字节 / SHA-256 `26af70e0ca533ee6dc09feae50ba420f7cb11e5dfba270f27870e1e679ece095`，ZIP 233,838,480 字节 / `e4288fbf621b837b0272c938113457928aa422573848129e46308a29a300697d`；
- [x] 资源锁 79 文件 / 2,139,277 字节，manifest SHA-256 `4ce4810d54f180d961f644b8f5d66e7b3aba6996e1a0c5c64b75397c93ab1b97`，anchor SHA-256 `4f306d10d385c8b913b03782a8672eb66022096bab836bffed5bb9ed027bbf92`；
- [x] `npm test` Node 523 / Python 362 全量零失败；独立隐藏源码 smoke 与 packaged smoke 均 PASS；
- [x] alpha.37 对归档 alpha.12 的安装生命周期只读预检通过，`authorized=false`、`ready_for_authorized_run=true`，没有启动安装器或改写系统；
- [x] 发行身份保持 `complete=false`，12 个缺失字段及 packaged 12 项 sale blocker 没有被本地哈希证据错误关闭；
- [ ] Authenticode 或独立可信见证使 smoke 证据不可由本地写入者整体重造；真实安装/升级/降级探测/卸载、干净机、macOS、Web 部署及可售卖正式版门禁完成。

## 0.1.0-alpha.36 Windows 可安装内测制品验收（历史，2026-07-28）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.36`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] Windows x64 NSIS、ZIP 与 unpacked 应用真实生成；packaged 资源门禁、ASAR production identity、Electron 43 全 9 fuse 和隐藏 smoke 均通过；
- [x] 发布证据精确绑定当前 NSIS 190,013,438 字节 / SHA-256 `fb25a52127d2d4bd2f2e1275236e54a2a9e4d6cce65707938a96364a201ce5cd` 与 ZIP 233,838,475 字节 / `cbdf1afc46b0d6a52f7d0ec0489096d6824a387c18819c6a93d505414b0757dc`；
- [x] 资源锁 79 文件 / 2,139,277 字节，manifest SHA-256 `b0e85cd18ab481d5449b7d79c6c7bd6c438678d47cc892731ee7b394f22059ed`，anchor SHA-256 `0e2d523b37cc4acb6268288f8acf7dbacccde2c772f823dbedc0d48ec3b9a8c9`；
- [x] `npm test` Node 517 / Python 362 全量零失败；独立隐藏源码 smoke 与 packaged smoke 均 PASS；
- [x] alpha.36 对归档 alpha.12 的安装生命周期只读预检通过，`authorized=false`、`ready_for_authorized_run=true`，没有启动安装器或改写系统；
- [x] 发行身份保持 `complete=false`，12 个缺失字段及 packaged 12 项 sale blocker 没有被 alpha 门禁错误关闭；
- [ ] 真实安装/升级/降级探测/卸载、Windows Authenticode、干净机、macOS、Web 部署及可售卖正式版门禁完成。

## 0.1.0-alpha.35 AI 有界 HTTP 底座验收（历史，2026-07-28）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.35`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 独立模块只接受 exact POST JSON；远程仅 HTTPS、本机 HTTP 仅精确 loopback；URL 凭据/查询/片段、重定向、Cookie、代理/转发/hop-by-hop 头和响应压缩均拒绝；
- [x] 请求头 16 个/8 KiB、JSON 32 KiB/32 层/10,000 节点、响应 64 KiB、超时 100—120,000 ms 均双向门禁；Content-Type/Length 重复、漂移、声明/实际超限和畸形 JSON fail-closed；
- [x] `AITransportRouter` 只接受已注册 provider 和 exact 适配器/config/request/result；凭据进入 URL、上游精确回显凭据、未知结果字段及适配/网络异常均拒绝且错误不泄密；
- [x] 网络底座定向 13/13、Node 517、Python 362 全量零失败；独立隐藏源码 Electron smoke PASS；资源锁 79 文件 / 2,139,277 字节；
- [x] 生产适配器注册表保持为空，主进程继续 `transport:null`；普通测试/smoke 不联网，也不把底座冒充真实供应商兼容性；
- [ ] 六类官方协议、真实 TLS/证书/代理策略、真实凭据兼容性、供应商故障演练及湖岸 AI 服务完成；
- [ ] alpha.35 Windows/macOS packaged、签名、安装生命周期与干净机证据完成；最新真实 Windows 制品仍是 alpha.23。

## 0.1.0-alpha.34 AI 建议人工审阅验收（历史，2026-07-28）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.34`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 建议生成后建立最多 8 个、30 分钟有效、一次处理的内存态审阅会话；模型文本不进入项目、报告、同步或 working；
- [x] 采纳前重新核对问题/检查/working/规则包绑定，只把对应问题标为 `accepted`；稿件不变、建议文本不持久化；
- [x] 放弃或关闭建议不调用问题状态写入，不把规则问题标成 `rejected`；重复、过期、上下文漂移及写入失败 fail-closed；
- [x] Renderer 提供独立采纳/放弃按钮和明确结果文案，动态内容只用安全文本渲染；IPC 只接受 opaque review ID 与固定决定；
- [x] AI/IPC/UI 定向 22/22、Node 504、Python 362 全量零失败；获准的独立隐藏源码 Electron smoke 最终 PASS；资源锁 79 文件 / 2,139,277 字节；
- [ ] 六类真实供应商 transport、最小权限网络隔离、真实建议质量/兼容性和 Web 会话凭据完成；当前生产 transport=`null`；
- [ ] alpha.34 Windows/macOS packaged、签名、安装生命周期与干净机证据完成；最新真实 Windows 制品仍是 alpha.23。

## 0.1.0-alpha.33 AI 单条问题发送预览与一次确认验收（历史，2026-07-28）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.33`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] `ai-context` 严格只读，只提供当前单条问题；项目/检查绑定、working/规则摘要只留主进程，request_content 不含文件名、路径、项目/账号标识、其他问题或凭据；
- [x] AI 计划有效期 10 分钟、最多 8 个、一次使用，并绑定上下文与 AI 配置 revision；取消、过期、重复、上下文/配置漂移均在 transport 前拒绝；
- [x] UI 完整展示目的地、有效期、会发送/不会发送清单和完整语义请求；动态内容只用 `textContent`；
- [x] 注入式 transport 证明凭据只在确认后交付；建议 exact/32 KiB、`suggestion_only`、`memory_only`、`automatic_writeback=false`；异常和超限不泄露凭据；
- [x] AI Node 定向 35/35、Python 定向 5/5、Node 501、Python 362 全量零失败；扩展独立隐藏源码 Electron smoke 最终 PASS；资源锁 79 文件 / 2,139,277 字节；
- [ ] 六类真实供应商 transport、最小权限网络隔离、协议/超时/重试/证书/代理/响应解析和真实凭据兼容性完成；当前生产 transport=`null` 且确认按钮禁用；
- [ ] alpha.33 Windows/macOS packaged、签名、安装生命周期与干净机证据完成；最新真实 Windows 制品仍是 alpha.23。

## 0.1.0-alpha.32 三模式 AI 设置与加密凭据验收（历史，2026-07-28）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.32`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 无 AI / 湖岸 AI / 我的 AI 三模式与六类供应商可在设置页选择；我的 AI 要求 Pro，且明确不消耗湖岸 AI 配额；
- [x] 非本机服务强制 HTTPS，本机 HTTP 只接受精确 loopback；供应商或地址改变后不能静默沿用旧凭据；
- [x] 凭据只在主进程 OS 加密存储中持久化，状态、配置导出、Renderer、同步与错误响应均不回读；篡改、revision 冲突、硬链接和不安全根 fail-closed；
- [x] 关闭或切换湖岸 AI 会清除 BYO 配置；失败不静默回退，AI 输出政策固定为建议且禁止自动写回；
- [x] AI 定向 26/26、Node 492、Python 357 全量零失败；独立隐藏源码 Electron smoke PASS；资源锁 79 文件 / 2,136,323 字节；
- [ ] 模型 transport、逐次请求预览、建议审阅、Web 会话凭据、湖岸 AI 服务和真实供应商兼容性已实现并验收；当前明确不会发起网络请求；
- [ ] alpha.32 Windows/macOS packaged、签名、安装生命周期与干净机证据完成；最新真实 Windows 制品仍是 alpha.23。

## 0.1.0-alpha.31 Web 有界双清扫验收（历史，2026-07-28）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.31`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 第八个固定 RPC 只授予 `service_role`，优先列出所有 `deletion_pending`，再列出已到期任务；删除失败可在 TTL 前被计划清扫重试；
- [x] 对象清扫固定 prefix，每轮只接受 1—5,000 硬上限并明确返回 `truncated`；到期/损坏删除、metadata 暂不可用、删除未确认及未知键语义不被放宽；
- [x] 私有协调器严格执行任务—对象—任务三阶段；单阶段失败不抑制后续阶段，对象孤儿清除后可在同一周期再次完成状态墓碑；
- [x] 周期报告/audit 只含规范时间、阶段状态与计数，不含主体、任务 ID、对象键、异常文本或稿件信息；配置、畸形阶段结果、倒退时钟与审计失败均 fail-closed；
- [x] 即使本地周期清零，报告仍固定 `production_zero_retention_verified=false`；不得用 FakeRepository/FakeStore 冒充平台生命周期证据；
- [x] 定向 38/38、Web 104/104、Node 474、Python 357 全量零失败；资源锁 79 文件 / 2,136,323 字节；
- [ ] 受控生产计划任务、告警、真实 Supabase/Blobs/GoTrue E2E、复制/备份删除、区域/并发/故障演练和三路零留存完成；因此本节不是上线或销售验收。

## 0.1.0-alpha.30 Web 一次性结果领取验收（历史，2026-07-28）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.30`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 结果领取固定为 HTTPS 同源、已认证 `POST /result`；Cookie 模式要求 CSRF，Bearer 模式无 CORS；GET 返回 405 且不消费结果；
- [x] 持久任务以 revision CAS 从 `result_ready` 独占转为 `deletion_pending/downloaded`；并发严格只有一个赢家，二次领取不能返回字节；
- [x] input/output 删除和 content-free 终态墓碑全部成功后才返回结果；读取、删除或终态提交失败时零字节返回并保留可重试删除待办；
- [x] Web 工作台说明一次性领取与传输/本机保存失败后必须重新检查；成功后关闭旧任务并恢复创建控件；
- [x] 定向 57/57、Web 97/97、Node 467、Python 357 全量零失败；Python Web 专项 6/6；资源锁 79 文件 / 2,136,323 字节；
- [ ] 真实 Supabase/Blobs/GoTrue 迁移与 E2E、任务/对象双清扫、平台存储生命周期、备份/复制删除和三路零留存已完成；本轮 FakeRepository/FakeStore 不得冒充生产证据；
- [ ] 网络传输中断、区域故障和结果丢失产品策略已在生产演练并通过；当前明确采用“删除后传输失败需重新检查”的隐私优先权衡。

## 0.1.0-alpha.29 Web 上传结构与主动内容前置门禁验收（历史，2026-07-28）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.29`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] `web-inspect` 在临时对象存储和共享检查核心之前只读检查 TXT/Markdown UTF-8/NUL 及 DOCX/EPUB ZIP 文件头、路径、链接/特殊文件、加密、重复成员、压缩算法、成员/展开量/压缩比、CRC 和必需成员；
- [x] DOCX 宏/ActiveX/嵌入对象/宏内容类型/altChunk/DDE 与 EPUB 脚本成员/script/事件处理器/`javascript:` URL fail-closed；
- [x] 持久服务强制 isolated-process inspector，检查请求不含 owner/job/lease；拒绝时零字节进入 store、上传预留清除，对外只暴露稳定 `UNSAFE_DOCUMENT`；
- [x] Python 门禁 5/5、Node 定向 35/35、Web 94/94、Node 464、Python 357 全量零失败；真实 TXT 子进程检查输入不变且 scratch 零残留；资源锁 79 文件 / 2,136,309 字节；
- [ ] 带病毒库或平台信誉的恶意软件扫描、生产容器/OS 禁网、只读根、CPU/内存限制和真实平台 E2E 已完成；结构/主动内容门禁不得冒充这些证据；
- [x] 短时一次性领取源码与本机/FakeStore 测试在 alpha.30 完成；
- [ ] 任务/对象双清扫、平台生命周期和三路零留存完成。

## 0.1.0-alpha.28 私有租约队列与隔离核心验收（历史，2026-07-28）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.28`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 第七个 service-role-only RPC 以 `FOR UPDATE SKIP LOCKED` 原子领取 queued/过期 processing 任务；到期前不足完整租约窗的任务不开始处理，processing 状态必须持有 exact lease；
- [x] 临时存储可强一致读取输入；服务内不可复制句柄绑定 owner，processor 请求只含最小 document 枚举与 Buffer，不含账号、任务 ID 或租约；公开 HTTP 路由没有新增 worker 动作；
- [x] `PrivateLeaseWorker` 要求 processor 最大执行时间短于租约；失败不提交结果、不删除存储输入，活动租约拒绝抢占，过期后才可接管；
- [x] 固定 Python 子进程使用绝对路径、隔离参数、无 shell、秘密/代理/进程注入环境清理、私有 scratch、超时/输出上限、源输入 SHA-256 复核和受边界保护的清理；
- [x] Python `web-check` 在同一写锁内创建临时项目并运行共享核心，响应不含路径/文件名/项目 ID/源稿哈希；本机真实 TXT 烟测输入不变且 scratch 零残留；
- [x] 专项 31/31、Web 91/91、Node 462、Python 352 全量零失败；资源锁 78 文件 / 2,126,802 字节；
- [ ] 真实 Supabase/Blobs/GoTrue/容器 E2E、OS 级网络拒绝、恶意 DOCX/EPUB/ZIP 门禁、短时下载、双清扫/生命周期和三路零留存完成；本机子进程证据不得被表述为生产隔离或上线验收。

## 0.1.0-alpha.27 持久任务与幂等数据库验收（历史，2026-07-28）

- [x] APP、Python core、桌面/Web lockfile 统一为 `0.1.0-alpha.27`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] Supabase/Postgres 迁移只保存内容无关的任务、最小文档枚举、预留/租约和幂等墓碑；没有稿件字节、文件名、路径或正文列；
- [x] 两表强制 RLS，浏览器角色无表/RPC 权限，六个固定 RPC 只授予 `service_role`；service-role key 只能由有界服务端适配器发送到规范 HTTPS Supabase origin；
- [x] 创建/重放在事务 advisory lock 内原子处理同键冲突、终态墓碑、UUID 碰撞和全局/账户并发；状态更新使用 revision CAS，终态删除原子保留 content-free 幂等墓碑；
- [x] 持久服务支持跨实例创建/读取、上传预留、处理租约、结果完成、删除待办和 TTL 扫描；完成必须绑定 exact 未过期 lease，活动租约拒绝抢占、过期租约可安全接管；CAS 冲突清理孤立输入，删除失败跨重启保持 `deletion_pending` 并可重试；
- [x] HTTP handler 等待异步持久读/预留/释放，同时兼容原内存参考实现；repository/持久服务 16/16、全部 Web 85/85、Node 455、Python 351 全量零失败；
- [x] 资源信任复验为 78 文件 / 2,124,858 字节；Web 私有数据库/服务源码不进入 Electron 打包资源；
- [ ] 迁移已在隔离真实 Supabase 执行并验证 Postgres 语法、RLS、权限、多实例竞态、连接池、备份/恢复与故障行为；本轮仅有 SQL 静态契约和离线 FakeRepository，不得宣称生产数据库上线；
- [ ] 私有队列/隔离 worker、恶意文件门禁、真实计划双清扫、短时下载、告警、区域故障演练和三路零留存证据已完成；alpha.28 只关闭了源码/本机子进程部分，生产项仍未完成。

## 0.1.0-alpha.26 Netlify 临时对象存储验收（历史，2026-07-28）

- [x] APP、Python core、桌面 lockfile 与 Web 私有子包统一为 `0.1.0-alpha.26`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 站点级 store 配置强一致读取；对象键由固定 prefix、规范任务 UUID 和 input/output 构造，写入使用 `onlyIfNew`，不一致既有对象不得覆盖；
- [x] metadata exact 固定对象身份、到期时间、媒体类型与字节数；读取重新校验 metadata/长度；删除必须经强一致缺失复验才成功；
- [x] 模糊写失败只在现有字节和 metadata 完全一致时幂等恢复；损坏 metadata、内容漂移、非法 ID/前缀/时间/媒体类型及不完整 SDK 响应 fail-closed；
- [x] 独立到期清扫器分页扫描固定 prefix；到期对象和已确认 metadata 损坏的已知任务对象删除；metadata 暂时不可读时保留，未确认删除返回 pending，未知键不越权删除；
- [x] SDK 隔离在 Web 子包并精确锁定无当前已知漏洞的 10.1.0；桌面根依赖无新增；Web 69/69、Node 439、Python 351 全量零失败；
- [x] 文档明确 Netlify Blobs 没有替本项目提供原生 TTL，metadata/清扫器不等于生产零留存；本轮没有真实 store、部署或 Windows build；
- [ ] 持久任务/幂等数据库、私有队列/隔离 worker、恶意文件门禁、真实计划清扫、短时下载、区域/并发/故障演练和三路零留存证据已完成；因此本节不是生产上线或销售验收。

## 0.1.0-alpha.25 GoTrue、Fetch 与 Web 工作台验收（历史，2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.25`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] GoTrue verifier 只接受规范 HTTPS Supabase origin，固定 `/auth/v1/user`，不带 Cookie、不跟随重定向；token/API key/超时/响应大小/媒体/JSON/subject 全部有界，身份失败与上游失败分流且错误不反射秘密；
- [x] 标准 Fetch `Request/Response` 可流式接入现有 handler；Fetch → GoTrue → Supabase resolver → handler → job 端到端契约通过；
- [x] Web 工作台保留湖岸账号登录、注册、账户入口，引用体例含“默认”，任务创建前要求本次临时处理同意；支持创建、上传、轮询、取消和结果下载，创建 JSON 不含文件名/路径；
- [x] 结果同步未接通时明确禁用并说明四选一未来边界；登录不等于同意长期同步；
- [x] Web 定向 61/61；最终 Node 431 / Python 351 全量零失败；桌面 1440px 与真实 390px 断网静态渲染通过；
- [x] 本检查点没有部署官网或重复打包；文档明确保留 alpha.23 为最新真实 Windows 制品，不借用其 smoke/安装证据证明 alpha.25；
- [ ] 生产 Netlify/Supabase 配置、真实账号 E2E、隔离对象存储/worker、恶意文件门禁、计费、短时下载、结果同步、隐私/条款与官网发布已实现并验收；因此本节不是上线或销售验收。

## 0.1.0-alpha.24 Supabase Bearer 会话适配验收（历史，2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.24`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 官网现有 Supabase Bearer/GoTrue 验证模式经只读源码核对；网站目录没有修改；
- [x] 唯一且格式有界的 Authorization Bearer 只交给注入 verifier；exact 已验证 subject 被净化为 account principal，token、角色、邮箱和完整 user 不进入任务或审计；
- [x] handler 明确区分 Bearer 与 Cookie：两者均要求 HTTPS 和写操作精确同源，Bearer 不开放 CORS，Cookie 模式继续强制 timing-safe CSRF；
- [x] 定向 25/25；最终 Node 413 / Python 351 全量零失败；版本字节导致的旧资源锁漂移先被门禁拒绝，显式更新后 78 文件资源清单与锚点复验通过；
- [x] 本检查点没有重复打包；文档明确保留 alpha.23 为最新真实 Windows 制品，不借用其 smoke/安装证据证明 alpha.24；
- [ ] 生产 GoTrue/Supabase verifier、受信代理、对象存储/隔离 worker、恶意文件门禁、短时下载、计费与官网 UI 已实现并联调；
- [ ] 真实 Windows 安装生命周期、签名、macOS、生产同步和全部 sale 门禁完成。

## 0.1.0-alpha.23 同源 HTTPS Web 作业 handler 验收（历史，2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.23`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 六个公开动作固定为创建、状态、输入上传、结果下载、取消和删除；不提供 worker 开始/完成 HTTP 路由；
- [x] HTTPS、精确同源 Origin/Fetch Metadata、trusted exact 会话和状态变更 CSRF 均在读取正文前 fail-closed；错误不反射内部异常；
- [x] 上传要求唯一 Content-Length，拒绝 Transfer-Encoding、文件名/处置/摘要头；大小、MIME、并发预留在读取稿件字节前完成，失败释放预留；
- [x] HTTP 错误/审计两份 exact schema 已进入资源信任清单；审计不含主体、任务 ID、URL、头或稿件元数据，sink 故障不影响响应；
- [x] Web HTTP/状态机定向 36/36；最终 Node 406 / Python 351 全量零失败；source 与 packaged 隐藏 smoke、Windows build、真实 ASAR/9 fuse/78 文件资源、NSIS/ZIP 与发行证据通过；
- [x] alpha.12 → alpha.23 安装生命周期只读预检通过，`authorized=false`，未启动安装器；六项发行文件逐字节归档至 `release/archive/0.1.0-alpha.23-final/`；
- [ ] 真实湖岸会话、监听器/受信反向代理、对象存储/容器、恶意 ZIP/病毒检查、短时下载、计费、生产生命周期和官网 UI 已实现并在生产环境证明零留存；因此本节不是网页版或正式销售验收；
- [ ] 真实 Windows 安装/升级/降级探测/卸载、签名、macOS、生产账号/同步和全部 sale 门禁完成。

## 0.1.0-alpha.22 Web 临时作业契约与零留存状态机验收（历史，2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.22`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] 创建/状态/删除 exact schema 固定；可信主体独立注入，请求不能自报账号、token、文件名、路径、正文、片段、内容哈希或未知字段；
- [x] 单任务同意必须为明确、时间有效的 `single_job_processing`；上传字节、公开状态和观察事件分道，运行时大小上限不能放宽 tracked schema；
- [x] 账号/匿名会话隔离、幂等重放/冲突/终态墓碑、每主体/全局并发和 UUID 碰撞失败关闭均有反向测试；
- [x] 完成处理删除输入后才开放短期结果；取消、用户删除和 TTL 清扫删除输入/输出并传递存储生命周期期限；部分删除失败进入 `deletion_pending`，准确报告保留状态且不生成成功回执；
- [x] Web 契约定向 17/17；最终 Node 387 / Python 351 全量零失败；source 与 packaged 隐藏 smoke、Windows build、真实 ASAR/9 fuse/资源、NSIS/ZIP 与发行证据通过；
- [x] alpha.12 → alpha.22 安装生命周期只读预检通过，`authorized=false`，未启动安装器；六项发行文件逐字节归档至 `release/archive/0.1.0-alpha.22-final/`；
- [ ] 同源 HTTPS、Supabase 会话、隔离对象存储/容器、恶意 ZIP/病毒检查、短时下载、计费、真实生命周期和官网 UI 已实现并在生产环境证明零留存；因此本节不是网页版或正式销售验收；
- [ ] 真实 Windows 安装/升级/降级探测/卸载、签名、macOS、生产账号/同步和全部 sale 门禁完成。

## 0.1.0-alpha.21 本机加密同步队列与重启恢复验收（2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.21`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] `safeStorage` 加密持久队列使用 exact schema、canonical JSON、revision CAS、原子替换和提交后复验，拒绝链接、篡改、短读与路径逃逸；
- [x] 队列、幂等 ID 和项目阻止项按账户隔离；未登录不可查看或操作，Renderer 不接收内部账户 ID；
- [x] 系统安全存储不可用或队列损坏时同步 fail-closed，本地稿件检查、修复和导出不受影响；生产 transport 保持未配置且不联网；
- [x] source 与 packaged 双阶段隐藏 smoke 真实证明首次进程加密写入、第二进程恢复；密文无 store type/record ID 明文；
- [x] 最终 Node 370 / Python 351 全量零失败；Windows NSIS/ZIP、真实 ASAR、9 fuse、packaged 门禁、双阶段 smoke 和发行证据通过；
- [x] alpha.12 → alpha.21 安装生命周期只读预检通过，`authorized=false`，未启动安装器；
- [ ] 生产 Auth/凭据、独立网络 transport、服务端/网站后台、支付订阅、真实安装、签名、macOS/Web 和全部 sale 门禁完成；因此本节仍不是正式发行验收。

## 0.1.0-alpha.20 打包发行身份与真实 ASAR 元数据绑定验收（历史，2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.20`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] packaged 门禁从真实 `app.asar/package.json` 读取生产身份，报告 `package_evidence_scope=packaged-app-asar`；修改源码 package 不能伪造 packaged 证据；
- [x] production `oakReleaseIdentity` exact marker 与源码 `build.appId`、发行身份文件交叉一致；ASAR 内 marker appId 漂移、重复字段和缺字段均 fail-closed；
- [x] ASAR 文件读取使用当前 raw header 和精确读取循环，拒绝缓存陈旧、短读、目录/link/unpacked/非法偏移、同路径重建残留及读取期间归档身份变化；
- [x] 过程中的旧 `extractFile` 非法 JSON、production package 裁剪、仅 `uncache()` 不充分和测试 ASAR 未完全刷盘均有失败记录；测试辅助器等待完整归档而生产读取器继续严格拒绝短读，最终完整 Node 回归连续三轮通过；
- [x] 最终全量 Node 359 / Python 351，0 失败；source smoke 与 packaged smoke PASS；最终隐藏 `npm run build:win` 204.1 秒退出 0；NSIS/ZIP、真实 ASAR 身份、资源、9 fuse、EpubCheck/Ace 与发行证据通过；
- [x] alpha.12 → alpha.20 安装生命周期只读预检通过，`authorized=false`，未启动安装器；
- [ ] 法定销售主体、正式链接、版权、平台签名主体和具名复核已确认，`RELEASE_PUBLISHER_METADATA_PENDING` 已关闭；
- [ ] 真实 alpha.12 → alpha.20 安装、升级、旧版回装探测、卸载、HKCU/Desktop/Start Menu 清理和 userData 保留已在获准系统环境执行并产生 PASS 证据；
- [ ] Windows Authenticode、五类 provenance 人工签核、Ace 正式边界、干净机、macOS/Web、生产账号/订阅/同步和全部 sale 门禁完成；因此本节仍不是正式发行验收。

## 0.1.0-alpha.19 发行商身份 fail-closed 门禁验收（历史，2026-07-28）

- [x] APP、Python core 与 lockfile 统一为 `0.1.0-alpha.19`；标准内容仍为 2.0.0、35 条规则、6 个机械 fixer；
- [x] canonical 发行身份文件和固定摘要 v1 schema 记录产品名、appId、品牌与官网；未知法定销售主体、正式链接、版权、签名主体和具名复核保持显式待定；
- [x] 只读验证器拒绝重复键、unknown/reordered 字段、非 canonical/schema 漂移、占位文本、不受信 URL、身份/package 漂移；无自批准写入入口；
- [x] `RELEASE_PUBLISHER_METADATA_PENDING` 在 alpha 可见、sale 提升为错误；源码/packaged blocker 如实变为 17/12；72 文件资源清单和真实 `app.asar` 锚点绑定身份契约；
- [x] 最终全量 Node 355 / Python 351，0 失败；外层隐藏 `npm run build:win` 190.9 秒退出 0；alpha.19 NSIS/ZIP、真实 packaged 资源、9 fuse、运行时探针、EpubCheck/Ace smoke、发布摘要与安装生命周期只读预检通过；
- [ ] 法定销售主体、官方支持/隐私/条款链接、版权声明、Windows 证书 subject、Apple Team ID 和具名复核已由有权人员确认，并与 `package.json` 完整一致；
- [ ] 真实 alpha.12 → alpha.19 安装、升级、旧版回装探测、卸载、HKCU/Desktop/Start Menu 清理和 userData 保留已在获准系统环境执行并产生 PASS 证据；
- [ ] Windows Authenticode、五类 provenance 人工签核、Ace 正式边界、干净机、macOS/Web、生产账号/订阅/同步和全部 sale 门禁完成；因此本节仍不是正式发行验收。

## 0.1.0-alpha.18 Electron 与 Windows builder 来源机器证据验收（历史，2026-07-28）

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
- [x] 同一账号队列的同一幂等 ID 不重复，支持取消、重试、删除；预览、暂不同步或不再询问均不会误入队；
- [x] 账号/同步 Node/Python/IPC/UI 测试、统一 `npm test`、标准、Electron runtime、Windows alpha 资源门禁及沙箱外隐藏双样本 smoke 均通过；原稿哈希不变；
- [x] `pending_transport`、未签名模拟权益、OS 加密本机队列与生产 transport 未配置状态在 UI/文档中明确，不声称已上传或已接入网站；
- [ ] 系统浏览器真实 PKCE、OS 安全凭据、生产签名授权缓存和设备撤销完成；
- [x] 加密持久队列、账户隔离、取消/重试/删除、篡改拒绝与第二进程恢复完成；
- [ ] 独立网络 transport、Supabase/支付/网站后台、云端查看/导出/删除和双端 schema 验证完成；
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

当前源码 Windows sale 门禁为 17 类机器码；真实 alpha.21 packaged ASAR 会关闭其中 5 个 loose 可信根项，保留 12 类：

1. `RELEASE_PUBLISHER_METADATA_PENDING`；
2. `FORMAL_LICENSE_AUDIT_REQUIRED`；
3. `PYTHON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
4. `EPUBCHECK_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
5. `JRE_SOURCE_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
6. `EPUBCHECK_TRUST_ROOT_NOT_HARDENED`；
7. `JRE_TRUST_ROOT_NOT_HARDENED`；
8. `PYTHON_RUNTIME_TRUST_ROOT_NOT_HARDENED`；
9. `APP_RESOURCES_TRUST_ROOT_NOT_HARDENED`；
10. `ELECTRON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
11. `BUILDER_TOOLCHAIN_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；
12. `ACE_FULL_LICENSE_AUDIT_REQUIRED`；
13. `ACE_TRUST_ROOT_NOT_HARDENED`；
14. `ACE_CONTROLLED_HELPER_PENDING`；
15. `ACE_BROWSER_RUNTIME_PENDING`；
16. `ACE_OS_NETWORK_ISOLATION_PENDING`；
17. `WINDOWS_CODE_SIGNING_PENDING`。

packaged 门禁会关闭上列第 6、7、8、9、13 项，保留 12 项；这些关闭来自真实 `app.asar`、JRE、Python、EpubCheck 与 Ace 锚点复验，不是人工豁免。`RELEASE_PUBLISHER_METADATA_PENDING` 只能由已确认身份、具名复核与一致 package/signing 元数据关闭。

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
- [x] 登录、逐字段确认、负载白名单、按账户加密入队和重启恢复契约已验证；未登录不询问/不显示队列，负载不含稿件、正文/预览、标题、文件名、路径、参考文献原文或哈希
- [ ] 生产网络同步仍只在上述明确确认后发生，并通过服务端同 schema、账号归属、持久队列、撤销/删除与真实隐私验收
- [ ] 网站后台可查看并删除已同步记录（阶段 4 验收）
- [ ] 正式发布包候选的 Python 单元/集成 + CLI 端到端 + UI 冒烟 E2E 全部通过（alpha.8 源码全量基线与隐藏源码 smoke 已通过；因尚无 alpha.8 安装包或 ZIP，打包版 E2E 仍未运行）
- [ ] 当前正式发布包有版本、说明、校验值和已知限制（`RELEASE_NOTES_0.0.1.md` 仅是历史资料）
