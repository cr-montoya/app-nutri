# Requirements: Phase 1d, Patient Attachments

## Objective

Let `ADMIN` and `NUTRITIONIST` members upload, view, and delete file attachments (progress photos, lab PDFs) for a patient, stored in Vercel Blob and served through short-lived signed URLs, never a permanent public link. `FRONT_DESK` is excluded entirely: this is the first spec in Phase 1 where that role's "no clinical data" restriction from `.kiro/steering/product.md` actually applies to something, since `Patient` (`phase-1b`) and `Appointment` (`phase-1c`) were both open to all three roles.

`PatientAttachment` references only `Patient` in this phase; `plan.md` §4 also allows a `Consultation` reference, but `Consultation` doesn't exist until Phase 2.

## User stories

- As an `ADMIN` or `NUTRITIONIST`, I want to attach a progress photo or a lab PDF to a patient, so that their file has the supporting documents alongside the rest of their record.
- As an `ADMIN` or `NUTRITIONIST`, I want to view or download an attachment without it being reachable by a public link, so that a patient's photo or lab result isn't exposed if a URL ever leaks.
- As an `ADMIN` or `NUTRITIONIST`, I want to remove an attachment uploaded by mistake, so that the patient's file doesn't accumulate clutter or wrong documents.

## Requirements

- **REQ-001**: WHEN a member with role `ADMIN` or `NUTRITIONIST` uploads a file for a patient in their organization, with a declared content type of `image/jpeg`, `image/png`, `image/webp`, or `application/pdf`, and size at most 10MB, THE SYSTEM SHALL store it in Vercel Blob and create a `PatientAttachment` record scoped to their organization.
- **REQ-002**: WHEN a member requests to upload a file with a declared content type other than the four listed in REQ-001, THE SYSTEM SHALL reject the request before issuing an upload token. WHEN an upload token has been issued with an allowed-content-type constraint, THE SYSTEM SHALL ALWAYS rely on Vercel Blob's own enforcement of that constraint during transfer, not merely trust the client's declared value, so a transfer attempting a disallowed type is rejected by the storage layer itself even if the client lies after token issuance.
- **REQ-003**: THE SYSTEM SHALL ALWAYS verify the file's actual content against its declared content type via a file-signature (magic-byte) check, not the client-supplied `Content-Type` header alone. Because a file over roughly 4.5MB must upload directly from the browser to Vercel Blob storage (Vercel's serverless function body-size limit makes routing it through application code impractical at 10MB), this check runs immediately after transfer completes, not before the bytes reach storage; it is a second layer behind REQ-002's transfer-time content-type constraint, not a replacement for it. WHEN the check fails, THE SYSTEM SHALL ALWAYS delete the file from Vercel Blob storage immediately and SHALL NOT create a `PatientAttachment` record; no failed upload is ever visible to any member, even transiently.
- **REQ-004**: WHEN a member requests to upload a file declared larger than 10MB, THE SYSTEM SHALL reject the request before issuing an upload token. THE SYSTEM SHALL ALWAYS also embed a 10MB maximum-size constraint in every upload token issued, enforced by Vercel Blob's own infrastructure during transfer, so a client that lies about a smaller declared size still cannot transfer more than 10MB.
- **REQ-005**: WHEN a completed upload's actual size is 0 bytes, THE SYSTEM SHALL apply the same immediate-deletion, no-record-created handling as REQ-003; a 0-byte file is below any size constraint Vercel Blob would reject, so it can only be caught after transfer completes.
- **REQ-006**: WHEN a member requests to upload a file whose original filename is longer than 255 characters, THE SYSTEM SHALL reject the request before issuing an upload token, so no bytes ever transfer.
- **REQ-007**: WHEN a member with role `FRONT_DESK` attempts to upload, view, list, or delete a `PatientAttachment`, THE SYSTEM SHALL reject the action.
- **REQ-008**: WHEN a member selects a patient that does not belong to their organization for an attachment upload, THE SYSTEM SHALL reject the submission, even if the request bypasses the UI's own organization-scoped selection.
- **REQ-009**: WHEN an `ADMIN` or `NUTRITIONIST` member views a patient's profile, THE SYSTEM SHALL display the list of that patient's attachments (filename, content type, upload date, uploaded-by member), scoped to their organization, regardless of whether the patient is archived.
- **REQ-010**: WHEN a member requests to view or download a specific attachment, THE SYSTEM SHALL generate a signed URL valid for at most 15 minutes, never a permanent or public URL.
- **REQ-011**: WHEN a signed URL's validity window has expired, THE SYSTEM SHALL ALWAYS reject a request made with it.
- **REQ-012**: WHEN an `ADMIN` or `NUTRITIONIST` member deletes an attachment belonging to a patient in their organization, THE SYSTEM SHALL remove the file from Vercel Blob storage and delete its `PatientAttachment` record.
- **REQ-013**: WHEN an authenticated session reads, creates, or deletes `PatientAttachment` records, THE SYSTEM SHALL only affect rows whose `organizationId` matches the session's active organization, enforced by the `withTenant` wrapper.
- **REQ-014**: WHEN a query against `PatientAttachment` is issued directly against Postgres with `app.current_org_id` set to organization A, bypassing the Prisma tenant-context wrapper entirely, THE SYSTEM SHALL ALWAYS still return zero rows belonging to organization B, enforced by Row-Level Security policies.
- **REQ-015**: WHEN a `PatientAttachment` is created or deleted, THE SYSTEM SHALL ALWAYS record an `AuditLog` entry naming the action, the acting user, the organization, and the patient's id, per `plan.md` §4's `AuditLog`-mandatory list, which explicitly includes `PatientAttachment`.
- **REQ-016**: WHEN a member generates a signed URL to view or download an attachment (REQ-010), THE SYSTEM SHALL ALWAYS record an `AuditLog` entry for that access, the same "detail view" logging threshold `phase-1b-patients` established for `Patient` profiles.

## Out of scope

- Attaching a file to a `Consultation`. Not possible until Phase 2 introduces that model; this phase's `PatientAttachment` only references `Patient`.
- A hard limit on the number of attachments per patient.
- Editing an attachment's metadata (renaming, adding a caption/description). `plan.md` §4 lists only filename/type/upload-date/uploaded-by as metadata; none of it is user-editable after upload. To correct a mistake, delete and re-upload.
- Full malware/virus scanning of uploaded files. The file-signature check (REQ-003) catches type-spoofing but is not a malware scanner; that remains a residual risk to revisit before handling real patient uploads at scale, not a blocker for this phase.
- `FRONT_DESK` access of any kind to `PatientAttachment` (REQ-007 explicitly blocks it).
