# SPEC_MODELS — 问题 / 规则 / 标准模型

> 问题与规则模型仍为 v1.0；标准注册表为治理 schema 2.0。同步负载于 2026-07-26 按商业方案 v2.0 改为“结果与元数据白名单”，废止旧文件级同步占位；`0.1.0-alpha.8` 已实现 SyncRecord v1 离线契约。`0.1.0-alpha.5` 引入规则包 2.0.0 与向后兼容的 `citation_resolution` 模型；机器可读定义以 `config/` 下 JSON 和核心严格校验器为准，本文件为语义规范。

## 1. 问题模型（Issue，方案 §6.3）

```json
{
  "issue_id": "check-0001-0042（检查号-序号，确定性生成）",
  "rule_id": "DOCX-SPACE-001",
  "profile": "paper | print_book | ebook",
  "severity": "error | warning | suggestion",
  "title": "连续空格",
  "explanation": "为什么需要处理（来自规则包，面向作者的语言）",
  "location": { "part": "document | footnotes | endnotes | package", "paragraph": 23, "note_id": null, "resource": null },
  "preview": "截断脱敏的短上下文，≤ 60 字符",
  "standard_refs": ["OAK-DOCX-STYLE-001"],
  "auto_fixable": true,
  "fix_id": "FIX-SPACE-001",
  "confidence": "high | medium | low",
  "status": "open | accepted | rejected | resolved"
}
```

语义（冻结）：

- **severity**：`error` = 必须先处理（技术性阻碍投稿/出版）；`warning` = 建议处理；`suggestion` = 可选改进。
- **confidence**：`high` 才允许进入自动修复白名单；`low` 一律归入「需要人工判断」组展示。
- **status 流转**：`open` →（用户接受修复并已应用）`resolved`；→（用户明确拒绝）`rejected`；`accepted` 为用户已接受但尚未应用的中间态。复检时：已 `resolved` 的问题若再次检出，生成**新 issue**（不复活旧的）。
- **issue_id 确定性**：同一输入 + 同一规则包版本，两次检查产生的问题集合与顺序完全一致（引擎按 part → resource → paragraph → rule_id 排序）。
- **location 兼容性附注（2026-07-11，M3）**：为 EPUB 增加可选字段 `resource`（包内资源路径）与 part 取值 `package`（包级问题）。属向后兼容的增量扩展，v1.0 消费方可安全忽略。
- **preview 脱敏**：只含问题附近截断文本；脱敏摘要与日志中**不得**出现 preview。

## 2. 稿件状态级别（结果页概览，方案 §5.3，冻结的透明条件）

| 级别 | 条件（对 open/accepted 状态的问题计数） |
|---|---|
| 尚未具备提交条件 | 存在未处理 error |
| 可在订正后提交 | 无未处理 error，存在未处理 warning |
| 基本具备编辑评估条件 | 无未处理 error 与 warning（suggestion 可存在） |

必须随级别显示：「仅代表技术与规范准备程度，不评价学术质量、文学价值或出版可行性。」

**与内部三态模型的映射**（参考 oak-publishing-system 的 pass/review/blocked 经验，语义相近但不相同，禁止混用）：error ≈ blocked，warning/suggestion ≈ review，全部通过 ≈ pass。APP 对外只使用本节的三个中文级别与 severity 词汇。

## 3. 规则模型（Rule，规则包条目）

```json
{
  "rule_id": "DOCX-SPACE-001",
  "milestone": "M1 | M2 | M3",
  "applies_to": {
    "formats": ["docx"],
    "manuscript_types": ["paper", "print_book"],
    "languages": ["zh", "en", "mixed"],
    "citation_styles": ["*"]
  },
  "severity": "warning",
  "confidence": "high",
  "auto_fixable": true,
  "fix_id": "FIX-SPACE-001 | null",
  "title": "连续空格",
  "explanation": "面向作者的问题解释",
  "standard_refs": ["OAK-DOCX-STYLE-001"],
  "enabled_by_default": true,
  "since_pack_version": "1.0.0"
}
```

- 规则包（`config/rule-packs/oak-rules-<semver>.json`）是规则定义的唯一来源；判断逻辑在核心内按 `rule_id` 注册，两侧必须一一对应（引擎启动时校验：有定义无实现且属当前里程碑 → 启动失败）。
- 引擎按 `applies_to` × 项目设置决定启用；未实现里程碑的规则组在报告「本版本未启用的检查」中如实列出。
- 自动修复白名单 = 规则包中 `auto_fixable: true` 且 `confidence: "high"` 的规则。扩充白名单必须同时提供：规则定义、不应修复的反例样本、幂等测试（方案 §24）。

