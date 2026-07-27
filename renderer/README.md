# renderer/ — 本地桌面界面

Renderer 使用原生 HTML/CSS/JavaScript，实现欢迎、创建项目、检查配置、进度、问题处理、导出中心、标准资源与设置等页面。它运行在无 Node 权限的沙箱中，只能通过 `preload.js` 暴露的固定 `window.oak` API 请求主进程操作。

P0 批量修复界面遵循“计划—集中预览—一次确认”：Renderer 只能请求只读 `planFixes`，显示本批全部候选的标题、位置和修改前/后预览，再把 opaque `plan_id` 交给 `applyFixPlan`。取消、关闭或 Esc 都不写稿件；不存在绕开预览的直接 fix API。

`app.js` 中的 `window.__oakActions` 是按钮与自动化 smoke 共用的业务动作层，不是额外特权接口。最新沙箱外隐藏 Electron smoke 已通过真实 Renderer → preload → IPC → 固定 Python bootstrap 完成 DOCX/EPUB 的检查、集中预览、批量确认、恢复、重新修复、导出与验证；所有状态位于 `out/source-smoke/`，两个真实项目均确认 core 版本和 `source_hash_ok=true`。这证明的是源码 UI 闭环，不是打包版或可售卖发行证据。当前界面仍不代表账号、订阅、同步、Web 或 macOS 已实现。

界面不加载远程页面或远程脚本；固定 CSP 阻止主动内容，主进程 default session 还会取消网络 scheme 请求。外部链接由主进程 HTTPS/域名白名单裁决并交给系统浏览器；未来联网 Provider 不得放宽 Renderer/default session。相关安全边界见 `docs/PRIVACY_AND_SECURITY.md`。
