# AGENTS.md: AppNutri

Canonical, tool-agnostic instructions for any AI agent (Claude Code, OpenCode, Codex CLI, or other) working in this repository. Read this before touching any file.

`plan.md` is the source of truth for the full architecture; this file is the operational summary. `.kiro/steering/` goes deeper on product, stack, and structure. `.kiro/specs/` is where every feature in development lives. `docs/adr/` is the permanent record of why significant architecture decisions were made.

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

Each phase requires explicit approval before moving to the next, and a clean adversarial `spec-grill` pass before it's even presented for approval. Use the `spec-plan` skill (`.agents/skills/spec-plan/SKILL.md`) to orchestrate this, or your tool's native plan mode if it has one (Claude Code). Implement already-approved tasks with the `task-runner` skill, committing with the `commit` skill as you go. Before closing a spec, run `spec-closeout`. Run `security-scan` before closing any spec that touches auth, patient data, or new dependencies. Once `spec-closeout` is clean, use the `pr-prep` skill to open the PR.

Hard rule: no code change without an approved task in `tasks.md` referencing a requirement. See `.agents/rules/spec-first.md`.

When a design decision has more than one genuinely defensible approach, run the `decision-debate` skill before settling it, and record the outcome as an ADR in `docs/adr/` with the `adr` skill; see `.agents/rules/adr-required.md`.

**When describing or starting this flow, name the exact files you are using.** If asked how you would approach a task, answer with the actual skill and persona file names below, not a paraphrase in your own words. A description of "I'd write requirements, then design, then tasks, with a critical review in between" without naming `spec-plan`, `spec-grill`, `decision-debate`, `adr`, `task-runner`, `commit`, `spec-closeout`, `pr-prep`, and the relevant persona files means those files were not actually read.

## Agent catalog

Each persona lives at `.agents/agents/<name>.md` and defines a specific checklist and area of ownership. Consult the relevant one(s) by name at the matching phase; don't improvise a generic review:

| Persona | When to consult |
|---|---|
| `developer` | Implementing any task from `tasks.md` |
| `nextjs-architect` | A new route, a rendering-strategy decision, or a data-heavy view needing a loading strategy |
| `database-architect` | Any Prisma schema change, migration, or new tenant-scoped table (including its RLS policy) |
| `design` | Any UI change, new screen, or animation |
| `qa` | After implementing a task, before `spec-closeout` |
| `security` | Anything touching auth, the Prisma schema, RLS, attachments, or a new dependency |
| `code-quality` | After implementing a task, before `reviewer` |
| `reviewer` | The final gate before `spec-closeout`, after the above have run |

Claude Code and OpenCode can invoke these as actual subagents. Codex CLI cannot; see Tool-specific notes below for how it applies them instead.

## Domain rules (always active)

- **Multi-tenant isolation**: every query on a tenant-scoped model (`Patient`, `Appointment`, `Consultation`, and similar) goes through the tenant-context wrapper (`withTenant`, see `plan.md` §3). Never write a manual `where` without `organizationId`. Detail: `.agents/rules/tenant-isolation.md`.
- **Contracts before code**: define the Prisma schema and Zod types before implementing the UI or logic that uses them. Detail: `.agents/rules/contracts-before-code.md`.
- **Never log PII or clinical data in plaintext**: patient names, clinical notes, measurement results never go to `console.log`/stdout. Access to clinical data is recorded in `AuditLog`, not application logs. Detail: `.agents/rules/no-plaintext-clinical-data.md`.
- **RBAC always server-side**: the role (`ADMIN`/`NUTRITIONIST`/`FRONT_DESK`) is verified in Server Actions/Route Handlers, never only by hiding UI on the client.
- **Body composition equations**: every new protocol is a self-contained module in `src/calc-engine/protocols/`; an existing protocol is never modified (traceability of already-calculated results, see `plan.md` §5).
- **pnpm only**: never `npm` or `yarn`, in code, CI, or docs. Detail: `.agents/rules/pnpm-only.md`.
- **Trunk-based development**: `main` is always deployable; every spec gets one short-lived branch (`<type>/<slug>`), created by `task-runner`, merged via `pr-prep`, deleted after merge. No direct commits to `main`, no long-lived branches. Detail: `.agents/rules/trunk-based.md`.

## Harness rules (how the agents themselves operate)

- `.agents/rules/agent-anti-patterns.md`: separation of duties, no self-review, no rubber-stamping, and other multi-agent failure modes to avoid.
- `.agents/rules/cost-optimization.md`: concise output, catch problems in the spec instead of after implementation, don't spawn what you can answer directly.
- `.agents/rules/human-escalation.md`: after 3 failed fix attempts on the same validation, stop and ask the user instead of trying a 4th variation.
- `.agents/rules/adr-required.md`: which decisions must get a permanent record in `docs/adr/`, and which don't.

## Commit convention

Conventional commits, in English, single-line message, no co-author:

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `style`, `perf`. See the `commit` skill (`.agents/skills/commit/SKILL.md`). Once a spec's tasks are all done and `spec-closeout` is clean, use the `pr-prep` skill (`.agents/skills/pr-prep/SKILL.md`) to open the PR.

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

- **Claude Code**: full support. Subagent personas in `.claude/agents/`, skills in `.claude/skills/`, rules in `.claude/rules/` (all symlinks into `.agents/`). See `CLAUDE.md`.
- **OpenCode**: full support. Subagent personas in `.opencode/agents/`, skills in `.opencode/skills/` (symlinks into `.agents/`).
- **Codex CLI**: supported natively. Codex reads this file (`AGENTS.md`) and scans `.agents/skills/` directly, with no symlink needed. Codex has no subagent concept, so it can't invoke `.agents/agents/*.md` as separate delegated agents the way Claude Code and OpenCode do. This does not mean skipping them: for every phase in the Agent catalog above, a Codex session must open and read the matching `.agents/agents/<name>.md` file, apply its checklist within the same session, and explicitly say "applying the `<name>` persona" before doing so. Naming the workflow in general terms (for example "I'd do a critical review of the spec") without opening and citing `spec-grill` and the relevant persona file(s) is not following this harness; it's a generic SDD description that happens to resemble it. If asked "how would you work this task" before any real work starts, still name every skill and every persona file that would apply, in order.

## Current repo state

Only the harness exists (docs, agents, rules, skills). There is no Next.js scaffold yet. Phase 0 (`plan.md` §8) is the first real implementation work and must start with a spec in `.kiro/specs/` following the flow above.
