# WEBSITE_INTEGRATION — 网站对接与 Provider 接口

> 当前依据为商业正式版方案 v2.0。2026-07-28 已只读复核本地 `netlify-site` 的 Supabase/Netlify Functions 鉴权源码；这不证明线上部署与本地分支一致。核心功能不依赖网站；一切对接经 Provider 接口，后接保持本地项目格式向后兼容。

## Provider 一览（当前 alpha.29）

alpha.29 在私有 worker 前新增固定 Python `web-inspect`：稿件通过 UTF-8/格式、危险 ZIP 结构及宏/脚本主动内容检查后才写入短期 Blobs；账号、任务 ID 与租约不进入 inspector/processor，拒绝零字节入库。本机真实 TXT 检查烟测已通过，但该能力不是病毒库或平台信誉扫描；数据库/store 仍是 Fake/静态检查，没有执行真实迁移或连接 Supabase/Netlify，也没有容器/OS 无网隔离证据。商业仓库没有复制真实 service-role key、没有修改网站或部署 worker、签名权益/计费、同步 transport 或网站后台。

| Provider | 当前行为 | 未来对接目标 |
|---|---|---|
| `AuthProvider` | 状态机覆盖未登录/已登录/过期/撤销，固定生产方式为系统浏览器 PKCE；未配置时返回 `configuration_required`，不打开页面、不联网；登录模拟仅供测试实例 | 湖岸橡树官网统一认证、系统浏览器 PKCE、系统安全存储、邮箱与 Google OAuth |
| `LicenseProvider` | Free/Pro 能力矩阵、有效期/宽限/过期降级已固定；`signatureVerified=false`，永不锁已有本地文件 | 服务端签名权益、离线宽限、设备管理和订阅计费；价格未拍板 |
| `EvaluationProvider` | 用户点击后返回固定湖岸 HTTPS 评估页 URL，由主进程白名单校验并交给系统浏览器打开；APP 不在该 Provider 中生成或上传摘要 | 用户确认后提交脱敏摘要（§8.3–§8.4） |
| `SyncProvider` | 可信 Python 来源 → SyncRecord v1 exact 校验 → 完整预览 → 四选一确认 → 按账户隔离的 OS 加密 `pending_transport` 队列；可重启恢复，不联网、不声称上传成功 | 登录用户明确选择后，只同步检查结果和必要元数据；独立最小权限 transport、服务端幂等/归属验证、重试退避和云端撤销/删除 |
| `StandardsProvider` | 离线验证内置 release；本地签名包预览/安装/全局回滚、项目固定版本与显式升级已实现；生产 trust pin 缺失时导入禁用 | 用户主动触发的在线检查/下载、签名与撤回分发、可观测回滚；绝不上传稿件 |
| `UpdateProvider` | 尚未实现或导出 | 签名应用更新 |
| `FeedbackProvider` | 尚未实现或导出 | 用户主动发送不含正文的规则反馈 |

## 当前离线边界与硬性验收（对应 §20.1 / §21）

- 未登录状态**不触发**任何同步询问与网络调用；
- Auth、License 与 Sync 的当前实现不发起网络请求；StandardsProvider 目前也只有本地文件路径，没有联网 transport。Evaluation 是例外：只有用户点击后，主进程才把固定白名单 HTTPS URL 交给系统浏览器，浏览器随后可能联网；Update/Feedback 当前根本没有实现，不能写成已有占位代码路径；
- 标准包 transport 未来必须与本地验证分层：网络层只能提供候选字节，不能设置“已验证”状态、选择项目升级目标或绕过签名/CAS/高水位/回滚规则；默认 Electron session 继续离线；
- 全局标准更新不等于项目升级。已有项目保持七字段 pin，用户查看完整差异并一次确认后才可迁移，之后强制重检；
- 同步负载 JSON schema 带版本号；当前实现不改变 `project.json`，进程内队列不得伪造同步历史。生产服务端确认机制上线时，项目持久状态必须另行版本化并保持向后兼容；
- 同步负载物理上不得包含稿件、正文、摘录、标题、文件名、本地路径、参考文献原文或任何文件哈希；
- “同步结果”与 Web 版“用户主动提交临时处理任务”是两条不同数据流。Web 作业可以在明确操作后上传待处理文件，但必须使用隔离临时存储、TTL 删除和零留存审计，不能进入用户同步历史；
- Windows、macOS 和 Web 共用同一湖岸官网账号与权益判定，不另建 APP 独立账号库。

