# CHANGELOG — 湖岸稿件（Oak Manuscript）

记录仓库与规则包的版本变更。规则包版本独立于 APP 版本（见 `config/rule-packs/`）。

## [未发布]

### 2026-07-28 — 0.1.0-alpha.37（ChatGPT packaged smoke 证据绑定检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.37`。本轮未联网、未调用真实模型、未使用真实 AI 密钥、未部署或修改官网；生成的是未签名 Windows x64 内测制品，不是可售卖正式版。

- 新增 canonical `packaged-smoke-evidence-win32-x64.json`，绑定实际打包 EXE、唯一主 smoke PASS、第二进程 SyncRecord 加密队列恢复结果和匿名项目输出树；EXE 在两次进程前后重新取证，发生字节漂移即拒绝；
- 输出树逐文件执行路径、常规文件、单链接、读取前后身份、数量/容量/深度和 SHA-256 门禁；只允许应用协议中合法保留的 `.oak-project-write.lock`，其他隐藏名及链接/reparse 继续 fail-closed；
- 发布 manifest 升级为 schema v2，强制消费 smoke 证据文件摘要、EXE 摘要和输出树摘要；安装生命周期验证器保留历史 schema v1 归档兼容，同时严格验证当前 schema v2；
- 资源清单仍为 79 文件 / 2,139,277 字节，manifest SHA-256 `4ce4810d54f180d961f644b8f5d66e7b3aba6996e1a0c5c64b75397c93ab1b97`，ASAR 锚点 `4f306d10d385c8b913b03782a8672eb66022096bab836bffed5bb9ed027bbf92`；
- Windows x64 NSIS 190,013,357 字节 / SHA-256 `26af70e0ca533ee6dc09feae50ba420f7cb11e5dfba270f27870e1e679ece095`；ZIP 233,838,480 字节 / `e4288fbf621b837b0272c938113457928aa422573848129e46308a29a300697d`；SHA 文件摘要 `3d4ac24633b8134b484377872ea3a6fdd8d3d8cea7ed067025d939a71fb76774`；
- smoke 证据 1,222 字节 / SHA-256 `a90bc1c1724c6e52209dad9b1f40a9fe31f0eae2a40d1f285f36c87d171980a9`，绑定实际 EXE SHA-256 `ff85385e47360dab567d9606b63a3d1b68abfb6071af8e9a728a6248a68aefca` 与输出树 76 文件 / 1,368,471 字节 / SHA-256 `f0c9d68797d1d37953f96d18fdaaf1b30e6a91866fb8f3887e63f68f66beb334`；
- 最终 `npm test` 165.2 秒：Node 523 total / 516 pass / 0 fail / 7 skip（4.1144228 秒），Python 362 total / 0 failures / 0 errors / 3 skipped（113.806 秒）；隐藏源码与 packaged smoke、发布证据复验及 alpha.37→alpha.12 安装生命周期只读预检均 PASS。哈希证据可检测本地漂移，但在 Authenticode/可信见证前不是不可伪造证明。

### 2026-07-28 — 0.1.0-alpha.36（ChatGPT Windows 可安装内测制品检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.36`。本轮未联网、未调用真实模型、未使用真实 AI 密钥、未部署或修改官网；生成的是未签名 Windows x64 内测制品，不是可售卖正式版。

- APP、Python core、桌面/Web lockfile 统一为 alpha.36，重建 79 文件 / 2,139,277 字节资源清单；manifest SHA-256 `b0e85cd18ab481d5449b7d79c6c7bd6c438678d47cc892731ee7b394f22059ed`，ASAR 锚点 `0e2d523b37cc4acb6268288f8acf7dbacccde2c772f823dbedc0d48ec3b9a8c9`；
- 真实生成 Windows x64 NSIS 190,013,438 字节 / SHA-256 `fb25a52127d2d4bd2f2e1275236e54a2a9e4d6cce65707938a96364a201ce5cd` 与 ZIP 233,838,475 字节 / `cbdf1afc46b0d6a52f7d0ec0489096d6824a387c18819c6a93d505414b0757dc`；发布 manifest、SHA256SUMS、packaged 资源/ASAR、9 fuse 和隐藏 packaged smoke 均复验通过；
- 初次总构建在最后证据阶段因 release 根残留 alpha.23 制品被 fail-closed 门禁拒绝；旧制品无损移入仓库内归档后，仅重跑证据生成并通过，没有删除历史字节或掩盖失败；
- 安装生命周期 alpha.36→归档 alpha.12 只读预检通过，`authorized=false`，没有改写注册表、快捷方式或启动安装器；发行身份仍 `complete=false`，12 个缺失字段及 packaged 12 项 sale blocker 保留；
- 最终 `npm test` 167.7 秒：Node 517 total / 510 pass / 0 fail / 7 skip（3.7388783 秒），Python 362 total / 0 failures / 0 errors / 3 skipped（114.943 秒）；隐藏源码与 packaged Electron smoke 均 PASS。

### 2026-07-28 — 0.1.0-alpha.35（ChatGPT AI 有界 HTTP 底座检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.35`。本轮未联网、未调用真实模型、未使用真实 AI 密钥、未部署、未修改官网或重新打包；最新真实 Windows 制品仍为 alpha.23。

- 新增 `BoundedAIHttpClient`：固定 POST/JSON、远程 HTTPS/本机精确 loopback、禁重定向/URL 凭据与查询/Cookie/代理转发头/压缩响应，固定请求头、结构、容量、超时及响应媒体门禁；
- 新增 `AITransportRouter`：适配器注册表和配置/语义请求 exact 校验、未注册供应商拒绝、凭据 URL/响应回显拒绝、适配与网络错误净化；
- 生产主进程继续显式 `transport:null`，没有真实供应商适配器；本轮只交付离线可测的供应商无关底座，不把协议猜测写成完成事实；
- 网络底座定向 13/13；最终 `npm test` 114.524 秒：Node 517 total / 510 pass / 0 fail / 7 skip（3.988 秒），Python 362 total / 0 failures / 0 errors / 3 skipped（106.025 秒）；独立隐藏源码 Electron smoke PASS；资源清单 79 文件 / 2,139,277 字节，manifest SHA-256 `80bdc6cf31793a1efb784edd4fef6f87c41899842333560ae513dbd5bf71c4e4`，锚点 SHA-256 `3b3acc489a51e0d3c529e4bbb90145804394442ccf8230b09df79a911a9754ca`。

### 2026-07-28 — 0.1.0-alpha.34（ChatGPT AI 建议人工审阅检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.34`。本轮未联网、未调用真实模型、未使用真实 AI 密钥、未部署、未修改官网或重新打包；最新真实 Windows 制品仍为 alpha.23。

- 模型建议新增最多 8 个、30 分钟有效、一次处理的内存态审阅会话，绑定原问题上下文；重复、过期和上下文漂移全部 fail-closed；
- UI 新增“采纳为人工处理参考”和“放弃这条建议”：采纳只记录问题 `accepted` 状态，不保存模型文本、不写稿；放弃不改变规则问题状态；
- 审阅 IPC 只接受 opaque ID 与固定决定，写入失败错误净化；关闭建议和切换项目销毁未处理内存建议；
- AI/IPC/UI 定向 22/22；最终 `npm test` 118.772 秒：Node 504 total / 497 pass / 0 fail / 7 skip（3.953 秒），Python 362 total / 0 failures / 0 errors / 3 skipped（110.274 秒）；独立隐藏源码 Electron smoke PASS；资源清单 79 文件 / 2,139,277 字节，manifest SHA-256 `a4c18d0d718cf9b33fe1afd936cf195dcf482dc8f0d97c45242b6deed1db3fd2`，锚点 SHA-256 `418e747b0fdec3c07aadfa7b5c44af331b567271e1a4197aee8d429b0c9e03e9`。

### 2026-07-28 — 0.1.0-alpha.33（ChatGPT AI 发送预览与一次确认检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.33`。本轮未联网、未调用真实模型、未使用真实 AI 密钥、未部署、未修改官网或重新打包；最新真实 Windows 制品仍为 alpha.23。

- 新增 Python `ai-context`：只读提取所选单条问题的最小发送内容；项目/检查/working/标准绑定只供本地过期判断，不进入公开预览；EPUB 内部资源路径脱敏；
- 新增 `AIRequestCoordinator`：10 分钟、最多 8 个、一次性计划，绑定上下文与 AI 配置；预览/取消零 transport，问题或配置漂移、重复确认、未知字段、超限和 transport 异常全部 fail-closed；
- 问题详情新增附加要求和完整发送预览：显示模式、供应商、模型、地址、有效期、会发送/不会发送字段及完整语义请求；建议只读、内存态、不自动写回；
- 注入式 transport 测试覆盖确认后才交付凭据和安全返回，但生产 `transport:null`，确认按钮硬禁用；本版本不能调用真实模型；
- AI Node 定向 35/35、Python 定向 5/5；最终 `npm test` 116.771 秒：Node 501 total / 494 pass / 0 fail / 7 skip（3.561 秒），Python 362 total / 0 failures / 0 errors / 3 skipped（108.900 秒）；扩展隐藏源码 Electron smoke 最终 PASS；资源清单 79 文件 / 2,139,277 字节，manifest SHA-256 `dac22358086fdc38726cebc68bca32668fbae35167967b473b367b0d9ce98388`，锚点 SHA-256 `42d749a4e62f85c87a3c0d88a6242c919da2d8c26c07ca60312359dbcd410f98`。

### 2026-07-28 — 0.1.0-alpha.32（ChatGPT 三模式 AI 设置与加密凭据检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.32`。本轮未联网、未调用模型、未使用真实 AI 密钥、未部署、未修改官网或重新打包；最新真实 Windows 制品仍为 alpha.23。

- 正式方案补入用户已批准的六项 AI 决定；新增无 AI / 湖岸 AI / 我的 AI 三模式及 OpenAI、Anthropic、Google Gemini、OpenAI-compatible、Ollama、LM Studio 配置；
- 新增主进程 `AIProvider`、固定 IPC 与 Electron `safeStorage` 加密持久化。我的 AI 受 Pro 权益门禁；凭据不回读、不导出、不同步，供应商/地址变化禁止复用；非 loopback 服务强制 HTTPS；关闭/切换湖岸 AI 清除 BYO 凭据；
- 设置页新增模式、供应商、模型、地址和一次性凭据输入。当前模型 transport 故意未实现，状态固定无静默回退、只输出建议、禁止自动写回，并明确不会发起网络请求；
- 定向 26/26；最终 `npm test` 117.636 秒：Node 492 total / 485 pass / 0 fail / 7 skip（3.573 秒），Python 357 total / 0 failures / 0 errors / 3 skipped（109.596 秒）；独立隐藏源码 Electron smoke PASS；资源清单 79 文件 / 2,136,323 字节，manifest SHA-256 `012f9bc6fcce4a330d618b33e475405cf52b16aa6adcca5f7bae10f2fef3a3c7`，锚点 SHA-256 `58d24d83e1d045a0cf26eca46202adfaf98e6a109760d82b7af52dcadf651758`。

