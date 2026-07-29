# electron/ — 桌面主进程与可信边界

本目录是 Electron 桌面端的受信任侧；Renderer 不直接获得 Node、文件系统或子进程能力。

| 文件 | 职责 |
|---|---|
| `main.js` | 创建沙箱窗口、注册固定 IPC、安装默认离线门禁、外链白名单、Provider 与 `app:info` |
| `resource-trust.js` | 从真实 `app.asar` raw header 精确读取锚点/production package，复核应用 loose 清单及 Python/EpubCheck/JRE/Ace 完整树 |
| `preload.js` | 在 sandboxed preload 中暴露最小 `window.oak` API；不提供任意命令或直接 `fix` 通道 |
| `python-bridge.js` | 以参数数组、`shell=false` 和清理后的环境调用 Python JSON CLI |
| `python-invocation.js` | 桥与资源门禁共用的 `-I -B -S -X utf8` bootstrap；禁止 pyc 并显式插入受控 core 绝对目录 |
| `app-protocol.js` | `oak-manuscript://renderer/` 四文件白名单；在 file 协议额外权限关闭时安全加载 ASAR UI |
| `core-result.js` | 区分退出码 1 业务结果与退出码 2 错误，并保留 Python 结构化错误字段 |
| `core-ipc.js` | `plan-citation` / `check` 的项目路径、六种体例和 opaque citation plan ID 白名单；注册固定 IPC |
| `providers/index.js` | Auth/License 离线状态机、Free/Pro 权益矩阵、SyncRecord v1 exact 构造/校验与按账户持久队列 |
| `sync-store.js` | safeStorage 加密封装、canonical 状态、revision CAS、原子替换和重启恢复 |
| `sync-http-client.js` | 固定同源 HTTPS/Bearer SyncRecord POST、请求/响应容量、超时、幂等回显与错误净化 |
| `sync-transport-coordinator.js` | 账号稳定性、单项并发、成功后本机删除、失败持久化与崩溃后幂等重放协调 |
| `desktop-auth-config.js` / `desktop-auth-provider.js` | 受信待配置门禁、系统浏览器 PKCE S256/state、固定深链与账号绑定 access-token provider |
| `encrypted-auth-store.js` / `auth-http-client.js` | safeStorage 域分离加密会话及固定有界 token/user HTTPS 客户端 |
| `account-sync-ipc.js` | 只从可信 Python 来源构造同步预览，缓存负载，并接收 opaque 幂等 ID 与四种固定选择 |
| `external-validation-ipc.js` | 只接收受控项目路径，编排 Python plan/prepare/finalize 与固定 Ace helper |
| `ace-utility-runner.js` | 固定 utilityProcess module/参数/环境、输出上限、超时和输出目录身份复核 |
| `chrome-controller.js` | 以固定隐藏参数启动精确系统 Chrome，提供随机 loopback DevTools 端点并清理 profile |
| `offline-policy.js` | 默认 Chromium 离线 switches 与 `http/https/ws/wss/ftp` 请求阻断 |
| `path-policy.js` | 区分源码/打包资源根、选择平台 Python、约束项目/样本/PDF 路径并提供身份校验原子 writer |
| `pdf-preview.js` | 在非持久隔离 session 中禁 JS/导航/网络生成 PDF，并安全写入 `exports/` |
| `p0-ipc.js` | `plan-fixes`、带 `plan_id` 的批量提交和检查点 IPC 输入验证 |
| `standards-payload.js` | 标准包 JSON 形状、canonical 字节、Unicode、日期与 URL 的 fail-closed 校验 |
| `standards-store.js` | 标准包 CAS、高水位、签名/撤回/兼容性验证、事务恢复和精确回滚 |
| `standards-provider.js` | 内置标准启动、本地签名包预览/安装/回滚；生产信任根缺失时禁用导入 |
| `standard-bound-core.js` | 已有项目以只读状态预检发现 pin；核验精确 CAS 后绑定所有业务/变更调用；项目升级仅开放受控迁移源 |
| `standards-ipc.js` | 本地包安装、全局回滚、项目差异预览与一次确认升级 IPC |
| `smoke.js` | 在隐藏窗口走 DOCX/EPUB 真 UI闭环、AI 单条发送预览零 transport，并核对版本与打包身份 |
| `ai-request.js` | 绑定可信单条上下文的请求预览/一次确认、注入式建议响应与内存态人工审阅；采纳只经核心记录问题状态，永不直接改稿 |
| `ai-http-client.js` | 未接线的供应商无关 POST/JSON 客户端；固定 HTTPS/loopback、禁重定向/代理转发/Cookie，限制头、请求、响应和超时 |
| `ai-transport-router.js` | exact 适配器路由；拒绝未知 provider、配置漂移、凭据 URL/响应回显和未净化适配错误 |
| `ai-openai-compatible-adapter.js` | 只注册 OpenAI-compatible/Ollama/LM Studio 的固定非流式 Chat Completions 请求与唯一文本响应 |

