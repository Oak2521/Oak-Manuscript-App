# PRIVACY_AND_SECURITY — 隐私与安全基线

> 当前权威为商业正式版开发方案 v2.0；v1.2 仅作历史基线。本文件描述 `0.1.0-alpha.20` 已实现的桌面隐私与安全边界。当前有未签名 Windows NSIS/ZIP，但不是可售卖正式版。Windows builder 下载器和系统安装生命周期都需要开发者显式授权；默认安装预检只读，不运行安装器。统一账号、Free/Pro 与 SyncRecord v1 的严格离线契约已实现，生产凭证、持久队列、同步 transport、计费和 Web 上传仍未实现。

## 1. 本地优先承诺（产品级）

- 当前桌面 alpha 的稿件检查、修复计划、订正、恢复、报告和导出全部本地完成；默认网络关闭、默认分析关闭；
- 当前版本不要求注册即可使用本地核心；账号入口、认证状态机、Free/Pro 能力矩阵和同步确认已经存在，但生产服务未配置且不会联网。任何权益状态都不得锁住已有本地项目或导出文件；
- 不把广告、水印、跟踪信息写进用户稿件或修订稿。

## 2. 源稿不可变（最高优先级之一）

- 创建命令在写锁前先做纯只读门禁；输入不存在、格式不支持、目标非空/不安全或普通同名锁文件时，不创建目录、不写锁、不改变目标树；
- 锁内只打开一次用户输入，以同一文件描述符复制并 `fsync` 到 `source/`，复制后复核来源身份、大小与 mtime，再仅从受控 `source/` 生成 `working/`；输入入口允许经过 OneDrive/reparse/symlink，但最终打开对象必须是常规文件；
- `source/` 是只读副本并记录 SHA-256；复制期间输入变化或创建任一步失败时，仅按本事务记录的文件身份回收，新根不留半项目，用户原有空目录保留且恢复为空，旧协议锁恢复原始字节；
- 一切操作（检查、修复、导出）前后原稿哈希必须不变；哈希异常次数指标必须为 0；
- 失败路径不得删除或改写原稿；最多保留 5 个检查点，清理只删最旧。

## 3. 批量修复计划与事务边界

- `plan-fixes` 必须严格只读：不得修改 working、问题状态、project.json，不得创建检查点；取消集中预览同样零写入；
- 修复必须由用户完整查看候选后一次确认，并携带绑定当前 working、问题集、规则包与全部候选的 `plan_id`；计划过期必须拒绝；
- 机械修复先在项目内临时副本完成并复验，再建立修复前检查点，以暂存文件换入 working、issues 与 project.json；
- 任一步失败必须删除临时文件、恢复原 working / issues / project.json、移除本次检查点并还原可能被裁剪的旧检查点，不得留下部分 working 写入或虚假的 resolved 状态；
- 修复与恢复前后均校验原稿 SHA-256。检查点恢复先验证路径、类型、哈希和状态快照；正式恢复前创建安全检查点，失败时优先回滚当前状态。

## 4. 数据不出本机的边界

默认禁止发送（任何通道）：稿件正文、标题、文件名、本地路径、参考文献原文、原稿或修订稿哈希、作者身份信息。
本地技术日志（`logs/`）与导出诊断信息不得包含正文、标题、文件名和路径。
脱敏评估摘要仅含：稿件类型、语言、字数区间、问题统计、出版目标、规则版本、咨询意图；当前只在本地生成，未来真实发送仍须用户逐字段确认。

上述“数据不出本机”描述当前桌面 alpha。未来 Web 端按商业方案采用用户主动发起的任务上传；在对应实现、隐私文案和零留存验收完成前，不得宣称 Web 能力已上线。

开发者构建输入是另一条隔离边界：`npm run download:builder:win` 只在用户明确批准后由命令行显式启动，只能请求合同固定的 electron-builder GitHub release URL/受限重定向主机，并把归档写入仓库 `out/`。它不接触项目、稿件、报告、账号或应用用户数据，也不会被普通 build/test 或桌面应用隐式触发。

### 4.1 引用解析的最小持久化边界

