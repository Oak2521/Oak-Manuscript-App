# EpubCheck 5.3.0 官方分发来源审计

> 审计日期：2026-07-28
> 适用范围：`tools/epubcheck-5.3.0/`
> 机器证据：已验证
> 人工签署：待完成
> 销售结论：本审计尚不能关闭正式销售门禁

## 1. 结论

仓库内 EpubCheck 5.3.0 分发是 W3C/DAISY 官方 release ZIP 的逐字节副本：验证器直接解析固定 ZIP 中央目录、拒绝多卷/ZIP64/加密/链接/路径逃逸和不支持的压缩方法，并对每个条目解压后计算 SHA-256；由 ZIP 直接推导的树和本地树均为 49 个文件、36,263,890 字节，49 个文件的路径、大小和 SHA-256 全部一致，没有受控修改。官方 GitHub release API 报告的 ZIP 大小和服务器 SHA-256 与实际下载字节一致，API JSON 原始字节摘要也被精确固定。

机器来源链已经成立，但许可信号存在必须人工解决的上游矛盾：官方分发 `LICENSE.txt` 和项目仓库声明 BSD-3-Clause，当前 EpubCheck 官网首页却写 MIT。官方 ZIP 没有独立 artifact signature；GitHub 页面显示签名 tag，但本轮未独立验证该 tag，且 tag 签名本身不直接绑定由 GitHub 生成的 ZIP 字节。第三方 notice 与再分发义务也仍需具名人工签署。因此 blocker 只能收窄为 `EPUBCHECK_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，不能删除。

## 2. 官方来源与制品

| 项目 | 值 |
|---|---|
| 项目 | W3C EPUBCheck，由 DAISY Consortium 维护/发布 |
| Release | <https://github.com/w3c/epubcheck/releases/tag/v5.3.0> |
| Release API | <https://api.github.com/repos/w3c/epubcheck/releases/tags/v5.3.0> |
| 发布日期 | 2025-09-01T16:06:11Z |
| 官方安装说明 | <https://w3c.github.io/epubcheck/docs/installation/> |
| 制品 | `epubcheck-5.3.0.zip` |
| URL | <https://github.com/w3c/epubcheck/releases/download/v5.3.0/epubcheck-5.3.0.zip> |
| 大小 | 33,071,108 字节 |
| SHA-256 | `6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5` |
| GitHub server digest | `sha256:6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5` |

经用户明确许可，审计输入保存在被忽略的 `out/downloads/provenance/epubcheck-5.3.0/`；受版本控制的证据不依赖该目录做普通只读复核。

## 3. 分发树推导

| 检查 | 结果 |
|---|---|
| 官方 ZIP 直接解析文件数 | 49 |
| 本地文件数 | 49 |
| 官方/本地总字节 | 36,263,890 / 36,263,890 |
| 路径、大小与 SHA-256 逐项一致 | 49 / 49 |
| 新增、缺失或受控修改 | 0 |
| `epubcheck.jar` SHA-256 | `f7f96617c929371821609b88c8484d6dc9f24fe916499863c46094c5fb778a65` |

`config/tool-manifests/epubcheck-5.3.0.json` 继续固定实际运行树，并新增对 provenance 原始字节 SHA-256 的绑定；JRE 的 EpubCheck 探针锁和 ASAR 资源锚点再绑定更新后的分发 manifest，避免只更新证据而留下旧下游信任根。

## 4. 许可与再分发边界

官方 ZIP 原样包含：

- `LICENSE.txt`：BSD 3-Clause 文本及 Adobe、IDPF、W3C copyright notice；
- `THIRD-PARTY.txt`：列出直接/打包依赖及许可证；
- `licenses/Apache-2.0.txt`、`BSD-3-Clause.txt`、`MIT.txt`、`MPL-2.0.txt`、`W3C.txt`。

上游信号不一致：

- 官方 ZIP 与 GitHub 仓库：BSD-3-Clause；
- 当前 <https://w3c.github.io/epubcheck/> 首页：“licensed under MIT”。

机器证据固定 `license_signal_consistent=false`，不自行选择对销售更方便的解释。正式销售前必须由具名人员核对主许可证、第三方组件、notice 呈现与官网错误是否已被上游纠正，并记录采用依据。

## 5. 签名与摘要边界

已验证：

- 下载 ZIP 的实际 SHA-256；
- GitHub release API 对该 asset 返回的服务器 SHA-256 与实际摘要一致；
- release API JSON 原始 SHA-256、tag、名称、发布时间、asset URL、大小和 digest 精确匹配固定策略；
- 从固定 ZIP 直接解压并计算的文件树与本地运行树逐字节一致。

未声称：

- 官方发布了 detached artifact signature；
- 已独立验证 Git tag 的 GPG 签名；
- Git tag 签名直接绑定 GitHub 生成的 release ZIP；
- 已完成人工许可/法律审计。

## 6. 受版本控制的证据与命令

- 证据：`config/provenance/epubcheck-5.3.0.json`
- 证据 SHA-256：`2f5191140fd119bb288a71becf8ca3ddf077d17bc71aea12b179c502075735b0`
- schema：`config/schemas/epubcheck-provenance-v1.schema.json`
- 验证器：`scripts/epubcheck_provenance.js`
- 分发清单：`config/tool-manifests/epubcheck-5.3.0.json`

只读复核：

```powershell
npm run verify:provenance:epubcheck
npm run verify:resources:win
```

证据更新只允许在重新取得并审核官方 ZIP 和 GitHub release API JSON 时显式执行；文件树由验证器直接从 ZIP 字节推导，不接受调用者提供的“官方解压目录”：

```powershell
node scripts/epubcheck_provenance.js --update-evidence
```

更新后仍固定 `human_review_status=pending`；机器工具没有自批准路径。

## 7. 正式销售前人工签署

| 项目 | 状态 |
|---|---|
| 复核官方 ZIP 与当前仓库/最终安装包一致 | 待完成 |
| 解决官网 MIT 与随包 BSD-3-Clause 矛盾 | 待完成 |
| 复核 BSD-3-Clause copyright/notice 呈现 | 待完成 |
| 逐项复核 `THIRD-PARTY.txt` 与随包许可证材料 | 待完成 |
| 决定是否独立验证 tag GPG 或取得更强 artifact 签名 | 待完成 |
| 签署人、角色、日期和结论 | 待填写 |

上述项目完成前，权威状态必须保持：`machine_status=verified`、`human_review_status=pending`、`EPUBCHECK_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`。
