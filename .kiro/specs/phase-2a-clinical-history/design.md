# Design: Phase 2a, Clinical History

## Architecture touched

One new tenant-scoped model (`ClinicalHistory`), `rbac.ts`'s second real caller (after `phase-1d-attachments`), and the first tab-style navigation in the patient profile, which requires adding a shared layout rather than editing the existing overview page in place. Specialist personas applied: `database-architect.md` (schema, RLS) and `nextjs-architect.md` (routing, the new layout).

## Schema (database-architect)

```prisma
model ClinicalHistory {
  id                  String   @id @default(cuid())
  organizationId      String
  patientId           String   @unique
  familyHistory       Json?
  personalPathologies Json?
  allergies           Json?
  medications         Json?
  surgeries           Json?
  habits              Json?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  organization        Organization @relation(fields: [organizationId], references: [id])
  patient             Patient      @relation(fields: [patientId], references: [id])
  @@index([organizationId])
  @@map("clinical_histories")
}
```

`Organization` and `Patient` each gain the corresponding back-relation (`clinicalHistory` for `Patient`, singular, since it's 1:1; `clinicalHistories ClinicalHistory[]` for `Organization`).

Design decisions:

- **`patientId` is `@unique`**, enforcing the 1:1 relationship with `Patient` at the database level, the same pattern `phase-0-scaffold` used for `Membership.userId`.
- **Each JSON column stores an array of the shape REQ-005 through REQ-010 define**, validated by Zod at the application boundary (`src/validation/clinical-history.ts`), not by a Postgres `CHECK` constraint. `plan.md` §4 explicitly chose flexible JSON over rigid columns for this entity; a `CHECK` constraint enforcing per-item shape would fight that intent and be painful to evolve. The 50-item cap (REQ-004) and per-field length bounds (REQ-005 through REQ-010) are Zod-only, matching how `phase-2a`'s own Requirements describe them as submission-time rejections, not stored invariants.
- **No `status`/`completeness` field.** Whether a category is "filled in" is just whether its JSON array is non-null and non-empty; REQ-011's "shown as empty, not hidden" is a display-time check (`(history?.allergies ?? []).length === 0`), not a stored flag.

## RLS policy (database-architect checklist)

```sql
ALTER TABLE clinical_histories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clinical_histories
  USING ("organizationId" = current_setting('app.current_org_id', true));
```

- [x] `ENABLE ROW LEVEL SECURITY` present.
- [x] Policy references `current_setting`, set server-side only.
- [ ] Positive test (task): a session scoped to org A reads/writes its own `ClinicalHistory` row. Satisfies REQ-014.
- [ ] Negative test (task): a raw `pg` client scoped to org A gets zero rows querying org B's `ClinicalHistory` directly. Satisfies REQ-015.
- [x] Policy overhead: `organizationId` is indexed; `patientId`'s unique index also serves the common "look up this patient's history" query.

## Routing and rendering (nextjs-architect)

`plan.md` §7 calls for the patient profile in tabs (Overview, Background, Consultation History, Nutritional Plans); this is the first spec to actually need more than one tab, since `phase-1b-patients` and `phase-1d-attachments` both added to the single overview page. Introducing real tabs now, rather than continuing to pile sections onto one page, means adding a shared layout:

| Route | Rendering | Data fetching | Streaming |
|---|---|---|---|
| `(app)/[orgSlug]/patients/[patientId]/layout.tsx` (new) | Server Component: tab navigation (Overview, Background; Consultation History and Nutritional Plans added by later phases) | Reads the session (already resolved by the parent `[orgSlug]/layout.tsx`, not re-fetched from the database) to conditionally render the Background tab link only for `ADMIN`/`NUTRITIONIST` | No |
| `(app)/[orgSlug]/patients/[patientId]/page.tsx` (unchanged) | Unchanged from `phase-1b-patients`/`phase-1d-attachments`; now rendered as the layout's default child | Unchanged | No |
| `(app)/[orgSlug]/patients/[patientId]/background/page.tsx` (new) | Server Component; renders nothing but a "not available" state for `FRONT_DESK` per REQ-012, resolved via `requireRole` before querying anything | Direct fetch of the patient's `ClinicalHistory` (may be null if never created) | No |

The layout does not re-fetch or duplicate the `orgSlug`/session resolution the parent `[orgSlug]/layout.tsx` (from `phase-0-scaffold`) already does; it only adds the tab strip, consistent with `nextjs-architect.md`'s guidance against re-deriving context per page.

`updateClinicalHistoryAction`'s `revalidatePath` targets exactly `(app)/[orgSlug]/patients/[patientId]/background`, not the whole patient tree.

## Requirement coverage

| REQ | Covered by |
|---|---|
| REQ-001 | `updateClinicalHistoryAction`: `upsert` on `ClinicalHistory` keyed by `patientId` |
| REQ-002 | Same action; `upsert`'s update branch replaces each submitted field wholesale |
| REQ-003 | Zod schema in `src/validation/clinical-history.ts`: all six top-level fields `.optional()` |
| REQ-004 | Zod `.max(50)` on each category array |
| REQ-005 | Zod object schema for `familyHistory` items: `relation`/`condition` `.min(1).max(200)`, `notes` `.max(2000).optional()` |
| REQ-006 | Same pattern for `personalPathologies`, plus a `.refine()` rejecting a future `diagnosedAt` |
| REQ-007 | Same pattern for `allergies`, `severity` as a Zod enum of the three literal values |
| REQ-008 | Same pattern for `medications` |
| REQ-009 | Same pattern for `surgeries`, future-date refinement on `date` |
| REQ-010 | Same pattern for `habits` |
| REQ-011 | `background/page.tsx`: renders all six categories, each defaulting to an empty list |
| REQ-012 | `requireRole(['ADMIN', 'NUTRITIONIST'])` in `background/page.tsx` and `updateClinicalHistoryAction`; the tab navigation in the shared layout omits the Background tab entirely for `FRONT_DESK` sessions |
| REQ-013 | `withTenant`-scoped patient lookup in `updateClinicalHistoryAction`; a foreign patient id resolves to "not found" |
| REQ-014 | `withTenant` on every `ClinicalHistory` read/write |
| REQ-015 | RLS policy above |
| REQ-016 | `logAudit()` call in `updateClinicalHistoryAction` |
| REQ-017 | `logAudit()` call in `background/page.tsx`'s fetch |

## Multi-tenant isolation and RBAC impact

`ClinicalHistory` is a new tenant-scoped table; both isolation layers apply (REQ-014, REQ-015). RBAC: `rbac.ts`'s second real caller, `requireRole(['ADMIN', 'NUTRITIONIST'])`, gating both the read (`background/page.tsx`) and the write (`updateClinicalHistoryAction`); `FRONT_DESK` is fully excluded (REQ-012), the second role restriction in this project after `phase-1d-attachments`'s.

## Files to create or update

```
prisma/schema.prisma                                                # update: ClinicalHistory model, back-relations
prisma/migrations/.../migration.sql                                   # generated; includes RLS, added manually
src/validation/clinical-history.ts                                     # new: Zod schemas for the six categories
src/server/actions/clinical-history.ts                                  # new: updateClinicalHistoryAction
src/app/(app)/[orgSlug]/patients/[patientId]/layout.tsx                 # new: tab navigation
src/app/(app)/[orgSlug]/patients/[patientId]/background/page.tsx         # new
```

## Reused vs. new

Reused: `withTenant`, the RLS policy shape, `logAudit()`, the Server Action + Zod validation pattern, `requireRole` (its second caller), `revalidatePath` scoping, the upsert-for-1:1-record pattern (first used by `phase-1a-team-invites`'s professional profile). New: the `ClinicalHistory` model, the patient-profile tab layout (the shape every later phase's own tab, Consultation History and Nutritional Plans, will slot into rather than reinvent).

## Deviations

None yet; this section is for `spec-closeout` to fill in if implementation diverges from this design.
