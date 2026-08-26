# Requirements: Phase 1c, Appointments and Calendar

## Objective

Let any member schedule, reschedule, and manage the status of appointments between a patient and a professional, displayed on a calendar with a column per professional, with the same tenant isolation discipline as prior phases and no double-booking for a professional.

## User stories

- As any member, I want to schedule an appointment for a patient with a professional, so that we know when to expect them.
- As any member, I want to see all appointments on a calendar with a column per professional, so that I can see everyone's schedule at a glance.
- As any member, I want to update an appointment's status as it happens (confirmed, completed, cancelled, no-show), so that the record reflects reality.

## Requirements

- **REQ-001**: WHEN a member submits a create-appointment form with a patient, a professional, and a start date/time, all belonging to their organization, THE SYSTEM SHALL create a new `Appointment` with status `SCHEDULED`, scoped to their organization.
- **REQ-002**: WHEN a member submits an appointment without specifying a duration, THE SYSTEM SHALL default it to 30 minutes.
- **REQ-003**: WHEN a member submits a duration shorter than 5 minutes or longer than 480 minutes, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-004**: WHEN a member submits a start date/time in the past, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-005**: THE SYSTEM SHALL ALWAYS interpret and store every appointment date/time in the `America/Bogota` timezone (UTC-5, no daylight saving) for this phase; multi-timezone support is not in scope.
- **REQ-006**: WHEN a member submits a create or reschedule request whose time range overlaps an existing `SCHEDULED` or `CONFIRMED` appointment for the same professional, THE SYSTEM SHALL reject it with a clear conflict error and SHALL NOT create or modify the record. An appointment being rescheduled never conflicts with its own current, pre-reschedule slot.
- **REQ-007**: THE SYSTEM SHALL ALWAYS enforce REQ-006 at the database level, not only in application code, so a race between two requests can never both succeed.
- **REQ-008**: WHEN a member selects a patient or a professional that does not belong to their organization, THE SYSTEM SHALL reject the submission, even if the request bypasses the UI's own organization-scoped selection lists.
- **REQ-009**: WHEN a member submits a non-empty reason longer than 200 characters, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-010**: WHEN a member submits non-empty notes longer than 2000 characters, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-011**: WHEN a member edits an `Appointment` that is in status `SCHEDULED` or `CONFIRMED`, THE SYSTEM SHALL allow changing any of: date/time, duration, assigned professional, reason, and notes, independently or together, applying REQ-003 and REQ-006 through REQ-010 to whichever new values are submitted, and SHALL update the record only if all pass. THE SYSTEM SHALL NOT allow changing the patient on an existing appointment; to assign a different patient, the member cancels the appointment and creates a new one.
- **REQ-012**: WHEN a member attempts to reschedule an `Appointment` in status `COMPLETED`, `CANCELLED`, or `NO_SHOW`, THE SYSTEM SHALL reject it.
- **REQ-013**: WHEN a member drags an appointment on the calendar to a new time slot or a different professional's column, THE SYSTEM SHALL apply the same rules as REQ-011/REQ-012, since dragging submits the same reschedule operation (including professional reassignment) as the form does.
- **REQ-014**: WHEN a member transitions an `Appointment` from `SCHEDULED` to `CONFIRMED`, THE SYSTEM SHALL allow it.
- **REQ-015**: WHEN a member transitions an `Appointment` from `SCHEDULED` or `CONFIRMED` to `COMPLETED`, THE SYSTEM SHALL allow it.
- **REQ-016**: WHEN a member transitions an `Appointment` from `SCHEDULED` or `CONFIRMED` to `CANCELLED` or `NO_SHOW`, THE SYSTEM SHALL allow it.
- **REQ-017**: WHEN a member attempts any status transition not explicitly allowed by REQ-014, REQ-015, or REQ-016, including any transition away from `COMPLETED`, `CANCELLED`, or `NO_SHOW`, THE SYSTEM SHALL reject it.
- **REQ-018**: WHEN two status-transition requests for the same `Appointment` race, THE SYSTEM SHALL ALWAYS let exactly one succeed, using a conditional update keyed on the status the request expects the appointment to currently have; the loser receives an error stating the appointment's status already changed, and SHALL re-fetch the current state rather than retry blindly.
- **REQ-019**: WHEN a member views the calendar for a date range, THE SYSTEM SHALL display appointments in that range grouped into a column per professional, scoped to their organization.
- **REQ-020**: WHEN a member views the calendar, THE SYSTEM SHALL visually distinguish, at minimum, `SCHEDULED`/`CONFIRMED` appointments from `COMPLETED`/`CANCELLED`/`NO_SHOW` ones.
- **REQ-021**: WHEN an authenticated session reads, creates, updates, reschedules, or transitions `Appointment` records, THE SYSTEM SHALL only affect rows whose `organizationId` matches the session's active organization, enforced by the `withTenant` wrapper.
- **REQ-022**: WHEN a query against `Appointment` is issued directly against Postgres with `app.current_org_id` set to organization A, bypassing the Prisma tenant-context wrapper entirely, THE SYSTEM SHALL ALWAYS still return zero rows belonging to organization B, enforced by Row-Level Security policies.
- **REQ-023**: WHEN a member with role `ADMIN`, `NUTRITIONIST`, or `FRONT_DESK` performs any `Appointment` action covered by this spec, THE SYSTEM SHALL allow it, per `plan.md` §6's permission matrix, which grants all three roles "Schedule/manage appointments."

## Out of scope

- Creating a `Consultation` from a completed appointment. `plan.md` §8 places `Consultation` creation in Phase 2; this spec only manages the `Appointment` record and its status, including `COMPLETED`, with no clinical record attached yet.
- Changing the patient on an existing appointment (REQ-011 explicitly blocks this; cancel and recreate instead).
- Multi-timezone support (REQ-005 fixes `America/Bogota` for this phase).
- Reminders or notifications (SMS/email) for upcoming appointments.
- Recurring or repeating appointment series.
- `AuditLog` entries for `Appointment` actions. Unlike `Patient` (explicitly called out in `plan.md` §8), `Appointment` is not in `plan.md` §4's `AuditLog`-mandatory list; this is a deliberate scope match to `plan.md`, not an oversight.
- Any patient-facing calendar or self-booking capability; patients are never platform users, see `.kiro/steering/product.md`.
- Deactivating or removing a professional from the assignable list; every `Professional` from `phase-1a-team-invites` is selectable.