## Web 作业契约 v1、HTTP/GoTrue/Fetch/Blobs/Postgres/inspection/worker 与账号适配（alpha.29）

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
- 完成处理时删除输入，只保留到同一短 TTL 的结果；取消、用户删除和 TTL 清扫删除输入与输出，并把 `deleteAt` 传给存储生命周期策略；
- 删除部分失败时状态为 `deletion_pending`，准确报告输入/结果是否仍保留；只有两类内容均删除后才生成回执；
- 作业完成不会自动生成、排队或发送 SyncRecord。只有用户另行明确选择时，结果元数据才进入独立同步流程。

`web/http-handler.js` 固定 `/manuscript/api/v1/jobs` 下的六个公开动作：创建、状态、输入上传、结果下载、取消和删除。它不提供 worker 开始/完成接口；后台处理必须走私有队列。状态变更要求规范 HTTPS origin、精确同源 `Origin` 以及合法的 Fetch Metadata。`web/supabase-session-adapter.js` 只接受唯一、格式有界的 Authorization Bearer；`web/gotrue-verifier.js` 固定向规范 HTTPS Supabase origin 的 `/auth/v1/user` 发起无 Cookie、无重定向、有超时/响应上限的 GET，并只输出 exact subject。`web/fetch-adapter.js` 把标准 Fetch 请求流接入 handler。Bearer 不另建 CSRF 状态，Cookie 会话仍强制 CSRF；响应不设置 CORS，错误与审计不记录 token、主体、任务 ID、URL、请求头或稿件信息。

`web/supabase/001_web_job_state.sql` 建立强制 RLS 的任务/幂等表及七个 service-role-only RPC；创建/重放用 advisory transaction lock，状态更新用 revision CAS，删除保留 content-free terminal tombstone，私有领取用 `FOR UPDATE SKIP LOCKED` 且要求完整租约窗。`web/persistent-job-service.js`、`web/python-core-process-processor.js` 与 `web/private-lease-worker.js` 依次负责持久状态、上传 `web-inspect`/共享核心 `web-check` 固定子进程和身份最小化编排。原 `WebJobService` 只保留为内存参考实现。迁移必须先在隔离预生产 Supabase 由有权人员执行和复核，不能由浏览器或普通用户 JWT 运行。

| 方法 | 路径 | 用途 | 成功状态 |
|---|---|---|---:|
| `POST` | `/manuscript/api/v1/jobs` | 创建已同意的临时任务 | 201 |
| `GET` | `/manuscript/api/v1/jobs/:job_id` | 读取公开任务状态 | 200 |
| `PUT` | `/manuscript/api/v1/jobs/:job_id/input` | 上传与创建声明一致的字节 | 202 |
| `GET` | `/manuscript/api/v1/jobs/:job_id/result` | 下载短期结果 | 200 |
| `POST` | `/manuscript/api/v1/jobs/:job_id/cancel` | 明确取消并触发删除 | 200 |
| `DELETE` | `/manuscript/api/v1/jobs/:job_id` | 删除任务内容并取得回执 | 200 |

部署必须用服务端环境分别注入 Supabase origin、GoTrue 所需 API key 和仅供 repository 使用的 service-role key；任何 service-role 值都不得进入浏览器、客户端 bundle、日志、错误、inspector 或 processor。不能本地无验签解码 JWT，也不能把请求正文、普通代理头或浏览器自报角色映射为 principal。Cookie 部署则返回带 `csrf_token` 的 cookie session。反向代理只能从受信基础设施信息判断 HTTPS，不能直接信任客户端 `X-Forwarded-Proto`。Blobs store 必须为站点级强一致配置，并由计划任务同时运行状态 `sweepExpired()` 与内容 `sweepExpiredObjects()`；metadata 本身不是自动 TTL。`web/client/` 已有登录/注册、默认引用、单任务同意、创建/上传/轮询/取消/下载 UI，但当前代码仍没有生产迁移/容器部署、OS 级禁网、病毒库/平台恶意软件扫描、订阅计费、短时签名下载、真实生命周期证明或结果同步。

## 网站侧待建页面

2026-07-11 快照记录的缺口见 `湖岸稿件_网站配套页面现状对照_20260711.md`；该数字可能已经变化。隐私政策、使用条款、账号后台、订阅管理、同步记录删除和 Web 应用承载页均须在正式联调时现场核对。网站改动属网站项目任务，须经用户授权后在网站项目单独执行，本仓库不写入网站目录。
