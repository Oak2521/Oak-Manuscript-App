# Web 作业契约与同源 HTTP handler（alpha）

`job-contract.js` 是商业方案 v2.0 的服务端任务契约与内存参考实现；`persistent-job-service.js` 是跨实例持久服务；`python-core-process-processor.js` 在同一固定子进程边界提供上传 `web-inspect` 和共享核心 `web-check`，`private-lease-worker.js` 负责私有原子领取；`http-handler.js` 是不监听端口的 Node HTTP 边界；`supabase-session-adapter.js`、`gotrue-verifier.js` 和 `fetch-adapter.js` 构成账号与平台桥；`client/` 是首个未部署工作台；`netlify-ephemeral-storage.js` 把 input/output 内容接到站点级 Netlify Blobs；`supabase-job-repository.js` 和 `supabase/001_web_job_state.sql` 只持久化内容无关任务/幂等状态。它们共同形成可测试的源码/本机纵向边界，但仍不是已上线的生产上传服务。

Web 服务端依赖与 Electron 桌面依赖隔离：

```bash
npm install --prefix web
npm audit --prefix web --omit=dev
```

当前精确锁定 `@netlify/blobs 10.1.0`。10.7.10 因其 OpenTelemetry 传递依赖的 W3C Baggage 无界内存分配中危告警未采用；当前 Web 生产子包审计为 0 个已知漏洞。审计结论是 registry 当时快照，不替代持续依赖治理。

当前边界：

- 可信会话主体作为独立参数传入，创建请求不能自报账号；
- 每个任务必须携带 `single_job_processing` 明示同意；
- 请求元数据不接受文件名、路径、正文、片段、内容哈希或任意扩展字段；
- 上传字节先交给身份最小化的隔离结构/主动内容检查器；只有通过后才交给临时存储适配器，不进入公开状态或隐私事件；
- 完成处理时先写短期结果，再删除输入；取消、用户删除和 TTL 清扫删除输入与输出；
- 删除失败进入 `deletion_pending` 并返回失败，不生成成功删除回执；
- `deleteAt` 作为对象存储生命周期兜底契约传给存储适配器；
- 持久数据库只保存主体归属、最小文档枚举、状态、预留/租约、非内容请求指纹和终态幂等墓碑，不保存稿件字节；
- 任务结果不会自动生成或发送 SyncRecord，长期账号记录仍须走独立的显式同步流程。

alpha.23—alpha.30 固定：

