# ARCHITECTURE — 架构与关键技术决策

> 当前权威：`湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md`。v1.2 Claude 方案仅为 `0.0.1` 历史基线。本文件记录 `0.1.0-alpha.18` 架构：本地标准/项目 pin/升级回滚、默认引用解析、账号/同步离线契约、Windows builder 独立锁、ASAR/全 9 fuse/资源可信链、受限应用协议、Ace 受控 utilityProcess、CPython/EpubCheck/Temurin-JRE/Electron/builder 来源机器证据、未签名 NSIS/ZIP、packaged smoke，以及 Windows 安装生命周期的 fail-closed 编排与证据契约。生产认证/同步、联网标准获取、代码签名、真实安装生命周期、macOS 和 Web 仍待实现和验收。

## 1. 总体分层

```text
Renderer（无 Node 权限）
        ↓ IPC 白名单
Electron Main
  ├─ 窗口与文件选择 / 路径策略 / 外部链接白名单 / Provider 适配层
  ├─ 默认 session 离线门禁 + Renderer CSP
  ├─ PDF：非持久隔离 session / 禁 JS、导航、网络 / 身份校验后原子写
  ├─ appInfo 身份（版本 + 规则包 + app.isPackaged），供源码与打包 smoke 防止错验旧包
  ├─ 打包合同：ASAR integrity + Electron fuses 配置门禁与真实二进制 wire 复核
  ├─ 资源信任：ASAR 内固定锚点 → 应用资源清单/平台锁 → 全量 loose 树复核
  ├─ StandardsProvider：内置 release 验证 / 本地签名包预览与安装 / 全局回滚
  ├─ StandardsStore：严格 payload / 签名 / CAS / 高水位 / 撤回 / 事务恢复
  ├─ standard-bound-core：项目 release 预检 + 七字段 Python 绑定
  ├─ core-ipc：引用计划 / 检查参数的固定白名单
  ├─ AuthProvider / LicenseProvider：离线状态机、PKCE 固定契约与 Free/Pro 权益矩阵
  ├─ account-sync-ipc / SyncProvider：可信来源负载、逐字段预览、四选一授权与进程内队列
  ├─ external-validation-ipc：项目路径 → 受绑定 plan/prepare/finalize；Renderer 不提交工具状态
  ├─ chrome-controller：固定隐藏 Chrome + 独立 profile + 随机 loopback DevTools
  ├─ ace-utility-runner：固定 utilityProcess 入口/参数/环境/超时/输出上限
  ├─ 统一 Python bootstrap：-I -S -X utf8 + 受控 core 目录
  ├─ P0 修复：planFixes / applyFixPlan（必须带 plan_id）
  ├─ 标准 IPC：项目状态 / 完整差异计划 / 一次确认升级
  └─ 检查点：listCheckpoints / restoreCheckpoint
        ↓ shell=false，参数数组，严格 UTF-8 JSON
Python Core（oak_manuscript_core）
  ├─ 读取器：DOCX（M1）/ Markdown、TXT（M2）/ EPUB（M3）
  ├─ 规则引擎（确定性）与规则包加载
  ├─ citation：本地结构信号 → 体例/安全退回 → 可解释解析记录
  ├─ sync-source：严格只读的结果同步白名单来源，不含稿件内容或本地标识
  ├─ standards_store：manifest/payload/CAS 重验与项目 release 解析
  ├─ rulepack_upgrade：只读差异计划 → 检查点/归档 → 原子 pin → 强制重检
  ├─ plan-fixes 只读计划 → plan_id 确认 → fix 原子批量修复
  ├─ 项目管理：完整 schema/路径验证、只读原稿、SHA-256、跨进程内核写锁
  ├─ create：锁前零污染预检 → 锁内单 FD 输入 → source → working
  ├─ 完整状态检查点（≤5）与安全恢复
  ├─ 报告（JSON / Markdown / HTML）与安全原子导出
  └─ 完整性与安全验证（路径 / ZIP / 大文件）
```

Python 核心作为桌面 sidecar；CLI 子命令与 JSON 输出由 Electron 直接复用。商业方案中的共享三端前端和 Web 服务端执行环境尚未实现，不能从当前桌面分层推断为已完成。

## 2. 关键决策记录

### AD-001 核心零第三方依赖（2026-07-11，冻结）

`oak_manuscript_core` 只用 Python 标准库。DOCX 解析用 `zipfile` + `xml.etree`（OOXML 命名空间下读段落 / run / 样式 / 脚注），不引入 python-docx；测试用 `unittest`，不引入 pytest。

理由：① 离线、零安装即可运行与测试；② 确定性与供应链风险最小化；③ 免除依赖安装授权流程；④ 打包时 sidecar 体积与复杂度最小。
代价：DOCX 写回（修订稿导出）需自实现受控的 XML 局部改写——可接受，因为修复白名单本就限定在少量机械、可精确定位的操作。
若未来某能力（如 PDF 渲染）确需第三方库，须经用户授权并记录新决策。

### AD-005 Python sidecar 使用唯一隔离启动契约（2026-07-27，冻结）

