# Tasks: Phase 1d, Patient Attachments

Branch: `feat/phase-1d-attachments`, created by `task-runner` from up-to-date `main` before T1.1, per `.agents/rules/trunk-based.md`. Depends on `phase-0-scaffold` and `phase-1b-patients` being merged first.

## T1: Schema and RLS (REQ-013, REQ-014)

- [ ] T1.1 Add `PatientAttachment` to `prisma/schema.prisma` per `design.md`, plus the `Organization`, `Patient`, and `User` back-relations. Validation: `pnpm exec prisma validate`.
- [ ] T1.2 Run the migration against the dev Neon branch. Validation: `pnpm exec prisma migrate dev` succeeds.
- [ ] T1.3 Add the RLS policy from `design.md` to the migration. Validation: manual `psql` check confirming RLS is enabled and the policy exists.
- [ ] T1.4 Positive RLS test: a session scoped to org A reads/writes its own attachment records. Validation: `pnpm test -- attachment-rls-positive`. Closes REQ-013.
- [ ] T1.5 Negative RLS test: a raw `pg` client scoped to org A gets zero rows querying org B's attachment records directly. Validation: `pnpm test -- attachment-rls-negative`. Closes REQ-014.

## T2: Upload Route Handler (REQ-001 through REQ-008, REQ-015)

- [ ] T2.1 Add `file-type` as a dependency. Validation: `pnpm install` completes.
- [ ] T2.2 Write `src/validation/attachments.ts`: the pre-transfer Zod schema (declared content type, declared size, filename length). Validation: `pnpm test -- validation`.
- [ ] T2.3 Implement `onBeforeGenerateToken` in `src/app/api/attachments/upload/route.ts`: `requireRole(['ADMIN', 'NUTRITIONIST'])`, `withTenant`-scoped patient lookup, pre-transfer validation, and the `allowedContentTypes`/`maximumSizeInBytes` token constraints. Validation: `pnpm test -- upload-token-generation`. Closes REQ-002 (pre-transfer half), REQ-004 (pre-transfer half), REQ-006, REQ-007, REQ-008.
- [ ] T2.4 Test that Vercel Blob's own token-constraint enforcement rejects a transfer exceeding the declared content type or 10MB size, independent of application code. Validation: `pnpm test -- upload-token-enforcement`. Closes REQ-002 (transfer-time half), REQ-004 (transfer-time half).
- [ ] T2.5 Implement `onUploadCompleted`: fetch the transferred blob, run the `file-type` magic-byte check and the 0-byte check, `del()` and return with no record created on failure. Validation: `pnpm test -- upload-validation-failure`. Closes REQ-003, REQ-005.
- [ ] T2.6 On validation success, create the `PatientAttachment` record inside `withTenant` (using `organizationId` from the token payload) and call `logAudit()`. Validation: `pnpm test -- upload-validation-success`. Closes REQ-001, REQ-015 (create half).

## T3: Delete and signed-URL download (REQ-009 through REQ-012, REQ-015, REQ-016)

- [ ] T3.1 Implement `getAttachmentDownloadUrlAction`: `withTenant`-scoped lookup, generates a signed URL valid for at most 15 minutes (confirm the exact `@vercel/blob` SDK call against current docs), calls `logAudit()`. Validation: `pnpm test -- attachment-download-url`. Closes REQ-010, REQ-016.
- [ ] T3.2 Test that a signed URL rejects a request made after its validity window expires. Validation: `pnpm test -- attachment-signed-url-expiry`. Closes REQ-011.
- [ ] T3.3 Implement `deleteAttachmentAction`: `withTenant`-scoped lookup, `del()` on the Blob pathname, deletes the `PatientAttachment` row, calls `logAudit()`, revalidates the patient detail page. Validation: `pnpm test -- delete-attachment`. Closes REQ-012, REQ-015 (delete half).
- [ ] T3.4 Implement the attachment list query for the patient detail page, `withTenant`-scoped, independent of `archivedAt`. Validation: `pnpm test -- attachment-list-query`. Closes REQ-009.

## T4: Upload UI and the validation-race fix (REQ-007)

- [ ] T4.1 Build `src/components/patients/attachment-upload.tsx`: Client Component, file input restricted to the four allowed content types client-side (a UX nicety, not a security boundary since REQ-002's real enforcement is server-side), calls `@vercel/blob/client`'s `upload()` against the Route Handler. Validation: `pnpm test:e2e -- attachment-upload-ui`.
- [ ] T4.2 Implement the "validating..." transient state and the bounded-attempt polling described in `design.md`'s "Client-side upload/validation race" section; on the polling window elapsing without the new attachment appearing, show a rejected-upload message. Validation: `pnpm test:e2e -- attachment-upload-race`.
- [ ] T4.3 Update `src/app/(app)/[orgSlug]/patients/[patientId]/page.tsx` (from `phase-1b-patients`) with the attachments section: list, download links (via `getAttachmentDownloadUrlAction`), delete buttons, and the upload component, all hidden for `FRONT_DESK`. Validation: `pnpm test:e2e -- patient-attachments-section`. Closes REQ-007 (UI half).

## T5: End-to-end proof

- [ ] T5.1 Playwright E2E: as `NUTRITIONIST`, upload a valid JPEG under 10MB to a patient, confirm it appears after the validation delay, download it via a signed URL, delete it, confirm it's gone from the list. Attempt uploading a `.txt` file renamed to `.jpg` and confirm it's rejected (magic-byte check) and never appears in the list. As `FRONT_DESK`, confirm the attachments section is not shown at all. Validation: `pnpm test:e2e -- attachments-e2e`. Confirms REQ-001 through REQ-016 hold end to end.

## After T5.1

Run `spec-closeout`, then `pr-prep`.
