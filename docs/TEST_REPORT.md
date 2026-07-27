# TEST_REPORT — 测试报告

> 最近更新：2026-07-27。只记录真实执行结果；未运行项不得写成通过。

## 1. 最新验证结论：0.1.0-alpha.4 源码、构建输入可信链与 Windows alpha 资源

环境：Windows 11；Python 3.14.6；Node 24.16.0；npm 11.13.0；Electron 43.1.0；Java 21.0.11。

| 命令 | 结果 | 说明 |
|---|---|---|
| 最终 `npm test` 的 Node 段 | **TAP 239 项：233 通过、0 失败、6 跳过；2.606 秒** | 含 Electron runtime、builder importer/lock、tracked-file 安全更新和前向/回滚故障矩阵；跳过项不计作通过 |
| Electron runtime 锁专项 | **37 项：36 通过、0 失败、1 跳过** | hardlink 与 junction 反向路径本机实测通过；文件 symlink 因 Windows `EPERM` 条件跳过，不计作通过 |
| 最终 `npm test` 的 Python 段 | **312 项：0 失败、0 错误、3 跳过；80.125 秒** | 默认条件套件；三项跳过不计作通过 |
| 沙箱外隐藏 Chrome：`$env:OAK_TEST_ACE='1'; npm run test:python` | **312 项：0 失败、0 错误、1 跳过；44.807 秒** | 真实 Ace 好/坏样本执行，发布基线以本次隐藏浏览器结果为准 |
| 同一 Ace 命令的受限沙箱诊断 | **预期环境失败：2 断言失败、0 错误、1 跳过** | 两个结果均为 `not_run`，原因是未生成安全的本次报告；随后沙箱外实跑通过，受限结果不替代真实工具证据 |
| `npm test` | **PASS** | 最终统一入口复核同一 Node 239/233/0/6 与 Python 312/0/0/3 基线 |
| `npm run verify:standards` | **PASS** | canonical manifest 与 standards/rulepack/capability 身份一致 |
| `npm run verify:electron-runtime` | **PASS** | Electron 43.1.0 win32-x64：2 目录、75 文件、364,083,658 字节；manifest SHA-256 `ae67132b…520d95` |
| 沙箱外隐藏 Electron `npm run smoke` | **SMOKE-RESULT PASS** | 最新运行根 `out/source-smoke/runs/ms37h0mu-201a90896825d190/projects/`；DOCX/EPUB 各 4 次检查、`source_hash_ok=true`，PDF 为 258,404 / 161,836 字节 |
| `npm run verify:resources:win` | **PASS（alpha）** | Windows x64 Python/JRE/EpubCheck/Ace 全量文件和真实探针通过 |
| `node scripts/verify_packaged_resources.js --platform win32 --arch x64 --release-tier sale --no-runtime-probe` | **预期退出 1：17 blockers** | Electron 全树锁只关闭 trust-root 缺失项；正式来源审计、builder、Ace 隔离和签名仍未完成 |
| `node scripts/run_electron_builder.js --win --x64` | **预期退出 1** | 真实 builder 工具树和 tracked lock 缺失；在 electron-builder 启动前 fail-closed，未联网、未生成安装包或 ZIP |
| `npm run verify:resources:mac:static` | **按预期 FAIL，不执行探针** | 精确缺 darwin-x64/arm64 Electron dist、两架构 Python runtime 锁、`tools/jre-darwin-x64` 与 `tools/jre-darwin-arm64`；静态逻辑可执行不等于 macOS 可构建 |

当前 `0.1.0-alpha.4` 的源码检查点标签为 `chatgpt-v0.1.0-alpha.4`，用途仅是标记源码与本地验证状态。测试没有产生同版本 NSIS、ZIP 或其他可分发二进制。

## 2. alpha.4 构建输入、标准可信链、运行资源与发布门禁覆盖

### Electron 运行时完整树锁

