-- Row-Level Security for the invites table, per
-- .kiro/specs/phase-1a-team-invites/design.md's "RLS policy" section and
-- ADR-0002 (docs/adr/0002-token-scoped-rls-lookup.md).
--
-- Two branches combined with OR: the normal org-scoped branch (same shape
-- as memberships/professionals), and a token-scoped branch that authorizes
-- the single pre-authentication lookup the invite-accept flow needs, keyed
-- on a dedicated session variable set server-side to the SHA-256 hash of
-- the raw token from the URL (never a client-supplied organizationId or
-- token value read directly).
--
-- WITH CHECK is explicit from the start here, unlike phase-0-scaffold's
-- memberships/professionals policies, which initially relied on the
-- implicit USING-doubles-as-WITH-CHECK behavior and needed a follow-up
-- migration (20260826052804_rls_explicit_with_check) to make it explicit.

ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invites"
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
    OR "tokenHash" = current_setting('app.invite_lookup_token_hash', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', true)
    OR "tokenHash" = current_setting('app.invite_lookup_token_hash', true)
  );
