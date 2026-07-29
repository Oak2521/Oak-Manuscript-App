# WEBSITE_INTEGRATION — 网站对接与 Provider 接口

> 当前依据为商业正式版方案 v2.0。2026-07-28 已只读复核本地 `netlify-site` 的 Supabase/Netlify Functions 鉴权源码；这不证明线上部署与本地分支一致。核心功能不依赖网站；一切对接经 Provider 接口，后接保持本地项目格式向后兼容。

## Provider 一览（当前 alpha.48 源码）

alpha.38 新增 SyncRecord 长期结果的独立服务/API/Supabase/runtime；alpha.39 增加桌面系统浏览器 PKCE、OS 加密 token-store、主进程条件 transport 和逐项显式发送 UI；alpha.44 增加桌面签名权益验证和网站同步历史客户端；alpha.45 增加独立签发链；alpha.46 增加规范化订阅事件和当前账号设备管理 API/runtime/SQL；alpha.47 增加网站订阅状态、掩码设备列表和逐台确认撤销客户端；alpha.48 以同一匿名状态验证网站撤销后桌面显式刷新 signed revoked 权益并安全降级。受信账号与权益配置仍为 `pending_configuration` 且端点/key/公钥为空；数据库迁移未执行、API 与客户端未部署，因此普通 APP 仍不登录、刷新订阅或同步。商业仓库没有真实 service-role key、OAuth 配置、权益私钥或 AI key。

| Provider | 当前行为 | 未来对接目标 |
|---|---|---|
| `AuthProvider` | 系统浏览器 Authorization Code + PKCE S256/state、固定 Windows/macOS 深链、safeStorage token-store、刷新身份复核已完成离线源码/注入测试；默认配置为空时返回 `configuration_required`，不打开页面、不联网 | 在获准预生产环境核对正式 OAuth/OIDC、nonce/ID-token 取舍、真实刷新/退出/撤销、邮箱与 Google OAuth |
| `LicenseProvider` | alpha.44—alpha.47 已实现桌面权益、签发、订阅/设备服务和网站客户端；alpha.48 已完成匿名撤销传播纵向链；默认配置为空，仓库无生产私钥 | 选择支付商并实现原始 webhook 验签适配、私钥托管/轮换，执行迁移、部署客户端并填充生产配置完成真实 E2E；价格未拍板 |
| `EvaluationProvider` | 用户点击后返回固定湖岸 HTTPS 评估页 URL，由主进程白名单校验并交给系统浏览器打开；APP 不在该 Provider 中生成或上传摘要 | 用户确认后提交脱敏摘要（§8.3–§8.4） |
| `SyncProvider` | 可信 Python 来源 → exact 校验 → 完整预览 → 四选一确认 → 按账户 OS 加密队列；服务/API/Supabase、桌面 client/coordinator 和网站列表/属主删除 client 已有源码；默认无端点，迁移/服务/页面未部署 | 填充受信正式配置，完成预生产迁移、真实 E2E 与官网账号后台部署 |
| `StandardsProvider` | 离线验证内置 release；本地签名包预览/安装/全局回滚、项目固定版本与显式升级已实现；生产 trust pin 缺失时导入禁用 | 用户主动触发的在线检查/下载、签名与撤回分发、可观测回滚；绝不上传稿件 |
| `UpdateProvider` | 尚未实现或导出 | 签名应用更新 |
| `FeedbackProvider` | 尚未实现或导出 | 用户主动发送不含正文的规则反馈 |
| `AIProvider` / `AIRequestCoordinator` / compatible transport | 三模式、Pro/safeStorage、单条预览/确认/审阅和有界 HTTP 已实现；桌面只注册 OpenAI-compatible/Ollama/LM Studio，保存/预览零请求，建议不持久化或写稿；Ollama 与 LM Studio headless 各一固定组合通过匿名窄验收，LM Studio 静默模型替换会被拒绝 | OpenAI/Anthropic/Gemini 官方协议、其他 compatible 组合、多模型语义、宽泛质量和湖岸 AI 服务仍待完成；Web 用户凭据只限当前会话，绝不进入账号同步或长期网站存储 |

## 当前离线边界与硬性验收（对应 §20.1 / §21）