## 4. 标准模型（Standard schema 2.0，`config/standards.json`）

```json
{
  "standard_id": "GBT-7714-2025",
  "title": "信息与文献 参考文献著录规则（GB/T 7714—2025）",
  "source_type": "official | oak_interpretation | technical_spec",
  "official_source_url": "",
  "oak_resource_slug": "citation/gbt-7714-2025",
  "version": "2025",
  "updated_at": "2026-07-11",
  "scope": "适用范围一句话",
  "summary": "APP 内简明解释，不得含 TODO/占位文案",
  "status": "active | superseded | under_review | deprecated",
  "publisher": "发布者或待核验责任说明",
  "reviewed_by": ["审核者或明确的待指定角色"],
  "copyright_use": "metadata_only | short_excerpt | open_license",
  "supersedes": [],
  "superseded_by": null,
  "rule_ids": ["REF-002", "REF-GBT-001"],
  "source_verified_at": null,
  "source_verification_status": "verified | pending | unavailable",
  "change_history": [
    { "changed_at": "2026-07-27", "change_type": "schema_migration", "summary": "变更说明" }
  ]
}
```

- `oak_resource_slug` 是网站资源页的稳定标识；网站目录调整用重定向兼容，规则包不因此升级；
- 每条 Issue 的 `standard_refs` 必须指向本注册表中存在的 `standard_id`；每项标准反向列出 `rule_ids`，两侧须完全一致；
- `verified` 必须有真实核验日期；空外部 URL 只允许非湖岸解释项同时为 `under_review + unavailable`；`superseded` 必须指向替代项；
- schema 字段完整不代表内容已审校。当前 13 项中外部来源核验为 0，reviewed_by 仍含角色占位，不能用结构通过替代事实审核。

## 5. 引用体例请求与默认解析（v2.0.0，方案 §6.2）

用户请求枚举固定为：`default | gbt7714-2025 | apa-7 | chicago-18-nb | chicago-18-ad | none`。显式体例直接产生 `style_specific + user`；`none` 产生 `disabled + user`。只有 `default` 进入解析器。

**语言信号**：统计正文 CJK 字符数 `c` 与 ASCII 字母数 `a`。`c ≥ 4a` → zh；`a ≥ 4c` → en；否则 mixed。`c + a < 200` 时标记语言证据不足，不再像 1.0.0 那样把 mixed 直接映射为具体体例。

**结构信号家族**：

- numeric：编号引用的唯一号码、编号条目和两者覆盖率；
- author_year：作者—年份引用、能匹配条目的引用/条目数和覆盖率；
- notes_bibliography：注释引用、非空注释、匹配数和覆盖率。

强证据要求主/伴信号各至少 3 个且覆盖率至少 80%；中等证据各至少 2 个且覆盖率至少 50%。只有唯一家族达标、与稿件类型/语言相容，且 `style_capability_rules` 中至少一条规则对当前格式/类型/语言/体例启用时，才返回具体体例。中等对应 `confidence=medium`，强对应 `high`。

以下情况返回 `structure_only`，`resolved_style=null`：格式提取只部分可用、语言证据不足、多个参考文献节、多信号家族冲突、证据不足或信号与 profile 不匹配。此模式只运行在规则包中明确允许的引用结构/一致性规则，不得把具体格式结论写入报告。无引用信号的 ebook 可返回 `disabled + default_resolver`。

`citation_resolution` schema 的顶层字段严格为：`schema_version`、`requested_style`、`mode`、`resolved_style`、`resolved_by`、`resolver`、`reason_code`、`reason`、`confidence`、`evidence`、`coverage`。`resolved_by` 只允许 `user | default_resolver | legacy_mapping`；`resolver` 记录 ID/version/policy version/signal extractor version；`coverage` 记录实际调度的 rule IDs。`evidence` 只允许数量、百分比和枚举，禁止原文、姓名、文件名、路径和内容哈希。

1.0.0 旧规则包的类型/语言映射仅作 `legacy_mapping` 兼容路径；新项目和升级后的默认检查使用 2.0.0 解析器。

## 6. 检查结果文件（reports/check-NNNN.json）