- 解析器可以在内存中读取引用和书目结构，但返回值只允许保留：语言/类型/格式枚举、参考节和条目数、三种信号家族的唯一数/匹配数/覆盖率、模式、体例、原因码、置信度和解析器/政策版本；
- 解析计划、项目、报告、日志和未来同步摘要均禁止保存引用文字、书目条目、作者姓名、标题、脚注文字、文件名、本地路径或内容哈希；
- `plan-citation` 严格只读；用户取消确认不写项目。`check` 在项目写锁内重算 plan ID，防止确认后稿件或标准身份变化。

### 4.2 SyncRecord v1 的最小同步边界

- 机器可读权威为 `config/schemas/sync-record-v1.schema.json`，语义说明为 `SYNC_RECORD_V1.md`。对象逐层 `additionalProperties=false`，运行时 validator 还拒绝任何未知键和疑似内容/身份键；
- Renderer 不能提交负载、token、URL 或 transport。主进程根据已验证项目调用只读 `sync-source`，再构造负载；允许字段限于随机项目/检查 ID、事件和格式枚举、检查配置、语言/长度桶、引用解析枚举与版本、标准/APP 版本、问题计数及五字段结构问题、外部验证、导出状态和授权时间；
- 只有已登录状态可生成预览；未登录不询问。预览不入队、不发送；确认只接受缓存负载的 opaque 幂等 ID，以及 `sync_once`、`ask_each_time`、`not_now`、`never_for_project` 四个固定选择；
- 当前队列只在 Electron 进程内保存，并标为 `pending_transport`；没有网络传输、磁盘持久化、自动重试或重启恢复。“已入队”不得显示或记录为“已上传/已同步”；
- 生产认证必须使用系统浏览器 PKCE 和系统安全存储；生产同步必须使用独立最小权限 transport、加密持久队列、幂等服务端和删除/撤销机制，且不能解除 default session 离线门禁。

## 5. 文件与压缩包安全

- `Project.open()` 在任何业务写入前验证项目根、六个固定子目录、project.json、source/working、报告、问题与检查点的 schema、ID、序号、精确相对路径、常规文件身份、独立性、大小和 SHA-256；拒绝绝对路径、`..`、链接/联接/reparse、硬链接和同一文件身份；
- `create/check/recheck/fix/export/verify/restore-checkpoint/external/issue/upgrade-rulepack` 共用单项目非阻塞跨进程内核写锁；`plan-citation`、`plan-fixes`、`list-checkpoints`、`project-standard-status` 与 `plan-rulepack-upgrade` 保持只读。写锁争用立即返回可重试的 `PROJECT_WRITE_LOCKED`，失败方不覆盖锁或项目。锁文件只作持久诊断，崩溃后由内核释放互斥，不依据陈旧 PID 猜测并删除锁；
- 自选导出目录逐级拒绝链接、联接和非常规目录；若位于项目内，只允许 `exports/`。修订稿、报告、摘要与可选 EPUB 的全部目标先统一预检，已有链接/硬链接目标拒绝；每个文件在目标同目录完整暂存、`fsync` 后原子换入；
- DOCX/EPUB 解包上限：成员数 ≤ 10,000，单成员解压 ≤ 200 MB，总解压 ≤ 1 GB，拒绝路径穿越成员；
- 超大输入提前提示，不静默挂起。

## 6. 测试数据纪律

仓库测试只用 `samples/` 匿名与构造样本；真实未公开稿件绝不入库；缺陷报告默认不收集正文。

## 7. Electron 安全基线

contextIsolation: true；sandbox: true；nodeIntegration: false；IPC 固定通道 + 输入验证；Python 子进程 shell=false 参数数组；外部链接仅 HTTPS + 湖岸白名单域名；CSP 禁任意远程脚本；不加载远程网页作为主界面。

正常 Electron 启动在 `app.ready` 前应用固定离线 Chromium switches；默认 session 取消 `http/https/ws/wss/ftp` 请求。未来用户主动授权的网络 Provider 必须使用独立、最小权限的传输/session，不得放宽默认 session。源码 smoke 每次把项目、标准 store、临时目录、userData、缓存、HOME/APPDATA/XDG 与 crash dumps 隔离在仓库 `out/source-smoke/runs/<run-id>/`。

