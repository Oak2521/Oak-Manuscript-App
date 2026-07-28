# SPEC_PROJECT_FORMAT — 项目文件格式（v1.0，冻结）

> 冻结日期：2026-07-11；`0.1.0-alpha.1` 加入向后兼容的检查点可选字段，`alpha.2` 加强路径/锁/导出安全，`alpha.3` 把规则包 pin 扩为七字段并增加升级历史与强制重检，`alpha.4` 加固发布资源可信链。`0.1.0-alpha.5` 在不提升 `format_version` 的前提下增加向后兼容的 `settings.citation_resolution`；旧 `1.0` 项目可缺失并在读取时补为 `null`。破坏性字段变更须升版本号并提供兼容读取。商业跨端、账号与同步仍待实现，不得提前改变本格式。

## 1. 项目目录结构

```text
project-root/
├── .oak-project-write.lock # 可选持久诊断文件；CLI/Electron 写事务使用，非项目业务数据
├── project.json      # 本规格定义的项目清单
├── source/           # 只读原稿副本（创建后绝不修改）
├── working/          # 当前工作版本（修复作用于此）
├── checkpoints/      # 完整状态检查点（工作稿 / issues / state / 检查结果），最多 5 个
├── reports/          # 检查结果（机器可读 JSON）
├── exports/          # 用户导出文件（修订稿、三种报告）
└── logs/             # 本地技术日志（不含正文、标题、文件名、路径）
```

## 2. project.json（v1.0）

```json
{
  "format_version": "1.0",
  "app_version": "0.1.0-alpha.5",
  "project_id": "8 字节十六进制随机 ID",
  "created_at": "ISO8601 本地时间",
  "updated_at": "ISO8601",

  "source": {
    "stored_filename": "manuscript.docx",
    "format": "docx | md | txt | epub",
    "sha256": "原稿 SHA-256（创建时记录，永不改变）",
    "size_bytes": 0
  },

  "settings": {
    "manuscript_type": "paper | print_book | ebook",
    "language": "auto | zh | en | mixed",
    "language_detected": "zh | en | mixed | null",
    "citation_style": "default | gbt7714-2025 | apa-7 | chicago-18-nb | chicago-18-ad | none",
    "citation_style_resolved": "同上枚举（不含 default）| null",
    "citation_resolved_by": "default_mapping | default_resolver | user | null",
    "citation_mapping_version": "政策版本，如 2.0.0 | null",
    "citation_resolution": null,
    "check_depth": "quick | full",
    "epub_preview": false
  },

  "rulepack": {
    "name": "oak-rules",
    "version": "2.0.0",
    "pinned": true,
    "sha256": "规则包原始字节 SHA-256",
    "bundle_id": "oak-standards",
    "release_sequence": 2,
    "manifest_sha256": "canonical release manifest SHA-256"
  },

  "rulepack_history": [
    {
      "change_id": "rulepack-change-0001",
      "direction": "upgrade | rollback",
      "applied_at": "ISO8601",
      "from_rulepack": "完整七字段身份对象",
      "to_rulepack": "完整七字段身份对象",
      "plan_id": "rulepack-plan-<64 位十六进制摘要>",
      "diff_sha256": "升级差异摘要",
      "checkpoint_id": "cp-0001",
      "issues_archive": "reports/issues.before-rulepack-cp-0001.json | null"
    }
  ],
  "rulepack_check_required": false,

  "checks": [
    {
      "check_id": "check-0001",
      "kind": "check | recheck",
      "started_at": "ISO8601",
      "finished_at": "ISO8601",
      "rulepack_version": "2.0.0",
      "rulepack": "完整七字段身份对象",
      "issue_counts": { "error": 0, "warning": 0, "suggestion": 0 },
      "result_file": "reports/check-0001.json"
    }
  ],
  "check_seq": 1,

  "issues_file": "reports/issues.json",

  "checkpoints": [
    {
      "checkpoint_id": "cp-0001",
      "created_at": "ISO8601",
      "reason": "before_fix | before_restore:<目标检查点 ID> | before_rulepack_upgrade:<版本> | manual",
      "path": "checkpoints/cp-0001",
      "working_sha256": "建点时 working 文件的 SHA-256",
      "working_size_bytes": 0,
      "has_issues": true,
      "issues_sha256": "issues.json SHA-256 | null",
      "issue_count": 0,
      "state_version": "1.0",
      "state_sha256": "state.json SHA-256"
    }
  ],
  "checkpoint_seq": 1,

  "fixes": [
    {
      "fix_run_id": "fix-0001",
      "plan_id": "fix-plan-…",
      "applied_at": "ISO8601",
      "checkpoint_id": "cp-0001",
      "applied": [ { "issue_id": "…", "rule_id": "…", "fix_id": "…" } ],
      "counts": { "FIX-SPACE-001": 1 }
    }
  ],

  "sync": {
    "schema_version": "1.0",
    "preference": "never_asked | off | ask_each_time | always",
    "history": [
      { "synced_at": "ISO8601", "levels": ["summary"], "check_id": "check-0001", "destination": "placeholder" }
    ]
  },

  "integrity": { "last_verified_at": "ISO8601 | null", "source_hash_ok": true }
}
```

