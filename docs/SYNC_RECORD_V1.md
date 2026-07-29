# SyncRecord v1 — 结果与元数据同步契约

> 状态：`0.1.0-alpha.38` 已在既有客户端/核心离线契约、逐字段预览和 OS 加密持久队列之上，实现独立的 SyncRecord 服务端验证、同源 HTTPS API、Supabase service-role repository/迁移源码，以及桌面 Bearer 客户端与发送协调器。它们尚未接入主进程生产 `AuthProvider`，迁移未在真实 Supabase 执行，API 未部署，网站后台也未实现；普通 APP 仍不发出同步请求。最新 packaged smoke 仍为 alpha.37，只证明本机队列跨进程恢复且不含队列明文。AI 建议文本、审阅会话和 AI HTTP 底座均不进入 SyncRecord。本文件不能作为“数据已可同步到网站”的证明。

## 1. 信任边界

同步记录不是 Renderer 任意拼装的对象。数据流固定为：

```text
受项目路径门禁保护的 Python sync-source
  -> 只返回结构化脱敏来源
  -> Electron buildSyncRecordV1 精确取白名单
  -> validateSyncRecordV1 拒绝未知/禁止字段
  -> 已登录用户逐字段预览
  -> 四选一明确确认
  -> safeStorage 加密幂等队列
  -> [尚未由 main 实例化] SyncTransportCoordinator
  -> 固定 HTTPS/Bearer SyncHttpClient
  -> /manuscript/api/v1/sync-records
  -> GoTrue 验证后的可信主体
  -> 服务端独立 exact 校验与账号归属绑定
  -> service-role-only RPC / 强制 RLS 的长期结果表
```

Renderer 只能向主进程提交项目句柄、`check | export` 事件、是否包含结构化问题记录、幂等 ID 和固定选择枚举；不能提交同步 payload、令牌或网络目标。alpha.38 的服务端验证器独立于 Electron 验证器，按同一 SyncRecord v1 语义再次拒绝未知/禁止字段并把 owner 绑定到可信会话主体，不信任客户端已过滤。

## 2. 权威 schema

机器契约为 `config/schemas/sync-record-v1.schema.json`（JSON Schema 2020-12）。运行时还有更严格的交叉字段检查：

- `idempotency_id` 必须精确等于 `sync-v1:<project_id>:<run_id>`；
- 严重程度、维度和状态计数之和必须分别等于 `counts.total`；
- `counts.fixable` 不得大于总数；
- 存在 `issues[]` 时，条数必须等于总数；
- 所有对象拒绝 schema 外字段。

默认预览不带 `issues[]`，只显示汇总。若未来允许用户选择详细结构记录，每项也只能含：

```json
{
  "rule_id": "DOCX-SPACE-001",
  "severity": "warning",
  "dimension": "typography",
  "status": "open",
  "fixable": true
}
```

## 3. 永久禁止字段

客户端构造器和验证器均 fail-closed 拒绝未知字段，并对以下类别做反向测试：稿件或正文、标题、摘要、关键词、预览/片段、原稿或修订稿、文件名、本地路径、用户名/设备目录、参考文献/脚注/图片原文、文件/正文哈希和内容指纹。

`project_id` 是项目创建时生成的 16 位十六进制随机 ID；`run_id` 是当前本地检查 ID。二者不得替换为显示名称或内容哈希。

## 4. 用户确认状态机

未登录时在调用 Python `sync-source` 之前即拒绝，不生成 Renderer 预览、不入队。登录不等于授权。预览绑定当时的账号 ID；退出会清空缓存预览，切换账号后旧预览失效。导出完成后仅在 `authenticated` 状态非阻断询问，失败不得影响本地导出。

| 用户选择 | 当前记录 | 后续行为 |
|---|---|---|
| `sync_once` | 入幂等队列 | 不改变全局询问偏好 |
| `ask_each_time` | 入幂等队列 | 偏好设为以后仍询问 |
| `not_now` | 不入队 | 保持现有偏好 |
| `never_for_project` | 不入队 | 当前账号持久记录不再询问该项目 |

同一账户下同一 `idempotency_id` 重复确认只能得到同一队列项。队列项支持 `cancel`、`retry`、`delete`；状态为 `pending_transport` 不能解释为已上传。队列、幂等键和项目阻止项按账户隔离；未登录查询固定返回空集，所有修改必须重新验证当前账户。内部 `account_id` 不返回 Renderer。