Electron 桥和发布资源门禁共用 `electron/python-invocation.js`，固定调用 `python -I -S -X utf8 -c <bootstrap>`。bootstrap 只把经路径策略解析的绝对 core 目录插入 `sys.path[0]`，再用 `runpy` 执行 `oak_manuscript_core`；不能依赖工作目录、用户 `PYTHONPATH`、site-packages 或启动钩子。`-X utf8` 是命令行固定项，因为 `-I` 会忽略继承环境中的 UTF-8 设置。

### AD-002 CLI 即接口契约（2026-07-11）

核心的每个子命令输出**单个 UTF-8 JSON 文档**到 stdout（人类可读信息走 stderr），退出码 0=成功、1=检查发现未处理的“必须处理”问题但 JSON 仍有效、2=运行错误。Electron 桥保留退出码 1 的有效结果；`json.ok=false` 或错误退出码不得被外层重新包装为成功。该契约同时服务命令行用户与 Electron。

### AD-003 规则包与代码分离（2026-07-11，冻结）

规则定义（含元数据、严重程度、标准引用、文案）放 `config/rule-packs/`（版本化 JSON），判断逻辑在核心内以 `rule_id` 注册。同一 `rule_id` 的逻辑与定义必须一一对应；规则包带语义化版本，报告记录所用版本。

### AD-004 批量修复必须“计划—确认—事务执行”（2026-07-26，冻结）

`plan-fixes` 严格只读，返回完整候选及 `plan_id`。计划 ID 绑定项目、working SHA-256、问题集、规则包内容和全部候选；界面逐项显示标题、位置、修改前/后预览，只提供一个整批确认写入动作。`fix` 强制接收已确认的 `--plan-id`，任何绑定内容变化都会使旧计划失效。

修复先在临时 working 副本执行并复验计划，再建立 `before_fix` 完整状态检查点；working、issues 和 project 清单通过暂存文件换入。失败路径恢复原字节、移除本次检查点并还原可能被裁剪的旧检查点，不允许留下部分 working 修改。

检查点除工作稿与问题列表外，还快照设置、规则包、检查历史、问题指针、修复历史及所引用的检查结果。恢复前创建 `before_restore:<目标 ID>` 安全检查点；目标损坏、哈希不符或路径越界时，在写入前拒绝。恢复结果本身可通过安全检查点撤销。

### AD-006 默认 Electron session 永久离线（2026-07-27，冻结）

正常启动在 `app.ready` 前应用固定离线 Chromium switches，并在 default session 拦截 `http/https/ws/wss/ftp`。Renderer CSP 不允许远程脚本或主动嵌入；系统浏览器外链仍由 HTTPS/域名白名单单独裁决。

未来经用户主动授权的 Auth/Sync/Standards 等网络能力必须使用独立、最小权限的传输或隔离 session，带自己的开关、字段白名单和零请求关闭态测试；不得为“方便联网”解除默认 session 的离线基线。

### AD-007 项目写入必须先完整验证并取得单项目内核锁（2026-07-27，冻结）

`Project.open()` 是写入前的 fail-closed 信任门：验证 `project.json` schema、六个固定子目录、清单控制的报告/问题/检查点/修复路径、source/working 的常规文件身份、相互独立性、大小与 SHA-256。项目根、固定子目录、manifest 与受控文件均拒绝链接、junction/reparse、硬链接和路径逃逸。

`create/check/recheck/fix/export/verify/restore-checkpoint/external/issue` 共用 `ProjectWriteLock`。Windows 在元数据区之外锁定固定字节，macOS/POSIX 使用非阻塞 `flock`；争用不排队，立即返回结构化 `PROJECT_WRITE_LOCKED`。锁文件是持久诊断载体，进程存活由内核锁而非 PID 元数据判断；崩溃后内核自动释放，不删除所谓“陈旧锁”来猜测状态。只读 `plan-fixes` 与 `list-checkpoints` 不取得写锁。

`create` 在写锁创建前做纯只读门禁；非法输入、非空目标或普通同名锁文件不改变目标树。锁内只打开一次用户输入，以同一 FD 写入并 `fsync` `source`，复核来源身份/大小/mtime 后，再从受控 `source` 生成 `working`。输入入口可经过 OneDrive/reparse/symlink，但最终打开对象必须是常规文件。失败清理只删除本事务记录身份的文件与目录；用户已有空目录保留，已有协议锁恢复原字节。

### AD-008 外部导出与 PDF 均以目标身份为边界（2026-07-27，冻结）

Python `export_project(..., out_dir=...)` 逐级检查目标父链；项目内部自选目录只能位于 `exports/`。整批目标在第一个导出字节前预检，已有链接、硬链接或非常规目标一律拒绝；每个输出在同目录完整暂存、`fsync` 后 `os.replace`。这是逐文件原子换入，不宣称一次多文件导出具有跨文件事务性。

PDF 使用无 `persist:` 前缀且禁缓存的专用 session，禁 JavaScript、导航、新窗口和网络；专用 CSP 只允许自包含报告所需的内联样式和 `data:` 图片。加载前后复核 `report.html` 文件身份，输出 writer 逐段复核项目根、`exports/` 与目标身份，并以同目录临时文件原子换入 `report_preview.pdf`。

### AD-009 标准 release 以签名 manifest 与内容身份为真相（2026-07-27，冻结）