```json
{
  "schema_version": "1.0",
  "check_id": "check-0001",
  "kind": "check | recheck",
  "started_at": "…", "finished_at": "…",
  "app_version": "0.1.0-alpha.5",
  "rulepack": {
    "name": "oak-rules",
    "version": "2.0.0",
    "pinned": true,
    "sha256": "规则包原始字节 SHA-256",
    "bundle_id": "oak-standards",
    "release_sequence": 2,
    "manifest_sha256": "canonical manifest SHA-256"
  },
  "settings_snapshot": { "…": "创建检查时 project.settings 的完整快照" },
  "citation_resolution": {
    "schema_version": "1.0",
    "requested_style": "default",
    "mode": "structure_only",
    "resolved_style": null,
    "resolved_by": "default_resolver",
    "resolver": { "id": "oak-citation-structure-resolver", "version": "1.0.0", "policy_version": "2.0.0", "signal_extractor_version": "1.0.0" },
    "reason_code": "conflicting_structures",
    "reason": "检测到多个达到中等阈值的引用结构家族，无法可靠选择单一体例。",
    "confidence": "low",
    "evidence": { "…": "仅数量、百分比和枚举" },
    "coverage": { "signal_availability": "full", "rule_ids": ["实际调度的引用结构规则"] }
  },
  "citation_note": "本次仅执行引用结构与一致性检查（未选定具体体例）",
  "issues": [ "Issue 对象数组，见第 1 节" ],
  "skipped_rule_groups": [ { "milestone": "M2", "reason": "本版本未实现" } ],
  "external_tools": { "epubcheck": "not_run", "ace": "not_run" },
  "disclaimer": "检查仅代表技术与规范准备程度……"
}
```

检查结果一致性约束：每份报告的 `check_id` 必须对应自己的项目 `checks[]` 记录。alpha.3 新记录含完整七字段 `checks[].rulepack`，报告必须与其完全一致；alpha.2 及更早的旧记录没有该字段，只允许报告保存精确 `{name, version}`，并由 `version` 对齐 `checks[].rulepack_version`，这种 legacy 证据不能冒充七字段身份。规则包升级后，历史检查和历史报告保留旧身份是正常现象；只有最新的当前检查/报告必须与项目现行 pin 一致，后续修复、外部验证和导出据此放行。`project.json.app_version` 记录项目创建版本，报告 `app_version` 记录本次检查所用核心版本，二者在旧项目升级后不要求永久相等。源码/打包 smoke 使用当次新建项目，会读取真实项目、最新检查与导出报告核对 APP/项目/检查/报告四方身份；不能仅凭 Renderer 或 `app:info` 自报。

## 7. 外部验证状态模型（当前 0.1.0-alpha.5；语义自 alpha.3 保持不变）

`external_tools` 的每个工具状态只允许 `not_run | passed | failed`，且必须以**本次进程**生成、结构合法的报告为依据：

| 工具 | `passed` | `failed` | `not_run` |
|---|---|---|---|
| EpubCheck 5.3.0 | 退出码 0，报告版本正确且 fatal/error 均为 0 | 退出码 1，报告版本正确且 fatal+error > 0 | 工具/可信清单缺失、超时、报告非法、版本不符，或退出码与报告计数不一致 |
| Ace 1.4.6 | 退出码 0，安全的本次报告 `earl:outcome=pass` | 退出码 0，安全的本次报告 `earl:outcome=fail` | 工具/Chrome/helper/可信清单缺失、超时、报告非法，或任何非零退出码 |

`failed` 表示验证工具成功运行并发现稿件问题，不是运行错误。外部工具的详情可包含工具版本和数量统计，但不得含稿件正文、标题、文件名、本地路径或问题预览。报告渲染器不得把 `not_run` 翻译为“通过”。

固定样本作为状态契约：`epub_good.epub` 在 EpubCheck/Ace 均为 `passed`；`epub_needs_review.epub` 在两者均为 `failed`。资源门禁还会用 JRE 对这两个样本执行好/坏矩阵，只有结果与固定退出码、版本和计数一致才算探针成功。

运行前可信性约束：Ace 只有在 stage manifest、受版本控制的 full lock、236 包闭包、补丁与全部文件一致时才可执行，Python 运行路径须独立复核；EpubCheck/JRE 同理先通过分发与平台锁。非原生 platform/arch 不能产生运行状态；显式 `--no-runtime-probe` 的纯静态门禁结果也不得写入 `external_tools` 作为 `passed` 或 `failed`。

