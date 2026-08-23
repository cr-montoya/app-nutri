# ADR-0002: Token-scoped RLS branch for pre-authentication lookups

## Status

Accepted

## Date

2026-08-23

## Context

`invites` is a tenant-scoped table (has `organizationId`, needs RLS like every other tenant-scoped table per `.agents/rules/tenant-isolation.md`). But the invite-accept flow looks up an `Invite` by its token *before* the visitor has any session or organization context, since the org is a result of that lookup, not a precondition of it. The standard RLS policy (`USING ("organizationId" = current_setting('app.current_org_id', true))`) would return zero rows for this query, since `app.current_org_id` is never set for an unauthenticated visitor, silently breaking the entire accept flow if applied naively.

## Decision

`invites` gets an RLS policy with two branches combined with `OR`: the normal org-scoped branch, and a token-scoped branch keyed on a dedicated session variable (`app.invite_lookup_token_hash`), set server-side to the SHA-256 hash of the raw token from the URL, immediately before the one query that needs it. A single unguessable 256-bit token authorizes visibility of exactly the one row matching its hash, nothing else. Once that lookup resolves the invite's `organizationId`, the rest of the accept transaction sets `app.current_org_id` normally and proceeds through the standard tenant-scoped path.

```sql
CREATE POLICY tenant_isolation ON invites
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
    OR "tokenHash" = current_setting('app.invite_lookup_token_hash', true)
  );
```

This pattern is intended to be reused for any future token-bearing, pre-authentication flow (password reset is the obvious next one), not re-derived from scratch each time.

## Alternatives considered

- **A permissive `USING (true)` SELECT policy scoped to the accept-flow's query path**: rejected because Postgres RLS policies apply to every query against the table regardless of which application code issued it; there's no way to scope a `USING (true)` policy to "only the token-lookup code path." It would let any query, including a compromised or buggy one, enumerate every pending invite across every organization, defeating isolation for the normal ADMIN member-list read too.
- **Bypass RLS entirely for this one query via a separate, privileged database connection role**: rejected as unnecessary complexity for this project's scale, and it introduces a second connection/credential to manage and audit, when a session-variable branch achieves the same narrow authorization with the existing single connection and role.

## Consequences

The accept-invite Server Action must explicitly set `app.invite_lookup_token_hash` for its one lookup query, in addition to the existing pattern of setting `app.current_org_id` for everything after. This is a small, deliberate exception to the otherwise-uniform tenant-context pattern, documented here specifically so it isn't mistaken for a bypass or a mistake during review. Any future token-bearing pre-auth flow should follow this same shape rather than inventing a new one.

## Related

Spec: `.kiro/specs/phase-1a-team-invites/`.