- API 前缀 `/manuscript/api/v1/jobs`，提供创建、状态、输入上传、一次性结果领取、取消和删除动作；不暴露 worker 开始/完成路由；结果领取只接受状态变更 POST，GET 不消费；
- 只接受 HTTPS。部署在受信反向代理后时，必须由适配器用不可伪造的代理信息实现 `isSecureRequest`，不能直接信任客户端 `X-Forwarded-Proto`；
- 状态变更要求精确同源 `Origin` 和合法 `Sec-Fetch-Site`（如存在）。trusted session 显式为 Bearer 或 Cookie；Cookie 模式强制 CSRF，Bearer 模式依赖显式 Authorization、服务端 token 验证和无 CORS；
- Supabase 适配器拒绝缺失、短、带空白/逗号、重复或合并的 Authorization；注入 verifier 只能返回 exact `{subject_id}`，适配器输出不含 token、角色、邮箱或完整 user；
- GoTrue verifier 只接受规范 HTTPS origin，固定 GET `/auth/v1/user`，不发送 Cookie、不跟随重定向、默认 5 秒超时、响应上限 64 KiB；400/401/403 映射为未认证，限流/5xx/网络/超时/媒体/JSON/subject 异常使用稳定非反射错误；
- Fetch adapter 流式传递请求体，保留 handler 的读取前门禁并拒绝已消费 Request 或未完整结束的响应；不在适配对象上保留原始 Fetch Request；
- `client/` 读取网站 `window.oblAuth` 会话，显式 `credentials:"omit"` 发送 Bearer；创建负载由 exact client contract 生成且不含文件名/路径。页面包含登录/注册、默认引用、本次处理同意、创建/上传/轮询/取消/下载；生产同步尚未接通并明确禁用；
- Netlify 适配器固定 `consistency:"strong"` 的站点级 store、规范 key 与 `onlyIfNew` 条件创建；模糊失败只在现有字节和 exact metadata 相同的情况下幂等恢复，删除后再次强一致确认不存在；
- `sweepExpiredObjects()` 分页扫描固定 prefix 并按 `delete_at` 删除；已知任务对象 metadata 确认损坏时优先删除，metadata 暂时不可读时保留并返回 pending，未确认删除也返回 pending。Netlify Blobs 不自动执行该 metadata，生产必须另行调度和监控清扫；
- Supabase/Postgres 迁移强制两表 RLS，浏览器角色无表/RPC 权限，七个固定 RPC 仅授予 `service_role`；事务创建/重放使用 advisory lock，后续状态使用 revision CAS，私有领取使用 `FOR UPDATE SKIP LOCKED` 并要求完整租约窗，删除完成保留 content-free terminal tombstone；
- `PersistentWebJobService` 将上传预留、私有原子领取、结果完成、删除待办和 TTL 扫描接到 repository；CAS 丢失清理孤立输入，删除失败保持可跨重启恢复的 `deletion_pending`；`PrivateLeaseWorker` 不把账号、任务 ID 或租约交给 processor，完成仍精确绑定服务内 lease/revision/expiry；
- `PythonCoreProcessProcessor` 以固定绝对路径、参数数组、隔离环境、时间/输出/结果上限和受控 scratch 调用共享 Python `web-check`；本机真实 TXT 烟测已通过，但这不是容器或 OS 网络沙箱证据；
- 同一固定进程边界在 `putInput()` 前调用只读 `web-inspect`，拒绝非 UTF-8/NUL 文本、危险 ZIP 结构、宏/ActiveX/嵌入/DDE 与脚本 EPUB；失败固定为 `UNSAFE_DOCUMENT`、清除预留且零字节入库。它不是病毒库或文件信誉扫描；
- 第一个已认证同源 `POST /:job_id/result` 在读取前把任务独占转为 `deletion_pending/downloaded`；持久实现使用 revision CAS。input/output 删除与 content-free 终态墓碑成功后才返回字节；并发/二次领取失败，读取或清理失败不返回字节并只允许重试删除。15 分钟 TTL 不意味着可重复下载；传输或本机保存失败后必须重新检查；
- 上传必须有唯一 `Content-Length`，拒绝 `Transfer-Encoding`、文件名、`Content-Disposition` 和内容摘要头；大小/MIME/并发预留在读取稿件字节前完成；
- HTTP 错误与安全审计分别受 `web-http-error-v1`、`web-http-audit-v1` exact schema 约束。审计不记录主体、任务 ID、URL、请求头或稿件元数据；
- handler 不设置 CORS，响应固定 `no-store` / `nosniff` / CSP / `no-referrer`。错误文案固定且不反射异常、路径、账号或稿件内容。

生产实现仍须补齐：在隔离环境执行/复核 Supabase 迁移并完成 GoTrue/Postgres/Blobs 真实 E2E、平台恶意软件扫描、容器/OS 禁网与资源隔离、限额与计费、计划双清扫/告警/故障演练、结果同步和网站联调。当前一次性领取不生成额外签名 URL/token，但仍须在真实平台验证删除、传输中断与三路零留存。

## 参考调用顺序

