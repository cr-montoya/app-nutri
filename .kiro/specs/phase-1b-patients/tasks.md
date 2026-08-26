# Tasks: Phase 1b, Patients

Branch: `feat/phase-1b-patients`, created by `task-runner` from up-to-date `main` before T1.1, per `.agents/rules/trunk-based.md`. Depends on `phase-0-scaffold` and `phase-1a-team-invites` being merged first.

## T1: Schema, RLS, and search index (REQ-006, REQ-019, REQ-020)

- [x] T1.1 Add `Patient`, `AuditLog`, and the `Sex` enum to `prisma/schema.prisma` per `design.md`, plus the `Organization.patients`, `Organization.auditLogs`, and `User.auditLogs` back-relations. Validation: `pnpm exec prisma validate`.
- [x] T1.2 Run the migration against the dev Neon branch. Validation: `pnpm exec prisma migrate dev` succeeds.
- [x] T1.3 Add `CREATE EXTENSION IF NOT EXISTS pg_trgm` and the trigram index on `patients."fullName"` to the migration. Validation: manual `psql` check confirming the extension and index exist.
- [x] T1.4 Add the RLS policies for `patients` and `audit_logs` from `design.md` to the migration. Validation: manual `psql` check confirming RLS is enabled and both policies exist.
- [x] T1.5 Positive RLS test: a session scoped to org A reads/writes its own `Patient` and `AuditLog` rows. Validation: `pnpm test -- patient-rls-positive`. Closes REQ-019.
- [x] T1.6 Negative RLS test: a raw `pg` client scoped to org A gets zero rows querying org B's `Patient` or `AuditLog` rows directly. Validation: `pnpm test -- patient-rls-negative`. Closes REQ-020.

## T2: Audit logging (REQ-021, REQ-022)

- [x] T2.1 Implement `logAudit()` in `src/lib/audit.ts` per `design.md`'s signature, reading `ipAddress` from the `x-forwarded-for` header via `next/headers`. Validation: `pnpm test -- audit-log`.

## T3: Patient CRUD Server Actions (REQ-001 through REQ-014, REQ-021)

- [x] T3.1 Write `src/validation/patients.ts`: the shared Zod schema (`fullName`, `phone`, `documentId`, `birthDate`, `sex`, `email`, `address`) with all the bounds and format rules from `requirements.md`. Validation: `pnpm test -- validation`. Closes REQ-002, REQ-003, REQ-004, REQ-008, REQ-009, REQ-010, REQ-011.
- [ ] T3.2 Implement `createPatientAction` in `src/server/actions/patients.ts`: validates via the schema above, catches the `documentId` unique-constraint violation with the generic error, calls `logAudit()` on success. Validation: `pnpm test -- create-patient`. Closes REQ-001, REQ-005, REQ-006, REQ-021.
- [ ] T3.3 Concurrency test: two simultaneous creates with the same organization and document ID, confirming exactly one succeeds. Validation: `pnpm test -- create-patient-race`. Closes REQ-007.
- [ ] T3.4 Implement `updatePatientAction`: reuses the same Zod schema, rejects and leaves the record unchanged on any validation failure, calls `logAudit()` on success. Validation: `pnpm test -- update-patient`. Closes REQ-012, REQ-021.
- [ ] T3.5 Implement `archivePatientAction` and `unarchivePatientAction`: set/clear `archivedAt`, call `logAudit()` on success. Validation: `pnpm test -- archive-patient`. Closes REQ-013, REQ-014, REQ-021.

## T4: List, search, and detail view (REQ-015 through REQ-018, REQ-022, REQ-023)

- [ ] T4.1 Implement the patient list query (default excludes archived, `?archived=true` includes both, `?q=` searches name/document) in a data-access function used by the list page. Validation: `pnpm test -- patient-list-query`. Closes REQ-015, REQ-016, REQ-017.
- [ ] T4.2 Build `src/app/(app)/[orgSlug]/patients/page.tsx`: shell (search box, new-patient button, archived toggle) rendering immediately, list in a `<Suspense>` boundary with a skeleton fallback. Validation: `pnpm test:e2e -- patient-list`.
- [ ] T4.3 Build `src/app/(app)/[orgSlug]/patients/new/page.tsx` and its form, wired to `createPatientAction`. Validation: `pnpm test:e2e -- create-patient`.
- [ ] T4.4 Build `src/app/(app)/[orgSlug]/patients/[patientId]/page.tsx`: displays all fields, calls `logAudit()` for the view. Validation: `pnpm test:e2e -- patient-detail`. Closes REQ-018, REQ-022.
- [ ] T4.5 Build `src/app/(app)/[orgSlug]/patients/[patientId]/edit/page.tsx` and its form, wired to `updatePatientAction`, plus archive/unarchive buttons wired to their actions with `revalidatePath` on both the list and detail paths. Validation: `pnpm test:e2e -- edit-patient`.
- [ ] T4.6 Confirm no `Patient` action in this spec calls `requireRole`; all three roles (`ADMIN`, `NUTRITIONIST`, `FRONT_DESK`) can complete every flow above. Validation: `pnpm test:e2e -- patient-rbac-open`. Closes REQ-023.

## T5: End-to-end proof

- [ ] T5.1 Playwright E2E: as a `FRONT_DESK` member, create a patient, search for them by partial name and by exact document ID, view their profile, edit a field, archive them, confirm they disappear from the default list and appear with the archived filter, unarchive them. Validation: `pnpm test:e2e -- patients-e2e`. Confirms REQ-001 through REQ-023 hold end to end for the least-privileged role.

## After T5.1

Run `spec-closeout`, then `pr-prep`.
