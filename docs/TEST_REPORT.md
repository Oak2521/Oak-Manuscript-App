# TEST_REPORT — 测试报告

> 最近更新：2026-07-26。只记录真实执行结果；未运行项不得写成通过。

## 1. 最新验证结论：0.1.0-alpha.1 P0

环境：Windows 11；Python 3.14.6；Node 24.16.0；npm 11.13.0；Electron 43.1.0；Java 21.0.11。

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run test:node` | **12/12 PASS** | preload 沙箱契约、固定 IPC、错误传播、完整预览、数量一致、检查点排序、损坏项禁用、UI 结构 |
| `python scripts/run_tests.py` | **210 项，0 失败、0 错误、1 跳过** | 默认跳过需要显式启用的 Ace 慢测；EpubCheck 真实测试运行 |
| `$env:OAK_TEST_ACE='1'; python scripts\run_tests.py` | **210 项，0 失败、0 错误、0 跳过** | Ace 慢测加入同一 210 项，不会额外变成第 211 项 |
| `npm test` | **PASS：Node 12 + Python 210** | 最终统一入口复跑，0 失败、0 错误；默认 Ace 慢测 1 项跳过 |
| `npm run smoke` | **PASS** | 隐藏 Electron 窗口，真实 Renderer → preload → IPC → Python 核心闭环 |

## 2. P0 新增覆盖

### 批量计划与确认

- `plan-fixes` 不写 working、issues、project 或检查点；
- 计划 ID 绑定项目 ID、working SHA-256、完整问题集、规则包名称/版本/内容哈希和完整候选集合；
- 缺失、错误、异项目或过期 `plan_id` 均拒绝；
- UI 声明数量与预览行数不一致时拒绝应用；
- 取消计划后复检数量不变；
- 同一 `fix_id` 中存在 rejected 问题时整类排除，全文 fixer 不会顺带修改已拒绝位置；
- TAB 每个实际位置生成独立 issue；3 个 TAB = 3 个预览项 = 3 次替换；
- SPACE / PUNCT 每个连续命中片段一项，空段按“连续 N 个”整组说明，EPUB lang 每资源一项，MIME 每包一项。

### 事务与检查点

- 格式解析和机械修改先在临时 working 副本完成；
- 注入 working / issues / project 提交失败后，工作稿、问题文件、manifest 和内存状态恢复；
- 已有 5 个检查点时，注入新检查点后的提交失败，被裁剪旧目录会恢复，完整检查点树不变；
- 检查点保存 working、issues、项目状态和被引用的检查结果，并逐文件校验哈希；
- 恢复前建立安全检查点；目标换入后失败或最终 save 失败时，完整项目树逐字节恢复；
- 成功恢复仍最多保留 5 个检查点，并保护目标与安全检查点；
- 缺失、损坏、重复 ID、路径越界或符号链接项在核心拒绝；UI 标为不可恢复并禁止选择；
- `list-checkpoints` 与 `restore-checkpoint` 的 CLI 子进程测试通过。

### 桌面安全契约

- preload 实际在只允许 `require("electron")` 的 VM 沙箱测试中加载；
- Renderer 无直接 `fix()` 通道，只能 `planFixes` → `applyFixPlan(planId)`；
- P0 主进程对项目绝对路径和 opaque ID 做白名单校验；
- CLI `json.ok=false` 或退出码 2 不再被外层包装为成功；退出码 1 的有效检查 JSON 仍兼容；
- Electron 保持 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。

## 3. 真实 UI 冒烟结果

最终通过结果：

```text
DOCX：check 21 → 集中预览/确认 5 → recheck 16
EPUB：check 7 → 集中预览/确认 2 → recheck 5
两类：取消计划零写入 → 确认 → 检查点列表 → 撤销 → 重新计划并应用
两类：导出 5 文件 + PDF 样张 + verify 通过
Provider：未登录、不同步占位纪律通过
SMOKE-RESULT: PASS
```

冒烟运行在 `show: false` 的独立隐藏窗口，不抢占用户当前应用窗口。

### 首次失败与修复记录

第一次 P0 冒烟真实失败：`Cannot read properties of undefined (reading 'listSamples')`。原因是 sandboxed preload 新增了本地 `require("./preload-p0-api")`；Electron 沙箱不允许该引用，导致整个 `window.oak` 未注入。

处理：保持 `sandbox: true` 不变，把四个 P0 方法直接放回 preload 固定白名单；Node 测试改为实际在受限 VM 中加载 preload。随后重跑真实 Electron 冒烟，PASS。

运行环境仍输出 Chromium cache / GPU cache 的“拒绝访问”诊断，但进程退出码为 0，功能、导出和 verify 全部通过。该诊断不等同于产品测试失败；打包版与干净系统测试时仍需复核。

## 4. 外部工具状态

| 工具 | 本轮事实 | 发布包事实 |
|---|---|---|
| EpubCheck 5.3.0 | Java 21 环境下真实测试运行；好样本和基础 EPUB 产物通过，缺陷样本失败 | 旧 0.0.1 包含工具；0.1.x 新包尚未构建 |
| Ace by DAISY 1.4.6 | `OAK_TEST_ACE=1` 时真实运行且无测试跳过 | **未通过打包验收**；旧包不含开发树的 `node_modules/.bin/ace` |

因此当前可以说“开发环境 Ace 接口真实运行”，不能说“0.1.x 发布包已内置并通过 Ace”。

## 5. 尚未运行或尚未通过的发布级测试

- 0.1.0-alpha.1 Windows unpacked / ZIP / NSIS 打包版 smoke：**未运行**；
- Windows 干净系统首次安装、卸载、升级、无 Python/Node 环境运行：**未运行**；
- Windows 代码签名与 SmartScreen 信誉：**未运行**；
- macOS arm64 / x64 构建、签名、公证、Gatekeeper 和实机 smoke：**未运行**；
- Web 服务端并发、隔离、TTL 删除、零留存、限额和账号联调：**未运行**；
- Free/Pro 订阅、支付 webhook、离线宽限和账号删除：**未运行**；
- 标准包签名更新、断网、损坏包、回滚和项目版本固定：**未实现，未运行**；
- 受控作者/编辑人工内测：**未运行**。

## 6. 历史基线纠错

Claude 0.0.1 的现场基线复跑为：

- 默认：185 项，0 失败、0 错误、Ace 1 项跳过；
- `OAK_TEST_ACE=1`：仍是 185 项，0 失败、0 错误、无跳过。

旧报告“185 + Ace = 186 项”把同一条件测试重复相加，属于文档错误，现已废止。旧 0.0.1 打包版 smoke 的历史结果仍为 PASS，但不能替代当前 0.1.x 重新打包验证。
