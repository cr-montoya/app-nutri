# Requirements: Phase 2c, Measurements and Calculation Engine

## Objective

Let `ADMIN` and `NUTRITIONIST` members record an `AnthropometricMeasurement` for a `Consultation`, and have the calc-engine registry automatically calculate every applicable body-composition protocol (Durnin-Womersley+Siri, Jackson-Pollock 3-site, BMI, Mifflin-St Jeor BMR) against it, persisting one `BodyCompositionResult` per applicable protocol. This is the last Phase 2 sub-spec; `NutritionalPlan` (Phase 3) and evolution charts (Phase 4) build on the results this spec produces.

## User stories

- As an `ADMIN` or `NUTRITIONIST`, I want to record a patient's weight, height, skinfolds, circumferences, and diameters during a consultation, so their body composition can be calculated.
- As an `ADMIN` or `NUTRITIONIST`, I want every protocol the recorded data supports to calculate automatically, so I don't have to manually pick and run each equation.
- As an `ADMIN` or `NUTRITIONIST`, I want to see which protocols could not be calculated and exactly why (missing birth date, missing sex, missing a required skinfold), so I know what additional data would unlock more results.
- As an `ADMIN` or `NUTRITIONIST`, I want a patient's full measurement and calculation history, not just the latest, so progress and protocol comparisons over time are possible.

## Requirements

