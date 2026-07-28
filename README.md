# 湖岸稿件（Oak Manuscript）

本地优先的稿件检查与修订产品。当前开发版本为 `0.1.0-alpha.11`，已有 Electron 桌面端、Python 检查核心、Windows alpha 本地运行资源与发布前门禁，以及离线标准包验证、项目版本固定、显式升级和回滚链路；商业正式版目标为 Windows、macOS 与 Web。按论文、纸质出版物、电子书三类目标检查稿件，提供可追溯标准依据的问题解释、集中确认的白名单机械订正、检查点恢复、修订稿与检查报告导出。

**当前桌面核心承诺**：稿件默认只在本机处理；永不原地修改原稿（SHA-256 全程校验）；不强制注册；报告与导出不设营销门槛。

`0.1.0-alpha.11` 的**源码检查点标签**为 `chatgpt-v0.1.0-alpha.11`；该标签只标记源码与本地验证状态，不代表二进制发行。alpha.11 把 Python 核心、配置、标准与样本的精确清单，以及 Python/EpubCheck/JRE/Ace 平台锁摘要锚定到随代码进入 `app.asar` 的固定 JSON。真实打包启动必须先从 `app.asar` 读取锚点并复核全部 loose 资源，失败即在创建标准存储或窗口前退出。生产 Supabase、凭据存储、网络 transport、持久队列与网站后台仍未接入；真实运行默认未登录且不联网，不能把 `pending_transport` 写成已上传。

最终统一验证证据以 `docs/TEST_REPORT.md` 为准。alpha.11 全量回归为 Node 301 total / 294 pass / 0 fail / 7 skip、Python 351 total / 0 failures / 0 errors / 3 skipped；资源锚点覆盖 58 个 loose 应用文件、1,873,018 字节。带真实 `app.asar` 的构造打包门禁证明 5 个资源可信根阻断只有在 ASAR 锚点和完整资源树同时通过时才会关闭；这不是产品安装包证据。源码 Windows alpha 门禁仍如实保留全部 17 项 sale blocker，Electron 43.1.0 未知 fuse 仍是独立阻断。本轮未联网、未下载 builder 归档，也未生成 alpha.11 安装包或 ZIP；最近一次真实 UI smoke 仍是 alpha.10 历史证据，不能冒充 alpha.11 验收。

当前桌面安全边界包括：默认 Electron session 离线与固定 CSP；PDF 使用禁 JavaScript/导航/网络的非持久隔离 session；项目 schema/路径完整校验与跨进程内核写锁；创建项目在锁内以单一输入文件描述符复制到 `source`，再生成 `working`；自选导出目录逐级验证、全部目标预检和逐文件原子换入；标准包以 canonical manifest、内容寻址存储、高水位和精确回滚目标 fail-closed。已有项目不会因全局标准更新而静默换规则，必须先查看差异并显式确认，升级后强制重检。

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
| `docs/ELECTRON_FUSE_POLICY.md` | ASAR、Electron fuse 与打包后二进制验证合同 |
| `docs/WEBSITE_INTEGRATION.md` | Provider 边界、当前离线实现与未来网站对接 |
| `docs/SYNC_RECORD_V1.md` | 账号/权益模拟边界、同步白名单、确认状态机与生产对接缺口 |

## 仓库结构

见 `AGENTS.md` 第 5 节。