标准 release 不以界面显示的名称/版本为身份。canonical manifest 固定 `bundle_id`、版本、`release_sequence`、兼容 APP 范围、payload 大小/哈希、规则包 SHA-256、能力集摘要与精确 `rollback_target`；项目、检查和报告保存七字段身份 `name/version/pinned/sha256/bundle_id/release_sequence/manifest_sha256`。任一层只比较 name/version 都属于错误实现。

`StandardsStore` 先严格解析 payload 与 manifest，再验证非内置包的 Ed25519 门槛签名，最后写入以 manifest SHA-256 命名的 CAS。active/previous、高水位、CAS 中所有同 bundle release、撤回表与签署回滚目标在每次使用前交叉验证。跨进程变更使用原子 pending 事务目录、PID 和随机 process token；只为确定死亡的 owner 按精确 intent 恢复，PID 复用或未知变更一律 fail-closed。

磁盘 trust store 自身必须由代码固定原始字节 SHA-256；当前生产 digest 为空，因此本地签名包导入默认禁用。这个禁用状态是可信边界，不可为演示绕过。内置 release 可离线 bootstrap；在线检查、下载和服务端撤回分发属于后续独立 transport，不得修改本地验证规则。

### AD-010 全局标准与项目固定版本分离（2026-07-27，冻结）

全局 active 只决定新项目默认 release，不改变已有项目。新项目直接使用已验证 active identity。已有项目必须先做一次未携带 `OAK_EXPECTED_STANDARD_IDENTITY` 的只读 `project-standard-status` 预检来发现七字段 pin；预检之前 Electron 仍先验证全局标准存储，预检之后要求 `StandardsProvider.verifyReleaseIdentity()` 在 CAS 中精确匹配该 pin。只有通过这两道门禁，后续业务或变更命令才以 canonical `OAK_EXPECTED_STANDARD_IDENTITY` 绑定 Python；Python 再重算 manifest/payload/CAS 身份。这个受限预检是启动信任链的一部分，不能笼统写成“每个 Python 进程都预先绑定”。

项目迁移使用 `project-standard-status` → `plan-rulepack-upgrade` → `upgrade-rulepack`。目标摘要由主进程选择，Renderer 不能提供任意 digest；计划绑定项目 manifest/state、source/working、issues、最新检查和当前/目标身份。提交前重算计划，建立检查点并归档 issues，原子换入新 pin，记录连续 history，设置 `rulepack_check_required=true`。重检完成前修复、导出和外部验证均拒绝继续。撤回、过期或不兼容旧包只可作为迁移源，不能放宽签名、payload、路径、未来 release、能力映射或身份校验。

### AD-011 标准升级承诺可打开状态，不夸大跨文件原子性（2026-07-27）

升级把 `project.json` 的原子换入作为提交点：提交前故障恢复原清单并清理本事务创建物；提交后即使进程被强杀，项目仍可打开且旧 live issues 最多成为未引用冗余。检查点目录、issues 归档和 live issues 删除不是单一文件系统事务，可能留下可安全识别的孤儿，但不能留下清单引用缺失文件或静默混合两套规则。此保证与通用导出的逐文件原子性不同，不得笼统宣传为任意多文件 ACID。

### AD-012 默认引用体例必须“确定性解析—显式确认—按能力调度”（2026-07-27，冻结）

`默认` 不是隐式替用用户选择，也不是 AI 猜测。`citation.py` 只从本地文档模型提取可丢弃的结构信号：语言统计、参考文献节/条目数、编号引用覆盖、作者—年份覆盖和注释—书目覆盖。持久化结果只允许这些数量/百分比、枚举、原因码、置信度和版本，禁止引用串、姓名、书目文字、文件名、本地路径和内容哈希。

强证据要求至少 3 个唯一信号且覆盖率至少 80%，中等证据要求 2 个且至少 50%。只有唯一信号家族达标、稿件类型/语言匹配，且当前规则包对该格式/类型/语言/体例确有启用规则时，才可返回具体体例。信号冲突、不足、语言不足或提取只有部分覆盖时返回 `structure_only`；用户显式选择始终优先。

Renderer 必须先调用严格只读的 `plan-citation`，展示体例/模式、理由、置信度、证据数量和实际规则范围；用户确认后 `check` 携带绑定全状态的 `citation_plan_id` 并在写锁内重算。规则包升级时用户显式体例保留，默认解析结果清空以便在新策略下重算。

### AD-013 账号与结果同步必须“可信来源—完整预览—显式授权”（2026-07-28，冻结）

Renderer 不能构造同步负载，也不能提供 token、任意 URL 或 transport。主进程只接受受路径门禁保护的项目和固定 `check|export` 事件，调用 Python `sync-source` 取得只读结构来源，再由 `buildSyncRecordV1` 生成并以 exact validator 校验负载。字段权威定义为 `config/schemas/sync-record-v1.schema.json`；标题、正文、解释、位置、预览、文件名、路径、用户名、引用原文和任何内容哈希都没有可用字段，未知字段一律拒绝。

只有已登录状态才可生成预览；预览本身不入队、不发送。界面必须逐字段展示同一份缓存负载，用户随后明确选择 `sync_once`、`ask_each_time`、`not_now` 或 `never_for_project`。确认只提交 opaque `idempotency_id` 和固定选择，过期或替换后的预览拒绝。当前队列仅存在于当前进程并固定为 `pending_transport`，没有持久化、重启恢复、后台重试或网络上传；因此“已入队”绝不等于“已同步到网站”。

