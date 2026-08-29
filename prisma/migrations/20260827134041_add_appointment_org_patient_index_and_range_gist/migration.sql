-- CreateIndex
CREATE INDEX "appointments_organizationId_patientId_idx" ON "appointments"("organizationId", "patientId");

-- database-architect finding (phase-1c review): getAppointmentsForRangeAction
-- filters on organizationId + a startAt/endAt range overlap with no
-- professionalId filter; neither the plain "organizationId" index nor
-- "(professionalId, startAt)" actually serves that query -- confirmed
-- empirically against 50k synthetic rows (sequential-scan-equivalent cost
-- via the org index alone, 8-16ms and growing). A GiST expression index
-- over (organizationId, tsrange(startAt, endAt)) matches the query's actual
-- shape. Reuses the btree_gist extension the exclusion-constraint migration
-- (20260827022943_appointments_exclusion_and_rls) already enabled -- no
-- native Prisma index syntax exists for an expression index like this, same
-- reason the EXCLUDE constraint there is hand-written raw SQL. Not
-- CONCURRENTLY: the table has zero production rows, matching this project's
-- existing migrations' convention (none of them use CONCURRENTLY).
CREATE INDEX appointments_org_range_gist_idx ON appointments
  USING gist ("organizationId", tsrange("startAt", "endAt"));
