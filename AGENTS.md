# AGENTS.md — AppNutri

Canonical, tool-agnostic instructions for any AI agent (Claude Code, OpenCode, Codex CLI, or other) working in this repository. Read this before touching any file.

`plan.md` is the source of truth for the full architecture — this file is the operational summary. `.kiro/steering/` goes deeper on product/stack/structure; `.kiro/specs/` is where every feature in development lives.

## What AppNutri is

Multi-tenant SaaS platform for nutrition professionals: patients, appointments, clinical history, anthropometric measurements with multiple body-composition equations by population, nutritional plans, and evolution charts. Sensitive clinical data — security and isolation between organizations are non-negotiable.

## Stack

| Area | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| Database | Postgres on Neon |
| ORM | Prisma |
| Auth | Auth.js v5 (Credentials + argon2id, JWT) |
| Files | Vercel Blob |
| UI | Tailwind v4 + shadcn/ui + Framer Motion |
| Charts | Recharts |
| Calendar | FullCalendar |
| Forms | React Hook Form + Zod |

Full detail and rationale for each choice: `plan.md` §2, `.kiro/steering/tech.md`.

## How a feature gets built (Kiro-style SDD)

No code is written without an approved spec. The flow:

1. **Requirements** → `.kiro/specs/<slug>/requirements.md` (EARS format, user stories).
2. **Design** → `.kiro/specs/<slug>/design.md` (feature architecture).
3. **Tasks** → `.kiro/specs/<slug>/tasks.md` (checklist with stable IDs and a validation command per task).

Each phase requires explicit approval before moving to the next. Use the `spec-plan` skill (`.agents/skills/spec-plan/SKILL.md`) to orchestrate this, or your tool's native plan mode if it has one (Claude Code). Implement already-approved tasks with the `task-runner` skill. Before closing a spec, run `spec-closeout`.

Hard rule: no code change without an approved task in `tasks.md` referencing a requirement. See `.agents/rules/spec-first.md`.

## Domain rules (always active)

- **Multi-tenant isolation**: every query on a tenant-scoped model (`Patient`, `Appointment`, `Consultation`, etc.) goes through the tenant-context wrapper (`withTenant`, see `plan.md` §3). Never write a manual `where` without `organizationId`. Detail: `.agents/rules/tenant-isolation.md`.
- **Contracts before code**: define the Prisma schema and Zod types before implementing the UI or logic that uses them. Detail: `.agents/rules/contracts-before-code.md`.
- **Never log PII or clinical data in plaintext**: patient names, clinical notes, measurement results never go to `console.log`/stdout. Access to clinical data is recorded in `AuditLog`, not application logs. Detail: `.agents/rules/no-plaintext-clinical-data.md`.
- **RBAC always server-side**: the role (`ADMIN`/`NUTRITIONIST`/`FRONT_DESK`) is verified in Server Actions/Route Handlers, never only by hiding UI on the client.
- **Body composition equations**: every new protocol is a self-contained module in `src/calc-engine/protocols/`, an existing protocol is never modified (traceability of already-calculated results — see `plan.md` §5).

## Commit convention

Conventional commits, in English, single-line message, no co-author:

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `style`, `perf`. See `.agents/commands/commit.md`.

## Testing and security

Full strategy in `docs/testing-and-security.md` (gate matrix, Definition of Ready/Done) and `plan.md` §9. Target commands (active from Phase 0, once `package.json` exists):

| Command | What it does |
|---|---|
| `npm test` | Vitest + React Testing Library |
| `npm run test:e2e` | Playwright |
| `npm run lint` | ESLint + `eslint-plugin-security` |
| `npm run scan:sast` | Semgrep |
| `npm run scan:secrets` | gitleaks |
| `npm run scan:deps` | `npm audit --audit-level=high` |
| `npm run sbom` | SBOM in CycloneDX |

Already active, with no dependency on `package.json`: `pre-commit` hooks (gitleaks + semgrep, see `.pre-commit-config.yaml`) and the `.github/workflows/security.yml` workflow.

## Current repo state

Only the harness exists (docs, agents, rules, skills) — there is no Next.js scaffold yet. Phase 0 (`plan.md` §8) is the first real implementation work and must start with a spec in `.kiro/specs/` following the flow above.
