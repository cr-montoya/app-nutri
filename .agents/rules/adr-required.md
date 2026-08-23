# Rule: When an ADR Is Required

Check this during `spec-plan` Phase 2 (Design) and whenever a `decision-debate` concludes.

## An ADR is required when

- A `decision-debate` reached a conclusion, whether it converged on a recommendation or the user broke a tie. No exceptions; that's the entire point of running the debate.
- A design introduces an architecture choice not already covered by `plan.md` or `.kiro/steering/` (a new pattern, a new external dependency category, a structural change to the multi-tenant model, a new protocol category in the calc-engine beyond adding a protocol instance).
- An implementation deviated from an approved `design.md` in a way that reflects a real architecture choice, not just an implementation detail (see the `## Deviations` section convention in `.agents/skills/spec-closeout/SKILL.md`).
- A previous ADR's decision is being reversed or replaced.

## An ADR is not required for

- Adding a new body-composition protocol instance following the existing registry pattern; that pattern is already the ADR-level decision, described in `plan.md` §5.
- Routine implementation choices inside an already-approved `design.md` (variable names, which existing helper to call, minor refactors).
- Anything `nextjs-architect` or `database-architect` resolves as a straightforward application of an already-established convention in `.kiro/steering/structure.md`; write the ADR only when the convention itself is being set or changed, not every time it's applied.

## What to do

Use the `adr` skill (`.agents/skills/adr/SKILL.md`) to write it. Do this before `spec-closeout` runs for the spec that produced the decision; an unrecorded architecture decision is a gap `reviewer` should flag, not something to backfill later from memory.

## Why

`plan.md` and `.kiro/steering/` describe the architecture as it currently stands. Without ADRs, the reasoning behind a non-obvious choice lives only in a chat transcript or a closed PR discussion, and the next person (human or agent) who wants to change it has no record of what was already tried and rejected, and why.
