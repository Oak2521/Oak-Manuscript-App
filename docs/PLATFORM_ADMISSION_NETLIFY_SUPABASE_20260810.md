# Netlify Functions + Blobs + Supabase Web 准入核对

> 核对日期：2026-08-10
>
> 候选 profile：`web/platform-profiles/netlify-functions-blobs-supabase-20260810.json`
>
> 结论：`declared_capabilities_satisfied=false`、`production_evidence_verified=false`、`production_ready=false`

## 结论

当前“Netlify 同步 Functions 承接稿件上传/结果下载 + Netlify Blobs + Supabase Postgres/Auth + Netlify Background Functions 执行 Python”的组合，不满足本仓库既定 Web 生产契约，必须拒绝准入。

拒绝的决定性原因不是 Supabase 或 Blobs 的基本数据能力，而是公开 HTTP 通道与私有执行边界：当前契约要求单次缓冲接收 50 MiB、缓冲返回 100 MiB、同步执行至少 240 秒；Netlify Functions 官方当前上限为二进制请求有效约 4.5 MiB、缓冲响应 6 MiB、同步执行 60 秒，且均不可配置。Background Functions 虽可运行 15 分钟，但只立即返回 `202`、丢弃 handler 返回值，并把请求/响应载荷限制为 256 KiB，不能替代现有同步上传/下载协议。

Netlify 官方文档没有为该候选组合承诺本项目要求的任意 Python 子进程、固定绝对可执行文件、私有可写 scratch、逐作业 OS 级禁网和只读应用目录。按 fail-closed 规则，这些未证明能力均记为 `false`；这表示“不能据此准入”，不等于声称平台在所有套餐或定制方案下绝对不可能实现。

## Profile 取值与证据

| 分组 | Profile 取值 | 官方证据与判断 |
| --- | --- | --- |
| 公开请求 | 4,718,592 bytes | Netlify Functions 缓冲载荷为 6 MB；二进制请求因 Base64 开销，有效上限约 4.5 MB。低于 50 MiB。 |
| 公开响应 | 6,291,456 bytes | 缓冲请求/响应上限 6 MB，且不可配置。低于 100 MiB。 |
| 公开同步执行 | 60,000 ms | 同步执行上限 60 秒，且不可配置。低于 240 秒。 |
| 同源 HTTPS | `true` | Function 可在站点域名下通过固定或自定义路径提供，满足同源 HTTPS 的声明能力；真实代理信任配置仍未部署验证。 |
| 私有最长执行 | 900,000 ms | Background Functions 最长 15 分钟；但其异步 `202`、256 KiB 载荷和丢弃返回值不满足公开 API 协议。 |
| 子进程、绝对可执行文件、scratch、OS 禁网、只读应用 | 均为 `false` | 当前官方资料未证明这些 exact 隔离能力，故拒绝推定。`included_files` 只证明可把文件打入函数 bundle，不证明固定可执行、文件系统或禁网语义。 |
| Blobs 强一致、条件创建、metadata、prefix 分页 | 均为 `true` | Blobs 支持 opt-in strong consistency、`onlyIfNew`/`onlyIfMatch`、metadata、`list({paginate,prefix})`。单对象上限 5 GB，不是当前瓶颈。 |
| 删除确认 | `true` | Provider 提供 delete 与 strong read；本仓库适配器在删除后强一致复读确认不存在。这是应用层组合能力，不是平台事务性 TTL。 |
| Postgres 事务、advisory lock、RLS、服务端 RPC | 均为 `true` | Supabase 提供 Postgres 与 RLS；PostgreSQL 官方支持事务和 transaction-level advisory locks；服务端 secret/service key 可绕过 RLS 调用受限 RPC。真实迁移仍未执行。 |
| 私有 worker 与 cleanup 调度 | 均为 `true` | Supabase Cron 可从每秒到每年运行 SQL/函数或发 HTTP 请求，可用于触发 worker/清扫入口；它不弥补 worker 执行环境缺口。 |
| retry alerting | `false` | Netlify Background Functions 有固定重试，Observability 可查看日志和指标，但官方明确 Observability 不提供 alerting；外部 Log Drain/监控尚未纳入此候选组合。 |
| secret injection | `true` | Netlify Functions 支持在运行时读取 Functions scope 环境变量；真实 secret store、轮换和权限尚未配置。 |

