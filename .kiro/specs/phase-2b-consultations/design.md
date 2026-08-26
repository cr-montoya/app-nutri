# Design: Phase 2b, Consultations

## Architecture touched

One new tenant-scoped model (`Consultation`), a third real caller for `rbac.ts` (after `phase-1d-attachments` and `phase-2a-clinical-history`), a second tab added to the patient profile's layout (from `phase-2a-clinical-history`), and a new entry point from the appointment calendar (`phase-1c-appointments-calendar`) for the "document this consultation" flow. Specialist personas applied: `database-architect.md` (schema, RLS) and `nextjs-architect.md` (routing).

## Schema (database-architect)

```prisma
model Consultation {
  id             String   @id @default(cuid())
  organizationId String
  patientId      String
  professionalId String
  appointmentId  String?  @unique
  occurredAt     DateTime
  subjective     String?
  plan           String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id])
  patient        Patient      @relation(fields: [patientId], references: [id])
  professional   Professional @relation(fields: [professionalId], references: [id])
  appointment    Appointment? @relation(fields: [appointmentId], references: [id])
  @@index([organizationId])
  @@index([patientId, occurredAt])
  @@map("consultations")
}
```

`Organization`, `Patient`, and `Professional` each gain an `consultations Consultation[]` back-relation; `Appointment` gains a singular `consultation Consultation?`, since the relation is 1:1 from that side.

Design decisions:

- **`appointmentId` is nullable and `@unique`.** Nullable because a standalone consultation (REQ-001) has none; `@unique` enforces REQ-004/REQ-005's "at most one `Consultation` per `Appointment`" the same way `Membership.userId`'s uniqueness worked in `phase-0-scaffold`, with the same NULL-is-distinct-from-NULL behavior letting unlimited standalone consultations coexist.
- **No `CHECK` constraint tying `patientId` to the linked appointment's patient.** REQ-002 already guarantees this at the application layer (the patient is copied from the appointment, never independently chosen, when `appointmentId` is set); a database-level constraint enforcing it would duplicate that guarantee for no real gain at this scale, and Postgres doesn't make a cross-row `CHECK` like this simple to express anyway.
- **`(patientId, occurredAt)` composite index**, not just `patientId` alone, since REQ-012's list is explicitly ordered by `occurredAt` and always scoped to one patient; the composite index serves that query directly instead of sorting an unindexed result.
- **"Professional's name" (REQ-012, REQ-013) is `Professional → Membership → User.name`.** `Professional` has no `name` field of its own; the display name always comes from the linked `Membership`'s `User`. Every query in this spec that shows a professional's name includes `professional: { include: { membership: { include: { user: { select: { name: true } } } } } }`, not a shortcut that skips the indirection.

## RLS policy (database-architect checklist)

```sql
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consultations
  USING ("organizationId" = current_setting('app.current_org_id', true));
```

- [x] `ENABLE ROW LEVEL SECURITY` present.
- [x] Policy references `current_setting`, set server-side only.
- [ ] Positive test (task): a session scoped to org A reads/writes its own `Consultation` rows. Satisfies REQ-015.
- [ ] Negative test (task): a raw `pg` client scoped to org A gets zero rows querying org B's `Consultation` rows directly. Satisfies REQ-016.
- [ ] Constraint race test (task): two concurrent attempts to create a `Consultation` from the same `Appointment`; exactly one succeeds. Satisfies REQ-005.
- [x] Policy overhead: `organizationId` is indexed; `(patientId, occurredAt)` serves the history-list query; `appointmentId`'s unique index serves the "does this appointment already have one" check.

## Routing and rendering (nextjs-architect)

| Route | Rendering | Data fetching | Streaming |
|---|---|---|---|
| `(app)/[orgSlug]/patients/[patientId]/consultations/page.tsx` (new) | Server Component | List query, `withTenant`-scoped, `(patientId, occurredAt)`-ordered, projecting only `occurredAt` and professional name per REQ-012 | No |
| `(app)/[orgSlug]/patients/[patientId]/consultations/[consultationId]/page.tsx` (new) | Server Component | Direct fetch by id, full fields; triggers the REQ-018 audit-log write | No |
| `(app)/[orgSlug]/patients/[patientId]/consultations/new/page.tsx` (new) | Server-rendered shell, Client Component form | `createConsultationAction` Server Action. Accepts an optional `?appointmentId=` search param; when present, pre-fills and locks the patient/professional/`occurredAt` per REQ-002 | No |
| `(app)/[orgSlug]/patients/[patientId]/consultations/[consultationId]/edit/page.tsx` (new) | Server-rendered shell, Client Component form | `updateConsultationAction` Server Action | No |

