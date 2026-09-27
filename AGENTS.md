# AGENTS.md — 开发引擎守则（oak-manuscript-app）

> 任何接手本仓库的开发引擎（AI 或人工）在动手前必须读完本文件。
> 阅读顺序：本文件 → `AI_HANDOFF.md` → `docs/DEVELOPMENT_STATUS.md` → 权威方案 → `docs/ACCEPTANCE.md` / `docs/TEST_REPORT.md`。
> 核对实际文件与测试状态，不把旧文档状态当作当前事实。

## 1. 权威需求来源（唯一）

`docs/湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md`

`docs/湖岸稿件_Oak_Manuscript_APP_开发方案_v1.2_Claude_20260711.md` 仅保留为 Claude `0.0.1` 的历史基线；与商业方案冲突时以 v2.0 为准。方案内部冲突时，始终以**隐私、源稿不可变、用户确认、检查可追溯、真实验收**为最高优先级。

## 2. 范围与边界（硬性规则）

- **只在本仓库目录内写入**。不得在仓库外创建或同步方案快照、构建产物或测试产物。
- 两个参考项目**只读**，绝不写入、移动、删除，绝不向其 GitHub 仓库推送：
  - `D:\Workspace\Oak by Lake\oak-publishing-system`
  - `D:\Workspace\Oak by Lake\netlify-site`
- APP 代码**不得直接读取**上述目录作为运行时依赖；复用必须走「审核 → 标准化 → 匿名化 → 版本化规则包」。
- 不把真实稿件、作者隐私、合同资料带入本仓库；测试只用 `samples/` 匿名与构造样本。

## 3. 技术决策（已冻结，第一版期间不变更）

- 当前桌面壳：Electron；界面为 HTML/CSS/JS。商业方案中的共享 TypeScript/Vite 前端仍待实施，不得把计划写成现状。
- 检查核心：Python 3.11+，作为 sidecar 以严格 UTF-8 JSON 与 Electron 通信。
- **核心零第三方依赖**：`python/oak_manuscript_core` 只使用 Python 标准库（zipfile、xml.etree、hashlib、json 等）。
  理由：离线可运行、确定性、免除依赖安装授权、降低供应链风险。DOCX 解析用 stdlib 实现，不引入 python-docx。
  引入任何第三方依赖（含 pip、npm 运行时依赖）须先取得用户授权。
- 测试：Python 侧用 stdlib `unittest`，Node 侧用内置 `node:test`；统一测试入口为 `npm test`（依次运行 Node 与 Python）。分项排障可用 `npm run test:node`、`npm run test:python`。
- Git checkout：所有受 Git 识别的文本必须以 LF 写入工作树；字节锁、canonical JSON/SQL 与资源信任不得依赖开发者的 `core.autocrlf` 配置。

## 4. 开发纪律（商业方案冻结原则 + 本仓库约定）

1. **永不原地修改用户原稿**；原稿 SHA-256 在一切操作前后不变。
2. 只有白名单机械问题可自动修复；不扩大白名单，除非有规则定义、反例和幂等测试。
3. 未实际运行外部工具（EpubCheck、Ace）时不得声称「通过」。
4. 规则确定性优先：同一输入 + 同一规则版本 = 相同结果；自动修复必须幂等。
5. 行为变更先写测试再写实现（TDD），按风险运行相关检查；纯文档/协作配置改动运行差异、引用和相关配置验证，不重复无关全量测试。功能批次交付按验收要求运行统一入口，跳过项及未运行项必须明确记录。
6. 需要联网、安装依赖、发布、签名、推送远端或连接网站时，先取得用户授权。
7. 每个阶段完成后更新 `docs/DEVELOPMENT_STATUS.md`、`docs/TEST_REPORT.md`、`CHANGELOG.md` 与 `AI_HANDOFF.md`。
8. 交付说明必须包含：完成内容、修改文件、关键决策、测试结果、后续事项。

## 5. 仓库结构

```text
electron/    # Electron 主进程、preload、Python bridge、路径策略、Provider 与桌面冒烟
renderer/    # 当前桌面界面与可独立测试的 UI 数据边界
python/      # 检查核心（oak_manuscript_core）与其测试（tests/）
config/      # app-config.json、standards.json、rule-packs/（版本化规则包）
scripts/     # 构建、测试、样本生成脚本
samples/     # 匿名样本库（唯一允许的测试语料）
tests/       # Node IPC 契约、UI 数据与结构测试
docs/        # 权威方案、规格冻结文档、状态与验收文档
out/         # 构建中间产物（不入库）
release/     # 发布产物（不入库）
```

## 6. 里程碑与当前阶段

