---
name: spec-grill
description: Adversarially stress-tests a spec's requirements.md or design.md before it's presented for approval, looking for unclosed decisions, missing edge cases, and untestable criteria. Invoked by spec-plan at the end of Phase 1 and Phase 2, before asking the user to approve. Can also be run standalone against an existing spec.
---

# Spec Grill

## Purpose

Find the problems in a spec while it's still cheap to fix, before any code exists. This is an adversarial pass: your job is to try to break the document, not to confirm it looks fine.

## Process

Read the target document (`requirements.md` or `design.md`) plus `.kiro/steering/product.md` for product-vision alignment, then check for each of the following. Every hit is a finding; report the finding, don't silently fix the document yourself.

### Forbidden language (unclosed decisions)

Grep for hedge words that mean a decision was deferred instead of made: "if needed," "if applicable," "should probably," "maybe," "or" used to mean "pick one later," "depending on." Each one is a requirement that isn't actually a requirement yet.

### Requirements-phase checks

- Every acceptance criterion is in EARS format and names an observable system response, not a vague intention.
- Every criterion is independently testable: could two different engineers implement it and get the same behavior?
- Edge cases named: empty/missing input, boundary values (age ranges for calc-engine protocols, permission boundaries between roles), concurrent access if relevant.
- Out-of-scope items are explicit, not just absent.
- No requirement conflicts with another requirement in the same document, or with `.kiro/steering/product.md`.

### Design-phase checks

- Every `REQ-XXX` from `requirements.md` is addressed by the design; none silently dropped.
- No new behavior-affecting decision appears in the design that wasn't already in Requirements. If one is needed, that's a finding: go back to Requirements, not forward with an unapproved decision.
- Data contract fields (if the feature touches an entity) specify presence (required/nullable), source of truth, and missing-data behavior. No field left to be "inferred" or "derived" without saying how.
- Multi-tenant isolation and RBAC impact is stated, not assumed. If the feature touches a tenant-scoped model or a role boundary and the design is silent on it, that's a finding.
- Reuse is explicit: which existing pattern/component does this build on, and is that actually true, or does the design just say "reuse X" without checking X fits.

## Output

A list of findings, each with: what's unclosed or missing, why it matters (what could go wrong if shipped as-is), and the specific question or edit needed to close it. If the document is clean, say so explicitly and name what you checked, don't just imply it by staying silent.

`spec-plan` does not present a phase for approval while `spec-grill` findings remain open. Findings get resolved in the document itself, then `spec-grill` runs again before presenting.
