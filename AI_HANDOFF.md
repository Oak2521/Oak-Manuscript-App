# AI_HANDOFF — 湖岸稿件（Oak Manuscript）项目交接说明

> 最近更新：2026-07-28
> 当前开发方：ChatGPT Codex
> 当前版本：`0.1.0-alpha.27`
> 当前分支：`chatgpt/commercial-v1`
> 本地检查点标签：`chatgpt-v0.1.0-alpha.27`（源码、SQL 静态契约与离线仿真检查点；最新未签名 Windows 制品仍是 alpha.23）

## 1. 权威入口与工作区

商业正式版的唯一需求权威是：

`docs/湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md`

Claude v1.2 方案和 0.0.1 实现是历史基线，不再覆盖 v2.0 的商业化、跨端、账号、同步和标准升级决策。

当前独立开发克隆：

`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`

只读完整基线：

`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\baseline\claude-0.0.1-full`

基线来源说明及哈希：

`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\BASELINE_PROVENANCE.md`

源 Claude 仓库、`oak-publishing-system`、`netlify-site` 和商业计划书目录均只读。所有开发、测试和构建产物只能留在当前克隆目录。

## 2. 当前现场事实

### 已完成：0.1.0-alpha.27 持久任务与幂等数据库检查点

- 新增 Supabase/Postgres 迁移 `web/supabase/001_web_job_state.sql`：任务与幂等墓碑表不保存稿件字节、文件名、路径或正文；两表强制 RLS，浏览器 `anon/authenticated` 无表/RPC 权限，固定 RPC 仅授予 `service_role`；
- 创建/重放 RPC 在全局与账户 advisory transaction lock 内原子检查幂等指纹、终态墓碑、UUID 碰撞和账户/全局并发；内部状态以 revision CAS 更新，删除在同一事务把幂等记录改为 content-free 终态再移除任务；
- 新增 `web/supabase-job-repository.js` 和两份 Web 私有 exact schema。适配器只调用六个固定 HTTPS PostgREST RPC，service-role key、请求超时和响应体均有界；上游错误不反射凭据或响应内容；
- 新增 `PersistentWebJobService`。创建、读取、上传预留、处理租约、结果状态、删除待办、墓碑与 TTL 扫描均可跨服务实例恢复；稿件输入/输出仍只进入临时内容 store。CAS 失败后的孤立输入会立即删除，删除失败保持 `deletion_pending` 并可在重启后重试；HTTP handler 已兼容异步持久服务；
- repository/持久服务专项 16/16、全部 Web 85/85 PASS。最终 `npm test` 110.1 秒：Node 455 total / 448 pass / 0 fail / 7 skip（3.604 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（101.848 秒）；
- 资源清单仍为 78 文件 / 2,124,858 字节，manifest SHA-256 `96325d13cb112cf32ec572baed250d0ead5b54b15b0a4dba9da2d0c11ccdfe13`，锚点 SHA-256 `5e5038781d4a508e468d297e2fc8218aca0dc0a97b77c8d7aab0417fa90a21dd`；
- 本轮没有联网、没有执行真实 Supabase 迁移、没有配置/读取 service-role key、没有连接 Netlify store、官网或用户稿件，也没有部署、修改网站或重新打包。真实 Postgres 语法/事务/RLS、多实例、平台故障与备份恢复仍未验收；私有 worker、恶意文件门禁、短时下载和生产三路零留存仍未完成。

### 已完成：0.1.0-alpha.26 Netlify 临时对象存储检查点

- 新增 `web/netlify-ephemeral-storage.js`。站点级 store 强制 `consistency:"strong"`；对象键只允许固定 prefix + 规范 `webjob-UUID` + `input|output`；写入用 `onlyIfNew:true`，metadata exact 固定对象类型、任务号、到期时间、媒体类型与字节数；
- 模糊网络失败与重复写只有在强一致回读的字节及 metadata 完全一致时才视为幂等恢复；不一致对象绝不覆盖。输出读取重新校验 metadata 与长度，删除后再以强一致 metadata 读取确认不存在；
- 独立 `sweepExpiredObjects()` 分页扫描固定 prefix，删除已到 `delete_at` 的对象。规范任务键的 metadata 确认损坏则优先删除；metadata 暂时不可读时保留对象并进入 content-free pending，删除无法确认同样 pending；未知键只计数。Netlify Blobs 没有替本项目提供原生 TTL，生产必须调度清扫器；
- SDK 位于独立 `web/` 私有子包，不进入 Electron 根依赖。精确锁定 `@netlify/blobs 10.1.0`；候选 10.7.10 因 `@opentelemetry/core 2.7.1` 的 W3C Baggage 无界内存分配中危告警被撤回。10.1.0 本地类型仍覆盖条件创建、强一致读和分页，最终 `npm audit --prefix web --omit=dev` 为 0 个已知漏洞；
- Netlify 专项 8/8、全部 Web 69/69 PASS。最终 `npm test` 110.7 秒：Node 439 total / 432 pass / 0 fail / 7 skip（3.522 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（102.559 秒）；
- 资源清单仍为 78 文件 / 2,124,858 字节，manifest SHA-256 `9eab5d23bf54218746def9ea4f9be5c71380bf02af71df0204b4b592f4a1c150`，锚点 SHA-256 `80dd736236b81f77a94309842631f93bcd7b9e125f39fc8ac296bd7a9a909881`；
- 本轮仅 npm 下载/审计获授权并发生；没有连接 Netlify store、真实 Supabase token、官网或用户稿件，没有部署、修改网站或重新打包。持久任务数据库、私有队列/worker、恶意文件门禁、短时下载和生产三路零留存仍未完成。

### 已完成：0.1.0-alpha.25 GoTrue 验证、Fetch 桥与 Web 工作台检查点

- 新增 `web/gotrue-verifier.js`。部署配置只能给出规范 HTTPS Supabase origin 与安全有界 API key；验证器固定 GET `/auth/v1/user`、不带 Cookie、不跟随重定向、默认 5 秒超时、响应上限 64 KiB，只输出冻结的 exact `{subject_id}`；无效/过期 token 返回未认证，上游限流/5xx/网络/超时/畸形响应使用不反射秘密的稳定错误；
- 新增 `web/fetch-adapter.js`，将标准 Fetch `Request/Response` 转为既有 Node handler 边界，流式上传继续通过读取前的 HTTPS、同源、会话、长度/MIME 与预留门禁。端到端测试覆盖 Fetch → GoTrue → Supabase resolver → handler → job；
- 新增 `web/client/`：同一页面保留官网登录、注册和账户入口；支持 DOCX/EPUB/Markdown/TXT、论文/纸质书/电子书、快速/完整检查与六种引用选择，其中“默认”由检查类型和本地结构自动解析；每个任务必须勾选临时处理同意，随后可创建、上传、轮询、取消和下载；创建 JSON 不含文件名/路径；
- Web 工作台明确写出生产处理、订阅和结果同步尚未接通；同步区仍禁用，未把登录等同于同意同步。桌面 1440px 和真实 390px 窄屏均用拦截全部网络请求的无界面 Chrome 渲染复核；
- Web 定向 61/61 PASS。最终 `npm test` 111.2 秒：Node 431 total / 424 pass / 0 fail / 7 skip（3.566 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（102.909 秒）；
- 资源清单仍为 78 文件 / 2,124,858 字节，manifest SHA-256 `5df48f104e75b11f149be9ea1749738fc3d859bfd8f8bad66d17bf5a3a68e1dc`，锚点 SHA-256 `944ec0b152eaf08ccc385769d660396fbe63bff9a73d69a199d8e6e9dee40371`；
- 本轮没有联网、没有修改官网、没有部署 Netlify Function、对象存储、隔离 worker、计费或长期结果同步，也没有重新打包。GoTrue 请求只在注入 fetch 的自动测试中模拟；最新真实 Windows 制品、packaged smoke 与安装只读预检仍属于 alpha.23。

### 已完成：0.1.0-alpha.24 Supabase Bearer 会话适配检查点

- 2026-07-28 只读复核官网 `netlify-site`：浏览器由 Supabase JS 保存/刷新会话，调用 Netlify Functions 时显式发送 `Authorization: Bearer <access_token>`；服务端 `_shared/supabase.mjs` 用 GoTrue `/auth/v1/user` 验证 token。网站目录未修改；
- 新增 `web/supabase-session-adapter.js`。唯一且有界的 Bearer token 只传给注入 verifier；verifier 必须返回 exact `{subject_id}`，适配器只生成冻结的 `{principal:{kind:"account",subject_id},auth_mode:"bearer"}`。token、角色、邮箱和完整 user 不进入 handler、状态机或审计；
- handler 会话契约区分 `bearer` 与 `cookie`。两者均要求 HTTPS，写操作均要求精确同源 Origin，且响应无 CORS；Cookie 模式保留 timing-safe CSRF，纯 Authorization Bearer 不额外建立 CSRF 状态。重复/合并/畸形 Authorization、无效 token、身份字段夹带和 verifier 故障均有反向测试；
- 定向 `web_http_handler` + `web_supabase_session_adapter` 为 25/25 PASS。最终 `npm test` 167.2 秒：Node 413 total / 406 pass / 0 fail / 7 skip（4.483 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（104.577 秒）；
- 版本更新首次全量在资源信任门禁按设计拒绝旧锁；显式更新并复验后仍为 78 文件 / 2,124,858 字节，manifest SHA-256 `c84e051d22986a5c495b932991e71d87cf807eb2fb1adcc55823a6c2ecab2cbf`，锚点 SHA-256 `bbc5c905bcebbbb5feb08ebaa73d86e728e8f832b2dc55181f88abd33efd6a25`；
- 本轮没有联网、没有修改官网、没有生产 Supabase verifier、监听器、存储、隔离 worker、计费或官网 UI，也没有重新打包。最新真实 Windows NSIS/ZIP、packaged smoke 和安装生命周期只读预检仍属于 alpha.23。

### 已完成：0.1.0-alpha.23 同源 HTTPS Web 作业 handler 边界检查点

- 新增 `web/http-handler.js`：固定 `/manuscript/api/v1/jobs` 下的创建、状态、输入上传、结果下载、取消和删除动作，不启动监听器、不暴露 worker 开始/完成路由；
- handler 要求规范 HTTPS origin、可信 exact `{principal, csrf_token}` 会话、状态变更的精确同源 Origin/CSRF 和可选 Fetch Metadata；反向代理适配器不得直接信任客户端 `X-Forwarded-Proto`；
- 上传要求唯一 `Content-Length`，拒绝 `Transfer-Encoding`、文件名、`Content-Disposition` 与内容摘要头；`reserveUpload` 在读取稿件字节前校验大小/MIME/并发并防止第二接收者，读取失败释放预留；
- 新增 `web-http-error-v1` 与 `web-http-audit-v1` exact schema。错误文案固定、不反射内部异常；安全审计只含请求 ID、时间、方法、路由模板、状态和错误码，不含主体、任务 ID、URL、请求头或稿件信息，接收器故障不改变响应；
- Web HTTP/状态机定向 36/36 PASS；最终 `npm test` 110.2 秒：Node 406 total / 399 pass / 0 fail / 7 skip（3.532 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（102.040 秒）；
- 资源清单 78 文件 / 2,124,858 字节，manifest SHA-256 `0105de22837471dcf3ccd35749119b8bcefe6b3764e6068f6e9032342b449241`，锚点 SHA-256 `6826bcf221d1a0677ca1c11147326819d941cfac0b2c1fc07d4dbdabc3548d3c`；
- 首次受限环境完整 build 在 packaged smoke 因 Electron GPU 子进程 `0xC0000135` 失败，未生成发行证据；相同制品在沙箱外隐藏 smoke 通过。随后沙箱外完整 `npm run build:win` 199.8 秒退出 0，packaged smoke 根 `out/packaged-smoke/runs/ms536bic-c319680eda532edb/projects/`；source smoke 根 `out/source-smoke/runs/ms53795z-b2585a5fb6c1720a/projects/`；DOCX/EPUB 均 4 次检查、1 批修复、3 个检查点且原稿哈希不变；
- 最终 NSIS 189,995,462 字节、SHA-256 `3ae05010f979d0358476a341b476a13381de79faa012f9d8cdcb92784da0ad3d`；ZIP 233,814,202 字节、SHA-256 `625b0fea28b185985eed784d8b572565ff7ef85ffefb54be3938bd0a47248d05`；`SHA256SUMS.txt` SHA-256 `2d6d21c3c9329bfbd827f602397db625f26e0183001072c6395d41ab28b03e2b`。六项文件已逐项复验并归档至 `release/archive/0.1.0-alpha.23-final/`；
- alpha.12 → alpha.23 安装生命周期只读预检 PASS，`authorized=false`，没有启动安装器。本轮没有联网、生产 Supabase 会话、监听器/反向代理、对象存储、隔离容器、恶意文件门禁、计费或官网 UI；不能称为可用网页版或生产零留存完成。

