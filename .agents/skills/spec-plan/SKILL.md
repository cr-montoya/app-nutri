---
name: spec-plan
description: Orchestrates the Kiro-style Spec-Driven Development flow for a new feature or non-trivial change. Requirements (EARS), then Design, then Tasks, with an adversarial spec-grill pass and explicit user approval at each phase. Use it before writing any code for work that isn't a trivial one-line fix.
---

# Spec Plan (Kiro-style)

## Purpose

Turn an idea or request into a versioned spec under `.kiro/specs/<slug>/`, made of three documents written and approved in strict order. Never skip a phase, and never mix a later phase's decisions into an earlier one.

Before starting, always read `.kiro/steering/product.md`, `.kiro/steering/tech.md`, and `.kiro/steering/structure.md`, plus `plan.md` if the feature touches architecture not covered in steering.

## Phase 1: Requirements

File: `.kiro/specs/<slug>/requirements.md`.

1. Restate the objective in a short paragraph.
2. Write one or more user stories: `As a <role>, I want <capability>, so that <outcome>.`
3. Write acceptance criteria in **EARS format**, each with a stable ID (`REQ-001`, `REQ-002`, and so on):
   - `WHEN <event/condition>, THE SYSTEM SHALL <observable response>.`
   - For always-on behavior: `THE SYSTEM SHALL ALWAYS <invariant>.`
4. Explicitly mark what's out of scope.
5. If anything is ambiguous (actor, input/output data, edge case, success criterion), ask; don't assume. There's no limit on questions, but each one must close a concrete decision.
6. Run the `spec-grill` skill against the draft. Resolve every finding in the document itself, then run it again until it's clean.
7. Present the document and ask for explicit approval before moving to Phase 2. Do not continue without a clear "yes."

## Phase 2: Design

File: `.kiro/specs/<slug>/design.md`. Written only after Requirements is approved.

Must cover:
- Which part of `plan.md`'s or steering's architecture this feature touches (new or modified data models, affected layers per `structure.md`'s convention).
- Explicit reference to each `REQ-XXX` this design satisfies.
- Mermaid diagrams only if they clarify something prose doesn't, not by default.
- Impact on multi-tenant isolation, RBAC, or clinical data if applicable (see `.agents/rules/tenant-isolation.md` and `no-plaintext-clinical-data.md`).
- What's reused from existing code/patterns versus what's new.

Before writing the document, check whether it needs a specialist perspective and, if so, open and apply that persona file, naming it in the design document:
- Touches Prisma schema, a migration, or a new tenant-scoped table: read and apply `.agents/agents/database-architect.md`, including its RLS checklist.
- Touches a new route, route group, or rendering-strategy choice: read and apply `.agents/agents/nextjs-architect.md`.
- Has meaningful UI/visual surface: read and apply `.agents/agents/design.md`.

If the design has a genuine fork between two or more defensible approaches, run the `decision-debate` skill before writing that part of the document down as settled; don't silently pick one and present it as if it were the only option. Once a debate concludes, record it with the `adr` skill per `.agents/rules/adr-required.md` before asking for approval on this phase.

Run `spec-grill` against the draft, resolve findings, and repeat until clean. Present and ask for explicit approval before moving to Phase 3.

## Phase 3: Tasks

File: `.kiro/specs/<slug>/tasks.md`. Written only after Design is approved.

- Checklist of tasks with a stable ID: `- [ ] T1.1 <description>`.
- Each task references the `REQ-XXX` it closes.
- Each task specifies the exact validation command (for example `pnpm test -- calc-engine`, `pnpm test:e2e -- appointments`).
- One task equals one verifiable action. Don't merge several independent actions into a single task.
- Don't decompose more than necessary: granularity should be executable by `task-runner` without ambiguity, but not so fine it becomes noise.

Present and ask for explicit approval before implementing. Once `tasks.md` is approved, use the `task-runner` skill to execute each task.

## Rules

- Don't write code during this skill; only the three spec documents.
- Don't move to the next phase without explicit user approval, and without a clean `spec-grill` pass.
- Don't introduce any behavior-affecting decision in Design or Tasks that isn't already in Requirements. If a new decision is needed, go back to Requirements first.
- Keep every report concise per `.agents/rules/cost-optimization.md`.
- Always respond in the language the user is using.
