-- Corrects prisma/migrations/20260827134041_add_appointment_org_patient_index_and_range_gist:
-- getAppointmentsForRangeAction (src/server/actions/appointments.ts) issues
-- a plain Prisma findMany with separate "startAt" < ? AND "endAt" > ?
-- comparisons, never a tsrange(...) && tsrange(...) expression, so Postgres
-- can only use a GiST *expression* index when the query literally contains
-- that expression -- it never does here. Confirmed empirically at 280k
-- synthetic rows: appointments_org_range_gist_idx was never chosen by the
-- planner (seq scan, 29ms, 5863 buffers). A plain composite btree over the
-- columns actually compared is picked up immediately with zero
-- application-code change (confirmed: bitmap heap scan, 0.5ms, at both 50k
-- and 280k rows).
DROP INDEX "appointments_org_range_gist_idx";

-- CreateIndex
CREATE INDEX "appointments_organizationId_startAt_idx" ON "appointments"("organizationId", "startAt");
