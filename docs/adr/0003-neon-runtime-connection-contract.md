# ADR-0003: Neon runtime connection contract for Vercel

## Status

Accepted

## Date

2026-08-26

## Context

The Neon Vercel integration creates an isolated database branch for every Preview deployment and publishes its connection as `DATABASE_URL`. AppNutri previously required `APP_DATABASE_URL` for every runtime, which deliberately prevents local code from accidentally using the migration-owner connection and bypassing RLS. The integration cannot publish a per-preview alias named `APP_DATABASE_URL`, so a fixed value would point previews at the wrong database branch.

Two safe needs must coexist: deployed previews need Neon's dynamic, least-privilege URL, while local migrations still need an owner connection that must never be available to Vercel runtime code.

## Decision

When `VERCEL_ENV` is set, `src/lib/db.ts` will use `DATABASE_URL` as the runtime connection and fail closed when it is absent. The Neon Vercel integration must be configured to supply that variable for the non-owner, non-`BYPASSRLS` role `appnutri_app`. Outside Vercel, the runtime continues to require `APP_DATABASE_URL`; `DATABASE_URL` remains the local migration connection.

## Alternatives considered

- **Copy a fixed `APP_DATABASE_URL` into Vercel**: this preserves the existing variable name but loses the Neon integration's per-preview branch URL. Every preview could reach the same branch, violating REQ-019.
- **Use the owner `DATABASE_URL` as the Vercel runtime connection**: this is operationally simple, but an owner or `BYPASSRLS` role can bypass PostgreSQL RLS. It defeats the second isolation layer and is therefore unacceptable for clinical data.
- **Rename every local and deployed connection immediately and add a migration CI pipeline**: this would make the naming uniform, but it expands Phase 0 into automated migration promotion. That workflow is explicitly deferred to a dedicated infrastructure spec.

## Consequences

The database-client bootstrap has a small environment-specific branch, covered by unit tests. Vercel must expose `VERCEL_ENV`, and its Neon integration must select `appnutri_app` for Preview and Production. Preview branch verification includes checking `current_user` and serving `/register`. Operators keep the migration-owner URL outside Vercel; future migration automation remains a separate decision.

## Related

Spec: `.kiro/specs/phase-0-scaffold/`.