- 未登录状态**不触发**任何同步询问与网络调用；
- Auth、License 与 Sync 的当前仓库默认组合不发起网络请求；只有相应受信配置从 `pending_configuration` 改为完整正式配置后才实例化网络 client。登录、订阅刷新和同步发送还分别要求用户主动操作。StandardsProvider 目前也只有本地文件路径，没有联网 transport。Evaluation 是例外：只有用户点击后，主进程才把固定白名单 HTTPS URL 交给系统浏览器，浏览器随后可能联网；Update/Feedback 当前根本没有实现，不能写成已有占位代码路径；
- 标准包 transport 未来必须与本地验证分层：网络层只能提供候选字节，不能设置“已验证”状态、选择项目升级目标或绕过签名/CAS/高水位/回滚规则；默认 Electron session 继续离线；
- 全局标准更新不等于项目升级。已有项目保持七字段 pin，用户查看完整差异并一次确认后才可迁移，之后强制重检；
- 同步负载 JSON schema 带版本号；当前实现不改变 `project.json`，进程内队列不得伪造同步历史。生产服务端确认机制上线时，项目持久状态必须另行版本化并保持向后兼容；
- 同步负载物理上不得包含稿件、正文、摘录、标题、文件名、本地路径、参考文献原文或任何文件哈希；
- “同步结果”与 Web 版“用户主动提交临时处理任务”是两条不同数据流。Web 作业可以在明确操作后上传待处理文件，但必须使用隔离临时存储、TTL 删除和零留存审计，不能进入用户同步历史；
- Windows、macOS 和 Web 共用同一湖岸官网账号与权益判定，不另建 APP 独立账号库。

## SyncRecord 长期结果 API v1（alpha.39，未部署）

长期同步与 Web 临时稿件任务是两条独立数据流。固定 API 前缀为 `/manuscript/api/v1/sync-records`：collection 的 `POST` 创建/幂等重放、`GET` 分页列表；item 的 `GET` 读取、`DELETE` 属主删除。请求不能自报账号，GoTrue Bearer 或服务器 Cookie 会话必须先解析为 exact trusted subject；服务端再用独立验证器检查 SyncRecord v1，而不是信任 Electron validator。响应不开放 CORS，状态变更强制 HTTPS、同源/Fetch Metadata；Cookie 模式另需 CSRF，Bearer 明确 `credentials:omit`。

`web/sync-record-service.js` 实现账号容量、幂等创建/重放/冲突、列表/读取/删除；列表由 repository 单次快照返回 `{rows,total}`。`web/supabase-sync-record-repository.js` 只向固定 RPC 发出无 Cookie、无重定向、有界 HTTPS POST，并严格验证响应归属和 canonical 记录。`web/supabase/002_sync_records.sql` 建立 content-free 长期表，强制 RLS，撤销 `anon`/`authenticated` 表和 RPC 权限，仅把四个固定 RPC 授予 `service_role`；账户 advisory transaction lock 使容量检查、幂等判断和插入处于同一事务。浏览器、桌面客户端和用户 JWT 都不得得到 service-role key。

`web/sync-record-runtime.js` 组合独立的公开 Supabase API key、GoTrue verifier、session resolver、service-role repository、service、HTTP handler、Fetch adapter 和必填的 content-free audit sink。部署平台需显式把这些构造参数映射到服务端秘密与同源站点 origin；源码没有自动读取或暗示任何真实环境变量值。`electron/sync-http-client.js` 固定规范 HTTPS origin、路径、Bearer、超时/响应上限和 canonical 回显；`electron/sync-transport-coordinator.js` 要求 token 与当前队列账号 exact 绑定，保证单项单在途，复核登录账号稳定性，并只在远端 `created|replayed` 后删除精确本地项。

当前未执行 `002_sync_records.sql`，未配置真实 OAuth/public/service-role key，也未部署 runtime。alpha.44 的网站 client 已有列表、刷新和属主删除 UI；导出仍未实现，页面亦未部署。桌面 PKCE/token provider/main 已具备条件接线源码，但默认配置为空；上述源码和 Fake fetch/repository 测试不能替代真实 OAuth/OIDC、GoTrue、RLS、多实例、备份恢复、删除和无密钥泄露验收。

## 订阅权益 API v1（alpha.45，未部署）

固定路由为 `POST /manuscript/api/v1/entitlement`。桌面只发送当前稳定 device ID；账号来自服务器验证的 GoTrue Bearer session，不能由请求自报。成功直接返回 signed-entitlement v1；无订阅、设备已满、认证失败和服务故障只返回 exact content-free 错误。该路由不接受 Cookie，不开放 CORS，不记录账号、设备、token 或稿件信息。

