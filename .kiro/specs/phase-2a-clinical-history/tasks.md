# Tasks: Phase 2a, Clinical History

Branch: `feat/phase-2a-clinical-history`, created by `task-runner` from up-to-date `main` before T1.1, per `.agents/rules/trunk-based.md`. Depends on `phase-0-scaffold` and `phase-1b-patients` being merged first.

## T1: Schema and RLS (REQ-014, REQ-015)

- [ ] T1.1 Add `ClinicalHistory` to `prisma/schema.prisma` per `design.md`, plus the `Organization.clinicalHistories` and `Patient.clinicalHistory` back-relations. Validation: `pnpm exec prisma validate`.
- [ ] T1.2 Run the migration against the dev Neon branch. Validation: `pnpm exec prisma migrate dev` succeeds.
- [ ] T1.3 Add the RLS policy from `design.md` to the migration. Validation: manual `psql` check confirming RLS is enabled and the policy exists.
- [ ] T1.4 Positive RLS test: a session scoped to org A reads/writes its own `ClinicalHistory` row. Validation: `pnpm test -- clinical-history-rls-positive`. Closes REQ-014.
- [ ] T1.5 Negative RLS test: a raw `pg` client scoped to org A gets zero rows querying org B's `ClinicalHistory` directly. Validation: `pnpm test -- clinical-history-rls-negative`. Closes REQ-015.

## T2: Validation and the update action (REQ-001 through REQ-010, REQ-013, REQ-016)

- [ ] T2.1 Write `src/validation/clinical-history.ts`: Zod schemas for all six categories per `requirements.md`'s REQ-005 through REQ-010, each array capped at 50 items (REQ-004), all six top-level fields optional (REQ-003). Validation: `pnpm test -- validation`. Closes REQ-003 through REQ-010.
- [ ] T2.2 Implement `updateClinicalHistoryAction` in `src/server/actions/clinical-history.ts`: `requireRole(['ADMIN', 'NUTRITIONIST'])`, `withTenant`-scoped patient lookup, `upsert` keyed on `patientId`, calls `logAudit()` on success. Validation: `pnpm test -- update-clinical-history`. Closes REQ-001, REQ-002, REQ-013, REQ-016.

## T3: Background tab and RBAC (REQ-011, REQ-012, REQ-017)

- [ ] T3.1 Build `src/app/(app)/[orgSlug]/patients/[patientId]/layout.tsx`: the tab strip, reading the session to hide the Background link for `FRONT_DESK`. Validation: `pnpm test:e2e -- patient-tabs`.
- [ ] T3.2 Build `src/app/(app)/[orgSlug]/patients/[patientId]/background/page.tsx`: `requireRole(['ADMIN', 'NUTRITIONIST'])` gating the fetch, all six categories rendered with empty ones shown as such, calls `logAudit()` for the view. Validation: `pnpm test:e2e -- background-tab`. Closes REQ-011, REQ-012, REQ-017.
- [ ] T3.3 Test that a `FRONT_DESK` session requesting `/background` directly (bypassing the hidden tab link) is rejected. Validation: `pnpm test:e2e -- background-tab-rbac`. Closes REQ-012 (direct-access half).

## T4: End-to-end proof

- [ ] T4.1 Playwright E2E: as `NUTRITIONIST`, open a patient with no clinical history, confirm all six categories show empty, submit one item in three of the six categories, confirm they persist and display correctly, submit an update replacing one category's list, confirm the old items are gone and the new ones show. As `FRONT_DESK`, confirm the Background tab isn't visible and a direct URL request is rejected. Validation: `pnpm test:e2e -- clinical-history-e2e`. Confirms REQ-001 through REQ-017 hold end to end.

## After T4.1

Run `spec-closeout`, then `pr-prep`.
