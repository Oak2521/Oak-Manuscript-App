# SPEC_PROJECT_FORMAT — 项目文件格式（v1.0，冻结）

> 冻结日期：2026-07-11；`0.1.0-alpha.1` 于 2026-07-26 在不提升 `format_version` 的前提下加入向后兼容的检查点可选字段。`format_version` 为 `1.0` 的项目必须始终可被后续版本打开；破坏性字段变更须升版本号并提供兼容读取。商业跨端、账号与同步仍待实现，不得提前改变本格式。

## 1. 项目目录结构

```text
project-root/
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
  "app_version": "0.1.0-alpha.1",
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
- `sync.history` 在当前 `0.1.0-alpha.1` 为空数组（SyncProvider 占位不联网）；未来真实账号同步必须保持 schema 版本化和向后兼容。
- `plan-fixes` 产生的未确认计划不落盘；只有成功执行后的 `plan_id` 写入 `fixes[]`，取消预览不会改变 project.json。
- 旧 `1.0` 项目中的检查点可以缺少新增的大小、问题哈希与状态快照字段；新建检查点必须写全，读取与恢复逻辑保留旧检查点兼容路径。

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

## 5. 完整性验证（`verify` 命令语义）

1. `source/` 中原稿的 SHA-256 与 `project.json.source.sha256` 一致（不一致 = 最高级故障，退出码 2）；
2. 目录结构完整（六个子目录存在）；
3. `project.json` 可解析且 `format_version` 受支持；
4. 引用的 `result_file` / 检查点路径存在。
