# Web 作业契约（alpha）

`job-contract.js` 是商业方案 v2.0 的服务端任务契约与内存参考实现，不是已部署的网页版或生产上传服务。

当前边界：

- 可信会话主体作为独立参数传入，创建请求不能自报账号；
- 每个任务必须携带 `single_job_processing` 明示同意；
- 请求元数据不接受文件名、路径、正文、片段、内容哈希或任意扩展字段；
- 上传字节只交给临时存储适配器，不进入公开状态或隐私事件；
- 完成处理时先写短期结果，再删除输入；取消、用户删除和 TTL 清扫删除输入与输出；
- 删除失败进入 `deletion_pending` 并返回失败，不生成成功删除回执；
- `deleteAt` 作为对象存储生命周期兜底契约传给存储适配器；
- 任务结果不会自动生成或发送 SyncRecord，长期账号记录仍须走独立的显式同步流程。

生产实现仍须补齐：同源 HTTPS 路由、Supabase 会话验证、隔离对象存储、容器任务队列、恶意 ZIP/病毒检查、限额与计费、短时下载凭证、实际生命周期策略和网站联调。

## 参考调用顺序

```js
const { WebJobService } = require("./job-contract");

const jobs = new WebJobService({ storage: productionEphemeralStorage });
const principal = trustedSession.toWebJobPrincipal(); // 只含 kind / subject_id
const status = await jobs.createJob(principal, validatedCreateRequest);
await jobs.acceptUpload(principal, status.job_id, { bytes, media_type });
jobs.beginProcessing(principal, status.job_id);
await jobs.completeJob(principal, status.job_id, { bytes: resultBytes, media_type: resultType });
const download = await jobs.downloadResult(principal, status.job_id);
await jobs.deleteJob(principal, status.job_id);
```

上例不是 HTTP 路由。生产路由必须先验证湖岸会话，再把净化后的 principal 传入；不得把请求正文中的账号字段映射为 principal。`storage` 必须实现 `putInput`、`putOutput`、`readOutput`、`deleteInput`、`deleteOutput`，并把 `deleteAt` 落成真实对象生命周期策略。后台还必须定时调用 `sweepExpired()`；生命周期策略不能替代主动删除和超时清扫。

## 稳定错误码

| 错误码 | 含义 |
|---|---|
| `INVALID_REQUEST` | exact 字段、枚举、时间或主体格式非法 |
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

HTTP 状态映射、重试头和外部错误文案尚未冻结；生产实现不得自行把 `ZERO_RETENTION_DELETE_FAILED` 映射成成功。