PDF 审阅样张使用非持久、禁缓存的独立 session；`javascript=false`，专用 CSP 禁止脚本、连接、对象、frame、媒体和表单，窗口拒绝导航、重定向与新窗口。`report.html` 在加载前后核对文件身份，PDF writer 逐段核对项目根、`exports/` 与目标身份，拒绝链接/联接/硬链接和目录换入，并同目录原子写入。

CLI/IPC 明确区分：退出码 1 是可消费的业务结果，退出码 2 是运行错误；结构化 `code/message/retryable/details` 不得在 Electron 外层丢失或伪装成成功。

## 8. 外部验证工具的本地数据流

- EpubCheck 和 Ace 都在本机进程中处理 EPUB；应用不会把稿件发送到远程验证网站。未实际完成工具运行时只允许报告 `not_run`，不得把“工具存在”写成“通过”。
- EpubCheck 只接受固定 5.3.0 分发及其完整依赖/许可证清单；打包态只使用已校验的捆绑 JRE，缺失或失配时不得回退系统 `PATH`。
- Ace 只接受 `stage_ace.js` 生成的生产依赖闭包，并要求 `tools/ace/manifest.json` 与受版本控制的 `config/tool-manifests/ace-1.4.6.json` full lock 完全匹配。Node 门禁和 Python 实际运行路径都会复核 stage manifest、236 包闭包、补丁、文件集合、大小与 SHA-256。作者 XHTML 在 JavaScript 关闭时解析，移除可执行节点、事件属性、危险 URL、处理指令、meta refresh 和作者 CSP 后才注入固定 Ace/axe 脚本。
- Ace 浏览器请求只允许解包 EPUB `basedir` 真实路径内的 `file:` 与运行所需的 `data:`、`blob:`、`about:`；其它协议、UNC/目录逃逸、service worker 和 Chromium 后台网络请求均在当前控制层拒绝或抑制。
- alpha.10 的 Renderer 不能提供工具、命令、环境或结论。主进程持有绑定项目状态和工具文件身份的 plan，在固定 `utilityProcess` 中运行 Ace；主进程启动精确系统 Chrome，使用独立 profile 和随机 loopback DevTools 端点，utility 只能连接该本地端点，结束后停止精确子进程并清理 profile。loopback 不上传稿件。
- 上述控制不等同于 OS 级无网沙箱。当前仍依赖用户系统 Chrome；真实 packaged 联合验证、自带受校验浏览器运行时与 OS 级网络隔离未完成，因此仍是正式售卖阻断项。

## 9. 运行时完整性与执行顺序