## 8. 同步负载 schema（SyncRecord v1，alpha.8 离线契约已实现）

商业方案只允许同步检查结果与必要元数据。旧 v1 占位中的 `project_display_name`、Issue `preview` 和 `file` 级上传全部废止，不得为兼容旧文档而实现。

机器可读客户端权威为 `config/schemas/sync-record-v1.schema.json`，完整语义与信任边界见 `SYNC_RECORD_V1.md`。当前服务端尚未实现；上线前必须以同一 schema 和反泄露测试建立服务端验证器。允许字段：

- 随机项目 ID、run ID、幂等 ID；
- 文件格式、稿件类型、检查配置、语言类别和长度区间；
- 请求体例、最终解析体例、规则包版本、APP 版本、平台和创建时间；
- 按严重程度、维度和处理状态汇总的数量；
- 可选的结构化问题记录仅含 `rule_id`、严重程度、维度、处理状态和是否可修复，不含位置文本或预览；
- 外部验证状态、导出状态、同步 schema 版本和明确授权时间。

禁止字段：稿件、正文、标题、摘要、关键词、任何短预览或片段、原稿/修订稿、文件名、本地路径、用户名或设备目录、参考文献/脚注/图片原文、文件或正文哈希及其他内容指纹。

未登录状态不询问、不发送；登录不等于授权。Renderer 不可构造负载；主进程从 Python `sync-source` 取得只读来源并构造 exact-schema 记录。发送前必须逐字段展示同一份缓存负载并由用户选择仅本次同步、以后仍询问、暂不同步或不再询问此项目。alpha.21 起使用按账户隔离的 OS 加密 `pending_transport` 队列并支持重启恢复，但没有网络上传；入队不等于同步成功。Web 端用户主动发起的临时稿件处理属于独立作业协议，不得混入结果同步 schema 或长期账号历史。

## 9. Web 临时作业模型（alpha.27 契约、HTTP、GoTrue、内容存储与持久状态边界）

五份公开机器可读 schema 分别定义创建请求、公开状态、删除回执、HTTP 错误和无内容安全审计：`web-job-create-v1`、`web-job-status-v1`、`web-job-deletion-v1`、`web-http-error-v1`、`web-http-audit-v1`；两份 Web 私有 schema 定义数据库内部任务记录与创建/重放结果。参考内存状态机位于 `web/job-contract.js`，生产形状的持久服务位于 `web/persistent-job-service.js`，HTTP handler 与 Supabase/GoTrue/Fetch/客户端边界分别位于对应模块。`web/netlify-ephemeral-storage.js` 只持久化 input/output 内容对象及 exact 生命周期 metadata；`web/supabase/001_web_job_state.sql` 只持久化主体归属、最小文档枚举、任务状态、预留/租约、非内容指纹和幂等墓碑，两者不得混存。

创建请求 exact 字段：

- `schema_version` / `request_type` / `idempotency_key`；
- `consent`：只允许 `granted=true`、`scope=single_job_processing`、隐私版本与同意时间；
- `document`：只允许格式、稿件类型、检查配置、引用体例和字节数。

主体不属于请求模型，由可信会话层另行传入 `{kind, subject_id}`。公开状态只含任务 ID、状态、创建/到期/删除期限、输入是否仍保留和结果是否可用。删除回执只在输入、输出均已删除后成立；删除失败状态为 `deletion_pending`，没有成功回执。

上传 Buffer 与结果 Buffer 不进入上述 JSON 模型、观察事件或长期同步记录，只交给带 `deleteAt` 的临时存储适配器。handler 的公开路由仅为创建、状态、上传、下载、取消和删除；worker 状态转换没有公开 HTTP 路由。状态变更要求 HTTPS 与同源 Origin/Fetch Metadata；Bearer 必须经服务端 verifier 且不开放 CORS，Cookie 模式附加 CSRF。上传要求唯一 Content-Length，并在读入前完成大小/MIME/并发预留。HTTP 审计只允许请求 ID、时间、方法、路由模板、状态与错误码。

状态机、handler、Bearer/GoTrue/Fetch、Netlify Blobs 适配器和 Supabase/Postgres 持久源码都不是已部署生产服务：真实数据库迁移与 RLS/多实例验证、私有队列/隔离 worker、恶意文件门禁、短时下载和零留存审计仍待实现。