- **REQ-001**: WHEN an `ADMIN` or `NUTRITIONIST` member creates an `AnthropometricMeasurement` for a `Consultation` with `weight` and `height`, THE SYSTEM SHALL create the record scoped to their organization and linked 1:1 to that `Consultation`.
- **REQ-002**: THE SYSTEM SHALL ALWAYS require `weight` and `height` to create an `AnthropometricMeasurement`. Every skinfold, circumference, and diameter field is optional.
- **REQ-003**: THE SYSTEM SHALL ALWAYS accept the following optional fields, each independently nullable: skinfolds (`triceps`, `subscapular`, `biceps`, `iliacCrest`, `supraspinale`, `abdominal`, `thigh`, `calf`, and `chest`), circumferences (`waist`, `hip`, `relaxedArm`, `flexedArm`, `calf`), and diameters (`humerus`, `femur`, `wrist`). The `chest` skinfold is new relative to `plan.md` §4's original field list: Jackson-Pollock's 3-site protocol for male patients requires it (chest, abdomen, thigh), and no equivalent field existed without it, which would have made that protocol permanently uncalculable for men. Units: `weight` in kg, `height` in cm, skinfolds in mm, circumferences and diameters in cm.
- **REQ-004**: WHEN a member submits a `weight` outside 20 to 400 kg, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-005**: WHEN a member submits a `height` outside 50 to 250 cm, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-006**: WHEN a member submits any skinfold value outside 2 to 60 mm, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-007**: WHEN a member submits any circumference value outside 5 to 200 cm, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-008**: WHEN a member submits any diameter value outside 1 to 20 cm, THE SYSTEM SHALL reject the submission before creating any record.
- **REQ-009**: WHEN a member attempts to create a second `AnthropometricMeasurement` for a `Consultation` that already has one, THE SYSTEM SHALL reject the request.
- **REQ-010**: THE SYSTEM SHALL ALWAYS enforce REQ-009 via a unique database constraint on `AnthropometricMeasurement`'s link to `Consultation`, not only in application code, so two concurrent creation attempts for the same `Consultation` can never both succeed.
- **REQ-011**: WHEN an `AnthropometricMeasurement` is successfully created or edited, THE SYSTEM SHALL ALWAYS run every registered calc-engine protocol's `isApplicable()` check against the patient's context (sex, age at the `Consultation`'s `occurredAt` date) and the measurement's fields, treating a protocol as applicable only when every one of its required inputs (per REQ-024's site lists, and `weight`/`height` where used) is present and non-null, and SHALL persist a new `BodyCompositionResult` for each protocol found applicable.
- **REQ-012**: THE SYSTEM SHALL ALWAYS compute age, for any age-dependent protocol, as the patient's age at the linked `Consultation`'s `occurredAt` date, not at the moment the calculation runs.
- **REQ-013**: WHEN the patient's `birthDate` is null, THE SYSTEM SHALL treat every protocol whose `isApplicable()` depends on age as not applicable, and SHALL NOT calculate it.
- **REQ-014**: WHEN the patient's `sex` is null, THE SYSTEM SHALL treat every protocol whose `isApplicable()` depends on sex as not applicable.
- **REQ-015**: WHEN a member views the calculation results for a measurement, THE SYSTEM SHALL display both the protocols that were calculated, with their outputs, and the protocols that were not applicable, each with its specific reason (missing birth date, missing sex, or which required skinfold/circumference field was absent).
- **REQ-016**: WHEN an `ADMIN` or `NUTRITIONIST` member edits an existing `AnthropometricMeasurement`'s fields, THE SYSTEM SHALL apply the same validations as creation (REQ-004 through REQ-008), update the record only if they pass, and ALWAYS trigger REQ-011's recalculation; every `BodyCompositionResult` row created before the edit remains unchanged, never modified or deleted.
- **REQ-017**: THE SYSTEM SHALL NOT support deleting an `AnthropometricMeasurement` or any `BodyCompositionResult` once created, by any role.
- **REQ-018**: WHEN an `ADMIN` or `NUTRITIONIST` member views a patient's profile, THE SYSTEM SHALL display that patient's full measurement history across all consultations, ordered most recent first, each entry showing its calculated results per REQ-015.
- **REQ-019**: WHEN a member with role `FRONT_DESK` attempts to view, create, or edit an `AnthropometricMeasurement` or its results, THE SYSTEM SHALL reject the action, and no entry point to this data SHALL be shown to them.
- **REQ-020**: WHEN an authenticated session reads or writes `AnthropometricMeasurement` or `BodyCompositionResult` records, THE SYSTEM SHALL only affect rows whose `organizationId` matches the session's active organization, enforced by the `withTenant` wrapper.
- **REQ-021**: WHEN a query against these tables is issued directly against Postgres with `app.current_org_id` set to organization A, bypassing the Prisma tenant-context wrapper entirely, THE SYSTEM SHALL ALWAYS still return zero rows belonging to organization B, enforced by Row-Level Security policies.
- **REQ-022**: WHEN an `AnthropometricMeasurement` is created or edited, THE SYSTEM SHALL ALWAYS record an `AuditLog` entry naming the action, the acting user, the organization, and the patient's id, per `plan.md` §4's `AuditLog`-mandatory list.
- **REQ-023**: WHEN a member views a measurement's full calculation detail (REQ-015), THE SYSTEM SHALL ALWAYS record an `AuditLog` entry for that access, the same list-versus-detail threshold `phase-1b-patients` and `phase-2b-consultations` already established; viewing the summarized history list (REQ-018) is not logged on its own, only the act of opening one entry's full detail.
- **REQ-024**: THE SYSTEM SHALL calculate exactly these four v1 protocols and no others: Durnin-Womersley (4 skinfolds: triceps, biceps, subscapular, iliacCrest) + Siri equation for body fat percentage; Jackson-Pollock 3-site (chest, abdominal, thigh for male patients; triceps, iliacCrest, thigh for female patients) + Siri equation for body fat percentage; BMI; Mifflin-St Jeor for BMR. The Ramírez/Torun protocol is explicitly out of scope for v1 per `plan.md` §5's validation caveat.

## Out of scope

- The Ramírez/Torun (Colombian population) protocol and any other protocol beyond the four named in REQ-024 (REQ-024).
- `NutritionalPlan` (Phase 3).
- Evolution charts and any visualization of the measurement/results history beyond the plain list in REQ-018 (Phase 4).
- Pediatric patients and any WHO/ICBF growth-chart protocol category, per `plan.md` §5 and §10 and `.kiro/steering/product.md`'s out-of-scope list.
- Letting a member choose which protocol(s) to run. The registry always runs every applicable one (REQ-011).
- Record locking, e-signatures, or a full amendment/version history for edits beyond REQ-016's recalculation-on-edit behavior and the single `AuditLog` entry it produces.
- `FRONT_DESK` access of any kind (REQ-019 explicitly blocks it).
