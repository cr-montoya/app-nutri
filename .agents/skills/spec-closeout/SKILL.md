---
name: spec-closeout
description: Verifies that a spec under .kiro/specs/<slug>/ is ready to be closed. Every EARS requirement has a passing validation and there's no drift between design.md and what was actually implemented. Use it before opening a PR or considering a feature done.
---

# Spec Closeout

## Process

1. Read the spec's `requirements.md`, `design.md`, and `tasks.md`.
2. For each `REQ-XXX` in `requirements.md`: confirm at least one task in `tasks.md` references it, that task is checked `[x]`, and its validation command actually passed (rerun it if in doubt).
3. Compare `design.md` against the code actually written. If the implementation deviated from the approved design (an unplanned new file, a different layer, a different contract), document the deviation explicitly in `design.md` under a `## Deviations` section, don't leave it implicit.
4. Run the gate matrix from `docs/testing-and-security.md` based on the change type (multi-tenant/auth, UI, calc-engine, infra) and confirm the required gates are covered.
5. If any `REQ-XXX` is left uncovered, or there's an unresolved `[BLOCKED]` task, the spec is **not** ready. Report it, don't close it.

## Rules

- You are not the same agent that implemented the tasks. If you find yourself about to self-certify work you also wrote in this session, stop and flag it per `.agents/rules/agent-anti-patterns.md`.

## Output

A short summary: requirements covered versus total, tasks completed versus blocked, documented deviations, pending gates if any. If everything is green, explicitly state that the spec is ready to close and hand off to the `pr-prep` skill to open the PR.