安全基线：`contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`、固定 CSP/IPC、导航和新窗口拦截。默认 session 在正常启动时永久离线；未来获授权联网能力必须用独立受限通道，不能解除该基线。完整说明见 `docs/PRIVACY_AND_SECURITY.md`。

打包安全另由 `scripts/electron_fuse_policy.js` 固定：必须启用 ASAR 与 embedded integrity、用顶层 `@electron/fuses 2.1.3` 显式设置 Electron 43 全部 9 项，并在 electron-builder 后从真实应用二进制读回。索引 8 已定义为 `WasmTrapHandlers`；未来未知 wire 项仍 fail-closed。alpha.10 已把 Ace 迁移到 `utilityProcess` 并固定 `RunAsNode=false`。详见 `docs/ELECTRON_FUSE_POLICY.md`。

当前源码的 `resource-trust-anchor.json` 绑定应用 loose 文件（含发行身份、同步队列、Web 作业/同步 HTTP 错误与审计 exact schema、AI 请求预览/审阅 schema）的 canonical 清单和目标平台四类运行锁；精确文件数、字节数与摘要以 `docs/TEST_REPORT.md` 为准。最新真实 packaged 锚点证据仍为 alpha.37。Windows Python/EpubCheck/JRE/Electron/builder 锁再分别绑定五类官方来源证据摘要；packaged 门禁从真实 ASAR 读取 production `package.json` 与 `oakReleaseIdentity`。

PDF session 不使用 `persist:`、禁缓存并设置 `javascript=false`；专用 CSP 只允许自包含 HTML 所需的内联样式和 `data:` 图片。加载报告前后核对文件身份，拒绝项目根/`exports`/报告/目标的 symlink、junction/reparse、硬链接和目录身份换入，最后同目录原子写入。

`python-invocation.js` 不依赖 `PYTHONPATH`、site-packages 或工作目录：固定 bootstrap 把路径策略给出的 core 目录放到 `sys.path[0]`，再以 `runpy` 启动模块；桥与 Python runtime 探针使用同一参数字节序列和隔离环境。

`app:info` 返回 `appVersion`、经当前存储重新验证的七字段 `standardIdentity` 和 `packaged=app.isPackaged`。smoke 必须先通过 Renderer 规划并确认引用解析，再读取本次创建的 `project.json` 及其引用报告，核对 Python core 版本、check ID、`citation_resolution`，以及 APP/项目/检查/报告的完整标准身份；条件外部 smoke 还要求 EpubCheck/Ace 确实运行，打包 smoke 强制 `packaged=true`。打包态 Python、JRE 或 Ace stage 失配时必须失败关闭，不得回退用户环境中的同名代码资源；Electron 43.1.0 `win32-x64` 自身仍由受版本控制的全树锁固定：2 个目录、75 个文件、364,083,658 字节，manifest SHA-256 为 `f5c2c915633c1917bc37377f8232bde4259588eb138bc4072a3c7df976e27486`，并绑定官方 ZIP/SHASUMS256/npm checksums provenance。当前 Ace 浏览器运行时仍依赖用户系统 Chrome。

账号与同步 IPC 不接受 Renderer 自带的负载、token、URL 或 transport；主进程通过固定 `sync-source` 命令取值并重建 SyncRecord v1。alpha.39 只在受信账号配置完整且 safeStorage 可用时实例化系统浏览器 PKCE、token/user client 与 Sync coordinator；默认 `pending_configuration` 没有任何网络目标。Renderer 只能查询状态、发起登录或逐项发送/重试，令牌/verifier 永不跨 preload。远端创建或幂等重放后才删除本机队列，失败和账号切换保留记录。详见 `docs/SYNC_RECORD_V1.md`。

AI transport 不接受 Renderer 自报 URL、凭据或任意负载。`AIProvider` 从 OS 加密设置生成绑定，`AIRequestCoordinator` 从受信 Python core 读取单条问题并公开完整发送预览；只有一次确认后才把绑定与同一语义请求交给 Router。alpha.41 只注册 OpenAI-compatible、Ollama、LM Studio；官方云和湖岸 AI 仍不可用。注入测试不替代真实服务兼容或质量验收。

当次全量 Node/Python、source/packaged smoke、safeStorage 队列恢复、真实 fuse/ASAR/资源/production package identity、provenance 与发布证据，以仓库 `docs/TEST_REPORT.md` 为唯一事实来源；本文件不在 ASAR 中固化易过期的运行根、计数或制品哈希。完整发行身份、五类运行/构建资源人工签署、代码签名和其余 packaged sale blocker 在对应门禁关闭前始终有效。
