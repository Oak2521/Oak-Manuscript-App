# Temurin 21.0.11 Windows x64 JDK/JRE 来源审计

> 审计日期：2026-07-28
>
> 适用范围：`tools/jre-win32-x64/`
>
> 机器证据：已验证
>
> 人工签署：待完成
>
> 销售结论：本审计尚不能关闭正式销售门禁

## 1. 结论

应用内 JRE 由 Eclipse Adoptium Temurin `21.0.11+10` Windows x64 JDK 通过固定 `jlink` 参数生成。固定官方 ZIP、本机源 JDK 与受版本控制证据中的文件树均为 490 个文件、343,822,457 字节，路径、大小和 SHA-256 为 490/490 逐字节一致；树摘要为 `613c12718b72625393d84c35b4f09886e7e67addcb401a0b1949902eb05d8932`。

生成的 JRE 为 207 个文件、52,384,264 字节，树摘要 `16efd16ec81ed492a6c3c285f313456ec216099fb87000c1e607973c9e99210e`。其中 94 个 `NOTICE`/`legal/` 文件与官方 JDK 原字节一致；另生成 `SOURCE_JDK_RELEASE.txt` 和 `THIRD_PARTY_NOTICES.md`。JRE manifest、运行时锁、provenance evidence、应用 loose 资源清单和 `app.asar` 锚点形成逐层绑定。

机器来源链已经成立，但 OpenPGP 签名没有完成密码学验证：已固定官方 `.sig`、Adoptium 公钥端点返回字节和各自摘要，本机没有 GPG/OpenPGP 验证器，因此证据明确记录 `not_verified_no_openpgp_tool`。许可证、Classpath/Assembly Exception、第三方 notice、商标和源代码提供义务仍需具名人员签署。因此 blocker 只能收窄为 `JRE_SOURCE_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，不能删除。

## 2. 官方来源与制品

| 项目 | 值 |
|---|---|
| 发布方 | Eclipse Adoptium |
| Release | <https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.11%2B10> |
| Tag / 发布时间 | `jdk-21.0.11+10` / `2026-04-23T06:32:33Z` |
| 制品 | `OpenJDK21U-jdk_x64_windows_hotspot_21.0.11_10.zip` |
| 大小 | 205,073,954 字节 |
| SHA-256 | `d3625e7cadf23787ea540229544b6e2ab494b3b54da1801879e583e1dfee0a64` |
| GitHub server digest | `sha256:d3625e7cadf23787ea540229544b6e2ab494b3b54da1801879e583e1dfee0a64` |
| 官方 checksum 内容 | 同一 SHA-256 与同一文件名 |
| Build metadata | vendor/OS/arch/type/version 与制品摘要全部匹配 |

经用户明确许可，ZIP、checksum、build metadata、detached signature、release API JSON 与 Adoptium 公钥保存在被忽略的 `out/downloads/provenance/temurin-21.0.11+10/`；普通只读验证不依赖这些下载文件。

## 3. 固定派生

`jlink` 固定模块策略为 `fixed-conservative-java-se`，请求 `java.se,jdk.unsupported,jdk.xml.dom`，并固定 `--strip-debug --no-header-files --no-man-pages --compress=2`。生成后实际包含 23 个模块；EpubCheck 5.3.0 好样本退出 0 且零 fatal/error，缺陷样本退出 1 且检出 5 个 error。

验证器拒绝：官方制品/API/checksum/build metadata 漂移、ZIP 路径逃逸和不安全特性、本机 JDK 任一文件增删改、JRE manifest/文件树/模块策略漂移、许可材料改变、锁未精确绑定 evidence、自批准或未知字段。

## 4. 许可与签名边界

随包保留 `NOTICE`、各模块完整 `legal/` 材料、GPLv2/Classpath Exception、OpenJDK Assembly Exception 与第三方许可证文本。本轮没有修改这些官方文件。

已验证的是下载字节、GitHub 服务端摘要、官方 checksum、build metadata、490 文件树、本机 JDK 和生成 JRE 的精确绑定。未声称：

- detached signature 已完成 OpenPGP 密码学验证；
- Adoptium 公钥的独立信任路径已建立；
- 已复现 Adoptium 源码构建；
- 已完成人工法律、商标、源代码提供或第三方再分发审计。

## 5. 受版本控制的证据与命令

- 证据：`config/provenance/temurin-21.0.11+10-win32-x64.json`
- 证据 SHA-256：`dbbf5e4799d88820b7c4475e178e45a7624fbf104b7b5fdc4f78d6650c39d676`
- schema：`config/schemas/jre-provenance-v1.schema.json`
- 验证器：`scripts/jre_provenance.js`
- JRE 锁：`config/tool-manifests/jre-win32-x64.json`

```powershell
npm run verify:provenance:jre:win
npm run verify:resources:win
```

重新取得全部官方输入并复核后，才可显式更新 evidence；更新仍固定人工待签：

```powershell
node scripts/jre_provenance.js --update-evidence
node scripts/stage_epubcheck_jre.js --update-lock --jdk-home "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
```

## 6. 正式销售前人工签署

| 项目 | 状态 |
|---|---|
| 使用可信 OpenPGP 工具验证 detached signature 与批准的 Adoptium key/fingerprint | 待完成 |
| 复核 GPLv2/Classpath/Assembly Exception 的最终分发义务 | 待完成 |
| 复核 94 份官方 notice/legal 材料及第三方许可证呈现 | 待完成 |
| 复核 Temurin/Eclipse/Java 商标使用 | 待完成 |
| 决定并记录对应源代码提供方式 | 待完成 |
| 签署人、角色、日期和结论 | 待填写 |

上述项目完成前，权威状态必须保持：`machine_status=verified`、`human_review_status=pending`、`JRE_SOURCE_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`。
