# renderer/ — 本地桌面界面

Renderer 使用原生 HTML/CSS/JavaScript，实现欢迎、创建项目、检查配置、进度、问题处理、导出中心、标准资源与设置等页面。它运行在无 Node 权限的沙箱中，只能通过 `preload.js` 暴露的固定 `window.oak` API 请求主进程操作。

P0 批量修复界面遵循“计划—集中预览—一次确认”：Renderer 只能请求只读 `planFixes`，显示本批全部候选的标题、位置和修改前/后预览，再把 opaque `plan_id` 交给 `applyFixPlan`。取消、关闭或 Esc 都不写稿件；不存在绕开预览的直接 fix API。

检查同样先走引用计划：`planCitationResolution` 返回体例/模式、理由、置信度、纯数量证据和实际覆盖规则；用户确认后才由 `runCheck` 携带 opaque `citation_plan_id`。选“默认”且证据不足时界面明确显示 `structure_only`，不猜测具体体例。切换稿件或项目目录会清空上一项目的 session、计划与结果，防止连续处理多稿时串项目。

账号入口保留在欢迎页、导出页和设置页。生产认证未配置时，界面明确说明不联网；测试模拟状态不暴露给生产 Renderer。只有登录用户导出后才出现 SyncRecord v1 逐字段预览；四个选择通过 opaque 幂等 ID 确认，Renderer 不能提交任意负载。预览显示主进程判定的 transport 状态；用户明确选择同步后，有 transport 就立即发送，成功、失败留队和仅本机排队分别显示，登录本身不发送。负载和队列使用 `textContent`/`replaceChildren` 渲染，不插入 HTML；设置页只显示当前账号的 OS 加密本机队列，可取消、重试、删除。只有主进程报告 transport 已配置时才显示逐项“发送到网站/确认重试并发送”。

alpha.44 在设置页增加“刷新订阅权益”。按钮只有当前已登录且主进程报告生产权益 transport 已配置时才可用，并明确提示这是一次网络请求；普通状态渲染不联网。Renderer 只调用无参数 refresh IPC，不能提供 token、设备 ID、端点、公钥或权益对象。刷新失败只更新安全状态提示，不影响本地项目。

`app.js` 中的 `window.__oakActions` 是按钮与自动化 smoke 共用的业务动作层，不是额外特权接口。当次 source/packaged 隐藏 smoke 必须通过真实 Renderer → preload → IPC → 固定 Python bootstrap 完成 DOCX/EPUB 的引用计划确认、检查、湖岸 AI 单条发送预览/transport 缺席禁用/取消零发送、集中修复、恢复、重新修复、导出与验证，并用第二进程恢复同一 OS 加密队列。compatible 三类可在逐条确认后返回建议；失败时保留安全提示，把旧计划清除并只允许重新生成零请求预览，再次确认前不会重发。alpha.43 的 LM Studio 响应模型核对完全位于主进程，不把上游响应或模型选择权交给 Renderer。采纳/放弃均不保存模型文本或改稿。动态版本、计数和运行根不写入 ASAR，准确证据以仓库 `docs/TEST_REPORT.md` 为准。

标准资源页会分别显示项目固定版本与当前全局版本。已有项目只有在用户打开完整差异并一次确认后才会升级；目标由主进程选择，Renderer 不能提交任意 digest。alpha.57 另把规则审阅状态与来源核验分列，并从主进程治理摘要显示精确计数；`active` 只写作“规则已启用”，门禁未完成时不得显示“完整”。升级成功后清空旧问题状态并自动重检。界面提供本地签名包安装与全局回滚入口，但当前构建没有生产信任根，因此本地导入默认禁用；没有联网自动下载。这些源码闭环不等于打包版或可售卖发行证据；生产账号/订阅、已部署 Web UI/服务与 macOS 仍未实现。alpha.39 的账号和同步网络只存在于条件主进程边界，不进入 Renderer 或 default session；默认配置下界面继续把队列标为未上传。

界面不加载远程页面或远程脚本；固定 CSP 阻止主动内容，主进程 default session 还会取消网络 scheme 请求。外部链接由主进程 HTTPS/域名白名单裁决并交给系统浏览器；未来联网 Provider 不得放宽 Renderer/default session。相关安全边界见 `docs/PRIVACY_AND_SECURITY.md`。
