# CPython 3.13.14 Windows x64 运行时来源审计

> 审计日期：2026-07-28  
> 适用范围：`python-runtime/`（Windows x64）  
> 机器证据：已验证  
> 人工签署：待完成  
> 销售结论：本审计尚不能关闭正式销售门禁

## 1. 结论

仓库内 Windows x64 Python 运行时可机械追溯到 Python Software Foundation 发布的 CPython 3.13.14 embeddable package。官方压缩包有 34 个文件；本地也有 34 个文件，其中 33 个逐字节一致，唯一差异是 `python313._pth` 在官方 80 字节后精确追加 `..\python\r\n`，用于把打包后的 Oak Manuscript Python 核心加入隔离搜索路径。官方 `LICENSE.txt` 原样保留。

该结论由受版本控制的 canonical JSON 证据和可重复验证器约束，不依赖人工复制的文件名或版本说明。但是，完整 Sigstore 信任链未独立重放，官方 Sigstore bundle 内两个 transparency log index 不一致，GPG 签名未做密码学验证，且再分发义务仍缺具名人工签署。因此当前 sale blocker 只能从“无来源证据”收窄为“等待人工来源/许可签署”，不能删除。

## 2. 官方来源

| 项目 | 值 |
|---|---|
| 发布者 | Python Software Foundation |
| 发布版本 | CPython 3.13.14 |
| 发布日期 | 2026-06-10 |
| 发布页 | <https://www.python.org/downloads/release/python-31314/> |
| 官方文件目录 | <https://www.python.org/ftp/python/3.13.14/> |
| Windows embeddable package 说明 | <https://docs.python.org/3.13/using/windows.html> |
| Python 许可说明 | <https://docs.python.org/3.13/license.html> |
| 制品 | `python-3.13.14-embed-amd64.zip` |
| 大小 | 10,964,839 字节 |
| SHA-256 | `90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907` |

上游发布页标题和下载项均指向 3.13.14，但页面正文有一句 “This is Python 3.13.13.”。这是上游页面内部文本不一致；本地身份判断不采用该句，而由精确 URL、制品文件名、制品摘要、SPDX 和运行时文件树共同约束。

## 3. 下载旁证

经用户明确许可后，从 `python.org` 下载了下列只读审计输入；下载物保存在被忽略的 `out/downloads/provenance/python-3.13.14/`，不作为受信任的仓库发布物：

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `python-3.13.14-embed-amd64.zip` | 10,964,839 | `90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907` |
| `.sigstore` | 5,503 | `ec9e3f2bb3d21f80d17c43b3fbc93aed0abc98e10912e8dbd744c41c3d797597` |
| `.spdx.json` | 15,341 | `ff85d80144dffbd3a3498a4bce568f6ab3fec614842eafda2b562f4c4e9bd247` |
| `.asc` | 836 | `d353820d165a4e8612f788cdc151114440d7960ebd82b10a41784fe82b9c4687` |

## 4. 文件树推导

| 检查 | 结果 |
|---|---|
| 官方文件数 | 34 |
| 本地文件数 | 34 |
| 逐字节一致 | 33 |
| 新增或缺失文件 | 0 |
| 受控差异 | 1：`python313._pth` |

受控差异固定如下：

| 字段 | 官方 | 本地 |
|---|---|---|
| 大小 | 80 | 91 |
| SHA-256 | `35ddf94682ff9aa713a8d63557242ad00f3f28fdd39337f02c3bda4c0f791577` | `2efdbbdf241cbac96a77d6fcebeac4a23e56578004da5f7e97883d9480f18712` |
| 变更 | 无 | 只在官方字节后追加 UTF-8 `..\python\r\n` |

验证器拒绝其它任何增删、摘要漂移、追加内容变化、顺序变化或运行时文件身份变化。该追加保留 embeddable package 的 isolated mode，并未启用 `site`。

## 5. 许可与再分发

- 官方 SPDX 文档声明 supplier 为 `Organization: Python Software Foundation`，`licenseConcluded` 为 `PSF-2.0`，且其制品摘要与下载的 ZIP 一致。
- 本地 `python-runtime/LICENSE.txt` 与官方文件逐字节一致，SHA-256 均为 `62bec384df47b0328307db41455ff6ea2559e5546b394ac69148561b21703120`。
- `_pth` 的受控修改已在机器证据和本文件中明确披露。
- 这不是法律意见。正式销售前仍需具名人员审阅 PSF License、随包 notice、修改披露与最终安装包中的实际文件，并签署结论。

## 6. Sigstore、SPDX 与 GPG 验证边界

机器验证已经确认：

- Sigstore bundle 内 artifact digest 与 ZIP SHA-256 一致；
- bundle 中 leaf signature 使用证书公钥验证成功；
- 证书 issuer 为 `O=sigstore.dev, CN=sigstore-intermediate`，identity 为 `email:thomas@python.org`；
- 证书有效期为 `2026-06-10T16:04:20Z` 至 `2026-06-10T16:14:20Z`；
- Rekor canonical body 绑定同一制品摘要；
- SPDX 2.3 文档的制品摘要、supplier 和 concluded license 均符合固定预期。

机器验证没有声称：

- 已独立重放完整 Fulcio/Rekor 信任链；
- 已验证 detached GPG signature；
- 已解释或修复上游 Sigstore bundle 的 index 不一致。

上游 bundle 同时给出 tlog entry `logIndex=1780928370` 与 inclusion proof `logIndex=1659024108`（`treeSize=1659024109`）。两值均原样保存在证据中，`transparency_log_index_consistent=false`。不得选择其中一个覆盖另一个，也不得把 leaf signature 成功改写成完整 Sigstore 验证成功。

## 7. 受版本控制的证据与命令

- 证据：`config/provenance/cpython-3.13.14-win32-x64.json`
- 证据 SHA-256：`b198a727a0c12640a8a020758bcfc5dc41e01e577a25576795b1d081e3513176`
- schema：`config/schemas/runtime-provenance-v1.schema.json`
- 验证器：`scripts/runtime_provenance.js`
- 运行时清单：`config/tool-manifests/python-runtime-win32-x64.json`

只读复核：

```powershell
npm run verify:provenance:python:win
npm run verify:resources:win
```

只有在重新取得并审核官方输入时才可显式更新证据：

```powershell
node scripts/runtime_provenance.js --update-evidence `
  --archive out/downloads/provenance/python-3.13.14/python-3.13.14-embed-amd64.zip `
  --sigstore out/downloads/provenance/python-3.13.14/python-3.13.14-embed-amd64.zip.sigstore `
  --spdx out/downloads/provenance/python-3.13.14/python-3.13.14-embed-amd64.zip.spdx.json
```

更新操作使用安全父链检查、单链接输入、稳定读取、canonical JSON、独占候选、`fsync` 和原子替换；更新后仍保持 `human_review_status=pending`，工具不得替人工签署。

## 8. 正式销售前人工签署

| 项目 | 状态 |
|---|---|
| 复核官方制品与当前仓库/安装包一致 | 待完成 |
| 复核 PSF-2.0 与随包 notice/许可呈现 | 待完成 |
| 复核 `_pth` 修改披露 | 待完成 |
| 处理或接受 Sigstore index 不一致 | 待完成 |
| 选择并完成完整 Sigstore 或 GPG 独立验证 | 待完成 |
| 签署人、角色、日期和结论 | 待填写 |

在上述项目完成前，权威状态必须保持：`machine_status=verified`、`human_review_status=pending`、`PYTHON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`。
