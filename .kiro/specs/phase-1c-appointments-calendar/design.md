# Design: Phase 1c, Appointments and Calendar

## Architecture touched

One new tenant-scoped model (`Appointment`), a Postgres exclusion constraint for double-booking prevention (a new pattern for this project), and new routes under `(app)/[orgSlug]/appointments/`. Specialist personas applied: `database-architect.md` (schema, RLS, and specifically the exclusion constraint), `nextjs-architect.md` (routing, including the one justified Client Component exception for FullCalendar), and `design.md` (calendar UX — this is the first spec with a genuinely new visual surface, FullCalendar with drag-and-drop; the persona was applied in a review pass before implementation started, closing REQ-024 through REQ-028 below).

## Schema (database-architect)

```prisma
enum AppointmentStatus { SCHEDULED CONFIRMED COMPLETED CANCELLED NO_SHOW }

model Appointment {
  id             String            @id @default(cuid())
  organizationId String
  patientId      String
  professionalId String
  startAt        DateTime
  endAt          DateTime
  status         AppointmentStatus @default(SCHEDULED)
  reason         String?
  notes          String?
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id])
  patient        Patient      @relation(fields: [patientId], references: [id])
  professional   Professional @relation(fields: [professionalId], references: [id])
  @@index([organizationId])
  @@index([professionalId, startAt])
  @@map("appointments")
}
```

`Organization`, `Patient`, and `Professional` each gain the corresponding back-relation (`appointments Appointment[]`).

Design decisions:

