# tests/ — Node 契约、发布资源与打包验证

`npm run test:node` 运行本目录全部 `*.test.js`；`npm test` 依次运行 Node 与 `python/tests/` 全套测试。alpha.18 最终统一结果为 Node **344 total / 337 pass / 0 fail / 7 skip / 3.280 秒**，Python **351 项 / 0 失败 / 0 错误 / 3 跳过 / 104.368 秒**，墙钟 162 秒；跳过项不计作通过。准确环境证据以 `docs/TEST_REPORT.md` 为准。

本目录覆盖：

- sandboxed preload、固定 IPC、Renderer 批量计划/确认和检查点 UI 契约；
- 默认引用解析 IPC/UI 的计划—确认顺序、六种体例参数白名单、packaged smoke 同契约，以及切换稿件/项目时清空旧 session；
- Auth 登录/退出/过期/撤销状态、Free/Pro/宽限/过期权益、SyncRecord v1 exact schema 和反内容泄露、可信来源 IPC、伪造 Renderer 负载拒绝、四选一授权、幂等队列与安全 UI 渲染；
- Electron 默认 session 离线 switches/网络请求拦截、Renderer CSP、源码 smoke 的 `out/source-smoke/` 路径边界；
- ASAR/integrity、顶层 2.1.3 afterPack 全 9 fuse 严格写入/回读、未来未知 fuse 的 alpha/sale fail-closed、实际 Framework 文件身份和构建顺序；
- ASAR 内资源锚点、70 文件应用 loose 清单、四类平台锁绑定、真实 `app.asar` 读取、loose 伪锚点拒绝、启动前验证及 5 个可信根 blocker 的严格关闭条件；
- Ace 外部验证 IPC 的可信项目来源、Python plan/prepare/finalize 绑定、固定 utilityProcess、注入环境清理、输出/时间上限、受控 loopback Chrome、精确 child/profile 清理及路径换入拒绝；
- PDF 非持久隔离 session、禁 JavaScript/导航/网络、报告身份快照、项目/`exports` 父链校验、链接/硬链接/目录换入拒绝和原子 writer；
- CLI 退出码 1 业务结果、退出码 2 错误，以及 `code/message/retryable/details` 结构化错误的 IPC 透传；
- EpubCheck 完整分发、CPython 全量运行时、Temurin/JRE 与五类官方来源 provenance、JRE 源/产物锁、Ace 受版本控制 full lock 及 Electron 43.1.0 `win32-x64` 全树锁的缺失、增项、篡改、链接和平台/架构拒绝；CPython 专项另覆盖 Sigstore leaf/SPDX、34/33/1 推导、证据摘要绑定、自批准拒绝和原子更新，EpubCheck 专项覆盖官方 ZIP/GitHub digest、49/49 原字节文件、许可信号矛盾保留、自批准/证据/顺序/本地 JAR 漂移拒绝，Temurin/JRE 专项覆盖官方 ZIP/API/checksum/build metadata、490/490 源 JDK、本机 JDK、固定 jlink、207 文件 runtime、94 份许可材料、未验 GPG 状态和 source/packaged 路径绑定；Electron provenance 专项覆盖官方 ZIP/GitHub digest/SHASUMS256/npm checksums、75/75 文件、无 detached signature 状态与锁绑定；builder provenance 专项覆盖三份官方归档/API、固定选择逻辑、385/385 重组树、无 digest/签名和许可边界保留；Electron 实际 tracked manifest 固定 2 个目录、75 个文件、364,083,658 字节（manifest SHA-256 `f5c2c915633c1917bc37377f8232bde4259588eb138bc4072a3c7df976e27486`），并覆盖严格 JSON、exact schema、canonical UTF-8/LF 字节校验，Python 实际运行路径也复核 Ace stage/lock；
- Electron manifest 显式更新覆盖安全父链、目标 symlink/hardlink 拒绝、独占候选写入、`fsync`、原子替换、换入后复验、失败回滚与回滚失败证据保留；Electron runtime 锁专项为 **37/36/0/1**，hardlink/junction 本机实测通过，文件 symlink 因 Windows `EPERM` 条件跳过；
- JRE/Ace 候选 stage 与锁的事务提交、故障注入回滚、普通 staging 不准改锁，以及 locale-independent UTF-16 清单顺序；
- Windows builder 受控下载器固定官方 URL/HTTPS 主机/文件名/SHA-256，要求显式联网开关并覆盖零授权零写入、重定向/容量/哈希、事务提交/碰撞回滚及仓库路径边界；安全导入器继续拒绝 UNC、未知归档、路径穿越、链接/reparse、备用流、加密条目、名称冲突和解压膨胀，只有显式 `--update-lock` 才可建立/更新独立 tracked lock；三份真实归档、工具树和 tracked lock 已按用户授权建立并复验，注入响应与测试夹具仍不能冒充发布资产；
- Windows 发布证据只接受 package/lock 当前版本的精确 NSIS/ZIP；覆盖 PE/ZIP 结构、旧制品/版本漂移、稳定文件身份、SHA256SUMS 与 canonical manifest 交叉绑定、两文件提交回滚、clear 全预检，以及真实缺制品 fail-closed；
- Windows 安装生命周期验收默认只读，精确绑定当前 alpha.18 与归档 alpha.12；覆盖 SemVer 预发布排序、NSIS x86 启动器与 x64 主程序、两开关授权门、零授权零启动/零输出、九阶段状态机、HKCU/快捷方式探针、持久化 sentinel、降级成功时 fail-closed 与清理、路径穿越和 canonical 证据篡改；
- 许可证字段/文件为空的拒绝路径，以及“有许可证文件仍不能替代全部 236 包人工审计”的 sale blocker 契约；
- 资源门禁两阶段顺序：静态全量检查有任一错误时不执行 Python/Java，静态全绿后才运行探针；非原生 host/arch fail-closed，纯静态必须显式 `--no-runtime-probe`；
- Electron 桥与资源探针共享 `-I -B -S -X utf8` bootstrap、显式受控 core 目录及隔离环境；`-B` 在 `-I` 忽略环境变量时仍禁止污染受信资源；
- Ace 作者 XHTML 清洗、JavaScript 启用顺序、协议/`basedir` 限制、固定补丁哈希，以及 stage manifest 原始字节身份；
- macOS x64/arm64 原生构建分流，静态聚合不得冒充运行证据；
- 打包脚本契约、Windows x64 PE32+ 校验、受控输出目录、唯一 PASS 标志、`appInfo` 版本/`app.isPackaged`，以及从真实 `project.json`/报告验证 core 与规则包身份。
- 标准包 payload/manifest/capability 严格校验、Ed25519 门槛签名、内容寻址存储、高水位、撤回/过期/兼容性、跨进程事务恢复、精确回滚及恶意包反向场景；
- APP/项目/检查/报告七字段标准身份绑定，以及项目升级计划过期、写锁争用、检查点、issues 归档、升级后强制复查和 Renderer 不可选目标 digest。

Python 的项目 schema/路径 fail-closed、跨进程内核写锁、锁前零污染创建、锁内单 FD 输入、OneDrive/reparse 来源、精确失败清理和安全原子导出覆盖在 `python/tests/test_project_validation.py` 与 `python/tests/test_project_write_lock.py`。

真实 EpubCheck/Ace 集成测试位于 `python/tests/test_external.py`。Ace 慢测默认跳过，需显式设置 `OAK_TEST_ACE=1` 且本机有受支持的 Chrome；好样本必须通过，缺陷样本必须失败。alpha.18 packaged smoke 强制通过受控链路运行缺陷样本并得到 EpubCheck 5 error / Ace 8 项失败断言；缺失或陈旧 EXE 不得复用。

alpha.18 最终隐藏 packaged smoke 为 **PASS**，运行根为 `out/packaged-smoke/runs/ms4vbk2z-11762cedd25847f4/projects/`；DOCX/EPUB 均先确认引用计划，各有 4 次检查、1 个修复批次、3 个检查点、`source_hash_ok=true`，且 EPUB 外部工具确实运行。实际安装生命周期仍未运行。