### 已完成：0.1.0-alpha.22 Web 临时作业契约与零留存状态机检查点

- 新增 `web/job-contract.js` 与创建/状态/删除三份 exact schema。账号或匿名主体必须由可信会话层独立传入；请求不能自报账号、携带 token、文件名、路径、正文、片段、内容哈希或未知字段；单任务处理同意必须明确且时间有效；
- 上传 Buffer 只进入临时存储适配器，公开状态和观察事件不含主体或稿件元数据。每主体/全局并发在接收内容前门禁；大小/MIME 必须和已确认请求一致，运行时上限不得放宽 tracked schema；
- 完成处理先写短期结果并删输入，取消、用户删除和 TTL 清扫删输入/输出，同时把 `deleteAt` 传给存储生命周期兜底。任一删除失败进入 `deletion_pending` 并准确报告仍保留的数据；两类内容都删除后才返回 exact 回执；
- 幂等终态只保留非内容请求指纹，拒绝同键重建或重复计费；同键异请求冲突，UUID 连续碰撞失败关闭；观察事件接收器故障不阻断内容清理。Web 作业不会自动生成或发送 SyncRecord；
- 定向 Web 契约 17/17 PASS；最终 `npm test` 151.3 秒：Node 387 total / 380 pass / 0 fail / 7 skip（3.478 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（102.876 秒）；
- source smoke 根 `out/source-smoke/runs/ms516yi2-6c5eaaae0d6e3493/projects/` PASS；完整隐藏 `npm run build:win` 195.9 秒退出 0，packaged smoke 根 `out/packaged-smoke/runs/ms51i9ei-380951fc1506cffb/projects/` PASS。两个模式的 DOCX/EPUB 均 4 次检查、1 个修复批次、3 个检查点且原稿哈希不变；packaged EPUB 为 EpubCheck 5 error / Ace 8 项失败断言；
- 资源清单 76 文件 / 2,121,245 字节，manifest SHA-256 `85af7fedd3f0c82743f9acb6e7f29241ebc60f9adb90aab33b89c5436a2121dd`，锚点 SHA-256 `ea15d45d39dd7eae24a3f8a323836eb6bf832be5727e34482421d325fd763070`；
- 最终 NSIS 189,993,535 字节、SHA-256 `e50ac4e3e79f426c8f78ee55a234d6a9dd5505f6b5884213a57402f4dc8af1ec`；ZIP 233,812,123 字节、SHA-256 `3214f639af372f84f0eeae4a2c826845abe76e7797d647a1f180f3dbb12a22e3`；`SHA256SUMS.txt` SHA-256 `66542b5bd43aa552f69e732f122c312e6a0c1a94ee90ea5f207b4f81df29d471`。六项发行文件已归档至 `release/archive/0.1.0-alpha.22-final/`；
- alpha.12 → alpha.22 安装生命周期只读预检 PASS，`authorized=false`，没有启动安装器。本轮没有 HTTP 服务、真实上传、Supabase、对象存储、隔离容器、恶意 ZIP/病毒检查、计费或官网 UI；不能称为网页版或生产零留存已完成。

### 已完成：0.1.0-alpha.21 本机加密同步队列与重启恢复检查点

- 新增 `electron/sync-store.js`：SyncRecord 队列状态使用 Electron `safeStorage` / 操作系统安全存储加密，磁盘格式固定为 `OAKSYNC1 + 长度 + 密文`；写入采用同目录独占候选、文件 `fsync`、原子替换、提交后解密复验和 revision CAS，拒绝链接、硬链接、路径逃逸、超限、篡改、非 canonical JSON、短读与读取期间身份变化；
- 持久状态 exact schema 为 `config/schemas/sync-queue-store-v1.schema.json`。账号绑定只保存在加密状态内部；Renderer 永远看不到 `account_id`。队列、幂等键和“不再询问此项目”均按账户隔离；未登录读取返回空集，未登录取消/重试/删除拒绝；
- 生产 `SyncProvider` 强制要求加密持久层。系统安全存储不可用或文件损坏时同步 fail-closed，不创建预览、不保存负载、不发送数据；本地检查、修复和导出继续可用。生产网络 transport 仍未实现、默认禁用，`pending_transport` 不代表已上传；
- 设置页显示本机加密队列状态以及当前账号的队列项，支持取消、重试和删除。全部动态内容只用 `textContent` / `replaceChildren`；退出后不显示任何账号的队列内容；
- source/packaged smoke 现在固定两次启动：第一次在隔离 `userData` 写入一条无稿件内容的合成 SyncRecord，第二次只用同一系统安全存储恢复并核对账户、项目、run、版本和状态。最终源码根 `out/source-smoke/runs/ms50hk0f-79612db60f3fa6f5/projects/`、packaged 根 `out/packaged-smoke/runs/ms50e86n-c12719289316148e/projects/` 均 PASS；packaged 队列文件为 1,960 字节、头 `OAKSYNC1`，密文中不含 store type 或记录 ID 明文；
- 最终 `npm test`：Node 370 total / 363 pass / 0 fail / 7 skip（3.448 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（102.669 秒），整条命令 151.5 秒；
- Windows build 的打包、真实 ASAR/9 fuse/资源门禁、EpubCheck/Ace 与双阶段 packaged smoke 均通过；首次最终证据生成因 `release/` 根残留已归档的 alpha.20 重复制品而按设计拒绝。确认三个旧文件与 `0.1.0-alpha.20-final` SHA-256 完全一致后，只移除根目录副本，随后发行证据生成/复验 PASS；
- 文档同步发现 Electron/Renderer README 会进入 ASAR；首轮已通过门禁的制品因此归档为 `release/archive/0.1.0-alpha.21-superseded-pre-doc-sync/`，不再作为最终证据。最终完整 `npm run build:win` 193.7 秒退出 0；
- 最终 NSIS 189,992,003 字节，SHA-256 `be7759f69916be3b65e94e3f66893d0498406e0a5604915f118b379aaa06782e`；ZIP 233,810,027 字节，SHA-256 `99141599e9909c56250f81ec76497ec2bcffac22691b7d04df897e4512f2b722`；`SHA256SUMS.txt` SHA-256 `0e392de35194b8fcbcee8ba7bd837ed24e0180ca8d65e0d1c61726bf11a7ddd1`。六项最终发行文件已完整归档至 `release/archive/0.1.0-alpha.21-final/`；alpha.12 → alpha.21 安装生命周期只读预检 PASS，`authorized=false`，没有启动安装器；
- 应用资源清单为 73 文件 / 2,117,464 字节，manifest SHA-256 `6a1cfd564920d83ffa72d89cb6f7b407f0f3181ef551f2f768b08eb60fb9c0bb`，锚点 SHA-256 `2483b7f0c44995375ee25a6c51eb1185c03f1cbcb5a08991bd713b22715e4c81`。实际安装器仍未运行；生产登录/凭据、网络 transport、网站后台、计费、签名、macOS/Web 和其余 sale blocker 仍未完成。

### 已完成：0.1.0-alpha.20 打包发行身份与真实 ASAR 元数据绑定检查点

- packaged 发行身份不再读取源码 `package.json`：`verify_packaged_resources.js` 从实际 `app.asar/package.json` 读取生产元数据，报告 `package_evidence_scope=packaged-app-asar`；源码身份门禁仍独立复核构建配置；
- `package.json.build.extraMetadata.oakReleaseIdentity` 把固定 schema、`app_id` 与版权占位状态写入生产 package；源码门禁同时核对 `build.appId` 与该标记，packaged 门禁核对 ASAR 内标记、产品名、author/homepage/copyright 完备性。Electron Builder 会裁剪生产 package 的 `build` 字段，因此门禁不再错误依赖不存在的 `build.appId`；
- ASAR 证据读取器不再依赖 `@electron/asar.extractFile` 的路径缓存和单次未检查 `readSync`。它读取当前 raw header、拒绝目录/link/unpacked/非法偏移，并循环读取到精确字节数；归档读取前后身份仍必须一致。同一路径重建、源码伪造、ASAR 内 appId 漂移、重复键和短读相关路径均有回归覆盖；
- 过程中的失败没有隐藏：第一次全量回归出现一次旧 `extractFile` 非法 JSON，第一次 build 证明 production package 已裁剪 `build.appId`；加入生产标记后又在并发全量测试复现一次短读。改用无缓存精确读取后，完整 Node 回归正确拒绝了尚未完全刷入磁盘的测试 ASAR；测试辅助器随后按 raw header 声明的归档终点等待稳定字节数，生产读取器仍保持严格拒绝短读。修复测试夹具后，完整 Node 回归连续三轮均为 359 total / 352 pass / 0 fail / 7 skip；
- 最终 `npm test`：Node 359 total / 352 pass / 0 fail / 7 skip（3.414 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（106.320 秒），整条命令 157.1 秒；
- 最终外层隐藏 `npm run build:win`：PASS（204.1 秒）；真实 ASAR package identity、源/packaged 资源、全 9 fuse、运行时探针、NSIS/ZIP、EpubCheck/Ace、packaged smoke 与发布证据同链退出码 0。packaged smoke 根 `out/packaged-smoke/runs/ms4yn5a2-2412f8598c07f65e/projects/`；DOCX/EPUB 各 4 次检查、1 个修复批次、3 个检查点，PDF 251,665/178,403 字节，原稿哈希不变；源码 smoke 也在 `out/source-smoke/runs/ms4xpgl8-b364a26d49d64102/projects/` 独立 PASS；
- 最终 NSIS 189,986,523 字节，SHA-256 `25f180927553039cf7b2c5f45168af28681b7d133fd8ed29da826ecf9a61fcbd`；ZIP 233,802,826 字节，SHA-256 `8e2fe8291fea1f2b566dd67680d0a75ac3484a133c5725e6a5d39b1cd8e1a6b0`；`SHA256SUMS.txt` SHA-256 `a59fbae6d08e0dd74c0e7974936337c2f5eca10024513adf3579ee2974c20c8d`；独立 `Get-FileHash` 同值，发行证据、packaged 门禁及 alpha.12 → alpha.20 安装生命周期只读预检均独立 PASS；
- 应用资源清单仍为 72 文件 / 2,115,011 字节，manifest SHA-256 `107ea77919b1d2959b85d1ddb3dca50f7c52956784b173597c155a2085ed42a7`，锚点 SHA-256 `1311ffea8a241c5eded2d23a9c84b7cc9909ef3011fd4872d1d1b55c70ba42d7`。alpha.19 与本次 alpha.20 最终制品分别完整归档于 `release/archive/0.1.0-alpha.19-final/`、`release/archive/0.1.0-alpha.20-final/`；实际安装器仍未运行，发行身份仍不完备，Windows 制品未签名，其余 sale blocker 未关闭。

