# SPEC_PROJECT_FORMAT — 项目文件格式（v1.0，冻结）

> 冻结日期：2026-07-11（阶段 0）。`format_version` 为 `1.0` 的项目必须永远可被后续版本打开；任何字段变更须升版本号并保持向后兼容读取。网站后接（阶段 4）不得改变本格式。

## 1. 项目目录结构（方案 §6.1）

```text
project-root/
├── project.json      # 本规格定义的项目清单
├── source/           # 只读原稿副本（创建后绝不修改）
├── working/          # 当前工作版本（修复作用于此）
├── checkpoints/      # 修复前自动检查点，最多 5 个，超出删最旧
├── reports/          # 检查结果（机器可读 JSON）
├── exports/          # 用户导出文件（修订稿、三种报告）
└── logs/             # 本地技术日志（不含正文、标题、文件名、路径）
```

## 2. project.json（v1.0）

```json
{
  "format_version": "1.0",
  "app_version": "0.0.1",
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

  "issues_file": "reports/issues.json",

  "checkpoints": [
    {
      "checkpoint_id": "cp-0001",
      "created_at": "ISO8601",
      "reason": "before_fix | manual",
      "path": "checkpoints/cp-0001",
      "working_sha256": "建点时 working 文件的 SHA-256"
    }
  ],

  "fixes": [
    {
      "fix_run_id": "fix-0001",
      "applied_at": "ISO8601",
      "checkpoint_id": "cp-0001",
      "applied": [ { "issue_id": "…", "rule_id": "…", "fix_id": "…" } ]
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
- `citation_style_resolved`、`citation_resolved_by`、`citation_mapping_version` 在体例为 `default` 并完成解析后必填——这是「由默认规则选定」可追溯性的载体（方案 §5.2）；
- `sync.history` 第一版永远为空数组（SyncProvider 占位不联网），schema 已冻结以保证阶段 4 后接不改格式。

## 3. 检查点策略（冻结）

- 触发：每次 `fix` 执行前自动创建；
- 内容：`working/` 当前文件的完整副本 + 当时的 `reports/issues.json` 副本；
- 上限 5 个：创建第 6 个前删除 `created_at` 最旧的一个（决不触碰 `source/`）；
- 恢复：将检查点文件复制回 `working/` 并恢复 issues 状态，随后必须 `recheck`。

## 4. 完整性验证（`verify` 命令语义）

1. `source/` 中原稿的 SHA-256 与 `project.json.source.sha256` 一致（不一致 = 最高级故障，退出码 2）；
2. 目录结构完整（六个子目录存在）；
3. `project.json` 可解析且 `format_version` 受支持；
4. 引用的 `result_file` / 检查点路径存在。