本节下方为历史快照，不作为实时状态。当前分支的版本读取 `package.json`，阶段与验证读取 `AI_HANDOFF.md`、`docs/DEVELOPMENT_STATUS.md`、`docs/TEST_REPORT.md`。2026-09-27 协作准备基于 GitHub 已合并的 alpha.63；本地 alpha.64/R2 候选未随本批上传或接受。

### 历史：alpha.59 阶段记录

当前开发版本为 `0.1.0-alpha.59`。alpha.59 固定全仓库文本 LF checkout，消除 Windows `core.autocrlf=true` 对 canonical JSON/SQL、迁移清单和资源信任锁的字节漂移；P0、离线标准可信链、标准来源/复核治理摘要、受控标准在线升级/撤回链、统一账号/SyncRecord、签名权益、订阅/设备服务、三类 compatible 只读 AI 建议，以及用户确认后即时同步的本地生产形状链已经实现。Web 临时作业已有 exact 生产组合、迁移字节门禁及平台无关部署准入契约。准入 profile 只能证明声明能力满足，不能证明官方限制或真实环境，readiness 仍固定生产未就绪。账号、权益与标准联网配置仍为 `pending_configuration`；真实迁移、OS 禁网、零留存、生产密钥、支付商 webhook、发布源、API/网站部署和官方云 AI 均未完成或未验证。最新真实 Windows 制品仍为未签名 alpha.58；macOS、真实安装生命周期、代码签名、公证、来源/许可人工签署和 OS 级隔离仍是门禁。普通 build/test 永不联网；任何重新下载仍须用户明确批准。

## 7. GitHub 与多 AI 协作（共同规则唯一正文）

- 权威仓库为 https://github.com/Oak2521/Oak-Manuscript-App 。代码、可共享规格、Issue、PR 与验收证据以该仓库中已审阅记录为准；聊天、工具记忆与本地未提交修改不能自动成为已接受成果。私有原件只保留受控指针，不因权威入口迁移而公开。
- 每项任务使用独立分支及独立 clone/worktree，记录任务范围、基线 SHA、接口/schema 和文件所有权。不要两个 AI 同时写同一文件；共享接口、根依赖/锁文件、规则包与资源信任各指定单一负责人。发现重叠先协调，不覆盖或回退他人修改。
- 启动时按页首顺序主动读取共同规则和最新交接，核对真实仓库根、远端、分支、HEAD、工作树、Issue/PR。读不到资料或发现本地/云端分叉时明确停在相关边界，不从旧 checkout 复制“最新成果”。
- `main` 只接收经过适用验收的成果。修改通过 PR 交付；绿灯不等于合并批准。未经适用批准不自动 merge、release、签名、部署；禁止 force push、改写历史和擅自改保护设置。当前保护没有强制人工批准数量，人工审批规则仍有效。
- GitHub Issue/PR 必须能独立表达任务范围、基线与文件归属。阶段结束在 PR 留下分支、commit、改动、实际验证命令/环境/结果、未验证项、风险、遗留问题与下一步；交接文档链接该 PR。失败、取消、跳过与未运行不能写成通过。
- 提交前审阅明确文件清单及将推送的历史；不用 `git add -A` 吞入旧成果。禁止凭据、私钥、`.env` 实值、客户稿件、真实数据库、合同、私人对话、工具会话/记忆、依赖缓存或可再生制品入库。`.gitignore` 不会移除已提交秘密；发现真实秘密停止相关推送，报告位置但不展示值，由用户决定撤销/轮换及历史处置。
- 大型/受限原始资料保留原处，只记录最小位置和访问条件；读取授权不是上传授权。使用合成样本，云端不复制个人配置或本地数据根。
- `AGENTS.md` 是共同规则唯一正文；`CLAUDE.md` 等工具入口只指向本文件。工具是否自动加载、能否写回由实际版本、工作区信任、登录、仓库授权和沙箱决定，必须验证；不得运行 init 覆盖已有规则，或假设其他 AI 自动收到消息。
- 工作副本内使用相对路径和现有锁文件/脚本；操作仅限分配目录。受控资源、系统 SDK、实际设备、真实账号/数据、费用、签名与生产等审批不因源码协作准备解除。
- 重大架构、新网络能力、新依赖或隐私/源稿保证的改变先建 Issue 并取得适用批准。新增规则必须有稳定 ID、来源证据、正反例、格式覆盖及误报/中英混合测试，来源未核验时保留真实治理状态；修复仍需幂等、源稿哈希不变和集中预览确认。
- 漏洞按 SECURITY.md 私密报告，修复前不公开敏感复现细节；不在缺少威胁分析和负向测试时削弱 Electron/IPC/路径/归档/签名/同意边界。适用时同步中文界面和英文使用说明。