### 已完成：0.1.0-alpha.19 发行商身份 fail-closed 门禁检查点（历史）

- 新增 `config/release-identity.json` 与固定摘要的 v1 exact schema，明确记录产品名、`appId`、湖岸橡树品牌和官网；无法从仓库确认的法定销售主体、支持/隐私/条款链接、版权声明、Windows 证书 subject、Apple Team ID 和具名复核保持 `null` / `pending`，未凭空补写；
- 新增只读 `scripts/release_identity.js` / `npm run verify:release-identity`。验证器使用稳定单链接读取、重复键拒绝、canonical 身份/schema 字节、固定产品身份、官网域内 HTTPS、占位文本拒绝、平台签名字段与 `package.json` author/homepage/copyright 交叉验证；无自批准或写入入口；
- `verify_packaged_resources.js` 新增 `release-publisher-identity` 证据与 `RELEASE_PUBLISHER_METADATA_PENDING`。alpha 对结构正确但未完备的身份明确列 blocker；正式 semver 的 sale 层级会提升为错误。源码/真实 packaged sale blocker 因此由 16/11 增为 17/12，不代表质量倒退，而是原 builder `author is missed` 警告终于进入机器可执行门禁；
- 应用资源信任清单已把身份文件和 schema 纳入 ASAR 锚点：72 文件 / 2,115,011 字节，manifest SHA-256 `480c0e3092ae4ebd94d5d554f03bdafa492c2c7adcbc4e1476d82b96b949e669`，锚点 SHA-256 `2fc7f8df3ed2559eea3cc9aab6fbe5d25113895cb5619e1975ebee348f69cb87`；
- 最终 `npm test`：Node 355 total / 348 pass / 0 fail / 7 skip（3.210 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（103.702 秒），整条命令 155.2 秒；
- 外层隐藏 `npm run build:win`：PASS（190.9 秒）；源/packaged 资源、全 9 fuse、运行时探针、NSIS/ZIP、EpubCheck/Ace、packaged smoke 与发布证据同链退出码 0。smoke 根 `out/packaged-smoke/runs/ms4wb5l6-92a65d90b8504698/projects/`；DOCX/EPUB 各 4 次检查、1 个修复批次、3 个检查点，当前问题 13/5、应用 fixes 5/2、PDF 251,663/178,404 字节，原稿哈希不变；
- NSIS 189,985,848 字节，SHA-256 `9fc35cbfa320419117ca064abd205d049b61e85b3c7442b0f5d74d98b71c9561`；ZIP 233,802,099 字节，SHA-256 `1641678bea38788439e7e538e6f1289076a412d54a19567bc834e1f0a6ad3d99`；`SHA256SUMS.txt` SHA-256 `8c6d18649e294d2b681e11b6ac6636582066af61dd212d5cbcaadb869ad77270`；发布证据和 alpha.12 → alpha.19 安装生命周期只读预检均独立 PASS；
- alpha.18 已完整归档于 `release/archive/0.1.0-alpha.18-final/`。实际安装器仍未运行；发行身份字段待用户/法律主体确认，Windows 制品未签名，真实安装生命周期、五类 provenance 人工签核、Ace 正式边界、干净机、macOS/Web 和生产账号/订阅/同步均未完成。

### 已完成：0.1.0-alpha.18 Electron 与 Windows builder 来源机器证据检查点（历史）

- 新增 Electron 43.1.0 `win32-x64` provenance v1：固定 GitHub 官方 release API、`SHASUMS256.txt`、npm checksums 与官方 ZIP；ZIP 为 144,237,574 字节，SHA-256 `a07dc1e3d5e589593d37e3b19d1b373e02bb58270e2eb0d6633eee0198ad09f0`，官方 ZIP 与本地 `node_modules/electron/dist` 均为 75 文件、364,083,658 字节，75/75 原字节一致；证据 SHA-256 `5f850b7ad7a5971e3ccf4ecce505ed2793530952081a68afe3c648c1862c5075`；
- 新增 Windows builder provenance v1：固定 `nsis-3.0.4.1.7z`、`nsis-resources-3.4.1.7z`、`winCodeSign-2.6.0.7z` 三份官方 GitHub release API 与归档字节，并绑定 `app-builder-lib 26.15.3` 选择逻辑。使用固定 7-Zip 受控重解压/重组后与当前工具树 385/385 文件一致，共 19,150,116 字节；证据 SHA-256 `c16518397eb1d02cfe1beaf70eda5eaab6c6177c03af33f9b071e7f1ec22fbb5`，tracked lock SHA-256 `ccb2701bf121fd093c7d0fccf78db8725b516f4a06b67bd17fcb309b458dcc1a`；
- 两类证据均由 exact schema、canonical JSON、受控归档解析、完整树复核和反向测试保护，并分别绑定 Electron runtime lock、builder tool manifest/lock、应用资源清单与 ASAR 锚点。审计见 `docs/audits/ELECTRON_43.1.0_RUNTIME_PROVENANCE.md` 与 `docs/audits/WINDOWS_BUILDER_TOOLCHAIN_PROVENANCE.md`；
- Electron release 没有提供 detached signature 资产；三份 builder 旧 release 的 API 不提供 digest 或签名，不能伪称签名已验证。builder 组装树只保留 NSIS `COPYING`，所选 nsis-resources/winCodeSign 载荷没有具名许可证文件。这些边界均在证据中保留，两个 blocker 只从 `*_PROVENANCE_AUDIT_REQUIRED` 收窄为 `*_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，源码/packaged 总数仍为 16/11；
- 最终 `npm test`：Node 344 total / 337 pass / 0 fail / 7 skip（3.280 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（104.368 秒），整条命令 162 秒；
- 外层隐藏 `npm run build:win`：PASS（213.4 秒）；源/packaged 资源、全 9 fuse、EpubCheck/Ace、packaged smoke 与发布证据同链退出码 0。smoke 根 `out/packaged-smoke/runs/ms4vbk2z-11762cedd25847f4/projects/`；DOCX/EPUB 各 4 次检查、1 个修复批次、3 个检查点，当前问题 13/5、应用 fixes 5/2、PDF 251,661/178,234 字节，原稿哈希不变；
- NSIS 189,984,819 字节，SHA-256 `d55899aa6681d420d90523a7c8e3fa46d91f8342cce64ea2435f9e71b8351e05`；ZIP 233,800,734 字节，SHA-256 `34c26fab7d1c733acda82b34047bea9d7b36d5f247c54ec970a9c6ec0250547a`；`SHA256SUMS.txt` SHA-256 `ce0b771be470db5ed3a3c61adb037d9f443bfdfb89554f8cabb4ae1e7a8f65d6`；发布证据、两类 provenance 和 alpha.12 → alpha.18 安装生命周期只读预检均独立 PASS；
- 实际安装器仍未运行；Windows 制品未签名，五类运行/构建资源的具名人工许可/再分发签核、Ace 正式边界、其余 sale blocker、干净机、macOS/Web 和生产账号/订阅/同步均未完成。

### 已完成：0.1.0-alpha.17 Temurin/JRE 来源机器证据检查点

- 新增 `config/provenance/temurin-21.0.11+10-win32-x64.json`、exact schema、`scripts/jre_provenance.js`、JRE 锁摘要绑定和反向测试。Eclipse Adoptium 官方 ZIP 为 205,073,954 字节，SHA-256 `d3625e7cadf23787ea540229544b6e2ab494b3b54da1801879e583e1dfee0a64`；GitHub 服务端 digest、官方 checksum 和 build metadata 均匹配；证据 SHA-256 `dbbf5e4799d88820b7c4475e178e45a7624fbf104b7b5fdc4f78d6650c39d676`；
- 验证器直接解析固定 ZIP；官方 ZIP 与本机 `C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot` 均为 490 文件、343,822,457 字节，490/490 路径、大小与 SHA-256 一致，树摘要 `613c12718b72625393d84c35b4f09886e7e67addcb401a0b1949902eb05d8932`；
- 固定 `jlink` 模块/参数生成 207 文件、52,384,264 字节的 JRE，树摘要 `16efd16ec81ed492a6c3c285f313456ec216099fb87000c1e607973c9e99210e`；94 个 `NOTICE`/`legal/` 文件原字节保留，JRE manifest、tracked lock、应用资源清单和 ASAR 锚点逐层绑定；审计见 `docs/audits/TEMURIN_21.0.11_JRE_PROVENANCE.md`；
- 已固定 detached signature、Adoptium 公钥和摘要，但本机没有 OpenPGP 验证器，状态明确为 `not_verified_no_openpgp_tool`；没有把“签名文件存在”写成“签名已验证”。GPLv2/Classpath/Assembly Exception、第三方 notice、商标和源代码提供义务仍待具名人工签署；blocker 从 `JRE_SOURCE_PROVENANCE_AUDIT_REQUIRED` 收窄为 `JRE_SOURCE_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，源码/packaged 数量仍为 16/11；
- 最终 `npm test`：Node 338 total / 331 pass / 0 fail / 7 skip（3.315 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（113.909 秒），整条命令 168 秒；
- 最终获准的外层隐藏 `npm run build:win`：PASS（206.5 秒）；源/packaged 资源、全 9 fuse、EpubCheck/Ace、smoke 和发布证据同链退出码 0。smoke 根 `out/packaged-smoke/runs/ms4tv80b-a5166595d558e0e3/projects/`；DOCX/EPUB 各 4 次检查、1 个修复批次、3 个检查点，当前问题 13/5、应用 fixes 5/2、PDF 251,667/178,243 字节，原稿哈希不变；
- 最终 NSIS 189,974,477 字节，SHA-256 `88f9a97e619cb9bd82f024a788a2c7b1780cab467098fe07b87975c0bae1b06f`；ZIP 233,789,900 字节，SHA-256 `d995766daaf96b72a46680c72b924228b964d38eab6e5bf7a8ed63b152be95a3`；`SHA256SUMS.txt` SHA-256 `2d02b825aadd645ee38aeeebd4db0c93a8aef46cc1373a98558c81c289102b34`；发布证据复验和 alpha.12 → alpha.17 安装生命周期只读预检 PASS；
- 首轮受限构建在 packaged provenance 读取源码 JRE manifest 路径时 fail-closed；修复打包路径重映射后门禁通过。受限 GUI 运行另复现 `0xC0000135`，保持 Electron sandbox 且不采用 `--no-sandbox`，在获准外层隐藏进程中完整重构建通过。实际安装器仍未运行；Windows 制品未签名，其余 sale blocker、干净机、macOS/Web 和生产账号/订阅/同步均未完成。

### 已完成：0.1.0-alpha.16 EpubCheck 5.3.0 来源机器证据检查点

