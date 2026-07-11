# DEVELOPMENT_STATUS — 开发状态（唯一状态来源）

> 每个阶段 / 里程碑完成后更新。最新在上。

## 当前状态（2026-07-11）

| 阶段 | 状态 |
|---|---|
| 阶段 0：产品与规则基线 | **完成**（2026-07-11） |
| 阶段 1 M1：DOCX + 论文 + GB/T 7714 命令行闭环 | **完成**（2026-07-11） |
| 阶段 1 M2：纸质出版物 + APA 7 / Chicago 18 + MD/TXT | **完成**（2026-07-11） |
| 阶段 1 M3：EPUB 输入与电子书配置 + 基础 EPUB 导出 | **完成**（2026-07-11） |
| **阶段 1 整体** | **完成**——四种输入、三类配置、35 条规则全部落地 |
| 阶段 2：桌面 APP MVP | **完成**（2026-07-11，UI 双闭环冒烟 PASS） |
| 阶段 3：质量、打包与内测 | **部分完成**——Windows 便携包 + 校验值 + 打包版冒烟 ✔；余：macOS / 签名 / 安装器 / 人工内测 |
| 阶段 4：网站和授权对接 | **被阻塞**：网站用户系统未上线；网站侧页面属网站项目任务（本仓库只读参考约束） |
| 阶段 5：正式发布 | 未开始（依赖阶段 3 收尾与阶段 4） |

### 测试基线

- Python 统一入口：`python scripts/run_tests.py` — **185 项测试，0 失败 0 错误**（Ace 慢测默认跳过，`OAK_TEST_ACE=1` 启用）
- UI 冒烟：`npm run smoke` — DOCX + EPUB 双闭环 + Provider 占位纪律断言
- 打包：`npm run dist` → release/ 便携 ZIP；打包版可直接 `--smoke` 自检
- 样本再生成：`python scripts/make_samples.py`（确定性，固定 ZIP 时间戳）

### 关键交付物索引

| 交付物 | 位置 |
|---|---|
| 冻结规格 | docs/SPEC_PROJECT_FORMAT.md、docs/SPEC_MODELS.md、docs/RULESET_V1.md |
| 规则包 v1.0.0（35 条） | config/rule-packs/oak-rules-1.0.0.json |
| 标准注册表 | config/standards.json |
| 匿名样本库 | samples/（3 DOCX + MD + TXT，缺陷↔规则对照见 samples/README.md） |
| 检查核心 | python/oak_manuscript_core/（CLI：create/check/fix/recheck/export/verify/issue） |
| 架构决策 | docs/ARCHITECTURE.md（AD-001 零依赖、AD-002 CLI 契约、AD-003 规则包分离） |

### 后续待办

**阶段 3 收尾（需外部资源）**
- macOS `.app` / DMG 构建与公证（需 macOS 机器 + Apple 开发者账号）；
- Windows 安装器（NSIS）与代码签名（需证书）；
- 5—10 位作者 + 2—3 位编辑受控内测（人工组织，按误报率 / 导出成功率 / 完成率迭代）。

**阶段 4 前置条件**
- 网站用户系统合并上线（Supabase 路线，代码已在网站项目分支）；
- 网站侧 9 个缺失页面（含隐私政策与使用条款）——属网站项目任务，须另行授权在网站项目执行；
- 届时替换 AuthProvider（PKCE）/ SyncProvider / EvaluationProvider 真实实现，本地核心与项目格式不变。

**技术改进背账**
- 基础 EPUB 导出补可访问性元数据（schema:accessMode 等，Ace 现如实报 fail，呼应方案 §15.6）；
- npm audit 高危项跟踪（@daisy/ace 传递依赖 multer CVE——仅开发依赖，不进发布包）；
- Electron 主进程去除启动期诊断日志（或改为可选 verbose）。

## 历史记录

- 2026-07-11：**阶段 2 完成 + 阶段 3 部分完成**。Electron 43 壳（安全基线全项）+ 七页中文 UI + UI 双闭环冒烟；EpubCheck 5.3.0 与 Ace 1.4.6 真实接入（发现并修复生成器缺 dcterms:modified）；脱敏评估摘要导出；Windows 便携包（含嵌入式 Python）+ SHA-256 + 打包版冒烟 PASS。测试 185 项。

- 2026-07-11：**M3 完成，阶段 1 收官**。EPUB 读取器（mimetype/container/OPF/nav/内容文档）、6 条 EPUB 规则、白名单扩至 6 条（EPUB mimetype 重建 + lang 补齐，含「语言未知不补写」反例）、基础 EPUB 导出（自检零问题）。175 项测试。

- 2026-07-11：**M2 完成**。Markdown / TXT 读取器（ATX 标题、围栏豁免、BOM/CRLF 容错）、6 条 M2 规则（书稿结构 / 目录一致性 / 分页聚合 / MD 标题 / APA 括注核对 / Chicago 注释书目一致）、4 个新样本、ops/CLI 支持 md/txt 全流程。135 项测试。
- 2026-07-11：**M1 完成**。项目管理（哈希/检查点）、DOCX 读取器（stdlib + ZIP 安全）、确定性规则引擎 + 23 条 M1 规则、4 项白名单幂等修复、三格式报告与修订稿导出、CLI 闭环、103 项测试。Word COM 实测修订稿正常打开。
- 2026-07-11：阶段 0 完成。冻结项目格式 / 三模型 / 规则包 v1.0.0（35 条）/ 默认体例映射 v1.0.0；建匿名样本库。
- 2026-07-11：仓库基线建立。代码从零开始（旧实现已放弃，不参考）。
