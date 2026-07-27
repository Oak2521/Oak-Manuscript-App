# PRIVACY_AND_SECURITY — 隐私与安全基线

> 当前权威为商业正式版开发方案 v2.0；v1.2 仅作历史基线。本文件描述 `0.1.0-alpha.3` 源码检查点已实现的桌面隐私与安全边界。当前没有 alpha.3 安装包或 ZIP；商业方案中的 Web 上传、统一账号、订阅与同步尚未实现，必须在各自阶段另行完成威胁建模和验收。

## 1. 本地优先承诺（产品级）

- 当前桌面 alpha 的稿件检查、修复计划、订正、恢复、报告和导出全部本地完成；默认网络关闭、默认分析关闭；
- 当前版本不要求注册即可使用本地核心；登录与同步仍为不联网占位。未来 Free/Pro 权益不得锁住已有本地项目或导出文件；
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

## 5. 文件与压缩包安全

- `Project.open()` 在任何业务写入前验证项目根、六个固定子目录、project.json、source/working、报告、问题与检查点的 schema、ID、序号、精确相对路径、常规文件身份、独立性、大小和 SHA-256；拒绝绝对路径、`..`、链接/联接/reparse、硬链接和同一文件身份；
- `create/check/recheck/fix/export/verify/restore-checkpoint/external/issue` 共用单项目非阻塞跨进程内核写锁；争用立即返回可重试的 `PROJECT_WRITE_LOCKED`，失败方不覆盖锁或项目。锁文件只作持久诊断，崩溃后由内核释放互斥，不依据陈旧 PID 猜测并删除锁；
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
- 上述控制不等同于 OS 级无网沙箱。当前仍依赖用户系统 Chrome 和通用 Electron/Node helper；受控浏览器运行时、最小权限 helper 与 OS 级网络隔离未完成，因此是正式售卖阻断项。

## 9. 运行时完整性与执行顺序

- CPython、EpubCheck、JRE 和 Ace 的完整文件集合、大小与 SHA-256 均被清单覆盖；目标平台相关锁按 `platform/arch` 分开选择。Windows 锁不能替代 macOS 锁。
- 资源门禁先做不启动任何运行时的全量静态验证；只有**全部**静态错误为零，才执行 Python 版本探针及 JRE/EpubCheck 好样本/缺陷样本探针。静态校验失败必须阻止执行可疑二进制。
- 运行探针只能在与目标相同的原生 platform/arch 上执行；非原生 host 必须失败。跨主机纯静态检查须显式使用 `--no-runtime-probe`，其通过不构成运行证据。
- Windows 嵌入式 Python 的 `python313._pth` 只允许标准库 ZIP、当前目录和受控 `../python` 核心路径，并禁止 `import site`，避免继承用户安装包与启动钩子。
- Electron 桥和门禁共用固定 Python bootstrap：`-I -S -X utf8`，显式把经路径策略验证的 core 绝对目录插入 `sys.path[0]` 后用 `runpy` 执行；同时清理可注入模块或启动参数的继承环境，并始终以参数数组和 `shell=false` 启动。CPython 探针核对 `sys.implementation`、精确三段版本、`releaselevel=final` 与 `serial=0`，不只匹配宽松版本字符串。
- Java 与 Ace/Node/Electron 外部工具进程也清理类路径、模块和启动参数注入变量，并以固定参数数组、`shell=false` 启动。
- 所有锁和清单使用 locale-independent UTF-16 code unit 排序；Ace tracked lock 同时固定 stage manifest 原始字节哈希，JSON 语义等价但字节漂移也拒绝。JRE/Ace 的候选 stage 与受版本控制锁在显式更新时事务提交，失败恢复旧目录和旧锁，避免身份撕裂。
- Ace 的空/未知 license 声明和空许可证文件直接拒绝。现有许可证文件或生成元数据通知只满足 alpha 可追溯性；全部 236 包仍需正式逐包人工审计。

## 10. 标准包、项目 pin 与升级安全

- 标准包 payload 和 manifest 使用严格字段集合、重复键拒绝、大小/深度上限、Unicode/日期/canonical HTTPS/路径校验；解析“成功”不等于可信，非内置包还必须满足代码允许算法与门槛的 Ed25519 签名；
- release 以 canonical manifest SHA-256 为 CAS key；active/previous、高水位、同 bundle 的全部版本/序列、撤回表、payload 哈希和签署 `rollback_target` 在每次使用前交叉验证。不能仅凭状态文件中的“已验证”字段或显示版本继续；
- 磁盘 trust store 的原始字节摘要必须由代码固定。当前生产 trust digest 未配置，真实本地签名包导入默认禁用；不得把这一状态绕过或写成“可在线升级”；
- 同一标准根进程内串行，跨进程使用原子 pending 目录、PID 与随机 process token。活 owner 返回 `STORE_BUSY`；只为确定死亡的 owner 按严格 intent 恢复。PID 复用/token 不符或未知变更 fail-closed，必要时人工恢复；
- 七字段项目身份为 `name/version/pinned/sha256/bundle_id/release_sequence/manifest_sha256`。新项目直接绑定已验证 active identity；已有项目先在已验证全局存储的前提下运行一次未绑定、只读的 `project-standard-status` 来发现 pin，再精确验证项目 CAS。此后的业务/变更命令用 canonical 环境绑定 Python；Python 重验 manifest、payload、能力映射与期望身份，避免跨信任边界只比较名称/版本；
- 全局 active 更新只影响新项目。已有项目必须先生成绑定完整状态的只读差异计划，经用户一次确认，建立检查点并归档旧 issues 后原子提交新 pin；升级后强制重检，陈旧问题、修复、外部验证和导出不能继续使用；
- 迁移源可在显式迁移路径中放宽“已撤回/已过期/APP 不兼容”三项，以便把项目救出旧 release；签名、代码锚、payload、能力映射、路径、未来发布时间和七字段身份始终不能放宽；
- 标准包联网检查、下载、断网重试和生产撤回分发尚未实现。未来 transport 必须与上述本地验证分层，并继续遵循用户主动触发、最小网络权限和不传稿件原则。

## 11. Alpha 与正式售卖可信根

当前全量锁能发现本地资源漂移，但 Ace full lock、Python/JRE/EpubCheck 锁及 loose 应用资源尚未锚定到代码签名、asar integrity 与 Electron fuses 共同保护的不可篡改可信根；Electron 分发和 builder 工具链也缺正式来源/全树可信锁。CPython、EpubCheck、Temurin JDK/JRE 与 Ace 依赖的来源、许可证和再分发材料仍需正式审计。`alpha` 门禁会显式报告这些阻断，`sale` 门禁会将当前 18 项 Windows 阻断提升为错误。Windows Authenticode、macOS 签名/公证和对应实机验证完成前，不得宣称为可售卖正式版。