`web/entitlement-runtime.js` 组合公开 GoTrue key、独立 service-role repository、服务端 signer 和必填 audit sink。`web/supabase/003_manuscript_entitlements.sql` 提供权益/设备表和账户锁下的原子授权 RPC，只授予 `service_role`；浏览器、桌面和普通用户 JWT 不得获得 service-role key 或签名私钥。部署必须分别注入 Ed25519 私钥、key ID、issuer、API keys 和容量，不得把任何秘密打入客户端 bundle。

当前未执行 `003_manuscript_entitlements.sql` 或后续 004 migration，没有真实支付商 webhook 适配、生产私钥/HSM/轮换、设备管理页面或真实端到端证据。alpha.45 的 fake GoTrue/RPC 纵向测试只能证明签发边界组合，不证明线上订阅可用。

## 规范化订阅事件与账号设备 API v1（alpha.46，未部署）

`web/subscription-event-runtime.js` 不是公开 webhook 端点，而是供上游已验签账单适配器调用的 server-only ingestor。部署构造固定 provider ID；输入 exact 事件只含 provider event、账号/权益、原因、状态和时间窗。原始 webhook、签名、价格、付款资料与客户 PII 必须留在未来支付商专用适配器之外，不能透传或入库。provider event ID 与 canonical SHA-256 区分 applied/replayed/stale/conflict，乱序旧事件不得覆盖新权益。

网站同源账号后台可调用 `GET /manuscript/api/v1/account/license` 获取 content-free 权益状态和最多 20 台设备，调用 `POST /manuscript/api/v1/account/license/devices/:device_id/revoke` 明确撤销一台属主设备。两条路由都要求 HTTPS 与 GoTrue Bearer，POST 另要求 exact same-origin；不存在和外来设备不可区分。浏览器 bundle 不持有 service-role key，公开响应不返回账号、权益 ID 或 revision。

`web/supabase/004_subscription_events_and_devices.sql` 增加事件表、权益来源列和三个 service-role-only RPC。它必须在 001—003 之后执行。alpha.47 的 `client-contract.js` 与 `license-account-controller.js` 已加入订阅状态、最多 20 台设备、设备 ID 末尾掩码和逐台原生确认撤销；退出会清空，失败允许重试，旧响应不能在退出后回填。当前 SQL 未在真实 PostgreSQL/Supabase 解析或运行，客户端也未部署，因此不能称为线上设备自助后台已完成。

## Web 作业契约 v1、HTTP/GoTrue/Fetch/Blobs/Postgres/inspection/worker/result/cleanup 与账号适配（alpha.31）

源码入口为 `web/job-contract.js` 与 `web/http-handler.js`，机器可读契约为：

- `config/schemas/web-job-create-v1.schema.json`；
- `config/schemas/web-job-status-v1.schema.json`；
- `config/schemas/web-job-deletion-v1.schema.json`；
- `config/schemas/web-http-error-v1.schema.json`；
- `config/schemas/web-http-audit-v1.schema.json`；
- `web/schemas/web-job-internal-v1.schema.json`；
- `web/schemas/web-job-create-result-v1.schema.json`。

固定边界：

- 上游认证层传入只含 `kind/subject_id` 的可信主体；创建请求不能自报账号、携带 token 或追加未知字段；
- 创建必须含新鲜的 `single_job_processing` 明示同意、隐私版本、幂等键和最小文档枚举/字节数；文件名、路径、正文、片段与内容哈希无合法字段；
- 上传 Buffer 与任务元数据分道；公开状态和观察事件不含账号 ID、文档元数据或上传字节；字节必须先通过身份最小化的隔离结构/主动内容检查，失败固定为 `UNSAFE_DOCUMENT` 且不得写入 store；
- 每账号/匿名会话与全局并发在接收内容前门禁；同一幂等键对应不同请求会冲突，终态键拒绝隐式重建；
- 完成处理时删除输入，只保留到同一 15 分钟任务 TTL 的结果；结果只能用同源已认证 POST 领取一次，第一个领取者 CAS 独占，删除对象并提交终态墓碑后才返回；GET、并发和二次领取不得消费或返回；
- 领取读取或清理失败时不返回字节，保持 `deletion_pending/downloaded` 等待删除重试；服务器删除后若响应或本机保存失败，结果不可重放；取消、用户删除和 TTL 清扫同样删除输入与输出，并把 `deleteAt` 传给存储生命周期策略；
- 删除部分失败时状态为 `deletion_pending`，准确报告输入/结果是否仍保留；只有两类内容均删除后才生成回执；
- 作业完成不会自动生成、排队或发送 SyncRecord。只有用户另行明确选择时，结果元数据才进入独立同步流程。

