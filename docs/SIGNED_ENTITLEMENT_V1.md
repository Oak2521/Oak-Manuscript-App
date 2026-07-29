# Signed Entitlement v1 — 桌面订阅权益契约

> 状态：`0.1.0-alpha.47` 已在桌面端严格配置、Ed25519 验签、账号/设备绑定、OS 加密缓存、显式刷新和失败关闭之上，实现独立服务端 signer、规范化订阅事件、当前账号权益/设备列表与属主撤销 HTTP/runtime、对应 Supabase SQL 源码，以及未部署的网站订阅/掩码设备客户端。仓库默认配置为 `pending_configuration`，没有生产端点、公钥或私钥，不会发起权益网络请求。支付商 webhook 适配、真实迁移/部署和联调尚未实现。

## 1. 目的与边界

桌面端不根据 Renderer、自报套餐或未签名 HTTP 字段授予 Pro。唯一可接受的生产权益是服务端签发的 `oak_manuscript_signed_entitlement`。权益只决定新的 Pro 操作是否可用；过期、撤销、损坏或退出登录都不会锁住已有本地项目，也不会删除本地文件。

状态查询只读取本机加密缓存，绝不联网。只有已登录用户在设置页明确点击“刷新订阅权益”后，主进程才可向固定端点发送一次请求。

## 2. 受信桌面配置

机器契约为 `config/schemas/desktop-license-v1.schema.json`，默认实例为 `config/desktop-license.json`。生产配置必须同时满足：

- `status` 为 `configured`；
- `entitlement_endpoint` 是规范 HTTPS URL；
- `issuer` 是规范 HTTPS origin；
- `audience` 精确为 `oak-manuscript-desktop`；
- `trusted_keys` 含 1—4 个不重复 `key_id` 的 Ed25519 公钥 JWK；
- `pending_configuration` 不得夹带部分端点、issuer 或公钥。

端点、公钥和 issuer 只能来自随应用发布并受资源信任锚点保护的配置，Renderer、环境变量和账号响应都不能覆盖。

## 3. 请求与响应

已登录用户显式刷新时，主进程用当前账号的 Bearer access token 向固定端点 POST：

```json
{
  "schema_version": "1.0",
  "request_type": "oak_manuscript_entitlement_request",
  "device_id": "device-10000000-0000-4000-8000-000000000001"
}
```

客户端不发送 Cookie，不跟随重定向，不读取代理环境，并限制超时、媒体类型、声明长度和流式响应大小。请求、固定错误与 content-free 审计分别由 `entitlement-request-v1.schema.json`、`license-http-error-v1.schema.json` 和 `license-http-audit-v1.schema.json` 固定。服务端响应的机器契约为 `config/schemas/signed-entitlement-v1.schema.json`：

```json
{
  "schema_version": "1.0",
  "record_type": "oak_manuscript_signed_entitlement",
  "key_id": "oak-license-2026-01",
  "algorithm": "Ed25519",
  "claims": {
    "issuer": "https://accounts.oakbylake.com/",
    "audience": "oak-manuscript-desktop",
    "entitlement_id": "ent-10000000-0000-4000-8000-000000000001",
    "account_id": "account-0001",
    "device_id": "device-10000000-0000-4000-8000-000000000001",
    "tier": "pro",
    "device_state": "active",
    "issued_at": "2026-07-29T10:00:00.000Z",
    "not_before": "2026-07-29T10:00:00.000Z",
    "valid_until": "2026-08-29T10:00:00.000Z",
    "grace_until": "2026-09-05T10:00:00.000Z"
  },
  "signature": "base64url-ed25519-signature"
}
```

签名覆盖不含 `signature` 的完整对象，以递归键排序、无多余空白的 UTF-8 JSON 为 canonical payload。所有对象拒绝未知字段。客户端还复核公钥、issuer、audience、当前账号、稳定设备 ID、时间顺序和当前认证账号在请求前后未变化。

## 4. 本机缓存与状态矩阵

明文缓存契约为 `config/schemas/license-cache-v1.schema.json`，磁盘格式为 `OAKLIC1 + uint32 长度 + safeStorage 密文`。写入使用 revision compare-and-swap、同目录独占候选、文件 `fsync`、原子替换和换入后解密复验；链接、硬链接、路径逃逸、短读、非 canonical JSON、篡改和读取竞态均拒绝。

