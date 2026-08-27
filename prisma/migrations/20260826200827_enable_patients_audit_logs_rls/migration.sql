-- Row-Level Security for the patients and audit_logs tables, per
-- .kiro/specs/phase-1b-patients/design.md's "RLS policy" section.
-- Same shape as memberships/professionals (prisma/migrations/20260826045344_enable_rls)
-- and invites' org-scoped branch: a single policy per table, scoped to
-- current_setting('app.current_org_id', true), set server-side only by
-- the tenant-context wrapper (src/lib/db.ts's withTenant). No
-- pre-authentication exception is needed for either table (unlike
-- invites' token-scoped branch): every Patient action requires an
-- authenticated session (REQ-019), and every AuditLog write happens from
-- inside an already-tenant-scoped action. WITH CHECK is explicit from the
-- start here (design.md's own RLS section only shows USING, but this
-- follows invites' migration instead), not left to the implicit
-- USING-doubles-as-WITH-CHECK behavior phase-0-scaffold initially relied
-- on for memberships/professionals.

ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "patients"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