- `config/tool-manifests/electron-43.1.0-win32-x64.json` 固定 2 个目录、75 个文件、364,083,658 字节，原始文件 SHA-256 为 `ae67132b95e21b62450fd0e34faaf00164514b38322076c56e37c0301c520d95`；
- tracked manifest 必须通过严格 JSON 重复键拒绝、owned levels 的 exact schema 和生成器定义的唯一 canonical UTF-8/LF 原始字节校验；
- 锁同时核对 package-lock 的 Electron 版本、resolved 与 integrity，以及实际 dist 的必需文件、目录集合、文件集合、大小和逐文件 SHA-256；默认命令只读，只有显式 `--update-lock` 才写入；
- `--update-lock` 在任何写入前验证安全父链与 realpath 并拒绝目标 symlink/hardlink；候选文件独占创建、写入后 `fsync`，复核父链/目标身份后原子替换，再做换入后严格 JSON/schema/canonical 字节及全树验证。失败恢复旧字节；回滚自身失败会明确报错并保留候选/备份等事务证据；
- Node 反向测试覆盖文件增删/篡改、目录多出、manifest 重复/多列、非 canonical 字节、package-lock 漂移、硬链接、junction/symlink、cross-dist marker 自刷、tracked-file 更新故障和 `electronDist` 禁下载 sentinel；专项结果为 37/36/0/1，hardlink/junction 本机实测通过，文件 symlink 因 Windows `EPERM` 条件跳过；
- 源码和 packaged 资源门禁都重验仓库源码构建输入。有效锁证据仅关闭 `ELECTRON_RUNTIME_TRUST_ROOT_NOT_HARDENED`；官方来源、校验和、再分发与签名责任仍保留。

### Windows builder 固定归档导入与独立 lock

- 来源合同独立固定三份归档：`nsis-3.0.4.1.7z` SHA-256 `9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa`、`nsis-resources-3.4.1.7z` SHA-256 `593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103`、`winCodeSign-2.6.0.7z` SHA-256 `cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4`；
- 显式导入器固定本地 7z EXE/DLL，预检归档技术清单，拒绝 UNC/device 来源、逃逸/绝对/保留/冲突路径、链接、备用流、加密/反条目和容量异常；解压后再核对全树、大小、realpath、硬链接与归档哈希；
- 组装的 manifest 和 `config/tool-manifests/electron-builder-win32-x64.json` 独立 lock 交叉绑定来源归档、manifest 原始字节和完整工具树。只有显式 `--update-lock` 才能联合事务提交；普通 build/test 不会导入或刷新；
- 反向测试覆盖缺档/多档/错哈希、路径与链接、缺关键载荷、严格 JSON/schema、manifest 字节漂移、不安全祖先 junction、旧 tree/lock 硬链接，以及 4 个前向/4 个回滚 rename 故障；回滚自身失败会保留事务恢复证据；
- 本机没有真实三归档，所以没有实际工具树或 tracked lock。导入测试使用构造载荷验证算法，不是正式来源或可打包证据。

### 标准包身份、存储与项目升级

- `config/standard-packs/oak-standards-1.0.0.manifest.json` canonical SHA-256 为 `d33534f081b2122a90652ee03304a0e71177a7fd0d3130fffe77b0fea807d7af`；规则包原始字节 SHA-256 为 `7ac5a5bdb126e9f5148a040ce42a634b1a95295c27d7a72c774db54bf7129542`；
- Node 正向/反向测试覆盖严格重复键与 Unicode/深度/大小/日期/HTTPS 校验、能力映射、Ed25519 门槛签名、内容寻址存储、bundle/版本/序列唯一性、高水位、撤回/过期/APP 兼容性、精确 rollback target、跨进程 owner token、崩溃恢复与未知状态 fail-closed；
- 内置 release 离线 bootstrap、重新验证 active identity、本地签名包预览/安装与全局回滚路径通过；由于生产 trust digest 为空，真实本地签名包导入按设计禁用，未被误记为可用；
- Python 测试覆盖 manifest/payload/CAS 重验、七字段项目 pin、Electron `OAK_EXPECTED_STANDARD_IDENTITY` 精确绑定、历史 release 解析、升级/降级差异、计划过期、写锁争用、检查点、issues 归档、原子提交、升级后强制重检，以及检查/报告/修复/导出拒绝陈旧身份；
- migration-source 回归证明撤回、过期与 APP 兼容性可以在显式迁移路径中受控放宽，但 capability digest 和逐规则 milestone/auto-fix/fix ID 映射永不放宽；
- Renderer/IPC 测试证明项目目标 digest 由主进程选择，UI 只显示项目与 active 的完整差异并一次确认。全局升级不会静默改变已有项目；
- 当前没有标准包在线检查、下载、断网重试或生产签名/撤回服务，因此这些网络路径没有运行，也不能写成通过。

### Windows Python 运行时

