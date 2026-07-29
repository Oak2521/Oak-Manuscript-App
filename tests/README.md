# tests/ — Node 契约、发布资源与打包验证

`npm run test:node` 运行本目录全部 `*.test.js`；`npm test` 依次运行 Node 与 `python/tests/` 全套测试。alpha.54 最终统一结果为 Node **700 total / 693 pass / 0 fail / 7 skip / 4.398 秒**，Python **362 项 / 0 失败 / 0 错误 / 3 跳过 / 104.874 秒**，墙钟 114.1 秒；跳过项不计作通过。准确环境证据以 `docs/TEST_REPORT.md` 为准。

本目录覆盖：

- sandboxed preload、固定 IPC、Renderer 批量计划/确认和检查点 UI 契约；
- 默认引用解析 IPC/UI 的计划—确认顺序、六种体例参数白名单、packaged smoke 同契约，以及切换稿件/项目时清空旧 session；
- 三模式 AI、OS 加密凭据、单条完整发送预览、一次确认、内存建议审阅、有界 HTTP/Router，以及 OpenAI-compatible/Ollama/LM Studio 固定非流式请求、唯一文本响应、七类安全故障、失败后重新预览和真实 `127.0.0.1` HTTP/连接重置纵向链；Ollama 与 LM Studio 各有显式运行的单组合匿名窄验收脚本，后者覆盖响应 model 精确核对、空工具数组、静默替换拒绝与超时；官方云和其他真实上游产品不冒充通过；
- Auth 登录/退出/过期/撤销、SyncRecord/持久状态 exact schema、反内容泄露、可信来源 IPC、四选一授权、确认后即时发送/失败留队、safeStorage、账户隔离、revision/原子故障、重启恢复、幂等队列与安全 UI；alpha.44—alpha.48 覆盖权益/设备/撤销传播，alpha.54 用单一匿名 E2E 贯通桌面确认、服务端 owner 绑定与网站历史 strict parse；
- Electron 默认 session 离线 switches/网络请求拦截、Renderer CSP、源码 smoke 的 `out/source-smoke/` 路径边界；
- 标准在线升级 exact 配置/HTTPS transport、24 MiB 有界候选、签名与兼容性复验、10 分钟一次性计划、原生确认、并发/超时/重放拒绝，以及 renderer 无地址/字节/安装权限；
- 标准更新公开 service/HTTP/Fetch exact 契约、内容无关审计、发布源投毒/摘要/分帧拒绝，以及真实测试 Ed25519 包到桌面验签/原子安装 E2E；
- 标准撤回独立签名角色、canonical list/envelope、时间窗/排序/阈值、追加式防回退、原子故障恢复、active/候选/回滚拒绝、检查途中并发撤回优先、安全前进恢复，以及 CAS/历史报告不变；
- 标准撤回固定内容无关请求、发布源 payload/envelope 摘要绑定、HTTP/Fetch framing/凭据/媒体/容量/超时门禁、有界桌面 client、并发刷新拒绝，以及真实测试 signed list 到桌面原子应用；
- release/revocation 同源 exact 配置、main 双客户端原子启用、一次点击撤回优先顺序、失败短路、被撤回内容隐藏和安全前进恢复入口；
- ASAR/integrity、顶层 2.1.3 afterPack 全 9 fuse 严格写入/回读、未来未知 fuse 的 alpha/sale fail-closed、实际 Framework 文件身份和构建顺序；
- ASAR 内资源锚点、108 文件应用 loose 清单、四类平台锁绑定、真实 `app.asar` raw header/精确读取、同路径重建、loose 伪锚点拒绝、启动前验证及 5 个可信根 blocker 的严格关闭条件；
- Ace 外部验证 IPC 的可信项目来源、Python plan/prepare/finalize 绑定、固定 utilityProcess、注入环境清理、输出/时间上限、受控 loopback Chrome、精确 child/profile 清理及路径换入拒绝；
- PDF 非持久隔离 session、禁 JavaScript/导航/网络、报告身份快照、项目/`exports` 父链校验、链接/硬链接/目录换入拒绝和原子 writer；
- CLI 退出码 1 业务结果、退出码 2 错误，以及 `code/message/retryable/details` 结构化错误的 IPC 透传；
- EpubCheck 完整分发、CPython 全量运行时、Temurin/JRE 与五类官方来源 provenance、JRE 源/产物锁、Ace 受版本控制 full lock 及 Electron 43.1.0 `win32-x64` 全树锁的缺失、增项、篡改、链接和平台/架构拒绝；CPython 专项另覆盖 Sigstore leaf/SPDX、34/33/1 推导、证据摘要绑定、自批准拒绝和原子更新，EpubCheck 专项覆盖官方 ZIP/GitHub digest、49/49 原字节文件、许可信号矛盾保留、自批准/证据/顺序/本地 JAR 漂移拒绝，Temurin/JRE 专项覆盖官方 ZIP/API/checksum/build metadata、490/490 源 JDK、本机 JDK、固定 jlink、207 文件 runtime、94 份许可材料、未验 GPG 状态和 source/packaged 路径绑定；Electron provenance 专项覆盖官方 ZIP/GitHub digest/SHASUMS256/npm checksums、75/75 文件、无 detached signature 状态与锁绑定；builder provenance 专项覆盖三份官方归档/API、固定选择逻辑、385/385 重组树、无 digest/签名和许可边界保留；Electron 实际 tracked manifest 固定 2 个目录、75 个文件、364,083,658 字节（manifest SHA-256 `f5c2c915633c1917bc37377f8232bde4259588eb138bc4072a3c7df976e27486`），并覆盖严格 JSON、exact schema、canonical UTF-8/LF 字节校验，Python 实际运行路径也复核 Ace stage/lock；
- Electron manifest 显式更新覆盖安全父链、目标 symlink/hardlink 拒绝、独占候选写入、`fsync`、原子替换、换入后复验、失败回滚与回滚失败证据保留；Electron runtime 锁专项为 **37/36/0/1**，hardlink/junction 本机实测通过，文件 symlink 因 Windows `EPERM` 条件跳过；
- JRE/Ace 候选 stage 与锁的事务提交、故障注入回滚、普通 staging 不准改锁，以及 locale-independent UTF-16 清单顺序；
- Windows builder 受控下载器固定官方 URL/HTTPS 主机/文件名/SHA-256，要求显式联网开关并覆盖零授权零写入、重定向/容量/哈希、事务提交/碰撞回滚及仓库路径边界；安全导入器继续拒绝 UNC、未知归档、路径穿越、链接/reparse、备用流、加密条目、名称冲突和解压膨胀，只有显式 `--update-lock` 才可建立/更新独立 tracked lock；三份真实归档、工具树和 tracked lock 已按用户授权建立并复验，注入响应与测试夹具仍不能冒充发布资产；
- Windows 发布证据只接受 package/lock 当前版本的精确 NSIS/ZIP；覆盖 PE/ZIP 结构、旧制品/版本漂移、稳定文件身份、SHA256SUMS 与 canonical manifest 交叉绑定、两文件提交回滚、clear 全预检，以及真实缺制品 fail-closed；
- 发行商身份门禁覆盖当前显式待定状态、完整 Windows/macOS 身份、源码 `build.appId`、ASAR production `oakReleaseIdentity`、重复键、unknown/reordered 字段、固定 schema/canonical 字节、占位文本、官方 URL、package 漂移和只读 CLI；
- Windows 安装生命周期验收默认只读并精确绑定源码当前版本；专项测试覆盖 alpha.23/alpha.12 成功夹具、SemVer、NSIS x86 启动器与 x64 主程序、两开关授权门、零授权零启动/零输出、九阶段状态机、HKCU/快捷方式探针、持久化 sentinel、降级成功时 fail-closed 与 canonical 证据篡改。alpha.42 对归档 alpha.12 的真实只读预检已通过；
- Web 作业、HTTP、Supabase、GoTrue、Fetch、客户端、Netlify 内容存储、持久任务、上传检查、私有 worker、双清扫与独立 SyncRecord 服务/API/repository/runtime 测试合计 130 项。alpha.38 的 26 项同步服务测试覆盖服务端独立白名单、可信主体、账号隔离、幂等/上限、列表快照、查看/删除、HTTPS/同源/CSRF/Bearer、固定 service-role RPC、RLS SQL 静态契约、生产式 Fetch 组合和异步审计失败隔离。Python Web 专项仍覆盖共享核心 one-shot、UTF-8/NUL、格式伪装、危险 ZIP、宏/ActiveX/嵌入/DDE、脚本 EPUB、固定子进程、身份最小化、拒绝零入库和预留释放。database/network/store 仍为注入仿真或静态检查，不冒充真实迁移、部署、容器/OS 禁网、病毒库或零留存测试；
- 许可证字段/文件为空的拒绝路径，以及“有许可证文件仍不能替代全部 236 包人工审计”的 sale blocker 契约；
- 资源门禁两阶段顺序：静态全量检查有任一错误时不执行 Python/Java，静态全绿后才运行探针；非原生 host/arch fail-closed，纯静态必须显式 `--no-runtime-probe`；
- Electron 桥与资源探针共享 `-I -B -S -X utf8` bootstrap、显式受控 core 目录及隔离环境；`-B` 在 `-I` 忽略环境变量时仍禁止污染受信资源；
- Ace 作者 XHTML 清洗、JavaScript 启用顺序、协议/`basedir` 限制、固定补丁哈希，以及 stage manifest 原始字节身份；
- macOS x64/arm64 原生构建分流，静态聚合不得冒充运行证据；
- 打包脚本契约、Windows x64 PE32+ 校验、受控输出目录、唯一 PASS 标志、`appInfo` 版本/`app.isPackaged`，以及从真实 `project.json`/报告验证 core 与规则包身份。
- 标准包 payload/manifest/capability 严格校验、Ed25519 门槛签名、内容寻址存储、高水位、撤回/过期/兼容性、跨进程事务恢复、精确回滚及恶意包反向场景；
- APP/项目/检查/报告七字段标准身份绑定，以及项目升级计划过期、写锁争用、检查点、issues 归档、升级后强制复查和 Renderer 不可选目标 digest。

