---
name: task-runner
description: Implements a single task already approved in .kiro/specs/<slug>/tasks.md. Use it only after the spec's requirements.md, design.md, and tasks.md are approved, never for work without a spec.
---

# Task Runner

## Precondition

The task to implement must exist as an unchecked checkbox in an already-approved `tasks.md`. If there's no spec, or the task isn't in `tasks.md`, stop and use `spec-plan` first (see `.agents/rules/spec-first.md`).

## Process

1. Read the task (`T<phase>.<index>`), the `REQ-XXX` it references in `requirements.md`, and the relevant section of `design.md`.
2. Before writing code: confirm the necessary contracts (Prisma schema, Zod types) exist for this task. If they don't and this task isn't the one creating them, follow `.agents/rules/contracts-before-code.md`.
3. Implement the minimal change that satisfies the task. Don't get ahead of other tasks in the same spec.
4. Always apply `.agents/rules/tenant-isolation.md` and `.agents/rules/no-plaintext-clinical-data.md` if the change touches patient or consultation data.
5. Run the exact validation command specified in the task. If it fails, fix and rerun; never mark a task done with a red validation.
6. If the same validation still fails after 3 distinct fix attempts, stop and follow `.agents/rules/human-escalation.md` instead of trying a 4th variation.
7. Check the box `[x]` in `tasks.md` only once validation passes. If the task can't be completed, mark it `[BLOCKED]` with a concrete reason and report it to the user instead of improvising a solution outside the approved design.
8. Use the `commit` skill to commit this task's change on its own, don't bundle it with the next task's change.

## Rules

- One task, one scope. Don't mix several `tasks.md` tasks into the same change unless the user explicitly asks for it.
- Don't introduce new behavior-affecting decisions that aren't in `design.md`. If one is needed, go back to `spec-plan`.
- You implemented this task; you don't get to also mark it reviewed. See `.agents/rules/agent-anti-patterns.md` on separation of duties.
- Once every task in `tasks.md` is done, hand off to `spec-closeout` and then `pr-prep`; `task-runner`'s job ends at the last task, not at opening the PR.
