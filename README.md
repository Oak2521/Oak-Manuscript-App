# 湖岸稿件（Oak Manuscript）

本地优先的稿件检查与修订产品。当前开发版本为 `0.1.0-alpha.4`，已有 Electron 桌面端、Python 检查核心、Windows alpha 本地运行资源与发布前门禁，以及离线标准包验证、项目版本固定、显式升级和回滚链路；商业正式版目标为 Windows、macOS 与 Web。按论文、纸质出版物、电子书三类目标检查稿件，提供可追溯标准依据的问题解释、集中确认的白名单机械订正、检查点恢复、修订稿与检查报告导出。

**当前桌面核心承诺**：稿件默认只在本机处理；永不原地修改原稿（SHA-256 全程校验）；不强制注册；报告与导出不设营销门槛。

`0.1.0-alpha.4` 的**源码检查点标签**为 `chatgpt-v0.1.0-alpha.4`；该标签只标记源码与本地验证状态，不代表二进制发行。本轮仍没有 alpha.4 Windows 安装包或 ZIP。Windows x64 Electron 43.1.0 已由受版本控制的完整文件/目录树锁固定；tracked manifest 拒绝重复键与未知字段，并固定为唯一 canonical UTF-8/LF 字节。显式 `--update-lock` 会验证安全父链、拒绝目标 symlink/hardlink，并以独占候选文件、`fsync`、原子替换、换入后复验和失败回滚更新。Windows builder 安全导入器已实现，但三份固定官方归档、真实工具树及由导入事务生成的独立 tracked lock 仍缺失。标准包联网获取与生产签名信任根、代码签名、macOS x64/arm64 运行资源和原生验收，以及 Web、湖岸统一账号、订阅与同步仍按商业方案开发，尚未完成正式验收。

最新回归为 PASS：Node TAP 共 `239` 项，`233` 通过、`0` 失败、`6` 项条件跳过（2.606 秒）；Python 默认共 `312` 项，`0` 失败、`0` 错误、`3` 项条件跳过（80.125 秒）。沙箱外隐藏 Chrome 的真实 Ace 套件为 `312` 项、`0` 失败、`0` 错误、`1` 项条件跳过；隐藏 Electron alpha.4 源码 smoke 为 PASS，最新运行根为 `out/source-smoke/runs/ms37h0mu-201a90896825d190/projects/`，DOCX/EPUB 各有 4 次检查、`source_hash_ok=true`，PDF 分别为 258,404 / 161,836 字节。标准 manifest SHA-256 为 `d33534f081b2122a90652ee03304a0e71177a7fd0d3130fffe77b0fea807d7af`，规则包 SHA-256 为 `7ac5a5bdb126e9f5148a040ce42a634b1a95295c27d7a72c774db54bf7129542`；两者的七字段身份贯穿 APP、项目、当前检查与报告，历史检查按其生成时身份保存。Electron runtime manifest SHA-256 为 `ae67132b95e21b62450fd0e34faaf00164514b38322076c56e37c0301c520d95`，固定 2 个目录、75 个文件和 364,083,658 字节。Windows alpha 资源门禁通过；builder 包装器因真实工具链和 tracked lock 缺失在启动 electron-builder 前 fail-closed，未联网、未生成安装包或 ZIP。正式售卖门禁现有 17 项明确阻断；macOS 静态门禁因分架构资源缺失按预期失败。详见 `docs/TEST_REPORT.md`。

当前桌面安全边界包括：默认 Electron session 离线与固定 CSP；PDF 使用禁 JavaScript/导航/网络的非持久隔离 session；项目 schema/路径完整校验与跨进程内核写锁；创建项目在锁内以单一输入文件描述符复制到 `source`，再生成 `working`；自选导出目录逐级验证、全部目标预检和逐文件原子换入；标准包以 canonical manifest、内容寻址存储、高水位和精确回滚目标 fail-closed。已有项目不会因全局标准更新而静默换规则，必须先查看差异并显式确认，升级后强制重检。

## 快速开始

开发要求：Node.js、Python 3.11+；Python 核心零第三方依赖。

```bash
# 安装桌面开发依赖并启动
npm install
npm start

# 统一测试入口：Node + Python
npm test

# 分项排障
npm run test:node
npm run test:python
```

批量修复必须先运行只读 `plan-fixes`，在界面集中查看全部修改并一次确认，再携带 `plan_id` 执行 `fix`。完整桌面与命令行流程见 `docs/USER_GUIDE.md`。

## 文档导航

| 文档 | 内容 |
|---|---|
| `docs/湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md` | **商业正式版权威需求方案（唯一）** |
| `docs/湖岸稿件_Oak_Manuscript_APP_开发方案_v1.2_Claude_20260711.md` | Claude `0.0.1` 历史基线（非当前权威） |
| `AGENTS.md` | 开发引擎守则（接手必读） |
| `AI_HANDOFF.md` | 项目交接说明 |
| `docs/DEVELOPMENT_STATUS.md` | 当前开发状态（唯一状态来源） |
| `docs/ARCHITECTURE.md` | 架构与关键技术决策 |
| `docs/ACCEPTANCE.md` | 验收标准 |
| `docs/TEST_REPORT.md` | 测试报告 |
| `docs/PRIVACY_AND_SECURITY.md` | 隐私与安全基线 |
| `docs/WEBSITE_INTEGRATION.md` | Provider 边界、当前离线实现与未来网站对接 |

## 仓库结构

见 `AGENTS.md` 第 5 节。