### 2026-07-28 — 0.1.0-alpha.31（ChatGPT Web 有界双清扫检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.31`。本轮未联网、未部署、未修改官网、未执行真实 Supabase/Netlify E2E，也未重新打包。最新真实 Windows 制品仍为 alpha.23。

- 新增第八个 service-role-only `list_cleanup_due` RPC：优先返回所有 `deletion_pending`，再返回已到期任务；删除失败不再必须等待 15 分钟 TTL 才能由计划任务重试；原 `list_expired` / `sweepExpired()` 保留兼容；
- `sweepExpiredObjects({maxObjects})` 增加 1—5,000 单轮硬上限及 `truncated` 结果，防止一次计划任务无界扫描；到期、损坏、metadata 暂不可用、删除未确认与未知键语义保持不变；
- 新增私有 `ZeroRetentionSweeper`，固定按“任务 → 对象 → 任务”运行；任一阶段失败仍继续其余阶段，使孤立对象删除后可在同一周期再次提交数据库墓碑；输出和审计只含时间、状态与计数，不含任务 ID、对象键、错误文本或稿件信息；
- 本地报告即使三阶段清零也固定 `production_zero_retention_verified=false`。真实平台调度、告警、对象复制/备份生命周期和三路零留存仍须生产证据；
- 定向 38/38、全部 Web 104/104；最终 `npm test` 153.3 秒：Node 474 total / 467 pass / 0 fail / 7 skip（4.063 秒），Python 357 total / 0 failures / 0 errors / 3 skipped（144.338 秒）；资源清单 79 文件 / 2,136,323 字节，manifest SHA-256 `9c6fededb293bc6baa1d58035b132cbb57dcaeb203d2161110f96979cdcf1ed2`，锚点 SHA-256 `72b4b54a9849108a7432aa7f7054cb72bd39686b3ecf5612c54bab5e3f5483ab`。

### 2026-07-28 — 0.1.0-alpha.30（ChatGPT Web 一次性结果领取检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.30`。本轮未联网、未部署、未修改官网、未执行真实 Supabase/Netlify E2E，也未重新打包。最新真实 Windows 制品仍为 alpha.23。

- 结果领取由可重放的 GET 改为受同源/CSRF 保护的已认证 `POST /manuscript/api/v1/jobs/:job_id/result`；GET 明确返回 405 且不消费结果；
- 第一个领取者以 revision CAS 把 `result_ready` 原子转为 `deletion_pending/downloaded`，随后读取结果、删除 input/output 并提交 content-free 终态墓碑；只有全部清理成功后才向客户端返回字节；
- 并发领取严格只有一个成功者，二次领取失败；读取或删除失败不返回结果并保留可跨重启重试的删除待办，删除原因 schema、repository 与 SQL 约束统一增加 `downloaded`；
- Web 工作台显示一次性领取及失败重跑后果；成功后关闭旧任务并恢复新任务控件。该策略不使用可泄露的签名 URL；若服务器删除后响应传输或本机保存失败，结果不可重放；
- 全部 Web 97/97；最终 `npm test` 117.2 秒：Node 467 total / 460 pass / 0 fail / 7 skip（3.690 秒），Python 357 total / 0 failures / 0 errors / 3 skipped（108.679 秒）；资源清单 79 文件 / 2,136,323 字节，manifest SHA-256 `dda21d484ef81eeb2bbadebcd6a83a63720687254dc22dede4b60afcab73b49c`，锚点 SHA-256 `b1006ddae7d759d5060461b29d14b0c8a827e0474d3ad89c8314e00cb82cabef`。

### 2026-07-28 — 0.1.0-alpha.29（ChatGPT Web 上传结构与主动内容前置门禁）

> 本轮未联网、未部署、未修改官网、未执行真实 Supabase/Netlify E2E，也未重新打包。最新真实 Windows 制品仍为 alpha.23。

- 新增只读 Python `web-inspect` 与隔离子进程调用：在稿件写入临时对象存储、进入 worker 和共享检查核心前，验证格式、UTF-8、ZIP 路径/链接/加密/重复成员、成员/展开量/压缩比/CRC 及必需 DOCX/EPUB 成员；
- DOCX 拒绝宏、ActiveX、嵌入对象、外部替代内容和 DDE 字段；EPUB 拒绝脚本文件、script 元素、事件处理器和 `javascript:` URL。失败只返回稳定 `UNSAFE_DOCUMENT`，不反射内容或检测细节；
- 上传检查器不接收账号、任务 ID、租约或对象键；拒绝时零字节进入 store 并释放预留。该门禁是结构/主动内容检查，不是带病毒库的杀毒扫描，也不是容器/OS 沙箱；
- 全量 `npm test`：Node 464/457/0/7，Python 357/0/0/3；Web 94/94，Python 门禁专项 5/5。

### 2026-07-28 — 0.1.0-alpha.28（ChatGPT 私有租约队列与隔离核心检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.28`。本轮实现数据库原子领取、身份最小化 worker 编排和本机固定 Python 子进程检查；没有执行真实 Supabase 迁移、连接 Netlify/Supabase、部署容器、修改官网或重新生成安装包。最新真实 Windows 制品仍为 alpha.23。

- Postgres 迁移新增第七个仅 `service_role` 可调用的 `oak_manuscript_web_job_claim_next` RPC；以 `FOR UPDATE SKIP LOCKED` 原子领取 queued/过期 processing 任务，只领取到期前仍有完整租约时间的任务，并强制 processing 状态必有 exact lease；repository 增加固定 `claimNext()` 契约；
- 临时存储增加有界 `readInput()`；`PersistentWebJobService.claimNextProcessing()` 强一致读取输入并核对已确认字节数，以 WeakMap 绑定不可复制的服务内工作句柄，处理器看不到 owner、job ID 或 lease，完成仍受 exact lease/revision/expiry 约束；
- 新增 `PrivateLeaseWorker` 与 `PythonCoreProcessProcessor`。处理器超时必须短于租约；Python 使用绝对可执行文件、`-I -B -S -X utf8`、`shell:false`、固定参数、秘密/代理/注入环境清理、私有 scratch、输出/时间上限、输入前后 SHA-256 和身份复核后的清理。失败不伪造完成，保留输入并等待租约过期重试；
- Python CLI 新增单写锁 `web-check`：同一子进程创建临时项目并运行与桌面相同的核心，只返回检查结果，不返回文件路径、项目 ID 或源稿哈希。本机真实 `Hello\n` TXT 烟测得到 `check-0001`、`source_hash_ok=true`、scratch 0 残留；这不是容器或 OS 级无网证明；
- 私有队列/处理器/存储/SQL 专项 31/31、全部 Web 91/91；最终 `npm test` 110.2 秒：Node 462 total / 455 pass / 0 fail / 7 skip（3.528 秒），Python 352 total / 0 failures / 0 errors / 3 skipped（102.047 秒）；
- 资源清单为 78 文件 / 2,126,802 字节，manifest SHA-256 `d11dd1eb46069ce2c06ce506c5e0f3146c02e14223913944236a572ca58696b1`，锚点 SHA-256 `85b39f8dd69ec0e9ab6cf8bfbff8420e06d20f110d605d089703680ddceb9212`。Web 私有服务端源码仍不进入 Electron 打包资源。

### 2026-07-28 — 0.1.0-alpha.27（ChatGPT 持久任务与幂等数据库检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.27`。本轮是 Supabase/Postgres 迁移、服务端 repository、持久状态机与离线仿真检查点；没有执行官网数据库迁移、配置 service-role key、连接真实 Supabase/Netlify、部署网站或重新生成安装包。最新真实 Windows 制品仍为 alpha.23。

- 新增 `web/supabase/001_web_job_state.sql`：内容无关的任务表与幂等墓碑表强制 RLS，不向浏览器角色授权；固定 RPC 只授予 `service_role`。创建/重放在 advisory transaction lock 内原子完成幂等、UUID 碰撞及全局/账户并发门禁，状态转换使用 revision CAS，删除先提交 content-free 终态墓碑；
- 新增两份 Web 私有 exact schema 与 `web/supabase-job-repository.js`。服务端只向固定 PostgREST RPC 发出 HTTPS POST，service-role 凭据有界且不反射；响应媒体、长度、JSON、内部状态、文档最小字段、预留/租约、结果和删除原因全部 fail-closed；
- 新增 `PersistentWebJobService`，把创建、跨实例读取、上传预留、处理租约、结果完成、删除待办、幂等终态和 TTL 清扫接到持久 repository；稿件输入/输出仍只交给临时内容 store。HTTP handler 改为等待异步读、预留和释放，同时保持现有内存参考实现兼容；
- 新增 16 项定向测试，覆盖服务重启恢复、同键重放/墓碑、持久预留与 exact lease 绑定/过期接管、CAS 冲突孤立内容清理、删除失败跨重启重试、到期清扫、固定 RPC、RLS/权限/事务静态契约、JSONB 字段乱序、canonical 指纹绑定、秘密非反射和超时。全部 Web 85/85；最终 `npm test` 110.1 秒：Node 455 total / 448 pass / 0 fail / 7 skip（3.604 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（101.848 秒）；
- 资源清单仍为 78 文件 / 2,124,858 字节，manifest SHA-256 `96325d13cb112cf32ec572baed250d0ead5b54b15b0a4dba9da2d0c11ccdfe13`，锚点 SHA-256 `5e5038781d4a508e468d297e2fc8218aca0dc0a97b77c8d7aab0417fa90a21dd`。Web 私有服务端源码不进入 Electron 打包资源。

### 2026-07-28 — 0.1.0-alpha.26（ChatGPT Netlify 临时对象存储检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.26`。本轮是源码、离线仿真与依赖审计检查点，没有连接 Netlify、部署网站或重新生成安装包；最新真实 Windows 制品仍为 alpha.23。

- 新增 `web/netlify-ephemeral-storage.js`：站点级强一致 Netlify Blobs store、固定任务对象键、`onlyIfNew` 条件创建、exact metadata、50/100 MiB 边界、强一致读取及删除后缺失复验；
- 模糊写入失败或重复调用只在现有字节与 metadata 完全一致时视为幂等成功；任何不一致拒绝覆盖。metadata/内容长度夹带、非法任务 ID/前缀/时间/媒体类型均 fail-closed；
- 新增独立 `sweepExpiredObjects()`：按 metadata `delete_at` 清理到期对象；已知任务对象 metadata 确认损坏时优先删除，metadata 暂时不可读时保留对象并返回 pending，删除未确认同样 pending，未知键只计数且不越权处理。Netlify Blobs 不提供本项目原生 TTL，计划任务仍为生产必需；
- SDK 隔离在 `web/package.json` 私有子包，精确锁定 `@netlify/blobs 10.1.0`。10.7.10 因 OpenTelemetry Baggage 无界内存分配审计告警被拒绝；10.1.0 保留所需条件写/强一致/分页 API，`npm audit --prefix web --omit=dev` 为 0 个已知漏洞；桌面根依赖无新增；
- Netlify 适配器专项 8/8、全部 Web 69/69；最终完整回归 Node 439 total / 432 pass / 0 fail / 7 skip，Python 351 total / 0 failures / 0 errors / 3 skipped，墙钟 110.7 秒；
- 资源清单仍为 78 文件 / 2,124,858 字节，manifest SHA-256 `9eab5d23bf54218746def9ea4f9be5c71380bf02af71df0204b4b592f4a1c150`，锚点 SHA-256 `80dd736236b81f77a94309842631f93bcd7b9e125f39fc8ac296bd7a9a909881`。

