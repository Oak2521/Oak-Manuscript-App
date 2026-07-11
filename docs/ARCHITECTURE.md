# ARCHITECTURE — 架构与关键技术决策

> 依据方案 §12。本文件记录已冻结的架构决策与当前实现形态，随里程碑更新。

## 1. 总体分层（方案 §12.2）

```text
Renderer（无 Node 权限）        ← 阶段 2
        ↓ IPC 白名单
Electron Main                   ← 阶段 2
  ├─ 窗口与文件选择 / 路径策略 / PDF 样张 / 外部链接白名单 / Provider 适配层
        ↓ shell=false，参数数组，严格 UTF-8 JSON
Python Core（oak_manuscript_core）   ← 阶段 1（当前）
  ├─ 读取器：DOCX（M1）/ Markdown、TXT（M2）/ EPUB（M3）
  ├─ 规则引擎（确定性）与规则包加载
  ├─ 白名单机械修复（幂等）
  ├─ 项目管理：只读原稿、SHA-256、检查点（≤5）
  ├─ 报告（JSON / Markdown / HTML）与修订稿导出
  └─ 完整性与安全验证（路径 / ZIP / 大文件）
```

阶段 1 的 Python 核心即最终 sidecar：CLI 子命令与 JSON 输出的契约设计为 Electron 直接可用，阶段 2 只加壳不改核心。

## 2. 关键决策记录

### AD-001 核心零第三方依赖（2026-07-11，冻结）

`oak_manuscript_core` 只用 Python 标准库。DOCX 解析用 `zipfile` + `xml.etree`（OOXML 命名空间下读段落 / run / 样式 / 脚注），不引入 python-docx；测试用 `unittest`，不引入 pytest。

理由：① 离线、零安装即可运行与测试；② 确定性与供应链风险最小化；③ 免除依赖安装授权流程；④ 打包时 sidecar 体积与复杂度最小。
代价：DOCX 写回（修订稿导出）需自实现受控的 XML 局部改写——可接受，因为修复白名单本就限定在少量机械、可精确定位的操作。
若未来某能力（如 PDF 渲染）确需第三方库，须经用户授权并记录新决策。

### AD-002 CLI 即接口契约（2026-07-11）

核心的每个子命令输出**单个 UTF-8 JSON 文档**到 stdout（人类可读信息走 stderr），退出码 0=成功、1=检查发现 blocked 级问题、2=运行错误。该契约同时服务命令行用户（阶段 1 验收）与 Electron 桥（阶段 2）。参考了 oak-publishing-system `INTERFACE_SPEC.md` 的状态语义与退出码约定（提炼借鉴，未复制内容）。

### AD-003 规则包与代码分离（2026-07-11，冻结）

规则定义（含元数据、严重程度、标准引用、文案）放 `config/rule-packs/`（版本化 JSON），判断逻辑在核心内以 `rule_id` 注册。同一 `rule_id` 的逻辑与定义必须一一对应；规则包带语义化版本，报告记录所用版本。

## 3. Python 核心模块地图（随实现更新）

| 模块 | 职责 |
|---|---|
| `oak_manuscript_core/project.py` | 项目创建 / 打开、project.json 读写、原稿哈希、检查点 |
| `oak_manuscript_core/safety.py` | 路径规范化与逃逸拒绝、ZIP 安全（成员数 / 单文件 / 总解压上限）、大文件预警 |
| `oak_manuscript_core/readers/docx_reader.py` | OOXML 解析 → 统一文档模型 |
| `oak_manuscript_core/model.py` | 文档模型、问题（Issue）、检查结果的数据类 |
| `oak_manuscript_core/rulepack.py` | 规则包加载与校验、「默认」体例映射 |
| `oak_manuscript_core/engine.py` | 规则调度（按稿件类型 / 语言 / 体例启用），确定性保证 |
| `oak_manuscript_core/rules/` | 各规则判断逻辑（每规则独立、可单测） |
| `oak_manuscript_core/fixes.py` | 白名单机械修复（幂等），修复前建检查点 |
| `oak_manuscript_core/reports.py` | JSON / Markdown / HTML 报告渲染 |
| `oak_manuscript_core/exporter.py` | 修订稿 DOCX 导出、导出目录校验 |
| `oak_manuscript_core/__main__.py` | CLI（create / check / fix / recheck / export / verify） |

## 4. 安全基线（方案 §12.3–§12.4 要点）

- 一切文件写入限定在项目目录或用户明确选择的导出目录；导出前验证目标仍在允许范围内；
- ZIP 解包前检查成员数量、单文件大小、总解压大小，拒绝路径穿越与可疑符号链接；
- 失败时不删除原稿；异常退出后项目可恢复；
- Electron 侧安全基线（contextIsolation / sandbox / CSP / IPC 白名单）在阶段 2 落实，本文件届时补充。
