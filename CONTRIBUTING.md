# Contributing to Oak Manuscript

Thank you for helping improve Oak Manuscript. The project welcomes focused bug reports, tests, documentation, standards research, and code contributions.

The single source of collaboration rules is [`AGENTS.md`](AGENTS.md) (branch naming `<ai>/<issue>-<topic>`, no direct pushes to `main`, cross-review, merge approval, and hand-off). This guide only summarizes contribution expectations and does not override it. Current status: [`AI_HANDOFF.md`](AI_HANDOFF.md). Module map: [`docs/功能地图.md`](docs/功能地图.md). Use the [pull request template](.github/pull_request_template.md).

## Before you start

- Read `AGENTS.md` and `AI_HANDOFF.md` (the only current-state file) before changing code; `docs/DEVELOPMENT_STATUS.md` and `docs/TEST_REPORT.md` are historical detail and evidence, not current state.
- Use only synthetic or explicitly anonymized manuscripts. Never commit unpublished manuscripts, author identities, credentials, contracts, payment data, private endpoints, or production keys.
- Open an issue before a large architectural change, a new network capability, a new dependency, or a change to privacy and source-integrity guarantees.
- Keep ordinary builds and tests offline. Any network operation must be explicit and must not upload manuscript content by default.

## Development setup

Requirements:

- Node.js 22.12 or later
- Python 3.11 or later
- Windows for current packaged-runtime verification; macOS builds are configured but require native macOS verification

```bash
npm ci
npm test
npm start
```

The Python checking core intentionally uses the standard library only. The Web service has a separate dependency boundary under `web/`.

## Contribution workflow

1. Open or pick an issue, then create a focused branch named `<ai-or-user>/<issue>-<topic>` from the current default branch.
2. Add or update tests before changing behavior when practical.
3. Preserve source-file immutability. Generated revisions belong only in project `working/`, `checkpoints/`, or `exports/` locations.
4. Run the relevant Node and Python tests during development.
5. Before opening a pull request, run checks proportional to the change risk (see `AGENTS.md` §5 rule 5 and README "最小检查"):
   - Code or behavior changes: run the full suite (`npm test`) plus `git diff --check`.
   - Documentation or collaboration-config-only changes: run `git diff --check`, `node --test tests/feature-map.test.js tests/doc-links.test.js tests/workflow-action-pins.test.js`, and any config verification the change affects; the unrelated full suite is not required.
   - The full suite depends on local runtime resources (Electron, CPython, JRE, EpubCheck, etc.). If any check could not run or was skipped, say so explicitly in the PR — never record it as passed.

6. Update `AI_HANDOFF.md` (current state) and `CHANGELOG.md`, and append detail/evidence to `docs/DEVELOPMENT_STATUS.md` and `docs/TEST_REPORT.md`, when implementation, verification, packaging, deployment, or release status changes.

## Rules and mechanical fixes

A proposed checking rule must include:

- a stable rule identifier and a clear evidence basis;
- positive examples, counterexamples, and format coverage;
- tests for false positives and mixed Chinese/English text where relevant;
- an honest governance state when its external standard has not been independently verified.

Automatic fixes are restricted to the explicit mechanical-fix allowlist. A fixer must be deterministic, idempotent, previewable as discrete edits, covered by source-hash invariance tests, and applied only after one centralized user confirmation. Semantic rewriting does not belong in the mechanical fixer.

## Security and privacy

Follow `SECURITY.md` for vulnerability reports. Security-sensitive pull requests should avoid public proof-of-concept details until a fix is available. Do not weaken Electron isolation, IPC validation, path containment, archive handling, standard-package signature checks, or explicit-consent network boundaries without a documented threat analysis and negative tests.

## Pull request checklist

- [ ] The change has a single, clear purpose.
- [ ] No real manuscript, personal data, credential, or production secret is included.
- [ ] New behavior has positive and negative tests.
- [ ] Source manuscripts remain byte-for-byte unchanged.
- [ ] Checks appropriate to the change risk were run and pass (`npm test` for code changes); any check not run or skipped is listed explicitly.
- [ ] Status documentation distinguishes implemented, tested, packaged, deployed, and production-ready.
- [ ] User-visible Chinese text and English documentation are updated where applicable.

By intentionally submitting a contribution for inclusion in this repository, you agree that it is licensed under the Apache License 2.0, as described in `LICENSE`.
