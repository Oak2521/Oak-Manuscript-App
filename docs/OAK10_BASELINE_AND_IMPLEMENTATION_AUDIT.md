# OAK-10 基线与实施审计

日期：2026-08-14
实施分支：`codex/oak-10-manuscript-account`
修改前基线：`f0ed468f3c6af6c15bc21e9bd2d55a0a7280361b`（Alpha.61 后续 main 检查点）

## 冻结合同

- 唯一来源：只读仓库 `D:\Workspace\Oak by Lake\oak-account-center`。
- 冻结提交：`6aea9986539a0f55b2961426fa08e486a9e30b19`。
- 来源状态：`FROZEN_FOR_CONSUMER_IMPLEMENTATION`。
- 消费副本：`config/contracts/oak-account/1.0/`；`provenance.json` 固定 16 个文件的字节数和 SHA-256。
- 本地验证器拒绝未知 major、字节漂移、错误 issuer/audience、过期 token、非 active 账户、未知 claims 和错误签名。
- 该提交只冻结消费合同，不证明 Account Center 服务端、Staging、Production URL 或真实凭据存在。

## 修改前七项基线

1. Auth、Pro、同步、直传与失败队列
   - Alpha.61 桌面 Auth 是待配置的通用 OAuth/自定义 scheme 代码；配置没有真实端点，但安全存储仍允许持久化 access token。
   - Pro 已由 Oak Manuscript 自己的 Ed25519 签名权益决定，不直接信任账号 claims；未登录、失效或验签失败均回落 Free，且 `localProjectsLocked=false`。
   - 结果同步已有内容白名单、逐字段预览、显式确认、safeStorage 加密队列、revision CAS、幂等发送与失败保留；默认传输未配置。
   - Web 临时稿件已有 Supabase S3 短期直传/直取、一次性完成/领取、私有 worker 与清扫闭环；Supabase 在这里是对象存储和服务端数据库，不应因身份迁移被机械删除。
2. 信任边界
   - Renderer 只经固定 preload IPC；不得接触 token、code、verifier、任意 URL、稿件同步负载或服务端密钥。
   - Electron 主进程持有 OS 安全存储、账户状态、Pro 验签、同步队列与网络 client。
   - Python 只处理本地稿件和产生内容无关的 `sync-source`；项目读写受路径、锁、哈希和原子写入门禁保护。
   - 远端 API 必须从已验签会话派生 owner；请求正文不得自报账号。
3. 旧身份读取路径
   - 修改前 `config/desktop-auth.json`、`desktop-auth-v1.schema.json`、`auth-session-store-v1.schema.json`、`electron/main.js`、旧 Auth provider/client 和四个 Web composition root 存在旧 OAuth/GoTrue 形状。
   - 配置为 `pending_configuration`，仓库没有可用 Production URL、真实 publishable key、token 或 Cookie。
4. Alpha.61 源码与 Alpha.58 安装包
   - Alpha.58 标签：`dd093c1de196999b86a94c47fb916d5ad9e403c7`。
   - Alpha.61 标签：`c490bbeb127749cd0a3931037ae09ce9447e5fac`。
   - 标签差异：60 个文件，4046 行新增、552 行删除。
   - 本地真实制品仍是 2026-07-29 的未签名 Alpha.58 NSIS/ZIP；Alpha.61 在本任务开始时只有源码检查点。
5. 本地项目账户关联
   - 项目数据库/项目文件不保存账号、token 或远端 owner；项目 `sync` 只保存内容无关的本地历史容器。
   - 账号绑定只存在于全局 OS 加密 Auth 状态和全局 OS 加密同步队列；退出、暂停或删除账号不得删除本地项目。
6. Pro 判定
   - `electron/license-entitlement.js` 独立验证 Oak Manuscript 签名权益的 issuer、audience、账号、设备、有效期、设备状态和 Ed25519 签名。
   - Account Center access token 只证明短期 active 身份，不携带或授予 Pro、角色、额度、同步权益。
7. Supabase S3 的角色
   - S3 直传是短期对象数据面，不是旧身份协议。服务端 service key/S3 key 与客户端身份验证分离；浏览器只拿受对象键、方法、长度、MIME、摘要、Origin 和时限约束的临时授权。

## Alpha.62 本地实施结果

