# Windows electron-builder 工具链来源审计

> 审计日期：2026-07-28
>
> 机器证据：已验证
>
> 人工签署：待完成
>
> 销售结论：本审计尚不能关闭正式销售门禁

## 1. 结论

electron-builder 26.15.3 使用的三份旧版官方 GitHub 归档已由 release API 的 tag、发布时间、资产 URL 与大小绑定，并与 `app-builder-lib` 26.15.3 代码内固定 SHA-256 交叉核对：

| 归档 | 字节数 | SHA-256 |
|---|---:|---|
| `nsis-3.0.4.1.7z` | 1,287,512 | `9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa` |
| `nsis-resources-3.4.1.7z` | 730,800 | `593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103` |
| `winCodeSign-2.6.0.7z` | 5,635,384 | `cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4` |

固定 7z 解压器和安全导入器从三份归档重新组装出 385 文件、19,150,116 字节的工具树，与 tracked lock 385/385 一致；树摘要为 `ff8e0f5f1175de445a57893dedde17a48c3365def4b1c00350841aff23e1d171`。

但三份 2019—2020 年旧 GitHub release 没有服务端 digest，也没有 detached signature。组装树只保留 `nsis/COPYING`；`nsis-resources` 与选定的 `winCodeSign` 载荷没有具名许可证文件。因此不能把“哈希和重建一致”写成“许可审计完成”。blocker 只能收窄为 `BUILDER_TOOLCHAIN_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`。

## 2. 受版本控制的证据

- evidence：`config/provenance/electron-builder-win32-x64.json`
- evidence SHA-256：`c16518397eb1d02cfe1beaf70eda5eaab6c6177c03af33f9b071e7f1ec22fbb5`
- schema：`config/schemas/builder-provenance-v1.schema.json`
- tracked lock：`config/tool-manifests/electron-builder-win32-x64.json`
- 验证命令：`npm run verify:provenance:builder:win`

## 3. 人工待办

- 逐项确认 NSIS、本次使用的 NSIS plugins、rcedit 与 Microsoft Windows Kit 工具的真实上游、许可证和使用范围；
- 确认工具仅作为构建输入、不进入最终安装包，并检查其输出物是否附带义务；
- 补齐或记录 `nsis-resources` 与选定 `winCodeSign` 载荷缺少具名许可材料的处置；
- 评估无 GitHub 服务端 digest／签名的旧发布是否满足生产供应链政策；
- 记录签署人、角色、日期和结论。

完成前状态必须保持 `machine_status=verified`、`human_review_status=pending`。
