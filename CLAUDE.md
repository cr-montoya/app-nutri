@AGENTS.md

# CLAUDE.md: Claude Code in AppNutri

The above (`AGENTS.md`) is the canonical source of instructions: stack, domain rules, commit convention, testing/security, and the Kiro-style SDD flow. What follows is specific to Claude Code.

## Plan mode vs. the `spec-plan` skill

Claude Code's native plan mode (`EnterPlanMode`/`ExitPlanMode`) serves the same purpose as the `spec-plan` skill: explore, design, and ask for approval before touching code. Use either one; they're interchangeable. The difference is that `spec-plan` leaves the result as versioned files in `.kiro/specs/<slug>/`, also readable by Codex and OpenCode; native plan mode is faster for changes that don't need to survive as a spec shared across tools.

## Available catalog

Everything lives in `.agents/` and is exposed here via symlink, a single place to maintain:

- **Agents** (`.claude/agents/`, subagents invokable with `Agent({ subagent_type: ... })`): `developer`, `design`, `qa`, `security`, `code-quality`, `reviewer`, `nextjs-architect`, `database-architect`.
- **Skills** (`.claude/skills/`): `spec-plan`, `spec-grill`, `task-runner`, `commit`, `spec-closeout`, `security-scan`, `pr-prep`.
- **Always-active rules** (`.claude/rules/`): `tenant-isolation`, `contracts-before-code`, `spec-first`, `no-plaintext-clinical-data`, `pnpm-only`, `agent-anti-patterns`, `cost-optimization`, `human-escalation`.

## Folder conventions (once the scaffold exists)

```
appnutri/
  prisma/schema.prisma
  src/
    app/                    # Next.js routes (App Router)
    components/ui/          # shadcn primitives
    components/charts/      # Recharts wrappers
    lib/db.ts                # tenant-context Prisma Client Extension
    lib/auth.ts              # Auth.js v5 configuration
    lib/rbac.ts               # role guards used in Server Actions
    lib/audit.ts              # audit logging wrapper
    server/actions/          # Server Actions by domain
    server/services/         # business logic
    calc-engine/              # body-composition equation engine (registry + protocols/)
    validation/                # Zod schemas shared client/server
```

## Running the project locally

_Pending until the Phase 0 scaffold exists (see `plan.md` §8)._ Once it does: `pnpm install`, environment variables in `.env.local` (never committed), `pnpm dev`, migrations with `pnpm exec prisma migrate dev`.
