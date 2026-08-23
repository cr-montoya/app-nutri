# AGENTS.md: AppNutri

Canonical, tool-agnostic instructions for any AI agent (Claude Code, OpenCode, Codex CLI, or other) working in this repository. Read this before touching any file.

`plan.md` is the source of truth for the full architecture; this file is the operational summary. `.kiro/steering/` goes deeper on product, stack, and structure. `.kiro/specs/` is where every feature in development lives.

## What AppNutri is

Multi-tenant SaaS platform for nutrition professionals: patients, appointments, clinical history, anthropometric measurements with multiple body-composition equations by population, nutritional plans, and evolution charts. Sensitive clinical data: security and isolation between organizations are non-negotiable.

## Stack

| Area | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| Database | Postgres on Neon |
| Package manager | pnpm only |
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

1. **Requirements** in `.kiro/specs/<slug>/requirements.md` (EARS format, user stories).
2. **Design** in `.kiro/specs/<slug>/design.md` (feature architecture).
3. **Tasks** in `.kiro/specs/<slug>/tasks.md` (checklist with stable IDs and a validation command per task).

Each phase requires explicit approval before moving to the next, and a clean adversarial `spec-grill` pass before it's even presented for approval. Use the `spec-plan` skill (`.agents/skills/spec-plan/SKILL.md`) to orchestrate this, or your tool's native plan mode if it has one (Claude Code). Implement already-approved tasks with the `task-runner` skill. Before closing a spec, run `spec-closeout`.

Hard rule: no code change without an approved task in `tasks.md` referencing a requirement. See `.agents/rules/spec-first.md`.

## Domain rules (always active)

- **Multi-tenant isolation**: every query on a tenant-scoped model (`Patient`, `Appointment`, `Consultation`, and similar) goes through the tenant-context wrapper (`withTenant`, see `plan.md` §3). Never write a manual `where` without `organizationId`. Detail: `.agents/rules/tenant-isolation.md`.
- **Contracts before code**: define the Prisma schema and Zod types before implementing the UI or logic that uses them. Detail: `.agents/rules/contracts-before-code.md`.
- **Never log PII or clinical data in plaintext**: patient names, clinical notes, measurement results never go to `console.log`/stdout. Access to clinical data is recorded in `AuditLog`, not application logs. Detail: `.agents/rules/no-plaintext-clinical-data.md`.
- **RBAC always server-side**: the role (`ADMIN`/`NUTRITIONIST`/`FRONT_DESK`) is verified in Server Actions/Route Handlers, never only by hiding UI on the client.
- **Body composition equations**: every new protocol is a self-contained module in `src/calc-engine/protocols/`; an existing protocol is never modified (traceability of already-calculated results, see `plan.md` §5).
- **pnpm only**: never `npm` or `yarn`, in code, CI, or docs. Detail: `.agents/rules/pnpm-only.md`.

## Harness rules (how the agents themselves operate)

- `.agents/rules/agent-anti-patterns.md`: separation of duties, no self-review, no rubber-stamping, and other multi-agent failure modes to avoid.
- `.agents/rules/cost-optimization.md`: concise output, catch problems in the spec instead of after implementation, don't spawn what you can answer directly.
- `.agents/rules/human-escalation.md`: after 3 failed fix attempts on the same validation, stop and ask the user instead of trying a 4th variation.

## Commit convention

Conventional commits, in English, single-line message, no co-author:

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `style`, `perf`. See `.agents/commands/commit.md`.

## Testing and security

Full strategy in `docs/testing-and-security.md` (gate matrix, Definition of Ready/Done) and `plan.md` §9. Target commands (active from Phase 0, once `package.json` exists), all via `pnpm`:

| Command | What it does |
|---|---|
| `pnpm test` | Vitest + React Testing Library |
| `pnpm test:e2e` | Playwright |
| `pnpm lint` | ESLint + `eslint-plugin-security` |
| `pnpm scan:sast` | Semgrep |
| `pnpm scan:secrets` | gitleaks |
| `pnpm scan:deps` | `pnpm audit --audit-level=high` |
| `pnpm sbom` | SBOM in CycloneDX |

Already active, with no dependency on `package.json`: `pre-commit` hooks (gitleaks + semgrep, see `.pre-commit-config.yaml`) and the `.github/workflows/security.yml` workflow.

## Tool-specific notes

- **Claude Code**: full support. Subagent personas in `.claude/agents/`, skills in `.claude/skills/`, commands in `.claude/commands/`, rules in `.claude/rules/` (all symlinks into `.agents/`). See `CLAUDE.md`.
- **OpenCode**: full support. Subagent personas in `.opencode/agents/`, skills in `.opencode/skills/`, commands in `.opencode/commands/` (symlinks into `.agents/`).
- **Codex CLI**: supported natively. Codex reads this file (`AGENTS.md`) and scans `.agents/skills/` directly, with no symlink needed. Codex has no subagent concept, so it can't invoke `.agents/agents/*.md` as separate delegated agents the way Claude Code and OpenCode do; instead, when a task calls for a specific perspective (for example a security or design pass), a Codex session should explicitly read the relevant file under `.agents/agents/` and adopt that persona's checklist within the same session, then say which persona it's applying.

## Current repo state

Only the harness exists (docs, agents, rules, skills). There is no Next.js scaffold yet. Phase 0 (`plan.md` §8) is the first real implementation work and must start with a spec in `.kiro/specs/` following the flow above.
