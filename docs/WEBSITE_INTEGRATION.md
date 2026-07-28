# WEBSITE_INTEGRATION — 网站对接与 Provider 接口

> 当前依据为商业正式版方案 v2.0。网站现状只在 2026-07-11 做过只读快照，启动真实对接前必须重新核对，不能把旧分支状态写成当前线上事实。核心功能不依赖网站；一切对接经 Provider 接口，后接保持本地项目格式向后兼容。

## Provider 一览（当前 alpha.23）

alpha.23 继承按账号隔离、由操作系统安全存储加密、可跨重启恢复的本地 `pending_transport` 队列，并在 Web 临时作业 exact 状态机上增加不监听端口的同源 HTTPS Node handler；生产认证、签名权益/计费、网络同步 transport、真实 Web 服务器/对象存储与网站后台仍不存在。CPython 来源审计与 Windows builder 下载只发生在开发者明确授权的构建/审计输入阶段，与账号/同步 Provider 隔离；真实 APP 默认 session 仍离线，Ace loopback 仅为本机进程控制。SyncRecord v1 可包含最终体例、解析模式、原因码、置信度和解析器版本，但不得包含引用/书目原文、姓名、路径或内容哈希；权威字段见 `SYNC_RECORD_V1.md` 和 schema。

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

## Web 作业契约 v1 与 HTTP handler（alpha.23）

源码入口为 `web/job-contract.js` 与 `web/http-handler.js`，机器可读契约为：

- `config/schemas/web-job-create-v1.schema.json`；
- `config/schemas/web-job-status-v1.schema.json`；
- `config/schemas/web-job-deletion-v1.schema.json`；
- `config/schemas/web-http-error-v1.schema.json`；
- `config/schemas/web-http-audit-v1.schema.json`。

固定边界：

- 上游认证层传入只含 `kind/subject_id` 的可信主体；创建请求不能自报账号、携带 token 或追加未知字段；
- 创建必须含新鲜的 `single_job_processing` 明示同意、隐私版本、幂等键和最小文档枚举/字节数；文件名、路径、正文、片段与内容哈希无合法字段；
- 上传 Buffer 与任务元数据分道；公开状态和观察事件不含账号 ID、文档元数据或上传字节；
- 每账号/匿名会话与全局并发在接收内容前门禁；同一幂等键对应不同请求会冲突，终态键拒绝隐式重建；
- 完成处理时删除输入，只保留到同一短 TTL 的结果；取消、用户删除和 TTL 清扫删除输入与输出，并把 `deleteAt` 传给存储生命周期策略；
- 删除部分失败时状态为 `deletion_pending`，准确报告输入/结果是否仍保留；只有两类内容均删除后才生成回执；
- 作业完成不会自动生成、排队或发送 SyncRecord。只有用户另行明确选择时，结果元数据才进入独立同步流程。

`web/http-handler.js` 固定 `/manuscript/api/v1/jobs` 下的六个公开动作：创建、状态、输入上传、结果下载、取消和删除。它不提供 worker 开始/完成接口；后台处理必须走私有队列。状态变更要求规范 HTTPS origin、精确同源 `Origin`、可选但若存在必须为 `same-origin` 的 `Sec-Fetch-Site`、以及会话绑定 CSRF token。上传要求唯一 `Content-Length`，拒绝 `Transfer-Encoding`、文件名/处置/摘要头，并在读取字节前执行大小、MIME 与并发预留。错误响应和无内容安全审计均为 exact schema；不设置 CORS，不记录主体、任务 ID、URL、请求头或稿件信息。

| 方法 | 路径 | 用途 | 成功状态 |
|---|---|---|---:|
| `POST` | `/manuscript/api/v1/jobs` | 创建已同意的临时任务 | 201 |
| `GET` | `/manuscript/api/v1/jobs/:job_id` | 读取公开任务状态 | 200 |
| `PUT` | `/manuscript/api/v1/jobs/:job_id/input` | 上传与创建声明一致的字节 | 202 |
| `GET` | `/manuscript/api/v1/jobs/:job_id/result` | 下载短期结果 | 200 |
| `POST` | `/manuscript/api/v1/jobs/:job_id/cancel` | 明确取消并触发删除 | 200 |
| `DELETE` | `/manuscript/api/v1/jobs/:job_id` | 删除任务内容并取得回执 | 200 |

部署适配器必须从真实湖岸会话独立生成 `{principal, csrf_token}`。反向代理场景只能从受信基础设施信息判断 HTTPS，不能直接信任客户端 `X-Forwarded-Proto`。当前 `MemoryEphemeralStorage`、handler 与测试仍是本地参考：没有监听端口，没有 Supabase 会话、隔离对象存储/容器、任务队列、恶意 ZIP/病毒检测、订阅计费、短时签名下载、真实生命周期策略或官网 UI；因此不得称为“网页版可用”或“零留存已通过生产验收”。

## 网站侧待建页面

2026-07-11 快照记录的缺口见 `湖岸稿件_网站配套页面现状对照_20260711.md`；该数字可能已经变化。隐私政策、使用条款、账号后台、订阅管理、同步记录删除和 Web 应用承载页均须在正式联调时现场核对。网站改动属网站项目任务，须经用户授权后在网站项目单独执行，本仓库不写入网站目录。