- CPython、EpubCheck、JRE、Ace 和 Electron 的完整文件集合、大小与 SHA-256 均被清单覆盖；目标平台相关锁按 `platform/arch` 分开选择。Windows 锁不能替代 macOS 锁。Electron 43.1.0 `win32-x64` 锁固定 2 个目录、75 个文件、364,083,658 字节，manifest SHA-256 为 `f5c2c915633c1917bc37377f8232bde4259588eb138bc4072a3c7df976e27486`；tracked manifest 必须通过严格 JSON 重复键拒绝、exact schema 与 canonical UTF-8/LF 原始字节校验，`electronDist` 返回构建输入前必须重新验证该锁。
- Electron tracked manifest 默认只读；只有显式 `--update-lock` 才能更新。更新前验证完整安全父链与 realpath，拒绝目标 symlink/hardlink；候选文件独占创建、写入并 `fsync`，复核后原子替换并做换入后全量验证。任一步失败恢复旧字节；回滚自身失败必须明确报错并保留事务证据，不能静默留下撕裂状态。
- 资源门禁先做不启动任何运行时的全量静态验证；只有**全部**静态错误为零，才执行 Python 版本探针及 JRE/EpubCheck 好样本/缺陷样本探针。静态校验失败必须阻止执行可疑二进制。
- 运行探针只能在与目标相同的原生 platform/arch 上执行；非原生 host 必须失败。跨主机纯静态检查须显式使用 `--no-runtime-probe`，其通过不构成运行证据。
- Windows 嵌入式 Python 的 `python313._pth` 只允许标准库 ZIP、当前目录和受控 `../python` 核心路径，并禁止 `import site`，避免继承用户安装包与启动钩子。
- Windows CPython 3.13.14 另由 provenance v1 绑定 PSF 官方 ZIP/Sigstore/SPDX、34 文件清单、33 个原字节文件、唯一 `_pth` 精确追加和原样许可证；证据原始 SHA-256 同时进入运行时 manifest 与 ASAR 资源锚点。完整 Sigstore/GPG 与具名许可签署仍待办，机器验证不能替代法律/再分发审阅。
- Electron 桥和门禁共用固定 Python bootstrap：`-I -S -X utf8`，显式把经路径策略验证的 core 绝对目录插入 `sys.path[0]` 后用 `runpy` 执行；同时清理可注入模块或启动参数的继承环境，并始终以参数数组和 `shell=false` 启动。CPython 探针核对 `sys.implementation`、精确三段版本、`releaselevel=final` 与 `serial=0`，不只匹配宽松版本字符串。
- 打包配置必须显式开启 ASAR、保持 embedded ASAR integrity，并注册全量 fuse `afterPack`。顶层锁定 `@electron/fuses 2.1.3`，以 `strictlyRequireAllFuses=true` 写入 Electron 43 的全部 9 项；索引 8 `WasmTrapHandlers=true`。写后立即回读，随后再独立读取真实二进制；路径逃逸、不安全父链、链接/硬链接、实际 Framework 文件身份变化、API/索引和状态漂移均拒绝。完整合同见 `ELECTRON_FUSE_POLICY.md`。
- alpha.20 在 `app.asar` 内固定资源锚点，锚点绑定 72 个 loose 应用文件、发行身份契约、目标平台 Python/EpubCheck/JRE/Ace 锁，以及 CPython/EpubCheck/Temurin-JRE/Electron/builder 五类来源证据；packaged 门禁另从实际 ASAR production package 读取 exact `oakReleaseIdentity`。读取器解析当前 raw header 并精确读满字节，不依赖路径缓存；打包启动在标准存储和窗口前复核完整资源树。Python 显式 `-B` 禁止探针写入字节码；锚点、身份和清单不读取或记录用户稿件内容。
- Java 与 Ace/Node/Electron 外部工具进程也清理类路径、模块和启动参数注入变量，并以固定参数数组、`shell=false` 启动。
- 所有锁和清单使用 locale-independent UTF-16 code unit 排序；Ace tracked lock 同时固定 stage manifest 原始字节哈希，JSON 语义等价但字节漂移也拒绝。JRE/Ace 的候选 stage 与受版本控制锁在显式更新时事务提交，失败恢复旧目录和旧锁，避免身份撕裂。
- Ace 的空/未知 license 声明和空许可证文件直接拒绝。现有许可证文件或生成元数据通知只满足 alpha 可追溯性；全部 236 包仍需正式逐包人工审计。
- Windows builder 导入器独立固定三份归档的名称和 SHA-256，只接受显式 `--archive-dir`，拒绝 UNC/设备形式（包括直接网络共享写法）、未知归档、路径穿越、链接/reparse、备用流、加密条目、Windows 名称冲突和解压膨胀。普通构建不会调用导入器；只有显式 `--update-lock` 才可建立或更新独立 tracked lock。候选/旧工具树与候选/旧锁在换入前完整预检，全部 forward rename 和 rollback rename 故障路径均 fail-closed；回滚失败会保留人工恢复证据。路径字符串不能识别映射为盘符的网络共享，实际导入必须人工确认使用本地非映射目录。
- 上述 builder 契约已在用户批准下载后落地：三份真实归档验哈希通过，`tools/electron-builder/win32-x64` 工具树和 `config/tool-manifests/electron-builder-win32-x64.json` tracked lock 覆盖 385 文件、19,150,116 字节。alpha.18 provenance 另固定官方 release API、`app-builder-lib 26.15.3` 选择逻辑和受控重组结果；三个 legacy release 无 digest/签名且部分所选载荷无具名许可证文件。普通构建只读复验并消费该离线树；缺失或漂移时失败，不联网回退，也不能用测试夹具代替或把机器状态冒充人工签核。

## 10. 标准包、项目 pin 与升级安全

