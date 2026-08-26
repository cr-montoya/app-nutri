# Requirements: Phase 2a, Clinical History

## Objective

Let `ADMIN` and `NUTRITIONIST` members record and review a patient's clinical background (family history, personal pathologies, allergies, medications, surgeries, habits) as a single, flexible record per patient. `FRONT_DESK` has no access at all, per `plan.md` §6's permission matrix ("View clinical history/consultations: no" for that role) and `.kiro/steering/product.md`'s description of that role.

## User stories

- As an `ADMIN` or `NUTRITIONIST`, I want to record a patient's clinical background across several categories, so that I have the full picture before planning their nutrition.
- As an `ADMIN` or `NUTRITIONIST`, I want to update that background over time as I learn more or as it changes, so that the record stays current.
- As an `ADMIN` or `NUTRITIONIST`, I want to see a patient's clinical background at a glance on their profile, so that I don't have to hunt for it during a consultation.

## Requirements

- **REQ-001**: WHEN an `ADMIN` or `NUTRITIONIST` member submits clinical history data for a patient in their organization that has no existing `ClinicalHistory` record, THE SYSTEM SHALL create one linked to that patient.
- **REQ-002**: WHEN an `ADMIN` or `NUTRITIONIST` member submits clinical history data for a patient that already has a `ClinicalHistory` record, THE SYSTEM SHALL update the existing record, replacing each submitted category's list wholesale (this is a whole-record edit, not per-item CRUD).
- **REQ-003**: THE SYSTEM SHALL ALWAYS treat `familyHistory`, `personalPathologies`, `allergies`, `medications`, `surgeries`, and `habits` as independently optional; a member may submit any subset of these six categories without needing to fill in the others.
- **REQ-004**: WHEN a member submits more than 50 items in any single category, THE SYSTEM SHALL reject the submission before saving anything.
- **REQ-005**: WHEN a member submits a `familyHistory` item, THE SYSTEM SHALL require `relation` and `condition`, each between 1 and 200 characters, with an optional `notes` up to 2000 characters.
- **REQ-006**: WHEN a member submits a `personalPathologies` item, THE SYSTEM SHALL require `condition` between 1 and 200 characters, with an optional `diagnosedAt` date not in the future and an optional `notes` up to 2000 characters.
- **REQ-007**: WHEN a member submits an `allergies` item, THE SYSTEM SHALL require `substance` between 1 and 200 characters, with an optional `reaction` up to 200 characters and an optional `severity`. WHEN `severity` is present and is not exactly `mild`, `moderate`, or `severe`, THE SYSTEM SHALL reject the submission before saving anything.
- **REQ-008**: WHEN a member submits a `medications` item, THE SYSTEM SHALL require `name` between 1 and 200 characters, with an optional `dose` and an optional `frequency`, each up to 100 characters.
- **REQ-009**: WHEN a member submits a `surgeries` item, THE SYSTEM SHALL require `procedure` between 1 and 200 characters, with an optional `date` not in the future and an optional `notes` up to 2000 characters.
- **REQ-010**: WHEN a member submits a `habits` item, THE SYSTEM SHALL require `category` between 1 and 100 characters, with an optional `description` up to 2000 characters.
- **REQ-011**: WHEN an `ADMIN` or `NUTRITIONIST` member views a patient's profile, THE SYSTEM SHALL display that patient's clinical history under a Background tab, showing all six categories; a category with no items is shown as empty, not hidden.
- **REQ-012**: WHEN a member with role `FRONT_DESK` attempts to view, create, or edit a `ClinicalHistory` record, THE SYSTEM SHALL reject the action, and the Background tab SHALL NOT be shown to them at all.
- **REQ-013**: WHEN a member selects a patient that does not belong to their organization for a clinical history submission, THE SYSTEM SHALL reject the submission, even if the request bypasses the UI's own organization-scoped selection.
- **REQ-014**: WHEN an authenticated session reads or writes `ClinicalHistory` records, THE SYSTEM SHALL only affect rows whose `organizationId` matches the session's active organization, enforced by the `withTenant` wrapper.
- **REQ-015**: WHEN a query against `ClinicalHistory` is issued directly against Postgres with `app.current_org_id` set to organization A, bypassing the Prisma tenant-context wrapper entirely, THE SYSTEM SHALL ALWAYS still return zero rows belonging to organization B, enforced by Row-Level Security policies.
- **REQ-016**: WHEN a `ClinicalHistory` record is created or updated, THE SYSTEM SHALL ALWAYS record an `AuditLog` entry naming the action, the acting user, the organization, and the patient's id, per `plan.md` §4's `AuditLog`-mandatory list, which explicitly includes `ClinicalHistory`.
- **REQ-017**: WHEN a member views a patient's Background tab (REQ-011), THE SYSTEM SHALL ALWAYS record an `AuditLog` entry for that access, per `plan.md` §4's explicit instruction to log reads "at minimum on `ClinicalHistory`... detail views."

## Out of scope

- Per-item CRUD (editing or deleting a single allergy or medication independently). REQ-002 replaces each submitted category wholesale; the form re-submits the full list.
- Optimistic-concurrency conflict detection. Two members editing the same patient's clinical history at once resolve last-write-wins; no version check or merge UI in this phase.
- A generic free-text field beyond the six named categories. `plan.md` §4 lists exactly these six; anything else is a future spec if it turns out to be needed.
- `FRONT_DESK` access of any kind (REQ-012 explicitly blocks it).
