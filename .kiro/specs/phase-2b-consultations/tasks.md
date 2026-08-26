# Tasks: Phase 2b, Consultations

Branch: `feat/phase-2b-consultations`, created by `task-runner` from up-to-date `main` before T1.1, per `.agents/rules/trunk-based.md`. Depends on `phase-0-scaffold`, `phase-1b-patients`, and `phase-1c-appointments-calendar` being merged first.

## T1: Schema and RLS (REQ-005, REQ-015, REQ-016)

- [ ] T1.1 Add `Consultation` to `prisma/schema.prisma` per `design.md`, plus the `Organization.consultations`, `Patient.consultations`, `Professional.consultations`, and `Appointment.consultation` back-relations. Validation: `pnpm exec prisma validate`.
- [ ] T1.2 Run the migration against the dev Neon branch. Validation: `pnpm exec prisma migrate dev` succeeds.
- [ ] T1.3 Add the RLS policy from `design.md` to the migration. Validation: manual `psql` check confirming RLS is enabled and the policy exists.
- [ ] T1.4 Positive RLS test: a session scoped to org A reads/writes its own `Consultation` rows. Validation: `pnpm test -- consultation-rls-positive`. Closes REQ-015.
- [ ] T1.5 Negative RLS test: a raw `pg` client scoped to org A gets zero rows querying org B's `Consultation` rows directly. Validation: `pnpm test -- consultation-rls-negative`. Closes REQ-016.
- [ ] T1.6 Concurrency test: two simultaneous attempts to create a `Consultation` from the same `Appointment`, confirming exactly one succeeds. Validation: `pnpm test -- consultation-appointment-race`. Closes REQ-005.

## T2: Validation and creation (REQ-001 through REQ-009, REQ-017)

- [ ] T2.1 Write `src/validation/consultations.ts`: `occurredAt` not-in-future refinement (REQ-006), `subjective`/`plan` length bounds (REQ-007, REQ-008). Validation: `pnpm test -- validation`.
- [ ] T2.2 Implement `createConsultationAction` in `src/server/actions/consultations.ts`: standalone path (`requireRole`, `withTenant`-scoped patient/professional lookups) and from-appointment path (`appointment.status === 'COMPLETED'` check, copies patient/professional/`occurredAt`, catches the `appointmentId` unique-constraint violation), calls `logAudit()` on success. Validation: `pnpm test -- create-consultation`. Closes REQ-001, REQ-002, REQ-003, REQ-004, REQ-009, REQ-017 (create half).

## T3: Editing (REQ-010, REQ-017)

- [ ] T3.1 Implement `updateConsultationAction`: accepts `occurredAt`/`professionalId`/`subjective`/`plan`, never `patientId` or `appointmentId`; re-validates changed fields; calls `logAudit()` on success. Validation: `pnpm test -- update-consultation`. Closes REQ-010, REQ-017 (update half).

## T4: List, detail, and RBAC (REQ-011 through REQ-014, REQ-018)

- [ ] T4.1 Implement the consultation list query (`(patientId, occurredAt)`-ordered, projecting only `occurredAt` and the professional's name via the `Professional → Membership → User.name` join from `design.md`). Validation: `pnpm test -- consultation-list-query`. Closes REQ-012.
- [ ] T4.2 Build `src/app/(app)/[orgSlug]/patients/[patientId]/consultations/page.tsx`. Validation: `pnpm test:e2e -- consultation-list`.
- [ ] T4.3 Build `src/app/(app)/[orgSlug]/patients/[patientId]/consultations/[consultationId]/page.tsx`: full detail, calls `logAudit()` for the view. Validation: `pnpm test:e2e -- consultation-detail`. Closes REQ-013, REQ-018.
- [ ] T4.4 Build the `new` and `edit` pages, wired to their respective actions; the `new` page accepts and handles the `?appointmentId=` search param per `design.md`. Validation: `pnpm test:e2e -- consultation-forms`.
- [ ] T4.5 Update `src/app/(app)/[orgSlug]/patients/[patientId]/layout.tsx` (from `phase-2a-clinical-history`) to add the Consultation History tab, hidden for `FRONT_DESK`. Validation: `pnpm test:e2e -- patient-tabs-consultation`. Closes REQ-014 (tab half).
- [ ] T4.6 Test that a `FRONT_DESK` session requesting any consultation route directly is rejected. Validation: `pnpm test:e2e -- consultation-rbac`. Closes REQ-014 (direct-access half).
- [ ] T4.7 Confirm no delete action or route exists anywhere in this spec. Validation: code review during `reviewer`'s pass, no automated test needed for an absence. Closes REQ-011.

## T5: Calendar entry point

- [ ] T5.1 Update `src/components/appointments/calendar.tsx` (from `phase-1c-appointments-calendar`) to add a "document this consultation" link on `COMPLETED` events, pointing to `.../consultations/new?appointmentId=<id>`. Validation: `pnpm test:e2e -- calendar-to-consultation`.

## T6: End-to-end proof

- [ ] T6.1 Playwright E2E: as `NUTRITIONIST`, complete an appointment, click "document this consultation," confirm patient/professional/`occurredAt` are pre-filled and the patient field is locked, save it. Attempt creating a second consultation from the same appointment and confirm it's rejected. Create a standalone consultation for a different patient. Edit one consultation's `plan` text. Confirm the list shows both without full text, and each opens to its full detail. As `FRONT_DESK`, confirm the Consultation History tab isn't visible and a direct URL request is rejected. Validation: `pnpm test:e2e -- consultations-e2e`. Confirms REQ-001 through REQ-018 hold end to end.

## After T6.1

Run `spec-closeout`, then `pr-prep`.
