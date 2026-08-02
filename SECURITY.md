# Security Policy

Oak Manuscript handles unpublished writing, so confidentiality, source integrity, local-first processing, and explicit network consent are core security properties rather than optional features.

## Supported versions

The repository is currently in alpha development. Security fixes are applied to the latest default-branch source only. Historical alpha tags, unsigned test installers, development branches, and locally modified builds are not supported release channels.

No current build should be treated as a signed, production-ready commercial release. See `docs/DEVELOPMENT_STATUS.md` and `docs/TEST_REPORT.md` for the exact evidence boundary.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub Private Vulnerability Reporting](https://github.com/Oak2521/Oak-Manuscript-App/security/advisories/new).

Do not open a public issue for an undisclosed vulnerability. Include, when possible:

- the affected commit, version, platform, and component;
- a concise impact statement and reproducible steps;
- a minimal synthetic test file, never a real unpublished manuscript;
- logs with manuscript text, paths, account identifiers, tokens, and secrets removed;
- any proposed mitigation or patch.

If private vulnerability reporting is unavailable, open a public issue containing only a request for a private reporting channel. Do not include exploit details.

Maintainers will acknowledge a complete report when it is reviewed, assess severity and affected boundaries, coordinate a fix and disclosure, and credit the reporter if requested. Because the project is not yet a staffed production service, no fixed response-time SLA is promised.

## High-priority security areas

Reports are especially valuable when they concern:

- source manuscript modification, disclosure, or unintended network transmission;
- path traversal, archive extraction, symlink, or arbitrary-file-write behavior;
- Electron sandbox, context isolation, CSP, navigation, or IPC boundary bypasses;
- command, argument, environment, or Python sidecar injection;
- standards-package signature, hash, rollback, revocation, or trust-anchor bypasses;
- account-session, entitlement, result-sync ownership, or consent bypasses;
- Web temporary-object retention, cross-account access, RLS, worker isolation, or cleanup failures;
- AI-provider credential leakage, prompt/content transmission without consent, or untrusted response execution;
- release artifact tampering, updater compromise, or packaging/provenance verification bypasses.

## Scope boundaries

Third-party services and dependencies should normally be reported to their respective maintainers unless Oak Manuscript uses them in a way that creates a project-specific vulnerability. Findings that require a user to deliberately disable documented security controls may receive lower priority, but they are still welcome when the resulting risk is unclear or surprising.