### 2026-07-28 — 0.1.0-alpha.25（ChatGPT GoTrue 验证、Fetch 桥与 Web 工作台检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.25`。本轮是源码、契约测试与隔离静态渲染检查点，没有部署网站或重新生成安装包；最新真实 Windows 制品仍为 alpha.23。

- 新增 `web/gotrue-verifier.js`：只允许规范 HTTPS Supabase origin 和固定 `/auth/v1/user`，限制 token、API key、超时、响应体与媒体类型；请求不携带 Cookie、不跟随重定向，不把 token 或上游响应写入错误；无效/过期身份返回未认证，上游超时/故障/畸形响应使用稳定错误码；
- 新增 `web/fetch-adapter.js`，把 Netlify v2 风格标准 Fetch `Request/Response` 接入既有 Node handler；上传保持流式并继续经过 HTTPS、同源、会话、长度/MIME 与接收预留门禁；
- 新增 `web/client/` 首个 Web 工作台：保留湖岸账号登录/注册，引用体例默认自动选择，要求每次任务明确处理同意，并实现创建、文件上传、状态轮询、取消和结果下载；创建元数据不携带文件名/路径；结果同步尚未接通并在界面如实禁用；
- 移动端 390px 与桌面 1440px 均在完全拦截网络的无界面浏览器中渲染核对；修复窄屏标题孤字和表单最小宽度溢出；
- Web 定向 61/61；最终完整回归 Node 431 total / 424 pass / 0 fail / 7 skip，Python 351 total / 0 failures / 0 errors / 3 skipped，墙钟 111.2 秒；
- 资源清单仍为 78 文件 / 2,124,858 字节，manifest SHA-256 `5df48f104e75b11f149be9ea1749738fc3d859bfd8f8bad66d17bf5a3a68e1dc`，锚点 SHA-256 `944ec0b152eaf08ccc385769d660396fbe63bff9a73d69a199d8e6e9dee40371`。

### 2026-07-28 — 0.1.0-alpha.24（ChatGPT Supabase Bearer 会话适配检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.24`。本轮是源码与测试检查点，没有重新生成安装包；最新真实 Windows 制品仍为 alpha.23。

- 新增 `web/supabase-session-adapter.js`：只接受唯一、格式有界的 `Authorization: Bearer`，调用注入的服务端 verifier，并把 exact `{subject_id}` 净化为 `{principal, auth_mode: "bearer"}`；token、角色及完整 Supabase user 不进入作业状态机；
- `web/http-handler.js` 的可信会话显式区分 Bearer 与 Cookie。两者都要求 HTTPS，状态变更都要求精确同源 Origin；Bearer 依赖显式 Authorization 且不开放 CORS，Cookie 模式继续强制 timing-safe CSRF；
- 拒绝缺失、短 token、空白、逗号合并、重复 Authorization、无效/过期 token、越权 verifier 字段和 malformed principal；verifier 基础设施异常保留为服务错误而非伪装成认证失败；
- 官网 `netlify-site` 只读核对确认现状为 Supabase 浏览器 access token + Netlify Function 调用 GoTrue `/auth/v1/user`；本仓库没有修改网站，也没有实现生产网络 verifier；
- 定向 handler/adapter 25/25；完整回归 Node 413 total / 406 pass / 0 fail / 7 skip，Python 351 total / 0 failures / 0 errors / 3 skipped；首次全量因版本字节引发资源锁漂移而按设计失败，显式更新后资源门禁和全量回归通过；
- 资源清单仍为 78 文件 / 2,124,858 字节，manifest SHA-256 `c84e051d22986a5c495b932991e71d87cf807eb2fb1adcc55823a6c2ecab2cbf`，锚点 SHA-256 `bbc5c905bcebbbb5feb08ebaa73d86e728e8f832b2dc55181f88abd33efd6a25`。

### 2026-07-28 — 0.1.0-alpha.23（ChatGPT 同源 HTTPS Web 作业 handler 边界检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.23`。已生成未签名 Windows x64 NSIS 与 ZIP；本轮交付的是不监听端口的 HTTP handler 和安全适配边界，不是已部署 Web 服务或生产零留存证明。

- 新增 `web/http-handler.js`，固定 `/manuscript/api/v1/jobs` 的创建、状态、上传、下载、取消和删除动作；worker 开始/完成保持私有；
- HTTPS、精确同源 Origin/Fetch Metadata、trusted exact 会话、CSRF、重复头、固定错误文案和无内容安全审计均 fail-closed；不设置 CORS，不信任请求正文账号或普通转发头；
- 上传新增读取前的大小/MIME/并发预留，要求唯一 Content-Length，拒绝 Transfer-Encoding、文件名/处置/摘要头；读取失败释放预留，并发第二接收者被拒绝；
- 新增 `web-http-error-v1`、`web-http-audit-v1` 两份 exact schema并进入应用资源信任清单；当前为 78 文件 / 2,124,858 字节；
- Web HTTP/状态机定向 36/36；完整回归 Node 406 total / 399 pass / 0 fail / 7 skip，Python 351 total / 0 failures / 0 errors / 3 skipped；source 与 packaged 双阶段隐藏 smoke PASS；
- 首次受限环境 build 在 packaged smoke 因 GPU 子进程 `0xC0000135` 失败且未生成证据；相同制品沙箱外 smoke 通过，随后沙箱外完整 build 199.8 秒退出 0；
- 最终 NSIS 189,995,462 字节，SHA-256 `3ae05010f979d0358476a341b476a13381de79faa012f9d8cdcb92784da0ad3d`；ZIP 233,814,202 字节，SHA-256 `625b0fea28b185985eed784d8b572565ff7ef85ffefb54be3938bd0a47248d05`。

### 2026-07-28 — 0.1.0-alpha.22（ChatGPT Web 临时作业契约与零留存状态机检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.22`。已生成未签名 Windows x64 NSIS 与 ZIP；本轮交付的是无网络 Web 作业契约和内存参考实现，不是已部署网页版或生产零留存证明。

- 新增 `web/job-contract.js`：可信账号/匿名主体独立传入，创建请求强制单任务明示同意、短 TTL、格式/大小门禁、账号隔离、每主体/全局并发和幂等冲突；请求不能自报账号或携带 token；
- 新增创建、公开状态和删除回执三份 exact schema；文件名、路径、正文、片段、内容哈希和未知字段没有合法入口；上传字节与公开元数据/观察事件分道；
- 完成处理先删输入再开放短期结果；取消、用户删除和 TTL 清扫删除输入与输出，并传递对象存储 `deleteAt` 兜底。删除失败进入 `deletion_pending` 并准确报告仍保留的数据，不生成成功回执；
- 终态幂等墓碑只保留非内容请求指纹，拒绝同键重建/重复计费；UUID 连续碰撞失败关闭，不能覆盖其它主体任务；观察事件接收器故障不阻断内容清理；
- 新增 17 项 Web 契约回归，覆盖同意时效、越权、内容夹带、大小/MIME、TTL、过期访问、取消、部分删除失败、重试、并发、幂等和 ID 碰撞。完整回归为 Node 387 total / 380 pass / 0 fail / 7 skip，Python 351 total / 0 failures / 0 errors / 3 skipped；
- source 与 packaged 隐藏 smoke 均 PASS；完整 Windows build 195.9 秒退出 0。NSIS 189,993,535 字节，SHA-256 `e50ac4e3e79f426c8f78ee55a234d6a9dd5505f6b5884213a57402f4dc8af1ec`；ZIP 233,812,123 字节，SHA-256 `3214f639af372f84f0eeae4a2c826845abe76e7797d647a1f180f3dbb12a22e3`。

### 2026-07-28 — 0.1.0-alpha.21（ChatGPT 本机加密同步队列与重启恢复检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.21`。已生成未签名 Windows x64 NSIS 与 ZIP；网络 transport、生产登录、网站后台、真实安装、签名和其余 sale 门禁仍未完成，不是可售卖正式版。

- SyncRecord 待发送项改用 Electron `safeStorage` 加密持久化；固定二进制封装、canonical 明文、revision CAS、独占候选、`fsync`、原子替换和提交后复验，异常时 fail-closed；
- 队列与项目阻止项按账户隔离，未登录不可读取或操作；Renderer 不接收内部 `account_id`，设置页可查看当前账号队列并取消、重试、删除；
- 新增 exact `sync-queue-store-v1` schema，以及篡改、硬链接、revision 冲突、原子替换失败、账户切换、持久层不可用和无明文泄露反向测试；
- source/packaged smoke 均升级为两次隐藏启动，真实证明首次写入后可由第二进程通过 OS 安全存储恢复；生产 transport 仍固定禁用；
- 最终全量：Node 370 total / 363 pass / 0 fail / 7 skip，Python 351 total / 0 failures / 0 errors / 3 skipped；source 与 packaged 双阶段 smoke 均 PASS；
- 首轮制品通过 packaged smoke 后，文档同步发现 ASAR 内 README 与最终源码状态应保持一致；首轮制品归档为 `0.1.0-alpha.21-superseded-pre-doc-sync`，不作为最终发行证据。完整重构建 193.7 秒退出 0；
- 最终 NSIS：189,992,003 字节，SHA-256 `be7759f69916be3b65e94e3f66893d0498406e0a5604915f118b379aaa06782e`；ZIP：233,810,027 字节，SHA-256 `99141599e9909c56250f81ec76497ec2bcffac22691b7d04df897e4512f2b722`。

### 2026-07-28 — 0.1.0-alpha.20（ChatGPT 打包发行身份与真实 ASAR 元数据绑定检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.20`。已生成未签名 Windows x64 NSIS 与 ZIP；实际安装、签名、法定身份补全和其余 sale 门禁仍未完成，不是可售卖正式版。

- packaged 资源门禁改为读取实际 `app.asar/package.json`，报告 `package_evidence_scope=packaged-app-asar`；不再把源码 package 当作制品身份；
- 通过 electron-builder `extraMetadata` 注入 exact `oakReleaseIdentity` production marker。源码同时核对 `build.appId` 与 marker，制品核对 ASAR 内产品名、marker appId 和发行身份；Electron Builder 裁剪 `build` 字段的真实行为已有回归；
- 发行证据读取器改为解析当前 ASAR raw header 并循环读取到精确字节数，拒绝缓存陈旧、短读、link/unpacked、非法偏移、同路径替换和读取期间身份漂移；
- 中途一次全量测试暴露旧 `extractFile` 非法 JSON，第一次 build 暴露生产 package 裁剪，随后全量测试再次证明 `uncache()` 不充分；严格读取器还正确拒绝过未完全刷盘的测试 ASAR。测试辅助器现等待 raw header 声明的完整归档字节，生产读取器仍 fail-closed；最终完整 Node 回归连续三轮通过；
- 最终全量：Node 359 total / 352 pass / 0 fail / 7 skip，Python 351 total / 0 failures / 0 errors / 3 skipped；source 与 packaged 隐藏 smoke 均 PASS；最终 Windows build 204.1 秒退出 0；
- 最终 NSIS：189,986,523 字节，SHA-256 `25f180927553039cf7b2c5f45168af28681b7d133fd8ed29da826ecf9a61fcbd`；ZIP：233,802,826 字节，SHA-256 `8e2fe8291fea1f2b566dd67680d0a75ac3484a133c5725e6a5d39b1cd8e1a6b0`；只读安装生命周期预检通过，实际安装器未运行。

