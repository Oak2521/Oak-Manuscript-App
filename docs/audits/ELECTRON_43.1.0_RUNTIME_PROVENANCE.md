# Electron 43.1.0 Windows x64 运行时来源审计

> 审计日期：2026-07-28
>
> 机器证据：已验证
>
> 人工签署：待完成
>
> 销售结论：本审计尚不能关闭正式销售门禁

## 1. 结论

Electron 官方 `electron-v43.1.0-win32-x64.zip` 为 144,237,574 字节，SHA-256 `a07dc1e3d5e589593d37e3b19d1b373e02bb58270e2eb0d6633eee0198ad09f0`。该值同时匹配 GitHub release API 的服务端 digest、官方 `SHASUMS256.txt` 和 npm `electron` 包内 `checksums.json`。

验证器直接解析固定 ZIP；官方 ZIP 与 `node_modules/electron/dist` 均为 75 个文件、364,083,658 字节，75/75 路径、大小和 SHA-256 一致，树摘要为 `652e9b29f6f8f37b7d8d8beffb2eb5c149efb7afe54bcf65f1df7facadcc0462`。来源 evidence 由 Electron runtime lock、应用资源清单和 ASAR 锚点继续绑定。

GitHub release 快照没有 detached-signature 资产，因此证据明确记录 `not_provided_as_release_asset`；没有把多重摘要交叉核对写成签名验证。MIT 文本、20 MB 级 `LICENSES.chromium.html`、Electron/Chromium 第三方义务、商标与再分发仍需具名人工签署。blocker 只能收窄为 `ELECTRON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`。

## 2. 证据

| 项目 | 值 |
|---|---|
| Release | <https://github.com/electron/electron/releases/tag/v43.1.0> |
| 发布时间 | `2026-07-07T19:27:26Z` |
| 官方 ZIP SHA-256 | `a07dc1e3d5e589593d37e3b19d1b373e02bb58270e2eb0d6633eee0198ad09f0` |
| 官方 ZIP文件树 | 75 文件 / 364,083,658 字节 / 75 个逐字节一致 |
| 来源 evidence | `config/provenance/electron-43.1.0-win32-x64.json` |
| evidence SHA-256 | `5f850b7ad7a5971e3ccf4ecce505ed2793530952081a68afe3c648c1862c5075` |
| schema | `config/schemas/electron-provenance-v1.schema.json` |
| 验证命令 | `npm run verify:provenance:electron:win` |

## 3. 人工待办

- 复核 Electron MIT 许可、Chromium 第三方通知和最终制品呈现；
- 复核 Electron/Chromium 商标与再分发义务；
- 决定无 release 签名资产时可接受的生产信任政策；
- 记录签署人、角色、日期和结论。

完成前状态必须保持 `machine_status=verified`、`human_review_status=pending`。
