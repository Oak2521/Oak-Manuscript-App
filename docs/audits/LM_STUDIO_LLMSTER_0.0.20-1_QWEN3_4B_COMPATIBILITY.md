# LM Studio llmster 0.0.20-1 / Qwen3 4B 窄范围兼容验收

> 验收日期：2026-07-29  
> APP 源码版本：`0.1.0-alpha.43`  
> 结论：**通过限定组合验收，但不构成桌面 GUI、其他版本/模型/硬件或产品级兼容承诺**

## 1. 验收对象与来源

本次验证使用 LM Studio 官方 headless 核心 `llmster`，不是桌面 GUI。官方文档将 `llmster` 定义为适合服务器和自动化的无界面 daemon，并由 `lms` CLI 管理：

- Headless 模式：<https://lmstudio.ai/docs/developer/core/headless>
- CLI：<https://lmstudio.ai/docs/cli>
- 本地服务器：<https://lmstudio.ai/docs/developer/core/server>
- OpenAI-compatible 端点：<https://lmstudio.ai/docs/developer/rest>

固定下载链：

| 项目 | 固定值 |
|---|---|
| 官方安装脚本 | `https://lmstudio.ai/install.ps1` |
| 安装脚本 SHA-256 | `0a4db8f085b6aa2a878aa3c5b1278217ace8c2d82cfd99bd02f82b2e851b5889` |
| 脚本固定版本 | `APP_VERSION='0.0.20-1'` |
| 官方 archive | `0.0.20-1-win32-x64.full.zip`，881,662,805 字节 |
| 官方 SHA-512 | `8d6ae2002a1c2d3e5a9e004ea3ef82134cda39bf4371f268e255d6577237f0c45e6a0a4b9c4df9d92efb07deada06dd1bc49db845b152c6ded8a900ba30aed94` |
| llmster 运行版本 | `0.0.20+1` |
| `llmster.exe` SHA-256 | `a39c907bae8f669685ac8069e6731c3aaafd0c679cb3da008450f95280039c43` |
| `lms.exe` SHA-256 | `bfe33bc1cc700dcc4add81938816017a59f24af2a0c366525d3839d58e8fe95b` |

ZIP 在执行前完成路径审计：3,614 个条目、展开 1,826,613,053 字节；没有绝对路径、`..`、冒号或重复路径。`llmster.exe` 的 Authenticode 状态为 `NotSigned`；官方 SHA-512 下载链可以证明本次字节与官方发布物一致，但不能替代可执行文件签名，也不能据此批准商业再分发。

## 2. 隔离与模型身份

没有执行官方安装脚本。ZIP 只解压到：

`out/external-validation/lm-studio/llmster-0.0.20-1/`

运行时把 `HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`TEMP`、`TMP` 全部指向该目录，并设置 `LMS_NO_MODIFY_PATH=1`。`bootstrap` 的实际安装目标为隔离目录的 `state/.lmstudio/`；没有修改真实用户 PATH 或启动项。API 只绑定 `127.0.0.1:12400`，未启用 CORS。

模型复用此前官方 Ollama 验收已固定的 GGUF 字节，通过仓库内硬链接导入，没有再次下载或复制模型内容：

| 项目 | 固定值 |
|---|---|
| LM Studio 模型 key | `qwen3-4b` |
| API identifier | `oak-qwen3-4b` |
| architecture | `qwen3` |
| quantization | `Q4_K_M` |
| 大小 | 2,497,280,480 字节 |
| SHA-256 | `3e4cb14174460404e7a233e531675303b2fbf7749c02f91864fe311ab6344e4f` |
| context length | 4,096 |

测试结束后卸载模型、停止 API、关闭 daemon；仓库隔离根下没有残留进程，原始 GGUF SHA-256 复核不变。

## 3. 验收脚本与真实发现

验收脚本：`scripts/run_lm_studio_compatibility.js`。它复用生产 `BoundedAIHttpClient`、compatible adapter、Router、Provider 和 Coordinator，并固定真实规则 `DOCX-SPACE-001` / fixer `FIX-SPACE-001`。证据不保存建议正文，只保存质量布尔项、字节数和 SHA-256。

真实产品行为暴露出两个不能用 fake 发现的差异：

1. 当只有一个 LLM 已加载时，LM Studio 对未知 `model` 仍返回 200，并静默改用已加载模型；响应 `model` 为 `oak-qwen3-4b`。alpha.43 因此让 LM Studio 适配器强制核对响应模型标识，替换行为映射为 `AI_SERVICE_INCOMPATIBLE`，旧 plan 不可重放。
2. LM Studio 的普通文本响应含 `tool_calls: []`。空数组表示没有工具调用；alpha.43 仅允许精确空数组，非空、非数组或 `finish_reason=tool_calls` 继续 fail-closed。

这两项属于生产兼容修复，不是为了让测试凑 PASS。

## 4. 最终结果

canonical 证据：

`out/external-validation/lm-studio/llmster-0.0.20-1/compatibility-evidence.json`

证据为 1,661 字节，SHA-256：

`a5f1fb5b7b9e610362d87c60aa2d1521934b57618c48ab4b19b8944291e4b3e9`

| 场景 | 结果 | 证据 |
|---|---|---|
| 发送预览 | PASS | 0 请求 |
| 正常建议 | PASS | 确认后 1 请求；18,956 ms；`memory_only`；`automatic_writeback=false` |
| 人工接受 | PASS | `manuscript_modified=false`；`suggestion_persisted=false` |
| 静默模型替换 | PASS（应用拒绝） | `AI_SERVICE_INCOMPATIBLE`；重放为 `AI_PLAN_STALE`；无第二请求 |
| 100 ms 超时 | PASS | `AI_SERVICE_TIMEOUT`；重放为 `AI_PLAN_STALE`；无第二请求 |
| 窄质量判据 | PASS | 98 字节；识别连续空格、提出规则一致修正、不声称已改稿 |
| 隐私 | PASS | 仅匿名构造上下文；未读用户稿件；未用凭据；证据无建议正文 |

完整回归：Node 599 total / 592 pass / 0 fail / 7 skip；Python 362 / 0 failures / 0 errors / 3 skipped。alpha.43 隐藏源码 Electron smoke PASS，输出：

`out/source-smoke/runs/ms5qdhf2-dd22990533467ecf/projects/`

## 5. 结论边界

本证据只证明 Windows 11、LM Studio 官方 headless `llmster 0.0.20+1`、上述 Qwen3 4B GGUF、当前 alpha.43 源码和一个匿名连续空格问题。它不证明：

- LM Studio 桌面 GUI 0.4.x；
- 其他 llmster、模型、量化、硬件或上下文设置；
- macOS、远程 HTTPS、真实凭据或多模型并存语义；
- 宽泛稿件质量、长期稳定性、LM Studio/模型再分发许可；
- alpha.43 Windows 安装包。最新已验证 Windows 制品仍是未签名 alpha.42。
