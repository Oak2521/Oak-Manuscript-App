# AGENTS.md — 开发引擎守则（oak-manuscript-app）

> 任何接手本仓库的开发引擎（AI 或人工）在动手前必须读完本文件。
> 阅读顺序：本文件 → `AI_HANDOFF.md` → `docs/DEVELOPMENT_STATUS.md` → 权威方案 → `docs/ACCEPTANCE.md` / `docs/TEST_REPORT.md`。
> 核对实际文件与测试状态，不把旧文档状态当作当前事实。

## 1. 权威需求来源（唯一）

`docs/湖岸稿件_Oak_Manuscript_APP_开发方案_v1.2_Claude_20260711.md`

方案内部冲突时，按方案 §24 第 11 条：**隐私、源稿不可变、用户确认、真实验收**为最高优先级。

## 2. 范围与边界（硬性规则）

- **只在本仓库目录内写入**。仓库外唯一例外：本地「方案存档」文件夹（`D:\Workspace\Oak Manuscript App\方案存档\`）的文档快照同步。
- 两个参考项目**只读**，绝不写入、移动、删除，绝不向其 GitHub 仓库推送：
  - `D:\Workspace\Oak by Lake\oak-publishing-system`
  - `D:\Workspace\Oak by Lake\netlify-site`
- APP 代码**不得直接读取**上述目录作为运行时依赖；复用必须走「审核 → 标准化 → 匿名化 → 版本化规则包」。
- 不把真实稿件、作者隐私、合同资料带入本仓库；测试只用 `samples/` 匿名与构造样本。

## 3. 技术决策（已冻结，第一版期间不变更）

- 桌面壳：Electron；界面 HTML/CSS/JS，第一版不引入重型前端框架（阶段 2 起建设）。
- 检查核心：Python 3.11+，作为 sidecar 以严格 UTF-8 JSON 与 Electron 通信。
- **核心零第三方依赖**：`python/oak_manuscript_core` 只使用 Python 标准库（zipfile、xml.etree、hashlib、json 等）。
  理由：离线可运行、确定性、免除依赖安装授权、降低供应链风险。DOCX 解析用 stdlib 实现，不引入 python-docx。
  引入任何第三方依赖（含 pip、npm 运行时依赖）须先取得用户授权。
- 测试：Python 侧用 stdlib `unittest`；统一测试入口 `python scripts/run_tests.py`（必须一条命令可重复通过）。

## 4. 开发纪律（方案 §24 摘录 + 本仓库约定）

1. **永不原地修改用户原稿**；原稿 SHA-256 在一切操作前后不变。
2. 只有白名单机械问题可自动修复；不扩大白名单，除非有规则定义、反例和幂等测试。
3. 未实际运行外部工具（EpubCheck、Ace）时不得声称「通过」。
4. 规则确定性优先：同一输入 + 同一规则版本 = 相同结果；自动修复必须幂等。
5. 先写测试再写实现（TDD）；每次修改后运行统一测试入口。
6. 需要联网、安装依赖、发布、签名、推送远端或连接网站时，先取得用户授权。
7. 每个阶段完成后更新 `docs/DEVELOPMENT_STATUS.md`、`docs/TEST_REPORT.md`、`CHANGELOG.md` 与 `AI_HANDOFF.md`。
8. 交付说明必须包含：完成内容、修改文件、关键决策、测试结果、后续事项。

## 5. 仓库结构（方案 §19）

```text
electron/    # 阶段 2：Electron 主进程、preload、python-bridge、路径策略、providers
renderer/    # 阶段 2：界面
python/      # 检查核心（oak_manuscript_core）与其测试（tests/）
config/      # app-config.json、standards.json、rule-packs/（版本化规则包）
scripts/     # 构建、测试、样本生成脚本
samples/     # 匿名样本库（唯一允许的测试语料）
tests/       # 跨端集成 / 端到端测试（阶段 2 起）
docs/        # 权威方案、规格冻结文档、状态与验收文档
out/         # 构建中间产物（不入库）
release/     # 发布产物（不入库）
```

## 6. 里程碑与当前阶段

见 `docs/DEVELOPMENT_STATUS.md`（唯一的当前状态来源）。阶段划分：阶段 0（基线冻结）→ 阶段 1（M1 DOCX+论文+GB/T 7714 命令行闭环 → M2 → M3）→ 阶段 2（桌面 UI）→ 阶段 3（打包内测）→ 阶段 4（网站对接）→ 阶段 5（发布）。