`AuthProvider` 当前固定未来生产形态为系统浏览器 PKCE，但未配置服务时只返回 `configuration_required` 且不打开页面；登录/过期/撤销仅能由测试专用实例模拟。`LicenseProvider` 已固定 Free/Pro 能力矩阵、有效期和离线宽限语义；签名订阅凭证、服务端设备管理与计费尚未实现。生产 transport 上线时必须保持默认 Electron session 离线，并把凭证存入系统安全存储、队列存入加密持久层，在不改变 SyncRecord v1 最小字段边界的前提下另行威胁建模。

### AD-014 Electron fuses 必须“显式固定—构建后读回—未知项失败关闭”（2026-07-28，冻结）

`package.json` 必须显式开启 ASAR、不得关闭 embedded ASAR integrity，并列出全部当前工具已知 fuse 的精确值；不能依赖 electron-builder 默认值。配置在调用 builder 前校验，生成应用后立即从真实 Electron 二进制读取 fuse wire，再进入资源门禁、packaged smoke 和发布证据。

二进制验证必须限定仓库内安全常规单链接文件并复核读取前后身份。已知 fuse 缺失、漂移、inherit 或 removed 一律拒绝。顶层精确锁定 `@electron/fuses 2.1.3`，Electron 43.1.0 的索引 8 已由该工具定义为 `WasmTrapHandlers`；afterPack 以 `strictlyRequireAllFuses=true` 写入并回读 9 项。当前真实 Windows EXE 为 `fully_known=true`、未知项 0；未来新增 wire 项仍 fail-closed。alpha.10 的 Ace 已迁移到受控 `utilityProcess`，因此 `RunAsNode=false`；详见 `ELECTRON_FUSE_POLICY.md`。

### AD-015 Ace 外部验证必须“主进程绑定—utility 执行—核心复核”（2026-07-28，冻结）

Renderer 只能提交受项目路径门禁保护的项目目录，不能提交 Ace 入口、参数、环境、Chrome、退出码或报告结论。Python `external-plan` 根据已验证项目生成绑定 project ID、检查 ID、working/result 摘要、标准身份，以及 Java/JAR/Ace/Chrome 文件身份的 plan；`external-prepare` 在同一项目写锁下重验并清理固定 Ace 输出；utility 结束后，`external-finalize` 再重验 plan、执行 EpubCheck，并仅接受主进程给出的整数 Ace 退出码和当前安全报告。

Ace 只在 Electron `utilityProcess` 中运行固定 module 和固定参数。环境剥离 Node/Electron/Puppeteer/Oak/Ace 注入，合并输出上限 64 KiB，最长 5 分钟；输出目录身份变化、工具替换、超时、异常退出或报告非法均 fail-closed。主进程另行启动精确系统 Chrome：固定隐藏/离线参数、独立 profile、随机端口、仅 loopback DevTools；utility 只连接该严格端点，完成后主进程停止精确 child 并清理 profile。

该 loopback 控制通道是本机进程间通信，不上传稿件；但 Chromium 层网络抑制不等于 OS 级无网沙箱，系统 Chrome 也不等于可再分发的固定浏览器运行时。源码 UI smoke 只能证明当前源码链路，`ACE_CONTROLLED_HELPER_PENDING` 必须保留到真实 packaged 功能、安全和 fuse 联合证据完成。

### AD-016 Loose 打包资源必须由真实 app.asar 内的固定锚点导出信任（2026-07-28，冻结）

Python 核心、`config/` 和 `samples/` 以 canonical `app-resources-v1.json` 固定精确文件集合、大小与 SHA-256；Python runtime、EpubCheck、JRE 与 Ace 则沿用各自完整树锁。`resource-trust-anchor.json` 随 Electron 代码进入 `app.asar`，固定应用资源清单原始字节 SHA-256，以及目标平台四份 tracked lock 的原始 SHA-256。锚点不能放在可独立改写的 loose resources 中作为信任来源。

源码验证只证明将要进入构建的清单与锁一致，不关闭正式发布 blocker。packaged 验证必须从真实 `app.asar` 读取锚点、与源码固定字节交叉核对，再拒绝所有 loose 树的增删改、链接/硬链接、平台替换与读取身份漂移。只有这条证据链完整成立时，门禁才可关闭 `APP_RESOURCES_TRUST_ROOT_NOT_HARDENED`、`PYTHON_RUNTIME_TRUST_ROOT_NOT_HARDENED`、`EPUBCHECK_TRUST_ROOT_NOT_HARDENED`、`JRE_TRUST_ROOT_NOT_HARDENED` 和 `ACE_TRUST_ROOT_NOT_HARDENED`；其它 provenance、许可、helper/browser/隔离和签名 blocker 不受影响。

### AD-017 二进制来源证据必须“官方制品—受控推导—机器/人工分层”（2026-07-28，冻结）

运行时来源不能靠版本字符串或本地清单自证。每类二进制必须把官方发布 URL、大小、摘要和可用签名/SBOM 旁证固定到 exact schema 的 canonical 证据，再逐文件证明本地分发是原字节复制或明确列出的最小受控修改。证据原始 SHA-256 由运行时清单和 packaged 资源门禁绑定；默认命令只读，显式更新必须采用稳定读取、安全父链、独占候选、`fsync`、原子换入及换入后复验。