### 2026-07-28 — 0.1.0-alpha.19（ChatGPT 发行商身份 fail-closed 门禁检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.19`。已生成未签名 Windows x64 NSIS 与 ZIP；法定销售主体、正式链接、版权、具名复核和签名主体未确认，不是可售卖正式版。

- 新增 canonical `config/release-identity.json`、固定摘要 v1 schema 与只读验证器；已知产品/品牌/appId/官网固定，未知法定身份字段保持 `null` / `pending`；
- 验证器拒绝重复键、字段/顺序/schema/字节漂移、占位文本、非官方域 URL、平台签名字段格式和 `package.json` product/appId 漂移，并交叉检查 author/homepage/copyright 完备性；
- 新增 `RELEASE_PUBLISHER_METADATA_PENDING`：alpha 如实报告，sale fail-closed；源码/packaged blocker 由 16/11 增为 17/12。72 个应用资源及身份契约已由 ASAR 资源锚固定；
- 全量回归：Node 355 total / 348 pass / 0 fail / 7 skip；Python 351 total / 0 failures / 0 errors / 3 skipped；外层隐藏 Windows build 190.9 秒退出 0，真实 source/packaged 资源、9 fuse、运行时探针、EpubCheck/Ace smoke 与发布证据通过；
- 最终 NSIS：189,985,848 字节，SHA-256 `9fc35cbfa320419117ca064abd205d049b61e85b3c7442b0f5d74d98b71c9561`；ZIP：233,802,099 字节，SHA-256 `1641678bea38788439e7e538e6f1289076a412d54a19567bc834e1f0a6ad3d99`；安装生命周期只读预检通过，实际安装器未运行。

### 2026-07-28 — 0.1.0-alpha.18（ChatGPT Electron 与 Windows builder 来源机器证据检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.18`。已生成未签名 Windows x64 NSIS 与 ZIP；五类运行/构建资源的人工许可/再分发签核、实际系统安装与其余正式发布门禁未完成，不是可售卖正式版。

- 新增 Electron 43.1.0 provenance v1：固定 GitHub 官方 release API、ZIP、SHASUMS256、npm checksums；官方 ZIP 与本地运行时均为 75 文件、364,083,658 字节，75/75 原字节一致；证据 SHA-256 `5f850b7ad7a5971e3ccf4ecce505ed2793530952081a68afe3c648c1862c5075`；
- 新增 Windows builder provenance v1：固定三份官方 GitHub 归档/API 与 `app-builder-lib 26.15.3` 选择逻辑；受控重解压/重组 385 文件、19,150,116 字节并与当前工具树 385/385 一致；证据 SHA-256 `c16518397eb1d02cfe1beaf70eda5eaab6c6177c03af33f9b071e7f1ec22fbb5`；
- 两类证据均使用 exact schema、canonical JSON、完整树复核和反向测试，并分别绑定 runtime/tool manifest、tracked lock、应用资源清单和 ASAR 锚点；
- Electron release 无 detached signature；builder 三个 legacy release 无 digest/签名且部分所选载荷无具名许可证文件。两个 blocker 仅收窄为 `*_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，源码/packaged 数量仍为 16/11；
- 全量回归：Node 344 total / 337 pass / 0 fail / 7 skip；Python 351 total / 0 failures / 0 errors / 3 skipped；外层隐藏完整 Windows build 213.4 秒退出 0，真实 source/packaged 资源、9 fuse、EpubCheck/Ace smoke 与发布证据通过；
- 最终 NSIS：189,984,819 字节，SHA-256 `d55899aa6681d420d90523a7c8e3fa46d91f8342cce64ea2435f9e71b8351e05`；ZIP：233,800,734 字节，SHA-256 `34c26fab7d1c733acda82b34047bea9d7b36d5f247c54ec970a9c6ec0250547a`；安装生命周期只读预检通过，实际安装器未运行。

### 2026-07-28 — 0.1.0-alpha.17（ChatGPT Temurin/JRE 来源机器证据检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.17`。已生成未签名 Windows x64 NSIS 与 ZIP；OpenPGP/许可人工签署、实际系统安装与其余正式发布门禁未完成，不是可售卖正式版。

- 新增 Temurin/JRE provenance v1：固定 Adoptium 官方 ZIP、GitHub server digest、checksum、build metadata、detached signature 与公钥字节；ZIP 为 205,073,954 字节，SHA-256 `d3625e7cadf23787ea540229544b6e2ab494b3b54da1801879e583e1dfee0a64`；
- 官方 ZIP 与本机源 JDK 均为 490 文件、343,822,457 字节，490/490 原字节一致；固定 jlink 生成 207 文件、52,384,264 字节，94 份 NOTICE/legal 材料原字节保留；
- evidence、JRE lock、应用 loose 资源清单与 ASAR 锚点逐层绑定；新增 exact schema、canonical/反向测试与 source/packaged 路径重映射验证；
- detached signature 未因文件存在而冒充密码学验证：本机无 OpenPGP 工具，状态固定为 `not_verified_no_openpgp_tool`；sale blocker 收窄为 `JRE_SOURCE_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，总数仍为 11；
- 全量回归：Node 338 total / 331 pass / 0 fail / 7 skip；Python 351 total / 0 failures / 0 errors / 3 skipped；最终外层隐藏完整 Windows build 206.5 秒退出 0，真实 source/packaged 资源、9 fuse、EpubCheck/Ace smoke 与发布证据通过；
- 最终 NSIS：189,974,477 字节，SHA-256 `88f9a97e619cb9bd82f024a788a2c7b1780cab467098fe07b87975c0bae1b06f`；ZIP：233,789,900 字节，SHA-256 `d995766daaf96b72a46680c72b924228b964d38eab6e5bf7a8ed63b152be95a3`；安装生命周期只读预检通过，实际安装器未运行。

### 2026-07-28 — 0.1.0-alpha.16（ChatGPT EpubCheck 来源机器证据检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.16`。已生成未签名 Windows x64 NSIS 与 ZIP；EpubCheck/CPython 人工签署、实际系统安装与其余正式发布门禁未完成，不是可售卖正式版。

- 新增 EpubCheck 5.3.0 provenance v1：固定 W3C/DAISY 官方 GitHub release ZIP URL、33,071,108 字节、GitHub 服务端及本地一致的 SHA-256 `6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5`；
- 官方 ZIP 与本地完整分发均为 49 文件、36,263,890 字节，49/49 逐字节一致；证据 SHA-256 `2f5191140fd119bb288a71becf8ca3ddf077d17bc71aea12b179c502075735b0`，并由分发 manifest、JRE 探针锁、应用资源清单和 ASAR 锚点逐层绑定；
- exact schema、canonical 字节验证与反向测试拒绝自批准、schema/顺序/官方摘要/本地树漂移；来源审计细节写入 `docs/audits/EPUBCHECK_5.3.0_PROVENANCE.md`；
- 生成器直接从固定 ZIP 字节推导官方文件树，不接受可替换的外部解压目录；审读中发现这一绑定缺口后，首份同版本制品作废归档并以新 schema/ASAR 锚点完整重构建；
- 随包/上游仓库 BSD-3-Clause 与当前官网 MIT 信号矛盾被明确固定为 `license_signal_consistent=false`；未把 GitHub tag 签名冒充生成 ZIP 的直接签名，正式第三方再分发义务仍待具名人工签核；
- 全量回归：Node 334 total / 327 pass / 0 fail / 7 skip；Python 351 total / 0 failures / 0 errors / 3 skipped；真实 source/packaged 资源、9 fuse 与隐藏 DOCX/EPUB smoke PASS；
- 最终 NSIS：189,956,597 字节，SHA-256 `c5d02da1fcf64f44f75e22b2d884d64660f6669932e8cce0499711051ca02d02`；ZIP：233,770,875 字节，SHA-256 `74ac191bfdc3feb1585f1760326ffa31a9f489912143f7810743ffda021842dd`；安装生命周期只读预检通过，实际安装器未运行。

### 2026-07-28 — 0.1.0-alpha.15（ChatGPT CPython 来源机器证据检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.15`。已生成未签名 Windows x64 NSIS 与 ZIP；CPython 人工签署、实际系统安装与其余正式发布门禁未完成，不是可售卖正式版。

- 新增 Windows CPython 3.13.14 provenance v1：精确固定 PSF 官方 embeddable ZIP URL、10,964,839 字节和 SHA-256 `90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907`，并绑定 Sigstore、SPDX、GPG 旁证元数据；
- 官方/本地均为 34 个文件，33 个逐字节一致；唯一差异是 `python313._pth` 在官方字节后精确追加 `..\python\r\n`。官方 `LICENSE.txt` 原样保留；运行时 manifest、ASAR 资源锚点和 packaged 门禁绑定证据原始 SHA-256；
- 新验证器使用严格 JSON、exact schema、canonical UTF-8/LF、稳定单链接读取和原子更新；测试覆盖官方制品/运行时漂移、自批准、字段/顺序漂移与事务故障；
- Sigstore artifact digest、leaf signature、证书 identity 与 Rekor body 绑定，以及 SPDX supplier/license 已机器复验；完整 Fulcio/Rekor 信任链与 GPG 未验证，上游 bundle 两个 log index 不一致均如实保留。sale blocker 从无证据收窄为 `PYTHON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，总数仍为 11；
- 完整回归：Node 329 total / 322 pass / 0 fail / 7 skip；Python 351 total / 0 failures / 0 errors / 3 skipped；真实 packaged 资源、9 fuse 与隐藏 DOCX/EPUB smoke PASS；
- 首次整链构建在最后生成摘要时因根 `release/` 混放已归档 alpha.14 而正确失败关闭；核对根/归档摘要一致并移除根旧制品后，对已通过前序门禁与 smoke 的 alpha.15 字节生成、复验 canonical 发布证据；
- 最终 NSIS：189,951,730 字节，SHA-256 `d701bf0fee5766a17ba33c351ec46a3cafd00da147154cf4006d2711cabbb15e`；ZIP：233,765,446 字节，SHA-256 `9ac0252699b77bf80bc14ce1f7119526c29b22e79fde4171760541fbbf0f5511`；安装生命周期只读预检通过，实际安装器未运行。

### 2026-07-28 — 0.1.0-alpha.14（ChatGPT Windows 安装生命周期验收工具检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.14`。已生成未签名 Windows x64 NSIS 与 ZIP；实际系统安装生命周期仍未获授权执行，不是可售卖正式版。

