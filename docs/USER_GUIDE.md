# USER_GUIDE — 使用指南

## 桌面应用（推荐）

当前开发版本为 `0.1.0-alpha.41`，最新已打包版本仍为 `0.1.0-alpha.37`；Windows x64 NSIS/ZIP 未签名，不是可售卖正式版。macOS 安装包、可用 Web 版、Windows 签名和干净机验收仍待完成。alpha.41 已包含桌面 PKCE/加密账号会话/同步失败恢复，以及 OpenAI-compatible、Ollama、LM Studio 的逐条 AI 建议链；默认账号配置仍为空，普通测试、启动和构建不会触发账号联网或下载。

**开发运行**：Node 22.12+ 环境中执行 `npm install` 后 `npm start`。只有开发或部署 Web 服务端时另执行 `npm install --prefix web`；SDK 不属于桌面根依赖。统一测试用 `npm test`。alpha.39 当前结果为 Node 576/569/0/7、Python 362/0 failures/0 errors/3 skipped；跳过项不计作通过。alpha.39 独立隐藏源码 smoke 已通过，但本轮未打包；alpha.37 packaged smoke 历史证据仍有效，不能冒充 alpha.39 制品证据。

**Web 状态**：`web/client/` 已提供可本地渲染的临时处理工作台，保留湖岸账号登录/注册，包含“默认”引用体例、本次临时处理同意、创建/上传/轮询/取消/一次性领取；服务端另有 GoTrue、Fetch、Netlify Blobs 内容适配/有界清扫、Supabase/Postgres 持久任务迁移、上传结构/主动内容检查、私有原子领取、固定 Python 共享核心子进程及任务—对象—任务协调器。alpha.38 又提供独立 `/manuscript/api/v1/sync-records` 源码边界，用于已确认的长期结果记录创建/重放、列表、读取与删除；它不接收稿件文件。两条 SQL 均未在真实 Supabase 执行，API/计划任务也未部署；本地注入测试不等于平台零留存或线上可用。网站工作台的结果同步按钮仍禁用，计费未接通。用户不要把稿件交给任何声称基于该 alpha 的线上地址；正式地址只能在官网联调、隐私文本和生产验收后公布。

**账号与结果同步（当前边界）**：欢迎页、导出页和设置页保留湖岸账号入口。仓库受信配置为 `pending_configuration`，点击登录只会显示配置未完成，不打开浏览器或联网。alpha.39 已实现未来正式配置下的系统浏览器 PKCE、固定深链和 OS 加密账号会话，但尚未连接真实服务。登录用户导出后才会看到 SyncRecord v1 逐字段预览，并可选择仅本次同步、以后仍询问、暂不同步或不再询问此项目。确认项进入系统加密本机队列；配置完整时设置页才显示逐项“发送到网站/确认重试并发送”，登录绝不自动上传。token 只在主进程密文中并与队列账号绑定；远端创建/幂等重放后才删除本机项，失败或账号切换则保留。当前默认配置下 APP 绝未上传到网站；系统加密不可用时同步安全停止，本地稿件功能不受影响。

**AI 设置与发送预览（当前边界）**：设置页提供“无 AI”“湖岸 AI”“我的 AI”。我的 AI 支持 OpenAI、Anthropic、Google Gemini、OpenAI-compatible、Ollama 和 LM Studio，属于 Pro 权益且不消耗湖岸 AI 配额；三个官方云供应商固定使用官方端点，自定义地址必须选择 OpenAI-compatible；远程地址必须使用 HTTPS，本机 HTTP 只接受 loopback。凭据不会回填到界面、报告或同步，供应商/地址变化后必须重新提供。

选择湖岸 AI 或完成我的 AI 设置后，可在某条检查问题详情填写可选要求并点击“预览将发送给 AI 的内容”。APP 只读提取这一条问题，完整展示目的地、有效期、会发送/不会发送清单和请求 JSON；不包含完整稿件、其他问题、文件名、路径、项目/账号标识、哈希或凭据。预览十分钟有效且只能确认一次；问题、working、检查或 AI 配置变化后必须重新预览。在有效 Pro 权益并成功保存 compatible 配置时，OpenAI-compatible、Ollama、LM Studio 的确认按钮可用；保存、生成预览或取消均不联网，只有点击“确认发送一次”才请求配置的服务。当前默认权益仍为 Free，生产订阅尚未接入；OpenAI、Anthropic、Gemini 和湖岸 AI 也继续禁用确认。

