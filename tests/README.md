# tests/ — Node 契约、发布资源与打包验证

`npm run test:node` 运行本目录全部 `*.test.js`；`npm test` 依次运行 Node 与 `python/tests/` 全套测试。当前原生/沙箱外 Node 精确结果为 **99 total / 96 pass / 0 fail / 3 skip**；三条跳过均因当前 Windows 权限不能创建或替换测试用 symlink/junction 的 path-policy 条件场景。普通受限沙箱还会额外跳过 isolated Python 子进程，不能把该结果当作发布基线。Python 默认结果为 **270 项 / 0 失败 / 0 错误 / 3 跳过**；准确命令输出仍以 `docs/TEST_REPORT.md` 为准。

本目录覆盖：

- sandboxed preload、固定 IPC、Renderer 批量计划/确认和检查点 UI 契约；
- Electron 默认 session 离线 switches/网络请求拦截、Renderer CSP、源码 smoke 的 `out/source-smoke/` 路径边界；
- PDF 非持久隔离 session、禁 JavaScript/导航/网络、报告身份快照、项目/`exports` 父链校验、链接/硬链接/目录换入拒绝和原子 writer；
- CLI 退出码 1 业务结果、退出码 2 错误，以及 `code/message/retryable/details` 结构化错误的 IPC 透传；
- EpubCheck 完整分发、CPython 全量运行时、JRE 源/产物锁及 Ace 受版本控制 full lock 的缺失、增项、篡改、链接和平台/架构拒绝；Python 实际运行路径也复核 Ace stage/lock；
- JRE/Ace 候选 stage 与锁的事务提交、故障注入回滚、普通 staging 不准改锁，以及 locale-independent UTF-16 清单顺序；
- 许可证字段/文件为空的拒绝路径，以及“有许可证文件仍不能替代全部 236 包人工审计”的 sale blocker 契约；
- 资源门禁两阶段顺序：静态全量检查有任一错误时不执行 Python/Java，静态全绿后才运行探针；非原生 host/arch fail-closed，纯静态必须显式 `--no-runtime-probe`；
- Electron 桥与资源探针共享 `-I -S -X utf8` bootstrap、显式受控 core 目录及隔离环境；CPython 探针精确核对 implementation、三段版本、releaselevel 和 serial；
- Ace 作者 XHTML 清洗、JavaScript 启用顺序、协议/`basedir` 限制、固定补丁哈希，以及 stage manifest 原始字节身份；
- macOS x64/arm64 原生构建分流，静态聚合不得冒充运行证据；
- 打包脚本契约、Windows x64 PE32+ 校验、受控输出目录、唯一 PASS 标志、`appInfo` 版本/`app.isPackaged`，以及从真实 `project.json`/报告验证 core 与规则包身份。

Python 的项目 schema/路径 fail-closed、跨进程内核写锁、锁前零污染创建、锁内单 FD 输入、OneDrive/reparse 来源、精确失败清理和安全原子导出覆盖在 `python/tests/test_project_validation.py` 与 `python/tests/test_project_write_lock.py`。

真实 EpubCheck/Ace 集成测试位于 `python/tests/test_external.py`。Ace 慢测默认跳过，需显式设置 `OAK_TEST_ACE=1` 且本机有受支持的 Chrome；好样本必须通过，缺陷样本必须失败。最新沙箱外隐藏 Chrome 结果为 **270 项 / 0 失败 / 0 错误 / 1 跳过 / 36.112 秒**；受限沙箱中的 Chrome 超时按设计 fail-closed，不记作工具通过，也不等同于代码失败。缺少 alpha.2 EXE 时，`smoke:packaged:win` 应失败而不是复用历史制品。