- 新增 Windows 安装生命周期编排器：默认只读核对当前/旧版发布 manifest、SHA256SUMS、大小、SHA-256 与 NSIS PE；只有同时提供 `--run --allow-system-mutation` 才允许进入会写 HKCU/快捷方式的阶段；
- 授权序列固定为 alpha.12 安装和 smoke、alpha.14 就地升级和 smoke、userData 哨兵保留、alpha.12 回装后仍保持 alpha.14、卸载及注册表/桌面/开始菜单清理；目录、日志、用户数据和证据都限定在仓库 `out/install-acceptance/`；
- 新增证据 v1 JSON Schema、exact 运行时 validator 与 canonical 文件/安装器字节复验；PASS 必须九阶段等序全绿。新增 12 项专项测试覆盖旧制品篡改、完整 SemVer 排序、x86 NSIS/x64 APP 区分、零授权零启动、路径逃逸、隐藏阶段、回装未启动、降级成功时失败与清理；
- smoke 专用启动在 `app.ready` 前禁用硬件加速，普通启动不变。Codex 受限令牌下 Electron sandbox 子进程以 `0xC0000135` 退出，同一 alpha.13 复现；没有采用 `--no-sandbox`，改在获准的外层隐藏 GUI 进程运行，alpha.14 packaged smoke 34.7 秒 PASS；
- 完整回归：Node 323 total / 316 pass / 0 fail / 7 skip；Python 351 total / 0 failures / 0 errors / 3 skipped；
- 最终 NSIS：189,946,367 字节，SHA-256 `e8ff13a093aa48d25de74afbbd9311676ec8afb9037bcafee946d4bcdac21647`；ZIP：233,759,796 字节，SHA-256 `15e8a34e5ee35806d12e452b991ff1c7db867827278262af7ba931c5f631da9b`；证据与只读安装预检复验通过；
- 实际安装/升级/降级探测/卸载尚未执行；历史 alpha.12 安装器能否阻止回退仍未知，Windows 签名、干净机与 11 项 packaged sale blocker 继续阻止正式售卖。

### 2026-07-28 — 0.1.0-alpha.13（ChatGPT Electron 43 全 fuse 固定检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.13`。已生成未签名 Windows x64 NSIS 与 ZIP；仍不是可售卖正式版。

- 精确锁定顶层 `@electron/fuses 2.1.3`，确认 Electron 43 wire 索引 8 为 `WasmTrapHandlers` 并固定启用；9 项策略全部具名，未来未知项在 sale 继续 fail-closed；
- 新增 electron-builder `afterPack`：代码签名前用 `strictlyRequireAllFuses=true` 显式写入全部 9 项并立即回读；API/索引漂移、非法 wire 数、路径逃逸、链接/硬链接和回读漂移均拒绝；macOS arm64 按工具合同重置临时 ad-hoc 签名；
- 二进制验证在 macOS 同时验证应用入口和实际 `Electron Framework` fuse 文件，读取前后核对实际文件身份；
- 全量回归：Node 310 total / 303 pass / 0 fail / 7 skip；Python 351 total / 0 failures / 0 errors / 3 skipped；真实 packaged smoke 通过且原稿哈希不变；
- 最终 NSIS：189,944,918 字节，SHA-256 `2a5ffcfa2ca47e925f1b65b3e44521038fc20fc760cbfdd86307ec0ae50e1851`；ZIP：233,758,073 字节，SHA-256 `0ecbbcd5eae20af3da5d50c9d398d64f76c3d93d3f978a3fa103ebd27745ddae`；证据清单复验通过；
- Electron fuse 兼容性 blocker 已关闭；packaged 资源仍保留 11 项 sale blocker，Windows 签名、干净机安装、正式来源/许可证审计、自带浏览器与 OS 级网络隔离仍未完成。

### 2026-07-28 — 0.1.0-alpha.12（ChatGPT Windows 可安装 alpha 检查点）

> 本地标签：`chatgpt-v0.1.0-alpha.12`。已生成未签名 Windows x64 NSIS 与 ZIP；仍不是可售卖正式版。

- 经用户批准下载三份固定 electron-builder 官方归档，验哈希后只导入 Windows 所需条目；生成 385 文件、19,150,116 字节的独立 tracked 全树锁，构建继续使用本地固定 7-Zip，不允许下载回退；
- builder 包装器改为在启动前解析受验证 Electron dist，并强制覆盖调用者的 `electronDist`；显式复制 Ace `node_modules` 和被 builder 固定过滤的 `.gitkeep`，packaged 资源门禁复核 6,672 文件；
- Python 隔离调用增加 `-B`；`-I` 忽略环境变量时仍禁止在 loose 受信资源中生成 `.pyc`，真实打包门禁确认 packaged pyc 数为 0；
- 新增受限 `oak-manuscript://renderer/` 协议，只提供四个固定 UI 资源；在 `GrantFileProtocolExtraPrivileges=false`、ASAR integrity 和 `OnlyLoadAppFromAsar=true` 下恢复安全页面加载；
- packaged smoke 现在强制应用内 EpubCheck/Ace 外部验证，不能由调用者静默降级；最终 DOCX/EPUB 各 4 次检查、1 个修复批次、3 个检查点，原稿哈希不变，EPUB 得到预期 5 个 EpubCheck error 和 8 项 Ace 失败断言；
- 完整回归：Node 306 total / 300 pass / 0 fail / 6 skip；Python 351 total / 0 failures / 0 errors / 3 skipped；
- 最终 NSIS：189,944,468 字节，SHA-256 `42c38acaeb98cf98e4871ad1a8d7fc1225bdab3bd6c1c2149b3bf27ff03603bf`；ZIP：233,758,044 字节，SHA-256 `d99052ac1b803a58859f64b9c8874a9ef5de3118f7155f77b1789d5cc884adf2`；证据清单复验通过；
- packaged 资源 blocker 从 12 降至 11（builder 独立可信锁成立）；未知 Electron fuse、Windows 签名、正式来源/许可证审计、自带浏览器与 OS 级网络隔离仍阻止 sale。

### 2026-07-28 — 0.1.0-alpha.11（ChatGPT ASAR 资源信任根检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.11`。该标签只表示经本地验证的源码状态；当前没有 alpha.11 安装包、ZIP、签名或真实产品 `app.asar` 证据。

**资源信任根**

- 新增 canonical `app-resources-v1.json`，精确固定将作为 loose extraResources 分发的 Python 核心、配置、标准和样本；当前覆盖 58 个文件、1,873,018 字节；
- 新增随代码进入 `app.asar` 的 `resource-trust-anchor.json`，固定应用资源清单原始字节摘要及 win32-x64 的 Python、EpubCheck、JRE、Ace tracked lock 摘要；
- 打包资源门禁必须从真实 `app.asar` 读取锚点，拒绝 loose 伪锚点、资源增删改、锁替换、平台替换、链接/硬链接和读取身份漂移；
- 打包应用启动在标准存储与窗口创建前复核锚点和完整 loose 资源，失败即退出；显式 `--update-lock` 使用受控 tracked-file 事务替换并写后复验；
- 只有真实 packaged ASAR 证据存在时才关闭 5 个资源可信根 blocker。源码门禁仍保留 17 项，不能用构造 fixture 冒充产品制品。

**验证**

- `npm test` PASS：Node 301 total / 294 pass / 0 fail / 7 skip；Python 351 total / 0 failures / 0 errors / 3 skipped；墙钟 171.3 秒；
- `verify:resource-trust`、`verify:standards`、`stage:ace`、`verify:electron-runtime`、`verify:resources:win` 与 `verify:fuses:config` 全部 PASS；
- 真实 `app.asar` 构造集成测试证明 packaged 门禁可把 17 项缩至 12 项，并在 `app.asar` 缺失时失败关闭；该结果不是 alpha.11 安装包证据；
- alpha.11 独立隐藏源码 UI smoke PASS：`out/source-smoke/runs/ms4eowx9-64e0aab5311e2a99/projects/`；DOCX/EPUB 各 4 次检查、1 个修复批次、3 个检查点，应用 fixes 5/2，PDF 251,654/178,235 字节，原稿哈希不变；EPUB 实得 EpubCheck 5 error 与 Ace 8 项失败断言；
- 本轮未联网、未构建、未签名；上述 smoke 是源码 UI 证据，不是 alpha.11 安装包证据。

### 2026-07-28 — 0.1.0-alpha.10（ChatGPT Ace 受控 utilityProcess 与 RunAsNode 关闭检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.10`。该标签只表示经本地验证的源码状态；当前没有 alpha.10 安装包、ZIP 或真实打包二进制证据。

**受控外部验证**

- Renderer 只提交项目路径；主进程生成绑定项目/working/标准与 Java、JAR、Ace、Chrome 文件身份的计划，prepare 清理安全输出后才运行固定 helper，finalize 重验同一计划并解析报告；
- Ace 迁移到 Electron `utilityProcess`，固定入口/参数、净化环境、64 KiB 输出上限和 5 分钟超时；目录换入、工具替换、状态漂移、异常退出或非法报告均 fail-closed；
- 主进程新增受控 Chrome controller：固定隐藏参数、独立 profile、随机 loopback DevTools 端点、精确子进程停止和清理；Ace utility 只连接这个本地端点；
- Electron Fuse 将 `RunAsNode` 从临时 `true` 改为 `false`。Electron 43 未知索引 8 仍按 alpha blocker / sale fail-closed，不猜测语义。

**验证**

- `npm test` PASS：Node 295 total / 288 pass / 0 fail / 7 skip；Python 351 total / 0 failures / 0 errors / 3 skipped；
- 标准、Ace stage、Electron runtime、Windows alpha 资源和 Fuse 配置门禁全部 PASS；17 项 sale blocker 未减少；
- 隐藏条件源码 smoke PASS：`out/source-smoke/runs/ms4cz6o9-c2ad021ca7e2e83c/projects/`；DOCX/EPUB 各 4 次检查、1 次修复、3 个检查点，问题 13/5、应用 fixes 5/2、PDF 251,649/178,228 字节，原稿哈希不变；
- EPUB 缺陷样本真实得到 EpubCheck 5 error 和 Ace 8 项失败断言，结束后无 Chrome profile 残留；
- 发布证据与 packaged fuse 门禁按设计拒绝缺失 alpha.10 制品。本轮未联网、未下载 builder、未构建或签名。

### 2026-07-28 — 0.1.0-alpha.9（ChatGPT Electron ASAR 与 fuse 发布硬化检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.9`。该标签只表示经本地验证的源码状态；当前没有 alpha.9 安装包、ZIP 或真实打包二进制 fuse 证据。