机器证据和人工许可/法律签署是两个状态，工具不得把 `machine_status=verified` 写成 `human_review_status=verified`。alpha.15 首次应用于 Windows CPython 3.13.14：官方/本地均 34 个文件，33 个逐字节一致，唯一受控修改为 `_pth` 精确追加；Sigstore leaf/SPDX 已机器复验，但完整信任链、GPG、上游 tlog index 不一致和再分发签署仍待人工处理。因此 blocker 只能收窄为 `PYTHON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`，不能删除。alpha.16 将同一 fail-closed 模型用于 EpubCheck 5.3.0：官方/本地 49/49 文件逐字节一致、GitHub 服务端与本机 ZIP SHA-256 相同，但官网 MIT 与随包/仓库 BSD-3-Clause 信号矛盾，tag 签名也未证明生成 ZIP 的直接绑定；因此只能收窄为 `EPUBCHECK_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`。alpha.17 再将该模型用于 Temurin 21.0.11+10：官方 ZIP 与本机 JDK 490/490 文件逐字节一致，固定 `jlink` 生成 207 文件 JRE 并原样保留 94 份许可材料；detached signature 已固定但本机无 OpenPGP 工具，许可与再分发也未具名签署，因此 blocker 只能收窄为 `JRE_SOURCE_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`。alpha.18 将同一模型用于 Electron 43.1.0 和 Windows builder：Electron 官方 ZIP 与本地运行时 75/75 原字节一致，builder 三份官方归档按固定选择逻辑受控重组为 385/385 文件工具树；但 Electron release 无 detached signature，builder legacy releases 无 digest/签名且部分所选载荷无具名许可证文件，因此相应 blocker 也只能收窄为 `ELECTRON_RUNTIME_PROVENANCE_HUMAN_SIGNOFF_REQUIRED` 与 `BUILDER_TOOLCHAIN_PROVENANCE_HUMAN_SIGNOFF_REQUIRED`。

打包应用在标准存储初始化和窗口创建前运行同一验证，失败即退出。该锚点仍需与真实应用二进制的 ASAR integrity/fuses、操作系统代码签名和发布证据联合验证；构造测试中的真实 `app.asar` 只证明验证器行为，不能替代产品安装包或签名证据。macOS 目标在相应四份平台锁齐全并重新生成锚点前必须 fail-closed。

## 3. Python 核心模块地图（随实现更新）

| 模块 | 职责 |
|---|---|
| `oak_manuscript_core/project.py` | 项目创建 / 打开、完整 schema 与受控路径验证、原稿哈希、完整状态检查点列表与安全恢复 |
| `oak_manuscript_core/project_lock.py` | Windows/macOS/POSIX 非阻塞跨进程项目写锁、协议元数据与结构化争用错误 |
| `oak_manuscript_core/safety.py` | 路径规范化、链接/reparse 与逃逸拒绝、ZIP 安全（成员数 / 单文件 / 总解压上限）、大文件预警 |
| `oak_manuscript_core/readers/docx_reader.py` | OOXML 解析 → 统一文档模型 |
| `oak_manuscript_core/readers/md_reader.py` | （M2）Markdown ATX 标题 + 分段解析 |
| `oak_manuscript_core/readers/txt_reader.py` | （M2）纯文本空行分段 |
| `oak_manuscript_core/readers/epub_reader.py` | （M3）EPUB 容器 / OPF / nav / 内容文档结构解析 |
| `oak_manuscript_core/epub_writer.py` | （M3）基础 EPUB 导出（自检零问题） |
| `oak_manuscript_core/model.py` | 文档模型、问题（Issue）、检查结果的数据类 |
| `oak_manuscript_core/citation.py` | 语言/引用结构信号、版本化阈值、体例能力门禁、`structure_only` 退回与隐私安全解析 schema |
| `oak_manuscript_core/rulepack.py` | 规则包严格加载、七字段身份绑定、标准注册表校验与版本化引用解析策略 |
| `oak_manuscript_core/standards_store.py` | 内置/用户标准 CAS、manifest/payload 哈希重验、active 与历史 release 解析、期望身份绑定 |
| `oak_manuscript_core/rulepack_upgrade.py` | 项目标准状态、确定性差异计划、检查点/issues 归档、pin 升降级和崩溃一致提交 |
| `oak_manuscript_core/engine.py` | 规则调度（按稿件类型 / 语言 / 体例启用），确定性保证 |
| `oak_manuscript_core/rules/` | 各规则判断逻辑（每规则独立、可单测） |
| `oak_manuscript_core/fixes.py` | 白名单机械修复原语（幂等） |
| `oak_manuscript_core/fix_plans.py` | 生成绑定项目 / working / issues / 规则包 / 候选的只读批量计划 |
| `oak_manuscript_core/ops.py` | 检查编排、计划验证、批量修复事务与回滚、安全自选目录与逐文件原子导出、只读 `sync-source` 白名单来源 |
| `oak_manuscript_core/reports.py` | JSON / Markdown / HTML 报告渲染 |
| `oak_manuscript_core/exporter.py` | 修订稿 DOCX 导出、导出目录校验 |
| `oak_manuscript_core/__main__.py` | CLI（含 plan-citation / check 确认、修复/检查点、project-standard-status / plan-rulepack-upgrade / upgrade-rulepack / sync-source） |

