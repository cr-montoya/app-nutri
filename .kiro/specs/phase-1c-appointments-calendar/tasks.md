# Tasks: Phase 1c, Appointments and Calendar

Branch: `feat/phase-1c-appointments-calendar`, created by `task-runner` from up-to-date `main` before T1.1, per `.agents/rules/trunk-based.md`. Depends on `phase-0-scaffold`, `phase-1a-team-invites`, and `phase-1b-patients` being merged first.

## T1: Schema, RLS, and the exclusion constraint (REQ-007, REQ-021, REQ-022)

- [x] T1.1 Add `Appointment` and `AppointmentStatus` to `prisma/schema.prisma` per `design.md`, plus the `Organization.appointments`, `Patient.appointments`, and `Professional.appointments` back-relations. Validation: `pnpm exec prisma validate`.
- [x] T1.2 Run the migration against the dev Neon branch. Validation: `pnpm exec prisma migrate dev` succeeds.
- [x] T1.3 Add `CREATE EXTENSION IF NOT EXISTS btree_gist` and the `no_overlapping_active_appointments` `EXCLUDE` constraint from `design.md` to the migration. Validation: manual `psql` check confirming the extension and constraint exist.
- [x] T1.4 Add the RLS policy for `appointments` to the migration. Validation: manual `psql` check confirming RLS is enabled and the policy exists.
- [x] T1.5 Positive RLS test: a session scoped to org A reads/writes its own appointments. Validation: `pnpm test -- appointment-rls-positive`. Closes REQ-021.
- [x] T1.6 Negative RLS test: a raw `pg` client scoped to org A gets zero rows querying org B's appointments directly. Validation: `pnpm test -- appointment-rls-negative`. Closes REQ-022.
- [x] T1.7 Exclusion-constraint test: two concurrent creation attempts for the same professional with overlapping time ranges; exactly one succeeds, the other fails on the constraint with no partial write. Validation: `pnpm test -- appointment-exclusion-race`. Closes REQ-007.

## T2: Validation and creation (REQ-001 through REQ-006, REQ-008, REQ-009, REQ-010)

- [x] T2.1 Write `src/validation/appointments.ts`: duration default/bounds (REQ-002, REQ-003), past-`startAt` rejection (REQ-004), the `America/Bogota` parse/format boundary (REQ-005), `reason`/`notes` length bounds (REQ-009, REQ-010). Validation: `pnpm test -- validation`.
- [x] T2.2 Implement `createAppointmentAction` in `src/server/actions/appointments.ts`: validates via the schema above, resolves `patientId`/`professionalId` through `withTenant`-scoped lookups (rejecting a foreign id as not found), catches the exclusion-constraint violation and maps it to the REQ-006 conflict message. Validation: `pnpm test -- create-appointment`. Closes REQ-001, REQ-006, REQ-008.

## T3: Editing and status transitions (REQ-011 through REQ-018)

- [x] T3.1 Implement `updateAppointmentAction`: accepts any of `startAt`/`endAt`/`professionalId`/`reason`/`notes`, never `patientId`; rejects if current status isn't `SCHEDULED`/`CONFIRMED`; re-validates changed fields; catches the exclusion-constraint violation the same way as `createAppointmentAction`. Validation: `pnpm test -- update-appointment`. Closes REQ-011, REQ-012.
- [x] T3.2 Implement `allowedNextStatuses()` in `src/lib/appointments.ts` (the allowed-transitions table as a shared, importable pure function, not inlined) and have `transitionAppointmentStatusAction` use it plus the conditional `updateMany` from `design.md`. Validation: `pnpm test -- transition-appointment`. Closes REQ-014, REQ-015, REQ-016, REQ-017.
- [x] T3.3 Concurrency test: two simultaneous status-transition requests for the same appointment expecting different current statuses, confirming exactly one succeeds and the other reports the status already changed. Validation: `pnpm test -- transition-appointment-race`. Closes REQ-018.

## T4: Calendar UI (REQ-011, REQ-013, REQ-014 through REQ-017, REQ-019, REQ-020, REQ-023 through REQ-028)

