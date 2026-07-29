# 湖岸稿件（Oak Manuscript）

本地优先的稿件检查与修订产品。当前源码为 `0.1.0-alpha.44`，最新真实 Windows 打包版本仍为未签名 `0.1.0-alpha.42`。已有 Electron 桌面端、Python 检查核心、离线标准包验证/项目固定/显式升级/回滚链路、三模式 AI 设置与 OpenAI-compatible/Ollama/LM Studio 只读建议链、SyncRecord 明示授权/OS 加密队列、独立服务端验证/API/Postgres 契约、桌面系统浏览器 PKCE/OS 加密账号会话，以及账号/设备绑定的 Ed25519 签名订阅权益验证源码。Web 临时稿件处理仍与长期结果同步分流，网站客户端源码已能查看和属主删除内容无关的同步历史。受信账号与权益配置均为 `pending_configuration`，没有真实端点、密钥或生产公钥。商业正式版目标为 Windows、macOS 与 Web。按论文、纸质出版物、电子书三类目标检查稿件，提供可追溯标准依据的问题解释、集中确认的白名单机械订正、检查点恢复、修订稿与检查报告导出。

**当前桌面核心承诺**：稿件默认只在本机处理；永不原地修改原稿（SHA-256 全程校验）；不强制注册；报告与导出不设营销门槛。

alpha.44 在既有登录和同步边界上新增严格的桌面权益配置、签名权益 Schema、Ed25519 验签、账号/设备绑定、safeStorage 加密缓存和设置页显式刷新；状态查询保持零网络，过期、撤销、损坏或退出均降为 Free，永不锁已有本地项目。网站客户端源码新增当前账号同步历史的列表和属主删除，但未部署。权益签发服务、订阅支付、设备后台、真实 OAuth/数据库迁移与网站上线仍未实现。完整协议见 `docs/SIGNED_ENTITLEMENT_V1.md`。

此前两个固定 AI 组合的窄验收仍成立：Ollama 0.32.5 + qwen3:4b，以及 LM Studio headless llmster 0.0.20+1 + 同一 Qwen3 4B GGUF；这不是所有版本、模型、硬件、桌面 GUI 或稿件类型的全面兼容/质量承诺。OpenAI、Anthropic、Gemini 官方云仍未接入。账号和权益默认配置均没有网络目标，所以当前普通 APP 仍不能登录、刷新生产订阅或上传。“源码接线存在”不等于生产服务已经验收。

最终统一验证证据以 `docs/TEST_REPORT.md` 为准。alpha.44 当前回归为 Node 615 total / 608 pass / 0 fail / 7 skip、Python 362 total / 0 failures / 0 errors / 3 skipped；独立隐藏源码 Electron smoke PASS。alpha.44 尚未打包；最新 alpha.42 Windows 制品为 NSIS 190,025,679 字节（SHA-256 `69147b5a…8736`）和 ZIP 233,856,293 字节（`38c66dcd…72a0`）。其 schema v2 发布清单与 packaged smoke 已验证，但制品未签名、真实系统安装未执行、发行身份 `complete=false`，因此只是内测包。

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
| `docs/audits/OLLAMA_0.32.5_QWEN3_4B_COMPATIBILITY.md` | 真实 Ollama 窄范围兼容验收、失败记录与证据边界 |
| `docs/PRIVACY_AND_SECURITY.md` | 隐私与安全基线 |
| `docs/ELECTRON_FUSE_POLICY.md` | ASAR、Electron fuse 与打包后二进制验证合同 |
| `docs/WEBSITE_INTEGRATION.md` | Provider 边界、当前离线实现与未来网站对接 |
| `docs/SYNC_RECORD_V1.md` | PKCE/加密会话、同步白名单、显式发送状态机与生产联调缺口 |
| `web/README.md` | Web 临时作业契约、同源 HTTP handler、零留存边界与生产缺口 |

## 仓库结构

见 `AGENTS.md` 第 5 节。