- 标准包 payload 和 manifest 使用严格字段集合、重复键拒绝、大小/深度上限、Unicode/日期/canonical HTTPS/路径校验；解析“成功”不等于可信，非内置包还必须满足代码允许算法与门槛的 Ed25519 签名；
- release 以 canonical manifest SHA-256 为 CAS key；active/previous、高水位、同 bundle 的全部版本/序列、撤回表、payload 哈希和签署 `rollback_target` 在每次使用前交叉验证。不能仅凭状态文件中的“已验证”字段或显示版本继续；
- 磁盘 trust store 的原始字节摘要必须由代码固定。当前生产 trust digest 未配置，真实本地签名包导入默认禁用；不得把这一状态绕过或写成“可在线升级”；
- 同一标准根进程内串行，跨进程使用原子 pending 目录、PID 与随机 process token。活 owner 返回 `STORE_BUSY`；只为确定死亡的 owner 按严格 intent 恢复。PID 复用/token 不符或未知变更 fail-closed，必要时人工恢复；
- 七字段项目身份为 `name/version/pinned/sha256/bundle_id/release_sequence/manifest_sha256`。新项目直接绑定已验证 active identity；已有项目先在已验证全局存储的前提下运行一次未绑定、只读的 `project-standard-status` 来发现 pin，再精确验证项目 CAS。此后的业务/变更命令用 canonical 环境绑定 Python；Python 重验 manifest、payload、能力映射与期望身份，避免跨信任边界只比较名称/版本；
- 全局 active 更新只影响新项目。已有项目必须先生成绑定完整状态的只读差异计划，经用户一次确认，建立检查点并归档旧 issues 后原子提交新 pin；升级后强制重检，陈旧问题、修复、外部验证和导出不能继续使用；
- 当前内置 2.0.0 以 1.0.0 manifest `d33534f0…d7af` 为精确 rollback target。旧项目的原 release 必须仍存在于本地 CAS 并通过同一严格验证；缺失时拒绝迁移，禁止用 active release 冒充历史身份。
- 迁移源可在显式迁移路径中放宽“已撤回/已过期/APP 不兼容”三项，以便把项目救出旧 release；签名、代码锚、payload、能力映射、路径、未来发布时间和七字段身份始终不能放宽；
- 标准包联网检查、下载、断网重试和生产撤回分发尚未实现。未来 transport 必须与上述本地验证分层，并继续遵循用户主动触发、最小网络权限和不传稿件原则。

### Windows 安装生命周期的授权与数据边界

- `npm run verify:install-lifecycle:win` 只读取固定发布制品及证据，不创建输出目录、不运行安装器、不写注册表或快捷方式；
- 真实运行必须同时提供 `--run --allow-system-mutation`，这是开发门禁，不是普通 APP 功能开关。运行会写当前用户 HKCU、Desktop/Start Menu 快捷方式，因此还需要操作者在仓库规则之外单独授权系统写入；
- 测试安装目录、Electron userData、稿件样本项目、缓存、temp 和 JSON 证据全部限制在仓库 `out/install-acceptance/`；只使用匿名构造样本，不读取真实稿件；
- 系统集成探针只查询本产品固定 GUID 的 InstallLocation/DisplayVersion 和固定名称快捷方式，证据只保留布尔状态/版本，不保存用户其他注册表内容；
- PASS 必须证明卸载后主程序、卸载器、产品注册表和快捷方式清除，同时测试 userData 哨兵保留。失败清理不能把总体 FAIL 改写为 PASS；历史旧安装器能否回退当前版本必须由真实运行证明。

## 11. Alpha 与正式售卖可信根

当前全量锁和真实 packaged 锚点能发现本地资源漂移；alpha.20 已取得 ASAR integrity、全 9 fuse、真实 production package 发行身份结构、CPython/EpubCheck/Temurin-JRE/Electron/builder 来源机器证据、资源与应用烟测联合证据，packaged 资源门禁由 17 项源码 blocker 降至 12 项。安装生命周期工具/预检不等于真实系统验收；发行身份仍缺法定主体、官方链接、版权、平台签名主体与具名复核，五类资源仍缺具名人工许可/再分发签署，Ace 仍缺正式来源/许可审计、自带浏览器、OS 级网络隔离和签名绑定 smoke。Windows Authenticode、干净机安装验收、macOS 签名/公证和对应实机验证完成前，不得宣称为可售卖正式版。