`web/http-handler.js` 固定 `/manuscript/api/v1/jobs` 下的六个公开动作：创建、状态、输入上传、一次性结果领取、取消和删除。它不提供 worker 开始/完成接口；后台处理必须走私有队列。状态变更要求规范 HTTPS origin、精确同源 `Origin` 以及合法的 Fetch Metadata。`web/supabase-session-adapter.js` 只接受唯一、格式有界的 Authorization Bearer；`web/gotrue-verifier.js` 固定向规范 HTTPS Supabase origin 的 `/auth/v1/user` 发起无 Cookie、无重定向、有超时/响应上限的 GET，并只输出 exact subject。`web/fetch-adapter.js` 把标准 Fetch 请求流接入 handler。Bearer 不另建 CSRF 状态，Cookie 会话仍强制 CSRF；响应不设置 CORS，错误与审计不记录 token、主体、任务 ID、URL、请求头或稿件信息。

`web/supabase/001_web_job_state.sql` 建立强制 RLS 的任务/幂等表及八个 service-role-only RPC；创建/重放用 advisory transaction lock，状态更新用 revision CAS，删除保留 content-free terminal tombstone，私有领取用 `FOR UPDATE SKIP LOCKED` 且要求完整租约窗，清扫列表优先返回 `deletion_pending`。`web/persistent-job-service.js`、`web/python-core-process-processor.js`、`web/private-lease-worker.js` 与 `web/zero-retention-sweeper.js` 依次负责持久状态、上传 `web-inspect`/共享核心 `web-check` 固定子进程、身份最小化处理及任务—对象—任务清扫。原 `WebJobService` 只保留为内存参考实现。迁移必须先在隔离预生产 Supabase 由有权人员执行和复核，不能由浏览器或普通用户 JWT 运行。

| 方法 | 路径 | 用途 | 成功状态 |
|---|---|---|---:|
| `POST` | `/manuscript/api/v1/jobs` | 创建已同意的临时任务 | 201 |
| `GET` | `/manuscript/api/v1/jobs/:job_id` | 读取公开任务状态 | 200 |
| `PUT` | `/manuscript/api/v1/jobs/:job_id/input` | 上传与创建声明一致的字节 | 202 |
| `POST` | `/manuscript/api/v1/jobs/:job_id/result` | 一次性领取结果并在返回前清理 | 200 |
| `POST` | `/manuscript/api/v1/jobs/:job_id/cancel` | 明确取消并触发删除 | 200 |
| `DELETE` | `/manuscript/api/v1/jobs/:job_id` | 删除任务内容并取得回执 | 200 |

部署必须用服务端环境分别注入 Supabase origin、GoTrue 所需 API key 和仅供 repository 使用的 service-role key；任何 service-role 值都不得进入浏览器、客户端 bundle、日志、错误、inspector 或 processor。不能本地无验签解码 JWT，也不能把请求正文、普通代理头或浏览器自报角色映射为 principal。Cookie 部署则返回带 `csrf_token` 的 cookie session。反向代理只能从受信基础设施信息判断 HTTPS，不能直接信任客户端 `X-Forwarded-Proto`。Blobs store 必须为站点级强一致配置，私有计划任务应调用 `ZeroRetentionSweeper.runCycle()` 并对失败、pending、非法键和截断告警；metadata 本身不是自动 TTL。本地报告固定不宣称生产零留存。`web/client/` 已有登录/注册、默认引用、单任务同意、创建/上传/轮询/取消/一次性领取、SyncRecord 列表/刷新/属主删除，以及订阅状态/掩码设备/逐台确认撤销 UI；当前仍没有生产迁移/容器部署、OS 级禁网、病毒库/平台恶意软件扫描、订阅计费、真实生命周期证明或官网部署。

## 网站侧待建页面

2026-07-11 快照记录的缺口见 `湖岸稿件_网站配套页面现状对照_20260711.md`；该数字可能已经变化。隐私政策、使用条款、账号后台、订阅管理、同步记录删除和 Web 应用承载页均须在正式联调时现场核对。网站改动属网站项目任务，须经用户授权后在网站项目单独执行，本仓库不写入网站目录。
