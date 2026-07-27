# renderer/ — 本地桌面界面

Renderer 使用原生 HTML/CSS/JavaScript，实现欢迎、创建项目、检查配置、进度、问题处理、导出中心、标准资源与设置等页面。它运行在无 Node 权限的沙箱中，只能通过 `preload.js` 暴露的固定 `window.oak` API 请求主进程操作。

P0 批量修复界面遵循“计划—集中预览—一次确认”：Renderer 只能请求只读 `planFixes`，显示本批全部候选的标题、位置和修改前/后预览，再把 opaque `plan_id` 交给 `applyFixPlan`。取消、关闭或 Esc 都不写稿件；不存在绕开预览的直接 fix API。

`app.js` 中的 `window.__oakActions` 是按钮与自动化 smoke 共用的业务动作层，不是额外特权接口。最新沙箱外隐藏 Electron smoke 已通过真实 Renderer → preload → IPC → 固定 Python bootstrap 完成 DOCX/EPUB 的检查、集中预览、批量确认、恢复、重新修复、导出与验证；每次运行状态隔离在 `out/source-smoke/runs/<run-id>/`，两个真实项目均确认 core 版本、`source_hash_ok=true` 和 APP/项目/检查/报告七字段标准身份一致。

标准资源页会分别显示项目固定版本与当前全局版本。已有项目只有在用户打开完整差异并一次确认后才会升级；目标由主进程选择，Renderer 不能提交任意 digest。升级成功后清空旧问题状态并自动重检。界面提供本地签名包安装与全局回滚入口，但当前构建没有生产信任根，因此本地导入默认禁用；没有联网自动下载。这些源码闭环不等于打包版或可售卖发行证据，账号、订阅、同步、Web 与 macOS 仍未实现。

界面不加载远程页面或远程脚本；固定 CSP 阻止主动内容，主进程 default session 还会取消网络 scheme 请求。外部链接由主进程 HTTPS/域名白名单裁决并交给系统浏览器；未来联网 Provider 不得放宽 Renderer/default session。相关安全边界见 `docs/PRIVACY_AND_SECURITY.md`。