compatible transport 返回建议后，界面提供“采纳为人工处理参考”和“放弃这条建议”。采纳会再次核对当前问题，只把问题状态标为“接受”，仍需用户人工修改；模型文本不会保存到项目或写回稿件。放弃或直接关闭只删除当前内存建议，不会把规则问题标为“拒绝”。建议审阅 30 分钟有效且只能处理一次。当前只完成源码和注入测试；没有真实模型服务兼容或输出质量保证。

alpha.37 已具备供应商无关的固定 POST/JSON、HTTPS/本机 loopback、禁重定向/Cookie/代理转发、容量/超时和错误净化底座，但它没有接入主进程，也没有任何真实供应商适配器。界面仍不能发送；不得通过开发者工具、修改配置或把本地 HTTP 服务暴露到公网来绕开该状态。

流程：欢迎页（隐私说明）→ 选稿件或匿名样本 → 选项目目录 → 选检查目标与引用体例 → 查看默认解析计划 → 确认后检查 →
问题页可逐条接受/拒绝/暂不处理；选择“预览批量自动修复”时，APP 在一个可滚动窗口集中列出全部白名单机械修改的标题、位置和修改前/后预览。只有点击一次“确认批量修复 N 项”才执行整批写入；取消不写入。修复后可在“撤销与检查点”中撤销上一次批量修复或恢复选定检查点 → 导出中心（修订稿、三种报告、PDF 样张、基础 EPUB 预览、脱敏评估摘要）→ 验证完整性。

引用体例共六项：默认、GB/T 7714—2025、APA 7、Chicago 18 注释—书目、Chicago 18 作者—日期、不检查引用体例。选“默认”时，APP 只根据本地引用结构和语言信号判断，并展示理由、置信度、数量证据与实际规则范围。若证据冲突或不足，界面明确显示“仅做结构与一致性检查”，不猜测具体体例。取消该确认不运行检查。

检查点恢复前会自动保存当前状态为安全检查点，因此恢复操作本身也可撤销。核心会把损坏或越界的检查点标为不可恢复；即使请求恢复，也会在写入前拒绝，不改变工作稿或原稿。

同一项目若正由另一个检查、修复、导出或恢复操作写入，APP 会立即提示项目正在使用且可以稍后重试，不会把两个写操作排队叠加。进程异常退出后内核会自动释放互斥；请不要手工删除 `.oak-project-write.lock` 来判断项目是否“解锁”。

创建项目支持位于 OneDrive 等云盘 reparse/symlink 入口后的只读文件，只要最终打开对象确实是常规文件。创建时锁内只读取同一个已打开来源，先生成 `source/` 再生成 `working/`；若来源在复制期间变化，创建会安全中止并清理半项目，不覆盖用户已有目录内容。

**外部验证（EPUB）**：问题页「外部验证」按钮运行固定的 EpubCheck 5.3.0 与 Ace 1.4.6。开发态优先使用清单校验通过的仓库 JRE，缺失时才允许查找系统 Java；未来打包态只接受捆绑且校验通过的 JRE，不回退系统 `PATH`。Ace 的 stage manifest 必须匹配受版本控制的 full lock；主进程生成绑定当前项目/标准/工具身份的计划，在固定 utilityProcess 中运行 Ace，并用受控隐藏 Chrome 的本地 loopback 端点承载浏览器。Ace 目前仍需要本机 Chrome。缺少工具/锁、完整性校验失败、计划过期、报告非法或进程异常时，报告如实标注「未运行」。

当前构造样本的真实外部工具预期是：`epub_good.epub` 在 EpubCheck 与 Ace 都通过，`epub_needs_review.epub` 在两者都失败并报告问题。“失败”表示工具确实运行并发现缺陷，不表示程序故障。alpha.37 的真实 packaged smoke 已让缺陷样本得到 EpubCheck 5 error 和 Ace 8 项失败断言，并把实际 EXE、双进程结果和匿名输出树摘要写入发布清单，证明打包受控链路真实运行；它仍不等于自带浏览器、OS 级网络隔离、代码签名或干净机验收。受限环境若超时或未生成安全报告，核心会 fail-closed 标记未运行。

