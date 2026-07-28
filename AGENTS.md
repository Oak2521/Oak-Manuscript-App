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

## 4. 开发纪律（商业方案冻结原则 + 本仓库约定）

1. **永不原地修改用户原稿**；原稿 SHA-256 在一切操作前后不变。
2. 只有白名单机械问题可自动修复；不扩大白名单，除非有规则定义、反例和幂等测试。
3. 未实际运行外部工具（EpubCheck、Ace）时不得声称「通过」。
4. 规则确定性优先：同一输入 + 同一规则版本 = 相同结果；自动修复必须幂等。
5. 先写测试再写实现（TDD）；每次修改后运行统一测试入口。
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

当前开发版本为 `0.1.0-alpha.7`。P0 已完成可信批量修复、确定性默认引用解析、标准包本地验证/项目固定/显式升级、Windows alpha 运行资源与 Electron 全树锁。Windows builder 已有受控归档下载器和安全导入器；下载必须由用户先批准并显式运行 `npm run download:builder:win`，普通 build/test 永不联网或自动导入。Windows 构建必须先清除旧发布证据，并且只有 packaged 资源门禁与隐藏 smoke 成功后才可生成当前版本 `SHA256SUMS.txt` 和 canonical release manifest；证据文件不等于制品已生成。当前仍未取得三份真实归档，也没有真实工具树、独立 tracked lock、NSIS 或 ZIP。具体事实必须以代码、`npm test` 和 `docs/DEVELOPMENT_STATUS.md` 交叉核对。标准包在线更新与生产信任根、Windows 正式签名、macOS 可安装版本、Web、统一账号、订阅和结果同步仍未完成，未经真实验收不得写成已完成。