约定：

- 所有路径字段一律为**项目内相对路径**，正斜杠分隔；project.json 中不出现项目外绝对路径（隐私要求）；
- 所有 JSON 文件 UTF-8 无 BOM，换行 LF；
- `citation_style_resolved`、`citation_resolved_by`、`citation_mapping_version` 是便于旧消费方读取的投影；`citation_resolution` 是完整真相源，严格 schema 见 `SPEC_MODELS.md` 第 5 节。当它非空时，投影必须与 `requested_style/resolved_style/resolved_by/policy_version` 一致；
- 默认解析可得到具体体例、`structure_only` 或默认禁用。`structure_only` 时 `citation_style_resolved=null`、`citation_resolved_by=default_resolver`；完整证据只含数量/百分比/枚举，禁止稿件片段和路径；
- 旧项目可缺失 `citation_resolution`，读取为 `null`。新检查成功后必须写入完整解析，且检查结果、`settings_snapshot` 和项目当前设置必须一致；
- `sync.history` 在当前 `0.1.0-alpha.5` 为空数组（SyncProvider 占位不联网）；未来真实账号同步必须保持 schema 版本化和向后兼容。
- `plan-fixes` 产生的未确认计划不落盘；只有成功执行后的 `plan_id` 写入 `fixes[]`，取消预览不会改变 project.json。
- 旧 `1.0` 项目中的检查点可以缺少新增的大小、问题哈希与状态快照字段；新建检查点必须写全，读取与恢复逻辑保留旧检查点兼容路径。
- `config/tool-manifests/`、Electron/CPython/JRE/Ace 运行资源锁、builder 独立 tracked lock 和打包 smoke 记录属于应用发布资源，不进入用户项目，也不得被复制进 `project.json`。这些锁按 locale-independent UTF-16 顺序生成；需要更新候选树时通过显式授权的受控事务提交。这属于发布资源身份，不改变用户项目 schema 或标准 release 身份。
- `project.json.app_version` 记录项目创建版本；检查报告 `app_version` 记录该次检查所用核心版本，旧项目被新版打开后两者可以不同。`checks[].result_file` 指向的报告必须留在项目内，`check_id` 必须匹配对应检查记录。alpha.3 新记录含完整 `checks[].rulepack`，报告必须与其七字段完全一致；alpha.2 及更早的冻结格式没有该字段，报告只允许精确 `{name, version}`，并以 `version` 对齐 `checks[].rulepack_version`，不得倒填伪造七字段。规则包升级后允许历史检查/报告保留旧身份；最新当前检查/报告才必须与项目现行 pin 一致。`rulepack_version` 对新记录只是兼容显示字段，不能单独证明完整身份。
- `rulepack_history` 必须从第一项起连续编号，前项 `to_rulepack` 等于后项 `from_rulepack`，末项 `to_rulepack` 等于当前 pin；相同 release sequence 的横向替换禁止。`issues_archive` 只能使用受控文件名并与升级时哈希绑定。
- `rulepack_check_required=true` 表示 pin 已变化而新规则尚未完成一次检查；此时修复计划、修复、外部验证、出版评估与导出必须拒绝。成功 check/recheck 写入同一七字段身份后才清零。

### 2.1 写锁文件（不进入 `project.json` schema）

- `.oak-project-write.lock` 是跨进程写事务的持久诊断载体，内容为带前导协议字节的 UTF-8 JSON，记录 schema/protocol/state、PID、命令、取得时间和随机进程 token；不得包含稿件内容、文件名或本地路径；
- 真正互斥由内核锁提供：Windows 锁定元数据区之外的固定字节，macOS/POSIX 使用非阻塞 `flock`。进程崩溃后由内核释放，不依据锁文件中的 PID 猜测存活或删除“陈旧锁”；
- `create/check/recheck/fix/export/verify/restore-checkpoint/external/issue/upgrade-rulepack` 必须取得写锁；`plan-citation`、`plan-fixes`、`list-checkpoints`、`project-standard-status` 与 `plan-rulepack-upgrade` 保持只读；
- 同名文件只有完整符合锁协议且是单链接常规文件时才可接管；普通用户文件、链接、硬链接或损坏协议文件一律 fail-closed，原字节不变；
- 锁争用以结构化 `PROJECT_WRITE_LOCKED` 返回，`retryable=true`，并可带不含路径/正文的 owner 元数据。锁文件存在本身不表示事务仍存活。

## 3. 检查点策略（冻结）