- 新增 `config/provenance/epubcheck-5.3.0.json`、exact schema、`scripts/epubcheck_provenance.js` 与反向测试。证据把本地 EpubCheck 完整分发精确绑定到 W3C/DAISY GitHub 官方 release ZIP（33,071,108 字节，SHA-256 `6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5`）；GitHub release API 的服务端 digest 与本机重算一致；证据 SHA-256 为 `2f5191140fd119bb288a71becf8ca3ddf077d17bc71aea12b179c502075735b0`；
- 最终生成器不信任调用者提供的“官方解压目录”：它直接解析固定 ZIP 中央目录，拒绝多卷/ZIP64/加密/链接/路径逃逸和不支持的压缩方法，并解压每个条目计算 SHA-256；GitHub release API JSON 原始摘要也精确固定。审读中发现并修复该绑定缺口后，首份同版本制品作废并归档于 `release/archive/0.1.0-alpha.16-superseded-pre-zip-binding/`，不再作为发布证据；
- 官方 ZIP 与本地分发均为 49 个文件、36,263,890 字节，49/49 逐字节一致；`epubcheck.jar` SHA-256 为 `f7f96617c929371821609b88c8484d6dc9f24fe916499863c46094c5fb778a65`。验证器拒绝自批准、schema/顺序/原始字节/官方摘要/本地树漂移；完整机器审计见 `docs/audits/EPUBCHECK_5.3.0_PROVENANCE.md`；
- 官方 ZIP、上游仓库和随包 `LICENSE.txt` 指向 BSD-3-Clause，但当前 EpubCheck 官网首页显示 MIT；证据将 `license_signal_consistent=false` 原样保留，未擅自选择许可。GitHub 页面称 tag 已签名，但本轮未独立验证 tag，也没有把 tag 签名冒充生成 ZIP 的直接签名；第三方再分发义务仍待具名人工审阅；
- `epubcheck-5.3.0.json`、JRE 双向探针锁、应用 loose 资源清单和真实 `app.asar` 锚点均绑定上述证据。源码 blocker 仍为 16 项，真实 packaged blocker 仍为 11 项；原 `EPUBCHECK_PROVENANCE_AUDIT_REQUIRED` 已收窄为 `EPUBCHECK_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，数量不变；
- 最终 `npm test`：Node 334 total / 327 pass / 0 fail / 7 skip（3.231 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（103.297 秒），墙钟 154.3 秒；
- `npm run build:win`：PASS（193.8 秒）。源/packaged 资源、9 项 fuse、隐藏 smoke 与 canonical 发布证据全部通过；smoke 运行根为 `out/packaged-smoke/runs/ms4se5k4-0d1d2a33a1dd2017/projects/`，DOCX/EPUB 各 4 次检查、1 个修复批次、3 个检查点，当前问题 13/5、应用 fixes 5/2、PDF 251,656/178,238 字节，原稿哈希不变；EPUB 实得 EpubCheck 5 error 与 Ace 8 项失败断言；
- NSIS 189,956,597 字节，SHA-256 `c5d02da1fcf64f44f75e22b2d884d64660f6669932e8cce0499711051ca02d02`；ZIP 233,770,875 字节，SHA-256 `74ac191bfdc3feb1585f1760326ffa31a9f489912143f7810743ffda021842dd`；`SHA256SUMS.txt` SHA-256 `122d42aa2e8bf3505dd7b7700d0f74f65cf02f07d5f3b16c99e195ebe2aec567`；独立发布证据验证与 alpha.12 → alpha.16 安装生命周期只读预检均 PASS；
- 实际安装器仍未运行；Windows 制品未签名，EpubCheck/CPython 人工签署、其余 packaged sale blocker、干净机、macOS/Web 和生产账号/订阅/同步均未完成。

### 已完成：0.1.0-alpha.15 CPython Windows 运行时来源机器证据检查点

- 新增 `config/provenance/cpython-3.13.14-win32-x64.json`、exact schema 和 `scripts/runtime_provenance.js`。只读验证把 Windows x64 `python-runtime/` 精确绑定到 PSF 官方 CPython 3.13.14 embeddable ZIP（10,964,839 字节，SHA-256 `90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907`）；证据 SHA-256 为 `b198a727a0c12640a8a020758bcfc5dc41e01e577a25576795b1d081e3513176`；
- 官方 34 个文件与本地 34 个文件逐项比较：33 个逐字节一致，唯一差异为 `python313._pth` 在官方 80 字节后精确追加 `..\python\r\n`；官方 `LICENSE.txt` 原样保留。验证器拒绝其它增删、摘要/顺序/身份漂移和工具自批准；完整审计见 `docs/audits/CPYTHON_3.13.14_WIN32_X64_PROVENANCE.md`；
- Sigstore artifact digest、leaf signature、证书 identity 和 Rekor canonical body 绑定已机器复验；SPDX 制品摘要、PSF supplier 与 `PSF-2.0` 已复验。完整 Fulcio/Rekor 信任链未重放，GPG 未密码学验证；上游 bundle 的 tlog entry index `1780928370` 与 inclusion-proof index `1659024108` 不一致，两值均保留且明确等待人工审阅；
- `python-runtime-win32-x64.json` 和真实 packaged 资源门禁绑定 provenance 证据摘要。packaged blocker 数仍为 11，但原 `PYTHON_RUNTIME_PROVENANCE_AUDIT_REQUIRED` 已收窄为 `PYTHON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`；机器工具不能替正式法律/再分发签署；
- 最终 `npm test`：Node 329 total / 322 pass / 0 fail / 7 skip（3.203 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（103.904 秒），墙钟 111.8 秒；
- alpha.15 Windows x64 packaged 资源、全 9 fuse 和隐藏 smoke 均 PASS；运行根为 `out/packaged-smoke/runs/ms4qixuz-15ab5ab26e07949e/projects/`。NSIS 189,951,730 字节，SHA-256 `d701bf0fee5766a17ba33c351ec46a3cafd00da147154cf4006d2711cabbb15e`；ZIP 233,765,446 字节，SHA-256 `9ac0252699b77bf80bc14ce1f7119526c29b22e79fde4171760541fbbf0f5511`；canonical 发布证据与安装生命周期只读预检通过；
- 首次整链 `build:win` 的最后一步因根 `release/` 同时存在已归档的 alpha.14 制品而按设计拒绝生成摘要；核对归档与根文件摘要一致后只移除根目录旧制品，随后对已通过前序门禁与 smoke 的 alpha.15 字节生成并复验发布证据。该中间退出 1 不得隐去，也不表示 alpha.15 打包或 smoke 失败；
- 实际安装器仍未运行；Windows 制品未签名，CPython 人工签署、其余 10 项 packaged sale blocker、干净机、macOS/Web 和生产账号/订阅/同步均未完成。

### 已完成：0.1.0-alpha.14 Windows 安装生命周期验收工具检查点

- 新增默认只读的 `verify:install-lifecycle:win`：先交叉验证当前 alpha.14 与归档 alpha.12 的 canonical release manifest、SHA256SUMS、文件大小/摘要和 NSIS PE 身份；未携带双重 `--run --allow-system-mutation` 时不创建输出目录、不启动安装器；
- 授权运行器固定九阶段：旧版安装/冒烟、当前版就地升级/冒烟、userData 哨兵保留、旧版回装探测后仍须保持当前版、当前版卸载、二进制/注册表/Desktop/Start Menu 清理与用户数据保留；所有安装目录、日志、用户数据和 canonical JSON 证据限定在项目 `out/install-acceptance/`，系统集成只读探针验证 HKCU 与快捷方式；
- `config/schemas/windows-install-acceptance-v1.schema.json` 与运行时 exact validator 将 PASS 严格绑定到九阶段全绿和当前/归档安装器真实字节；路径逃逸、旧制品篡改、隐藏阶段、回装未启动、降级成功、证据乱序或非 canonical 字节均 fail-closed；相关专项 12/12 通过；
- 实际安装器尚未运行，因为它会写 HKCU、Desktop 与 Start Menu，仍须单独取得项目外系统写入授权。尤其是历史 alpha.12 NSIS 没有已验证的降级阻止机制，真实回装探测结果当前未知，不能预判通过；
- alpha.14 Windows x64 NSIS/ZIP、全 9 fuse、packaged 资源、强制 EpubCheck/Ace smoke 与发布摘要已完成。Codex 受限令牌会阻止 Electron sandbox 子进程；同一 alpha.13 也复现。保持 Electron `sandbox: true` 后，以外层隐藏 GUI 进程运行 alpha.14 smoke，34.7 秒 PASS；没有使用 `--no-sandbox` 作为证据；
- 最终 `npm test`：Node 323 total / 316 pass / 0 fail / 7 skip（3.032 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（103.078 秒），墙钟 110.8 秒；
- NSIS 189,946,367 字节，SHA-256 `e8ff13a093aa48d25de74afbbd9311676ec8afb9037bcafee946d4bcdac21647`；ZIP 233,759,796 字节，SHA-256 `15e8a34e5ee35806d12e452b991ff1c7db867827278262af7ba931c5f631da9b`；发布证据和安装预检均独立复验通过；
- 该版本仍未签名，不是可售卖正式版；真实安装生命周期、干净机、macOS/Web、生产账号/订阅/同步及 11 项 packaged sale blocker 未完成。

### 已完成：0.1.0-alpha.13 Electron 43 全 fuse 固定检查点

- 顶层构建依赖精确锁定 `@electron/fuses 2.1.3`，确认索引 8 为 `WasmTrapHandlers` 并固定启用；索引 0—8 共 9 项全部有明确期望值；
- 新增 `afterPack` 门禁，在 electron-builder 完成打包、代码签名前用顶层工具和 `strictlyRequireAllFuses=true` 重写全部 9 项，随后立即回读；API 漂移、未来新 fuse、路径逃逸、链接/硬链接和回读漂移均 fail-closed；macOS arm64 按工具要求重置临时 ad-hoc 签名；
- alpha.13 Windows x64 NSIS、ZIP、真实 9-fuse wire、ASAR/loose 资源、强制 EpubCheck/Ace packaged smoke 和发布摘要全部通过；Electron fuse 兼容性 blocker 已关闭；
- 该版本仍未签名，不是可售卖正式版。packaged 资源门禁仍保留 11 项 sale blocker；干净机安装/升级/卸载尚未执行。

### 现场验证（2026-07-28，alpha.13）

- 最终 `npm test`：**PASS**；Node 310 total / 303 pass / 0 fail / 7 skip（3.236 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（104.469 秒），墙钟 157.8 秒；
- 最终 `npm run build:win`：**PASS**（300.3 秒）；fuse policy 1.1 回读 `fully_known=true`、`unknown_fuses=[]`、`blockers=[]`；packaged 资源门禁 11 项 blocker；
- packaged smoke：**SMOKE-RESULT PASS**，运行根 `out/packaged-smoke/runs/ms4mqaar-f6f3d43d55a2726d/projects/`；DOCX/EPUB 各 4 次检查、1 个修复批次、3 个检查点，当前问题 13/5、应用 fixes 5/2、PDF 251,655/178,394 字节，原稿哈希不变；EPUB 为 EpubCheck 5 error、Ace 8 项失败断言；
- NSIS `Oak-Manuscript-0.1.0-alpha.13-Windows-x64.exe`：189,944,918 字节，SHA-256 `2a5ffcfa2ca47e925f1b65b3e44521038fc20fc760cbfdd86307ec0ae50e1851`；
- ZIP `Oak-Manuscript-0.1.0-alpha.13-Windows-x64.zip`：233,758,073 字节，SHA-256 `0ecbbcd5eae20af3da5d50c9d398d64f76c3d93d3f978a3fa103ebd27745ddae`；发布证据独立复验通过；
- packaged 资源 `.pyc` 为 0，退出后项目路径相关进程为 0；构建和 smoke 均使用隐藏进程。alpha.12 制品及证据保存在 `release/archive/0.1.0-alpha.12/`。

### 已完成：0.1.0-alpha.12 Windows 可安装 alpha（历史检查点）

- 经用户批准，从固定官方 release URL 下载三份 Windows builder 归档并逐份验 SHA-256；安全导入器只选择 Windows 所需 winCodeSign 条目，生成 385 文件、19,150,116 字节的独立 tracked 全树锁；
- 构建包装器固定受验证 Electron dist 和本地固定 7-Zip，拒绝调用者配置覆盖或联网回退；Ace 完整 6,672 文件被显式打入 extraResources；
- 隔离 Python 固定为 `-I -B -S -X utf8`，真实 packaged 资源在探针与烟测后仍为 0 个 `.pyc`/`__pycache__`；
- 在保持 `GrantFileProtocolExtraPrivileges=false` 时，以只允许四个固定渲染文件的 `oak-manuscript://` 协议加载 ASAR UI；路径穿越、其他 host/scheme、查询参数和未列文件均拒绝；
- Windows x64 NSIS、ZIP、真实二进制 fuse、真实 `app.asar` 锚点、全部 loose 资源、应用身份和强制 EpubCheck/Ace packaged smoke 已通过；生成并复验 `SHA256SUMS.txt` 与 canonical release manifest；
- 该版本未签名，不是可售卖正式版。packaged 资源门禁仍列 11 项 sale blocker，Electron 43 未知 fuse 另行阻断；干净机安装/升级/卸载尚未做。

