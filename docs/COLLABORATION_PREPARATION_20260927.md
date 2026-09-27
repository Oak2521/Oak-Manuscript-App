# GitHub collaboration preparation — 2026-09-27

## Scope and identity

- Repository: https://github.com/Oak2521/Oak-Manuscript-App ; owner is authenticated personal account `Oak2521`, visibility **public**, default **main**.
- The user explicitly approved this reviewed collaboration branch/PR to the existing public repository. No visibility change, feature, new repository, release or automatic merge.
- Accepted remote baseline: `c7bf0bea3782d419a558f5ed025fcd6283cb90c0`, product `0.1.0-alpha.63`.
- Delivery branch: `chore/github-collaboration-20260927`; exact commit is the PR head (this document cannot embed its own future SHA).
- PR: pending creation after local review and safety checks.

## Existing local work and authoritative scope

The product checkout remains `D:\Workspace\Oak Manuscript GPT\Oak Manuscript Commercial\repo`.
App metadata `E:\Project\Oak-Manuscript` and the mixed parent workspace are not upload roots.
This branch uses its isolated worktree `out/collaboration-20260927` inside the product checkout;
the product has not been relocated.

The original checkout starts on `codex/oak-10-manuscript-account`,
`255ba55f1d9051d381a4cbb047316200ec2d9c5b`, with **58** modified/untracked files.
They include alpha.64 and R2 offline-review/return work, preserved and excluded from this PR.
Local documents report alpha.64 Windows and S2 verification; this batch does not certify those
claims or turn source presence into S3 acceptance.

Original-checkout `docs/计划/PLAN-5P-20260911-015-R2.0.md` holds the approved R2 record,
including multi-project material and private approval quotations: keep it local, do not publish wholesale.
Project-only decision: retain Electron/Python desktop; mobile work starts with offline report review
and opinion drafts, not automatic manuscript changes or server uploads. A mobile reader is not a mobile checker.
The full historical five-platform draft is likewise excluded. This summary grants no new development approval.
Shareable commercial v2.0, schemas, architecture, tests, locks and synthetic samples already exist on GitHub.

## Entry points

1. [AGENTS.md](../AGENTS.md): sole common rules, ownership, branches, PRs and approval gates.
2. [AI_HANDOFF.md](../AI_HANDOFF.md): batch, baseline, local candidates and next step.
3. [README.md](../README.md): purpose, structure and commands.
4. [DEVELOPMENT_STATUS](DEVELOPMENT_STATUS.md), [TEST_REPORT](TEST_REPORT.md), [ACCEPTANCE](ACCEPTANCE.md).
5. [commercial v2.0](湖岸稿件_Oak_Manuscript_商业正式版开发方案_v2.0_ChatGPT_20260726.md),
   [ARCHITECTURE](ARCHITECTURE.md), [SPEC_MODELS](SPEC_MODELS.md),
   [account contract provenance](../config/contracts/oak-account/1.0/provenance.json), [Web README](../web/README.md).

[CLAUDE.md](../CLAUDE.md) only imports common rules and points to handoff.
[CONTRIBUTING.md](../CONTRIBUTING.md) and [PR template](../.github/pull_request_template.md)
provide navigation/submission fields, not duplicate policies.

## Runtime, setup and platform limits

Run commands at the assigned checkout/worktree root containing `package.json`.
Existing CI pins **Node 24.16.0 / Python 3.13.14**; documented floors are Node 22.12+ / Python 3.11+.
This local documentation check uses Windows and Node 24.16.0; Python 3.14.6 was detected but
its suite was not run, so detection is not a compatibility claim.

| Purpose | Existing command | Boundary |
|---|---|---|
| Desktop dependencies | `npm ci` | Root lock; network/download permission needed; not run this batch |
| Optional Web dependencies | `npm ci --prefix web` | Separate Web lock; Web work only |
| Minimal docs/config check | `node --test tests/hosted_ci_workflow.test.js`; `npm run verify:hosted-ci`; `git diff --check` | No dependency installation needed |
| Hosted source checks | `npm run test:hosted` | Existing Linux/Windows CI; not full runtime/package proof |
| Full local regression | `npm test` | Relevant product changes; some tests require provisioned local resources |
| Desktop launch | `npm start` | Electron/UI/platform resources required; not run here |
| Windows package | `npm run build:win` | Approved Windows resources; not rebuilt/installed/signed here |
| Mac package | `npm run build:mac:x64` / `npm run build:mac:arm64` | Matching Mac/runtime required; not verified here |