- 桌面：固定 application-login 路由、系统浏览器、`127.0.0.1` 随机端口/路径 nonce、PKCE S256、严格 state/一次回调、300 秒 access token 内存限定、7 天空闲/30 天绝对 refresh 门禁、每次刷新轮换、本地先退出和离线撤销未确认状态。
- 存储：`OAKAUTH2/session-v2.enc` 只保存 refresh 会话；旧 `session-v1.enc` 仅在确认普通单链接文件后清除，不迁移旧凭据；access token 字段在存储边界被拒绝。
- 生命周期：`suspended`、`deletion_pending`、`deleted` 清除账号凭据并停止新远端操作；本地稿件能力不依赖账号状态。
- Renderer：只显示是否登录和脱敏状态，不显示 UUID；登录不等于同意同步。
- Web：同步、权益、账户设备和直传作业四个生产 composition root 已改为本地验签 Oak Account JWT，只将 `oak_account_id` 映射成 owner principal；`sub`、`sid`、email 和额外角色不能成为主键或授权。
- Pro：仍由 Oak Manuscript 自签权益独立决定。active identity 本身不能启用 Pro；设备撤销/权益过期回落 Free，但本地项目始终可访问。
- 同步/直传：保留现有显式预览确认、加密失败队列、幂等补偿、跨账号隔离、短期 S3 授权、一次性领取与零留存清扫。未填写任何真实端点、凭据或 Production URL。

## 尚不能宣称的事项

- 没有 Account Center 服务端运行时、真实 Staging URL/凭据和系统浏览器真实 E2E。
- 没有执行真实 Supabase migration、桶/CORS/RLS、跨服务撤销传播或官网账号后台联调。
- 没有干净 Windows 设备安装/升级/卸载证据、Authenticode 签名、macOS 原生构建/签名/公证。
- 因而 Alpha.62 即使本地源码测试和 Windows 打包通过，也不是 deployed 或 production-ready。

## 最终本地验证（2026-08-14）

- 统一入口：`npm test` 退出 0；Node 761 total / 755 pass / 0 fail / 6 skip，Python 368 total / 0 failures / 0 errors / 3 skip。
- Windows 全链：最终 `npm run build:win` 305.1 秒退出 0；JRE/Ace stage、源码/packaged 资源、9 fuse、electron-builder、packaged smoke 与 schema v2 发行证据同链完成。
- packaged smoke：运行根 `out/packaged-smoke/runs/msslwfuj-5c4e1e4dc65c88fc/projects/`，76 文件 / 1,378,165 字节，SHA-256 `e0235b95442498d37817111d238c098ef115cf4c6c6ee4f2d0d28e1d715d01a7`。
- NSIS：190,078,160 字节，SHA-256 `3a3c74dae29ff936ca0771534c2660e0527899a724211f0bb17e1cc58271bb64`。
- ZIP：233,924,735 字节，SHA-256 `9263fb67551dada1feb76899f520c12a1bdfdab2123f8dbe12520d94c1ca2f5c`。
- 资源信任：131 文件 / 2,243,858 字节；manifest `9b00c85bf99dda9fef05e8078cbc8cab526e104a30b29ae7dac31498ccd69bbc`；anchor `bc69e8c3051f336f88e52270f18bde048bf5cf4289dfb1207d1dcb30a0e05e16`。
- ASAR 清单只包含新的 application-login client/provider、loopback listener 与 Oak token verifier；旧通用 Auth client/provider 被 production package 排除。
- Windows Authenticode：NSIS 与 unpacked EXE 均为 `NotSigned`。
- 构建调试中发现并修复 Ace 外部 `puppeteer.connect()` 会话与主进程双重关闭 Chrome 的偶发竞态；受控补丁升级为 `OAK-ACE-ISOLATION-003`，Node/Python 双重固定摘要与 20/20 定向测试通过。

## 总控复检后恢复补件（2026-08-15）

- 重启恢复时分支与 HEAD 仍为 `codex/oak-10-manuscript-account` / `f7d14f027623975799224da4eb824e080aa451de`；五个原实施提交及 96 文件基线无漂移。
- Alpha.62 NSIS、ZIP、unpacked EXE 和 `SHA256SUMS.txt` 的字节数/SHA-256 与原 schema v2 证据完全一致；`desktop-auth.json` 仍为 `pending_configuration`，发行身份仍未完整。
- 总控指出的本文第 3、4 行尾随空格已移除。合同验证、Node 761 项、9 项 fuse、packaged 资源/探针、packaged smoke 证据与发行证据均重新通过。
- 受限 shell 中首次 Node 回归因项目内临时目录创建被环境拒绝而统一 `EPERM`；该结果未计为产品失败。同一 HEAD 在获准的项目内非受限运行中为 755 pass / 0 fail / 6 skip。
- 本补件不填写真实 URL/密钥，不执行 Staging、数据库/对象存储、安装生命周期、签名、macOS、部署或法务状态变更。OAK-10 继续保持 `in_review`。
