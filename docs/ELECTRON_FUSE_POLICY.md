# ELECTRON_FUSE_POLICY — Electron 打包硬化合同

> 当前实现：`0.1.0-alpha.15`。本文件描述源码配置、打包后强制写入与回读、ASAR 资源锚点及受限应用协议合同；真实未签名 Windows alpha 二进制证据已取得。

## 固定策略

`scripts/electron_fuse_policy.js` 要求 `build.asar=true`、`build.disableAsarIntegrity=false`、注册 `scripts/after_pack.js`，并固定 Electron 43 wire v1 的全部 9 项 fuse：

| 索引 | Fuse | 期望值 | 说明 |
|---:|---|---:|---|
| 0 | `RunAsNode` | `false` | Ace 使用固定 Electron `utilityProcess`，不允许 `ELECTRON_RUN_AS_NODE` |
| 1 | `EnableCookieEncryption` | `true` | 加密 Chromium cookie 存储 |
| 2 | `EnableNodeOptionsEnvironmentVariable` | `false` | 禁止 `NODE_OPTIONS` 注入 |
| 3 | `EnableNodeCliInspectArguments` | `false` | 禁止 CLI inspect 参数 |
| 4 | `EnableEmbeddedAsarIntegrityValidation` | `true` | 启用嵌入式 ASAR 完整性验证 |
| 5 | `OnlyLoadAppFromAsar` | `true` | 只从 ASAR 加载应用 |
| 6 | `LoadBrowserProcessSpecificV8Snapshot` | `false` | 不启用当前未使用的 browser-specific snapshot |
| 7 | `GrantFileProtocolExtraPrivileges` | `false` | 不扩大 `file:` 协议权限 |
| 8 | `WasmTrapHandlers` | `true` | 启用 V8 用于捕获 WebAssembly 越界内存访问的信号处理器 |

顶层开发依赖精确锁定 `@electron/fuses 2.1.3`（要求 Node `>=22.12.0`）。electron-builder 26.15.3 内部仍带 1.8.0，只能处理索引 0—7；因此不能只依赖 `build.electronFuses`。`afterPack` 在打包完成、代码签名前再次调用顶层 2.1.3，设置 `strictlyRequireAllFuses=true` 并显式写入全部 9 项；任何 API 索引漂移、缺项、新增未知 wire 项、非法 sentinel 数量或写后回读不一致都会使构建失败。

macOS arm64 写 fuse 后按官方工具要求设置 `resetAdHocDarwinSignature=true`；Windows 和 macOS x64 为 `false`。这只是打包阶段签名有效性处理，不等于正式 Developer ID 签名、公证或 Windows Authenticode。

alpha.15 继续把 `electron/resource-trust-anchor.json` 打入 `app.asar`，packaged 门禁从真实 ASAR 读取锚点并复核 loose 全树。由于 `GrantFileProtocolExtraPrivileges=false` 会使 Electron 43 的 `file://...app.asar/...` 页面加载失败，主窗口使用只允许四个固定渲染文件的 `oak-manuscript://renderer/`；这不放宽 file 协议。

配置缺项、多项、值漂移、继承态或 removed 状态一律拒绝。构建顺序固定为：配置验证 → electron-builder（含 `afterPack` 全量写入与立即回读）→ 独立真实二进制 fuse 回读 → 打包资源门禁 → 隐藏 packaged smoke → 发布证据生成。

## 二进制验证边界

验证器只接受仓库内、安全父链下、非链接、单链接、非空的常规文件。macOS 除应用入口外还解析并单独验证实际承载 wire 的 `Electron Framework` 文件；读取前后核对该实际文件身份。全部已知 fuse 必须逐项精确一致。

当前 Electron 43.1.0 的 wire v1 暴露索引 0—8。alpha.15 Windows x64 EXE 实测 9 项全部匹配，`unknown_fuses=[]`、`blockers=[]`、`fully_known=true`；归档 alpha.12/alpha.13/alpha.14 的真实 EXE 也已用同一策略验证。未来若出现索引 9 或更高项：

- alpha 可返回机器可读 `ELECTRON_FUSE_TOOL_COMPATIBILITY_PENDING`，但不得称为正式安全验收；
- sale 必须失败关闭；
- `afterPack` 的 `strictlyRequireAllFuses` 会更早直接阻止构建，直到工具和策略都明确更新。

## 本地命令

```bash
npm run verify:fuses:config
npm run verify:packaged:fuses:win
npm run verify:packaged:fuses:mac:x64
npm run verify:packaged:fuses:mac:arm64
```

后三项要求对应真实打包二进制存在。源码 Electron runtime 只能用于兼容性调查，不能冒充打包产物验证。
