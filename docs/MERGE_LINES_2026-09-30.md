# 合流记录（2026-09-30）

## 2026-09-30 合流审阅分支（非发行）

- 项目 Issue #5；从 main `c7bf0bea3782d419a558f5ed025fcd6283cb90c0` 恢复20个已审阅快照文件。
- 恢复独立的合成离线审阅/意见回导模块、固定协议资源白名单修复及撤回验证时钟传递；未接入真实稿件、账号、上传、生产或已打包应用。
- 定向 Node：39 total / 38 pass / 0 fail / 1 skip。统一 `npm test`：Node 641 total / 615 pass / 23 fail / 3 skip，失败涉及缺少 Electron、构建/S3 等依赖及本地运行时资源；未改测试制造通过。该失败使统一入口未运行 Python，随后单独 `npm run test:python`：369 total / 0 failures / 0 errors / 9 skips。
- Alpha.64/DOCX覆盖及配套资源清单尚未合流：快照清单的 project.py 字节与 main 不同，而快照没有该文件，保留当前 main 信任链。版本保持 Alpha.63；离线演示中的 Alpha.64 是构造测试标记，不是已发行版本。
- 内部计划/阶段档案、试点材料及本机专用 smoke 脚本未公开；9/27 协作 PR #4 保持独立。详细公开范围、三组待决定事项见 `docs/MERGE_LINES_2026-09-30.md`。
- 下一步：Claude审阅与站长决定；仅由站长合并。源码合流不等于 packaged、deployed 或 production-ready。

## 已恢复快照文件

- `electron/app-protocol.js`
- `electron/standards-provider.js`
- `tests/app_protocol.test.js`
- `tests/standards_provider.test.js`
- `electron/offline-review-slice-preload.js`
- `electron/offline-review-slice.js`
- `renderer/offline-review-return.html`
- `renderer/offline-review-return.js`
- `renderer/offline-review.css`
- `renderer/offline-review.html`
- `renderer/offline-review.js`
- `samples/offline-review-synthetic.js`
- `shared/offline-review-browser.js`
- `shared/offline-review-core.js`
- `shared/offline-review-drafts.js`
- `shared/offline-review-package.js`
- `shared/offline-review-return.js`
- `tests/offline_review_package.test.js`
- `tests/offline_review_return.test.js`
- `tests/offline_review_s2.test.js`

## 未合流与待决定

1. 内部方案、恢复设计、试点登记、阶段关闭文档与历史状态快照：公开性尚未确认，原件保留，不复制内部正文。是否另存私有档案由站长决定。
2. Alpha.64/DOCX覆盖整组：缺少资源清单指向的 project.py 快照，不能拼造发行信任证据；保留主线相应文件，待找回完整来源再评估。版本号、发行清单、trust anchor、旧测试和界面覆盖保持成套主线状态。
3. 两个本机 smoke 工具：本机环境路径依赖，不随此次公开；未来是否通用化另行决定。GUI smoke未运行。

9/27规则/AGENTS协作线按总任务明令排除，不是待合并功能。所有旧提交线已在main内，未导入额外商业历史。现行版本仍Alpha.63。

## 可归档候选

仅就已提交历史，`claude/user-service-app-plan-wkjns1`、`chatgpt/commercial-v1`、`codex/oak-10-manuscript-account` 三条线已被main包含，可列分支归档候选。仍有未并快照的工作区不能视为可整体归档；这里只列候选，不删除、不改名。

## 验证边界

全量门未通过；具体计数见上方。未安装新运行时或第三方依赖，没有打包、真实安装/升级、真实账号、签名或部署。测试使用匿名构造样本。导入的是救援时原测试，不是为让失败通过而改测试。