**打包硬化合同**

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.9`；标准 release、规则、fixer、账号和同步契约未变化；
- 新增 `electron_fuse_policy.js`，明确要求 `asar=true`、禁止关闭 ASAR integrity，并固定 8 个已知 Electron fuse 与 `ResetAdHocDarwinSignature`；配置缺项、多项、漂移、inherit 或 removed 均 fail-closed；
- Windows/macOS 构建在 electron-builder 前验证配置，在 builder 后立即读取真实应用二进制的 fuse wire，再进入打包资源门禁、packaged smoke 和发布证据阶段；
- 二进制验证拒绝仓库外路径、不安全父链、链接、硬链接、空文件和读取竞态；已知 fuse 必须逐项精确匹配；
- 本机 Electron 43.1.0 暴露 9 个 wire 项，而当前 `@electron/fuses` 1.8.0 只定义前 8 项。未知索引 8 不猜测：alpha 返回 `ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING`，sale 直接失败；
- `RunAsNode=true` 仅为现有 Ace helper 的临时兼容状态，受控 helper 完成并实测后必须改为 `false`，不能作为可售卖配置。

**验证与边界**

- fuse 专项 **6/6 PASS**；配置门禁、已知 wire、未知项 alpha/sale 分流、文件身份与构建顺序均有正反向覆盖；
- 最终 `npm test` PASS：Node 284/277/0/7（2.350 秒），Python 348/0/0/3（114.170 秒），墙钟 121.2 秒；
- 标准、Electron runtime、Windows alpha 资源门禁通过；既有 Windows sale 资源门禁仍有 17 项 blocker，未知打包 fuse 是独立的条件阻断；
- alpha.9 隐藏源码 smoke PASS：`out/source-smoke/runs/ms49yas5-9ccb167e78f033a2/projects/`；DOCX/EPUB 各 4 次检查、1 次修复、3 个检查点且原稿哈希不变，PDF 251,650 / 177,417 字节；
- 本轮没有联网、没有下载 builder 归档、没有运行真实 packaged fuse 验证，也没有生成 NSIS、ZIP、SHA 文件或 release manifest。

### 2026-07-28 — 0.1.0-alpha.8（ChatGPT 统一账号与 SyncRecord v1 离线契约检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.8`。该标签只表示经本地验证的源码状态；生产账号、同步服务、安装包和可售卖发行版均不存在。

**账号、权益与同步边界**

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.8`；标准 release、35 条规则和 6 个白名单机械 fixer 未变化；
- AuthProvider 固定系统浏览器 PKCE 生产模式并实现可测试的登录/退出/过期/撤销状态；生产未配置时不打开页面、不联网；
- LicenseProvider 固化 Free/Pro 能力矩阵和有效期/宽限期状态计算；模拟授权不冒充签名证据，过期不锁本地项目或既有导出；
- 新增 Python 只读 `sync-source`、Electron `SyncRecord v1` exact validator 和 tracked JSON Schema；正文、标题、摘要、预览、文件名、路径、参考文献原文、哈希和内容指纹均无允许字段并有反向测试；
- 新增同步 IPC/preload：Renderer 只能请求可信项目来源并提交固定选择/队列 ID，不能拼装 payload、持有令牌或发起网络；
- 导出后仅在 authenticated 状态非阻断打开逐字段预览；四种选择为仅本次、同步本次以后仍询问、暂不同步、不再询问此项目；
- 当前进程内队列支持幂等、取消、重试和删除，状态固定为 `pending_transport`；生产 transport、持久队列、Supabase、支付和网站后台仍未实现。

**验证与边界**

- 账号/同步专项、IPC、UI、Python 核心来源和 JSON Schema 一致性测试通过；最终统一测试计数见 `docs/TEST_REPORT.md`；
- 标准、Electron runtime 和 Windows alpha 资源门禁通过；Windows sale 门禁仍保留 17 项 blocker，macOS 静态门禁仍拒绝缺失双架构资源；
- alpha.8 沙箱外隐藏源码 smoke PASS：`out/source-smoke/runs/ms48q9hr-05f6b99b193cf33d/projects/`；DOCX/EPUB 各 4 次检查、1 次修复、3 个检查点且原稿哈希不变，PDF 251,660 / 177,267 字节；
- 本轮没有联网、没有下载 builder 归档、没有生产账号/同步请求，也没有 alpha.8 NSIS、ZIP、SHA 文件或 release manifest。

### 2026-07-28 — 0.1.0-alpha.7（ChatGPT Windows 发布制品证据链检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.7`。该标签只表示经本地验证的源码状态；当前没有 alpha.7 安装包、ZIP 或可售卖发行版。

**发布制品证据链**

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.7`；标准 release 与规则能力均未变化；
- 新增 `release_artifact_manifest.js`，只接受当前 `package.json` / lockfile 一致版本的精确 Windows x64 NSIS 与 ZIP 文件名，拒绝缺失、格式错误、同系列旧制品、链接/硬链接、路径逃逸和读取期间身份变化；
- `SHA256SUMS.txt` 以固定顺序记录两件制品的完整 SHA-256；canonical `release-manifest-win32-x64.json` 同时固定产品/appId/版本/目标、种类、字节数、制品摘要与 SHA 文件原始字节摘要；验证器重新读取制品并交叉复核全部字段；
- 两份证据以独占候选、`fsync` 和联合提交生成；第二次换入或最终复验失败会恢复两份旧证据。构建开头先预检并清除旧证据，只有 packaged 资源门禁与隐藏 smoke 成功后才生成新证据；
- 新增显式 `release:evidence:clear:win`、`release:evidence:win` 和 `release:evidence:verify:win` 命令；真实 `release/` 因缺 alpha.7 NSIS 而按预期 fail-closed。

**验证与边界**

- 发布证据专项 6 项：5 通过、0 失败、1 项因 Windows 文件 symlink 权限条件跳过；统一 `npm test` 为 Node 267/260/0/7（2.487 秒）、Python 344/0/0/3（80.833 秒），墙钟 88.1 秒；
- 标准、Electron runtime 与 Windows alpha 资源门禁均 PASS；Windows sale 门禁仍有 17 项 blocker，macOS 静态门禁仍精确拒绝两架构缺失资源；
- alpha.7 独立隐藏源码 smoke PASS：`out/source-smoke/runs/ms47c3l8-9b6bf78452308a33/projects/`；DOCX/EPUB 均 4 次检查、1 次修复、3 个检查点且原稿哈希不变，PDF 251,656 / 177,263 字节；
- 本轮没有联网、没有下载 builder 归档、没有真实工具树/tracked lock，也没有生成 NSIS、ZIP、SHA 文件或 release manifest。

### 2026-07-28 — 0.1.0-alpha.6（ChatGPT Windows builder 受控下载检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.6`。该标签只表示经本地验证的源码状态，不表示已经下载真实构建工具、生成安装包或正式发行。

**受控归档取得**

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.6`；标准 release 保持 `oak-standards 2.0.0` / `oak-rules 2.0.0`；
- 三份 builder 来源合同新增固定 electron-builder 官方 GitHub release URL；只允许 HTTPS、固定仓库路径/文件名及 GitHub release asset 主机重定向；
- 新增 `npm run download:builder:win` 显式联网入口；CLI 缺少 `--allow-network` 时在创建目录或请求前失败，普通 build/test/dist 不调用下载器；
- 下载候选限定在仓库内，采用独占创建、容量/超时/重定向上限和 `fsync`；三份候选全部验 SHA-256 后才事务提交，已有正确文件复用，错误文件、未知条目、链接、路径逃逸或并发碰撞均 fail-closed，不覆盖既有文件；
- 新增 11 项下载器测试，覆盖无授权零写入、URL/redirect 边界、错误哈希零落盘、提交回滚和目录安全。

**验证与边界**

- 最终 `npm test`：PASS；Node 261/255/0/6（2.627 秒），Python 344/0 failures/0 errors/3 skipped（89.446 秒），墙钟 97.2 秒；
- `verify:standards`、`verify:electron-runtime`、Windows alpha 资源门禁均 PASS；macOS 静态门禁仍按预期失败，Windows sale 门禁仍有 17 项 blocker；
- 独立隐藏 Electron 源码 smoke PASS：`out/source-smoke/runs/ms46fhdh-230a41fd46481179/projects/`；DOCX/EPUB 均完成 4 次检查、1 次批量修复、3 个检查点并保持原稿哈希，PDF 251,661 / 177,434 字节；
- 本轮未获联网授权，未发出网络请求、未下载三份真实归档，未生成工具树、tracked lock、NSIS、ZIP 或任何可分发制品。

### 2026-07-27 — 0.1.0-alpha.5（ChatGPT 默认引用解析与标准包 2.0.0 检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.5`。该标签只表示经本地验证的源码状态，不表示已经生成安装包或正式发行。

**默认引用体例解析**

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.5`；内置标准 release 升级为 `oak-standards 2.0.0` / `oak-rules 2.0.0`（sequence 2），35 条规则和 6 个机械 fixer 的能力范围不变；
- 新增纯本地、确定性的引用结构信号解析器，根据编号引用、作者—年份、注释—书目和语言证据选择 GB/T 7714—2025、APA 7、Chicago 18 注释—书目或作者—日期；强/中阈值固定为 3/2 个唯一信号与 80%/50% 覆盖率；
- 结构冲突、证据不足或 EPUB 只能部分提取时不强行套用体例，退回 `structure_only`；报告记录模式、原因、置信度、解析器版本和纯数量证据，不保存稿件片段、姓名、引用原文或本地路径；
- 新增严格只读的 `plan-citation`、绑定项目/工作稿/规则包/解析结果的 `citation-plan-*` 计划，以及 `check --citation-plan-id`。Renderer 会在检查前集中展示解析体例、理由、置信度和实际规则范围，用户一次确认后才检查；
- 六个用户选项保持为 `default | gbt7714-2025 | apa-7 | chicago-18-nb | chicago-18-ad | none`；显式选择原样保留，默认解析在标准包升级后重算。

**标准身份、迁移与界面上下文**

- 2.0.0 canonical manifest SHA-256 为 `0aff75eb181a62869147e9af27330c717bc808bdd23865197534fc9868568427`，规则包为 `098b382e33c06ccddf154940fbbd51db384d8025cf235ed7f7e10e83d34897a4`，能力集为 `af67d0aaf2ece431ec1b617934bdfa3627b6be1b1301a92fcf3b2b2f29ca232e`；rollback target 精确指向 1.0.0 manifest `d33534f0…d7af`；
- 旧项目迁移依赖本地 CAS 中仍保留且通过验证的历史 release；如旧 release 缺失则 fail-closed，不把最新包冒充历史身份；
- `citation_resolution` 作为向后兼容字段写入项目设置、检查快照、机器报告和导出摘要；旧 1.0 项目可缺失该字段，但新检查结果必须相互一致；
- 切换稿件或项目目录时清空上一项目的会话、引用计划与结果状态，修复第二份稿件误复用前一项目的真实 UI 缺陷。

**验证与界限**

- Node 分项回归：250 项、244 通过、0 失败、6 条件跳过、2.650 秒；Python：344 项、0 失败、0 错误、3 条件跳过、80.191 秒；
- `verify:standards`、`verify:electron-runtime` 与 Windows alpha 资源门禁 PASS；Windows sale 门禁仍以 17 项 blocker 失败，macOS 静态门禁仍因双架构 Electron/Python/JRE 资源缺失失败；
- 隐藏 Electron 源码 smoke PASS，运行根 `out/source-smoke/runs/ms44nzhb-8186d1b3c5148eba/projects/`；DOCX/EPUB 均完成引用计划确认、4 次检查、原稿哈希复验、批量修复/恢复/导出/PDF 闭环；PDF 分别为 251,646 / 177,416 字节；
- 本轮未联网，未生成 alpha.5 NSIS、ZIP 或 macOS 制品，未运行 packaged smoke、干净系统、签名、公证或可售卖验收。

### 2026-07-27 — 0.1.0-alpha.4（ChatGPT Electron 与 builder 构建输入可信链检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.4`。该标签只表示经测试的源码状态，不表示已经生成安装包或正式发行。

**Electron 运行时固定锁**