## 4. 安全基线

- 一切文件写入限定在经过身份验证的项目目录或用户明确选择的安全导出目录；项目内自选目录只能位于 `exports/`，全部目标先统一预检，每个文件同目录暂存、`fsync` 并原子换入；
- ZIP 解包前检查成员数量、单文件大小、总解压大小，拒绝路径穿越与可疑符号链接；
- 批量修复失败不得留下部分 working、问题状态或项目清单写入；恢复失败优先用安全检查点回滚；
- 全部变更型 CLI 命令在完整项目校验后取得跨进程非阻塞内核写锁；锁争用、受污染项目或普通同名锁文件均在业务写入前 fail-closed；
- Electron 已启用 `contextIsolation`、sandbox、`nodeIntegration=false`、CSP、默认 session 离线门禁与固定 IPC 白名单；项目 IPC 只接受绝对且包含 `project.json` 的项目路径，计划 ID / 检查点 ID 通过格式校验；
- 标准包在进入项目执行路径前必须通过严格 payload、签名/CAS/高水位/回滚链和七字段身份验证；Renderer 不能选择迁移目标，生产 trust pin 缺失时签名包导入关闭；
- PDF 在独立非持久 session 中禁用 JavaScript、导航与网络，并通过文件/目录身份快照及原子 writer 写入；
- Python 退出码 1 是有效业务结果，退出码 2 是运行错误；结构化 `code/message/retryable/details` 贯通到 IPC；
- 统一测试入口为 `npm test`（Node 契约与 UI 结构测试 + Python 核心测试）；分项为 `npm run test:node`、`npm run test:python`。

## 5. 发布资源可信链（0.1.0-alpha.4 起，alpha.9 继承）

Windows alpha 资源不是靠“目录存在”通过门禁，而是由五组全量清单固定：

| 资源 | 固定方式 | 当前 Windows 状态 |
|---|---|---|
| CPython 3.13.14 | `config/tool-manifests/python-runtime-<platform>-<arch>.json` 固定完整文件集合、大小和 SHA-256；Windows x64 另绑定 `config/provenance/cpython-3.13.14-win32-x64.json` 的官方 ZIP/Sigstore/SPDX、受控推导和许可证据；探针精确核对 CPython implementation、三段版本、releaselevel 和 serial | `win32-x64` 34 文件清单与 provenance 已机器验证；33 个原字节文件、`python313._pth` 唯一受控追加且禁止 `import site`；人工来源/许可签署仍待办 |
| EpubCheck 5.3.0 | `config/tool-manifests/epubcheck-5.3.0.json` 固定 JAR、完整依赖闭包及许可证材料 | 49 个文件均纳入清单 |
| Temurin JRE 21.0.11+10 | JRE 自带 `manifest.json` 固定生成产物；仓库 `config/tool-manifests/jre-<platform>-<arch>.json` 另行固定源 JDK 与 JRE manifest | `win32-x64` 锁存在；固定保守模块集合 |
| Ace 1.4.6 | `tools/ace/manifest.json` 描述阶段产物；受版本控制的 `config/tool-manifests/ace-1.4.6.json` 另行固定 stage manifest 原始字节哈希、236 包闭包、全部文件与补丁 | Node 门禁和 Python 实际运行路径均复核 full lock；语义相同但原始字节漂移也拒绝；正式可信根签名及 236 包逐包人工审计仍未完成 |
| Electron 43.1.0 | `config/tool-manifests/electron-43.1.0-win32-x64.json` 以 `package-lock.json` 的精确版本为起点，固定完整目录树、文件大小和 SHA-256，并绑定 `config/provenance/electron-43.1.0-win32-x64.json` 的 GitHub release/官方 ZIP/SHASUMS256/npm checksums 证据；tracked manifest 必须通过严格 JSON、exact schema 与 canonical UTF-8/LF 字节校验；`electronDist` 返回前强制复核 | `win32-x64` 已固定 2 个目录、75 个文件、364,083,658 字节；manifest SHA-256 为 `f5c2c915633c1917bc37377f8232bde4259588eb138bc4072a3c7df976e27486`；官方 ZIP 与本地 75/75 原字节一致；链接/reparse、硬链接、漏列、多列及哈希/大小漂移均 fail-closed |

所有平台相关锁按 `platform/arch` 选择，不能用 Windows 锁替代 macOS 锁。当前仓库没有 `darwin-x64`、`darwin-arm64` 的 Python/JRE 运行资源和对应锁；macOS 门禁因此应当失败关闭，而不是跳过。

所有会进入哈希或锁身份的目录与清单统一按 JavaScript UTF-16 code unit 比较排序，不使用随操作系统、ICU 或用户 locale 改变的 `localeCompare`。JRE 和 Ace 的 staging 先在候选目录完成；显式更新锁时，stage 目录与受版本控制锁作为一个事务提交，任一步失败恢复旧目录和旧锁，不能留下“新运行时 + 旧锁”或相反组合。普通 staging 只接受已存在且匹配的锁。

