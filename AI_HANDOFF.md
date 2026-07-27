# AI_HANDOFF — 湖岸稿件（Oak Manuscript）项目交接说明

> 最近更新：2026-07-27
> 当前开发方：ChatGPT Codex
> 当前版本：`0.1.0-alpha.2`
> 当前分支：`chatgpt/commercial-v1`
> 源码检查点标签：`chatgpt-v0.1.0-alpha.2`（只标记源码与本地验证状态，不代表安装包或正式发行）

## 1. 权威入口与工作区

商业正式版的唯一需求权威是：

`docs/湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md`

Claude v1.2 方案和 0.0.1 实现是历史基线，不再覆盖 v2.0 的商业化、跨端、账号、同步和标准升级决策。

当前独立开发克隆：

`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`

只读完整基线：

`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\baseline\claude-0.0.1-full`

基线来源说明及哈希：

`D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\BASELINE_PROVENANCE.md`

源 Claude 仓库、`oak-publishing-system`、`netlify-site` 和商业计划书目录均只读。所有开发、测试和构建产物只能留在当前克隆目录。

## 2. 当前现场事实

### 已完成：0.1.0-alpha.2 Windows alpha 资源与离线发布门禁

- APP、Python 核心和 lockfile 版本已推进到 `0.1.0-alpha.2`；源码与打包 smoke 契约分别读取 Electron `appVersion`、Python 核心实际生成的项目/报告 `app_version` 和规则包身份，避免以壳版本代替核心证据；源码 smoke 的项目、临时目录、缓存、用户数据和崩溃目录全部限定在 `out/source-smoke/`；
- Electron 正常启动即对默认 session 应用离线 Chromium switches 和 `http/https/ws/wss/ftp` 请求拦截，Renderer CSP 继续禁止远程脚本；未来获授权的联网 Provider 必须使用独立受限通道，不能放宽默认 session；
- PDF 审阅样张使用非持久、无缓存的隔离 session，禁用 JavaScript、导航、新窗口和网络，并在加载 HTML 后复核文件身份；PDF 通过父目录/目标身份验证后在 `exports/` 同目录暂存、`fsync` 并原子换入；
- Python 项目打开已改为完整 schema 与路径 fail-closed 验证；项目根、固定子目录、manifest、source/working、报告与检查点均拒绝逃逸、链接/联接、硬链接和身份混淆；所有变更型 CLI 命令共用非阻塞跨进程内核写锁，争用时返回可重试的结构化 `PROJECT_WRITE_LOCKED`；
- `create` 在加锁前只读预检，不会污染非法或非空目标；锁内只打开一次用户输入，以同一文件描述符复制到 `source`，再由受控 `source` 生成 `working`。只读输入可位于 OneDrive/reparse/symlink 路径，但最终打开对象必须是常规文件；复制期间来源变化或任一步失败都会按本事务文件身份精确清理，并保留用户已有空目录或恢复旧协议锁原字节；
- 自选 `out_dir` 导出逐级拒绝链接/联接，项目内部只允许落在 `exports/`；所有目标在首个导出字节前统一预检，已有硬链接/非常规目标直接拒绝，每个文件同目录暂存、`fsync` 后原子换入；
- Electron 桥将退出码 1 保留为有效业务结果、退出码 2 视为运行错误；Python 的结构化错误 `code/message/retryable/details` 可原样穿过 IPC；
- Windows x64 的嵌入式 Python、裁剪 JRE、EpubCheck 完整分发和 Ace 生产依赖闭包均由受版本控制的全量文件清单、大小和 SHA-256 校验；
- Python 运行时清单覆盖 34 个文件、21,260,753 字节；JRE 覆盖 207 个文件、52,384,264 字节；EpubCheck 覆盖 49 个文件、36,263,890 字节；Ace 覆盖 236 个包、6,672 个文件、58,964,235 字节；
- EpubCheck 用“好样本 0 错误 + 缺陷样本非零错误”的双向探针验证；Python/JRE 只有在全量资源校验无误后才允许执行；
- Ace 使用固定生产闭包和审核过的 XHTML 隔离替换：作者脚本先移除、作者文档加载阶段禁用 JavaScript、资源协议限制为受控范围；新增受版本控制的完整阶段 lock，资源门禁同时验证 lock 与 Python 运行时，空许可证文件直接拒绝；真实 Ace 好/坏样本条件测试均已通过；
- Windows 与 macOS 共用 `-I -S -X utf8` 的固定 Python bootstrap 和净化环境，不从工作目录、用户 site 或继承的 Python/OAK 环境注入核心；运行探针同时核对 `sys.implementation`、完整三段版本、`releaselevel=final` 与 `serial=0`，不是只比较版本字符串；macOS x64/arm64 CPython 版本均固定为 `3.13.14`；
- 所有信任清单使用与 locale/ICU 无关的 UTF-16 code-unit 顺序；JRE 的 runtime+tracked lock、Ace 的 stage+tracked lock 都以事务换入，失败时恢复原目录与原锁字节；
- Ace tracked lock 不仅固定解析后的 manifest 语义，还固定 `tools/ace/manifest.json` 原始字节哈希；语义等价但字节漂移同样拒绝；
- macOS 构建拆为 x64/arm64 原生 runner；跨主机聚合只能做不执行探针的静态检查，不能把 Windows 上的静态配置结果写成 macOS 运行验证；
- Windows alpha 资源门禁实际执行 Python 与 JRE/EpubCheck 探针并通过；sale 门禁按设计拒绝并列出 18 项未完成的正式发布责任，不会把 alpha 资源完备误判为可售卖版本；
- 经批准的提升权限 `build:win` 已完成本地 JRE/Ace staging 和 Windows alpha 资源探针，随后仅因 `tools/electron-builder/win32-x64` 缺失而明确停止；未联网下载，也没有产生 alpha.2 安装包或 ZIP。

