-- Makes the RLS policies' WITH CHECK explicit instead of relying on
-- Postgres's implicit "USING doubles as WITH CHECK for a FOR ALL policy
-- with no explicit WITH CHECK" behavior (security review finding on
-- phase-0-scaffold: same semantics today, but a future edit that changes
-- USING without adding WITH CHECK could silently regress insert/update
-- protection). No behavior change; verified by the existing RLS tests
-- (tests/integration/rls-positive.test.ts, rls-negative.test.ts) still
-- passing unchanged.

ALTER POLICY tenant_isolation ON "memberships"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER POLICY tenant_isolation ON "professionals"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