- 受版本控制的清单覆盖 **34 个文件、21,260,753 字节**，逐文件固定相对路径、大小和 SHA-256；
- 检查平台/架构、PE 文件、Python 版本、必需 DLL/ZIP/许可证及 `python313._pth` 隔离语义；
- 缺文件、多文件、哈希篡改和不安全 `_pth` 配置均有 Node 反向测试并会被拒绝；
- 只有全量资源和所有全局门禁均无错误后才允许执行 Python 探针；本轮 Windows alpha 门禁已实际执行探针并读到核心版本 `0.1.0-alpha.4`；
- Electron、smoke 与资源探针统一通过净化环境及 `-I -S -X utf8` 固定 bootstrap 调用核心，拒绝工作目录、用户 site 和继承的 Python/OAK 环境注入；
- macOS x64/arm64 CPython 目标版本均固定为 `3.13.14`；这是清单契约与反向测试证据，不是实际 macOS 运行时已经到位的证据。

### JRE 与 EpubCheck

- JRE 清单覆盖 **207 个文件、52,384,264 字节**；固定来源 JDK 输入锁、裁剪模块、Java 版本、平台/架构、许可证和全部文件哈希；
- EpubCheck 5.3.0 完整分发清单覆盖 **49 个文件、36,263,890 字节**，包括 JAR、依赖、schemas 和许可证；缺失、多余、篡改或符号链接均拒绝；
- JRE 内 EpubCheck 探针同时执行好样本和缺陷样本：好样本必须退出 0 且零错误，缺陷样本必须非零退出且报告错误；任何一边结果不符均不通过；
- JRE 的 staged runtime 与受版本控制 lock 作为同一事务提交；目录换入或 lock 提交失败会恢复旧运行时和旧 lock 的原始字节；
- macOS 锁文件按 `darwin-x64` / `darwin-arm64` 分开选择，不会复用 Windows 锁；对应资源尚未准备，所以 macOS 门禁如实失败。

### Ace

- 阶段包覆盖 **236 个包、6,672 个文件、58,964,235 字节**，仅含生产依赖闭包；受版本控制的 `ace-1.4.6.json` full lock 固定 stage manifest 哈希、包数、文件数和字节数；
- 所有包、文件、许可证材料和依赖可达性均校验；staging 与资源 gate 都拒绝空许可证文件；stage 与 tracked lock 事务失败会恢复旧目录和旧 lock；
- 固定、审核并哈希校验一个 XHTML 隔离替换：作者 XHTML 在 JavaScript 禁用状态下加载，作者脚本/事件处理器/危险嵌入被移除，加载协议限制到受控范围；
- packaged 模式只能使用随包资源，不会回退到开发树或 PATH；非零 Ace 退出一律记为 `not_run`，不把运行异常伪装成“发现无障碍问题”；
- 最新沙箱外隐藏 Chrome `OAK_TEST_ACE=1` 已真实执行 Ace 好/坏样本并通过；同轮受限运行器没有生成安全报告，两个 Ace 断言如实得到 `not_run`，随后在原生隐藏浏览器环境重跑通过。18 个使用生成元数据通知的包仍缺原始许可证审计，全部 236 包仍缺来源、许可证、版权和再分发义务人工审计；OS 级网络隔离、受控 helper 和自带浏览器也仍属于正式发布阻断项。
- tracked full lock 同时固定解析语义与 `tools/ace/manifest.json` 原始字节 SHA-256；仅改变空白/序列化而保持 JSON 语义等价也会被拒绝。

### 确定性清单与 macOS 执行边界

- 文件清单、模块数组和 canonical JSON 统一使用 JavaScript UTF-16 code-unit 比较，不依赖宿主 locale、ICU 或用户排序规则；参与字节级锁定的清单和 Ace 替换固定 LF checkout；
- `build:mac:x64` 与 `build:mac:arm64` 只能在相应 darwin 原生 runner 执行资源探针和构建；聚合 `build:mac` 只派发当前主机的原生架构，不伪造另一架构；
- `verify:resources:mac:static` 是跨主机静态聚合，显式设置 `--no-runtime-probe`；报告必须保持 `runtime_probe_executed=false`；
- 当前两架构 Electron/Python/JRE 资源均不完整，因而静态聚合失败是正确结果，不能写成 macOS 构建或运行通过。

### Windows sale 门禁

alpha 门禁实际执行运行时探针并通过；sale 门禁以以下 17 项机器可读 blocker 按设计失败：