**标准资源与项目升级**：标准页分别显示“当前新项目默认标准”和“本项目固定标准”。全局标准变化不会自动改已有项目；只有打开项目、查看规则/体例/标准的完整差异并点击一次确认，项目才会建立检查点、归档旧问题并切换，随后自动用新规则重检。取消、关闭对话框或计划过期都不写项目。

标准页也有“安装本地标准包”和“回滚全局标准”入口。当前内置 2.0.0，严格签名/CAS/回滚/项目 pin 验证已实现；旧项目只能从本地 CAS 中仍存在且已验证的原 release 迁移，不会用最新包冒充。正式生产 trust pin 仍未配置，因此真实本地签名包导入默认禁用。当前没有联网检查或自动下载标准包，不要把入口理解为在线更新已上线。

## 命令行核心

Python 3.11+。核心零第三方依赖，无需安装任何包。

## 支持的输入格式（阶段 1 完成，全部四种）

- `.docx`（支持当前已实现的论文 / 纸质出版物基础检查；不代表覆盖全部外部标准）
- `.md`、`.txt`（UTF-8；Markdown 支持结构与 APA 引用检查）
- `.epub`（电子书结构检查：mimetype / 元数据 / 导航 / 语言 / 替代文本 / 内部链接）

创建项目时加 `--epub-preview` 可在导出时附带基础 EPUB 预览（DOCX / MD / TXT 源稿适用）。
EPUB 的 EpubCheck / Ace 外部验证默认未运行，报告会如实标注「未运行」。

## 命令行用法

从仓库根目录调用核心前，先让 Python 找到本地包：PowerShell 使用
`$env:PYTHONPATH="$PWD\python"`；bash/zsh 使用 `export PYTHONPATH="$PWD/python"`。

下列稿件处理命令可作为本地开发接口直接调用；但 `project-standard-status`、`plan-rulepack-upgrade`、`upgrade-rulepack` 是 Electron 标准信任链后的底层接口，不是独立标准包验签器。正式产品中必须由 Electron 先完成 Ed25519 验签、CAS 选择并固定 `OAK_STANDARDS_STORE` / `OAK_EXPECTED_STANDARD_IDENTITY`，Python 再重算 manifest、payload、能力映射和身份。直接运行 Python 只能安全使用代码摘要锚定的内置包或检查既有存储结构，不能据此安装或信任任意本地更新包；普通用户应使用 APP 标准页。

```bash
# 创建检查项目（复制只读原稿、记录 SHA-256）
python -m oak_manuscript_core create --input <稿件.docx> --project <项目目录> --type paper --language auto --citation default

# 严格只读地生成引用解析与检查范围；从 JSON 取得 plan_id
python -m oak_manuscript_core plan-citation --project <项目目录> --citation default

# 用户确认上述解析后检查
python -m oak_manuscript_core check --project <项目目录> --citation default --citation-plan-id <citation-plan-ID>

# 严格只读地生成完整批量预览；从 JSON 结果取得 plan_id
python -m oak_manuscript_core plan-fixes --project <项目目录>

# 用户确认上述完整预览后，携带原 plan_id 一次执行整批修复
python -m oak_manuscript_core fix --project <项目目录> --plan-id <fix-plan-ID>

# 复检也应重新生成并确认当前引用计划
python -m oak_manuscript_core recheck --project <项目目录> --citation default --citation-plan-id <citation-plan-ID>

# 导出修订稿与报告
python -m oak_manuscript_core export --project <项目目录>

# 项目完整性验证（原稿哈希等）
python -m oak_manuscript_core verify --project <项目目录>

# 严格只读地生成结果同步白名单来源；只用于本地主进程构造预览，不发送
python -m oak_manuscript_core sync-source --project <项目目录> --event export

# 列出检查点（含可恢复状态与验证错误）
python -m oak_manuscript_core list-checkpoints --project <项目目录>

# 恢复选定检查点；恢复前自动创建安全检查点
python -m oak_manuscript_core restore-checkpoint --project <项目目录> --checkpoint-id cp-0001

# 只读查看项目固定标准状态
python -m oak_manuscript_core project-standard-status --project <项目目录>

# 只读生成到 Electron 已验签并固定的目标的完整差异；从 JSON 取得 plan_id
python -m oak_manuscript_core plan-rulepack-upgrade --project <项目目录> --to-manifest-sha256 <manifest-SHA256>

# 用户确认差异后，在写锁内提交项目 pin；随后必须重检
python -m oak_manuscript_core upgrade-rulepack --project <项目目录> --to-manifest-sha256 <manifest-SHA256> --plan-id <rulepack-plan-ID>

# 设置某条问题的处理状态（接受 / 拒绝 / 暂不处理）
python -m oak_manuscript_core issue --project <项目目录> --id check-0001-0003 --status rejected
```

