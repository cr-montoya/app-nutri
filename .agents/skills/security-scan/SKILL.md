---
name: security-scan
description: Runs the local security bundle (gitleaks, semgrep, pnpm audit once package.json exists) and summarizes findings against the OWASP checklist in docs/testing-and-security.md. Use it before closing a spec that touches auth, patient data, or new dependencies.
---

# Security Scan

## Process

1. Secrets: `gitleaks detect --source . --no-banner` (or `pre-commit run gitleaks --all-files` if `pre-commit` is installed).
2. SAST: `semgrep --config auto .` (or `pre-commit run semgrep --all-files`). Prioritize high and critical severity findings and OWASP Top 10 rules.
3. Dependencies: if `package.json` exists, `pnpm audit --audit-level=high`. If it doesn't exist yet, skip it and say so explicitly, don't report it as "no findings."
4. If the change touches tenant-scoped models, manually verify against `.agents/rules/tenant-isolation.md`: does every new query go through `withTenant`? Is there any `where` missing `organizationId`?
5. If the change touches logging, verify against `.agents/rules/no-plaintext-clinical-data.md`.

## Output

A summary per tool: high and critical findings (with file:line), medium and low findings (count only), and which checks were skipped and why. Map each high or critical finding to the corresponding OWASP category in `docs/testing-and-security.md`'s checklist when applicable.

Don't mark the scan as "clean" if a step was skipped because a tool wasn't installed. Say so explicitly, per `.agents/rules/agent-anti-patterns.md` on silent fallback.
