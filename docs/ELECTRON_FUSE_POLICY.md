# ELECTRON_FUSE_POLICY — Electron 打包硬化合同

> 当前实现：`0.1.0-alpha.12`。本文件描述源码配置、打包后二进制 fuse、ASAR 资源锚点与受限应用协议合同；真实未签名 Windows alpha 二进制证据已取得。

## 固定策略

`scripts/electron_fuse_policy.js` 要求 `build.asar=true`、`build.disableAsarIntegrity=false`，并固定以下已知 Electron fuse：

| Fuse | 期望值 | 当前说明 |
|---|---:|---|
| `RunAsNode` | `false` | alpha.10 已把 Ace 迁移到固定 Electron `utilityProcess`，不再用 `ELECTRON_RUN_AS_NODE` 启动应用二进制 |
| `EnableCookieEncryption` | `true` | 加密 Chromium cookie 存储 |
| `EnableNodeOptionsEnvironmentVariable` | `false` | 禁止 `NODE_OPTIONS` 注入 |
| `EnableNodeCliInspectArguments` | `false` | 禁止 CLI inspect 参数 |
| `EnableEmbeddedAsarIntegrityValidation` | `true` | 启用嵌入式 ASAR 完整性验证 |
| `OnlyLoadAppFromAsar` | `true` | 只从 ASAR 加载应用 |

alpha.12 把 `electron/resource-trust-anchor.json` 打入 `app.asar`，packaged 门禁从真实 ASAR 读取锚点并复核 loose 全树。由于 `GrantFileProtocolExtraPrivileges=false` 会使 Electron 43 的 `file://...app.asar/...` 页面加载失败，主窗口改用四文件白名单 `oak-manuscript://renderer/`；这不放宽 file 协议。真实 fuse/ASAR/资源和烟测已通过，但不替代代码签名或安装验收。
| `LoadBrowserProcessSpecificV8Snapshot` | `false` | 不启用当前未使用的 browser-specific snapshot |
| `GrantFileProtocolExtraPrivileges` | `false` | 不扩大 `file:` 协议权限 |
| `ResetAdHocDarwinSignature` | `false` | 不要求 fuses 工具重置 macOS ad-hoc 签名 |

配置缺项、多项、值漂移、继承态或 removed 状态一律拒绝。构建顺序必须是：配置验证 → electron-builder → 真实打包二进制 fuse 验证 → 打包资源门禁 → 隐藏 packaged smoke → 发布证据生成。

`RunAsNode=false` 的源码证据包括：固定 utility module/参数/环境、主进程绑定的外部验证 plan/prepare/finalize、受控 loopback Chrome 以及真实隐藏源码 smoke。它仍不能替代真实打包二进制读回和 packaged Ace 功能/安全回归；`ACE_CONTROLLED_HELPER_PENDING` 只能在这些制品证据完成后关闭。

## 二进制验证边界

验证器只接受仓库内、安全父链下、非链接、单链接、非空的常规文件，并在读取 fuse 前后核对稳定文件身份。已知 fuse 必须逐项与固定策略精确一致。

当前本地 `electron.exe` 为 Electron 43.1.0，fuse wire 版本为 1，暴露索引 0—8 共 9 项；仓库已安装的 `@electron/fuses` 1.8.0 只定义索引 0—7。索引 8 的原始状态字节为 `49`（启用），但本仓库没有可信本地定义可确定它的名称和安全语义，因此不得猜测。

- alpha：已知 fuse 全部匹配时可以继续，但必须返回 `ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING` blocker；
- sale：出现任何未知 fuse 必须失败关闭；
- 只有升级并验证兼容工具、识别索引 8、明确期望状态且取得真实打包二进制证据后，才能关闭该阻断。

## 本地命令

```bash
npm run verify:fuses:config
npm run verify:packaged:fuses:win
npm run verify:packaged:fuses:mac:x64
npm run verify:packaged:fuses:mac:arm64
```

后三项要求对应真实打包二进制存在。源码 Electron runtime 只能用于兼容性调查，不能冒充打包产物验证。