Electron tracked manifest 的显式 `--update-lock` 使用单文件安全更新事务：先验证完整父链和 realpath，拒绝目标 symlink 或多链接文件；候选文件以独占创建写入 canonical 字节并 `fsync`，复核父链与目标身份后原子替换，再对换入文件做严格 JSON、exact schema、canonical 字节和运行时全树复验。任一步失败恢复原始字节；若回滚自身失败，则保留候选/备份等事务证据并明确失败，不能把身份撕裂写成成功。

Windows electron-builder 工具链使用独立的下载与导入契约，不由普通构建自动下载或“扫描后自证”。`builder_toolchain_contract.js` 固定三份旧版上游归档的官方 GitHub release URL、文件名及 SHA-256：`nsis-3.0.4.1.7z` / `9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa`、`nsis-resources-3.4.1.7z` / `593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103`、`winCodeSign-2.6.0.7z` / `cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4`。

`download_windows_builder_archives.js` 是唯一便捷联网入口，必须显式传入 `--allow-network`（`npm run download:builder:win` 已固定该开关）；普通 build/test/dist 不引用它。初始 URL 必须是无凭据、无参数的 HTTPS 固定仓库路径，重定向仅允许明确的 GitHub release asset 主机。下载限定在仓库目录，默认 `out/downloads/windows-builder/`；父链链接/逃逸、未知条目、错误既有哈希和覆盖行为均拒绝。候选以独占文件创建，限制 128 MiB、30 秒闲置和 5 次重定向；全部归档通过 SHA-256 后才以排他硬链接提交，碰撞或失败回滚本事务文件。这个入口取得的是**待导入的原始不可信字节**，哈希通过也不能替代解压与工具树门禁。

导入器只接受显式 `--archive-dir`，拒绝 UNC/设备形式（包括直接网络共享写法）、未知归档、路径穿越、链接/reparse、备用流、加密条目、Windows 名称冲突、过量条目和解压膨胀；固定 7z 解压器本身也先按代码内摘要复核。仅凭路径字符串无法识别映射成盘符的网络共享，因此实际导入还必须由操作者选择本地非映射目录；下载器不会自动调用导入器。

首次建立或审计更新工具树与独立 tracked lock 必须显式传入 `--update-lock`。候选树先完整预检，再共同换入 `tools/electron-builder/win32-x64` 与 `config/tool-manifests/electron-builder-win32-x64.json`；旧树、旧锁、候选树、候选锁的全部 forward rename 与 rollback rename 故障均有注入测试。回滚本身失败时保留恢复证据并明确报错，不能假装事务成功。当前三份固定归档已验哈希保存在仓库忽略的下载区，受版本控制的独立工具链锁固定 385 个文件、19,150,116 字节，普通 Windows 构建只接受该已锁工具树且禁止下载回退。alpha.18 的 `config/provenance/electron-builder-win32-x64.json` 进一步绑定三份官方 release API、`app-builder-lib 26.15.3` 选择逻辑和受控重组结果；三个 legacy release 无服务端 digest/签名，组装树仅保留 NSIS `COPYING`，所选 nsis-resources/winCodeSign 载荷无具名许可证文件，因此正式许可/再分发人工签核仍由独立 sale blocker 保留。

alpha.7 在构建输出端增加独立证据链。`build:win` 首先调用 `release:evidence:clear:win`，预检并清除精确的旧 `SHA256SUMS.txt` 与 `release-manifest-win32-x64.json`；若后续任一阶段失败，当前构建没有新证据。只有 electron-builder 生成精确当前版本 Windows x64 NSIS/ZIP、packaged 资源门禁通过且隐藏 packaged smoke 返回唯一 PASS 后，才运行 `release:evidence:win`。生成器拒绝同系列旧制品、坏 PE/ZIP、路径逃逸、symlink/reparse、hardlink 和读取竞态；对 EXE/ZIP 逐字节计算 SHA-256。SHA 文件固定有序的两条记录，canonical JSON manifest 再固定产品/appId/版本/目标、文件种类、大小/摘要及 SHA 文件原始字节摘要。两份证据使用独占候选、`fsync` 和联合提交，第二次换入或最终全量复验失败会恢复两份旧证据。证据链证明的是“这两个已通过前序流水线的字节对应哪些摘要”，不替代代码签名、来源审计、干净系统测试或 sale 门禁。

资源门禁分成两个阶段：

1. **非执行静态阶段**：先验证核心文件、全量文件集合、大小、SHA-256、符号链接/路径、目标架构、版本、许可证及补丁记录。此阶段不会启动 Python 或 Java。
2. **运行探针阶段**：只有全部静态检查的全局错误数为零，才启动已校验运行时。Python 用 AD-005 的固定 bootstrap 运行核心版本探针；JRE 分别对 `epub_good.epub` 和 `epub_needs_review.epub` 运行 EpubCheck，并精确核对好样本零错误和缺陷样本非零错误。任一静态错误都会阻止全部后续探针。

这条顺序是安全边界：运行时可执行文件本身必须先通过完整性验证，不能以“能启动”替代可信性检查。

探针只能在目标平台和目标架构的原生 runner 上执行；host 与 target 不一致时 fail-closed。跨主机只做静态聚合检查必须显式传入 `--no-runtime-probe`，报告也会记录探针未执行，不能把静态通过写成运行证据。

### Windows 安装生命周期编排与证据