### 现场验证（2026-07-28，alpha.12）

- 最终 `npm test`：**PASS**；Node 306 total / 300 pass / 0 fail / 6 skip（3.096 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（39.652 秒），墙钟 89.434 秒；
- 最终强制外部验证 packaged smoke：**SMOKE-RESULT PASS**，运行根 `out/packaged-smoke/runs/ms4lg2cv-ab0de58b69b46495/projects/`；DOCX/EPUB 各 4 次检查、1 个修复批次、3 个检查点，当前问题 13/5、应用 fixes 5/2、PDF 251,654/178,232 字节，原稿哈希不变；EPUB 实得 EpubCheck 5 error 与 Ace 8 项失败断言；
- NSIS `Oak-Manuscript-0.1.0-alpha.12-Windows-x64.exe`：189,944,468 字节，SHA-256 `42c38acaeb98cf98e4871ad1a8d7fc1225bdab3bd6c1c2149b3bf27ff03603bf`；
- ZIP `Oak-Manuscript-0.1.0-alpha.12-Windows-x64.zip`：233,758,044 字节，SHA-256 `d99052ac1b803a58859f64b9c8874a9ef5de3118f7155f77b1789d5cc884adf2`；`release:evidence:verify:win` 通过；
- 退出后项目路径相关进程为 0，packaged 资源 pyc 为 0。构建和 smoke 均使用隐藏进程。

### 已完成：0.1.0-alpha.11 ASAR 资源信任根

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.11`；标准内容、35 条规则、6 个 fixer、账号和同步合同未变化；
- `config/tool-manifests/app-resources-v1.json` 以 canonical 字节固定 58 个将 loose 分发的应用文件，共 1,873,018 字节；`electron/resource-trust-anchor.json` 位于应用代码 ASAR 内，固定该清单及 win32-x64 Python/EpubCheck/JRE/Ace 四份平台锁的原始 SHA-256；
- packaged 门禁只接受从真实 `app.asar` 读取的锚点，不信任 resources 目录内的同名 loose 文件；完整验证拒绝资源或锁增删改、平台替换、链接/硬链接及读取竞态；
- 打包应用在初始化标准存储和创建窗口前运行同一资源信任验证；失败记录错误并以退出码 1 终止；
- `--update-lock` 改用仓库既有 tracked-file 事务安全替换并写后复验。两文件之间若第二步失败会保持 fail-closed，重新显式执行即可恢复一致；
- 构造的真实 `app.asar` 集成测试在证据成立时只关闭 5 个可信根 blocker，剩余 12 个不变；源码门禁仍完整列出 17 个 blocker，当前没有产品 `app.asar`，不能宣称正式可信根已关闭。

### 现场验证（2026-07-28，alpha.11）

- 最终统一 `npm test`：**PASS，退出码 0，墙钟 171.3 秒**；Node 301 total / 294 pass / 0 fail / 7 skip（3.313 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（110.355 秒）；
- `verify:resource-trust`、`verify:standards`、`stage:ace`、`verify:electron-runtime`、`verify:resources:win` 和 `verify:fuses:config` 均 **PASS**；锚点 SHA-256 为 `1b52a14f82f80e9ef4596b83b4abf3f2ddc821fe8f8ee8aedd7e996c1e80c644`；
- Windows 源码 alpha 资源门禁实际执行 Python/JRE/EpubCheck 探针，core 返回 `0.1.0-alpha.11`，并仍如实列出 17 项 sale blocker；
- 独立隐藏 alpha.11 源码 smoke：**SMOKE-RESULT PASS**，运行根 `out/source-smoke/runs/ms4eowx9-64e0aab5311e2a99/projects/`；DOCX/EPUB 均 4 次检查、1 个修复批次、3 个检查点、原稿哈希不变，当前问题 13/5、应用 fixes 5/2、PDF 251,654/178,235 字节；EPUB 实得 EpubCheck 5 error 与 Ace 8 项失败断言；
- 本轮未联网、未运行 builder、未生成安装器/ZIP/发布证据；smoke 退出后无 Ace Chrome profile 或 Electron 进程残留，但它仍不是 packaged 证据。

### 已完成：0.1.0-alpha.10 Ace 受控 utilityProcess 与 RunAsNode 关闭（历史检查点）

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.10`；标准内容、35 条规则、6 个 fixer、账号和同步合同未变化；
- Renderer 的外部验证只提交受路径门禁保护的项目目录；主进程生成绑定项目/working/报告/标准与 Java、JAR、Ace、Chrome 文件身份的计划，准备输出后才启动固定 helper，完成后再由 Python 重验计划并解析报告；
- Ace 在 Electron `utilityProcess` 中运行固定入口和参数；环境清除 Node/Electron/Puppeteer/Oak/Ace 注入，合并输出上限 64 KiB、最长 5 分钟，目录身份换入、路径替换、超时、异常退出或报告非法均 fail-closed；
- 系统 Chrome 由主进程以固定隐藏参数、独立 profile、随机 loopback DevTools 端点启动；utility 只能连接该严格本地端点，结束后停止精确子进程并清理 profile；这不是互联网传输，也不等于 OS 级无网沙箱；
- Electron fuse 已改为 `RunAsNode=false`；配置门禁与 wire 合同相应更新。Electron 43 未知索引 8 仍按 alpha blocker / sale fail-closed 处理；
- `ACE_CONTROLLED_HELPER_PENDING` 没有被伪关闭：源码 helper 和真实源码 UI 功能已验证，但缺真实打包制品上的功能、安全与 fuse 联合证据。

### 现场验证（2026-07-28，alpha.10）

- 最终统一 `npm test`：**PASS，退出码 0，墙钟 119.4 秒**；Node 295 total / 288 pass / 0 fail / 7 skip（2.461 秒），Python 351 total / 0 failures / 0 errors / 3 skipped（112.121 秒）；
- `verify:standards`、`stage:ace`、`verify:electron-runtime`、`verify:resources:win` 和 `verify:fuses:config` 均 **PASS**；Fuse 报告 `run_as_node_disabled=true`，Windows alpha 资源门禁仍如实列出 17 项 sale blocker；
- 独立隐藏条件源码 smoke：**SMOKE-RESULT PASS**，运行根 `out/source-smoke/runs/ms4cz6o9-c2ad021ca7e2e83c/projects/`；DOCX/EPUB 均 4 次检查、1 次修复、3 个检查点、原稿哈希不变，当前问题 13/5、应用 fixes 5/2、PDF 251,649/178,228 字节；
- 同一 smoke 中 EPUB 缺陷样本实际执行 EpubCheck 5.3.0 和 Ace 1.4.6：EpubCheck `failed`（0 fatal / 5 error / 0 warning），Ace `failed`（整体 fail，8 项断言）；运行结束没有遗留 `oak-ace-chrome-*` profile；
- `release:evidence:verify:win` 与 `verify:packaged:fuses:win` 按设计拒绝缺失 alpha.10 安装包/`win-unpacked`；没有用源码运行冒充 packaged 证据；
- 本轮没有联网、没有下载 builder 归档、没有运行 electron-builder，也没有生成安装器、ZIP 或发布证据。