`plan-citation`、`plan-fixes` 和规则包升级计划均绑定完整项目状态，生成与取消均严格只读。稿件、working、问题状态、规则包或解析结果变化会使相应旧计划失效。`fix` 不接受缺少 `--plan-id` 的直接调用。在正式 APP 路径中，规则包升级目标 release 必须已经由 Electron 验签并放入受验证标准存储，且 CLI apply 不接受缺少或过期的计划。

## 发布资源检查（开发者）

Windows alpha 资源的常用入口：

```powershell
# 从已经存在且版本固定的本地源重新生成/校验 JRE 与 Ace 阶段包
npm run stage:jre:win
npm run stage:ace

# 校验核心、Electron 43.1.0 全树锁、CPython、EpubCheck、JRE、Ace 的静态资源，
# 静态全部通过后再执行 Python 与 EpubCheck 探针
npm run verify:resources:win

# 单独复核五类 Windows 运行/构建资源的官方来源和受控推导；只读，不联网
npm run verify:provenance:python:win
npm run verify:provenance:epubcheck
npm run verify:provenance:jre:win
npm run verify:provenance:electron:win
npm run verify:provenance:builder:win

# 只读校验将进入 app.asar 的固定锚点、应用 loose 清单和平台锁摘要
npm run verify:resource-trust
```

普通 staging 和验证只接受已经存在且一致的仓库锁；审计升级时才允许显式更新锁。JRE 与 Ace 的候选目录和锁以事务方式提交，目录或锁换入失败会恢复原目录和原锁。Windows CPython provenance 固定 PSF 官方 ZIP/Sigstore/SPDX、34/33/1 文件推导与原样许可；EpubCheck provenance 固定官方 ZIP、GitHub 服务端 digest 与 49/49 原字节文件，并保留官网 MIT 与随包/仓库 BSD-3-Clause 矛盾；Temurin provenance 固定官方 ZIP/API/checksum/build metadata、490/490 源 JDK、本机 JDK、固定 `jlink` 推导、207 文件 runtime 与 94 份许可材料；Electron provenance 固定官方 ZIP、GitHub server digest、SHASUMS256、npm checksums 与 75/75 原字节运行时。四份运行时证据都明确标为人工签署待办；Temurin detached signature 因本机没有 OpenPGP 工具而明确保持未验签，Electron release 没有 detached signature 资产。Electron 43.1.0 `win32-x64` 的 tracked manifest 固定 2 个目录、75 个文件、364,083,658 字节，manifest SHA-256 为 `f5c2c915633c1917bc37377f8232bde4259588eb138bc4072a3c7df976e27486` 并绑定 provenance；该 manifest 使用严格 JSON、exact schema 和 canonical UTF-8/LF 原始字节。普通验证只读；显式 `--update-lock` 会验证安全父链、拒绝目标 symlink/hardlink，以独占候选文件、`fsync`、原子替换和换入后复验提交，失败恢复旧字节，回滚自身失败保留证据并明确报错。其它清单排序使用固定 UTF-16 code unit 顺序，不受系统 locale 影响。Ace 若遇到空/未知 license 声明或空许可证文件会直接拒绝；即使有许可证文件，全部 236 个包仍需正式逐包人工审计。

Windows builder 工具链不能由普通构建下载或自生成信任。安全下载器与导入器只接受以下三份精确归档：`nsis-3.0.4.1.7z`（`9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa`）、`nsis-resources-3.4.1.7z`（`593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103`）、`winCodeSign-2.6.0.7z`（`cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4`）。只有在用户明确批准本次联网后，开发者才可按以下顺序执行；下载器把归档写入仓库内的 `out/downloads/windows-builder/`，不会导入、解压或更新受信 lock：