The "document this consultation" entry point lives on the appointment calendar (`phase-1c-appointments-calendar`): a `COMPLETED` appointment's event popover gets a link to `.../consultations/new?appointmentId=<id>`, reusing the same create page and action rather than a parallel flow. `[patientId]/layout.tsx` (from `phase-2a-clinical-history`) gains a second conditional tab, "Consultation History," hidden for `FRONT_DESK` the same way the Background tab already is.

`createConsultationAction` and `updateConsultationAction` revalidate the consultations list and, for updates, the specific detail path, via `revalidatePath`.

## Requirement coverage

| REQ | Covered by |
|---|---|
| REQ-001 | `createConsultationAction`: standalone path, patient/professional explicitly selected |
| REQ-002 | Same action: from-appointment path, patient/professional/`occurredAt` copied from the `Appointment`, patient locked |
| REQ-003 | `createConsultationAction` checks `appointment.status === 'COMPLETED'` before proceeding |
| REQ-004 | `appointmentId` unique-constraint violation caught, mapped to the rejection |
| REQ-005 | `@@unique` on `appointmentId` in the schema above |
| REQ-006 | Zod refinement rejecting a future `occurredAt`, in `src/validation/consultations.ts` |
| REQ-007 | Zod `.max(5000)` on `subjective` |
| REQ-008 | Zod `.max(5000)` on `plan` |
| REQ-009 | `withTenant`-scoped lookups for `patientId`/`professionalId`/`appointmentId`; a foreign id resolves to "not found" |
| REQ-010 | `updateConsultationAction`: accepts `occurredAt`/`professionalId`/`subjective`/`plan`, never `patientId` or `appointmentId` |
| REQ-011 | No delete action exists for `Consultation` anywhere in this spec's file list |
| REQ-012 | Consultations list query, projecting only `occurredAt` and professional name |
| REQ-013 | `[consultationId]/page.tsx` direct fetch, full fields |
| REQ-014 | `requireRole(['ADMIN', 'NUTRITIONIST'])` on every route/action in this spec; the layout's conditional tab hides the entry point for `FRONT_DESK` |
| REQ-015 | `withTenant` on every `Consultation` read/write |
| REQ-016 | RLS policy above |
| REQ-017 | `logAudit()` call in `createConsultationAction` and `updateConsultationAction` |
| REQ-018 | `logAudit()` call in `[consultationId]/page.tsx`'s fetch, not in the list page |

## Multi-tenant isolation and RBAC impact

`Consultation` is a new tenant-scoped table; both isolation layers apply (REQ-015, REQ-016). RBAC: `rbac.ts`'s third real caller, `requireRole(['ADMIN', 'NUTRITIONIST'])`, gating every route and action in this spec; `FRONT_DESK` is fully excluded (REQ-014), consistent with `phase-1d-attachments` and `phase-2a-clinical-history`.

## Files to create or update

```
prisma/schema.prisma                                                          # update: Consultation model, back-relations
prisma/migrations/.../migration.sql                                             # generated; includes RLS, added manually
src/validation/consultations.ts                                                  # new: Zod schemas
src/server/actions/consultations.ts                                               # new: createConsultationAction, updateConsultationAction
src/app/(app)/[orgSlug]/patients/[patientId]/consultations/page.tsx                # new
src/app/(app)/[orgSlug]/patients/[patientId]/consultations/new/page.tsx             # new
src/app/(app)/[orgSlug]/patients/[patientId]/consultations/[consultationId]/page.tsx # new
src/app/(app)/[orgSlug]/patients/[patientId]/consultations/[consultationId]/edit/page.tsx # new
src/app/(app)/[orgSlug]/patients/[patientId]/layout.tsx                            # update (from phase-2a-clinical-history): add Consultation History tab
src/components/appointments/calendar.tsx                                            # update (from phase-1c-appointments-calendar): "document this consultation" link on COMPLETED events
```

## Reused vs. new

Reused: `withTenant`, the RLS policy shape, `logAudit()`, the Server Action + Zod validation pattern, `requireRole` (its third caller), `revalidatePath` scoping, the conditional-tab pattern from `phase-2a-clinical-history`'s layout, the list-versus-detail audit-logging split from `phase-1b-patients`. New: the `Consultation` model, and the cross-feature entry point from the calendar into a different feature's create flow (the first time one spec's UI links directly into another's, rather than everything being reached only through the patient profile).

## Deviations

None yet; this section is for `spec-closeout` to fill in if implementation diverges from this design.