### 已完成：0.1.0-alpha.9 Electron ASAR 与 fuse 发布硬化合同（历史检查点）

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.9`；标准内容、35 条规则、6 个 fixer、账号和同步合同未变化；
- 新增 `scripts/electron_fuse_policy.js`：要求 `build.asar=true`、`disableAsarIntegrity=false`，并精确固定全部本地已知 fuse；配置缺项、多项、漂移、inherit 或 removed 状态均拒绝；
- Windows/macOS 构建链在 electron-builder 前验证配置，在 builder 后立即读取真实打包二进制 fuse wire，然后才允许进入打包资源门禁、packaged smoke 与发布证据；
- 二进制验证限定仓库内安全父链、常规非空单链接文件，并在 fuse 读取前后验证稳定身份；已知 fuse 必须逐项匹配；
- `RunAsNode=true` 只是当前 Ace helper 的临时兼容状态，仍是正式发布欠账；受控 helper 完成后必须切到 `false` 并重新验证；
- 本机 Electron 43.1.0 暴露 wire 索引 0—8，而 `@electron/fuses` 1.8.0 只定义 0—7。索引 8 的状态字节为 `49`，但名称/语义本地不可验证，禁止猜测；alpha 返回 `ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING`，sale 失败关闭；完整合同见 `docs/ELECTRON_FUSE_POLICY.md`。

### 现场验证（2026-07-28，alpha.9）

- fuse 专项 `node --test tests/electron_fuse_policy.test.js`：**6/6 PASS**；`npm run verify:fuses:config`：**PASS**；
- 最终统一 `npm test`：**PASS，退出码 0，墙钟 121.2 秒**；Node 284/277/0/7（2.350 秒），Python 348/0 failures/0 errors/3 skipped（114.170 秒）；
- `verify:standards`、`verify:electron-runtime`、Windows alpha 资源门禁均 **PASS**；core 为 `0.1.0-alpha.9`，既有 sale 资源门禁仍为 17 项 blocker；未知 packaged fuse 是独立的条件阻断；
- macOS 静态门禁按设计拒绝缺失双架构资源；`release:evidence:verify:win` 按设计拒绝缺失 `Oak-Manuscript-0.1.0-alpha.9-Windows-x64.exe`；
- 沙箱外独立隐藏 `npm run smoke`：**SMOKE-RESULT PASS**，运行根 `out/source-smoke/runs/ms49yas5-9ccb167e78f033a2/projects/`；DOCX/EPUB 均 4 次检查、1 次修复、3 个检查点、原稿哈希不变，当前问题 13/5、报告 applied fixes 5/2、PDF 251,650/177,417 字节；
- 本轮没有联网、没有下载 builder 归档、没有运行真实 packaged fuse 验证，也没有生成安装器、ZIP 或发布证据。

### 已完成：0.1.0-alpha.8 统一账号、权益与同步离线契约

- APP、Python 核心和 lockfile 统一到 `0.1.0-alpha.8`；规则包、标准内容和自动修复白名单未变化；
- `AuthProvider` 已从“即将开放”占位升级为可测试状态机，固定生产登录方式为系统浏览器 PKCE；正式服务未配置时明确返回 `configuration_required`，不打开页面、不联网；测试模拟覆盖登录、退出、过期和设备撤销，生产 UI 不开放模拟入口；
- `LicenseProvider` 固化 Free/Pro 能力矩阵及 `validUntil`/`graceUntil` 离线宽限计算；模拟授权明确 `signatureVerified=false`，过期仅降级新权益，`localProjectsLocked=false` 永久成立；
- Python 新增严格只读 `sync-source`，只返回随机项目 ID、检查 ID、枚举、版本、计数所需的结构化问题记录和状态；不返回标题、解释、位置、预览、文件名、路径或哈希；
- Electron `buildSyncRecordV1` 和 `validateSyncRecordV1` 使用 exact schema、交叉计数和禁止字段反向门禁；`config/schemas/sync-record-v1.schema.json` 作为未来网站服务端复用的 JSON Schema 2020-12 合同；
- Renderer 不能提交任意同步 payload，只能提交项目句柄和固定枚举。已登录用户在导出后可看到逐字段安全预览，并选择仅本次、同步本次以后仍询问、暂不同步或不再询问此项目；未登录不询问；失败不影响导出；
- `SyncProvider` 提供按账号隔离、OS `safeStorage` 加密的 `pending_transport` 队列以及取消、重试、删除和重启恢复契约。生产网络 transport 未实现，因此当前真实 APP 不会上传；完整边界见 `docs/SYNC_RECORD_V1.md`。

### 现场验证（2026-07-28，alpha.8）

- 最终统一 `npm test`：**PASS，退出码 0，墙钟 93.7 秒**；Node 278/271/0/7（2.389 秒），Python 348/0 failures/0 errors/3 skipped（86.468 秒）；
- `npm run verify:standards`、`npm run verify:electron-runtime`、`npm run verify:resources:win`：**PASS**；Windows alpha 探针读到 core `0.1.0-alpha.8`，sale 门禁仍有 17 项 blocker；
- `npm run verify:resources:mac:static`：按预期退出 1，仍精确缺两架构 Electron dist、Python runtime manifest 与 JRE；
- 沙箱外独立隐藏 `npm run smoke`：**SMOKE-RESULT PASS**，运行根 `out/source-smoke/runs/ms48q9hr-05f6b99b193cf33d/projects/`；DOCX/EPUB 均 4 次检查、1 次修复、3 个检查点、原稿哈希不变，当前问题 13/5、报告 applied fixes 5/2、PDF 251,660/177,267 字节；未登录、Free 权益和空同步队列断言通过；
- `release:evidence:verify:win` 按预期拒绝缺失的 alpha.8 NSIS；本轮没有联网、没有下载 builder 归档、没有生产账号/同步调用，也没有生成安装器、ZIP 或发布证据。

### 已完成：0.1.0-alpha.7 Windows 发布制品证据链

- APP、Python 核心和 lockfile 已统一到 `0.1.0-alpha.7`；标准内容和自动修复白名单未变化；
- 新增 Windows x64 发布证据生成/验证器，只接受与 package/lock 当前版本精确匹配的 NSIS EXE 与 ZIP；坏 PE/ZIP、缺档、同系列旧制品、symlink/reparse、hardlink、路径逃逸或哈希期间身份变化均 fail-closed；
- `SHA256SUMS.txt` 固定两件制品有序摘要；canonical `release-manifest-win32-x64.json` 固定产品、appId、版本、目标、类型、大小/摘要，以及 SHA 文件原始字节摘要；验证时重新读取全部制品并交叉核对；
- 两份证据采用独占候选、`fsync` 与联合提交，第二次 rename 或换入后复验失败会恢复两份旧证据；清除旧证据前先预检两份文件，拒绝链接/硬链接；
- `build:win` 现在先清除旧证据，只有 electron-builder、packaged 资源门禁与隐藏 packaged smoke 全部成功后才生成新证据；失败构建不会留下本次新证据；
- 真实 `release/` 只有 `.gitkeep`，`release:evidence:verify:win` 已按预期拒绝缺失的 alpha.7 NSIS；没有生成伪造 SHA 或 manifest。

### 现场验证（2026-07-28，alpha.7）

- 发布证据专项：6 项，5 通过、0 失败、1 项因本机文件 symlink 权限条件跳过；hardlink、坏格式、旧制品、版本漂移、篡改、联合提交回滚与清除预检均实测；
- 最终统一 `npm test`：**PASS，退出码 0，墙钟 88.1 秒**；Node 267/260/0/7（2.487 秒），Python 344/0 failures/0 errors/3 skipped（80.833 秒）；
- `npm run verify:standards`、`npm run verify:electron-runtime`、`npm run verify:resources:win`：**PASS**；Windows alpha 探针读到 core `0.1.0-alpha.7`，sale 门禁仍保留 17 项 blocker；
- `npm run verify:resources:mac:static`：按预期退出 1，精确缺两架构 Electron dist、Python runtime manifest 与 JRE；
- 独立隐藏 `npm run smoke`：**PASS**，运行根 `out/source-smoke/runs/ms47c3l8-9b6bf78452308a33/projects/`；DOCX/EPUB 均 4 次检查、1 次修复、3 个检查点、原稿哈希不变，当前问题 13/5、报告 applied fixes 4/2、PDF 251,656/177,263 字节；
- 本轮没有联网、没有下载 builder 归档、没有工具树/tracked lock，也没有 alpha.7 NSIS、ZIP 或发布证据文件。

### 已完成：0.1.0-alpha.6 Windows builder 受控归档下载入口

- APP、Python 核心和 lockfile 已统一到 `0.1.0-alpha.6`；标准内容未变化，继续使用已验证的 `oak-standards 2.0.0` / `oak-rules 2.0.0`（sequence 2）；
- 来源合同除三份固定文件名和 SHA-256 外，同时固定 electron-builder 官方 GitHub release URL；下载只接受 HTTPS、固定仓库路径和文件名，重定向只允许明确的 GitHub release asset 主机；
- 联网默认关闭：CLI 必须显式携带 `--allow-network`，唯一便捷入口为 `npm run download:builder:win`；普通 `build:win`、`dist` 和全部 test 不调用下载器；
- 输出只能位于仓库内，默认 `out/downloads/windows-builder/`；目录父链拒绝链接/逃逸，已有正确归档按哈希复用，已有错误归档和未知条目 fail-closed 且绝不覆盖；
- 三份候选全部完成并逐一核对大小/SHA-256 后才提交；候选使用独占创建、128 MiB 上限、30 秒闲置超时、最多 5 次受限重定向和显式 `fsync`，提交竞争或中途失败只回滚本事务文件；
- 本轮没有用户联网授权，因此只实现并测试入口，**没有发出网络请求、没有下载真实归档、没有生成工具树/tracked lock/NSIS/ZIP**。

### 现场验证（2026-07-28，alpha.6）

- 最终统一 `npm test`：**PASS，退出码 0，墙钟 97.2 秒**；Node 261/255/0/6（2.627 秒），Python 344/0 failures/0 errors/3 skipped（89.446 秒）；
- downloader 专项 11 项全通过，覆盖固定 URL、显式授权、零授权零写入、受限重定向、容量/哈希门禁、事务提交、并发碰撞回滚、错误旧文件/未知归档拒绝、仓库边界与链接拒绝；
- `npm run verify:standards`、`npm run verify:electron-runtime`、`npm run verify:resources:win`：**PASS**；Windows alpha 探针读到 core `0.1.0-alpha.6`，sale 门禁仍保留 17 项 blocker；
- `npm run verify:resources:mac:static`：按预期退出 1，仍精确缺两架构 Electron dist、Python runtime manifest 和 JRE；
- 独立隐藏窗口 `npm run smoke`：`SMOKE-RESULT: PASS`，输出根 `out/source-smoke/runs/ms46fhdh-230a41fd46481179/projects/`；DOCX/EPUB 均为 4 次检查、1 次批量修复、3 个检查点、`source_hash_ok=true`，引用分别以 `conflicting_structures` / `extractor_coverage_insufficient` 退回 `structure_only`，当前问题 13 / 5，PDF 251,661 / 177,434 字节。

### 已完成：0.1.0-alpha.5 默认引用解析、显式确认与标准包 2.0.0

- APP、Python 核心和 lockfile 已统一到 `0.1.0-alpha.5`；内置标准为 `oak-standards 2.0.0` / `oak-rules 2.0.0`，release sequence 2，仍是 35 条规则和 6 个白名单机械 fixer；
- 默认解析器纯本地、确定性运行：只根据编号引用、作者—年份、注释—书目、语言和提取能力作决定；强/中阈值固定为 3/2 个唯一信号与 80%/50% 覆盖率；结果不含稿件文字、姓名、引用串、路径或哈希；
- 确有当前格式/类型/语言规则能力时才选定 `gbt7714-2025 | apa-7 | chicago-18-nb | chicago-18-ad`；冲突、证据不足或 EPUB 仅部分可提取时退回 `structure_only`，而非猜测具体体例；
- 新增只读 `plan-citation`、绑定项目全状态的 `citation-plan-*` 和 `check --citation-plan-id`；UI 在实际检查前集中显示体例/模式、理由、置信度、数量证据与实际覆盖规则，用户一次确认后才运行；
- `citation_resolution` 写入项目设置、检查快照、机器报告、Markdown/HTML 报告和导出摘要；旧 1.0 项目容许缺失该字段。标准升级时保留用户显式体例，但清空旧默认解析并按新包重算；
- 2.0.0 manifest/规则包/能力集 SHA-256 分别为 `0aff75eb…8427` / `098b382e…97a4` / `af67d0aa•320e`；rollback target 为 1.0.0 manifest `d33534f0…d7af`。旧项目仅能使用本地 CAS 内仍存在且已验证的历史 release 迁移，缺失时 fail-closed，不用最新包冒充；
- 切换稿件或项目目录时 Renderer 清空上一项目会话，修复连续处理 DOCX/EPUB 时复用旧项目的真实 smoke 缺陷。

### 现场验证（2026-07-27，alpha.5）

- `npm run test:node`：**PASS**，250 项、244 通过、0 失败、6 条件跳过，2.650 秒；
- `npm run test:python`：**PASS**，344 项、0 失败、0 错误、3 条件跳过，80.191 秒；最终统一 `npm test`：**PASS，退出码 0，墙钟 160.5 秒**，Node 段 250/244/0/6（2.675 秒），Python 段 344/0/0/3（88.790 秒）；
- `npm run verify:standards`、`npm run verify:electron-runtime`、`npm run verify:resources:win`：**PASS**；Windows sale 门禁仍按设计以 17 项 blocker 退出 1；
- `npm run verify:resources:mac:static`：按预期退出 1，仍缺 darwin-x64/arm64 Electron dist、两架构 Python runtime manifest 和 JRE；
- 沙箱外独立隐藏 Electron `npm run smoke`：`SMOKE-RESULT: PASS`。输出根 `out/source-smoke/runs/ms44nzhb-8186d1b3c5148eba/projects/`；DOCX/EPUB 均先确认引用计划、各 4 次检查且 `source_hash_ok=true`；两者分别因 `conflicting_structures` / `extractor_coverage_insufficient` 安全退回 `structure_only`；PDF 分别为 251,646 / 177,416 字节；
- 本轮未联网，未下载 builder 归档，未生成 alpha.5 制品，未运行 packaged smoke、干净系统或签名验收。

### 已完成：0.1.0-alpha.4 Electron 与 Windows builder 构建输入可信链

- APP、Python 核心和 lockfile 已统一到 `0.1.0-alpha.4`；标准内容没有变化，仍是 `oak-rules 1.0.0`、release sequence 1；
- Windows x64 Electron 43.1.0 新增受版本控制的完整树锁：2 个目录、75 个文件、364,083,658 字节，manifest SHA-256 为 `ae67132b95e21b62450fd0e34faaf00164514b38322076c56e37c0301c520d95`；默认命令只读验证，tracked manifest 以严格 JSON 拒绝重复键，以 exact schema 拒绝未知字段，并要求生成器定义的唯一 canonical UTF-8/LF 原始字节；
- `electronDist` 和源码/packaged 资源门禁都会在使用前核对 package-lock、运行时完整目录树、大小和 SHA-256。缺失、多出、篡改、硬链接、Node 可识别的 symlink/junction/reparse 或路径逃逸均 fail-closed，electron-builder 不会回退下载；只有显式 `--update-lock` 才能重写 tracked manifest，更新前验证安全父链并拒绝目标 symlink/hardlink，使用独占候选文件、`fsync`、原子替换和换入后复验；失败恢复旧字节，回滚自身失败则明确报错并保留事务证据；
- 新增 Windows builder 安全导入器，独立固定三份归档及 SHA-256：`nsis-3.0.4.1.7z`（`9877df…c5fa`）、`nsis-resources-3.4.1.7z`（`593a9a…4103`）、`winCodeSign-2.6.0.7z`（`cdaec7…43a4`）；
- 导入器固定本地 7z 组件，解压前后拒绝路径逃逸、链接、冲突/保留名、备用流、加密/反条目、异常容量、硬链接和清单漂移；UNC/device 目录在读取前拒绝。工具树 manifest 与受版本控制独立 lock 交叉绑定，且仅显式 `--update-lock` 才能作为同一事务换入；普通 build/test 不调用导入器；
- 安全复核发现的两项 P1 已修复：verifier 遇到不安全祖先路径会在读取前停止；旧工具树/旧 lock 在任何 rename 前做父链、realpath、单链接和全树预检。4 个前向与 4 个回滚 rename 均有故障注入，回滚自身失败会明确报错并保留恢复证据；
- 本机没有三份真实归档，因此**没有**真实 builder 工具树、独立 tracked lock、NSIS 或 ZIP。该边界是当前正确的 fail-closed 状态，不得伪造 lock 或把导入器实现写成制品完成。

### 已完成：0.1.0-alpha.3 标准包可信链、项目固定版本与显式升级（历史检查点）

- APP、Python 核心和 lockfile 版本已推进到 `0.1.0-alpha.3`；规则包继续是 `oak-rules 1.0.0`、发布序列 1，本轮没有借 APP 版本变化伪造标准内容版本；
- `standards.json` 升级为治理 schema 2.0，保留 13 项标准；`rule-capabilities.json` 对 35 条规则与 6 个机械 fixer 做精确能力映射；canonical manifest 固定 payload、APP 兼容范围、release sequence、规则包哈希与能力集哈希；
- manifest SHA-256 为 `d33534f081b2122a90652ee03304a0e71177a7fd0d3130fffe77b0fea807d7af`；规则包 SHA-256 为 `7ac5a5bdb126e9f5148a040ce42a634b1a95295c27d7a72c774db54bf7129542`；
- Electron 标准存储实现严格 JSON/payload 校验、Ed25519 门槛签名、内容寻址存储、release sequence 高水位、撤回/过期/兼容性检查、签署的精确回滚目标、跨进程事务锁和确定性崩溃恢复；未知或身份不一致状态一律 fail-closed；
- 当前内置包可离线验证并启动；本地签名包预览、安装和全局回滚路径已实现，但生产 trust pin 尚未配置，所以真实本地签名包导入默认禁用；联网检查、下载与自动升级尚未实现；
- 新项目直接绑定当前已验证包；已有项目先运行一次不带身份绑定的只读 `project-standard-status` 预检以发现 pin（预检前仍先验证全局标准存储），Electron 随后精确核验项目所指 CAS release。真正的业务或变更命令再以净化环境变量携带完全相同的 canonical 七字段身份，由 Python 复核；
- `project-standard-status`、`plan-rulepack-upgrade` 与 `upgrade-rulepack` 已实现。升级计划绑定项目清单、状态、source/working、issues、最新检查和目标身份；UI 集中显示完整差异并一次确认，目标 digest 由主进程选择；升级创建检查点、归档旧 issues、原子提交新 pin，并强制重检；
- 全局包更新不会静默改变已有项目。过期、撤回或 APP 不兼容的旧包只可作为受控迁移源，不能放宽签名、路径、payload、能力映射、未来 release 或身份校验；
- `app:info`、源码 smoke 和打包 smoke 契约核对 APP、项目、检查记录与导出报告的完整七字段身份；源码 smoke 每次使用独立 `out/source-smoke/runs/<run-id>/`，不会被旧 userData 或标准存储污染；
**继承并回归的 alpha.2 离线资源、安全与发布门禁能力：**

- Electron 正常启动即对默认 session 应用离线 Chromium switches 和 `http/https/ws/wss/ftp` 请求拦截，Renderer CSP 继续禁止远程脚本；未来获授权的联网 Provider 必须使用独立受限通道，不能放宽默认 session；
- PDF 审阅样张使用非持久、无缓存的隔离 session，禁用 JavaScript、导航、新窗口和网络，并在加载 HTML 后复核文件身份；PDF 通过父目录/目标身份验证后在 `exports/` 同目录暂存、`fsync` 并原子换入；
- Python 项目打开已改为完整 schema 与路径 fail-closed 验证；项目根、固定子目录、manifest、source/working、报告与检查点均拒绝逃逸、链接/联接、硬链接和身份混淆；所有变更型 CLI 命令共用非阻塞跨进程内核写锁，争用时返回可重试的结构化 `PROJECT_WRITE_LOCKED`；
- `create` 在加锁前只读预检，不会污染非法或非空目标；锁内只打开一次用户输入，以同一文件描述符复制到 `source`，再由受控 `source` 生成 `working`。只读输入可位于 OneDrive/reparse/symlink 路径，但最终打开对象必须是常规文件；复制期间来源变化或任一步失败都会按本事务文件身份精确清理，并保留用户已有空目录或恢复旧协议锁原字节；
- 自选 `out_dir` 导出逐级拒绝链接/联接，项目内部只允许落在 `exports/`；所有目标在首个导出字节前统一预检，已有硬链接/非常规目标直接拒绝，每个文件同目录暂存、`fsync` 后原子换入；
- Electron 桥将退出码 1 保留为有效业务结果、退出码 2 视为运行错误；Python 的结构化错误 `code/message/retryable/details` 可原样穿过 IPC；
- Windows x64 的嵌入式 Python、裁剪 JRE、EpubCheck 完整分发和 Ace 生产依赖闭包均由受版本控制的全量文件清单、大小和 SHA-256 校验；
- Python 运行时清单覆盖 34 个文件、21,260,753 字节；JRE 覆盖 207 个文件、52,384,264 字节；EpubCheck 覆盖 49 个文件、36,263,890 字节；Ace 覆盖 236 个包、6,672 个文件、58,964,235 字节；
- EpubCheck 用“好样本 0 错误 + 缺陷样本非零错误”的双向探针验证；Python/JRE 只有在全量资源校验无误后才允许执行；
- Ace 使用固定生产闭包和审核过的 XHTML 隔离替换：作者脚本先移除、作者文档加载阶段禁用 JavaScript、资源协议限制为受控范围；新增受版本控制的完整阶段 lock，资源门禁同时验证 lock 与 Python 运行时，空许可证文件直接拒绝；真实 Ace 好/坏样本条件测试均已通过；
- Windows 与 macOS 共用 `-I -S -X utf8` 的固定 Python bootstrap 和净化环境，不从工作目录、用户 site 或继承的 Python/OAK 环境注入核心；运行探针同时核对 `sys.implementation`、完整三段版本、`releaselevel=final` 与 `serial=0`，不是只比较版本字符串；macOS x64/arm64 CPython 版本均固定为 `3.13.14`；
- 所有信任清单使用与 locale/ICU 无关的 UTF-16 code-unit 顺序；JRE 的 runtime+tracked lock、Ace 的 stage+tracked lock 都以事务换入，失败时恢复原目录与原锁字节；
- Ace tracked lock 不仅固定解析后的 manifest 语义，还固定 `tools/ace/manifest.json` 原始字节哈希；语义等价但字节漂移同样拒绝；
- macOS 构建拆为 x64/arm64 原生 runner；跨主机聚合只能做不执行探针的静态检查，不能把 Windows 上的静态配置结果写成 macOS 运行验证；
- Windows alpha 资源门禁实际执行 Python 与 JRE/EpubCheck 探针并通过；sale 门禁按设计拒绝并列出 18 项未完成的正式发布责任，不会把 alpha 资源完备误判为可售卖版本；
- 经批准的提升权限 `build:win` 已完成本地 JRE/Ace staging 和 Windows alpha 资源探针，随后仅因 `tools/electron-builder/win32-x64` 缺失而明确停止；未联网下载，也没有产生 alpha.3 安装包或 ZIP。

### 已完成：0.1.0-alpha.1 P0 可信批量修复闭环（保留历史）

- `plan-fixes` 严格只读，返回绑定项目、工作稿哈希、问题状态和规则包的确定性 `plan_id`；
- UI 在一个可滚动界面集中列出本批全部修改前/修改后预览，取消或 Esc 不写入；
- `fix` 强制要求已确认的 `plan_id`，旧计划、异项目计划和不完整确认集合均拒绝；
- TAB 等离散修改逐位置生成问题和预览；任一同类问题被拒绝时，整类全文 fixer 从计划排除，避免顺带修改未展示内容；
- 修复先在临时工作副本执行，正常异常路径不留下部分 working / issues / project 写入；
- 达到 5 个检查点时，批量修复提交失败会恢复被裁剪的旧检查点；
- 检查点保存 working、issues、项目状态和检查结果快照，可列表、恢复并在恢复前创建安全检查点；
- 检查点恢复在文件换入或最终保存失败时恢复完整项目树；损坏或不可恢复项在 UI 中禁用；
- Electron preload 保持 `sandbox: true`，没有直接修复 IPC，只有计划、确认应用、列表和恢复四个固定 P0 通道；
- 当时 APP / Python 核心 / package 版本统一为 `0.1.0-alpha.1`；Node 与 Python 已统一到 `npm test`。

### 现场验证（2026-07-27，alpha.4）

- `npm run test:node`：**PASS**，239 项、233 通过、0 失败、6 条件跳过，2.606 秒；新增覆盖 Electron 全树锁、严格 JSON/exact schema/canonical 字节、安全 tracked-file 更新事务，以及 builder 独立 lock、旧资产预检和全部前向/回滚 rename 故障；
- Electron runtime 锁专项：**37 项、36 通过、0 失败、1 跳过**；hardlink 与 junction 反向路径在本机实测通过，文件 symlink 因 Windows `EPERM` 条件跳过，不计作通过；
- 最终 `npm test`：**PASS**，Node 239/233/0/6；Python 312 项、0 失败、0 错误、3 条件跳过，Python 段 80.125 秒；
- 沙箱外隐藏 Chrome 的 `$env:OAK_TEST_ACE='1'; npm run test:python`：**PASS**，312 项、0 失败、0 错误、1 条件跳过，44.807 秒；受限沙箱运行曾因未生成安全报告得到 2 个 `not_run` 断言失败，随后沙箱外实跑通过，这不是工具通过证据的替代；
- `npm run verify:standards` 与 `npm run verify:electron-runtime`：**PASS**；Electron 固定锁统计与上述 digest 一致；
- `npm run verify:resources:win`：**PASS**，实际执行 Python 与 JRE/EpubCheck 探针，Python core 报告 `0.1.0-alpha.4`；当前 sale 门禁按设计以 17 项 blocker 退出 1；
- 沙箱外独立隐藏 Electron `npm run smoke`：`SMOKE-RESULT: PASS`。输出根为 `out/source-smoke/runs/ms37h0mu-201a90896825d190/projects/`；DOCX/EPUB 均为 `app_version=0.1.0-alpha.4`、`source_hash_ok=true`、4 次检查，四方七字段标准身份一致；PDF 分别为 258,404 / 161,836 字节；
- macOS 静态门禁按预期退出 1：仍缺 darwin x64/arm64 Electron dist、两架构 Python runtime lock 和两架构 JRE；
- `node scripts/run_electron_builder.js --win --x64` 在启动 electron-builder 前按预期退出 1，理由是没有真实工具树与 tracked lock。全程未联网、未生成 alpha.4 制品，也未运行 packaged smoke、干净系统或签名验收。

### 现场验证（2026-07-27，alpha.3 历史检查点）

- 原生/沙箱外 `npm test` 统一入口：**PASS**。Node TAP 共 186 项，181 通过、0 失败、5 项条件跳过；Python 共 312 项，0 失败、0 错误、3 项条件跳过；
- `python scripts/run_tests.py`：共 312 项，0 失败、0 错误、3 项条件跳过，用时 77.755 秒；
- 沙箱外隐藏 Chrome 的 `$env:OAK_TEST_ACE='1'; python scripts\run_tests.py`：312 项，0 失败、0 错误、1 项条件跳过，用时 46.321 秒；早期同类受限运行器诊断无法生成安全报告，核心按设计返回 `not_run`，不写成工具通过或代码失败；
- `npm run verify:standards`：**PASS**，产出上述 manifest/规则包 digest；
- 沙箱外隐藏 Electron `npm run smoke`：`SMOKE-RESULT: PASS`。最新运行根为 `out/source-smoke/runs/ms34lrwa-cf3ac49f857dc7fc/projects/`；DOCX/EPUB 均完成检查→集中预览→批量确认修复→恢复→再次修复闭环，两个项目均为 `app_version=0.1.0-alpha.3`、`integrity.source_hash_ok=true`，各含 4 次检查记录，APP/项目/当前检查/报告七字段身份一致；PDF 分别为 258,400 和 161,845 字节；
- Windows alpha 资源门禁实际执行运行时探针并通过；sale 门禁有 18 项 blocker；提升权限 `build:win` 完成本地 JRE/Ace staging 和资源探针后，仅在缺少 `tools/electron-builder/win32-x64` 处停止，未联网、未生成制品；
- `npm run verify:resources:mac:static` 在 Windows 上按预期 FAIL，精确缺少 darwin-x64/arm64 Electron dist、两架构 Python runtime 锁和 `tools/jre-darwin-x64` / `tools/jre-darwin-arm64`；这证明跨主机静态逻辑可执行，不证明 macOS 可构建或已发行。两架构仍没有产物、签名、公证或打包版 smoke 证据。

完整证据见 `docs/TEST_REPORT.md`。

## 3. 已确认、不得反复重开讨论的产品决策

1. 最终目标是可售卖订阅的正式版，不把当前 alpha 或旧 0.0.1 便携包包装成正式版；
2. Windows 安装版、macOS 安装版和嵌入湖岸官网的 Web 版共用确定性检查契约；
3. Web 版采用服务端统一处理；生产实现必须有临时任务、加密、TTL、删除和零留存验证；
4. 三端统一使用湖岸橡树官网账号；访客仍可使用基础本地功能；
5. 订阅为有限 Free + Pro，具体价格尚未拍板；
6. 同步只允许检查结果和必要元数据，不同步稿件、正文、摘录、文件名、路径或哈希；登录用户必须明确选择是否同步；
7. 引用体例保留“默认”，由确定性映射自动选择，并在报告中说明；
8. 标准文件需要签名清单、下载校验、版本固定、回滚和升级提示；已有项目不得被静默换规则；
9. “接入用户自己的 AI”已确认六项设计：无 AI / 湖岸 AI / 我的 AI 三模式；支持云 API、自托管 OpenAI-compatible 服务和 Ollama/LM Studio；凭据永不同步且 Web 仅会话保存；AI 只给建议、绝不静默改稿；属于 Pro 且不消耗湖岸 AI 配额；失败时不静默回退。用户尚未明确批准把它写入 v2.0 方案或开始实现，当前不得擅自扩展范围；
10. 不进行 AI 语义改写，自动修复仍只限冻结白名单机械操作。

## 4. 已核实但尚未解决的缺口

- 打包版 Ace：alpha.23 已有真实 packaged utilityProcess/loopback Chrome 功能证据；正式版仍缺自带且校验过的浏览器运行时、OS 级默认拒绝网络、签名绑定的 smoke 证据和正式人工许可审计；
- Windows：alpha.23 已有未签名 NSIS/ZIP、真实全 9 fuse/ASAR/资源、ASAR 内生产发行身份、双阶段 packaged smoke，以及 CPython/EpubCheck/Temurin-JRE/Electron/builder 来源机器证据；仍未执行真实安装、升级、降级探测、卸载和无开发运行时验证，也没有完整发行身份或 Authenticode 签名；
- macOS：已有 x64/arm64 原生 runner、静态聚合和两架构 CPython `3.13.14` 固定策略，但缺对应 Electron/Python/JRE 实际资源；尚无 `.app` / DMG、签名、公证或真实硬件探针证据；
- Web：exact 作业 schema、内存参考状态机、同源 HTTPS、GoTrue、Fetch、工作台、Netlify Blobs 内容适配/清扫，以及 Supabase/Postgres 持久任务/幂等迁移、repository 与持久服务已实现；生产环境/真实账号与 Blobs/Postgres E2E、私有队列/隔离 worker、恶意文件门禁、计费、短时下载、结果同步和官网嵌入尚未实现；
- 账号/订阅/同步：离线 Provider 状态机、Free/Pro/宽限、SyncRecord v1、逐字段预览、按账户隔离的 OS 加密队列和重启恢复已实现；生产 Supabase、登录凭据存储、签名授权、支付、网络 transport 和网站后台未连接；
- 标准库：治理结构和引用解析政策已完成，13 项标准、35 条规则和 6 个 fixer 映射一致；但外部来源核验仍为 0 项（12 pending、1 unavailable），4 项外部标准仍为 `under_review`，reviewer 仅是角色占位，内容深度与真实人工签核仍不完整；
- 标准升级：本地验证、签名包导入/回滚骨架、项目固定与显式升级已编码；生产 trust pin、在线获取/下载、签名撤回分发与联网自动更新未实现；
- 正式发布仍缺隐私/条款最终文本、证书、生产密钥、人工内测、macOS 硬件和网站联调。

### Windows sale 门禁的当前明确阻断

源码资源门禁现列 17 项（builder 独立全树锁已成立）；真实 alpha.23 packaged ASAR 再关闭 EpubCheck/JRE/Python/APP/Ace 五个 loose 可信根项，因此 packaged 资源门禁保留以下 12 项。Electron 9 项 fuse 已全部识别和固定，独立验证器不再产生兼容性 blocker。

以下机器码来自当前 `verify_packaged_resources.js` 与实测 sale 输出，不得合并或省略：

1. `RELEASE_PUBLISHER_METADATA_PENDING`：法定销售主体、官方支持/隐私/条款链接、版权、具名复核、package 元数据与平台签名主体尚未完整；
2. `FORMAL_LICENSE_AUDIT_REQUIRED`：Ace 18 个生成元数据通知包的原始许可证审计；
3. `PYTHON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`：官方制品、Sigstore/SPDX、33 个原字节文件、1 个受控 `_pth` 修改和许可保留已机器复验；完整信任链/上游 index 异常与具名法律/再分发签署仍待完成；
4. `EPUBCHECK_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`：官方 ZIP、GitHub 服务端摘要和 49 个原字节文件已机器复验；官网 MIT 与随包/仓库 BSD-3-Clause 的矛盾、tag/ZIP 绑定和第三方再分发义务仍待具名人工签核；
5. `JRE_SOURCE_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`：官方 ZIP/GitHub digest/checksum/build metadata、490/490 源 JDK 文件、本机 JDK、207 文件 jlink runtime 和 94 份许可材料已机器复验；OpenPGP、许可、商标、源码提供与具名再分发签署仍待完成；
6. `ELECTRON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`：官方 ZIP、GitHub digest、SHASUMS256、npm checksums 和 75/75 运行时文件已机器复验；许可、Chromium 第三方通知、商标和再分发仍待具名签核；
7. `BUILDER_TOOLCHAIN_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`：三份官方归档、固定选择逻辑和 385 文件重组树已机器复验；旧 release 无 digest/签名且部分所选载荷无具名许可证文件，仍待具名签核；
8. `ACE_FULL_LICENSE_AUDIT_REQUIRED`：Ace 全部生产依赖闭包的正式人工审计；
9. `ACE_CONTROLLED_HELPER_PENDING`：packaged 功能已实测，但门禁尚未消费签名绑定的 smoke 证明；
10. `ACE_BROWSER_RUNTIME_PENDING`；
11. `ACE_OS_NETWORK_ISOLATION_PENDING`；
12. `WINDOWS_CODE_SIGNING_PENDING`。

## 5. 下一执行顺序

不要重新做宽泛规划，按 v2.0 方案继续：

1. 已完成 Windows 安装生命周期编排器与 alpha.23 只读预检；下一步须单独取得系统写入授权后，真实执行 alpha.12 → alpha.23 安装/升级/降级探测/卸载，核对 HKCU 与快捷方式并保留 canonical 证据；若历史安装器确实回退，必须把它记为产品 blocker，不能修改证据口径；
2. CPython、EpubCheck、Temurin/JRE、Electron 与 builder 的机器来源证据已完成；下一步必须由具名人员完成许可、商标、第三方通知、签名边界与再分发签核，再完成 Windows 代码签名方案并逐项关闭相应 packaged sale blocker；代码不能替代该签署；
3. Ace 的 provenance/全闭包许可证、自带浏览器、OS 级网络隔离及与制品哈希绑定的不可伪造 smoke 证明仍未完成；任何需扩大 Ace 证明范围的实现先确认验收口径；
4. 经联网授权核验标准官方来源，配置生产 trust pin、在线包获取和签名撤回通道；任何新规则必须有反例、匿名样本、回归测试和真实审校签核；
5. 在 macOS 分别准备 x64/arm64 Electron、Python、JRE，构建后完成签名、公证、staple、Gatekeeper 和实机 smoke；
6. 在现有 Auth / License / Sync 离线契约和 OS 加密持久队列上实现生产登录凭据与独立网络 transport，再经授权连接 Supabase、支付和网站后台；
7. alpha.27 已完成持久任务/所有权/幂等迁移、repository 与跨实例服务源码；下一步实现私有租约队列/隔离 worker，再接恶意文件门禁、短时下载与三路零留存证据；经授权后在隔离预生产环境执行真实 Supabase 迁移与 Netlify E2E，随后完成官网嵌入、结果同步、Free/Pro、支付、隐私、内测和正式发布门禁。

涉及联网、依赖下载、生产账号、证书、签名、发布、远端推送或网站写入时，必须先向用户取得明确授权。

## 6. 常用验证命令

```powershell
npm test
npm run test:node
npm run test:python
$env:OAK_TEST_ACE='1'; python scripts\run_tests.py
npm run verify:resource-trust
npm run verify:provenance:python:win
npm run verify:provenance:epubcheck
npm run verify:provenance:jre:win
npm run verify:provenance:electron:win
npm run verify:provenance:builder:win
npm run verify:electron-runtime
npm run verify:fuses:config
npm run download:builder:win  # 仅在用户明确批准联网后
npm run smoke
npm run verify:resources:win
npm run build:win
npm run release:evidence:verify:win
npm run verify:install-lifecycle:win  # 只读预检；不会启动安装器
# 真实生命周期只能在用户另行授权系统写入后运行：
# node scripts/windows_install_acceptance.js --run --allow-system-mutation
git diff --check
```

CLI 的 P0 新契约：

```powershell
python -m oak_manuscript_core plan-fixes --project <项目目录>
python -m oak_manuscript_core fix --project <项目目录> --plan-id <计划ID>
python -m oak_manuscript_core plan-citation --project <项目目录> --citation default
python -m oak_manuscript_core check --project <项目目录> --citation default --citation-plan-id <引用计划ID>
python -m oak_manuscript_core list-checkpoints --project <项目目录>
python -m oak_manuscript_core restore-checkpoint --project <项目目录> --checkpoint-id <检查点ID>
python -m oak_manuscript_core project-standard-status --project <项目目录>
python -m oak_manuscript_core plan-rulepack-upgrade --project <项目目录> --to-manifest-sha256 <摘要>
python -m oak_manuscript_core upgrade-rulepack --project <项目目录> --to-manifest-sha256 <摘要> --plan-id <计划ID>
python -m oak_manuscript_core sync-source --project <项目目录> --event export
```

## 7. 交接纪律

- 动手前读 `AGENTS.md`、本文件、`docs/DEVELOPMENT_STATUS.md`、v2.0 方案、`docs/ACCEPTANCE.md` 和 `docs/TEST_REPORT.md`；
- 以实际文件和现场测试为准，历史文档只作追溯；
- 不修改真实原稿，不把真实作者内容放进仓库；
- 功能、测试、构建或分发状态变化后，同步更新交接、状态、测试、验收和变更记录；
- 不把计划项写成已完成事实，不把开发机成功等同于干净系统、macOS 或正式发布成功。