- 将 APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.4`；规则包与标准内容不变，仍为 `oak-rules 1.0.0`、release sequence 1；
- 新增 `config/tool-manifests/electron-43.1.0-win32-x64.json` 与只读默认验证器，固定 2 个目录、75 个文件、364,083,658 字节；manifest SHA-256 为 `ae67132b95e21b62450fd0e34faaf00164514b38322076c56e37c0301c520d95`；
- tracked manifest 使用严格 JSON 拒绝重复键、以 exact schema 拒绝未知字段，并要求生成器定义的唯一 canonical UTF-8/LF 原始字节；
- `electronDist` 在把本地 Electron 交给 electron-builder 前强制验证 package-lock、完整目录/文件树、大小和 SHA-256；缺失、多出、篡改、硬链接、Node 可识别的 symlink/junction/reparse 或路径逃逸均拒绝，并返回不存在的 sentinel，禁止下载回退；
- 显式 `--update-lock` 先验证安全父链并拒绝目标 symlink/hardlink，再以独占候选文件、`fsync`、原子替换和换入后复验更新；任何失败恢复旧字节，回滚自身失败则明确报错并保留事务证据；
- 源码与打包资源门禁都重新核对仓库源码构建输入，不信任可写 packaged resources 自报；因此仅关闭 `ELECTRON_RUNTIME_TRUST_ROOT_NOT_HARDENED`，官方来源/再分发审计和签名阻断继续保留。

**Windows builder 安全导入合同**

- 固定 `nsis-3.0.4.1.7z`、`nsis-resources-3.4.1.7z`、`winCodeSign-2.6.0.7z` 的名称与 SHA-256，新增显式、一次性的离线安全导入器；普通 build/test 不会调用、下载或自动刷新它；
- 导入器固定本地 7z 可执行文件和 DLL，解压前后拒绝路径逃逸、Windows 保留名、冲突路径、链接、备用流、加密/反条目、异常容量、硬链接及清单漂移；UNC/device 归档目录在任何读取前拒绝；
- 工具树 `manifest.json` 与 `config/tool-manifests/electron-builder-win32-x64.json` 独立 tracked lock 交叉绑定来源归档、原始 manifest 字节和完整文件树。只有显式 `--update-lock` 才能写入 tracked lock；工具树和 lock 作为同一事务换入；
- 修复安全审计发现的两项 P1：不安全祖先路径在读取前立即终止；旧工具树和旧 lock 在任何 rename 前执行父链、realpath、单链接及全树检查。四个前向 rename 与四个回滚 rename 均有故障注入；前向失败完整恢复，回滚自身失败明确报错并保留恢复证据。

**验证与边界**

- 最终 `npm test` 统一回归：Node 239 项、233 通过、0 失败、6 条件跳过、2.606 秒；Python 312 项、0 失败、0 错误、3 跳过、80.125 秒；
- Electron runtime 锁专项为 37 项、36 通过、0 失败、1 条件跳过；hardlink 与 junction 反向路径在本机实测通过，文件 symlink 因 Windows `EPERM` 条件跳过，不计作通过；
- 沙箱外隐藏 Chrome 真实 Ace：312 项、0 失败、0 错误、1 跳过、44.807 秒；受限沙箱无法产生安全报告时按设计失败，不能冒充通过；
- 隐藏 Electron 源码 smoke PASS，输出为 `out/source-smoke/runs/ms37h0mu-201a90896825d190/projects/`；DOCX/EPUB 均保持原稿哈希、各含 4 次检查，PDF 分别为 258,404 / 161,836 字节；
- `verify:standards`、`verify:electron-runtime` 与 Windows alpha 资源门禁 PASS；sale 门禁仍按设计以 17 项 blocker 失败；macOS 静态门禁仍因两架构 Electron/Python/JRE 资源缺失失败；
- 本机没有三份真实 builder 归档，因此没有生成工具树、独立 tracked lock、NSIS 或 ZIP；builder 包装器在 electron-builder 启动前 fail-closed。全程未联网，也未运行 packaged smoke、干净系统或签名验收。

### 2026-07-27 — 0.1.0-alpha.3（ChatGPT 标准可信链与项目升级检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.3`。该标签只表示经测试的源码状态，不表示已经生成安装包或正式发行。

**标准资产与可信存储**

- 将 APP、Python 核心和 lockfile 统一为 `0.1.0-alpha.3`；规则包仍独立保持 `oak-rules 1.0.0`、release sequence 1；
- 将标准注册表升级为 schema 2.0，补充生命周期、发布者、审核角色、版权使用、替代关系、规则反向关联、来源核验状态与变更历史，删除书稿/EPUB 占位摘要；
- 新增 35 规则/6 fixer 精确能力清单和 canonical standard release manifest；manifest SHA-256 为 `d33534f081b2122a90652ee03304a0e71177a7fd0d3130fffe77b0fea807d7af`，规则包 SHA-256 为 `7ac5a5bdb126e9f5148a040ce42a634b1a95295c27d7a72c774db54bf7129542`；
- 新增严格 JSON/payload 校验、Ed25519 门槛签名、内容寻址存储、release sequence 高水位、撤回/过期/兼容性、签署 rollback target 与内置 release 对账；重复键、非配对 surrogate、路径/URL/日期歧义、未知字段、能力漂移和同序列异身份均 fail-closed；
- 标准根操作进程内串行；跨进程事务使用原子 pending 目录、PID 与随机 process token。活 owner 不抢占，死 owner 仅按严格 intent 恢复，未知变更拒绝猜测；
- `StandardsProvider` 支持离线内置启动、本地签名包预览/安装和全局回滚。生产 trust digest 尚未配置，因此真实本地签名包导入默认禁用；在线检查/下载和生产撤回通道尚未实现。

**项目固定版本与显式升级**

- 项目规则包 pin 扩为七字段 `name/version/pinned/sha256/bundle_id/release_sequence/manifest_sha256`；已有项目先用一次只读、未绑定的 `project-standard-status` 发现 pin，Electron 精确验证对应 release 后，所有实际业务/变更命令均携带 canonical 期望身份，Python 再重验 manifest/payload/CAS；
- 新增 `project-standard-status`、`plan-rulepack-upgrade`、`upgrade-rulepack`。计划绑定项目 manifest/state、source/working、issues、最新检查与目标身份；过期、异项目或横向替换计划拒绝；
- 升级建立检查点、哈希归档旧 issues、原子提交新 pin、记录连续 history，并设置强制重检；全局 active 改变不会静默改变旧项目；
- Renderer 标准页显示项目 pin 与当前 active 的完整差异，只允许一次确认；目标 digest 由主进程选择。升级后清除陈旧状态并自动重检；
- `app:info`、项目、检查记录和导出 `report.json` 的完整身份加入 smoke；源码/打包 smoke 按 `out/*-smoke/runs/<run-id>/` 隔离 userData、标准 store 和项目，防止旧状态污染。
- 修复迁移源错误放宽能力映射的漏洞：迁移仅可放宽撤回、过期与 APP 兼容性，规则 capability digest 和逐规则 milestone/fixer 映射始终强制校验；
- `Project.verify()` 现在逐份解析历史检查报告，校验 UTF-8 JSON 对象、schema、check ID 与各自检查记录的规则包身份；alpha.3 严格核对七字段，alpha.2 及更早记录仅按其真实 `{name, version}` 证据兼容，不把当前 pin 倒填成历史身份。

**验证与边界**

- 原生/沙箱外 `npm test` PASS：Node 186 项、181 通过、0 失败、5 条件跳过；Python 312 项、0 失败、0 错误、3 条件跳过；
- 沙箱外隐藏 Chrome 的真实 Ace 条件套件：312 项、0 失败、0 错误、1 跳过、46.321 秒；受限运行器无法生成安全报告时按设计 `not_run`；隐藏 Electron 源码 smoke PASS，DOCX/EPUB 当前四方身份一致，PDF 为 258,400 / 161,845 字节；
- `verify:standards` 和 Windows alpha 资源门禁 PASS；sale 门禁仍按设计保留 18 项 blocker；macOS 静态门禁仍因两架构资源缺失失败；
- `build:win` 完成 JRE/Ace staging 与资源探针后，仅因仓库缺 `tools/electron-builder/win32-x64` 停止；未联网、未生成 alpha.3 NSIS/ZIP，未运行打包 smoke、干净系统或签名验收；
- 标准内容仍非完整：外部来源核验 0 项（12 pending、1 unavailable），4 项外部标准 under_review，真实编辑签核、默认体例结构信号、生产 trust pin 和联网更新均待完成。

### 2026-07-27 — 0.1.0-alpha.2（ChatGPT Windows 离线资源检查点）

> 源码检查点标签：`chatgpt-v0.1.0-alpha.2`。该标签只表示经测试的源码状态，不表示已经生成安装包或正式发行。

**Windows alpha 运行资源与可信门禁**

- 将 APP、Python 核心和 lockfile 版本统一为 `0.1.0-alpha.2`；源码 smoke 新增应用版本身份断言，防止旧包或旧源码冒充当前版本；
- Windows x64 嵌入式 Python 运行时纳入 34 个文件、21,260,753 字节的受版本控制全量哈希清单，并校验 `_pth` 隔离语义；只有全部资源校验通过后才运行探针；
- Temurin JRE 纳入 207 个文件、52,384,264 字节的锁定清单；EpubCheck 5.3.0 纳入 49 个文件、36,263,890 字节的完整分发清单，并以好样本/缺陷样本双向验证状态和错误数；
- Ace 1.4.6 形成 236 包、6,672 文件、58,964,235 字节的生产闭包；新增受版本控制的完整阶段 lock，固定所有文件哈希、许可证材料和一个受审核的 XHTML 隔离替换，移除作者脚本并限制加载协议；stage/lock 事务失败会恢复旧目录与旧锁；
- Ace staging 与资源门禁均拒绝空许可证文件；18 个依赖包的生成元数据通知仍不能代替原始许可证审计，且全部生产依赖闭包仍需正式人工审计；
- Python/EpubCheck/JRE/Ace 的 packaged 路径不再静默回退到系统 PATH 或开发树；资源缺失、增删、篡改、平台/架构不匹配均由门禁拒绝；
- Electron、源码 smoke 和资源探针统一用净化环境及 `-I -S -X utf8` bootstrap 调用 Python 核心；macOS x64/arm64 CPython 均固定为 `3.13.14`；
- JRE 运行目录与 tracked lock 作为一个事务换入，目录或锁提交失败时恢复原运行时和原锁字节；
- 对参与字节级信任锁的 manifest 与 Ace 隔离替换强制 Git checkout 使用 LF，并加入跨平台字节稳定性测试，避免 Windows `core.autocrlf` 破坏固定哈希；
- 信任清单与模块列表统一采用与系统 locale/ICU 无关的 UTF-16 code-unit 顺序；
- macOS 已拆分 x64/arm64 原生 runner，并提供明确不执行运行时探针的跨主机静态聚合；对应 Electron/Python/JRE 资源尚未准备，不能据此声称 macOS 已通过运行验证、可构建或可安装。

**项目、IPC 与桌面安全收口**

