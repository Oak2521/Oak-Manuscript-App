# Web 作业契约与同源 HTTP handler（alpha）

`job-contract.js` 是商业方案 v2.0 的服务端临时任务契约与内存参考实现；`persistent-job-service.js`、`python-core-process-processor.js`、`private-lease-worker.js` 与 `zero-retention-sweeper.js` 组成未部署的临时处理纵向边界。alpha.55 新增 `web-job-runtime.js` 作为临时任务的唯一生产组合入口，并用 `supabase/migrations-v1.json` 锁定四份 SQL 的顺序与精确字节。源码可本机测试，但临时作业、长期同步、订阅权益和标准更新/撤回服务均未部署。

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

alpha.38 长期 SyncRecord 固定：

- API 前缀 `/manuscript/api/v1/sync-records`：`POST/GET` collection，`GET/DELETE` item；请求不能自报 owner，先验证 GoTrue/Cookie 会话，再由服务端独立 exact validator 复核 SyncRecord v1；
- `sync-record-service.js` 提供账户容量、幂等创建/重放/冲突、分页列表、读取和属主删除；repository 的 list 单次返回 `{rows,total}`，避免跨查询快照不一致；
- `supabase-sync-record-repository.js` 只调用四个白名单 RPC，固定 HTTPS、service-role、无 Cookie/重定向、超时/响应上限及严格响应归属；
- `supabase/002_sync_records.sql` 建立不含稿件内容、标题、路径、文件名、片段或哈希的长期表，强制 RLS、撤销浏览器权限，并用账户 advisory transaction lock 原子执行容量检查和幂等创建；
- `sync-record-runtime.js` 明确分离公开 Supabase API key、service-role key 与必填审计接收器；它只组合依赖，不读取真实部署环境；
- Electron client/coordinator 已由 main 在受信账号配置完整时条件实例化；仓库默认配置无端点/key，当前 APP 不会调用此 API；SQL 未在真实 PostgreSQL/Supabase 执行。

alpha.45 签名权益固定：

- API 只接受 `POST /manuscript/api/v1/entitlement`、HTTPS、唯一 Bearer 和 4 KiB exact JSON；桌面只发送 device ID，账号必须来自 GoTrue 验证后的 principal；
- `entitlement-service.js` 只把可信账号与设备交给 repository；无有效权益、设备已满、repository drift 和撤销/过期状态均有确定性失败关闭语义；
- `entitlement-signer.js` 使用独立 canonicalizer 与部署注入的 Ed25519 私钥签发 exact envelope，不读取环境变量或客户端字段；
- `supabase-entitlement-repository.js` 只调用固定 `oak_manuscript_license_authorize_device` RPC；`003_manuscript_entitlements.sql` 的两表强制 RLS，浏览器无权限，账户 advisory lock 内原子检查容量并登记设备；
- HTTP 成功响应发送前再次 exact 校验；错误和审计不含 token、账号、设备、稿件、路径、哈希、私钥或上游正文；
- `entitlement-runtime.js` 分离公开 Supabase key、service-role key、私钥/key ID 与 audit sink。当前仅有注入测试和 SQL 静态检查，没有真实迁移、密钥托管、支付事件或部署。

alpha.46 订阅事件与设备管理固定：

- `subscription-event-runtime.js` 仅供上游已验证账单适配器调用，provider ID 由服务端构造绑定；exact 事件不接收原始 webhook、价格、付款资料、客户 PII 或稿件；
- 事件以 canonical JSON SHA-256 和 provider event ID 实现 `applied|replayed|stale|conflict`，旧事件不能覆盖较新权益；支付商签名验证仍属于尚未实现的独立适配器；
- 账号路由固定为 `GET /manuscript/api/v1/account/license` 与 `POST /manuscript/api/v1/account/license/devices/:device_id/revoke`；HTTPS/Bearer 必需，POST 另要求 exact same-origin；
- overview 只返回公开权益时间窗与最多 20 台设备；撤销只作用于当前 owner，不存在/外来设备统一 404；错误与 audit 不含账号、设备实值、token 或稿件；
- `supabase-entitlement-repository.js` 只允许四个 RPC；004 migration 增加 content-free event table、来源元数据、事件 apply、账号 overview 和 owner revoke。当前只有静态/注入验证，没有真实 PostgreSQL/Supabase 执行；alpha.47 客户端也尚未部署。

