# ADR-0005: Fixed-offset (non-plugin) America/Bogota rendering for FullCalendar

## Status

Accepted

## Date

2026-08-27

## Context

`phase-1c-appointments-calendar`'s `design.md` specifies FullCalendar's `timeZone` prop set to `"America/Bogota"` so the calendar's day/range boundaries and event positions line up with REQ-005's fixed America/Bogota (UTC-5, no daylight saving) storage convention. Discovered during implementation of T4.4 (drag-and-drop): `@fullcalendar/core`'s built-in `timeZone` option only natively supports the literal values `"local"` and `"UTC"`. A named IANA zone like `"America/Bogota"` requires the separate `@fullcalendar/moment-timezone` plugin (itself depending on `moment-timezone`); without it, FullCalendar silently falls back to the browser/server's local timezone rather than erroring, which only surfaced as a ~5-hour misalignment between where a drag test expected an event to render and where it actually rendered on the grid -- a real bug, not a test artifact, since the same silent fallback would have shifted every user's view of "today" and every event's displayed time in production too.

`requirements.md`'s REQ-005 is explicit that this phase's timezone need is narrow: a single fixed offset, no daylight saving, and multi-timezone support explicitly out of scope. That scope is much narrower than what a full IANA timezone engine (moment-timezone's tz database, DST rules, historical offset changes) exists to solve.

## Decision

Render the calendar with FullCalendar's built-in `timeZone="UTC"` (not `"local"`, not a named zone), and pre-shift every instant crossing the calendar's boundary by the fixed 5-hour Bogota offset before handing it to FullCalendar, then shift back on the way out (drag results, range-navigation queries, empty-slot clicks). FullCalendar is deliberately fed timestamps that are numerically correct for Bogota wall-clock time but labeled UTC; since Bogota's offset is fixed and DST-free, this labeling is harmless and the grid renders, navigates, and reports drag positions in true Bogota local time with no plugin and no new dependency. The shift lives entirely in `src/components/appointments/calendar.tsx`; every other file (`resolveAppointmentRange`, `formatBogotaDateAndTime`, the Server Actions, the database) is unaffected and continues to operate on real UTC instants.

## Alternatives considered

- **Add `@fullcalendar/moment-timezone` + `moment-timezone`, use the real `"America/Bogota"` zone name.** The correct, general solution, and the one that would matter if this project ever needed genuine multi-timezone or DST support. Rejected for now because REQ-005 explicitly excludes that scope, and `moment-timezone` bundles a timezone database into an already-large Client Component boundary (the calendar route was 195kB before this ADR's change) for a capability this phase doesn't use. Revisit this alternative directly if/when a future phase actually needs multi-timezone support; it would very likely replace this ADR's approach rather than compose with it.
- **Set `timeZone="local"` (FullCalendar's default) and require the deployment's Node process to run with `TZ=America/Bogota`.** Rejected: this is an infrastructure assumption outside this spec's control (Vercel Functions' timezone, local dev machines, CI runners), fails silently and identically to the bug this ADR fixes if that environment variable is ever unset or wrong, and would also shift every other unrelated `Date`-based computation in the process, not just the calendar.

## Consequences

Easier: no new dependency, no bundle-size increase, the fix is confined to one file and is a small, well-commented, testable transformation (verified by `tests/e2e/calendar-drag-reschedule.spec.ts` computing exact pixel-to-time math against it). `calendar.tsx` imports `BOGOTA_UTC_OFFSET_HOURS` from `src/validation/appointments.ts` rather than redeclaring the offset, so the fixed 5-hour constant has exactly one definition, not two. This decision forecloses nothing: the pre-shift is removable in one file the day a real multi-timezone phase adopts `@fullcalendar/moment-timezone` or replaces FullCalendar's timezone handling entirely.

## Related

Spec: `.kiro/specs/phase-1c-appointments-calendar/`.
