# ARCHITECTURE — 架构与关键技术决策

> 当前权威：`湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md`。v1.2 Claude 方案仅为 `0.0.1` 历史基线。本文件记录 `0.1.0-alpha.1` 已实现架构；Windows 正式安装器、macOS、Web、统一账号、订阅、同步与标准自动升级仍待实现和验收。

## 1. 总体分层

```text
Renderer（无 Node 权限）
        ↓ IPC 白名单
Electron Main
  ├─ 窗口与文件选择 / 路径策略 / PDF 样张 / 外部链接白名单 / Provider 适配层
  ├─ P0 修复：planFixes / applyFixPlan（必须带 plan_id）
  └─ 检查点：listCheckpoints / restoreCheckpoint
        ↓ shell=false，参数数组，严格 UTF-8 JSON
Python Core（oak_manuscript_core）
  ├─ 读取器：DOCX（M1）/ Markdown、TXT（M2）/ EPUB（M3）
  ├─ 规则引擎（确定性）与规则包加载
  ├─ plan-fixes 只读计划 → plan_id 确认 → fix 原子批量修复
  ├─ 项目管理：只读原稿、SHA-256、完整状态检查点（≤5）与安全恢复
  ├─ 报告（JSON / Markdown / HTML）与修订稿导出
  └─ 完整性与安全验证（路径 / ZIP / 大文件）
```

Python 核心作为桌面 sidecar；CLI 子命令与 JSON 输出由 Electron 直接复用。商业方案中的共享三端前端和 Web 服务端执行环境尚未实现，不能从当前桌面分层推断为已完成。

## 2. 关键决策记录

### AD-001 核心零第三方依赖（2026-07-11，冻结）

`oak_manuscript_core` 只用 Python 标准库。DOCX 解析用 `zipfile` + `xml.etree`（OOXML 命名空间下读段落 / run / 样式 / 脚注），不引入 python-docx；测试用 `unittest`，不引入 pytest。

理由：① 离线、零安装即可运行与测试；② 确定性与供应链风险最小化；③ 免除依赖安装授权流程；④ 打包时 sidecar 体积与复杂度最小。
代价：DOCX 写回（修订稿导出）需自实现受控的 XML 局部改写——可接受，因为修复白名单本就限定在少量机械、可精确定位的操作。
若未来某能力（如 PDF 渲染）确需第三方库，须经用户授权并记录新决策。

### AD-002 CLI 即接口契约（2026-07-11）

核心的每个子命令输出**单个 UTF-8 JSON 文档**到 stdout（人类可读信息走 stderr），退出码 0=成功、1=检查发现未处理的“必须处理”问题但 JSON 仍有效、2=运行错误。Electron 桥保留退出码 1 的有效结果；`json.ok=false` 或错误退出码不得被外层重新包装为成功。该契约同时服务命令行用户与 Electron。

### AD-003 规则包与代码分离（2026-07-11，冻结）

规则定义（含元数据、严重程度、标准引用、文案）放 `config/rule-packs/`（版本化 JSON），判断逻辑在核心内以 `rule_id` 注册。同一 `rule_id` 的逻辑与定义必须一一对应；规则包带语义化版本，报告记录所用版本。

### AD-004 批量修复必须“计划—确认—事务执行”（2026-07-26，冻结）

`plan-fixes` 严格只读，返回完整候选及 `plan_id`。计划 ID 绑定项目、working SHA-256、问题集、规则包内容和全部候选；界面逐项显示标题、位置、修改前/后预览，只提供一个整批确认写入动作。`fix` 强制接收已确认的 `--plan-id`，任何绑定内容变化都会使旧计划失效。

修复先在临时 working 副本执行并复验计划，再建立 `before_fix` 完整状态检查点；working、issues 和 project 清单通过暂存文件换入。失败路径恢复原字节、移除本次检查点并还原可能被裁剪的旧检查点，不允许留下部分 working 修改。

检查点除工作稿与问题列表外，还快照设置、规则包、检查历史、问题指针、修复历史及所引用的检查结果。恢复前创建 `before_restore:<目标 ID>` 安全检查点；目标损坏、哈希不符或路径越界时，在写入前拒绝。恢复结果本身可通过安全检查点撤销。

## 3. Python 核心模块地图（随实现更新）

| 模块 | 职责 |
|---|---|
| `oak_manuscript_core/project.py` | 项目创建 / 打开、project.json、原稿哈希、完整状态检查点列表与安全恢复 |
| `oak_manuscript_core/safety.py` | 路径规范化与逃逸拒绝、ZIP 安全（成员数 / 单文件 / 总解压上限）、大文件预警 |
| `oak_manuscript_core/readers/docx_reader.py` | OOXML 解析 → 统一文档模型 |
| `oak_manuscript_core/readers/md_reader.py` | （M2）Markdown ATX 标题 + 分段解析 |
| `oak_manuscript_core/readers/txt_reader.py` | （M2）纯文本空行分段 |
| `oak_manuscript_core/readers/epub_reader.py` | （M3）EPUB 容器 / OPF / nav / 内容文档结构解析 |
| `oak_manuscript_core/epub_writer.py` | （M3）基础 EPUB 导出（自检零问题） |
| `oak_manuscript_core/model.py` | 文档模型、问题（Issue）、检查结果的数据类 |
| `oak_manuscript_core/rulepack.py` | 规则包加载与校验、「默认」体例映射 |
| `oak_manuscript_core/engine.py` | 规则调度（按稿件类型 / 语言 / 体例启用），确定性保证 |
| `oak_manuscript_core/rules/` | 各规则判断逻辑（每规则独立、可单测） |
| `oak_manuscript_core/fixes.py` | 白名单机械修复原语（幂等） |
| `oak_manuscript_core/fix_plans.py` | 生成绑定项目 / working / issues / 规则包 / 候选的只读批量计划 |
| `oak_manuscript_core/ops.py` | 检查编排、计划验证、批量修复事务与回滚 |
| `oak_manuscript_core/reports.py` | JSON / Markdown / HTML 报告渲染 |
| `oak_manuscript_core/exporter.py` | 修订稿 DOCX 导出、导出目录校验 |
| `oak_manuscript_core/__main__.py` | CLI（含 plan-fixes / fix --plan-id / list-checkpoints / restore-checkpoint） |

## 4. 安全基线

- 一切文件写入限定在项目目录或用户明确选择的导出目录；导出前验证目标仍在允许范围内；
- ZIP 解包前检查成员数量、单文件大小、总解压大小，拒绝路径穿越与可疑符号链接；
- 批量修复失败不得留下部分 working、问题状态或项目清单写入；恢复失败优先用安全检查点回滚；
- Electron 已启用 `contextIsolation`、sandbox、`nodeIntegration=false`、CSP 与固定 IPC 白名单；项目 IPC 只接受绝对且包含 `project.json` 的项目路径，计划 ID / 检查点 ID 通过格式校验；
- 统一测试入口为 `npm test`（Node 契约与 UI 结构测试 + Python 核心测试）；分项为 `npm run test:node`、`npm run test:python`。
