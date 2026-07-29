# 湖岸稿件（Oak Manuscript）

本地优先的稿件检查与修订产品。当前开发版本为 `0.1.0-alpha.39`，已有 Electron 桌面端、Python 检查核心、离线标准包验证/项目固定/显式升级/回滚链路、三模式 AI 设置与未接线安全底座、SyncRecord 明示授权/OS 加密队列、独立服务端验证/API/Postgres 契约，以及桌面系统浏览器 PKCE、OS 加密账号会话和显式发送的主进程接线源码。Web 临时稿件处理仍与长期结果同步分流。受信账号配置仍为 `pending_configuration`，没有真实端点或密钥；最新真实打包制品仍是经 packaged 门禁和隐藏烟测验证的 alpha.37 Windows x64 NSIS/ZIP。商业正式版目标为 Windows、macOS 与 Web。按论文、纸质出版物、电子书三类目标检查稿件，提供可追溯标准依据的问题解释、集中确认的白名单机械订正、检查点恢复、修订稿与检查报告导出。

**当前桌面核心承诺**：稿件默认只在本机处理；永不原地修改原稿（SHA-256 全程校验）；不强制注册；报告与导出不设营销门槛。

`0.1.0-alpha.39` 沿用 alpha.35 的供应商无关 AI HTTP 底座；当前没有注册任何真实模型适配器，主进程仍为 `transport:null`，因此仍不能调用真实模型。结果同步的固定 HTTPS 客户端和队列协调器已在账号配置完整时由主进程条件实例化；默认配置没有任何网络目标，所以当前真实 APP 仍不能登录或上传。“生产形状接线存在”不等于官网已接通。

最终统一验证证据以 `docs/TEST_REPORT.md` 为准。alpha.39 当前回归为 Node 576 total / 569 pass / 0 fail / 7 skip、Python 362 total / 0 failures / 0 errors / 3 skipped；独立隐藏源码 Electron smoke PASS，但没有重新打包。最新 Windows 制品仍为 alpha.37：NSIS 190,013,357 字节（SHA-256 `26af70e0…e095`），ZIP 233,838,480 字节（`e4288fbf…697d`）。其 schema v2 发布清单已绑定 canonical smoke 证据、实际 EXE 和匿名输出树；这仍不是代码签名。真实安装生命周期尚未执行；制品仍未签名，发行身份契约 `complete=false`，packaged 资源门禁保留 12 项 sale blocker。

当前桌面安全边界包括：默认 Electron session 离线与固定 CSP；PDF 使用禁 JavaScript/导航/网络的非持久隔离 session；项目 schema/路径完整校验与跨进程内核写锁；创建项目在锁内以单一输入文件描述符复制到 `source`，再生成 `working`；自选导出目录逐级验证、全部目标预检和逐文件原子换入；标准包以 canonical manifest、内容寻址存储、高水位和精确回滚目标 fail-closed。已有项目不会因全局标准更新而静默换规则，必须先查看差异并显式确认，升级后强制重检。

## 快速开始

开发要求：Node.js 22.12+、Python 3.11+；Python 核心零第三方依赖。

```bash
# 安装桌面开发依赖并启动
npm install
npm start

# 统一测试入口：Node + Python
npm test

# 仅在开发/部署 Web 服务端时安装其独立生产依赖
npm install --prefix web

# 分项排障
npm run test:node
npm run test:python

# 只读检查正式发行商/销售主体元数据完备性
npm run verify:release-identity
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
| `docs/SYNC_RECORD_V1.md` | PKCE/加密会话、同步白名单、显式发送状态机与生产联调缺口 |
| `web/README.md` | Web 临时作业契约、同源 HTTP handler、零留存边界与生产缺口 |

## 仓库结构

见 `AGENTS.md` 第 5 节。
