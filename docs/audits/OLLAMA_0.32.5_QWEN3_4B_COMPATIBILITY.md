# Ollama 0.32.5 / qwen3:4b 真实兼容验收

> 验收日期：2026-07-29
> 结论：**窄范围通过**。仅证明下述 Windows 11、Ollama 0.32.5、qwen3:4b、单条匿名“连续空格”问题和当前 OpenAI-compatible transport 组合；不等于支持所有 Ollama 版本、模型、硬件或稿件类型。

## 1. 官方输入与本地身份

- 官方来源：[Ollama Windows 文档](https://docs.ollama.com/windows)、[OpenAI compatibility 文档](https://docs.ollama.com/api/openai-compatibility)、[v0.32.5 release](https://github.com/ollama/ollama/releases/tag/v0.32.5)、[qwen3 模型页](https://ollama.com/library/qwen3)。
- Windows standalone ZIP：`ollama-windows-amd64.zip`，1,457,824,795 字节，SHA-256 `7c941ae084569d298062d29f8139163a3187c76dbca0479c70d085e78fd8c7bb`；本地摘要与 GitHub release asset digest 一致。
- 服务探针：`GET /api/version` 返回 `0.32.5`。
- 模型：`qwen3:4b`，Ollama API 报告 2,497,293,931 字节；本地 manifest 859 字节，SHA-256 `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`；主模型 layer 为 2,497,280,480 字节。
- 本机运行记录：Windows 11、NVIDIA GeForce RTX 4070 Ti、CUDA compute 8.9、12.0 GiB VRAM；37/37 layers offload。该硬件事实来自本地 Ollama 日志，不是最低配置承诺。

运行包、模型、状态、日志、临时目录和证据均隔离在仓库忽略目录 `out/external-validation/ollama/v0.32.5/`。服务只监听 `127.0.0.1:11435`，`OLLAMA_MODELS`、HOME、用户状态和临时目录均重定向到该目录；验收结束后已确认 Ollama 进程退出且端口关闭。

## 2. 可重复验收入口

脚本：`scripts/run_ollama_compatibility.js`。它拒绝非精确 `127.0.0.1:<port>/v1`、不匹配的服务版本或模型 manifest 摘要，以及仓库 `out/external-validation/ollama/` 之外的证据路径。

```powershell
node scripts/run_ollama_compatibility.js `
  --base-url http://127.0.0.1:11435/v1 `
  --model qwen3:4b `
  --expected-version 0.32.5 `
  --expected-model-digest 359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7 `
  --evidence out/external-validation/ollama/v0.32.5/compatibility-evidence-run4.json
```

脚本只使用构造的单条问题 `湖岸  稿件`；不读取用户稿件、项目、账号或凭据。证据不保存模型建议正文，只保存布尔判据、UTF-8 字节数和 SHA-256。

## 3. 最终通过场景

| 场景 | 结果 | 证据 |
|---|---|---|
| 服务与模型身份 | PASS | 服务 `0.32.5`；模型名、manifest digest、大小全部精确匹配 |
| APP 与规则身份 | PASS | APP `0.1.0-alpha.42`；规则包 2.0.0 / SHA-256 `098b382e…97a4`；`DOCX-SPACE-001` / `FIX-SPACE-001`；脚本 SHA-256 `07302187…d8eb` |
| 发送预览 | PASS | 生成完整预览时模型请求数为 0 |
| 明确确认后发送 | PASS | 请求数恰为 1；推理 17,893 ms；返回 `memory_only`、`automatic_writeback=false` |
| 人工接受 | PASS | `review_manuscript_modified=false`、`review_suggestion_persisted=false` |
| 缺失模型 | PASS | 稳定映射为 `AI_SERVICE_REJECTED`；旧 plan 重放为 `AI_PLAN_STALE`；无第二次请求 |
| 100 ms 超时 | PASS | 稳定映射为 `AI_SERVICE_TIMEOUT`；旧 plan 重放为 `AI_PLAN_STALE`；无第二次请求 |
| 建议质量窄判据 | PASS | 有界非空、识别连续空格、提出与“多余空格合并为一个”一致的修订动作、不声称已经改稿 |
| 隐私 | PASS | 只用匿名上下文；无用户稿件、账号或凭据；建议正文不持久化 |

最终证据文件 `compatibility-evidence-run4.json` 为 1,451 字节，SHA-256 `767197c5d2748f216b5006e85efb49ffbcb957b3e9dd9df88c4f5625320b0f98`。建议正文 123 字节，只记录其 SHA-256 `77281740387ec5f39419e53bc86db0052fed77a9e75c014418feafcc8dea284e`。

## 4. 中间记录与判据纠正

每轮记录保留而不覆盖：

- 初始 `compatibility-evidence.json`：1,151 字节，SHA-256 `3837c09e6445ddc035241437fe6bf7287cff496cc76f9415e7ded7c428199768`。协议与安全场景通过，但质量判据错误地要求完全无空格的“湖岸稿件”，与规则包“连续空格合并为一个空格”矛盾，因此按设计退出 1。
- 第二次 `compatibility-evidence-run2.json`：1,159 字节，SHA-256 `e6f68150f96824129004e5518e69ef4b80fc55b33e20244117f790a6ffd931a6`。协议与安全场景仍通过，但匿名上下文把规则说明缩写成“这里包含连续空格”，没有向模型提供真实规则语义；质量项继续失败，未计作产品通过。
- `compatibility-evidence-run3.json`：1,157 字节，SHA-256 `ede1e8ba1fa32c75f83c45e37006767345cf7d9a8d8217d05bf2bcad3e6d4d5b`。语义、安全和故障场景通过，但随后全文一致性扫描发现夹具仍使用不存在的 `CN-001`，且证据没有绑定 APP、规则包或脚本身份；因此 run3 只作中间记录，不作最终权威证据。
- 最终脚本直接读取当前规则包中的 `DOCX-SPACE-001`，并接受“合并连续空格”“删除多余空格”“保留一个空格”等语义等价表达，同时拒绝“删除所有空格”和“我已经修改”式越权陈述。单元测试 5/5、AI 定向回归 36/36、全量 Node 595 / Python 362 均零失败。

这里纠正的是验收夹具，不是放宽产品安全合同：预览零请求、一次确认、一次请求、失败计划消费、建议只在内存、不改稿和不持久化均未改变。

## 5. 未覆盖范围

- LM Studio、其他 OpenAI-compatible 产品与远程 HTTPS/TLS；
- 其他 Ollama 版本、模型、量化、CPU-only、低内存设备、macOS；
- 多规则、多语种、长上下文和真实作者稿件的建议质量；
- 真实 AI 凭据、生产账号、计费、湖岸 AI、官方 OpenAI/Anthropic/Gemini 协议；
- 安装包内自带 Ollama 或模型。本项目没有把 Ollama/模型加入 APP 安装包，也没有形成其再分发许可结论。

因此产品文案最多可以写“当前开发快照已验证 Ollama 0.32.5 + qwen3:4b 的一条匿名建议闭环”，不能写“全面支持 Ollama”或“AI 建议质量已完成验收”。