Python core uses stdlib, no pip setup. Provisioning references: [USER_GUIDE](USER_GUIDE.md).
Do not download SDKs or change trust anchors merely to make cloud checks green.
Mobile native builds/devices, Mac signing/notarization, Windows install lifecycle, real accounts/data,
staging/production and zero retention need separate evidence and approvals.

## Tool readiness (checked 2026-09-27)

| Tool | Verified | Not verified / required |
|---|---|---|
| Codex here | Shared rules read, isolated local worktree, authenticated GitHub read access | Other cloud environments and repo scopes are not inherited |
| Claude | Local launcher exists; pointer prepared; official Code docs describe imports | No Claude model session, rule-load test, cloud repo authorization or writeback test |
| Muse | Official **Meta Muse Code** docs describe AGENTS.md lookup after workspace trust | No `muse` executable on PATH; user's exact Muse product/version unconfirmed; no login/trust/repo/writeback test |

Sources: [Claude Code imports](https://code.claude.com/docs/en/memory),
[Meta Muse Code configuration](https://dev.meta.ai/docs/muse-code/configuration).
Documentation is not proof of this user's connection. Other products named Muse are not covered.
Each tool must report loaded rules, baseline SHA and permitted write paths; do not assume messages
or instructions are automatically received. No tools installed/configured or paid model calls made.

## Safety review and exclusions

Read-only preflight inspected **92 commits / 2,482 blob objects** reachable from the remote baseline,
and **501** baseline files. Pattern checks cover private-key headers, common provider/GitHub tokens,
credential URLs, literal secret assignments, JWT-shaped literals and sensitive names.
Candidates were synthetic smoke tokens, public-key placeholders and credential-rejection tests;
no confirmed live secret found within that scope. This bounded heuristic is not proof against all
encoded secrets or an audit of other branches, deleted refs, LFS or service secrets.
Existing binary fixtures are documented synthetic samples; icons/fixtures are not new uploads.
No customer manuscript/database or runtime user-data directories were traversed.

Ignore additions cover environment values, private keys/certificates, personal tool state,
databases/data, worktrees and the two full local approval documents.
Ignored dependencies/resources/out/release remain local; ignore rules cannot remove tracked secrets.
No new large media, LFS, service platform or paid dependency.

Local-only locations stay in place:

- `out/`, `release/`: generated evidence/packages; separately sanitize any evidence to share.
- `tools/`, `python-runtime/`, `python-runtime-macos-*/`, `node_modules/`: provision under existing manifests/locks and permission gates.
- `local_projects/`, `real_manuscripts/`, runtime user-selected roots: not read/uploaded, specific data authorization required.
- Full local R2/draft plans above: controlled approval records; publish only a separately reviewed project-only specification.

## Verification and next step

- Baseline Hosted-workflow test: **3/3 pass**, no skips, Node 24.16.0.
- Final local checks: Hosted-workflow tests **3/3**, workflow verifier `ok=true`, diff whitespace check passed.
- All **11** delivery files checked for LF/trailing whitespace; **45** relative links resolve;
  **13** sensitive/local path cases are ignored and **6** intended source/example cases remain eligible.
- Product source, package/lock files and existing CI are byte-unchanged from the baseline.
- Original checkout: all **58** baseline modified/untracked files retain their SHA-256;
  branch/HEAD unchanged and index empty. This proves this batch's preservation, not earlier history.
- Final precommit worktree safety pass covers **504** files and introduces no new suspicious match;
  only the reviewed synthetic historical fixtures match. Remote readback will be attached to the PR after publication.
- Existing main protection read: both Linux/Windows source contexts required, enforce_admins=true,
  force pushes/deletions disabled, required approving reviews=0. No settings changed.
- Human merge approval still applies although GitHub does not enforce an approving-review count.
- Review this PR, then an applicable approver decides merge. Separately reconcile the original local
  candidate work; do not discard it, claim it uploaded, or start features under this preparation.
