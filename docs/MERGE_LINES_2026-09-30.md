# 合流记录（2026-09-30）

## 2026-09-30 合流审阅分支（非发行）

- 项目Issue #5；从main `c7bf0bea3782d419a558f5ed025fcd6283cb90c0`恢复38个逐文件审阅的快照文件，保留旧工作区与备份。
- 恢复Alpha.64的DOCX覆盖披露、协议资源白名单、撤回校验时钟修复，以及独立合成离线审阅/意见回导模块。未接入真实稿件、账号或上传，未打包或部署。
- 定向Node：43 total / 42 pass / 0 fail / 1 skip；统一npm test的Node阶段642 total / 616 pass / 23 fail / 3 skip。缺少Electron、构建/S3依赖及CPython/JRE/EpubCheck等本地运行时资源，全量门未通过；未改测试制造通过。
- Python分项372 total / 0 failures / 0 errors / 9 skips。资源信任只读校验通过：132文件 / 2249190字节；新增合成样本后按原构建器同步清单及信任锚，不伪造打包证据。
- 更正首批判断：实际project.py SHA与快照清单一致，没有此前声称的缺文件问题。38个导入文件中36个与快照字节一致，两个资源元数据文件额外纳入合成样本摘要。
- 内部文档与本机smoke工具未公开；9/27协作PR #4保持独立。两个待决定组及验证边界见docs/MERGE_LINES_2026-09-30.md。
- 下一步Claude审阅、站长决定与合并；source recovered，不等于packaged、deployed或production-ready。历史文档中的旧阶段结果不代表本次验证。

## 已恢复文件

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
- `config/tool-manifests/app-resources-v1.json`
- `electron/resource-trust-anchor.json`
- `electron/smoke.js`
- `package-lock.json`
- `package.json`
- `python/oak_manuscript_core/__init__.py`
- `python/oak_manuscript_core/format_coverage.py`
- `python/oak_manuscript_core/reports.py`
- `python/tests/test_reports_export.py`
- `renderer/format-coverage-model.js`
- `renderer/index.html`
- `scripts/windows_install_acceptance.js`
- `tests/ollama_compatibility.test.js`
- `tests/text_format_coverage_ui.test.js`
- `tests/windows_install_acceptance.test.js`
- `web/package-lock.json`
- `web/package.json`
- `python/tests/test_docx_coverage.py`

## 未合流与待决定

1. 内部计划、阶段报告、恢复设计、试点登记和规格/用户指南快照：未确认公开范围，原件保留。应否另存私有档案或抽取公开技术说明，由站长决定。
2. 两个本机专用smoke脚本：环境路径依赖，暂不公开，是否通用化另行决定。GUI smoke未运行。

AGENTS与9/27协作PR #4按任务要求独立审阅。既有商业版、Claude基线和账户线均已包含于main，不重复合并。未导入真实稿件、作者隐私或凭据。

## 可归档候选

只就提交历史：claude/user-service-app-plan-wkjns1、chatgpt/commercial-v1、codex/oak-10-manuscript-account三条分支已由main包含。未合流快照仍存在，不能把原工作区整体列为可归档；只建议、不删除。

## 修正记录

首批提交955d617保留了错误的project.py缺口判断。后续直接计算实际文件哈希并与快照逐项比较，发现完全一致；本次以普通追加提交修正，不改写历史。Alpha.64源码可合流，但不是发行验收完成。