alpha.18 的 builder provenance 另固定这三份官方 GitHub release API、`app-builder-lib 26.15.3` 选择逻辑和受控重组出的 385 文件工具树。三个 legacy release 不提供服务端 digest 或签名，组装树中所选 nsis-resources/winCodeSign 载荷也没有具名许可证文件，因此机器复验通过不等于正式许可/再分发签核。

```powershell
# 必须在本次联网已获明确批准后执行；普通 build/test 不调用此命令
npm run download:builder:win

# 下载全部完成且三份 SHA-256 均匹配后，再显式建立工具树与 tracked lock
node scripts/import_windows_builder_toolchain.js --archive-dir out/downloads/windows-builder --update-lock
```

下载器只允许契约中固定的 GitHub 官方 HTTPS 起始 URL、有限的 GitHub release 资产跳转域、最多 5 次跳转、单文件 128 MiB 和 30 秒 socket 静默上限；拒绝凭据、查询串、fragment、越界/链接输出目录、未知文件、硬链接和已有错误哈希。三份候选全部下载并校验后才以独占方式提交，冲突或失败只回滚本次事务文件。导入器随后拒绝 UNC/设备形式（包括直接网络共享写法）、未知归档、路径穿越、链接/reparse、备用流、加密条目、Windows 名称冲突和解压膨胀；安装前预检旧树/旧锁，候选树与 tracked lock 共同换入，全部 forward rename 和 rollback rename 故障都有 fail-closed 回归。路径字符串不能识别映射成盘符的网络共享，因此归档目录必须人工确认为本地非映射目录。当前三份真实归档已由用户批准下载，工具树与 `config/tool-manifests/electron-builder-win32-x64.json` 已建立并复验；普通构建只消费该离线锁，缺失或漂移时失败，不会自动补齐。

正式发行身份可用以下只读命令检查：

```powershell
npm run verify:release-identity
```

`config/release-identity.json` 只固定已确认的产品名、appId、品牌和官网。法定销售主体、支持/隐私/条款链接、版权声明、Windows 证书 subject、Apple Team ID 和具名复核在未确认时保持 `null` / `pending`；不要用示例值或猜测值填充。源码验证器交叉检查 `build.appId`、production `oakReleaseIdentity`、author/homepage/copyright；packaged 验证器从真实 `app.asar/package.json` 复核生产标记并报告证据范围。当前输出 `complete=false` 是正确阻断状态，不是验证器故障。

`verify:resources:win` 使用 `--release-tier auto`：prerelease 自动选择 `alpha`，资源正确时可通过并列出 sale 阻断；正式 semver 自动选择 `sale`。alpha.37 源码门禁为 17 项 blocker，真实 packaged ASAR/全树证据关闭其中 5 项后保留 12 项；`RELEASE_PUBLISHER_METADATA_PENDING` 仍存在，CPython/EpubCheck/Temurin-JRE/Electron/builder 来源项已收窄为人工签署待办，Electron fuse 兼容性阻断已经独立关闭。不要把 alpha 门禁通过理解为“可以销售”。

`npm run verify:fuses:config` 可单独验证 ASAR integrity、全量 `afterPack` 注册与 Electron fuse 构建合同。实际 `build:win` / `build:mac:*` 会在 builder 完成、签名前用精确锁定的 `@electron/fuses 2.1.3` 和 `strictlyRequireAllFuses=true` 写入全部 9 项，立即回读，再由独立门禁读取真实应用二进制并验证 `app.asar` 资源锚点及 production package identity。当前索引 8 为 `WasmTrapHandlers=true`，真实 alpha.37 EXE 无未知项；未来新增项仍会 fail-closed。详见 `ELECTRON_FUSE_POLICY.md`。

资源探针默认要求 host platform/arch 与 target 一致。跨主机只做静态检查必须显式使用 `--no-runtime-probe`；该结果只证明文件结构和锁，不证明运行时可以执行。Electron 桥和 Python 资源探针共用固定 `-I -S -X utf8` bootstrap，显式加入受控 core 目录，不依赖用户 `PYTHONPATH` 或 site-packages。