### 已完成：0.1.0-alpha.1 P0 可信批量修复闭环（保留历史）

- `plan-fixes` 严格只读，返回绑定项目、工作稿哈希、问题状态和规则包的确定性 `plan_id`；
- UI 在一个可滚动界面集中列出本批全部修改前/修改后预览，取消或 Esc 不写入；
- `fix` 强制要求已确认的 `plan_id`，旧计划、异项目计划和不完整确认集合均拒绝；
- TAB 等离散修改逐位置生成问题和预览；任一同类问题被拒绝时，整类全文 fixer 从计划排除，避免顺带修改未展示内容；
- 修复先在临时工作副本执行，正常异常路径不留下部分 working / issues / project 写入；
- 达到 5 个检查点时，批量修复提交失败会恢复被裁剪的旧检查点；
- 检查点保存 working、issues、项目状态和检查结果快照，可列表、恢复并在恢复前创建安全检查点；
- 检查点恢复在文件换入或最终保存失败时恢复完整项目树；损坏或不可恢复项在 UI 中禁用；
- Electron preload 保持 `sandbox: true`，没有直接修复 IPC，只有计划、确认应用、列表和恢复四个固定 P0 通道；
- 当时 APP / Python 核心 / package 版本统一为 `0.1.0-alpha.1`；Node 与 Python 已统一到 `npm test`。

### 现场验证（2026-07-27，最新安全收口后）