Python 的项目 schema/路径 fail-closed、跨进程内核写锁、锁前零污染创建、锁内单 FD 输入、OneDrive/reparse 来源、精确失败清理和安全原子导出覆盖在 `python/tests/test_project_validation.py` 与 `python/tests/test_project_write_lock.py`。

真实 EpubCheck/Ace 集成测试位于 `python/tests/test_external.py`。Ace 慢测默认跳过，需显式设置 `OAK_TEST_ACE=1` 且本机有受支持的 Chrome；好样本必须通过，缺陷样本必须失败。当前 packaged smoke 强制通过受控链路运行缺陷样本并得到 EpubCheck 5 error / Ace 8 项失败断言；缺失或陈旧 EXE 不得复用。

最新 Web 客户端隐藏 Chromium smoke 仍为 alpha.51 **PASS**，证据在 `out/web-client-smoke/`，匿名假服务期间 HTTP(S) 请求为 0；alpha.54 未修改 Web UI。alpha.54 源码 Electron smoke 在 Codex 沙箱内两次因 GPU 子进程 DLL 载入失败退出，沙箱外同一隐藏脚本最终 **PASS**，运行根为 `out/source-smoke/runs/ms611umr-1948430f091121ac/projects/`，未使用 `--no-sandbox`。同版隐藏 packaged smoke 为 **SMOKE + SYNC-RECOVERY PASS**，运行根为 `out/packaged-smoke/runs/ms629abp-11818f84be690e63/projects/`；其 canonical 证据把实际 EXE、双进程结果摘要和匿名输出树绑定进 schema v2 发布清单。哈希不是代码签名，实际系统安装生命周期仍未运行。
