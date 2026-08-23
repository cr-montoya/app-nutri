# Rule: Spec First

No code change without an approved task in `.kiro/specs/<slug>/tasks.md`. No exceptions for "small" changes.

## Before any implementation

1. Identify the spec and its `slug` under `.kiro/specs/<slug>/`.
2. Confirm `requirements.md`, `design.md`, and `tasks.md` exist and were explicitly approved by the user. It's not enough for the files to exist; they must have gone through approval at each `spec-plan` phase.
3. Confirm the specific task you're about to implement is in `tasks.md`, unchecked, with its validation command defined.
4. If no spec exists, or the task isn't there: stop and use the `spec-plan` skill first.

## Why

No spec means no requirement. No requirement means no acceptance criterion. No acceptance criterion means `spec-closeout` can't verify anything, and the harness collapses into "vibe coding," exactly what this project is designed to prevent in a domain with clinical data.

## Allowed exceptions

- `chore:` commits for configuration or dependencies that are self-evident and don't change behavior (for example bumping a lint tool version) may proceed without a spec.
- Emergency hotfixes (for example a multi-tenant isolation leak in production) may be implemented immediately, but must produce a retroactive spec in `.kiro/specs/` documenting what happened and why, before being considered closed.