本机持久状态的机器契约为 `config/schemas/sync-queue-store-v1.schema.json`。Electron `safeStorage` 提供 OS 绑定加密；磁盘文件为 `OAKSYNC1 + uint32 长度 + 密文`。明文必须是 exact/canonical JSON，写入采用同目录独占候选、文件 `fsync`、原子替换、提交后解密复验和 revision compare-and-swap。链接、硬链接、目录逃逸、大小超限、篡改、非 canonical、短读、读取期间身份变化或并发旧 revision 均拒绝。系统加密不可用或队列损坏时，同步预览和保存 fail-closed，本地检查、修复与导出继续可用。

alpha.38 已提供未实例化的 `SyncHttpClient` 与 `SyncTransportCoordinator`：只允许固定规范 HTTPS origin、固定 API 路径、Bearer、无 Cookie/重定向、有界超时与响应；token provider 必须返回 token 及其所属账号的 exact 绑定，错绑在 transport 前拒绝。同一队列项只允许一个在途请求，远端创建或幂等重放后才删除精确本地项，失败/账号切换/本地提交失败则保留并记录稳定错误以便显式重试。生产 `AuthProvider` 尚不能提供 access token，主进程未创建协调器，也没有后台调度或网站后台；关闭并重新打开当前 APP 只会恢复本机待发送状态，不会产生上传。

## 5. 账号与权益模拟边界

- `AuthProvider` 固定声明未来采用系统浏览器 PKCE；生产未配置时 `beginLogin` 返回 `configuration_required`，不打开网页、不联网；
- 本地测试可模拟 authenticated、signed_out、expired、revoked，但生产运行不开放模拟入口；
- `LicenseProvider` 给出 Free/Pro 能力矩阵，并可按 `validUntil` / `graceUntil` 计算 active、grace、expired；模拟授权没有签名证据，`signatureVerified=false`；
- 订阅过期只影响新的 Pro 权益，`localProjectsLocked` 永远为 false；
- 队列已使用 `safeStorage`，但这不是登录 token 存储；令牌凭据、设备撤销服务和生产签名授权缓存均未实现。

## 6. alpha.38 服务端与 transport 源码边界

- `web/sync-record-service.js` 独立验证记录、账号归属、幂等创建/重放/冲突、分页列表、读取与删除；列表由 repository 单次快照返回 `{rows,total}`，避免结果与总数跨查询漂移；
- `web/sync-record-http-handler.js` 固定 `POST/GET /manuscript/api/v1/sync-records` 及 `GET/DELETE /:id`，强制 HTTPS、同源/Fetch Metadata、Cookie CSRF 或已验证 Bearer、JSON framing/大小和固定非反射错误；审计受 exact schema 限制且接收器失败不改变响应；
- `web/supabase-sync-record-repository.js` 只能调用四个固定 service-role RPC；`web/supabase/002_sync_records.sql` 对内容无关记录表启用强制 RLS，撤销浏览器角色权限，并用账户 advisory transaction lock 原子化“计数—创建/重放”；
- `web/sync-record-runtime.js` 明确分离公开 Supabase API key、service-role key 与审计接收器，组合 GoTrue、会话解析、repository、service、HTTP handler 和 Fetch adapter；
- `electron/sync-http-client.js` 与 `electron/sync-transport-coordinator.js` 只存在于主进程边界；不会读取 Renderer 自报 token/URL，也不会把远端失败伪装为成功。

这些是源码合同和离线测试结果，不是数据库已迁移、API 已部署或 APP 已联网的证据。

## 7. 生产对接前必须补齐

1. 经授权现场核对网站当前 Supabase、账号和后台 schema，并在隔离预生产执行/复核 `002_sync_records.sql`；
2. 完成系统浏览器 PKCE、回调校验、OS 安全 token 存储、刷新/退出/过期/撤销，再把 access-token provider 和 coordinator 接入主进程；默认 Electron session 必须继续离线；
3. 完成显式发送/重试 UI、限次退避、离线/认证/服务故障分类，以及远端提交与本地队列删除之间的崩溃恢复验收；
4. 部署同源 API，验证真实 GoTrue、Postgres RLS/RPC、多实例并发、备份/恢复、限额、删除和无密钥泄露；
5. 实现 APP 与网站后台的查看、导出、删除和内容无关审计记录；
6. 完成正文、文件名、路径、片段、哈希泄露反向生产集成测试及真实隐私验收。