- 原生/沙箱外 `npm test` 统一入口：**PASS**。Node TAP 共 99 项，96 通过、0 失败、3 项跳过；三条均因当前 Windows 权限不能创建或替换 symlink/junction 的 path-policy 条件场景。Python 共 270 项，0 失败、0 错误、3 项条件跳过；
- `python scripts/run_tests.py`：共 270 项，0 失败、0 错误、3 项条件跳过；
- 沙箱外隐藏 Chrome 的 `$env:OAK_TEST_ACE='1'; python scripts\run_tests.py`：270 项，0 失败、0 错误、1 项条件跳过，用时 36.112 秒；受限沙箱内 Chrome 超时属于环境限制，核心按设计 fail-closed，不写成工具通过或代码失败；
- 沙箱外隐藏 Electron `npm run smoke`：`SMOKE-RESULT: PASS`。输出严格位于 `out/source-smoke/projects/`；DOCX/EPUB 均完成检查→集中预览→批量确认修复→恢复→再次修复闭环，两个 `project.json` 均为 `app_version=0.1.0-alpha.2`、`integrity.source_hash_ok=true`；PDF 分别为 258,394 和 161,830 字节；
- Windows alpha 资源门禁实际执行运行时探针并通过；sale 门禁有 18 项 blocker；提升权限 `build:win` 完成本地 JRE/Ace staging 和资源探针后，仅在缺少 `tools/electron-builder/win32-x64` 处停止，未联网、未生成制品；
- `npm run verify:resources:mac:static` 在 Windows 上按预期 FAIL，精确缺少 darwin-x64/arm64 Electron dist、两架构 Python runtime 锁和 `tools/jre-darwin-x64` / `tools/jre-darwin-arm64`；这证明跨主机静态逻辑可执行，不证明 macOS 可构建或已发行。两架构仍没有产物、签名、公证或打包版 smoke 证据。

完整证据见 `docs/TEST_REPORT.md`。

## 3. 已确认、不得反复重开讨论的产品决策

1. 最终目标是可售卖订阅的正式版，不把当前 alpha 或旧 0.0.1 便携包包装成正式版；
2. Windows 安装版、macOS 安装版和嵌入湖岸官网的 Web 版共用确定性检查契约；
3. Web 版采用服务端统一处理；生产实现必须有临时任务、加密、TTL、删除和零留存验证；
4. 三端统一使用湖岸橡树官网账号；访客仍可使用基础本地功能；
5. 订阅为有限 Free + Pro，具体价格尚未拍板；
6. 同步只允许检查结果和必要元数据，不同步稿件、正文、摘录、文件名、路径或哈希；登录用户必须明确选择是否同步；
7. 引用体例保留“默认”，由确定性映射自动选择，并在报告中说明；
8. 标准文件需要签名清单、下载校验、版本固定、回滚和升级提示；已有项目不得被静默换规则；
9. “接入用户自己的 AI”的六项设计决定已由用户确认，但用户尚未明确批准正式写入 v2.0 方案或实现；当前不得实现或擅自扩展范围；
10. 不进行 AI 语义改写，自动修复仍只限冻结白名单机械操作。

## 4. 已核实但尚未解决的缺口

- 打包版 Ace：alpha.2 已形成可复制、可执行、由 tracked full lock 固定的生产闭包，并通过 Windows alpha 资源门禁与沙箱外隐藏 Chrome 真实条件测试。正式版仍缺最小权限受控 helper、自带且校验过的浏览器运行时、OS 级默认拒绝网络、可信根加固、18 个生成元数据通知包的原始许可证审计，以及全部 236 包的来源/许可证/版权/再分发义务人工审计；
- Windows：当前只有旧 0.0.1 便携 ZIP 的历史构建；alpha.2 尚无安装器或 ZIP，未做打包版 smoke、干净系统安装/升级/卸载或签名；
- macOS：已有 x64/arm64 原生 runner、静态聚合和两架构 CPython `3.13.14` 固定策略，但缺对应 Electron/Python/JRE 实际资源；尚无 `.app` / DMG、签名、公证或真实硬件探针证据；
- Web：服务端任务 API、隔离执行、限额、零留存和官网嵌入尚未实现；
- 账号/订阅/同步：UI 入口和 Provider 仍是离线占位，未连接生产 Supabase、支付或网站后台；
- 标准库：现有 13 条注册表、35 条规则只是最小集合，存在占位说明、来源缺口和 APA/Chicago 覆盖过薄，详见 `docs/STANDARDS_GAP_AUDIT_20260726.md`；
- 标准升级：签名 manifest、更新器、项目版本固定和回滚尚未编码；
- 正式发布仍缺隐私/条款最终文本、证书、生产密钥、人工内测、macOS 硬件和网站联调。

### Windows sale 门禁的 18 项明确阻断

以下机器码来自当前 `verify_packaged_resources.js` 与实测 sale 输出，不得合并或省略：

