# SyncRecord v1 — 结果与元数据同步契约

> 状态：`0.1.0-alpha.24` 保留客户端/核心离线契约、逐字段预览、按账户隔离的 OS 加密持久队列和第二进程重启恢复；新增的 Supabase Bearer 适配器只服务 Web 临时任务身份，不是 SyncRecord transport。生产账号凭据、网络 transport、服务端验收与网站后台尚未实现，本文件不能作为“数据已可同步到网站”的证明。

## 1. 信任边界

同步记录不是 Renderer 任意拼装的对象。数据流固定为：

```text
受项目路径门禁保护的 Python sync-source
  -> 只返回结构化脱敏来源
  -> Electron buildSyncRecordV1 精确取白名单
  -> validateSyncRecordV1 拒绝未知/禁止字段
  -> 已登录用户逐字段预览
  -> 四选一明确确认
  -> safeStorage 加密幂等队列（生产 transport 未配置）
```

Renderer 只能向主进程提交项目句柄、`check | export` 事件、是否包含结构化问题记录、幂等 ID 和固定选择枚举；不能提交同步 payload、令牌或网络目标。未来服务端必须对同一 schema 再验证一次，不得信任客户端已过滤。

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

当前仍没有生产网络 transport、后台发送、退避调度或网站后台；关闭并重新打开 APP 只会恢复本机待发送状态，不会产生上传。

## 5. 账号与权益模拟边界

- `AuthProvider` 固定声明未来采用系统浏览器 PKCE；生产未配置时 `beginLogin` 返回 `configuration_required`，不打开网页、不联网；
- 本地测试可模拟 authenticated、signed_out、expired、revoked，但生产运行不开放模拟入口；
- `LicenseProvider` 给出 Free/Pro 能力矩阵，并可按 `validUntil` / `graceUntil` 计算 active、grace、expired；模拟授权没有签名证据，`signatureVerified=false`；
- 订阅过期只影响新的 Pro 权益，`localProjectsLocked` 永远为 false；
- 队列已使用 `safeStorage`，但这不是登录 token 存储；令牌凭据、设备撤销服务和生产签名授权缓存均未实现。

## 6. 生产对接前必须补齐

1. 经授权核对网站当前 Supabase、账号和后台 schema；
2. 实现独立最小权限网络 transport，保持默认 Electron session 离线；
3. 系统浏览器 PKCE、回调校验、OS 安全凭据存储、退出/过期/撤销；
4. 服务端同 schema 白名单、账号归属、幂等唯一约束和授权时间写入；
5. 在现有加密、取消、重试、崩溃恢复与删除基础上，实现发送中状态、限次退避、网络错误分类和与 transport 的崩溃一致性；
6. APP 与网站后台的查看、导出、删除和审计记录；
7. 正文、文件名、路径、片段、哈希泄露反向集成测试及真实隐私验收。