- Electron 默认 session 启动即应用离线 Chromium switches，并拦截 `http/https/ws/wss/ftp`；Renderer 继续使用固定 CSP，未来获授权的联网 Provider 不得放宽默认 session；
- 源码 smoke 的项目、临时目录、用户数据、缓存与崩溃目录全部收敛到 `out/source-smoke/`，并拒绝项目外 Electron 或输出路径；
- PDF 样张迁入非持久、无缓存隔离 session，禁用 JavaScript、导航、新窗口与网络；加载的 HTML 在打印前复核文件身份，PDF 经项目/`exports` 父链身份验证后同目录暂存、`fsync` 并原子换入；
- Python 项目打开增加完整 schema、固定子目录、清单控制路径、source/working 独立性、链接/联接/硬链接与哈希校验；所有变更型 CLI 命令统一使用非阻塞跨进程内核写锁，争用返回结构化 `PROJECT_WRITE_LOCKED`；
- `create` 锁前只读预检且失败零污染；锁内只打开一次用户输入，以同一文件描述符复制到 `source`，再由受控 `source` 生成 `working`。允许最终目标为常规文件的只读 OneDrive/reparse/symlink 输入，复制期间变化或失败时只清理本事务创建内容，并保留已有空目录或恢复旧协议锁字节；
- 自选导出目录逐级拒绝链接/联接，项目内自选目录只允许位于 `exports/`；全部目标在首个字节前预检，硬链接目标 fail-closed，每个输出文件以同目录暂存和原子换入；
- Electron 桥明确区分退出码 1 的有效业务结果与退出码 2 的运行错误，并保留 Python 结构化错误的 `code/message/retryable/details`；
- CPython 探针改为核对 implementation、完整三段版本、releaselevel 和 serial；Ace full lock 同时固定 manifest 原始字节身份，语义等价的字节漂移也拒绝。

**验证与发布边界**

- 原生/沙箱外 `npm test` 统一入口 PASS：Node TAP 共 99 项，96 通过、0 失败、3 项 Windows symlink/junction 权限条件跳过；Python 默认共 270 项，0 失败、0 错误、3 项条件跳过；
- 沙箱外隐藏 Chrome 的 `OAK_TEST_ACE=1`：270 项、0 失败、0 错误、1 项条件跳过、36.112 秒；受限沙箱内 Chrome 超时按设计 fail-closed，不作为工具通过或代码失败；
- 沙箱外隐藏 Electron 源码 smoke：`SMOKE-RESULT: PASS`；输出严格位于 `out/source-smoke/projects/`，DOCX/EPUB 完成检查、集中预览、批量修复、恢复和再次修复，两个项目均保持 `source_hash_ok=true`；PDF 为 258,394 / 161,830 字节；
- Windows alpha 资源门禁实际执行运行时探针并通过；sale 门禁按设计以 18 项 blocker 失败，覆盖许可证/来源审计、运行与应用资源可信根、Electron/builder 输入、Ace helper/browser/OS 网络隔离和 Windows 签名；
- 经批准的提升权限 `build:win` 完成本地 JRE/Ace staging 和 Windows alpha 资源探针后，仅在缺少 `tools/electron-builder/win32-x64` 处停止；没有联网，也没有生成 alpha.2 NSIS 或 ZIP；打包版 smoke、干净系统验证和签名尚未运行；
- macOS 跨主机静态门禁可执行但按预期 FAIL：缺 darwin-x64/arm64 Electron dist、两架构 Python runtime 锁和两架构 JRE；不能据此声称 macOS 可构建或已发行；
- 本条只记录源码、资源和门禁进展；旧 0.0.1 分发物不是 alpha.2 产物，可售卖正式版仍未达到。

### 2026-07-26 — 0.1.0-alpha.1（ChatGPT 商业正式版开发线）

**可信批量修复 P0**

- 新增只读 `plan-fixes` 和强制 `plan_id` 的 `fix` 契约；UI 在一个可滚动界面集中展示本批全部修改前/后内容，一次确认后整批执行；取消零写入；
- 离散 TAB 逐位置展示，任一 rejected 同类问题会阻断整个全文 fixer，避免修改未展示或已拒绝位置；
- 修复在临时 working 副本执行，working / issues / project 提交失败时回滚；已有 5 个检查点时恢复被裁剪目录；
- 检查点升级为 working + issues + 项目状态 + 检查结果快照，新增列表、安全恢复、撤销上次批量修复和损坏项禁用；
- 新增 `list-checkpoints` / `restore-checkpoint` CLI，Electron 只暴露四个固定 P0 IPC；修复 sandbox preload 本地模块引用回归；
- APP、Python 核心与 lockfile 版本统一为 `0.1.0-alpha.1`；测试统一入口改为 `npm test`。

**方案与审计**

- 新增商业正式版权威方案 `v2.0-ChatGPT`：Windows/macOS/Web、统一湖岸账号、有限 Free+Pro、结果与元数据同步、服务端 Web 处理、签名标准升级和正式发布门禁；
- 新增内置标准完整性审计：当前 13 条注册表 / 35 条规则是最小库，不得宣传为完整标准库；
- 修正旧报告“185 + Ace = 186”错误；Claude 0.0.1 现场结果是同一套 185 项在启用 Ace 后从跳过变为执行。

**验证**

- Node：12/12；Python：210 项，默认 1 项 Ace 跳过，启用 Ace 后 210 项无跳过；
- 隐藏 Electron smoke：DOCX 21→5→16、EPUB 7→2→5，覆盖取消、确认、撤销、重新应用、导出、PDF 和 verify，PASS；
- 0.1.x Windows 新包、NSIS、macOS、Web、账号/订阅/同步和标准更新器仍未完成，不属于本条已完成范围。

### 2026-07-11 — 阶段 2 完成 + 阶段 3 部分完成（0.0.1 内部开发版）

**阶段 2：桌面 APP MVP**
- Electron 43 壳：安全基线全项（contextIsolation / sandbox / IPC 白名单 + 输入验证 / shell=false / CSP / 导航拦截 / 外链白名单）；python-bridge（UTF-8 JSON 契约直连核心 CLI）；Provider 全占位不联网；
- 七个中文主页面（§7.1）：欢迎隐私 / 创建项目 / 检查目标 / 阶段式进度 / 问题双栏（接受·拒绝·暂不处理）/ 导出中心 / 标准资源与设置；登录入口「即将开放」；
- PDF 审阅样张（printToPDF ≤16 页）；`npm run smoke`：DOCX + EPUB 双闭环走真实 UI 代码路径，PASS；
- 修复：productName 含斜杠导致 Electron userData 路径初始化崩溃（0xC0000005）。

**外部验证与导出补全**
- EpubCheck 5.3.0 下载接入（Java 21）：`external` 子命令 + UI 按钮，状态真实写回报告（passed/failed/not_run + 明细）；其发现并修复了生成器缺 dcterms:modified 的真实缺口；
- Ace 1.4.6 接入（跳过内置 Chromium，本机 Chrome 驱动）；
- 新增脱敏出版评估摘要导出（§8.4 字段白名单 + 泄露断言测试）。

**阶段 3：打包**
- Windows x64 便携 ZIP（electron-builder）：捆绑 Python 3.13.14 嵌入式运行时 + 核心 + 规则包 + 样本 + EpubCheck，解压即用；应用图标（零依赖生成）；SHA-256 校验值与发布说明（RELEASE_NOTES_0.0.1.md）；打包版 --smoke 双闭环 PASS。

测试：175 → **185 项**（+Ace 慢测 1 项按需启用）。

### 2026-07-11 — 阶段 1 M3 完成（阶段 1 收官）

- EPUB 读取器：mimetype 三要件校验、container→OPF、必需元数据、nav、内容文档 lang / img / 链接锚点（复用 ZIP 安全层）；
- 6 条 EPUB 规则实现（冻结定义零变更）；Issue location 新增可选 `resource` 字段与 `package` 部位（向后兼容扩展，见 SPEC_MODELS 附注）；
- 白名单按纪律扩至 6 条封顶：FIX-EPUB-MIME-001（重建首位不压缩）、FIX-EPUB-LANG-001（按 dc:language 补齐，语言未知不补写）；`apply_fixes` 按格式分发；
- 基础 EPUB 导出（`--epub-preview`）：产物经本核心 EPUB 检查自检零问题；
- EpubCheck / Ace 保持「未运行」如实标注（真实接入待用户授权外部工具下载）；
- 新增 epub_good / epub_needs_review 样本；测试 135 → **175 项**全通过；CLI 实跑 EPUB 闭环与预览导出验收。

### 2026-07-11 — 阶段 1 M2 完成

- Markdown / TXT 读取器：ATX 标题、空行分段、围栏代码豁免、BOM/CRLF 容错；文档模型正名 `Document`（保留 `DocxDocument` 别名），段落新增 `page_break_count`；
- 6 条 M2 规则实现（定义沿用冻结规则包，无一变更）：BOOK-STRUCT-001 / BOOK-STRUCT-002（目录归一化比对，容页码引导符）/ BOOK-PAGE-001（≥3 处聚合提示）/ MD-STRUCT-001 / REF-APA-001（括注→条目单向核对，支持 & 与 et al.）/ REF-CHI-001（注释↔书目存在性一致）；
- 引擎里程碑扩至 {M1, M2}；ops/CLI 全流程支持 md / txt 输入，.epub 明确提示 M3；
- 新增 4 个匿名样本（book_good / book_no_structure / book_toc_mismatch / paper_apa_citations.md）；
- 测试 103 → **135 项**全通过；CLI 实跑书稿与 APA Markdown 双闭环验收（TEST_REPORT.md）。

### 2026-07-11 — 阶段 0 完成 + 阶段 1 M1 完成

**阶段 0（基线冻结）**

- 冻结项目文件格式 v1.0（SPEC_PROJECT_FORMAT.md）与问题 / 规则 / 标准三模型 v1.0（SPEC_MODELS.md）；
- 冻结规则包 oak-rules 1.0.0：35 条规则（M1 23 / M2 6 / M3 6），自动修复白名单 4 条；「默认」体例映射 v1.0.0；
- 标准注册表 standards.json（12 条：官方 4 + 湖岸解释 8）；
- 匿名样本库：确定性生成脚本 + 3 个 DOCX 样本（好 / 缺陷 / 结构缺失，缺陷↔规则对照登记）+ MD/TXT。

**阶段 1 M1（DOCX + 论文 + GB/T 7714—2025 命令行闭环）**

- 检查核心 `oak_manuscript_core`（Python 3.11+，零第三方依赖）：项目管理（只读原稿 + SHA-256 + 检查点≤5）、DOCX 读取器（ZIP 三类上限与穿越防护）、确定性规则引擎、白名单机械修复（幂等）、三格式报告 + 修订稿导出、CLI（create/check/fix/recheck/export/verify/issue，UTF-8 JSON 契约）；
- 统一测试入口 `python scripts/run_tests.py`：103 项测试全通过；
- M1 验收全项达成（ACCEPTANCE.md），Word COM 实测修订稿正常打开。

**文档与方案**

- 方案升级 v1.2：完成 oak-publishing-system 与 netlify-site 只读核对，落实全部「待核实」标注；
- 仓库基线：§19 目录骨架、AGENTS.md、七份 docs 骨架。
