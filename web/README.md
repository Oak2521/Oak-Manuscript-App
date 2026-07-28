# Web 作业契约与同源 HTTP handler（alpha）

`job-contract.js` 是商业方案 v2.0 的服务端任务契约与内存参考实现；`http-handler.js` 是不监听端口的 Node HTTP 请求处理边界。二者都不是已部署的网页版或生产上传服务。

当前边界：

- 可信会话主体作为独立参数传入，创建请求不能自报账号；
- 每个任务必须携带 `single_job_processing` 明示同意；
- 请求元数据不接受文件名、路径、正文、片段、内容哈希或任意扩展字段；
- 上传字节只交给临时存储适配器，不进入公开状态或隐私事件；
- 完成处理时先写短期结果，再删除输入；取消、用户删除和 TTL 清扫删除输入与输出；
- 删除失败进入 `deletion_pending` 并返回失败，不生成成功删除回执；
- `deleteAt` 作为对象存储生命周期兜底契约传给存储适配器；
- 任务结果不会自动生成或发送 SyncRecord，长期账号记录仍须走独立的显式同步流程。

alpha.23 新增的 handler 固定：

- API 前缀 `/manuscript/api/v1/jobs`，提供创建、状态、输入上传、结果下载、取消和删除路由；不暴露 worker 开始/完成路由；
- 只接受 HTTPS。部署在受信反向代理后时，必须由适配器用不可伪造的代理信息实现 `isSecureRequest`，不能直接信任客户端 `X-Forwarded-Proto`；
- 状态变更要求精确同源 `Origin`、`Sec-Fetch-Site`（如存在）和会话绑定的 CSRF token；会话适配器只返回 exact `{principal, csrf_token}`；
- 上传必须有唯一 `Content-Length`，拒绝 `Transfer-Encoding`、文件名、`Content-Disposition` 和内容摘要头；大小/MIME/并发预留在读取稿件字节前完成；
- HTTP 错误与安全审计分别受 `web-http-error-v1`、`web-http-audit-v1` exact schema 约束。审计不记录主体、任务 ID、URL、请求头或稿件元数据；
- handler 不设置 CORS，响应固定 `no-store` / `nosniff` / CSP / `no-referrer`。错误文案固定且不反射异常、路径、账号或稿件内容。

生产实现仍须补齐：Supabase 会话验证、真实 HTTPS 服务器/反向代理部署、隔离对象存储、容器任务队列、恶意 ZIP/病毒检查、限额与计费、短时下载凭证、实际生命周期策略和网站联调。

## 参考调用顺序

```js
const { WebJobService } = require("./job-contract");
const { createWebJobHttpHandler } = require("./http-handler");

const jobs = new WebJobService({ storage: productionEphemeralStorage });
const handler = createWebJobHttpHandler({
  service: jobs,
  expectedOrigin: "https://www.oakbylake.com",
  resolveSession: trustedSessionAdapter,
  securityEventSink: contentFreeAuditSink,
});

// 由官网同源 HTTPS 服务把 Node IncomingMessage/ServerResponse 交给 handler。
// Worker 只通过私有队列调用 beginProcessing / completeJob，不经过公开 HTTP。
```

生产服务必须先验证湖岸会话，再由 `resolveSession` 返回净化主体与 CSRF token；不得把请求正文或普通代理头中的账号字段映射为 principal。`storage` 必须实现 `putInput`、`putOutput`、`readOutput`、`deleteInput`、`deleteOutput`，并把 `deleteAt` 落成真实对象生命周期策略。后台还必须通过私有队列调用处理状态方法并定时调用 `sweepExpired()`；生命周期策略不能替代主动删除和超时清扫。

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
