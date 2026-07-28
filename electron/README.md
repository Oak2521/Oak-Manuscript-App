# electron/ — 桌面主进程与可信边界

本目录是 Electron 桌面端的受信任侧；Renderer 不直接获得 Node、文件系统或子进程能力。

| 文件 | 职责 |
|---|---|
| `main.js` | 创建沙箱窗口、注册固定 IPC、安装默认离线门禁、外链白名单、Provider 与 `app:info` |
| `resource-trust.js` | 从真实 `app.asar` 读取固定锚点，复核应用 loose 清单及 Python/EpubCheck/JRE/Ace 完整树 |
| `preload.js` | 在 sandboxed preload 中暴露最小 `window.oak` API；不提供任意命令或直接 `fix` 通道 |
| `python-bridge.js` | 以参数数组、`shell=false` 和清理后的环境调用 Python JSON CLI |
| `python-invocation.js` | 桥与资源门禁共用的 `-I -B -S -X utf8` bootstrap；禁止 pyc 并显式插入受控 core 绝对目录 |
| `app-protocol.js` | `oak-manuscript://renderer/` 四文件白名单；在 file 协议额外权限关闭时安全加载 ASAR UI |
| `core-result.js` | 区分退出码 1 业务结果与退出码 2 错误，并保留 Python 结构化错误字段 |
| `core-ipc.js` | `plan-citation` / `check` 的项目路径、六种体例和 opaque citation plan ID 白名单；注册固定 IPC |
| `providers/index.js` | Auth/License 离线状态机、Free/Pro 权益矩阵、SyncRecord v1 exact 构造/校验与当前进程队列 |
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
| `smoke.js` | 在隐藏窗口走 DOCX/EPUB 真 UI 闭环，并核对版本与打包身份 |

安全基线：`contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`、固定 CSP/IPC、导航和新窗口拦截。默认 session 在正常启动时永久离线；未来获授权联网能力必须用独立受限通道，不能解除该基线。完整说明见 `docs/PRIVACY_AND_SECURITY.md`。

打包安全另由 `scripts/electron_fuse_policy.js` 固定：必须启用 ASAR 与 embedded integrity、用顶层 `@electron/fuses 2.1.3` 显式设置 Electron 43 全部 9 项，并在 electron-builder 后从真实应用二进制读回。索引 8 已定义为 `WasmTrapHandlers`；未来未知 wire 项仍 fail-closed。alpha.10 已把 Ace 迁移到 `utilityProcess` 并固定 `RunAsNode=false`。详见 `docs/ELECTRON_FUSE_POLICY.md`。

alpha.15 的 `resource-trust-anchor.json` 随代码进入 ASAR，绑定 62 个应用 loose 文件的 canonical 清单和目标平台四类运行锁；Windows Python 锁再绑定 CPython 官方来源证据摘要。packaged 启动在标准存储/窗口前验证全部树，且门禁只接受从真实 `app.asar` 读取的锚点。

PDF session 不使用 `persist:`、禁缓存并设置 `javascript=false`；专用 CSP 只允许自包含 HTML 所需的内联样式和 `data:` 图片。加载报告前后核对文件身份，拒绝项目根/`exports`/报告/目标的 symlink、junction/reparse、硬链接和目录身份换入，最后同目录原子写入。

`python-invocation.js` 不依赖 `PYTHONPATH`、site-packages 或工作目录：固定 bootstrap 把路径策略给出的 core 目录放到 `sys.path[0]`，再以 `runpy` 启动模块；桥与 Python runtime 探针使用同一参数字节序列和隔离环境。

`app:info` 返回 `appVersion`、经当前存储重新验证的七字段 `standardIdentity` 和 `packaged=app.isPackaged`。smoke 必须先通过 Renderer 规划并确认引用解析，再读取本次创建的 `project.json` 及其引用报告，核对 Python core 版本、check ID、`citation_resolution`，以及 APP/项目/检查/报告的完整标准身份；条件外部 smoke 还要求 EpubCheck/Ace 确实运行，打包 smoke 强制 `packaged=true`。打包态 Python、JRE 或 Ace stage 失配时必须失败关闭，不得回退用户环境中的同名代码资源；Electron 43.1.0 `win32-x64` 自身仍由受版本控制的全树锁固定：2 个目录、75 个文件、364,083,658 字节，manifest SHA-256 为 `ae67132b95e21b62450fd0e34faaf00164514b38322076c56e37c0301c520d95`。当前 Ace 浏览器运行时仍依赖用户系统 Chrome。

账号与同步 IPC 不接受 Renderer 自带的负载、token、URL 或 transport；主进程通过固定 `sync-source` 命令取值并重建 SyncRecord v1。当前 Auth 登录为未配置的系统浏览器 PKCE 契约，License 为未签名本地能力矩阵，Sync 队列仅存在于当前进程且不联网。详见 `docs/SYNC_RECORD_V1.md`。

当前 `0.1.0-alpha.15` 全量 Node/Python 回归、真实 packaged 全 9 fuse/ASAR/资源、CPython provenance、强制外部验证 smoke 与发布证据均通过。最终运行根 `out/packaged-smoke/runs/ms4qixuz-15ab5ab26e07949e/projects/`；DOCX/EPUB 各 4 次检查、1 个修复批次、3 个检查点且原稿哈希不变，EPUB 实得 EpubCheck 5 error 与 Ace 8 项失败断言。CPython 人工签署、未签名和其余 packaged sale blocker 仍有效。
