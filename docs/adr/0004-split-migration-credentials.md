# ADR-0004: Split credentials for CI-driven Neon migrations

## Status

Accepted

## Date

2026-08-26

## Context

`infra-migration-pipeline` needs a CI job to run `prisma migrate deploy` against Neon: the production branch on every push to `main`, and each pull request's dynamically-provisioned preview branch (created by the existing Vercel-Neon native integration) on every PR open/sync. Per ADR-0003, this credential must never reach Vercel or the app runtime — it needs a schema-modification-capable Postgres role that only exists as a CI secret.

Neon's API supports project-scoped API keys, but the only access level available is "Editor": a key scoped to this project can read and modify any resource in it, including creating or deleting *any* branch — production included, not just previews. There is no narrower, read-only, or per-branch-restricted key type. Preview branches don't exist until Vercel's integration creates them, so looking one up dynamically by name (Neon's convention: `preview/<git-branch>`) genuinely requires an API key; there's no way around that for preview. Production, by contrast, is a single fixed, already-known branch — it doesn't need dynamic discovery at all.

This makes "one mechanism for both" and "a narrower mechanism for the one case that can afford it" a real fork, not a coin flip: a single project-scoped API key used for everything gives a leaked secret the power to delete or reconfigure the production branch itself, not just alter its schema — a materially larger blast radius than a direct connection string ever has, for the one environment holding real clinical data.

## Decision

Split the credential by environment:

- **Production**: a static, manually-provisioned GitHub Actions secret holding a direct Postgres connection string for a dedicated migration role on the production Neon branch (no Neon API involved at all — just `prisma migrate deploy` against that URL). Provisioning this role/secret is an operator step outside version control, the same way `appnutri_app`'s local password was in `phase-0-scaffold`.
- **Preview**: a separate GitHub Actions secret holding a project-scoped Neon API key, used only by the preview job to list the project's branches, find the one named `preview/<git-branch>` for the PR under test, and fetch its connection URI for the same dedicated migration role.

Both credentials are CI-only secrets; neither is ever set as a Vercel environment variable (REQ-005/REQ-006, `.kiro/specs/infra-migration-pipeline/requirements.md`).

## Alternatives considered

- **Unified Neon API key for both production and preview** (one secret, one code path): simpler to provision and rotate — one secret instead of two, no branching logic in the workflow for "which credential source am I using." Loses on blast radius: the same key that's merely convenient for preview becomes, if leaked, capable of destroying or reconfiguring production's Neon branch, not just running SQL against it. Rejected because production is exactly the environment this project has already chosen to protect with the narrowest available credential (the `appnutri`/`appnutri_app` split, ADR-0003), and a strictly narrower option (a direct connection string) is available for it at low added cost.
- **Vercel-managed Neon integration owning migration execution too** (letting Vercel's build step run migrations): rejected immediately, not seriously debated — it would require exposing a schema-modifying credential to Vercel/app runtime, which REQ-005 and ADR-0003 already rule out.

## Consequences

Two secrets to provision and rotate instead of one; the preview job's Neon-API-key lookup logic (list branches, filter by `preview/<git-branch>` naming) is a small amount of extra pipeline code the unified option wouldn't need. In exchange, a leaked production credential is bounded to what SQL can do to that one database — it cannot delete the branch, cannot touch preview branches, cannot reconfigure the Neon project. This mirrors this project's existing, deliberate pattern of narrow-purpose credentials over broad, convenient ones. Future token-bearing CI work (if any) should default to asking the same question — does this environment actually need dynamic discovery, or is a static, narrower credential available — rather than reaching for one general-purpose key out of habit.

## Related

Spec: `.kiro/specs/infra-migration-pipeline/`. Builds on ADR-0003 (`0003-neon-runtime-connection-contract.md`).