| 条件 | 权益状态 | 有效套餐 | 已有本地项目 |
|---|---|---|---|
| 签名有效且在有效期内 | `active` | Pro | 不锁定 |
| 已过有效期但未过宽限期 | `grace` | Pro | 不锁定 |
| 过期、撤销、尚未生效 | `expired` / `revoked` / `not_yet_valid` | Free | 不锁定 |
| 退出、错账号、签名或缓存无效 | `signed_out` / `invalid` / `not_cached` | Free | 不锁定 |

无效或攻击性响应不得覆盖上一次有效缓存。退出登录不会把缓存冒充为当前权益；重新登录后仍须按当前账号、设备和时间重新验证。

## 5. alpha.45—alpha.47 服务端与网站客户端源码边界

`web/entitlement-runtime.js` 组合 GoTrue verifier、Bearer session resolver、Supabase entitlement repository、service、独立 Ed25519 signer、HTTP handler 与 Fetch adapter。私钥、公开 API key、service-role key 和 audit sink 只能由服务端部署环境分别注入；runtime 不读取环境变量，仓库没有默认秘密。

`web/supabase/003_manuscript_entitlements.sql` 定义 content-free 的 `oak_manuscript_entitlements` 与 `oak_manuscript_devices`。两表强制 RLS，撤销 `public`、`anon`、`authenticated` 权限；唯一授权 RPC 只授予 `service_role`，并在账号 advisory transaction lock 内原子读取有效权益、复核既有设备或执行容量检查和首次登记。它不包含稿件、文件名、路径、哈希、token 或私钥字段。

服务端从已验证 GoTrue 会话取得账号；请求只能提供 device ID。HTTP 成功响应在写回前再做一次 exact envelope/claims/容量验证，防止内部适配器夹带未知字段。HTTP 错误与审计不包含账号、设备、token、稿件或上游正文。

alpha.46 新增 `subscription-event-runtime.js`，由部署层固定 `providerId`，只接受上游已验证的规范化订阅快照。事件只含 provider event ID、账号/权益 ID、`purchase|renewal|cancellation|refund|chargeback|manual`、`active|revoked` 与五个规范时间；canonical JSON 的 SHA-256 是内容指纹。同一 provider/event 同指纹为重放，不同指纹为冲突，较旧 `occurred_at` 为 stale 且不覆盖较新权益。原始 webhook、签名、金额、支付资料和客户 PII 不进入该契约。

alpha.47 新增网站账号后台 consumer。`client-contract.js` exact parse public overview/revoke，`license-account-controller.js` 只显示 content-free 状态和 device ID 后缀；每台有效设备撤销前必须明确确认。失败保留错误和重试能力，退出清空且旧响应失效。客户端不持久化权益/设备、不接收账号 ID 或稿件字段；当前只通过匿名假服务浏览器 smoke，未连接真实 API。

账号后台服务固定提供 `GET /manuscript/api/v1/account/license` 与 `POST /manuscript/api/v1/account/license/devices/:device_id/revoke`。两者只接受 GoTrue Bearer owner；POST 另要求 exact same-origin。概览最多返回 20 台设备；公开权益删除内部 ID/revision；外来设备与不存在设备都返回同一 404。`004_subscription_events_and_devices.sql` 的事件 apply、overview 与 revoke RPC 仅授予 `service_role`，但尚未在真实 PostgreSQL/Supabase 执行。

这些是生产形状源码和假服务测试，不是数据库迁移、真实 RLS、多实例、密钥托管或线上可用证据。

## 6. 服务端上线前门禁

上线前必须另行完成并留证：

- 已选支付商的原始 webhook 签名验证、事件映射与失败重放适配；
- 网站账号后台对订阅状态、设备列表和确认撤销 API 的真实消费；
- HSM 或等价受控环境中的 Ed25519 私钥管理、轮换和事故撤销；
- 权益端点与正式 Auth subject 的绑定，禁止请求自报账号；
- 多设备上限、设备命名/撤销后台及客服恢复流程；
- 测试/预生产/生产 key 与 issuer 隔离；
- 真实登录、刷新、离线宽限、过期、撤销、换号、重放和密钥轮换 E2E；
- Windows/macOS 签名应用中的生产配置与资源锚点复验。

在这些门禁完成前，源码中的签名验证器不能被表述为“订阅系统已上线”或“可售卖正式版已完成”。
