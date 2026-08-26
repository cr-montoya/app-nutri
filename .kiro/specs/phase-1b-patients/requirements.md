# Requirements: Phase 1b, Patients

## Objective

Let any member of an organization create, find, view, edit, and archive patient records, with the same strict tenant isolation and RBAC discipline established in `phase-0-scaffold` and `phase-1a-team-invites`. In this phase `Patient` holds only demographic data (no clinical history yet), so all three roles get full access; the `FRONT_DESK`-specific restriction from `plan.md` §6 becomes meaningful once clinical models exist in Phase 2.

## User stories

- As any member of an organization, I want to register a new patient with at least their name and phone number, so that I can start scheduling and treating them without needing every field up front.
- As any member, I want to search for a patient by name or document number, so that I can find them quickly during a busy day.
- As any member, I want to archive a patient who's no longer active, without losing their record, so that old patients don't clutter the active list but their history is never lost.

## Requirements

- **REQ-001**: WHEN a member with role `ADMIN`, `NUTRITIONIST`, or `FRONT_DESK` submits the create-patient form with a full name and a phone number, THE SYSTEM SHALL create a new `Patient` scoped to their organization.
- **REQ-002**: WHEN a member submits a full name shorter than 1 character (empty after trimming) or longer than 200 characters, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-003**: WHEN a member submits a phone number that does not match E.164-style format (optional leading `+`, 7 to 15 digits), THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-004**: WHEN a member submits a non-empty document ID shorter than 1 character (empty after trimming) or longer than 50 characters, THE SYSTEM SHALL reject the submission before creating any record. No further format restriction applies, since valid document types vary (national ID, passport, and similar).
- **REQ-005**: WHEN a member submits a non-empty document ID that already belongs to another `Patient` in the same organization, THE SYSTEM SHALL reject the submission with a clear error and SHALL NOT create the record.
- **REQ-006**: THE SYSTEM SHALL ALWAYS enforce REQ-005 via a unique database constraint on `(organizationId, documentId)` for non-null `documentId` values, not only in application code.
- **REQ-007**: WHEN two `Patient`-creation attempts with the same organization and document ID race, THE SYSTEM SHALL ALWAYS let exactly one succeed, enforced by the constraint in REQ-006; the losing request receives the same generic error as REQ-005.
- **REQ-008**: WHEN a member submits a non-empty birth date that is in the future, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-009**: WHEN a member submits a non-empty email that does not match a valid email address format, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-010**: WHEN a member submits a non-empty sex value that is not `MALE` or `FEMALE`, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-011**: WHEN a member submits a non-empty address longer than 300 characters, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-012**: WHEN a member updates an existing `Patient`'s fields, THE SYSTEM SHALL apply the same validations as creation (REQ-002 through REQ-011) before saving, and SHALL reject the update if any fail, leaving the existing record unchanged.
- **REQ-013**: WHEN a member archives a `Patient`, THE SYSTEM SHALL set an `archivedAt` timestamp on that record.
- **REQ-014**: WHEN a member unarchives a previously archived `Patient`, THE SYSTEM SHALL clear its `archivedAt` timestamp.
- **REQ-015**: WHEN a member views the patient list without an explicit "include archived" filter, THE SYSTEM SHALL show only `Patient` records with a null `archivedAt`, belonging to their organization.
- **REQ-016**: WHEN a member views the patient list with the "include archived" filter enabled, THE SYSTEM SHALL show archived and non-archived patients belonging to their organization, both clearly distinguishable in the response.
- **REQ-017**: WHEN a member searches the patient list with a non-empty text query, THE SYSTEM SHALL return patients whose full name contains the query, case-insensitively, as a partial match, or whose document ID exactly equals the query, scoped to their organization and respecting the archived filter from REQ-015/REQ-016.
- **REQ-018**: WHEN a member views a `Patient`'s profile, THE SYSTEM SHALL display all of that patient's fields, scoped to their organization.
- **REQ-019**: WHEN an authenticated session reads, creates, updates, archives, or unarchives `Patient` records, THE SYSTEM SHALL only affect rows whose `organizationId` matches the session's active organization, enforced by the `withTenant` wrapper.
- **REQ-020**: WHEN a query against `Patient` is issued directly against Postgres with `app.current_org_id` set to organization A, bypassing the Prisma tenant-context wrapper entirely, THE SYSTEM SHALL ALWAYS still return zero rows belonging to organization B, enforced by Row-Level Security policies.
- **REQ-021**: WHEN a `Patient` is created, updated, archived, or unarchived, THE SYSTEM SHALL ALWAYS record an `AuditLog` entry naming the action, the acting user, the organization, and the patient's id. This extends the `AuditLog`-mandatory list in `plan.md` §4 to include `Patient`, per the explicit "audit log on patient creation/edit/view" instruction in `plan.md` §8's Phase 1 description.
- **REQ-022**: WHEN a member views a `Patient`'s profile (REQ-018), THE SYSTEM SHALL ALWAYS record an `AuditLog` entry for that read. Viewing the patient list (REQ-015 through REQ-017) is not logged; only the detail profile view is, the same "detail view" threshold `plan.md` §4 already applies to `ClinicalHistory`/`Consultation`.
- **REQ-023**: WHEN a member with role `ADMIN`, `NUTRITIONIST`, or `FRONT_DESK` performs any `Patient` action covered by this spec (create, read, update, archive, unarchive, search), THE SYSTEM SHALL allow it. No role is restricted from any `Patient` action in this phase.

## Out of scope

- `ClinicalHistory`, `Consultation`, `AnthropometricMeasurement`, `BodyCompositionResult`, `NutritionalPlan`, and any UI for them (Phase 2 and later).
- `Appointment` and the calendar (`phase-1c-appointments-calendar`).
- `PatientAttachment` and file upload (`phase-1d-attachments`).
- Restricting `FRONT_DESK` from any `Patient` field or action. That restriction becomes meaningful once clinical data exists on or alongside `Patient` in a later phase; revisit this spec's REQ-023 then, don't preemptively restrict a field that doesn't exist yet.
- Bulk import of patients (CSV upload or similar).
- Hard deletion of a `Patient` record. Only archiving (REQ-013/REQ-014) is supported; if a real deletion capability is ever needed, it's a separate, deliberate spec given the audit and future-clinical-data implications.
- Any patient-facing login or self-service portal. Patients are never platform users in this product; see `.kiro/steering/product.md`.