1. `FORMAL_LICENSE_AUDIT_REQUIRED`：Ace 18 个依赖包仍需正式人工许可证审计；
2. `PYTHON_RUNTIME_PROVENANCE_AUDIT_REQUIRED`；
3. `EPUBCHECK_PROVENANCE_AUDIT_REQUIRED`；
4. `JRE_SOURCE_PROVENANCE_AUDIT_REQUIRED`；
5. `EPUBCHECK_TRUST_ROOT_NOT_HARDENED`；
6. `JRE_TRUST_ROOT_NOT_HARDENED`；
7. `PYTHON_RUNTIME_TRUST_ROOT_NOT_HARDENED`；
8. `APP_RESOURCES_TRUST_ROOT_NOT_HARDENED`；
9. `ELECTRON_RUNTIME_PROVENANCE_AUDIT_REQUIRED`；
10. `BUILDER_TOOLCHAIN_PROVENANCE_AUDIT_REQUIRED`；
11. `BUILDER_TOOLCHAIN_TRUST_ROOT_NOT_HARDENED`；
12. `ACE_FULL_LICENSE_AUDIT_REQUIRED`：Ace 完整生产依赖闭包的正式人工审计；
13. `ACE_TRUST_ROOT_NOT_HARDENED`；
14. `ACE_CONTROLLED_HELPER_PENDING`；
15. `ACE_BROWSER_RUNTIME_PENDING`；
16. `ACE_OS_NETWORK_ISOLATION_PENDING`；
17. `WINDOWS_CODE_SIGNING_PENDING`。

因此当前只可表述为“Windows alpha 源码资源门禁通过”，不能表述为“安装包已完成”“正式版已通过”或“可售卖”。

## 3. alpha.4 项目、路径、IPC 与桌面安全覆盖

### Electron 默认离线与 PDF 隔离

- 正常启动在 `app.ready` 前应用固定离线 Chromium switches，并在默认 session 取消 `http/https/ws/wss/ftp` 请求；Renderer 固定 CSP 继续禁止远程脚本和主动嵌入；
- 未来获用户授权的联网 Provider 必须使用独立受限传输/session，不能解除默认 session 的进程级离线基线；
- 源码 smoke 只接受仓库内 Electron，项目、临时目录、userData、缓存、HOME/APPDATA/XDG 与 crash dumps 均固定在 `out/source-smoke/`；越界输入在启动 Electron 前拒绝；
- PDF 样张使用不带 `persist:` 的专用内存 session，`cache=false`，并设置 `javascript=false`；PDF CSP 只为自包含报告保留内联样式和 `data:` 图片，禁止脚本、连接、对象、frame、媒体、表单和 base；
- PDF 窗口拒绝导航、重定向和新窗口。`report.html` 在加载前记录真实路径/文件身份，加载后再次核对未变化；输出只允许 `exports/report_preview.pdf`，父目录与目标身份在写入前后复核，链接、联接、硬链接、目录换入和项目根逃逸均 fail-closed，同目录暂存后原子换入。

### 项目 schema、跨进程写锁与无污染创建

- `Project.open()` 在任何业务写入前验证项目根、六个固定子目录、`project.json`、source/working、检查结果、issues、检查点和修复记录的 schema、ID、序号、精确相对路径、类型、独立文件身份、大小与 SHA-256；链接、目录联接、reparse、硬链接、绝对路径、`..` 或清单路径逃逸均拒绝；
- `create/check/recheck/fix/export/verify/restore-checkpoint/external/issue` 统一进入单项目、非阻塞跨进程内核写锁；`plan-fixes` 与 `list-checkpoints` 保持只读。Windows 使用固定字节区内核锁，macOS/POSIX 使用 `flock`；进程崩溃由内核自动释放互斥，持久锁文件只作诊断，不依据可能陈旧的 PID 删除；
- 争用立即返回 `PROJECT_WRITE_LOCKED`，包括 `retryable=true` 与当前 owner 的 PID、命令、取得时间和进程 token；失败方不覆盖项目或锁元数据；不同项目不互相阻塞；
- 创建命令在锁前完成纯只读门禁。缺输入、不支持格式、非空目标、普通同名锁文件或不安全目标失败时，目标树结构、类型、大小、mtime 与内容哈希保持不变；
- 锁内只打开一次用户输入。最终打开对象必须为常规文件，允许 OneDrive/reparse/symlink 只读入口；同一 FD 复制并 `fsync` 到 `source`，复制后复核 dev/inode/size/mtime，再仅从受控 `source` 生成 `working`。复制期间变化或任一步失败时，只按本事务记录的文件身份回收；新根无残留、用户原有空目录保留且恢复为空、旧协议锁恢复原始字节；
- 自选 `out_dir` 的完整父链逐级拒绝链接、联接和非常规目录；项目内自选目录只允许位于 `exports/`。修订稿、报告、摘要和可选 EPUB 的全部目标在写入首个字节前统一预检；已有链接/硬链接目标拒绝，每个文件同目录暂存、`fsync` 后原子换入。

