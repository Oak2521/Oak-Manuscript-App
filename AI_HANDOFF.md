# AI_HANDOFF — 湖岸稿件（Oak Manuscript）项目交接说明

> 最近更新：2026-07-26
> 当前开发方：ChatGPT Codex
> 当前版本：`0.1.0-alpha.1`
> 当前分支：`chatgpt/commercial-v1`

## 1. 权威入口与工作区

商业正式版的唯一需求权威是：

`docs/湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md`

Claude v1.2 方案和 0.0.1 实现是历史基线，不再覆盖 v2.0 的商业化、跨端、账号、同步和标准升级决策。

当前独立开发克隆：

`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`

只读完整基线：

`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\baseline\claude-0.0.1-full`

基线来源说明及哈希：

`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\BASELINE_PROVENANCE.md`

源 Claude 仓库、`oak-publishing-system`、`netlify-site` 和商业计划书目录均只读。所有开发、测试和构建产物只能留在当前克隆目录。

## 2. 当前现场事实

### 已完成：0.1.0-alpha.1 P0 可信批量修复闭环

- `plan-fixes` 严格只读，返回绑定项目、工作稿哈希、问题状态和规则包的确定性 `plan_id`；
- UI 在一个可滚动界面集中列出本批全部修改前/修改后预览，取消或 Esc 不写入；
- `fix` 强制要求已确认的 `plan_id`，旧计划、异项目计划和不完整确认集合均拒绝；
- TAB 等离散修改逐位置生成问题和预览；任一同类问题被拒绝时，整类全文 fixer 从计划排除，避免顺带修改未展示内容；
- 修复先在临时工作副本执行，正常异常路径不留下部分 working / issues / project 写入；
- 达到 5 个检查点时，批量修复提交失败会恢复被裁剪的旧检查点；
- 检查点保存 working、issues、项目状态和检查结果快照，可列表、恢复并在恢复前创建安全检查点；
- 检查点恢复在文件换入或最终保存失败时恢复完整项目树；损坏或不可恢复项在 UI 中禁用；
- Electron preload 保持 `sandbox: true`，没有直接修复 IPC，只有计划、确认应用、列表和恢复四个固定 P0 通道；
- APP / Python 核心 / package 版本统一为 `0.1.0-alpha.1`；Node 与 Python 已统一到 `npm test`。

### 现场验证（2026-07-26）

- `npm test`：Node 12 项 + Python 210 项，0 失败、0 错误；默认仅 Ace 环境慢测 1 项跳过；
- `OAK_TEST_ACE=1`：Python 仍为 210 项，0 失败、0 错误、无跳过；旧文档的“185 + Ace = 186”已确认错误；
- `npm run smoke`：隐藏 Electron 窗口真实执行 DOCX 21→5 项批量修复→16，EPUB 7→2→5；两类均覆盖取消、集中确认、撤销、重新应用、导出、PDF 和原稿完整性验证，PASS；
- 首次 P0 冒烟暴露 sandbox preload 本地模块引用错误，修复后已复跑通过；不是把失败记录删除后直接宣称成功。

完整证据见 `docs/TEST_REPORT.md`。

## 3. 已确认、不得反复重开讨论的产品决策

1. 最终目标是可售卖订阅的正式版，不把当前 alpha 或旧 0.0.1 便携包包装成正式版；
2. Windows 安装版、macOS 安装版和嵌入湖岸官网的 Web 版共用确定性检查契约；
3. Web 版采用服务端统一处理；生产实现必须有临时任务、加密、TTL、删除和零留存验证；
4. 三端统一使用湖岸橡树官网账号；访客仍可使用基础本地功能；
5. 订阅为有限 Free + Pro，具体价格尚未拍板；
6. 同步只允许检查结果和必要元数据，不同步稿件、正文、摘录、文件名、路径或哈希；登录用户必须明确选择是否同步；
7. 引用体例保留“默认”，由确定性映射自动选择，并在报告中说明；
8. 标准文件需要签名清单、下载校验、版本固定、回滚和升级提示；已有项目不得被静默换规则；
9. “接入用户自己的 AI”只完成了讨论，用户尚未批准写入方案，当前不得实现或擅自扩展范围；
10. 不进行 AI 语义改写，自动修复仍只限冻结白名单机械操作。

## 4. 已核实但尚未解决的缺口

- 打包版 Ace：0.0.1 开发树可从 `node_modules/.bin` 发现 Ace，但发布包不含该路径；旧发布包不能据此声称内置 Ace 可用；
- Windows：当前只有旧 0.0.1 便携 ZIP 的历史构建，0.1.0-alpha.1 尚未完成新安装器、干净系统验证和签名；
- macOS：尚无 arm64/x64 安装产物、签名、公证和实机证据；Windows 内置 Python 不能直接用于 macOS；
- Web：服务端任务 API、隔离执行、限额、零留存和官网嵌入尚未实现；
- 账号/订阅/同步：UI 入口和 Provider 仍是离线占位，未连接生产 Supabase、支付或网站后台；
- 标准库：现有 13 条注册表、35 条规则只是最小集合，存在占位说明、来源缺口和 APA/Chicago 覆盖过薄，详见 `docs/STANDARDS_GAP_AUDIT_20260726.md`；
- 标准升级：签名 manifest、更新器、项目版本固定和回滚尚未编码；
- 正式发布仍缺隐私/条款最终文本、证书、生产密钥、人工内测、macOS 硬件和网站联调。

## 5. 下一执行顺序

不要重新做宽泛规划，按 v2.0 方案继续：

1. 修复并验证打包版 Ace，去除“开发树可用、发布包缺失”的差异；
2. 生成并验证 0.1.x Windows NSIS 安装器与便携包，做打包版 smoke、哈希和资源清单；
3. 实现标准包签名 manifest、本地更新、项目固定版本和回滚；
4. 按标准缺口审计补来源与规则，新增规则必须有反例、样本和回归测试；
5. 建立 macOS 构建配置与 CI，最终在真实 macOS 做签名、公证和 smoke；
6. 实现 Auth / License / Sync 的离线契约和生产适配边界，再经授权连接网站；
7. 实现服务端统一处理的 Web 作业 API、零留存和官网嵌入；
8. 完成 Free/Pro 配额、支付、隐私、内测、遥测边界和正式发布门禁。

涉及联网、依赖下载、生产账号、证书、签名、发布、远端推送或网站写入时，必须先向用户取得明确授权。

## 6. 常用验证命令

```powershell
npm test
npm run test:node
npm run test:python
$env:OAK_TEST_ACE='1'; python scripts\run_tests.py
npm run smoke
git diff --check
```

CLI 的 P0 新契约：

```powershell
python -m oak_manuscript_core plan-fixes --project <项目目录>
python -m oak_manuscript_core fix --project <项目目录> --plan-id <计划ID>
python -m oak_manuscript_core list-checkpoints --project <项目目录>
python -m oak_manuscript_core restore-checkpoint --project <项目目录> --checkpoint-id <检查点ID>
```

## 7. 交接纪律

- 动手前读 `AGENTS.md`、本文件、`docs/DEVELOPMENT_STATUS.md`、v2.0 方案、`docs/ACCEPTANCE.md` 和 `docs/TEST_REPORT.md`；
- 以实际文件和现场测试为准，历史文档只作追溯；
- 不修改真实原稿，不把真实作者内容放进仓库；
- 功能、测试、构建或分发状态变化后，同步更新交接、状态、测试、验收和变更记录；
- 不把计划项写成已完成事实，不把开发机成功等同于干净系统、macOS 或正式发布成功。