alpha.47 网站订阅与设备客户端固定：

- `client/client-contract.js` exact parse public overview/revoke，拒绝未知/重复/超量设备与非规范时间，显示状态沿用桌面 valid/grace 边界；
- `client/license-account-controller.js` 只显示 device ID 末尾掩码；每台有效设备撤销前要求原生确认，固定 POST `{}`，失败保持可见并允许重试；
- 登录后与 SyncRecord 并行加载；退出立即清空，generation token 阻止旧请求回填；不持久化权益/设备、不接触稿件内容；
- `npm run smoke:web-client` 使用隐藏 Chromium、实际页面与匿名内存假服务，阻断 HTTP(S)；截图写入仓库忽略的 `out/web-client-smoke/`。它不证明真实账号、API 或部署。

alpha.23—alpha.31 固定：

- API 前缀 `/manuscript/api/v1/jobs`，提供创建、状态、输入上传、一次性结果领取、取消和删除动作；不暴露 worker 开始/完成路由；结果领取只接受状态变更 POST，GET 不消费；
- 只接受 HTTPS。部署在受信反向代理后时，必须由适配器用不可伪造的代理信息实现 `isSecureRequest`，不能直接信任客户端 `X-Forwarded-Proto`；
- 状态变更要求精确同源 `Origin` 和合法 `Sec-Fetch-Site`（如存在）。trusted session 显式为 Bearer 或 Cookie；Cookie 模式强制 CSRF，Bearer 模式依赖显式 Authorization、服务端 token 验证和无 CORS；
- Supabase 适配器拒绝缺失、短、带空白/逗号、重复或合并的 Authorization；注入 verifier 只能返回 exact `{subject_id}`，适配器输出不含 token、角色、邮箱或完整 user；
- GoTrue verifier 只接受规范 HTTPS origin，固定 GET `/auth/v1/user`，不发送 Cookie、不跟随重定向、默认 5 秒超时、响应上限 64 KiB；400/401/403 映射为未认证，限流/5xx/网络/超时/媒体/JSON/subject 异常使用稳定非反射错误；
- Fetch adapter 流式传递请求体，保留 handler 的读取前门禁并拒绝已消费 Request 或未完整结束的响应；不在适配对象上保留原始 Fetch Request；
- `client/` 读取网站 `window.oblAuth` 会话，显式 `credentials:"omit"` 发送 Bearer；创建负载由 exact client contract 生成且不含文件名/路径。页面包含登录/注册、默认引用、本次处理同意、创建/上传/轮询/取消/下载，以及当前账号 SyncRecord strict parse/列表/刷新/属主删除；临时作业自动同步仍明确禁用；
- Netlify 适配器固定 `consistency:"strong"` 的站点级 store、规范 key 与 `onlyIfNew` 条件创建；模糊失败只在现有字节和 exact metadata 相同的情况下幂等恢复，删除后再次强一致确认不存在；
- `sweepExpiredObjects({maxObjects})` 分页扫描固定 prefix 并按 `delete_at` 删除；单轮只允许 1—5,000 项并返回 `truncated`。已知任务对象 metadata 确认损坏时优先删除，metadata 暂时不可读时保留并返回 pending，未确认删除也返回 pending。Netlify Blobs 不自动执行该 metadata，生产必须另行调度和监控清扫；
- Supabase/Postgres 迁移强制两表 RLS，浏览器角色无表/RPC 权限，八个固定 RPC 仅授予 `service_role`；事务创建/重放使用 advisory lock，后续状态使用 revision CAS，私有领取使用 `FOR UPDATE SKIP LOCKED` 并要求完整租约窗，`list_cleanup_due` 优先恢复删除待办，删除完成保留 content-free terminal tombstone；
- `PersistentWebJobService` 将上传预留、私有原子领取、结果完成、删除待办和 TTL 扫描接到 repository；CAS 丢失清理孤立输入，删除失败保持可跨重启恢复的 `deletion_pending`；`PrivateLeaseWorker` 不把账号、任务 ID 或租约交给 processor，完成仍精确绑定服务内 lease/revision/expiry；
- `PythonCoreProcessProcessor` 以固定绝对路径、参数数组、隔离环境、时间/输出/结果上限和受控 scratch 调用共享 Python `web-check`；本机真实 TXT 烟测已通过，但这不是容器或 OS 网络沙箱证据；
- 同一固定进程边界在 `putInput()` 前调用只读 `web-inspect`，拒绝非 UTF-8/NUL 文本、危险 ZIP 结构、宏/ActiveX/嵌入/DDE 与脚本 EPUB；失败固定为 `UNSAFE_DOCUMENT`、清除预留且零字节入库。它不是病毒库或文件信誉扫描；
- 第一个已认证同源 `POST /:job_id/result` 在读取前把任务独占转为 `deletion_pending/downloaded`；持久实现使用 revision CAS。input/output 删除与 content-free 终态墓碑成功后才返回字节；并发/二次领取失败，读取或清理失败不返回字节并只允许重试删除。15 分钟 TTL 不意味着可重复下载；传输或本机保存失败后必须重新检查；
- 私有 `ZeroRetentionSweeper` 每周期按任务—对象—任务执行；阶段失败不抑制其它阶段，输出/audit 只含时间、状态和计数。`cycle_clear` 也固定 `production_zero_retention_verified=false`，不能冒充真实平台生命周期证明；
- 上传必须有唯一 `Content-Length`，拒绝 `Transfer-Encoding`、文件名、`Content-Disposition` 和内容摘要头；大小/MIME/并发预留在读取稿件字节前完成；
- HTTP 错误与安全审计分别受 `web-http-error-v1`、`web-http-audit-v1` exact schema 约束。审计不记录主体、任务 ID、URL、请求头或稿件元数据；
- handler 不设置 CORS，响应固定 `no-store` / `nosniff` / CSP / `no-referrer`。错误文案固定且不反射异常、路径、账号或稿件内容。