### CLI / IPC 结果与回归证据

- Python 结构化错误固定为 `code/message/retryable/details`；项目验证、锁争用和锁协议异常不再只返回不可分类字符串；
- `Project.verify()` 逐份读取对应检查报告，拒绝坏 JSON、非对象、错误 schema/check ID 与规则包身份漂移；新记录严格核对七字段，真实旧 `1.0` 记录按 `{name, version}` 降级证明兼容，规则包升级后的新旧两代历史报告可并存；
- Electron 桥保留退出码 1 的有效业务 JSON（包括 `verify` 的非致命完整性结果），退出码 2 或 `ok=false` 错误按失败处理；结构化错误字段完整传到 IPC 外层；
- 主要反向测试位于 `tests/offline_policy.test.js`、`tests/renderer_security.test.js`、`tests/pdf_preview.test.js`、`tests/path_policy.test.js`、`tests/core_result.test.js`、`tests/p0_ipc_contract.test.js`、`python/tests/test_project_validation.py` 和 `python/tests/test_project_write_lock.py`；当前计数见第 1 节。

## 4. P0 批量修复覆盖（alpha.1 起，alpha.4 默认回归通过）

### 批量计划与确认

- `plan-fixes` 不写 working、issues、project 或检查点；
- 计划 ID 绑定项目 ID、working SHA-256、完整问题集、规则包名称/版本/内容哈希和完整候选集合；
- 缺失、错误、异项目或过期 `plan_id` 均拒绝；
- UI 声明数量与预览行数不一致时拒绝应用；
- 取消计划后复检数量不变；
- 同一 `fix_id` 中存在 rejected 问题时整类排除，全文 fixer 不会顺带修改已拒绝位置；
- TAB 每个实际位置生成独立 issue；3 个 TAB = 3 个预览项 = 3 次替换；
- SPACE / PUNCT 每个连续命中片段一项，空段按“连续 N 个”整组说明，EPUB lang 每资源一项，MIME 每包一项。

### 事务与检查点

- 格式解析和机械修改先在临时 working 副本完成；
- 注入 working / issues / project 提交失败后，工作稿、问题文件、manifest 和内存状态恢复；
- 已有 5 个检查点时，注入新检查点后的提交失败，被裁剪旧目录会恢复，完整检查点树不变；
- 检查点保存 working、issues、项目状态和被引用的检查结果，并逐文件校验哈希；
- 恢复前建立安全检查点；目标换入后失败或最终 save 失败时，完整项目树逐字节恢复；
- 成功恢复仍最多保留 5 个检查点，并保护目标与安全检查点；
- 缺失、损坏、重复 ID、路径越界或符号链接项在核心拒绝；UI 标为不可恢复并禁止选择；
- `list-checkpoints` 与 `restore-checkpoint` 的 CLI 子进程测试通过。

### 批量修复 IPC 契约

- preload 实际在只允许 `require("electron")` 的 VM 沙箱测试中加载；
- Renderer 无直接 `fix()` 通道，只能 `planFixes` → `applyFixPlan(planId)`；
- P0 主进程对项目绝对路径和 opaque ID 做白名单校验；
- CLI `json.ok=false` 或退出码 2 不再被外层包装为成功；退出码 1 的有效检查 JSON 仍兼容；
- Electron 保持 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。

## 5. 真实 UI 冒烟结果（最新安全收口后）

沙箱外隐藏 Electron 最终结果：

```text
DOCX：check 21 → 集中预览/确认 5 → recheck 16
EPUB：check 7 → 集中预览/确认 2 → recheck 5
两类：取消计划零写入 → 确认 → 检查点列表 → 撤销 → 重新计划并应用
两类：导出 5 文件 + PDF 样张 + verify 通过
Provider：未登录、不同步占位纪律通过；标准 Provider 离线验证通过
Electron：appVersion = 0.1.0-alpha.4；源码模式 packaged = false
Python core：项目 manifest.app_version = 0.1.0-alpha.4；检查报告 app_version = 0.1.0-alpha.4
标准身份：APP / 项目 / 检查记录 / 导出 report.json 七字段完全一致
SMOKE-RESULT: PASS
```

