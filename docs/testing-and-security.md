# Testing and security: actionable guide

Operational version of `plan.md` §9. Use it to decide which command to run and which gates apply to a given change.

## Commands

Already active, with no dependency on `package.json`:

| Command | What it does |
|---|---|
| `pre-commit run --all-files` | gitleaks + semgrep over the whole repo (see `.pre-commit-config.yaml`) |
| `pre-commit run gitleaks --all-files` | Secret scanning only |
| `pre-commit run semgrep --all-files` | SAST only |

Active from Phase 0 (once `package.json`/the Next.js scaffold exists). All commands use `pnpm`; see `.agents/rules/pnpm-only.md`.

| Command | What it does |
|---|---|
| `pnpm test` | Vitest + React Testing Library |
| `pnpm test:e2e` | Playwright |
| `pnpm lint` | ESLint + `eslint-plugin-security` |
| `pnpm scan:sast` | Semgrep (OWASP Top 10 + JS/TS/React rules) |
| `pnpm scan:secrets` | gitleaks |
| `pnpm scan:deps` | `pnpm audit --audit-level=high` |
| `pnpm sbom` | SBOM in CycloneDX via `pnpm dlx @cyclonedx/cyclonedx-npm` |

DAST (OWASP ZAP Baseline Scan) runs in CI against the Vercel preview deployment, never locally; it requires a deployed environment. Activates alongside `ci.yml` in Phase 0.

## Gate matrix

| Change type | Required gates |
|---|---|
| Prisma schema change / new tenant-scoped table / migration | Database Architect, Security, Reviewer |
| Multi-tenant / auth / RLS / roles | Security, Reviewer, QA |
| Clinical history / measurements / attachments | Security, QA, Reviewer |
| New `calc-engine` protocol | Reviewer, QA (unit test against a reference calculation required) |
| New route / rendering-strategy change | Next.js Architect (consult), QA |
| UI / animation / new screen | Design, QA, Code Quality |
| New design component/primitive | Design, Code Quality, Reviewer |
| CI/CD / infra / dependencies | Security, Reviewer |
| Docs / specs only | Reviewer optional |
| Bug fix | QA, Code Quality, Reviewer |

## Definition of Ready (a spec under `.kiro/specs/<slug>/`)

- `requirements.md` has an objective, scope/out-of-scope, and verifiable EARS criteria, explicitly approved, with a clean `spec-grill` pass.
- `design.md` references every `REQ-XXX` and defines the contracts (Prisma schema, Zod) if the feature introduces or modifies an entity, explicitly approved, with a clean `spec-grill` pass.
- `tasks.md` has tasks with stable IDs, a reference to requirements, and an exact validation command, explicitly approved.

## Definition of Done

- Every task in `tasks.md` is `[x]` or `[BLOCKED]` with a documented reason, per `.agents/rules/human-escalation.md`.
- Every `REQ-XXX` has at least one green validation (`spec-closeout` confirms this).
- Gates from the table above run per the change type, with no unresolved high/critical findings.
- No secrets detected by gitleaks.
- Any deviation between `design.md` and the actual implementation is explicitly documented.
- No agent that produced a change also approved it; see `.agents/rules/agent-anti-patterns.md`.

## OWASP checklist (reference, mapped to controls already present in the architecture)

| OWASP Top 10 | Control in AppNutri |
|---|---|
| A01 Broken Access Control | Server-side RBAC (`src/lib/rbac.ts`) + Postgres RLS |
| A02 Cryptographic Failures | argon2id for passwords, TLS/HSTS, field-level encryption evaluation for clinical notes (Phase 5) |
| A03 Injection | Prisma (parameterized queries), Zod at the boundary |
| A04 Insecure Design | SDD with Security/Reviewer gates before closing any sensitive spec |
| A05 Security Misconfiguration | Secrets only in Vercel environment variables, never in the client bundle |
| A07 Auth Failures | argon2id, rate limiting on auth routes, `tokenVersion` to invalidate sessions |
| A08 Data Integrity Failures | `BodyCompositionResult` is never overwritten (traceability of the protocol used) |
| A09 Logging/Monitoring Failures | `AuditLog` for every clinical access/mutation; never PII in application logs |
| A10 SSRF | N/A until outbound integrations exist; revisit if one is added |
