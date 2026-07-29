# Signed Entitlement v1 — 桌面订阅权益契约

> 状态：`0.1.0-alpha.44` 已实现桌面端严格配置、Ed25519 验签、账号/设备绑定、OS 加密缓存、显式刷新和失败关闭；仓库默认配置为 `pending_configuration`，没有生产端点或公钥，不会发起权益网络请求。服务端签发、订阅计费、设备后台和真实联调尚未实现。

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

客户端不发送 Cookie，不跟随重定向，不读取代理环境，并限制超时、媒体类型、声明长度和流式响应大小。服务端响应的机器契约为 `config/schemas/signed-entitlement-v1.schema.json`：

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

## 5. 服务端上线前门禁

上线前必须另行完成并留证：

- 订阅/退款/宽限与设备撤销的服务端真相模型；
- HSM 或等价受控环境中的 Ed25519 私钥管理、轮换和事故撤销；
- 权益端点与正式 Auth subject 的绑定，禁止请求自报账号；
- 多设备上限、设备命名/撤销后台及客服恢复流程；
- 测试/预生产/生产 key 与 issuer 隔离；
- 真实登录、刷新、离线宽限、过期、撤销、换号、重放和密钥轮换 E2E；
- Windows/macOS 签名应用中的生产配置与资源锚点复验。

在这些门禁完成前，源码中的签名验证器不能被表述为“订阅系统已上线”或“可售卖正式版已完成”。
