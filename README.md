# 湖岸稿件（Oak Manuscript）

本地优先的稿件检查与修订产品。当前开发版本为 `0.1.0-alpha.17`，已有 Electron 桌面端、Python 检查核心、经真实 packaged 门禁和隐藏烟测验证的 Windows x64 NSIS/ZIP alpha 制品，以及离线标准包验证、项目版本固定、显式升级和回滚链路；商业正式版目标为 Windows、macOS 与 Web。按论文、纸质出版物、电子书三类目标检查稿件，提供可追溯标准依据的问题解释、集中确认的白名单机械订正、检查点恢复、修订稿与检查报告导出。

**当前桌面核心承诺**：稿件默认只在本机处理；永不原地修改原稿（SHA-256 全程校验）；不强制注册；报告与导出不设营销门槛。

`0.1.0-alpha.17` 的本地检查点标签为 `chatgpt-v0.1.0-alpha.17`。Windows CPython 3.13.14、EpubCheck 5.3.0 与 Temurin 21.0.11/JRE 均已有官方制品、完整文件树和下游锁的机器来源证据；三者具名法律/再分发签署仍待办，Temurin detached signature 也未完成 OpenPGP 验签。EpubCheck 官网 MIT 与随包/仓库 BSD-3-Clause 的矛盾未被擅自消解；顶层精确锁定 `@electron/fuses 2.1.3` 并回读 Electron 43 全部 9 项。真实安装器只有在另行授权并同时提供 `--run --allow-system-mutation` 后才可启动；当前尚未执行。生产 Supabase、凭据存储、网络 transport、持久队列与网站后台仍未接入；真实运行默认未登录且不联网。

最终统一验证证据以 `docs/TEST_REPORT.md` 为准。alpha.17 全量回归为 Node 338 total / 331 pass / 0 fail / 7 skip、Python 351 total / 0 failures / 0 errors / 3 skipped。真实 packaged smoke 在保持 Electron sandbox 的外层隐藏进程中运行 EpubCheck/Ace 后 PASS，原稿哈希不变；NSIS 为 189,974,477 字节（SHA-256 `88f9a97e…b06f`），ZIP 为 233,789,900 字节（`d995766d…95a3`）。安装生命周期代码/预检通过不等于真实安装通过；制品仍未签名，packaged 资源门禁保留 11 项 sale blocker。

当前桌面安全边界包括：默认 Electron session 离线与固定 CSP；PDF 使用禁 JavaScript/导航/网络的非持久隔离 session；项目 schema/路径完整校验与跨进程内核写锁；创建项目在锁内以单一输入文件描述符复制到 `source`，再生成 `working`；自选导出目录逐级验证、全部目标预检和逐文件原子换入；标准包以 canonical manifest、内容寻址存储、高水位和精确回滚目标 fail-closed。已有项目不会因全局标准更新而静默换规则，必须先查看差异并显式确认，升级后强制重检。

## 快速开始

开发要求：Node.js 22.12+、Python 3.11+；Python 核心零第三方依赖。

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