`npm run build:win` 使用仓库本地且独立 tracked lock 验证通过的离线 electron-builder 工具链，并固定本地 Electron dist 与 7-Zip。它先清除旧发布证据，再依次执行资源锚点、fuse 配置、构建、真实二进制 fuse、打包后资源门禁和强制外部验证的隐藏 packaged smoke；全部成功后才生成 `SHA256SUMS.txt` 和 `release-manifest-win32-x64.json`。

与当前源码版本精确匹配的真实制品存在后才可显式复核；不会扫描其它版本替代当前版本：

```powershell
npm run release:evidence:verify:win
```

验证器会按源码 `package.json` 的当前版本读取 EXE/ZIP，核对 PE/ZIP 结构、单链接文件身份、字节数与 SHA-256，再交叉验证 SHA 文件和 canonical manifest。当前源码已是 alpha.41 且本轮未打包，因此该命令不会拿 alpha.37 冒充当前制品。alpha.37 的 NSIS、ZIP、SHA 文件与 schema v2 canonical manifest 历史证据已通过交叉验证；manifest 另绑定对应 packaged-smoke、实际 unpacked EXE 与匿名输出树摘要。

安装生命周期验收器默认只读、不启动安装器，并要求当前源码版本存在精确制品；所以 alpha.39 尚不能运行该预检。历史 alpha.37 对归档 alpha.12 的只读预检已经通过：

```powershell
npm run verify:install-lifecycle:win
```

真实九阶段安装/升级/持久化/降级探测/卸载会写当前 Windows 用户的 HKCU、桌面和开始菜单，必须另行取得系统写入授权，并同时给出两个显式开关：

```powershell
node scripts/windows_install_acceptance.js --run --allow-system-mutation
```

alpha.37 已执行并通过默认只读安装生命周期预检，`authorized=false`，没有启动安装器。alpha.39 未打包、未预检；真实安装生命周期始终未运行，不能据此声称安装、升级、降级保护或卸载已验收。

macOS 分架构入口为 `npm run verify:resources:mac:x64` / `:arm64` 和 `npm run build:mac:x64` / `:arm64`，必须分别在对应原生 runner 执行。`npm run build:mac` 只选择当前 Mac 的原生架构；`npm run verify:resources:mac` 是显式 `--no-runtime-probe` 的跨架构静态聚合，不算探针或构建通过。当前仍缺 x64/arm64 Python/JRE 资源与锁、构建、签名、公证和实机证据。

打包 smoke 从源码 `package.json` 读取期望版本，通过 `appInfo` 核对七字段标准身份和 `app.isPackaged=true`，同时由资源门禁独立核对 ASAR production package identity，再执行引用解析确认和项目闭环。alpha.12 起 packaged runner 强制 EpubCheck/Ace，调用者不能静默降级；alpha.37 source/packaged 真实运行均已通过，并各自用同一隔离 `userData` 第二次启动恢复加密队列。packaged runner 另在 EXE 启动前后复核字节摘要，并把双进程输出摘要和匿名项目输出树写入 canonical 证据；该证据不含稿件正文，但与制品同处本地时仍不等于签名。项目、标准 store、临时目录、用户数据、缓存和崩溃目录按运行 ID 隔离在仓库 `out/`，窗口保持隐藏。

自选导出目录会逐级拒绝链接、目录联接和非常规目录；若选择项目内部目录，只允许 `exports/` 下。全部输出目标先统一预检，已有链接或硬链接目标不会被覆盖；每个文件在同目录完整暂存并原子换入。PDF 样张另在禁 JavaScript、导航和网络的非持久隔离 session 中生成。

## 输出与退出码

- 每个命令在标准输出打印一个 UTF-8 JSON 文档（可直接程序化消费），提示信息走标准错误；
- 退出码：`0` 成功；`1` 检查存在未处理的「必须处理」问题（或完整性有非致命问题）；`2` 运行错误或原稿哈希不一致；
- 被「拒绝」的问题在复检后保持拒绝状态，不会反复打扰。

## 隐私说明

- 当前桌面 alpha 的检查、计划、修复、恢复与导出均在本机完成，不上传稿件；
- Electron 默认 session 阻断网络 scheme；未来联网 Provider 必须单独取得授权，不能放宽默认离线界面；
- 原稿以只读副本保存在项目 `source/` 目录，绝不被修改；
- 详见 `PRIVACY_AND_SECURITY.md`。
