---
name: spec-closeout
description: Verifies that a spec under .kiro/specs/<slug>/ is ready to be closed — every EARS requirement has a passing validation and there's no drift between design.md and what was actually implemented. Use it before opening a PR or considering a feature done.
---

# Spec Closeout

## Process

1. Read the spec's `requirements.md`, `design.md`, and `tasks.md`.
2. For each `REQ-XXX` in `requirements.md`: confirm at least one task in `tasks.md` references it, that task is checked `[x]`, and its validation command actually passed (rerun it if in doubt).
3. Compare `design.md` against the code actually written: if the implementation deviated from the approved design (an unplanned new file, a different layer, a different contract), document the deviation explicitly in `design.md` under a `## Deviations` section — don't leave it implicit.
4. Run the gate matrix from `docs/testing-and-security.md` based on the change type (multi-tenant/auth, UI, calc-engine, infra) and confirm the required gates are covered.
5. If any `REQ-XXX` is left uncovered, or there's an unresolved `[BLOCKED]` task, the spec is **not** ready — report it, don't close it.

## Output

A short summary: requirements covered / total, tasks completed / blocked, documented deviations, pending gates if any. If everything is green, explicitly state that the spec is ready to close.
