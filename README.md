# 湖岸稿件（Oak Manuscript）

本地优先的稿件检查与修订产品。当前源码与最新真实 Windows 打包版本均为 `0.1.0-alpha.58`；Windows 制品未签名，只是可验证内测检查点，不是可售卖正式版。已有 Electron 桌面端、Python 检查核心、离线标准包验证/项目固定/显式升级/回滚链路、受控标准在线更新/撤回链、三模式 AI、统一账号/权益/同步和网站账号后台源码。Web 临时稿件处理仍与长期结果同步分流；alpha.58 为 TXT/Markdown 增加保守空白卫生提示、行号和格式覆盖矩阵，并保持代码、表格、强制换行与排版敏感块豁免。账号、权益和标准联网配置均为 `pending_configuration`，仓库不含生产私钥、真实端点或生产公钥；真实发布源、部署、监控和后台调度尚未实现。商业正式版目标为 Windows、macOS 与 Web。

**当前桌面核心承诺**：稿件默认只在本机处理；永不原地修改原稿（SHA-256 全程校验）；不强制注册；报告与导出不设营销门槛。

alpha.48 把现有生产形状组件串成同一匿名状态纵向链：桌面先取得真实服务端 Ed25519 签名的 active 权益，网站账号界面读取并明确撤销同一设备，桌面在显式刷新前保持旧缓存，刷新后取得真实签名的 revoked 权益并降为 Free；本地项目始终不锁定。该证据经过 GoTrue、service-role repository、HTTP、Web controller、signer、桌面 HTTP client、验签与缓存状态机，但仍是仓库内匿名仿真，不是生产联调。当前仍没有选定支付商的 webhook 验签适配器、真实数据库迁移或部署。完整协议见 `docs/SIGNED_ENTITLEMENT_V1.md`。

alpha.49 增加标准在线升级的桌面受控链路：默认无地址、绝不后台联网；只有用户点击检查才发送内容无关的版本摘要，候选包经签名、哈希、schema、兼容性和防降级核验后，再由原生对话框集中确认一次。安装只改变新建项目默认标准，已有项目不静默升级。当前仍无生产 trust pin、真实更新服务或线上联调。

alpha.50 增加标准更新服务端 exact 请求/错误/audit、固定公开 HTTPS 路由和生产形状 Fetch runtime。本地测试用真实 Ed25519 测试包贯通发布源、服务、桌面客户端、Provider 验证和原子安装；该证据不等于生产发布源、密钥、域名或部署已经完成。协议见 `docs/STANDARDS_UPDATE_V1.md`。

alpha.51 增加由独立 `revocation` 角色门槛签名的 canonical 撤回清单、追加式防回退状态事务和撤回后的安全前进恢复。alpha.52 增加固定公开 POST、内容无关 exact 请求、不可变签名 envelope 响应、有界桌面客户端及假服务到桌面原子应用 E2E。alpha.53 把 release/revocation 放进同源、固定路径、不可半配置的桌面配置；用户一次点击后必须先取得并验证撤回清单，成功后才检查候选。active 被撤回时标准内容停止展示、普通操作继续阻断，但恢复入口仍可用，并只允许安装更高且未撤回的签名版本。CAS、项目身份、既有检查结果和已生成导出不删除；生产发布源、密钥、告警、部署与真实网络仍未完成。协议见 `docs/STANDARDS_REVOCATION_V1.md`。

alpha.54 闭合账号同步商业主流程的本地生产形状证据：同步预览仍为零发送；用户明确选择“同步本次”后，若受信 transport 已配置，主进程立即发送，成功后删除精确本机队列项；发送失败则保留 OS 加密队列并要求用户在设置中明确重试；未配置 transport 时只入队且不声称上传。新增端到端测试贯通登录、Pro 权益、本地结果、桌面确认、服务端可信 owner 绑定和网站历史 strict parse。该证据没有使用真实账号、数据库或网络，不等于生产同步已部署。

alpha.55 为 Web 临时稿件任务增加唯一生产组合入口 `web/web-job-runtime.js`：启动配置与适配器必须 exact、公开 key 与 service-role key 必须分离、Python worker 不继承宿主环境；对外只暴露公开请求、私有 worker、清扫器和不会泄密的 readiness。`web/supabase/migrations-v1.json` 与 `npm run verify:web:migrations` 锁定四份 SQL 的顺序、大小和 SHA-256。readiness 故意把“真实迁移已执行”“OS 禁网”“生产零留存”和 `production_ready` 标为未验证/false；本地通过不等于网站已经上线。

alpha.56 增加 `web/deployment-requirements-v1.json` 与 `web/deployment-admission.js`。候选平台必须以不含端点/密钥的 exact profile 声明公开 HTTP、私有执行、对象存储、数据库和运维能力；容量或任一安全能力不足即在 runtime 创建 store/网络前拒绝。即使全部声明满足，结果仍为 `production_evidence_verified=false`、`production_ready=false`，必须等待官方规格核对和真实环境验收。

alpha.57 增加由已验证标准注册表派生的 content-free 治理摘要。标准页把“规则已启用 / 待复核”和“已核验 / 待核验 / 来源未取得”分列显示；当前现场为 13 项标准、9 项规则已启用、4 项待复核、0 项来源已核验、12 项待核验、1 项来源未取得，因此界面明确显示治理门禁未完成。该摘要不修改标准内容，不替代真实编辑签核或官方来源核验。

alpha.58 发布 `oak-standards/oak-rules 2.1.0`（release sequence 3）：新增 4 条仅提示、不可自动修复的 TXT/Markdown 空白卫生规则。检查器排除 Markdown 围栏代码、行内代码、表格、强制换行尾随空格，并保守豁免诗歌/刻意排版块；结果、JSON/Markdown/HTML 报告和桌面页显示精确行号与格式覆盖矩阵。规则总数为 39，机械 fixer 仍为 6；当前标准治理为 14 项、active 10、under_review 4、verified 0、pending 13、unavailable 1，正式内容门禁仍未满足。

此前两个固定 AI 组合的窄验收仍成立：Ollama 0.32.5 + qwen3:4b，以及 LM Studio headless llmster 0.0.20+1 + 同一 Qwen3 4B GGUF；这不是所有版本、模型、硬件、桌面 GUI 或稿件类型的全面兼容/质量承诺。OpenAI、Anthropic、Gemini 官方云仍未接入。账号和权益默认配置均没有网络目标，所以当前普通 APP 仍不能登录、刷新生产订阅或上传。“源码接线存在”不等于生产服务已经验收。

最终统一验证证据以 `docs/TEST_REPORT.md` 为准。alpha.58 当前回归为 Node 719 total / 712 pass / 0 fail / 7 skip、Python 368 total / 0 failures / 0 errors / 3 skipped；独立隐藏 Electron 源码与 Web 客户端 smoke PASS。alpha.58 Windows NSIS、ZIP、真实 ASAR/fuse/资源门禁、双进程 packaged smoke 与 schema v2 发布清单均已通过。制品未签名、真实系统安装未执行、发行身份 `complete=false`，因此仍只是内测包。

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

# 验证 Web 数据库迁移的顺序与精确字节锁
npm run verify:web:migrations
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