- **`startAt`/`endAt`, not `startAt`/`durationMin`.** Storing the end instant directly, rather than a duration to add at read time, is what makes the exclusion constraint below a plain range comparison. Duration (REQ-002/REQ-003's 30-minute default, 5 to 480-minute bounds) is enforced at write time by checking `endAt - startAt`, then stored as the resulting `endAt`; the UI displays a duration field, but the column that exists is the range itself.
- **`DateTime` maps to `timestamptz` in Postgres.** Every instant is stored as an absolute UTC timestamp; REQ-005's `America/Bogota` fix applies at the input/output boundary (parsing form input as Bogota-local, formatting for display in Bogota-local), not in storage. This is both the Prisma default and the right choice for not foreclosing multi-timezone support later, even though this phase doesn't need it.
- **Double-booking prevention is a Postgres `EXCLUDE` constraint, not an application-level check-then-insert.** REQ-007 requires database-level, race-proof enforcement; an application check followed by an insert has a time-of-check-to-time-of-use gap under concurrency. `EXCLUDE` constraints are the standard Postgres mechanism for "no two active rows may overlap for the same resource," and they cover `UPDATE` (reschedule) the same way a unique constraint does: a row is never compared against itself.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments ADD CONSTRAINT no_overlapping_active_appointments
  EXCLUDE USING gist (
    "professionalId" WITH =,
    tsrange("startAt", "endAt") WITH &&
  ) WHERE (status IN ('SCHEDULED', 'CONFIRMED'));
```

`btree_gist` is required because the constraint mixes an equality column (`professionalId`, not natively a GiST-indexable type) with a range overlap column; the extension supplies the GiST operator class that makes equality comparable inside a GiST index. The `WHERE` clause scopes the constraint to active statuses only, per REQ-006's wording ("existing `SCHEDULED` or `CONFIRMED` appointment"); a `COMPLETED`/`CANCELLED`/`NO_SHOW` appointment's old time slot never blocks a new booking.

## RLS policy (database-architect checklist)

```sql
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointments
  USING ("organizationId" = current_setting('app.current_org_id', true));
```

- [x] `ENABLE ROW LEVEL SECURITY` present.
- [x] Policy references `current_setting`, set server-side only.
- [ ] Positive test (task): a session scoped to org A reads/writes its own appointments. Satisfies REQ-021.
- [ ] Negative test (task): a raw `pg` client scoped to org A gets zero rows querying org B's appointments directly. Satisfies REQ-022.
- [ ] Exclusion-constraint test (task): two concurrent creation attempts for the same professional with overlapping ranges; exactly one succeeds, the other's transaction fails on the constraint. Satisfies REQ-007.
- [x] Policy overhead: `organizationId` is indexed; `(professionalId, startAt)` is indexed for calendar-range queries; the exclusion constraint's own GiST index serves the overlap check without a sequential scan.

## Routing and rendering (nextjs-architect)

| Route | Rendering | Data fetching | Streaming |
|---|---|---|---|
| `(app)/[orgSlug]/appointments/page.tsx` | Server Component shell fetches the initial visible **day's** appointments (default landing view, see below); renders a Client Component calendar (FullCalendar) with that data as initial props | Shell: direct fetch for the default range. Subsequent range navigation: `getAppointmentsForRangeAction` Server Action called from the client calendar on range change | No; a day's appointments is a small, fast query |
| `(app)/[orgSlug]/appointments/new/page.tsx` | Server-rendered shell, Client Component form | `createAppointmentAction` Server Action | No |

The calendar itself is a Client Component, a deliberate, justified exception to the Server-Component default: FullCalendar's drag-and-drop reschedule (REQ-013) requires a browser DOM and JS event handling that cannot run server-side. This is the one Client Component boundary in this spec; the shell around it, the create form's page, and every data fetch stay server-first per the established pattern. Drag-and-drop, the detail/edit sheet (below), and the status-transition controls all call the same `updateAppointmentAction`/`transitionAppointmentStatusAction` Server Actions, per REQ-013's "dragging submits the same reschedule operation as the form does" and REQ-024's non-drag equivalent.

`updateAppointmentAction` and `transitionAppointmentStatusAction` revalidate `(app)/[orgSlug]/appointments` via `revalidatePath` on success, scoped narrowly per `nextjs-architect.md`'s guidance.

### Calendar view type (design)

`database-architect.md`'s per-professional resource columns (REQ-019) and a week-wide date range don't compose legibly: a week × N-professional grid is illegible on a laptop, let alone a tablet, well before 3 professionals. The default view is `resourceTimeGridDay` — one day, one column per professional, with prev/next-day navigation — which is what the persona's "columns must stay legible with 3+ professionals" guidance actually requires. A separate, non-resource week/list view (FullCalendar's `listWeek` or `timeGridWeek` without the `resourceTimeGridPlugin`) is available as a secondary toggle for browsing a wider range without per-professional columns; it is not the landing view. REQ-019 itself only requires "a date range," so this is a design-level choice, not a requirements change.

### Calendar UX (design.md persona — REQ-024 through REQ-028)

- **Non-drag reschedule and edit (REQ-011, REQ-024)**: clicking or tapping a calendar event opens `AppointmentDetailSheet` (`src/components/appointments/appointment-detail-sheet.tsx`, a shadcn `Sheet`), reachable by keyboard (`Enter`/`Space` on a focused event, which FullCalendar exposes as a native, tabbable button role). The sheet shows the appointment's fields read-only by default with an "Edit" affordance that reveals the same date/time/duration/professional/reason/notes fields as the create form (reusing `src/validation/appointments.ts`'s schema), submitting to `updateAppointmentAction`. This is the single non-drag path for both REQ-011 (edit) and REQ-024 (reschedule) — the create form's schema/fields are reused, not duplicated.
- **Status-transition controls (REQ-014 through REQ-017, REQ-026)**: the same sheet renders a contextual set of status-transition buttons, computed from a shared pure function `allowedNextStatuses(current: AppointmentStatus): AppointmentStatus[]` in `src/lib/appointments.ts`. This function is the single source of truth for the allowed-transitions table already described below; the client imports it to render only valid buttons (Hick's Law: never show a transition REQ-017 would reject), and `transitionAppointmentStatusAction` imports the same function server-side to enforce it — the UI hint and the enforcement are the same code, not two definitions that can drift.
- **Status legibility (REQ-020, REQ-025)**: each calendar event chip and every status-transition button renders a `lucide-react` icon plus a short text label per status, in addition to the existing color/opacity treatment — color is reinforcement, never the only channel. Mapping: `SCHEDULED` — default outline, `Clock` icon; `CONFIRMED` — solid, `CheckCircle2` icon; `COMPLETED` — muted fill, `Check` icon; `CANCELLED` — muted fill, `X` icon, strikethrough label; `NO_SHOW` — muted fill, `AlertTriangle` icon. All five are in `lucide-react`, already a dependency; no new package needed.
- **Rejection feedback (REQ-026)**: this codebase has no toast primitive (checked: no `sonner`/toast dependency, no existing usage); the established pattern, used identically in `phase-1a-team-invites`'s `invite-form.tsx` and `professional-profile-form.tsx`, is a local `serverError`/`dragError` state rendered as inline `<p className="text-sm text-destructive">`. The calendar reuses that pattern rather than introducing a new UI primitive: on a rejected drag, FullCalendar's `eventDrop` handler calls `info.revert()` and sets a `dragError` string rendered just above the calendar. On a rejected edit/reschedule/status-transition from the sheet, the same inline-error pattern renders inside the sheet.
- **Empty state (REQ-027)**: when `getAppointmentsForRangeAction`'s result for the current range is empty, the calendar shell renders "No appointments scheduled" centered over the grid instead of leaving it blank.
- **Loading state**: FullCalendar's native `loading` callback drives a skeleton overlay on the grid during `getAppointmentsForRangeAction` calls triggered by day/range navigation, so navigating never shows a frozen or silently-stale grid.
- **Pre-filled create from an empty slot click**: clicking an empty calendar slot navigates to `new/page.tsx?date=&time=&professionalId=`, pre-filling those three fields in the create form (still a full navigation, consistent with `patients/new`'s existing pattern elsewhere in the app; only the re-entry cost of already-known values is removed, not the route boundary itself).
- **Touch targets (REQ-028) and touch drag**: calendar event chips and every status-transition button meet the 44×44px minimum hit area REQ-028 requires, verified with 3 or more professional columns at typical laptop/tablet viewport widths. FullCalendar's touch `longPressDelay` is tuned away from the default so a tablet's scroll gesture doesn't fight a drag attempt; the exact delay value is a task-level implementation detail (unlike hit-area size, no specific value is behavior-mandated by a requirement), verified by a manual tablet-viewport check rather than an automated assertion.

## Status transition and race handling

`transitionAppointmentStatusAction` and `updateAppointmentAction` both use a conditional update, not a plain `UPDATE ... WHERE id = ?`:

```ts
const result = await db.appointment.updateMany({
  where: { id, organizationId, status: expectedCurrentStatus },
  data: { status: newStatus },
});
if (result.count === 0) {
  // either the status already changed (REQ-018), or the transition itself
  // is invalid per the allowed-transitions table (REQ-014 through REQ-017),
  // checked before issuing the update
}
```

The allowed-transitions table (REQ-014/REQ-015/REQ-016) is checked in application code before the conditional update runs, not encoded as a database constraint; REQ-018 only requires the race itself to be safe, which the conditional `WHERE status = expectedCurrentStatus` guarantees regardless.

## Requirement coverage

| REQ | Covered by |
|---|---|
| REQ-001 | `createAppointmentAction` in `src/server/actions/appointments.ts` |
| REQ-002 | Default `endAt = startAt + 30min` when duration is omitted, in `src/validation/appointments.ts` |
| REQ-003 | Zod refinement on `endAt - startAt` (5 to 480 minutes) |
| REQ-004 | Zod refinement rejecting a `startAt` before `now()` |
| REQ-005 | Form input parsed as `America/Bogota` via a shared date-handling utility; storage is `timestamptz` (UTC) throughout |
| REQ-006 | The `EXCLUDE` constraint above; caught in `createAppointmentAction`/`updateAppointmentAction` as a Postgres constraint-violation error, mapped to the conflict message |
| REQ-007 | Same `EXCLUDE` constraint; database-enforced, not application-checked |
| REQ-008 | `withTenant`-scoped lookups for `patientId`/`professionalId` in the action; a foreign id outside the org resolves to "not found," rejected |
| REQ-009 | Zod length validation on `reason` |
| REQ-010 | Zod length validation on `notes` |
| REQ-011 | `updateAppointmentAction`: accepts `startAt`, `endAt`, `professionalId`, `reason`, and/or `notes`, independently or together, never `patientId`; re-validates against REQ-003, REQ-006 through REQ-010 |
| REQ-012 | `updateAppointmentAction` checks current status is `SCHEDULED`/`CONFIRMED` before proceeding, rejects otherwise |
| REQ-013 | Calendar's drag handler calls `updateAppointmentAction` with the new slot/professional, same code path as the form |
| REQ-014 | `transitionAppointmentStatusAction` allowed-transitions table: `SCHEDULED → CONFIRMED` |
| REQ-015 | Same table: `SCHEDULED/CONFIRMED → COMPLETED` |
| REQ-016 | Same table: `SCHEDULED/CONFIRMED → CANCELLED/NO_SHOW` |
| REQ-017 | Same table: any pair not listed is rejected, including anything originating from a terminal status |
| REQ-018 | Conditional `updateMany` pattern above |
| REQ-019 | Calendar query grouped client-side by `professionalId` into FullCalendar's resource-column view, server-fetched already scoped to the org |
| REQ-020 | Status-based styling in the calendar's event rendering (color/opacity by `AppointmentStatus`) |
| REQ-021 | `withTenant` on every `Appointment` read/write |
| REQ-022 | RLS policy above |
| REQ-023 | No `requireRole` call restricts any `Appointment` action; consistent with `phase-1b-patients`'s REQ-023 precedent for actions `plan.md` §6 grants to all three roles |
| REQ-024 | `AppointmentDetailSheet`'s edit affordance, calling `updateAppointmentAction` — the non-drag reschedule path, same validation as REQ-011/REQ-012 |
| REQ-025 | Icon + text label per `AppointmentStatus`, in addition to color/opacity, on event chips and status-transition buttons |
| REQ-026 | `dragError`/`serverError` inline-message pattern (reused from `phase-1a-team-invites`) plus `info.revert()` on a rejected drag |
| REQ-027 | Calendar shell's empty-range check on `getAppointmentsForRangeAction`'s result |
| REQ-028 | 44×44px minimum hit area on event chips and status-transition/edit-sheet buttons, verified manually with 3+ professional columns |

## Multi-tenant isolation and RBAC impact

`Appointment` is a new tenant-scoped table; both isolation layers apply (REQ-021, REQ-022). RBAC: no role restriction in this phase (REQ-023), matching `plan.md` §6's permission matrix, which already grants all three roles "Schedule/manage appointments."

## Files to create or update

```
prisma/schema.prisma                                       # update: Appointment model, AppointmentStatus enum, back-relations
prisma/migrations/.../migration.sql                          # generated; includes RLS + btree_gist + EXCLUDE constraint, added manually
src/validation/appointments.ts                                # new: Zod schemas, duration/timezone handling
src/server/actions/appointments.ts                             # new: createAppointmentAction, updateAppointmentAction, transitionAppointmentStatusAction, getAppointmentsForRangeAction
src/app/(app)/[orgSlug]/appointments/page.tsx                  # new: shell + Client Component calendar
src/app/(app)/[orgSlug]/appointments/new/page.tsx               # new: create form, reads ?date=&time=&professionalId= for pre-fill
src/components/appointments/calendar.tsx                         # new: Client Component, FullCalendar wrapper (resourceTimeGridDay default), status icons, drag handling + revert-on-reject, loading state, empty state
src/components/ui/sheet.tsx                                         # new: shadcn Sheet primitive (via shadcn CLI; no new dependency, radix-ui/@base-ui/react already installed)
src/components/appointments/appointment-detail-sheet.tsx          # new: composite built on the Sheet primitive above — view, edit (REQ-011/REQ-024), and status-transition (REQ-014-017) UI
src/lib/appointments.ts                                            # new: allowedNextStatuses(), shared source of truth for client display + server enforcement
```

## Reused vs. new

Reused: `withTenant`, the RLS policy shape, the Server Action + Zod validation pattern, the `(app)/[orgSlug]/*` route convention, `revalidatePath` scoping, the conditional-update-for-race-safety pattern (first used in `phase-1a-team-invites`'s revoke-vs-accept race, REQ-012 there), and the inline `serverError`-text error pattern from `invite-form.tsx`/`professional-profile-form.tsx` (reused for `dragError` rather than introducing a toast library). New: the `Appointment` model, the Postgres `EXCLUDE` constraint pattern (first use of `btree_gist` in this project), the calendar's one deliberate Client Component boundary, the timezone-boundary convention (`America/Bogota` at the edges, UTC in storage) that later phases touching dates should follow rather than reinvent, and `AppointmentDetailSheet` as this project's first shadcn `Sheet` usage.

## Deviations

None yet; this section is for `spec-closeout` to fill in if implementation diverges from this design.

## Amendment history

A `design` persona audit (2026-08-27) was run against the original draft before any implementation started, finding three Critical (REQ-013's drag had no non-drag equivalent — WCAG 2.5.7; status shown by color/opacity only — WCAG 1.4.1; no specified feedback on a rejected drag), three High (unresolved week-vs-resource-columns view type; no pre-fill from a clicked slot; no UI surface for status transitions), and three Medium findings (no loading state; no touch-target sizing constraint; no touch-drag tuning noted), plus three requirements-level gaps. `requirements.md` gained REQ-024 through REQ-028 (REQ-028, touch-target sizing, added during the `spec-grill` pass on this amendment for consistency with REQ-025/REQ-027's treatment of the persona's other accessibility findings); this document was amended to close all findings before Phase 3 (`tasks.md`) proceeds.
