# STANDARDS_UPDATE_V1 — 标准更新服务契约

> 状态：`0.1.0-alpha.50` 源码契约与本地纵向测试通过；生产发布源、密钥、域名配置和部署尚未完成。

## 1. 固定路由

`POST /manuscript/standards/v1/check`

- 只接受 HTTPS；
- 不认证，不接受 `Authorization` 或 `Cookie`；
- 请求 `Content-Type` 必须精确为 `application/json`；
- `Accept` 必须精确为 `application/vnd.oak.standard-package+json`；
- 必须声明唯一且正确的 `Content-Length`，不接受 `Transfer-Encoding`；
- 请求体上限 4 KiB，候选包上限 24 MiB；
- 不开放任意 URL、bundle、文件路径或 renderer payload 转发。

生产 URL 尚未配置。仓库测试使用的规范示例为：

`https://updates.oakbylake.com/manuscript/standards/v1/check`

该示例不是已部署端点。

## 2. 请求 v1

```json
{
  "schema_version": "1.0",
  "request_type": "oak_manuscript_standard_update_check",
  "app_version": "0.1.0-alpha.50",
  "bundle_id": "oak-standards",
  "current_release_sequence": 2,
  "current_manifest_sha256": "<64 lowercase hex>"
}
```

请求只说明客户端和当前标准版本，不包含稿件、项目 ID、路径、文件名、账号、设备、token、IP 派生标识或诊断日志。公开 schema 为 `config/schemas/standards-update-request-v1.schema.json`。

## 3. 成功响应

### 3.1 当前已是发布版本

- HTTP `204 No Content`；
- `Content-Length: 0`；
- 无 `Content-Type`、正文或版本元数据。

### 3.2 存在更高发布序列

- HTTP `200 OK`；
- `Content-Type: application/vnd.oak.standard-package+json`；
- 正文是 `.oakstd` envelope 的原始字节，不再套 JSON 外层；
- `Content-Length` 必须与实际字节一致；
- 禁止压缩、重定向、range 和响应正文反射。

服务端只提供候选字节，不授予信任。桌面仍须独立验证 Ed25519 门槛签名、canonical manifest、全文件 SHA-256、schema、规则白名单、APP 兼容范围、bundle 身份和 release 高水位，验证成功后才可生成一次性安装计划。

## 4. 发布源内部契约

运行时依赖注入的 `releaseSource.latest(bundleId)` 只可返回 `null` 或 exact 内部记录：

- `schema_version = 1.0`；
- `record_type = oak_standards_published_release`；
- `bundle_id`；
- `release_sequence`；
- `manifest_sha256`；
- `envelope_sha256`；
- `envelope_bytes`（仅服务器内存中的 `Buffer`）。

服务在响应前复算 envelope SHA-256，并拒绝未知字段、bundle 漂移、空包、超限包和摘要不一致。内部记录不是公开 JSON API，也不能包含私钥、对象存储凭据或签名操作能力。生产发布源尚未选择或实现。

## 5. 错误与审计

错误响应使用 `standards-update-http-error-v1.schema.json`，只含固定错误码/文案和随机请求 ID；不会反射请求、发布源异常或候选字节。

安全审计使用 `standards-update-http-audit-v1.schema.json`，只含：请求 ID、规范时间、方法、固定路由模板、HTTP 状态和错误码。不得记录 manifest、bundle、APP 版本、IP、User-Agent、请求头或稿件信息。审计接收器失败不能改变已选定的 HTTP 响应。

## 6. 客户端安装语义

1. 默认 `desktop-standards-update.json` 为 `pending_configuration`，普通运行零更新网络；
2. 用户点击“检查在线更新”后才发出一次请求；
3. 候选通过本地可信链后，主进程创建 10 分钟、一次性的内存计划；
4. 原生确认框集中显示版本、序列和变更摘要；取消立即销毁候选计划；
5. 安装原子切换新建项目默认标准并保留上一稳定版；
6. 已有项目继续固定旧 release，必须另行查看差异、创建检查点、明确确认并强制重检。

## 7. 当前证据边界

`tests/web_standards_update_http.test.js` 已用真实测试 Ed25519 密钥和签名包贯通：内存发布源 → 服务 → Node HTTP handler → Fetch runtime → 桌面 HTTP client → `StandardsProvider` 验签/哈希/schema/兼容性 → 原子安装与历史 release 复验。

这证明源码组件可组合，不证明生产域名、TLS、对象存储、CDN、密钥托管、发布审批、签名撤回、限流、监控或真实网络代理环境已经完成。