## 稳定拒绝码

该 profile 必须固定得到以下拒绝码：

1. `PUBLIC_REQUEST_BYTES_INSUFFICIENT`
2. `PUBLIC_RESPONSE_BYTES_INSUFFICIENT`
3. `PUBLIC_EXECUTION_WINDOW_INSUFFICIENT`
4. `CHILD_PROCESS_UNSUPPORTED`
5. `ABSOLUTE_EXECUTABLE_UNSUPPORTED`
6. `PRIVATE_SCRATCH_UNSUPPORTED`
7. `OS_NETWORK_DENY_UNSUPPORTED`
8. `READ_ONLY_APPLICATION_UNSUPPORTED`
9. `RETRY_ALERTING_UNSUPPORTED`

`tests/web_deployment_admission.test.js` 将 profile、拒绝码顺序、证据文件和 `production_ready=false` 固定为回归门禁。即使未来某个 profile 的声明能力全部满足，当前准入器仍不会把声明自动升级为真实生产证据。

## Supabase 2026 密钥兼容性修正

Supabase 当前迁移文档要求用 publishable key 替代浏览器 `anon` key，并用 `sb_secret_` key 替代服务端 legacy `service_role` key；legacy keys 计划在 2026 年底弃用。新 secret key 是 opaque API key，不是 JWT：服务端 REST/RPC 请求必须只放在 `apikey` 请求头，不能再复制到 `Authorization: Bearer`，否则会被按 JWT 解析并拒绝。

本仓库因此新增 `web/supabase-server-key.js`，并让任务、同步记录和权益三个 Supabase repository 共用以下规则：

- `sb_secret_...`：只发送 `apikey`；
- legacy `service_role` JWT：在迁移期继续发送 `apikey` 与 `Authorization: Bearer`；
- 两种密钥均只允许服务端注入，拒绝空白、控制字符、逗号和过短值。

现有配置字段名 `serviceRoleKey` / `supabase_service_role_key` 暂时保留以避免破坏部署契约，但其允许值已经覆盖当前 Supabase secret key。生产配置应优先使用可独立轮换的 `sb_secret_` key，不应新建 legacy key 依赖。

## 官方来源

- Netlify Functions 配置与不可配置上限：<https://docs.netlify.com/build/functions/configuration/>
- Netlify Background Functions 语义与重试：<https://docs.netlify.com/build/functions/background-functions/>
- Netlify Functions 环境变量：<https://docs.netlify.com/build/functions/environment-variables/>
- Netlify Blobs API、强一致和限制：<https://docs.netlify.com/build/data-and-storage/netlify-blobs/>
- Netlify Observability 与 alerting 边界：<https://docs.netlify.com/manage/monitoring/observability/overview/>
- Supabase 新 API key 迁移：<https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys>
- Supabase 2026 breaking-change 索引：<https://supabase.com/changelog?tags=breaking-change>
- Supabase Row Level Security：<https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase Cron：<https://supabase.com/docs/guides/cron>
- PostgreSQL 事务：<https://www.postgresql.org/docs/current/tutorial-transactions.html>
- PostgreSQL advisory locks：<https://www.postgresql.org/docs/current/explicit-locking.html>

## 后续边界

该拒绝结论不否定 Netlify 继续承载静态前端、账号入口或小型同源控制 API，也不否定 Supabase/Blobs 作为账号、状态和临时对象组件。它只否定“把当前 50/100 MiB 缓冲协议和 Python 私有 worker 原样塞进 Netlify Functions”这一生产组合。

下一步只能二选一：

1. 修改 Web 数据协议为对象存储直传/直取，公开 API 只交换 content-free 元数据和短期凭证，同时为 Python core 选择具备可验证隔离的专用容器/worker；或
2. 保留当前缓冲协议，改用能明确满足 50/100 MiB、240 秒和全部私有执行隔离要求的同源专用服务。

任何路线都必须新增独立候选 profile、真实预生产证据、迁移/RLS 验证、故障演练、零留存证据和告警验证，不能复用本文件把 `production_ready` 改为 `true`。