生产实现仍须补齐：在隔离环境依序执行/复核四份 canonical migration，完成 GoTrue/Postgres/Blobs 真实 E2E、平台恶意软件扫描、容器/OS 禁网与资源隔离、支付商 webhook 验签适配、私钥托管/轮换、部署计划双清扫/告警/故障演练、生产 PKCE/main transport 接线和网站后台联调。当前一次性领取不生成额外签名 URL/token，但仍须在真实平台验证删除、传输中断与三路零留存。

## 生产组合与迁移来源门禁（alpha.55）

部署适配层应只通过 `createWebJobProductionRuntime({ configuration, adapters })` 创建临时稿件运行时。配置与适配器均为 exact 对象；公开 Supabase key 和 service-role key 必须分离，所有 store/network/spawn/audit/clock/ID 能力显式注入。构造过程不读取 `process.env`，也不在启动时联网；processor 使用空继承环境。返回值只包含 `handleRequest`、`runWorkerOnce`、`runCleanupCycle` 与去敏 `readiness`。

部署前先运行：

```bash
npm run verify:web:migrations
```

当前 canonical manifest SHA-256 为 `0989697d2648b9505d5cf6e2c6e2b9cb519f6b806cad5e686354179f4c2e14b7`，并必须作为 `expected_migration_manifest_sha256` 传入组合配置。该值绑定仓库来源，不能证明目标数据库已经应用迁移。runtime readiness 固定报告 `database_migrations_applied: "not_verified"`、`os_network_isolation_verified: false`、`production_zero_retention_verified: false`、`production_ready: false`；部署层不得覆盖这些字段制造上线结论。

