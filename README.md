# 湖岸稿件（Oak Manuscript）

本地优先的稿件检查与修订产品。当前开发版本为 `0.1.0-alpha.29`，已有 Electron 桌面端、Python 检查核心、经真实 packaged 门禁和隐藏烟测验证的 alpha.23 Windows x64 NSIS/ZIP 制品、离线标准包验证/项目固定/显式升级/回滚链路，以及 Web 临时作业状态机、同源 HTTPS handler、GoTrue 验证、Fetch 适配、首个未部署工作台、Netlify Blobs 临时对象存储、Supabase/Postgres 持久任务状态、私有原子领取队列、上传结构/主动内容前置门禁和固定 Python 子进程处理源码；商业正式版目标为 Windows、macOS 与 Web。按论文、纸质出版物、电子书三类目标检查稿件，提供可追溯标准依据的问题解释、集中确认的白名单机械订正、检查点恢复、修订稿与检查报告导出。

**当前桌面核心承诺**：稿件默认只在本机处理；永不原地修改原稿（SHA-256 全程校验）；不强制注册；报告与导出不设营销门槛。

`0.1.0-alpha.29` 在私有租约/共享核心闭环前增加固定 Python `web-inspect`：TXT/Markdown 复核 UTF-8/NUL，DOCX/EPUB 复核 ZIP 路径、链接/特殊文件、加密、成员/展开量/压缩比/CRC、必需成员及宏/ActiveX/嵌入/DDE/脚本等主动内容。检查在临时对象存储前完成，失败零字节入库且不暴露账号或任务身份。它不是带病毒库的杀毒扫描；SQL 尚未在真实 Supabase 执行，生产容器/OS 无网、短时下载、部署和三路零留存证据仍未完成，不能称为网页版已上线。

最终统一验证证据以 `docs/TEST_REPORT.md` 为准。alpha.29 全量回归为 Node 464 total / 457 pass / 0 fail / 7 skip、Python 357 total / 0 failures / 0 errors / 3 skipped；Web 定向为 94/94，上传门禁 Python 专项为 5/5，Web 生产子包沿用 alpha.26 已复验的 0 个已知漏洞锁。本检查点没有联网或重复打包。最新真实 Windows 制品仍是 alpha.23：NSIS 189,995,462 字节（SHA-256 `3ae05010…ad3d`），ZIP 233,814,202 字节（`625b0fea…8d05`）。真实安装生命周期尚未执行；制品仍未签名，发行身份契约 `complete=false`，packaged 资源门禁保留 12 项 sale blocker。

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
| `docs/SYNC_RECORD_V1.md` | 账号/权益模拟边界、同步白名单、确认状态机与生产对接缺口 |
| `web/README.md` | Web 临时作业契约、同源 HTTP handler、零留存边界与生产缺口 |

## 仓库结构

见 `AGENTS.md` 第 5 节。