冒烟运行在 `show: false` 的独立隐藏窗口，不抢占用户当前应用窗口。最新包装器把项目、缓存、临时目录、用户数据和崩溃目录全部限制在 `out/source-smoke/`；路径契约与完整 UI 均已实际验证。

最新实际输出根为 `out/source-smoke/runs/ms37h0mu-201a90896825d190/projects/`；DOCX 与 EPUB 的 `project.json` 均记录 `app_version=0.1.0-alpha.4`、`integrity.source_hash_ok=true`，各有 4 次检查记录。`report_preview.pdf` 分别为 258,404 字节和 161,836 字节。完整身份为 `oak-rules 1.0.0`、`pinned=true`、release sequence 1，以及第 2 节列出的规则包/manifest digest。

### 首次失败与修复记录

第一次 P0 冒烟真实失败：`Cannot read properties of undefined (reading 'listSamples')`。原因是 sandboxed preload 新增了本地 `require("./preload-p0-api")`；Electron 沙箱不允许该引用，导致整个 `window.oak` 未注入。

处理：保持 `sandbox: true` 不变，把四个 P0 方法直接放回 preload 固定白名单；Node 测试改为实际在受限 VM 中加载 preload。随后重跑真实 Electron 冒烟，PASS。

运行环境仍输出 Chromium cache / GPU cache 的“拒绝访问”诊断，但进程退出码为 0，功能、导出和 verify 全部通过。该诊断不等同于产品测试失败；打包版与干净系统测试时仍需复核。

## 6. 外部工具状态

| 工具 | 本轮事实 | 发布包事实 |
|---|---|---|
| EpubCheck 5.3.0 | Java 21 环境下真实运行；好样本通过、缺陷样本报告错误，双向状态矩阵通过 | alpha.4 完整分发和 JRE 已进入资源门禁，但尚无 alpha.4 包；来源/再分发和可信根审计未完成 |
| Ace by DAISY 1.4.6 | tracked full lock、manifest 原始字节身份、空许可证拒绝和事务 stage 由默认回归覆盖；沙箱外隐藏 Chrome 的 `OAK_TEST_ACE=1` 好/坏样本真实通过 | alpha.4 生产闭包和隔离替换通过资源门禁，但尚无 alpha.4 包；helper/browser/OS 网络隔离/可信根、18 包原始许可证及全闭包人工审计未完成 |

因此当前可以说“alpha.4 源码、标准身份链、Electron 构建输入和 Windows 资源集已固定，开发环境真实工具测试与 alpha 门禁通过”，不能说“alpha.4 发布包已经生成或通过正式售卖验收”。

## 7. 尚未运行或尚未通过的发布级测试

- 0.1.0-alpha.4 Windows unpacked / ZIP / NSIS：**未生成**，因此打包后资源门禁与 packaged smoke **未运行**；
- Windows 干净系统首次安装、卸载、升级、无 Python/Node 环境运行：**未运行**；
- Windows 代码签名与 SmartScreen 信誉：**未运行**；
- macOS arm64 / x64：原生 runner、静态聚合、分架构 lock 路径和 CPython `3.13.14` 固定契约已实现；实际 Electron/Python/JRE 仍缺，构建、签名、公证、staple、Gatekeeper 和实机 smoke **未运行**；
- Web 服务端并发、隔离、TTL 删除、零留存、限额和账号联调：**未运行**；
- Free/Pro 订阅、支付 webhook、离线宽限和账号删除：**未运行**；
- 标准包严格校验、损坏/恶意包拒绝、本地签名存储、回滚、项目版本固定与显式升级：**已实现并通过自动化测试**；生产 trust pin、在线检查/下载、断网重试和服务端签名撤回分发：**未实现，未运行**；
- 受控作者/编辑人工内测：**未运行**。

## 8. 历史基线纠错

Claude 0.0.1 的现场基线复跑为：

- 默认：185 项，0 失败、0 错误、Ace 1 项跳过；
- `OAK_TEST_ACE=1`：仍是 185 项，0 失败、0 错误、无跳过。

旧报告“185 + Ace = 186 项”把同一条件测试重复相加，属于文档错误，现已废止。旧 0.0.1 打包版 smoke 的历史结果仍为 PASS，但不能替代当前 0.1.x 重新打包验证。
