# Tasks: Phase 1c, Appointments and Calendar

Branch: `feat/phase-1c-appointments-calendar`, created by `task-runner` from up-to-date `main` before T1.1, per `.agents/rules/trunk-based.md`. Depends on `phase-0-scaffold`, `phase-1a-team-invites`, and `phase-1b-patients` being merged first.

## T1: Schema, RLS, and the exclusion constraint (REQ-007, REQ-021, REQ-022)

- [ ] T1.1 Add `Appointment` and `AppointmentStatus` to `prisma/schema.prisma` per `design.md`, plus the `Organization.appointments`, `Patient.appointments`, and `Professional.appointments` back-relations. Validation: `pnpm exec prisma validate`.
- [ ] T1.2 Run the migration against the dev Neon branch. Validation: `pnpm exec prisma migrate dev` succeeds.
- [ ] T1.3 Add `CREATE EXTENSION IF NOT EXISTS btree_gist` and the `no_overlapping_active_appointments` `EXCLUDE` constraint from `design.md` to the migration. Validation: manual `psql` check confirming the extension and constraint exist.
- [ ] T1.4 Add the RLS policy for `appointments` to the migration. Validation: manual `psql` check confirming RLS is enabled and the policy exists.
- [ ] T1.5 Positive RLS test: a session scoped to org A reads/writes its own appointments. Validation: `pnpm test -- appointment-rls-positive`. Closes REQ-021.
- [ ] T1.6 Negative RLS test: a raw `pg` client scoped to org A gets zero rows querying org B's appointments directly. Validation: `pnpm test -- appointment-rls-negative`. Closes REQ-022.
- [ ] T1.7 Exclusion-constraint test: two concurrent creation attempts for the same professional with overlapping time ranges; exactly one succeeds, the other fails on the constraint with no partial write. Validation: `pnpm test -- appointment-exclusion-race`. Closes REQ-007.

## T2: Validation and creation (REQ-001 through REQ-006, REQ-008, REQ-009, REQ-010)

- [ ] T2.1 Write `src/validation/appointments.ts`: duration default/bounds (REQ-002, REQ-003), past-`startAt` rejection (REQ-004), the `America/Bogota` parse/format boundary (REQ-005), `reason`/`notes` length bounds (REQ-009, REQ-010). Validation: `pnpm test -- validation`.
- [ ] T2.2 Implement `createAppointmentAction` in `src/server/actions/appointments.ts`: validates via the schema above, resolves `patientId`/`professionalId` through `withTenant`-scoped lookups (rejecting a foreign id as not found), catches the exclusion-constraint violation and maps it to the REQ-006 conflict message. Validation: `pnpm test -- create-appointment`. Closes REQ-001, REQ-006, REQ-008.

## T3: Editing and status transitions (REQ-011 through REQ-018)

- [ ] T3.1 Implement `updateAppointmentAction`: accepts any of `startAt`/`endAt`/`professionalId`/`reason`/`notes`, never `patientId`; rejects if current status isn't `SCHEDULED`/`CONFIRMED`; re-validates changed fields; catches the exclusion-constraint violation the same way as `createAppointmentAction`. Validation: `pnpm test -- update-appointment`. Closes REQ-011, REQ-012.
- [ ] T3.2 Implement `transitionAppointmentStatusAction`'s allowed-transitions table and the conditional `updateMany` from `design.md`. Validation: `pnpm test -- transition-appointment`. Closes REQ-014, REQ-015, REQ-016, REQ-017.
- [ ] T3.3 Concurrency test: two simultaneous status-transition requests for the same appointment expecting different current statuses, confirming exactly one succeeds and the other reports the status already changed. Validation: `pnpm test -- transition-appointment-race`. Closes REQ-018.

## T4: Calendar UI (REQ-013, REQ-019, REQ-020, REQ-023)

- [ ] T4.1 Implement `getAppointmentsForRangeAction`, org-scoped via `withTenant`. Validation: `pnpm test -- appointments-range-query`.
- [ ] T4.2 Build `src/components/appointments/calendar.tsx`: Client Component wrapping FullCalendar with a resource column per professional, status-based event styling, and a drag handler calling `updateAppointmentAction`. Validation: `pnpm test:e2e -- calendar-render`. Closes REQ-019, REQ-020.
- [ ] T4.3 Wire drag-and-drop to `updateAppointmentAction` end to end, confirming a dropped event that would overlap another shows the REQ-006 conflict error and reverts visually. Validation: `pnpm test:e2e -- calendar-drag-reschedule`. Closes REQ-013.
- [ ] T4.4 Build `src/app/(app)/[orgSlug]/appointments/page.tsx` (shell + calendar) and `src/app/(app)/[orgSlug]/appointments/new/page.tsx` (create form wired to `createAppointmentAction`). Validation: `pnpm test:e2e -- appointments-pages`.
- [ ] T4.5 Confirm no `Appointment` action calls `requireRole`; all three roles can complete every flow above. Validation: `pnpm test:e2e -- appointment-rbac-open`. Closes REQ-023.

## T5: End-to-end proof

- [ ] T5.1 Playwright E2E: as `FRONT_DESK`, schedule an appointment for a patient with a professional; attempt a second, overlapping appointment for the same professional and confirm it's rejected; confirm the first appointment (SCHEDULED → CONFIRMED → COMPLETED); create and cancel a second appointment (SCHEDULED → CANCELLED); confirm a cancelled or completed appointment can't be rescheduled or re-transitioned. Validation: `pnpm test:e2e -- appointments-e2e`. Confirms REQ-001 through REQ-023 hold end to end.

## After T5.1

Run `spec-closeout`, then `pr-prep`.
