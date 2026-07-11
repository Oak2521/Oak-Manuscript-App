# SPEC_MODELS — 问题 / 规则 / 标准模型（v1.0，冻结）

> 冻结日期：2026-07-11（阶段 0）。依据方案 §6.3、§9.1 第三层、§10.3。机器可读定义以 `config/` 下 JSON 为准，本文件为语义规范。

## 1. 问题模型（Issue，方案 §6.3）

```json
{
  "issue_id": "check-0001-0042（检查号-序号，确定性生成）",
  "rule_id": "DOCX-SPACE-001",
  "profile": "paper | print_book | ebook",
  "severity": "error | warning | suggestion",
  "title": "连续空格",
  "explanation": "为什么需要处理（来自规则包，面向作者的语言）",
  "location": { "part": "document | footnotes | endnotes", "paragraph": 23, "note_id": null },
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
- **issue_id 确定性**：同一输入 + 同一规则包版本，两次检查产生的问题集合与顺序完全一致（引擎按 part → paragraph → rule_id 排序）。
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

## 4. 标准模型（Standard，`config/standards.json` 条目，方案 §10.3）

```json
{
  "standard_id": "GBT-7714-2025",
  "title": "信息与文献 参考文献著录规则（GB/T 7714—2025）",
  "source_type": "official | oak_interpretation | technical_spec",
  "official_source_url": "https://…（官方来源，可为空）",
  "oak_resource_slug": "citation/gbt-7714-2025",
  "version": "2025",
  "updated_at": "2026-07-11",
  "scope": "适用范围一句话",
  "summary": "APP 内简明解释（分层呈现：官方标准 ≠ 湖岸解释 ≠ 工具规则）"
}
```

- `oak_resource_slug` 是网站资源页的稳定标识；网站目录调整用重定向兼容，规则包不因此升级；
- 每条 Issue 的 `standard_refs` 必须指向本注册表中存在的 `standard_id`（引擎启动时校验）。

## 5. 「默认」引用体例映射（v1.0.0，随规则包发布，方案 §6.2）

| 稿件类型 | 语言（解析后） | 自动选定体例 |
|---|---|---|
| paper | zh / mixed | gbt7714-2025 |
| paper | en | apa-7 |
| print_book | 任意 | chicago-18-nb |
| ebook | 任意 | none（用户可显式开启） |

**语言自动识别（确定性算法，冻结）**：统计正文 CJK 字符数 `c` 与 ASCII 字母数 `a`。`c ≥ 4a` → zh；`a ≥ 4c` → en；否则 mixed。若 `c + a < 200`（文本过短，置信度不足）→ 按 mixed 处理。
解析结果与映射版本写入 `project.json` 与全部报告（「本次按 ×× 体例检查，由默认规则 v1.0.0 选定」）。

## 6. 检查结果文件（reports/check-NNNN.json）

```json
{
  "schema_version": "1.0",
  "check_id": "check-0001",
  "kind": "check | recheck",
  "started_at": "…", "finished_at": "…",
  "app_version": "0.0.1",
  "rulepack": { "name": "oak-rules", "version": "1.0.0" },
  "settings_snapshot": { "…": "创建检查时 project.settings 的完整快照" },
  "citation_note": "本次按 gbt7714-2025 体例检查（由默认规则 v1.0.0 选定）",
  "issues": [ "Issue 对象数组，见第 1 节" ],
  "skipped_rule_groups": [ { "milestone": "M2", "reason": "本版本未实现" } ],
  "external_tools": { "epubcheck": "not_run", "ace": "not_run" },
  "disclaimer": "检查仅代表技术与规范准备程度……"
}
```

## 7. 同步负载 schema（v1.0，冻结占位，方案 §8.5）

三级分级；第一版 SyncProvider 不联网，schema 冻结仅为保证阶段 4 后接不改格式：

- **一级 summary**：project_display_name（用户可改）、manuscript_type、language、字数区间、checked_at、rulepack_version、citation_style_resolved、issue_counts、处理状态计数；
- **二级 report**：一级 + 完整 Issue 数组（preview 保持截断脱敏）；
- **三级 file**：稿件文件本体，**每次单独明确确认**，负载记录 filename、size、purpose。

任何级别不含本地路径。未登录状态：不生成、不询问、不发送。
