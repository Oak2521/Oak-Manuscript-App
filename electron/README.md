# electron/ — 桌面主进程与可信边界

本目录是 Electron 桌面端的受信任侧；Renderer 不直接获得 Node、文件系统或子进程能力。

| 文件 | 职责 |
|---|---|
| `main.js` | 创建沙箱窗口、注册固定 IPC、安装默认离线门禁、外链白名单、Provider 与 `app:info` |
| `preload.js` | 在 sandboxed preload 中暴露最小 `window.oak` API；不提供任意命令或直接 `fix` 通道 |
| `python-bridge.js` | 以参数数组、`shell=false` 和清理后的环境调用 Python JSON CLI |
| `python-invocation.js` | 桥与资源门禁共用的 `-I -S -X utf8` bootstrap；显式插入受控 core 绝对目录 |
| `core-result.js` | 区分退出码 1 业务结果与退出码 2 错误，并保留 Python 结构化错误字段 |
| `core-ipc.js` | `plan-citation` / `check` 的项目路径、六种体例和 opaque citation plan ID 白名单；注册固定 IPC |
| `providers/index.js` | Auth/License 离线状态机、Free/Pro 权益矩阵、SyncRecord v1 exact 构造/校验与当前进程队列 |
| `account-sync-ipc.js` | 只从可信 Python 来源构造同步预览，缓存负载，并接收 opaque 幂等 ID 与四种固定选择 |
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

打包安全另由 `scripts/electron_fuse_policy.js` 固定：必须启用 ASAR 与 embedded integrity、显式设置全部已知 fuse，并在 electron-builder 后从真实应用二进制读回。Electron 43 当前多出一个本地工具无法识别的 wire 索引；alpha 必须带 blocker，sale 失败关闭。`RunAsNode=true` 仍是 Ace helper 的临时兼容值。详见 `docs/ELECTRON_FUSE_POLICY.md`。

PDF session 不使用 `persist:`、禁缓存并设置 `javascript=false`；专用 CSP 只允许自包含 HTML 所需的内联样式和 `data:` 图片。加载报告前后核对文件身份，拒绝项目根/`exports`/报告/目标的 symlink、junction/reparse、硬链接和目录身份换入，最后同目录原子写入。

`python-invocation.js` 不依赖 `PYTHONPATH`、site-packages 或工作目录：固定 bootstrap 把路径策略给出的 core 目录放到 `sys.path[0]`，再以 `runpy` 启动模块；桥与 Python runtime 探针使用同一参数字节序列和隔离环境。

`app:info` 返回 `appVersion`、经当前存储重新验证的七字段 `standardIdentity` 和 `packaged=app.isPackaged`。smoke 必须先通过 Renderer 规划并确认引用解析，再读取本次创建的 `project.json` 及其引用报告，核对 Python core 版本、check ID、`citation_resolution`，以及 APP/项目/检查/报告的完整标准身份；打包 smoke 还强制 `packaged=true`。打包态 Python、JRE 或 Ace stage 失配时必须失败关闭，不得回退用户环境中的同名代码资源；Electron 43.1.0 `win32-x64` 自身仍由受版本控制的全树锁固定：2 个目录、75 个文件、364,083,658 字节，manifest SHA-256 为 `ae67132b95e21b62450fd0e34faaf00164514b38322076c56e37c0301c520d95`。当前 Ace 浏览器运行时仍依赖用户系统 Chrome。

账号与同步 IPC 不接受 Renderer 自带的负载、token、URL 或 transport；主进程通过固定 `sync-source` 命令取值并重建 SyncRecord v1。当前 Auth 登录为未配置的系统浏览器 PKCE 契约，License 为未签名本地能力矩阵，Sync 队列仅存在于当前进程且不联网。详见 `docs/SYNC_RECORD_V1.md`。

当前 `0.1.0-alpha.9` 最新源码 smoke 已在独立隐藏 Electron 中 PASS；运行根为 `out/source-smoke/runs/ms49yas5-9ccb167e78f033a2/projects/`，DOCX/EPUB 两个项目均先确认默认引用解析，各记录 4 次检查、1 次批量修复、3 个检查点且 `integrity.source_hash_ok=true`，PDF 分别为 251,650 / 177,417 字节；另断言默认未登录、Free 与空队列。`release/` 尚无对应 alpha.9 EXE，因此不能声称 packaged fuse、打包 smoke 或发布证据已通过。