- [x] T4.1 Implement `getAppointmentsForRangeAction`, org-scoped via `withTenant`. Validation: `pnpm test -- appointments-range-query`.
- [x] T4.2 Add the shadcn `Sheet` primitive at `src/components/ui/sheet.tsx` (via the shadcn CLI; no new dependency, `radix-ui`/`@base-ui/react` are already installed). Validation: `pnpm exec tsc --noEmit` passes with the new file imported by a placeholder usage, or by T4.5 once written.
- [x] T4.3 Build `src/components/appointments/calendar.tsx`: Client Component wrapping FullCalendar, default view `resourceTimeGridDay` with a resource column per professional, status-based event styling (color/opacity **and** an icon + text label per `AppointmentStatus`, per REQ-025), a `loading`-callback-driven skeleton during range navigation, and an empty-state message when the range has zero appointments (REQ-027). Validation: `pnpm test:e2e -- calendar-render`. Closes REQ-019, REQ-020, REQ-025, REQ-027.
- [ ] T4.4 Wire drag-and-drop to `updateAppointmentAction` end to end: on rejection (conflict or invalid status), call `info.revert()` and render the rejection reason via the inline `dragError` pattern (REQ-026); on success, no reload flash. Validation: `pnpm test:e2e -- calendar-drag-reschedule`. Closes REQ-013, REQ-026 (drag path).
- [x] T4.5 Build `src/components/appointments/appointment-detail-sheet.tsx` on the `Sheet` primitive (T4.2): opens on click/tap and on keyboard activation of a calendar event; shows fields read-only with an "Edit" affordance that reveals the create form's fields, reusing its Zod schema, submitting to `updateAppointmentAction` — this is the non-drag reschedule/edit path. Rejections render inline via the same `serverError` pattern as `invite-form.tsx` (REQ-026). Validation: `pnpm test:e2e -- appointment-detail-edit`. Closes REQ-011, REQ-024, REQ-026 (form path).
- [x] T4.6 Add contextual status-transition buttons to `AppointmentDetailSheet`, rendered from `allowedNextStatuses(appointment.status)` (T3.2) so only valid transitions ever appear. Validation: `pnpm test:e2e -- appointment-status-transition-ui`. Closes REQ-014, REQ-015, REQ-016, REQ-017 (UI surface; server enforcement already closed by T3.2/T3.3).
- [x] T4.7 Build `src/app/(app)/[orgSlug]/appointments/page.tsx` (shell + calendar) and `src/app/(app)/[orgSlug]/appointments/new/page.tsx` (create form wired to `createAppointmentAction`, reading `?date=&time=&professionalId=` to pre-fill when navigated from an empty-slot click). Validation: `pnpm test:e2e -- appointments-pages`.
- [x] T4.8 Confirm no `Appointment` action calls `requireRole`; all three roles can complete every flow above. Validation: `pnpm test:e2e -- appointment-rbac-open`. Closes REQ-023.
- [ ] T4.9 Manual tablet-viewport check: calendar event chips and every status-transition/edit-sheet button meet the REQ-028 44×44px minimum hit area with 3+ professional columns visible; touch-drag `longPressDelay` is tuned so a scroll gesture doesn't fight a drag attempt. Validation: manual check on an actual tablet viewport (documented with device/viewport used in the PR description, since this isn't automatable in CI). Closes REQ-028.

## T5: End-to-end proof

- [ ] T5.1 Playwright E2E: as `FRONT_DESK`, schedule an appointment for a patient with a professional; attempt a second, overlapping appointment for the same professional and confirm it's rejected with a visible reason; confirm the first appointment (SCHEDULED → CONFIRMED → COMPLETED) via the detail sheet's contextual controls; create and cancel a second appointment (SCHEDULED → CANCELLED); confirm a cancelled or completed appointment can't be rescheduled or re-transitioned, by drag and by the detail sheet; confirm an empty day shows the empty state; confirm status is visually distinguishable by icon/label, not color alone. Validation: `pnpm test:e2e -- appointments-e2e`. Confirms REQ-001 through REQ-027 hold end to end (REQ-028 touch-target sizing is a manual, non-automatable check, covered by T4.9 instead).

## After T5.1

Run `spec-closeout`, then `pr-prep`.
