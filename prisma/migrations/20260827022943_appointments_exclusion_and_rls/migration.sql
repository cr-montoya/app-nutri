-- Double-booking prevention (REQ-006, REQ-007) and Row-Level Security
-- (REQ-021, REQ-022) for the appointments table, per
-- .kiro/specs/phase-1c-appointments-calendar/design.md's "Schema" and
-- "RLS policy" sections.

-- btree_gist supplies the GiST equality operator class for "professionalId"
-- (a plain text column, not natively GiST-indexable); without it the
-- EXCLUDE constraint below can't mix an equality column with a range
-- overlap column in the same GiST index.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Database-level double-booking prevention: no two SCHEDULED/CONFIRMED
-- appointments for the same professional may have overlapping
-- [startAt, endAt) ranges. Scoped to active statuses only (the WHERE
-- clause) so a COMPLETED/CANCELLED/NO_SHOW appointment's old slot never
-- blocks a new booking. This is enforced by Postgres itself, not
-- application code, so a race between two concurrent requests can never
-- both succeed (REQ-007) -- a plain check-then-insert would have a
-- time-of-check-to-time-of-use gap under concurrency that this doesn't.
ALTER TABLE "appointments" ADD CONSTRAINT "no_overlapping_active_appointments"
  EXCLUDE USING gist (
    "professionalId" WITH =,
    tsrange("startAt", "endAt") WITH &&
  ) WHERE (status IN ('SCHEDULED', 'CONFIRMED'));

-- Same shape as patients/audit_logs (prisma/migrations/20260826200827_enable_patients_audit_logs_rls):
-- a single policy scoped to current_setting('app.current_org_id', true),
-- set server-side only by the tenant-context wrapper (src/lib/db.ts's
-- withTenant). WITH CHECK is explicit, matching that same migration.
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "appointments"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