- 触发：已确认的 `fix --plan-id` 真正产生修改前建立 `before_fix` 检查点；恢复某检查点前建立 `before_restore:<目标 ID>` 安全检查点；规则包 pin 改变前建立 `before_rulepack_upgrade:<版本>` 检查点；
- 内容：工作稿、可选 `issues.json`、`state.json`，以及状态引用的检查结果。状态快照覆盖 `settings`、七字段 `rulepack`、`checks`、`check_seq`、`issues_file`、`fixes` 与 `rulepack_check_required`；旧检查点缺该字段时从最后检查身份安全推导，无法证明时按需要重检处理；
- 完整性：每个快照记录 SHA-256，列表保留损坏项但标为不可恢复；路径、ID、符号链接、哈希或 JSON 状态异常均在写入前拒绝；
- 上限 5 个：按检查点序号裁剪最旧项；恢复时目标检查点与新建安全检查点受保护，决不触碰 `source/`；
- 恢复：暂存并原子换入工作稿、问题与检查结果，恢复项目状态，同时保持 `check_seq` 单调不减以免覆盖较新报告；失败时用恢复前安全检查点回滚；
- 列表：`list-checkpoints` 返回时间、原因、问题数量、状态版本、`can_restore` 与验证错误，不向 Renderer 暴露内部检查点路径。

## 4. 引用确认、批量修复、恢复与规则包升级 CLI 契约

引用解析遵循与批量修复同类的“计划—确认—重验”契约：

1. `plan-citation --project <目录> --citation <六选一>` 严格只读，返回完整 `citation_resolution`、实际覆盖规则与绑定当前状态的 `citation-plan-*`；
2. 用户一次确认后，`check|recheck --citation <选择> --citation-plan-id <ID>` 在写锁内重算计划；项目、working、issues、标准 release 或解析结果变化都使旧 ID 失效；
3. 成功检查把解析写入 settings、settings snapshot 和 report；取消预览不写入。

1. `plan-fixes --project <目录>` 严格只读，返回全部候选、修改前/后预览和绑定当前项目状态的 `plan_id`；
2. 用户集中查看全部候选并一次确认后，才可执行 `fix --project <目录> --plan-id <ID>`；working、问题状态或规则包变化都会使旧计划失效；
3. 修复在临时 working 副本完成并复验计划，随后以事务方式换入 working、issues 与 project.json；任一步失败都不得留下部分修改；
4. `list-checkpoints --project <目录>` 列出检查点；
5. `restore-checkpoint --project <目录> --checkpoint-id <ID>` 安全恢复，并返回恢复前安全检查点 ID，使恢复操作本身可撤销。

规则包升级遵循独立的同类确认契约：

1. `project-standard-status --project <目录>` 只读返回项目七字段 pin、是否需要重检和当前状态；
2. `plan-rulepack-upgrade --project <目录> --to-manifest-sha256 <摘要>` 严格只读，返回规则/默认体例/标准等完整差异及绑定项目全部关键状态的 `plan_id`；
3. 用户集中查看并一次确认后，`upgrade-rulepack --project <目录> --to-manifest-sha256 <摘要> --plan-id <ID>` 在写锁内重算计划，建立检查点、归档 issues 并原子提交 pin；
4. 升级只改变项目标准身份与相关状态，不改变 source/working 字节；提交后 `rulepack_check_required=true`，必须用新规则重检。

创建项目另有以下不改变 schema 的安全契约：锁前预检只读且失败零污染；锁内只打开一次输入，以同一 FD 复制到 `source/`，再从 `source/` 生成 `working/`。输入入口可经过 OneDrive/reparse/symlink，但最终打开对象必须是常规文件；复制期间身份/大小/mtime 变化会中止并精确清理半项目。

## 5. 完整性验证（`verify` 命令语义）

1. `source/` 中原稿的 SHA-256 与 `project.json.source.sha256` 一致（不一致 = 最高级故障，退出码 2）；
2. 目录结构完整（六个子目录存在）；
3. `project.json` 可解析、顶层及必需字段类型正确、`format_version` 受支持，ID/序号/固定路径关系一致；七字段 pin、升级 history 连续性和强制重检状态通过项目 schema 校验；每份检查报告还须为 UTF-8 JSON 对象，`schema_version` / `check_id` 与对应检查记录一致；
4. 项目根、六个固定子目录、manifest、source/working、引用的 `result_file` / issues / 检查点均为项目内安全对象；链接、联接/reparse、硬链接、绝对/穿越路径和身份逃逸均拒绝；
5. source 与 working 是两个独立常规文件；source 大小和 SHA-256 与清单一致。

`Project.verify()` 会逐份解析历史报告并与**各自**检查记录交叉核对：alpha.3 新记录严格要求七字段 `rulepack` 与显示版本一致；alpha.2 及更早的旧记录只接受其真实的 `{name, version}` 报告身份并与 `rulepack_version` 对齐，不补造七字段。历史报告不要求等于项目当前 pin；只有最新可操作检查另由修复、外部验证与导出路径要求等于当前 pin。该验证证明内部引用与身份字段一致，不是报告全文的密码学真实性证明。
