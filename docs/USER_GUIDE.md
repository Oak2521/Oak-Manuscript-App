# USER_GUIDE — 使用指南

> 阶段 1 为命令行核心指南；阶段 2 桌面 APP 上线后改写为图形界面指南。

## 环境要求

Python 3.11+。核心零第三方依赖，无需安装任何包。

## 支持的输入格式（当前 M2）

- `.docx`（论文 / 纸质出版物全部检查）
- `.md`、`.txt`（UTF-8；Markdown 支持结构与 APA 引用检查）
- `.epub` 将在 M3 里程碑支持

## 命令行用法（随 M1 实现补全）

```bash
# 创建检查项目（复制只读原稿、记录 SHA-256）
python -m oak_manuscript_core create --input <稿件.docx> --project <项目目录> --type paper --language auto --citation default

# 检查
python -m oak_manuscript_core check --project <项目目录>

# 白名单机械修复（自动建检查点）
python -m oak_manuscript_core fix --project <项目目录>

# 复检
python -m oak_manuscript_core recheck --project <项目目录>

# 导出修订稿与报告
python -m oak_manuscript_core export --project <项目目录>

# 项目完整性验证（原稿哈希等）
python -m oak_manuscript_core verify --project <项目目录>

# 设置某条问题的处理状态（接受 / 拒绝 / 暂不处理）
python -m oak_manuscript_core issue --project <项目目录> --id check-0001-0003 --status rejected
```

## 输出与退出码

- 每个命令在标准输出打印一个 UTF-8 JSON 文档（可直接程序化消费），提示信息走标准错误；
- 退出码：`0` 成功；`1` 检查存在未处理的「必须处理」问题（或完整性有非致命问题）；`2` 运行错误或原稿哈希不一致；
- 被「拒绝」的问题在复检后保持拒绝状态，不会反复打扰。

## 隐私说明

- 一切处理在本机完成，不上传任何内容；
- 原稿以只读副本保存在项目 `source/` 目录，绝不被修改；
- 详见 `PRIVACY_AND_SECURITY.md`。