```js
const { PersistentWebJobService } = require("./persistent-job-service");
const { SupabaseJobRepository } = require("./supabase-job-repository");
const { createWebJobHttpHandler } = require("./http-handler");
const { createSupabaseSessionResolver } = require("./supabase-session-adapter");
const { createGoTrueAccessTokenVerifier } = require("./gotrue-verifier");
const { createFetchHandlerAdapter } = require("./fetch-adapter");
const { createNetlifyEphemeralStorage } = require("./netlify-ephemeral-storage");
const { PrivateLeaseWorker } = require("./private-lease-worker");
const { PythonCoreProcessProcessor } = require("./python-core-process-processor");

const productionEphemeralStorage = createNetlifyEphemeralStorage();
const productionJobRepository = new SupabaseJobRepository({
  supabaseOrigin: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const processor = new PythonCoreProcessProcessor({
  pythonExecutable: process.env.OAK_WEB_PYTHON,
  coreDir: process.env.OAK_WEB_CORE,
  scratchRoot: process.env.OAK_WEB_SCRATCH,
});
const jobs = new PersistentWebJobService({
  repository: productionJobRepository,
  storage: productionEphemeralStorage,
  contentInspector: processor,
});
const productionGoTrueVerifier = createGoTrueAccessTokenVerifier({
  supabaseOrigin: process.env.SUPABASE_URL,
  apiKey: process.env.SUPABASE_API_KEY,
});
const trustedSessionAdapter = createSupabaseSessionResolver({
  verifyAccessToken: productionGoTrueVerifier,
});
const handler = createWebJobHttpHandler({
  service: jobs,
  expectedOrigin: "https://www.oakbylake.com",
  resolveSession: trustedSessionAdapter,
  securityEventSink: contentFreeAuditSink,
});
const handleFetchRequest = createFetchHandlerAdapter({ nodeHandler: handler });
const worker = new PrivateLeaseWorker({ service: jobs, processor });

// 由官网同源 HTTPS 平台把标准 Request 交给 handleFetchRequest。
// 由私有调度器调用 worker.runOnce()；领取与完成都不经过公开 HTTP。
// 生产调度仍须放入有 OS 禁网、只读根和资源限制的隔离环境。
```

部署前须由数据库所有者在隔离预生产项目执行并复核 `supabase/001_web_job_state.sql`。GoTrue verifier 使用服务端可用的最小 API key；任务 repository 单独使用仅存在于服务器环境的 service-role key，后者不得进入浏览器、客户端 bundle、日志或错误。不得只解码未验签 JWT，也不得把请求正文、普通代理头或 user metadata 角色映射为 principal。若改用 HttpOnly Cookie，session resolver 必须返回 `auth_mode:"cookie"` 与服务器绑定 CSRF。计划任务必须同时运行服务状态的 `sweepExpired()` 和内容 store 的 `sweepExpiredObjects()`；前者关闭任务/幂等状态，后者兜底删除孤立内容。二者都成功并不自动证明平台后台副本已删除，正式零留存仍需生产证据。

## 稳定错误码

| 错误码 | 含义 |
|---|---|
| `AUTH_REQUIRED` / `CSRF_REQUIRED` / `CROSS_SITE_REQUEST` / `INSECURE_TRANSPORT` | 会话、防跨站或 HTTPS 门禁失败 |
| `INVALID_REQUEST` / `INVALID_JSON` / `INVALID_HEADERS` | exact 字段、JSON、枚举、时间、主体或请求头非法 |
| `CONSENT_REQUIRED` / `CONSENT_STALE` | 缺少单任务明示同意，或同意过期/来自未来 |
| `JOB_NOT_FOUND` | 任务不存在或主体无权访问；不区分两者，避免枚举任务 |
| `JOB_EXPIRED` | TTL 已到，任务已转为待删除且不能继续上传、处理或下载 |
| `IDEMPOTENCY_CONFLICT` | 同一幂等键对应不同请求 |
| `IDEMPOTENCY_TERMINAL` | 同键任务已结束，拒绝隐式重建或重复计费 |
| `OWNER_CONCURRENCY_LIMIT` / `GLOBAL_CONCURRENCY_LIMIT` | 接收内容前触发并发上限 |
| `JOB_ID_COLLISION` | 连续 UUID 碰撞，拒绝覆盖现有任务 |
| `INVALID_TRANSITION` | 当前状态不允许该动作 |
| `INVALID_UPLOAD` / `UPLOAD_SIZE_MISMATCH` / `UPLOAD_MEDIA_TYPE_MISMATCH` | 上传对象、字节数或 MIME 与任务不一致 |
| `UNSAFE_DOCUMENT` | 上传未通过结构/主动内容门禁；不反射具体成员或内容，HTTP 422 |
| `INVALID_RESULT` / `RESULT_NOT_AVAILABLE` | 结果非法、超限、尚未完成或已不存在 |
| `ZERO_RETENTION_DELETE_FAILED` | 删除未完整成功；任务保留 `deletion_pending`，必须重试和告警 |

HTTP 状态和外部错误文案已由 handler 固定；生产适配层不得改写为成功或反射底层异常。当前尚未实现 `Retry-After`、速率桶、生产指标或分布式追踪，这些新增字段必须先版本化审计契约。