1. `FORMAL_LICENSE_AUDIT_REQUIRED`：Ace 18 个生成元数据通知包的原始许可证审计；
2. `PYTHON_RUNTIME_PROVENANCE_AUDIT_REQUIRED`；
3. `EPUBCHECK_PROVENANCE_AUDIT_REQUIRED`；
4. `JRE_SOURCE_PROVENANCE_AUDIT_REQUIRED`；
5. `EPUBCHECK_TRUST_ROOT_NOT_HARDENED`；
6. `JRE_TRUST_ROOT_NOT_HARDENED`；
7. `PYTHON_RUNTIME_TRUST_ROOT_NOT_HARDENED`；
8. `APP_RESOURCES_TRUST_ROOT_NOT_HARDENED`；
9. `ELECTRON_RUNTIME_PROVENANCE_AUDIT_REQUIRED`；
10. `ELECTRON_RUNTIME_TRUST_ROOT_NOT_HARDENED`；
11. `BUILDER_TOOLCHAIN_PROVENANCE_AUDIT_REQUIRED`；
12. `BUILDER_TOOLCHAIN_TRUST_ROOT_NOT_HARDENED`；
13. `ACE_FULL_LICENSE_AUDIT_REQUIRED`：Ace 全部生产依赖闭包的正式人工审计；
14. `ACE_TRUST_ROOT_NOT_HARDENED`；
15. `ACE_CONTROLLED_HELPER_PENDING`；
16. `ACE_BROWSER_RUNTIME_PENDING`；
17. `ACE_OS_NETWORK_ISOLATION_PENDING`；
18. `WINDOWS_CODE_SIGNING_PENDING`。

## 5. 下一执行顺序

不要重新做宽泛规划，按 v2.0 方案继续：

1. 经用户联网授权后，把固定版本的 Windows builder 工具完整放入仓库本地工具链；
2. 生成 alpha.2 NSIS 安装器与 ZIP，逐项运行打包资源门禁、应用身份断言、打包版 smoke、SHA-256 和干净环境检查；
3. 完成 Windows 代码签名，并逐项关闭 provenance、许可证、可信根、Ace helper/browser 等 sale blocker；
4. 实现标准包签名 manifest、本地更新、项目固定版本和回滚；
5. 按标准缺口审计补来源与规则，新增规则必须有反例、样本和回归测试；
6. 在 macOS 分别准备 x64/arm64 Electron、Python、JRE，构建后完成签名、公证、staple、Gatekeeper 和实机 smoke；
7. 实现 Auth / License / Sync 的离线契约和生产适配边界，再经授权连接网站；
8. 实现服务端统一处理的 Web 作业 API、零留存和官网嵌入；完成 Free/Pro、支付、隐私、内测和正式发布门禁。

涉及联网、依赖下载、生产账号、证书、签名、发布、远端推送或网站写入时，必须先向用户取得明确授权。

## 6. 常用验证命令

```powershell
npm test
npm run test:node
npm run test:python
$env:OAK_TEST_ACE='1'; python scripts\run_tests.py
npm run smoke
npm run verify:resources:win
npm run build:win
git diff --check
```

CLI 的 P0 新契约：

```powershell
python -m oak_manuscript_core plan-fixes --project <项目目录>
python -m oak_manuscript_core fix --project <项目目录> --plan-id <计划ID>
python -m oak_manuscript_core list-checkpoints --project <项目目录>
python -m oak_manuscript_core restore-checkpoint --project <项目目录> --checkpoint-id <检查点ID>
```

## 7. 交接纪律

- 动手前读 `AGENTS.md`、本文件、`docs/DEVELOPMENT_STATUS.md`、v2.0 方案、`docs/ACCEPTANCE.md` 和 `docs/TEST_REPORT.md`；
- 以实际文件和现场测试为准，历史文档只作追溯；
- 不修改真实原稿，不把真实作者内容放进仓库；
- 功能、测试、构建或分发状态变化后，同步更新交接、状态、测试、验收和变更记录；
- 不把计划项写成已完成事实，不把开发机成功等同于干净系统、macOS 或正式发布成功。
