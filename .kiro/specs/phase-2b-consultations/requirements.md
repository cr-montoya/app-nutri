# Requirements: Phase 2b, Consultations

## Objective

Let `ADMIN` and `NUTRITIONIST` members record the visit itself: a `Consultation`, created either standalone or from a completed `Appointment`, holding free-text subjective notes and a plan. This is the record later phases attach measurements, calculated body composition, and nutritional plans to; this spec covers only the `Consultation` record and its place in the patient's history.

## User stories

- As an `ADMIN` or `NUTRITIONIST`, I want to document a consultation right after a completed appointment, so that the visit's record is linked to when it was scheduled to happen.
- As an `ADMIN` or `NUTRITIONIST`, I want to document a walk-in consultation with no prior appointment, so that I'm not forced to backfill a fake appointment just to record a visit.
- As an `ADMIN` or `NUTRITIONIST`, I want to see a patient's consultation history at a glance, then open any one for its full detail, so that a long history doesn't overwhelm the summary view.

## Requirements

- **REQ-001**: WHEN an `ADMIN` or `NUTRITIONIST` member creates a standalone `Consultation` (not linked to an appointment) by selecting a patient and a professional in their organization, with an `occurredAt` date/time, THE SYSTEM SHALL create a new `Consultation` scoped to their organization.
- **REQ-002**: WHEN an `ADMIN` or `NUTRITIONIST` member creates a `Consultation` from a completed `Appointment`, THE SYSTEM SHALL populate the new `Consultation`'s patient and professional from that appointment, link it via `appointmentId`, and default `occurredAt` to the appointment's `startAt`; `occurredAt` and the professional remain editable before saving, the patient does not.
- **REQ-003**: WHEN a member attempts to create a `Consultation` from an `Appointment` that is not in status `COMPLETED`, THE SYSTEM SHALL reject the request.
- **REQ-004**: WHEN a member attempts to create a `Consultation` from an `Appointment` that already has a linked `Consultation`, THE SYSTEM SHALL reject the request.
- **REQ-005**: THE SYSTEM SHALL ALWAYS enforce REQ-004 via a unique database constraint on `Consultation.appointmentId` for non-null values, not only in application code, so two concurrent attempts to create a `Consultation` from the same appointment can never both succeed; the losing request receives the same rejection as REQ-004.
- **REQ-006**: WHEN a member submits an `occurredAt` in the future, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-007**: WHEN a member submits non-empty `subjective` text longer than 5000 characters, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-008**: WHEN a member submits non-empty `plan` text longer than 5000 characters, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-009**: WHEN a member selects a patient, professional, or appointment that does not belong to their organization, THE SYSTEM SHALL reject the submission, even if the request bypasses the UI's own organization-scoped selection.
- **REQ-010**: WHEN an `ADMIN` or `NUTRITIONIST` member edits an existing `Consultation`'s `occurredAt`, `professional`, `subjective`, or `plan` fields, THE SYSTEM SHALL apply the same validations as creation and update the record only if they pass. The linked patient and appointment, if any, are never editable after creation.
- **REQ-011**: THE SYSTEM SHALL NOT support deleting a `Consultation` once created, by any role. A mistaken entry is corrected via REQ-010's edit, never removed.
- **REQ-012**: WHEN an `ADMIN` or `NUTRITIONIST` member views a patient's profile, THE SYSTEM SHALL display a list of that patient's consultations under a Consultation History tab, ordered most recent first, showing `occurredAt` and the professional's name but not the `subjective`/`plan` text.
- **REQ-013**: WHEN a member selects a specific consultation from that list, THE SYSTEM SHALL display its full detail: `occurredAt`, professional, `subjective`, and `plan`.
- **REQ-014**: WHEN a member with role `FRONT_DESK` attempts to view, create, or edit a `Consultation`, THE SYSTEM SHALL reject the action, and the Consultation History tab SHALL NOT be shown to them at all.
- **REQ-015**: WHEN an authenticated session reads or writes `Consultation` records, THE SYSTEM SHALL only affect rows whose `organizationId` matches the session's active organization, enforced by the `withTenant` wrapper.
- **REQ-016**: WHEN a query against `Consultation` is issued directly against Postgres with `app.current_org_id` set to organization A, bypassing the Prisma tenant-context wrapper entirely, THE SYSTEM SHALL ALWAYS still return zero rows belonging to organization B, enforced by Row-Level Security policies.
- **REQ-017**: WHEN a `Consultation` is created or updated, THE SYSTEM SHALL ALWAYS record an `AuditLog` entry naming the action, the acting user, the organization, and the patient's id, per `plan.md` §4's `AuditLog`-mandatory list.
- **REQ-018**: WHEN a member views a consultation's full detail (REQ-013), THE SYSTEM SHALL ALWAYS record an `AuditLog` entry for that access, per `plan.md` §4's explicit instruction to log reads on `Consultation` detail views. Viewing the list (REQ-012) is not logged, the same list-versus-detail threshold `phase-1b-patients` and `phase-2a-clinical-history` already established.

## Out of scope

- `AnthropometricMeasurement`, `BodyCompositionResult`, and the calculation engine (`phase-2c-measurements-calc-engine`).
- `NutritionalPlan` (Phase 3).
- Retroactively linking an already-created standalone `Consultation` to an `Appointment`. The link is only established at creation time (REQ-002).
- Record locking, e-signatures, or an amendment/version history for edits. REQ-010 allows a straightforward edit with no time limit or audit trail beyond the single `AuditLog` entry it produces; a fuller compliance-grade amendment history is a residual consideration, not a blocker for this phase.
- `FRONT_DESK` access of any kind (REQ-014 explicitly blocks it).
