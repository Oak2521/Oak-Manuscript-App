# Web 作业契约与同源 HTTP handler（alpha）

`job-contract.js` 是商业方案 v2.0 的服务端任务契约与内存参考实现；`http-handler.js` 是不监听端口的 Node HTTP 边界；`supabase-session-adapter.js`、`gotrue-verifier.js` 和 `fetch-adapter.js` 构成账号与平台桥；`client/` 是首个未部署工作台；`netlify-ephemeral-storage.js` 把 input/output 内容接到站点级 Netlify Blobs。它们共同形成可测试的纵向边界，但仍不是已上线的生产上传服务。

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
- 上传字节只交给临时存储适配器，不进入公开状态或隐私事件；
- 完成处理时先写短期结果，再删除输入；取消、用户删除和 TTL 清扫删除输入与输出；
- 删除失败进入 `deletion_pending` 并返回失败，不生成成功删除回执；
- `deleteAt` 作为对象存储生命周期兜底契约传给存储适配器；
- 任务结果不会自动生成或发送 SyncRecord，长期账号记录仍须走独立的显式同步流程。

alpha.23—alpha.26 固定：

- API 前缀 `/manuscript/api/v1/jobs`，提供创建、状态、输入上传、结果下载、取消和删除路由；不暴露 worker 开始/完成路由；
- 只接受 HTTPS。部署在受信反向代理后时，必须由适配器用不可伪造的代理信息实现 `isSecureRequest`，不能直接信任客户端 `X-Forwarded-Proto`；
- 状态变更要求精确同源 `Origin` 和合法 `Sec-Fetch-Site`（如存在）。trusted session 显式为 Bearer 或 Cookie；Cookie 模式强制 CSRF，Bearer 模式依赖显式 Authorization、服务端 token 验证和无 CORS；
- Supabase 适配器拒绝缺失、短、带空白/逗号、重复或合并的 Authorization；注入 verifier 只能返回 exact `{subject_id}`，适配器输出不含 token、角色、邮箱或完整 user；
- GoTrue verifier 只接受规范 HTTPS origin，固定 GET `/auth/v1/user`，不发送 Cookie、不跟随重定向、默认 5 秒超时、响应上限 64 KiB；400/401/403 映射为未认证，限流/5xx/网络/超时/媒体/JSON/subject 异常使用稳定非反射错误；
- Fetch adapter 流式传递请求体，保留 handler 的读取前门禁并拒绝已消费 Request 或未完整结束的响应；不在适配对象上保留原始 Fetch Request；
- `client/` 读取网站 `window.oblAuth` 会话，显式 `credentials:"omit"` 发送 Bearer；创建负载由 exact client contract 生成且不含文件名/路径。页面包含登录/注册、默认引用、本次处理同意、创建/上传/轮询/取消/下载；生产同步尚未接通并明确禁用；
- Netlify 适配器固定 `consistency:"strong"` 的站点级 store、规范 key 与 `onlyIfNew` 条件创建；模糊失败只在现有字节和 exact metadata 相同的情况下幂等恢复，删除后再次强一致确认不存在；
- `sweepExpiredObjects()` 分页扫描固定 prefix 并按 `delete_at` 删除；已知任务对象 metadata 确认损坏时优先删除，metadata 暂时不可读时保留并返回 pending，未确认删除也返回 pending。Netlify Blobs 不自动执行该 metadata，生产必须另行调度和监控清扫；
- 上传必须有唯一 `Content-Length`，拒绝 `Transfer-Encoding`、文件名、`Content-Disposition` 和内容摘要头；大小/MIME/并发预留在读取稿件字节前完成；
- HTTP 错误与安全审计分别受 `web-http-error-v1`、`web-http-audit-v1` exact schema 约束。审计不记录主体、任务 ID、URL、请求头或稿件元数据；
- handler 不设置 CORS，响应固定 `no-store` / `nosniff` / CSP / `no-referrer`。错误文案固定且不反射异常、路径、账号或稿件内容。

生产实现仍须补齐：部署 GoTrue/Supabase/Blobs 环境配置与真实 E2E、持久任务/幂等数据库、私有队列和隔离 worker、恶意 ZIP/病毒检查、限额与计费、短时下载凭证、计划清扫/告警/故障演练、结果同步和网站联调。

## 参考调用顺序

```js
const { WebJobService } = require("./job-contract");
const { createWebJobHttpHandler } = require("./http-handler");
const { createSupabaseSessionResolver } = require("./supabase-session-adapter");
const { createGoTrueAccessTokenVerifier } = require("./gotrue-verifier");
const { createFetchHandlerAdapter } = require("./fetch-adapter");
const { createNetlifyEphemeralStorage } = require("./netlify-ephemeral-storage");

const productionEphemeralStorage = createNetlifyEphemeralStorage();
const jobs = new WebJobService({ storage: productionEphemeralStorage });
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

// 由官网同源 HTTPS 平台把标准 Request 交给 handleFetchRequest。
// Worker 只通过私有队列调用 beginProcessing / completeJob，不经过公开 HTTP。
```

部署配置应使用服务端可用、权限最小的 Supabase API key，不得把 service-role key 送进浏览器。不得只解码未验签 JWT，也不得把请求正文、普通代理头或 user metadata 角色映射为 principal。若改用 HttpOnly Cookie，session resolver 必须返回 `auth_mode:"cookie"` 与服务器绑定 CSRF。计划任务必须同时运行服务状态的 `sweepExpired()` 和内容 store 的 `sweepExpiredObjects()`；前者关闭任务/幂等状态，后者兜底删除孤立内容。二者都成功并不自动证明平台后台副本已删除，正式零留存仍需生产证据。

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
| `INVALID_RESULT` / `RESULT_NOT_AVAILABLE` | 结果非法、超限、尚未完成或已不存在 |
| `ZERO_RETENTION_DELETE_FAILED` | 删除未完整成功；任务保留 `deletion_pending`，必须重试和告警 |

HTTP 状态和外部错误文案已由 handler 固定；生产适配层不得改写为成功或反射底层异常。当前尚未实现 `Retry-After`、速率桶、生产指标或分布式追踪，这些新增字段必须先版本化审计契约。
