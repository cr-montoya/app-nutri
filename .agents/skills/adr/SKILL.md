---
name: adr
description: Writes a new Architecture Decision Record in docs/adr/ from a decision that's already been made, using the standard template. Use it whenever .agents/rules/adr-required.md applies, most often right after a decision-debate concludes.
---

# ADR

## Process

1. Determine the next sequential number by listing `docs/adr/` (`0001-`, `0002-`, and so on; `template.md` and `README.md` don't count).
2. Copy `docs/adr/template.md` to `docs/adr/<NNNN>-<slug>.md`, where `<slug>` is a short kebab-case name for the decision (for example `0003-prisma-over-drizzle.md`).
3. Fill in every section. Do not leave a section as the template's placeholder text:
   - **Status**: `Accepted` if the decision is final, `Proposed` only if it's still awaiting confirmation.
   - **Context**: what forced the decision and why it wasn't obvious.
   - **Decision**: the choice, stated plainly.
   - **Alternatives considered**: the real strongest case for each rejected option and why it lost, pulled from the `decision-debate` transcript if this came from one.
   - **Consequences**: the actual trade-offs accepted, not just the benefits.
   - **Related**: the spec slug if applicable, and any ADR this supersedes.
4. If this ADR supersedes an earlier one, update the old ADR's `Status` line to `Superseded by ADR-<NNNN>` (a one-line edit; never rewrite its Decision or Context). Add the reverse link in the new ADR's `Related` section.
5. Add a row to the index table in `docs/adr/README.md`.

## Rules

- One ADR per decision. A design with three separate architecture choices gets three ADRs, not one that bundles them.
- Never mark Status `Accepted` for a decision the user hasn't actually confirmed; use `Proposed` and follow up.
- An ADR already `Accepted` is never edited to change its Decision or Context, only superseded. See `docs/adr/README.md`.

## Output

The path to the new ADR file, and confirmation that the index was updated.