`windows_install_acceptance.js` 把“安装器字节可信”和“系统安装生命周期通过”分成两个门禁。默认命令只读取当前 release 与固定归档旧版，严格核对 manifest、SHA256SUMS、版本顺序、大小、摘要及 PE；它不创建运行目录，也不启动任何子进程。NSIS 引导程序允许 x86 PE32 或 x64 PE32+，但安装后的应用主程序仍必须是 x64 PE32+，避免把引导程序架构误当目标应用架构。

系统变更需要两个显式开关 `--run --allow-system-mutation`。运行目录、安装目录、测试 userData、temp、项目输出和证据全部位于 `out/install-acceptance/`；安装器/卸载器使用参数数组、`shell=false` 与隐藏窗口。固定生命周期为：旧版安装 → 旧版 packaged smoke → 当前版就地升级 → 当前版 smoke → userData 哨兵保留 → 旧版回装探测 → 再次以当前版本 smoke → 当前版卸载 → 主程序/卸载器、HKCU InstallLocation/DisplayVersion、Desktop/Start Menu 清理及 userData 保留。旧版回装进程退出码本身不作为保护证明，唯一判据是回装后应用与注册表仍报告当前版本。

证据按 `windows-install-acceptance-v1.schema.json` 写为 canonical UTF-8/LF。运行时 exact validator 要求 PASS 恰好包含九个等序全绿阶段、无 failure，并把 current/previous 的版本、哈希和项目内路径绑定在 plan；失败可追加一次 `cleanup_uninstall`，但总体必须保持 FAIL。当前仅完成代码、反向测试和只读预检；真实安装会写用户 HKCU 和快捷方式，未另获授权前不得执行，更不能把预检写成安装通过。

## 6. Ace 作者内容隔离与剩余边界

阶段化 Ace runner 在加载作者 XHTML 时先关闭 JavaScript，再用固定的 `@xmldom/xmldom` 清洗器移除 `script`、`iframe`、`object`、`embed`、`base`、事件属性、危险 URL、XSLT processing instruction、meta refresh 与作者 CSP。清洗完成后才启用 JavaScript 并注入固定 Ace/axe 脚本。请求拦截只允许解包 EPUB `basedir` 真实路径内的 `file:`，以及运行所需的 `data:`、`blob:`、`about:`；其它协议和目录逃逸一律拒绝，同时抑制 Chromium 后台联网。

这仍不是正式版的完整隔离证明：当前 Ace 通过固定 Electron `utilityProcess` 执行，并依赖用户系统 Chrome；网络限制主要位于浏览器参数与请求拦截层，尚无 OS 级网络沙箱。自带且校验的浏览器、真实 packaged helper/资源联合证据、代码签名和 OS 级隔离均继续作为 sale 门禁阻断项。

## 7. 构建与冒烟边界

- `alpha` 资源门禁允许在结构和探针通过后返回仍待解决的正式发布阻断项；`sale` 门禁把同一批阻断项提升为错误。alpha 通过不等于可售卖。
- 源码 smoke 与打包 smoke 都通过 `app:info` 核对 Electron 版本和 freshly verified `standardIdentity`；随后读取本次真实生成的 `project.json`、检查记录和导出 `report.json`，核对 Python core 版本、check ID 及四方七字段身份一致。打包 smoke 还强制证明 `app.isPackaged=true`，防止把旧版、陈旧 core 或错误规则包误记为新打包版。
- 源码 smoke 每次生成独立 `out/source-smoke/runs/<run-id>/`，项目、标准 store、缓存、临时目录、用户数据、HOME/APPDATA/XDG 与 crash dumps 不复用；打包 smoke 同样按运行 ID 隔离并受仓库 `out/` 边界控制。Windows EXE 还须先通过 x64 PE32+ 校验。
- macOS 构建拆为 `build:mac:x64` 与 `build:mac:arm64`；聚合入口 `build:mac` 只选择当前原生 host 架构，不在一个进程伪造双架构探针。`verify:resources:mac` 只是带 `--no-runtime-probe` 的跨架构静态聚合，不能替代两个原生 runner 的执行证据。
- alpha.18 最终外层隐藏 packaged smoke 已 PASS：`out/packaged-smoke/runs/ms4vbk2z-11762cedd25847f4/projects/` 中 DOCX/EPUB 均先确认引用计划、各有 4 次检查、1 个修复批次、3 个检查点、`source_hash_ok=true`，PDF 分别为 251,661/178,234 字节；EPUB 通过受控 utilityProcess 实际运行 EpubCheck/Ace，缺陷结果分别为 5 error/8 项失败断言。Electron sandbox 保持开启。
- alpha.18 以 `oak-manuscript://renderer/` 的四文件白名单在 `GrantFileProtocolExtraPrivileges=false` 下保持 ASAR UI 可用；Python `-B` 防止运行时修改 loose 可信树；顶层 2.1.3 afterPack 严格写入并回读 Electron 43 全 9 fuse。真实 builder 锁、CPython/EpubCheck/Temurin-JRE/Electron/builder provenance、NSIS/ZIP、packaged 资源与发布证据已成立；安装生命周期仅完成只读预检，仍无五类 provenance 人工签署、生产凭证、持久队列、上传 transport、Windows 签名、macOS 或 Web。packaged 资源门禁仍为 11 项。
