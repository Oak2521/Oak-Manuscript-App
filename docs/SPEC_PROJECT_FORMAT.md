# SPEC_PROJECT_FORMAT — 项目文件格式（v1.0，冻结）

> 冻结日期：2026-07-11；`0.1.0-alpha.1` 于 2026-07-26 在不提升 `format_version` 的前提下加入向后兼容的检查点可选字段。`0.1.0-alpha.2` 的完整 schema/路径验证、跨进程写锁、单 FD 创建、安全导出、运行时 full lock、事务化 staging、统一 Python bootstrap、发布门禁与 smoke 身份验证不改变 `project.json` 格式。`format_version` 为 `1.0` 的项目必须始终可被后续版本打开；破坏性字段变更须升版本号并提供兼容读取。商业跨端、账号与同步仍待实现，不得提前改变本格式。

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
  "app_version": "0.1.0-alpha.2",
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
    "citation_resolved_by": "default_mapping | user | null",
    "citation_mapping_version": "映射表版本，如 1.0.0 | null",
    "check_depth": "quick | full",
    "epub_preview": false
  },

  "rulepack": { "name": "oak-rules", "version": "1.0.0", "pinned": true },

  "checks": [
    {
      "check_id": "check-0001",
      "kind": "check | recheck",
      "started_at": "ISO8601",
      "finished_at": "ISO8601",
      "rulepack_version": "1.0.0",
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
      "reason": "before_fix | before_restore:<目标检查点 ID> | manual",
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
- `citation_style_resolved`、`citation_resolved_by`、`citation_mapping_version` 在体例为 `default` 并完成解析后必填——这是「由默认规则选定」可追溯性的载体；
- `sync.history` 在当前 `0.1.0-alpha.2` 为空数组（SyncProvider 占位不联网）；未来真实账号同步必须保持 schema 版本化和向后兼容。
- `plan-fixes` 产生的未确认计划不落盘；只有成功执行后的 `plan_id` 写入 `fixes[]`，取消预览不会改变 project.json。
- 旧 `1.0` 项目中的检查点可以缺少新增的大小、问题哈希与状态快照字段；新建检查点必须写全，读取与恢复逻辑保留旧检查点兼容路径。
- `config/tool-manifests/`、JRE/Ace 阶段清单和打包 smoke 记录属于应用发布资源，不进入用户项目，也不得被复制进 `project.json`。这些锁按 locale-independent UTF-16 顺序生成，并与候选 stage 事务提交；这属于发布资源身份，不改变用户项目 schema。
- `project.json.app_version` 记录项目创建版本；检查报告 `app_version` 记录该次检查所用核心版本，旧项目被新版打开后两者可以不同。`checks[].result_file` 指向的报告必须留在项目内；其 `check_id` 须与对应检查记录一致，报告规则包须与项目固定规则包及检查记录 `rulepack_version` 一致。当次 smoke 新建项目并立即检查，因此直接读取这些真实文件，额外核对项目与报告版本都等于待验 APP 版本，而非信任 UI 自报。

### 2.1 写锁文件（不进入 `project.json` schema）

- `.oak-project-write.lock` 是跨进程写事务的持久诊断载体，内容为带前导协议字节的 UTF-8 JSON，记录 schema/protocol/state、PID、命令、取得时间和随机进程 token；不得包含稿件内容、文件名或本地路径；
- 真正互斥由内核锁提供：Windows 锁定元数据区之外的固定字节，macOS/POSIX 使用非阻塞 `flock`。进程崩溃后由内核释放，不依据锁文件中的 PID 猜测存活或删除“陈旧锁”；
- `create/check/recheck/fix/export/verify/restore-checkpoint/external/issue` 必须取得写锁；`plan-fixes` 与 `list-checkpoints` 保持只读；
- 同名文件只有完整符合锁协议且是单链接常规文件时才可接管；普通用户文件、链接、硬链接或损坏协议文件一律 fail-closed，原字节不变；
- 锁争用以结构化 `PROJECT_WRITE_LOCKED` 返回，`retryable=true`，并可带不含路径/正文的 owner 元数据。锁文件存在本身不表示事务仍存活。

## 3. 检查点策略（冻结）

- 触发：已确认的 `fix --plan-id` 真正产生修改前建立 `before_fix` 检查点；恢复某检查点前建立 `before_restore:<目标 ID>` 安全检查点；
- 内容：工作稿、可选 `issues.json`、`state.json`，以及状态引用的检查结果。状态快照覆盖 `settings`、`rulepack`、`checks`、`check_seq`、`issues_file`、`fixes`；
- 完整性：每个快照记录 SHA-256，列表保留损坏项但标为不可恢复；路径、ID、符号链接、哈希或 JSON 状态异常均在写入前拒绝；
- 上限 5 个：按检查点序号裁剪最旧项；恢复时目标检查点与新建安全检查点受保护，决不触碰 `source/`；
- 恢复：暂存并原子换入工作稿、问题与检查结果，恢复项目状态，同时保持 `check_seq` 单调不减以免覆盖较新报告；失败时用恢复前安全检查点回滚；
- 列表：`list-checkpoints` 返回时间、原因、问题数量、状态版本、`can_restore` 与验证错误，不向 Renderer 暴露内部检查点路径。

## 4. 批量修复与恢复 CLI 契约

1. `plan-fixes --project <目录>` 严格只读，返回全部候选、修改前/后预览和绑定当前项目状态的 `plan_id`；
2. 用户集中查看全部候选并一次确认后，才可执行 `fix --project <目录> --plan-id <ID>`；working、问题状态或规则包变化都会使旧计划失效；
3. 修复在临时 working 副本完成并复验计划，随后以事务方式换入 working、issues 与 project.json；任一步失败都不得留下部分修改；
4. `list-checkpoints --project <目录>` 列出检查点；
5. `restore-checkpoint --project <目录> --checkpoint-id <ID>` 安全恢复，并返回恢复前安全检查点 ID，使恢复操作本身可撤销。

创建项目另有以下不改变 schema 的安全契约：锁前预检只读且失败零污染；锁内只打开一次输入，以同一 FD 复制到 `source/`，再从 `source/` 生成 `working/`。输入入口可经过 OneDrive/reparse/symlink，但最终打开对象必须是常规文件；复制期间身份/大小/mtime 变化会中止并精确清理半项目。

## 5. 完整性验证（`verify` 命令语义）

1. `source/` 中原稿的 SHA-256 与 `project.json.source.sha256` 一致（不一致 = 最高级故障，退出码 2）；
2. 目录结构完整（六个子目录存在）；
3. `project.json` 可解析、顶层及必需字段类型正确、`format_version` 受支持，ID/序号/固定路径关系一致；
4. 项目根、六个固定子目录、manifest、source/working、引用的 `result_file` / issues / 检查点均为项目内安全对象；链接、联接/reparse、硬链接、绝对/穿越路径和身份逃逸均拒绝；
5. source 与 working 是两个独立常规文件；source 大小和 SHA-256 与清单一致。
