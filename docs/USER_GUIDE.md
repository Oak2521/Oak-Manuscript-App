# USER_GUIDE — 使用指南

## 桌面应用（推荐）

当前开发版本为 `0.1.0-alpha.1`，不是可售卖正式版。仓库中的 Claude `0.0.1` Windows 便携产物仅是历史基线；新的 Windows 安装器、macOS 安装包和 Web 版仍待构建、签名及真实验收。

**开发运行**：`npm install` 后 `npm start`。统一测试用 `npm test`（Node + Python）；分项排障用 `npm run test:node`、`npm run test:python`，UI 真实闭环用 `npm run smoke`。

流程：欢迎页（隐私说明）→ 选稿件或匿名样本 → 选项目目录 → 选检查目标 → 检查 →
问题页可逐条接受/拒绝/暂不处理；选择“预览批量自动修复”时，APP 在一个可滚动窗口集中列出全部白名单机械修改的标题、位置和修改前/后预览。只有点击一次“确认批量修复 N 项”才执行整批写入；取消不写入。修复后可在“撤销与检查点”中撤销上一次批量修复或恢复选定检查点 → 导出中心（修订稿、三种报告、PDF 样张、基础 EPUB 预览、脱敏评估摘要）→ 验证完整性。

检查点恢复前会自动保存当前状态为安全检查点，因此恢复操作本身也可撤销。核心会把损坏或越界的检查点标为不可恢复；即使请求恢复，也会在写入前拒绝，不改变工作稿或原稿。

**外部验证（EPUB）**：问题页「外部验证」按钮运行 EpubCheck（需 Java 21+）与
Ace（需本机 Chrome）；未安装时报告如实标注「未运行」。

## 命令行核心

Python 3.11+。核心零第三方依赖，无需安装任何包。

## 支持的输入格式（阶段 1 完成，全部四种）

- `.docx`（论文 / 纸质出版物全部检查）
- `.md`、`.txt`（UTF-8；Markdown 支持结构与 APA 引用检查）
- `.epub`（电子书结构检查：mimetype / 元数据 / 导航 / 语言 / 替代文本 / 内部链接）

创建项目时加 `--epub-preview` 可在导出时附带基础 EPUB 预览（DOCX / MD / TXT 源稿适用）。
EPUB 的 EpubCheck / Ace 外部验证默认未运行，报告会如实标注「未运行」。

## 命令行用法

从仓库根目录调用核心前，先让 Python 找到本地包：PowerShell 使用
`$env:PYTHONPATH="$PWD\python"`；bash/zsh 使用 `export PYTHONPATH="$PWD/python"`。

```bash
# 创建检查项目（复制只读原稿、记录 SHA-256）
python -m oak_manuscript_core create --input <稿件.docx> --project <项目目录> --type paper --language auto --citation default

# 检查
python -m oak_manuscript_core check --project <项目目录>

# 严格只读地生成完整批量预览；从 JSON 结果取得 plan_id
python -m oak_manuscript_core plan-fixes --project <项目目录>

# 用户确认上述完整预览后，携带原 plan_id 一次执行整批修复
python -m oak_manuscript_core fix --project <项目目录> --plan-id <fix-plan-ID>

# 复检
python -m oak_manuscript_core recheck --project <项目目录>

# 导出修订稿与报告
python -m oak_manuscript_core export --project <项目目录>

# 项目完整性验证（原稿哈希等）
python -m oak_manuscript_core verify --project <项目目录>

# 列出检查点（含可恢复状态与验证错误）
python -m oak_manuscript_core list-checkpoints --project <项目目录>

# 恢复选定检查点；恢复前自动创建安全检查点
python -m oak_manuscript_core restore-checkpoint --project <项目目录> --checkpoint-id cp-0001

# 设置某条问题的处理状态（接受 / 拒绝 / 暂不处理）
python -m oak_manuscript_core issue --project <项目目录> --id check-0001-0003 --status rejected
```

`fix` 不接受缺少 `--plan-id` 的直接调用。生成计划后若 working、问题状态或规则包发生变化，旧计划会被拒绝，必须重新运行 `plan-fixes` 并再次确认。计划生成和取消均不创建检查点、不改变问题状态，也不写 working。

## 输出与退出码

- 每个命令在标准输出打印一个 UTF-8 JSON 文档（可直接程序化消费），提示信息走标准错误；
- 退出码：`0` 成功；`1` 检查存在未处理的「必须处理」问题（或完整性有非致命问题）；`2` 运行错误或原稿哈希不一致；
- 被「拒绝」的问题在复检后保持拒绝状态，不会反复打扰。

## 隐私说明

- 当前桌面 alpha 的检查、计划、修复、恢复与导出均在本机完成，不上传稿件；
- 原稿以只读副本保存在项目 `source/` 目录，绝不被修改；
- 详见 `PRIVACY_AND_SECURITY.md`。
