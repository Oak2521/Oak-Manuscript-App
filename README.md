# 湖岸稿件（Oak Manuscript）

本地优先的稿件检查与修订产品。当前源码为 `0.1.0-alpha.51`，最新真实 Windows 打包版本仍为未签名 `0.1.0-alpha.42`。已有 Electron 桌面端、Python 检查核心、离线标准包验证/项目固定/显式升级/回滚链路、用户触发且二次确认的签名在线标准更新客户端与未部署服务端固定协议、独立角色签名的追加式撤回清单本地状态机、三模式 AI 设置与 OpenAI-compatible/Ollama/LM Studio 只读建议链、SyncRecord 明示授权/OS 加密队列、桌面系统浏览器 PKCE/OS 加密账号会话、账号/设备绑定的 Ed25519 权益客户端，以及独立的服务端签发、规范化订阅事件、账号设备管理 API 与 Postgres 契约源码。Web 临时稿件处理仍与长期结果同步分流；网站客户端源码现在既能查看和属主删除内容无关的同步历史，也能查看订阅状态、掩码设备列表并逐台确认撤销。账号、权益和标准在线更新均为 `pending_configuration`，仓库不含生产私钥、真实端点或生产公钥；撤回清单的生产获取也尚未接线。商业正式版目标为 Windows、macOS 与 Web。按论文、纸质出版物、电子书三类目标检查稿件，提供可追溯标准依据的问题解释、集中确认的白名单机械订正、检查点恢复、修订稿与检查报告导出。

**当前桌面核心承诺**：稿件默认只在本机处理；永不原地修改原稿（SHA-256 全程校验）；不强制注册；报告与导出不设营销门槛。

alpha.48 把现有生产形状组件串成同一匿名状态纵向链：桌面先取得真实服务端 Ed25519 签名的 active 权益，网站账号界面读取并明确撤销同一设备，桌面在显式刷新前保持旧缓存，刷新后取得真实签名的 revoked 权益并降为 Free；本地项目始终不锁定。该证据经过 GoTrue、service-role repository、HTTP、Web controller、signer、桌面 HTTP client、验签与缓存状态机，但仍是仓库内匿名仿真，不是生产联调。当前仍没有选定支付商的 webhook 验签适配器、真实数据库迁移或部署。完整协议见 `docs/SIGNED_ENTITLEMENT_V1.md`。

alpha.49 增加标准在线升级的桌面受控链路：默认无地址、绝不后台联网；只有用户点击检查才发送内容无关的版本摘要，候选包经签名、哈希、schema、兼容性和防降级核验后，再由原生对话框集中确认一次。安装只改变新建项目默认标准，已有项目不静默升级。当前仍无生产 trust pin、真实更新服务或线上联调。

alpha.50 增加标准更新服务端 exact 请求/错误/audit、固定公开 HTTPS 路由和生产形状 Fetch runtime。本地测试用真实 Ed25519 测试包贯通发布源、服务、桌面客户端、Provider 验证和原子安装；该证据不等于生产发布源、密钥、域名或部署已经完成。协议见 `docs/STANDARDS_UPDATE_V1.md`。

alpha.51 增加由独立 `revocation` 角色门槛签名的 canonical 撤回清单、追加式防回退状态事务和撤回后的安全前进恢复。active 或候选被撤回会阻止新操作，但 CAS、项目身份、既有检查结果和已生成导出不删除；生产清单获取、密钥与告警 UI 未完成。协议见 `docs/STANDARDS_REVOCATION_V1.md`。

此前两个固定 AI 组合的窄验收仍成立：Ollama 0.32.5 + qwen3:4b，以及 LM Studio headless llmster 0.0.20+1 + 同一 Qwen3 4B GGUF；这不是所有版本、模型、硬件、桌面 GUI 或稿件类型的全面兼容/质量承诺。OpenAI、Anthropic、Gemini 官方云仍未接入。账号和权益默认配置均没有网络目标，所以当前普通 APP 仍不能登录、刷新生产订阅或上传。“源码接线存在”不等于生产服务已经验收。

最终统一验证证据以 `docs/TEST_REPORT.md` 为准。alpha.50 当前回归为 Node 675 total / 668 pass / 0 fail / 7 skip、Python 362 total / 0 failures / 0 errors / 3 skipped；隐藏 Web 客户端与 Electron 源码 smoke 均 PASS。alpha.50 尚未打包；最新 alpha.42 Windows 制品为 NSIS 190,025,679 字节（SHA-256 `69147b5a…8736`）和 ZIP 233,856,293 字节（`38c66dcd…72a0`）。其 schema v2 发布清单与 packaged smoke 已验证，但制品未签名、真实系统安装未执行、发行身份 `complete=false`，因此只是内测包。

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
| `docs/STANDARDS_UPDATE_V1.md` | 标准包在线检查、固定 HTTP 契约、签名验证边界与生产缺口 |
| `docs/STANDARDS_REVOCATION_V1.md` | 独立角色签名撤回清单、追加式状态、历史保留与生产缺口 |
| `web/README.md` | Web 临时作业契约、同源 HTTP handler、零留存边界与生产缺口 |

## 仓库结构

见 `AGENTS.md` 第 5 节。
