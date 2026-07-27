# 湖岸稿件（Oak Manuscript）

本地优先的稿件检查与修订产品。当前开发版本为 `0.1.0-alpha.2`，已有 Electron 桌面端、Python 检查核心，以及 Windows alpha 所需的本地运行资源与发布前门禁；商业正式版目标为 Windows、macOS 与 Web。按论文、纸质出版物、电子书三类目标检查稿件，提供可追溯标准依据的问题解释、集中确认的白名单机械订正、检查点恢复、修订稿与检查报告导出。

**当前桌面核心承诺**：稿件默认只在本机处理；永不原地修改原稿（SHA-256 全程校验）；不强制注册；报告与导出不设营销门槛。

`0.1.0-alpha.2` 的**源码检查点标签**为 `chatgpt-v0.1.0-alpha.2`；该标签只标记源码与本地验证状态，不代表二进制发行。本轮仍没有 alpha.2 Windows 安装包或 ZIP。Windows 离线构建工具链、代码签名，macOS x64/arm64 运行资源、构建、签名、公证和实机 smoke，以及 Web、湖岸统一账号、订阅、同步与标准自动升级仍按商业方案开发，尚未完成正式验收。

最新安全收口后的原生/沙箱外 `npm test` 统一入口为 PASS：Node TAP 共 `99` 项，`96` 通过、`0` 失败、`3` 项 Windows symlink/junction 权限条件跳过；Python 默认共 `270` 项，`0` 失败、`0` 错误、`3` 项条件跳过。沙箱外隐藏 Chrome 的真实 Ace 套件为 `270` 项、`0` 失败、`0` 错误、`1` 项条件跳过；隐藏 Electron 源码 smoke 为 PASS，输出严格位于 `out/source-smoke/projects/`。Windows alpha 资源门禁已实际执行运行时探针并通过；提升权限 `build:win` 完成本地 JRE/Ace staging 和资源探针后，仅因缺少 `tools/electron-builder/win32-x64` 停止，未生成安装包或 ZIP。正式售卖门禁仍有 18 项明确阻断。macOS 跨主机静态门禁可执行但因 x64/arm64 Electron dist、Python runtime 锁和 JRE 资源缺失而按预期失败，不能据此声称可构建或已发行。详见 `docs/TEST_REPORT.md`。

当前桌面安全边界包括：默认 Electron session 离线与固定 CSP；PDF 使用禁 JavaScript/导航/网络的非持久隔离 session；项目 schema/路径完整校验与跨进程内核写锁；创建项目在锁内以单一输入文件描述符复制到 `source`，再生成 `working`，并兼容最终目标为常规文件的只读 OneDrive/reparse 输入；自选导出目录逐级验证、全部目标预检和逐文件原子换入。源码 smoke 的所有临时状态限定在仓库 `out/source-smoke/`。

## 快速开始

开发要求：Node.js、Python 3.11+；Python 核心零第三方依赖。

```bash
# 安装桌面开发依赖并启动
npm install
npm start

# 统一测试入口：Node + Python
npm test

# 分项排障
npm run test:node
npm run test:python
```

批量修复必须先运行只读 `plan-fixes`，在界面集中查看全部修改并一次确认，再携带 `plan_id` 执行 `fix`。完整桌面与命令行流程见 `docs/USER_GUIDE.md`。

## 文档导航

| 文档 | 内容 |
|---|---|
| `docs/湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md` | **商业正式版权威需求方案（唯一）** |
| `docs/湖岸稿件_Oak_Manuscript_APP_开发方案_v1.2_Claude_20260711.md` | Claude `0.0.1` 历史基线（非当前权威） |
| `AGENTS.md` | 开发引擎守则（接手必读） |
| `AI_HANDOFF.md` | 项目交接说明 |
| `docs/DEVELOPMENT_STATUS.md` | 当前开发状态（唯一状态来源） |
| `docs/ARCHITECTURE.md` | 架构与关键技术决策 |
| `docs/ACCEPTANCE.md` | 验收标准 |
| `docs/TEST_REPORT.md` | 测试报告 |
| `docs/PRIVACY_AND_SECURITY.md` | 隐私与安全基线 |
| `docs/WEBSITE_INTEGRATION.md` | 网站对接（Provider 接口）与占位状态 |

## 仓库结构

见 `AGENTS.md` 第 5 节。
