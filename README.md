# 湖岸稿件（Oak Manuscript）

本地优先的稿件检查与修订桌面应用（Windows / macOS）。按论文、纸质出版物、电子书三类目标检查稿件，提供可追溯标准依据的问题解释、白名单机械订正、修订稿与检查报告导出。

**核心承诺**：稿件默认只在本机处理；永不原地修改原稿（SHA-256 全程校验）；不强制注册；报告与导出不设营销门槛。

## 快速开始（阶段 1：命令行核心）

要求：Python 3.11+（核心零第三方依赖，无需 pip install）。

```bash
# 运行全部测试（统一入口）
python scripts/run_tests.py

# 命令行闭环（详见 docs/USER_GUIDE.md）
python -m oak_manuscript_core --help
```

## 文档导航

| 文档 | 内容 |
|---|---|
| `docs/湖岸稿件_Oak_Manuscript_APP_开发方案_v1.2_Claude_20260711.md` | **权威需求方案（唯一）** |
| `AGENTS.md` | 开发引擎守则（接手必读） |
| `AI_HANDOFF.md` | 项目交接说明 |
| `docs/DEVELOPMENT_STATUS.md` | 当前开发状态（唯一状态来源） |
| `docs/ARCHITECTURE.md` | 架构与关键技术决策 |
| `docs/ACCEPTANCE.md` | 验收标准 |
| `docs/TEST_REPORT.md` | 测试报告 |
| `docs/PRIVACY_AND_SECURITY.md` | 隐私与安全基线 |
| `docs/WEBSITE_INTEGRATION.md` | 网站对接（Provider 接口）与占位状态 |

## 仓库结构

见 `AGENTS.md` 第 5 节（依方案 §19）。
