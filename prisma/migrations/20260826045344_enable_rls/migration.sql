-- Row-Level Security: defense-in-depth for tenant isolation, behind the
-- Prisma Client Extension (`withTenant`, src/lib/db.ts). See
-- .kiro/specs/phase-0-scaffold/design.md, "RLS policy" section.
-- Applies only to tenant-scoped tables (memberships, professionals);
-- organizations and users are not tenant-scoped, see design.md.

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "memberships"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "professionals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "professionals"
  USING ("organizationId" = current_setting('app.current_org_id', true));
