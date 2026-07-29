# 标准包签名撤回清单 v1

> 状态：`0.1.0-alpha.52` 已实现本地验签/状态语义，以及未部署的内容无关 service、固定 HTTP/Fetch 契约、有界桌面客户端和假服务到桌面原子应用 E2E。生产发布源、主进程配置/UI/调度、密钥托管和真实网络尚未接线。

## 目的与边界

标准包更新签名证明“这个候选由发布角色授权”，不能证明它之后没有因密钥泄露、内容错误或其他严重问题被撤回。撤回清单因此使用独立的 `revocation` 信任角色；发布服务或普通网络响应不能自行把某个 manifest 标成已撤回。

清单只包含标准库身份和 manifest SHA-256，不含账号、设备、项目、稿件、文件名、路径或检查结果。alpha.52 的网络形状测试使用进程内 Fetch 适配器和运行时生成的 Ed25519 密钥；没有真实联网、生产公钥或生产签名。

## 信任根

trust store `1.0` 继续精确只含 `release` 角色，不能出现撤回字段。需要撤回能力时必须使用 schema `1.1`，其 `roles` 精确包含 `release` 与：

```json
{
  "revocation": {
    "threshold": 2,
    "keyids": ["<sha256-of-ed25519-spki>", "<sha256-of-ed25519-spki>"]
  }
}
```

`revocation` 角色可使用与 `release` 不同的离线密钥；所有 key 必须被至少一个角色引用，签名必须达到该角色阈值。`1.0` 夹带 revocation 或 `1.1` 缺少任一角色都拒绝。没有 `1.1` 撤回信任时，撤回清单按 `REVOCATION_TRUST_UNCONFIGURED` fail-closed，不会借用普通发布权限。tracked Schema 为 `config/schemas/standards-trust-v1.1.schema.json`。

## Signed envelope

外层必须是 canonical UTF-8/LF JSON，字段精确为：

```json
{
  "schema_version": "1.0",
  "kind": "oak-standards-revocation-envelope",
  "payload_b64": "<canonical-list-base64>",
  "signatures": [
    {
      "keyid": "<64-lowercase-hex>",
      "alg": "ed25519",
      "sig_b64": "<canonical-base64-signature>"
    }
  ]
}
```

上限为 1 MiB、16 个签名；重复 key、未知 key、非 Ed25519、非 64 字节签名、无效签名或未达到阈值全部拒绝。对应 Schema 为 `config/schemas/standards-revocation-envelope-v1.schema.json`。

## Signed list payload

`payload_b64` 解码后也必须是 canonical UTF-8/LF JSON，字段精确为：

```json
{
  "schema_version": "1.0",
  "kind": "oak-standards-revocation-list",
  "bundle_id": "oak-standards",
  "issued_at": "2026-07-29T00:00:00Z",
  "expires_at": "2026-08-29T00:00:00Z",
  "revoked_manifest_sha256s": ["<64-lowercase-hex>"]
}
```

payload 上限 512 KiB，撤回项最多 4096 条，必须按小写 SHA-256 排序且去重。`bundle_id` 必须与本地 active bundle 一致；未来签发、已过期或反向时间窗全部拒绝。对应 Schema 为 `config/schemas/standards-revocation-list-v1.schema.json`。

## 本地状态语义

- 撤回集合只能增加，后续有效签名清单也不能删除已持久化 digest；否则返回 `REVOCATION_ROLLBACK`。
- 状态变更使用既有跨进程 pending transaction、前态/后态摘要、原子替换和确定性恢复；失败不能留下半应用状态或删除 CAS。
- 已撤回 manifest 不能成为 active、安装候选或回滚目标。远程候选在生成用户确认计划前即被拒绝；若撤回清单在更新响应或候选验签途中落地，Provider 必须重新读取最新可信状态，使撤回优先并且不生成预览计划。
- active 被撤回时，Provider 停止新的检查、修复、导出再生成和普通身份使用；仍允许受控 migration-source 验证，以便安装更高且未撤回的签名 release。
- 成功前进到未撤回 release 后可恢复正常工作；previous 若已撤回仍不能回滚。
- 撤回不会删除标准 CAS、项目固定身份、既有检查 JSON 或已生成的 `exports/` 文件。用户仍可通过现有“打开导出目录”访问已经生成的文件；重新生成报告属于新操作，必须等可信标准恢复。

## 固定 HTTP 获取契约

alpha.52 固定公开路由 `POST /manuscript/standards/v1/revocations`。请求为不超过 2 KiB 的 exact JSON：

```json
{
  "schema_version": "1.0",
  "request_type": "oak_manuscript_standard_revocation_fetch",
  "app_version": "0.1.0-alpha.52",
  "bundle_id": "oak-standards"
}
```

请求不携带 Authorization、Cookie、账号、设备、项目、稿件、文件名、路径、当前 manifest 或既有撤回集合。服务只接受 HTTPS、唯一正确 Content-Length、`Content-Type: application/json` 与 `Accept: application/vnd.oak.standard-revocation+json`；重复 framing、Transfer-Encoding、未知字段与媒体漂移均在读取发布源前拒绝。

注入式发布源只返回一个 exact、不可变记录：bundle、payload/envelope SHA-256 与原始 envelope 字节。没有受信记录、记录字段漂移、摘要漂移、非法 outer envelope 或发布源异常一律返回 bounded `SERVICE_UNAVAILABLE`，不能把“无清单”解释为“无撤回”。成功响应为 200 和原始 signed envelope；服务不设置“客户端已信任”状态。

桌面 `StandardsRevocationHttpClient` 只接受上述固定 HTTPS 路径，10 秒默认超时，响应上限 1 MiB，拒绝重定向、凭据、Cookie、压缩、范围响应、媒体/长度漂移和异常正文。`StandardsProvider.refreshRemoteRevocations()` 再调用本地独立角色验签和追加式原子事务；并发刷新拒绝。该方法尚未接入 `desktop-standards-update.json`、Electron main/IPC 或 Renderer，因此普通 APP 运行仍不会发出撤回请求。

## 当前证据与未完成项

alpha.51 测试覆盖 exact Schema、canonical JSON、时间窗、bundle、排序/去重、未知 key、阈值、签名、追加式防回退、active fail-closed、已撤回候选拒绝、检查途中并发撤回优先、安全前进恢复、禁止回滚、CAS/历史报告不变以及状态提交失败恢复。alpha.52 新增 11 项，覆盖公开 exact 请求、发布源/摘要投毒、HTTPS/framing/凭据/媒体门禁、有界响应、超时/异常净化、并发刷新，以及真实测试签名清单从假服务到桌面验签和原子应用。

以下仍未完成：生产 revocation 公钥 pin、离线密钥保管与多人签署、发布审批、真实发布存储、主进程受信端点配置、IPC/UI、客户端调度/缓存、紧急撤回操作手册、告警/监控和真实网络联调。因此本文件不能作为“生产撤回系统已上线”的证据。
