# Architecture Decision Records

This directory holds AppNutri's ADRs: a permanent, dated record of *why* a significant architecture or product decision was made, not just what it was. `plan.md` describes the current state of the architecture; ADRs are the history of how it got there and why alternatives were rejected.

## When an ADR is required

See `.agents/rules/adr-required.md` for the full rule. In short: any decision that came out of the `decision-debate` skill, any architecture choice not already covered by `plan.md`/`.kiro/steering/`, and any deviation from an approved `design.md` that reflects a real architecture choice rather than an implementation detail.

## Creating one

Use the `adr` skill (`.agents/skills/adr/SKILL.md`). It numbers the record sequentially, uses `template.md` below, and updates this index.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-argon2-hashing-library.md) | Password hashing library (@node-rs/argon2) | Accepted |
| [0002](0002-token-scoped-rls-lookup.md) | Token-scoped RLS branch for pre-authentication lookups | Accepted |
| [0003](0003-neon-runtime-connection-contract.md) | Neon runtime connection contract for Vercel | Accepted |
| [0004](0004-split-migration-credentials.md) | Split credentials for CI-driven Neon migrations | Accepted |
<!-- adr skill appends rows here, oldest first -->

## Format

Michael Nygard's ADR format: Title, Status, Context, Decision, Alternatives Considered, Consequences. See `template.md`.

ADRs are immutable once their status is `Accepted`. A changed decision gets a new ADR that supersedes the old one; the old one's `Decision` section is never rewritten, only its `Status` line is updated to point at the new record.