## 参考调用顺序

```js
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { getStore } = require("@netlify/blobs");
const {
  MIGRATION_MANIFEST_SHA256,
  createWebJobProductionRuntime,
} = require("./web-job-runtime");
const { createSyncRecordFetchHandler } = require("./sync-record-runtime");

// deploymentConfig / deploymentSecrets 由平台适配层显式读取和验证；
// runtime 本身不读取 process.env，也不会把这些对象返回给调用方。
const jobRuntime = createWebJobProductionRuntime({
  configuration: {
    schema_version: "1.0",
    api_origin: deploymentConfig.apiOrigin,
    supabase_origin: deploymentConfig.supabaseOrigin,
    supabase_api_key: deploymentSecrets.supabasePublicKey,
    supabase_service_role_key: deploymentSecrets.supabaseServiceRoleKey,
    python_executable: deploymentConfig.pythonExecutable,
    python_core_dir: deploymentConfig.pythonCoreDir,
    scratch_root: deploymentConfig.scratchRoot,
    blob_store_name: "oak-manuscript-ephemeral-v1",
    blob_prefix: "oak-manuscript/jobs/v1",
    expected_migration_manifest_sha256: MIGRATION_MANIFEST_SHA256,
  },
  adapters: {
    fetch_impl: fetch,
    get_store_impl: getStore,
    spawn_impl: spawn,
    security_event_sink: contentFreeAuditSink,
    job_audit_sink: contentFreeJobAuditSink,
    cleanup_audit_sink: contentFreeCleanupAuditSink,
    clock: () => new Date(),
    request_id_factory: randomUUID,
    uuid_factory: randomUUID,
  },
});
const handleSyncRecordRequest = createSyncRecordFetchHandler({
  apiOrigin: deploymentConfig.apiOrigin,
  supabaseOrigin: deploymentConfig.supabaseOrigin,
  supabaseApiKey: deploymentSecrets.supabasePublicKey,
  supabaseServiceRoleKey: deploymentSecrets.supabaseServiceRoleKey,
  securityEventSink: contentFreeSyncAuditSink,
});

// 由官网同源 HTTPS 平台把标准 Request 交给 jobRuntime.handleRequest。
// 由私有调度器调用 jobRuntime.runWorkerOnce()；领取与完成不经过公开 HTTP。
// 由另一受控计划任务调用 jobRuntime.runCleanupCycle() 并对 attention_required 告警。
// 同源平台只把 /manuscript/api/v1/sync-records 请求交给 handleSyncRecordRequest。
// 生产调度仍须放入有 OS 禁网、只读根和资源限制的隔离环境。
```

部署前须由数据库所有者在隔离预生产项目按顺序执行并复核 `supabase/001_web_job_state.sql`、`supabase/002_sync_records.sql`、`supabase/003_manuscript_entitlements.sql` 与 `supabase/004_subscription_events_and_devices.sql`。GoTrue verifier 使用服务端可用的最小 API key；各 repository 单独使用仅存在于服务器环境的 service-role key，权益 runtime 另注入 Ed25519 私钥；这些秘密不得进入浏览器、客户端 bundle、日志或错误。不得只解码未验签 JWT，也不得把请求正文、普通代理头或 user metadata 角色映射为 principal。若改用 HttpOnly Cookie，session resolver 必须返回 `auth_mode:"cookie"` 与服务器绑定 CSRF；权益端点仍固定只接受 Bearer。计划任务应调用 `ZeroRetentionSweeper.runCycle()`，由它有界运行状态 `sweepDeletionDue()`、内容 `sweepExpiredObjects()` 和第二次状态收敛；必须监控 `attention_required` 与截断。周期清零仍不自动证明平台后台副本已删除，正式零留存需要生产生命周期证据。

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
