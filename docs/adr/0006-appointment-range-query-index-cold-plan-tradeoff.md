# ADR-0006: Composite btree index for appointment range queries despite an unresolved cold-plan gap

## Status

Accepted

## Date

2026-08-27

## Context

`getAppointmentsForRangeAction` (`src/server/actions/appointments.ts`) filters `Appointment` by `organizationId` plus a `startAt`/`endAt` range overlap (`startAt < end AND endAt > start`), the query underlying the calendar's range view. A `database-architect` review (documented separately in `.kiro/specs/phase-1c-appointments-calendar/design.md`'s `## Deviations` section) had already found that neither the plain `organizationId` index nor `(professionalId, startAt)` served this query, and that a first attempt at fixing it, a GiST expression index on `tsrange(startAt, endAt)`, was never chosen because Postgres only uses a GiST expression index when the query literally contains the matching `tsrange(...) && tsrange(...)` expression, and Prisma's generated query uses separate comparisons instead. That GiST index was dropped and replaced with a plain composite btree, `@@index([organizationId, startAt])` (migration `20260827142542_replace_appointment_gist_with_btree_index`), which `EXPLAIN` confirms Postgres does choose for this query, on a warm, long-lived session.

That confirmation surfaced a narrower, previously undocumented gap this ADR records. The composite btree index is reliably chosen only once Postgres reaches a "generic" query plan, empirically observed after 5+ executions of the same prepared statement on one persistent session. A **cold execution** (a fresh connection's first-ever Parse/Bind/Execute of this query, with no prior executions to prime a generic plan) does not reliably choose it: it falls back to the less selective `organizationId`-only index, or, in the worst tested case with competing indexes removed, a full sequential scan. A third approach, forcing the generic plan from the first execution via `ALTER ROLE ... SET plan_cache_mode = 'force_generic_plan'`, was tested and did not reliably work either: re-tested three times against a fresh dataset isolated from prior custom-plan history, it consistently still chose the old, less selective index.

This matters specifically because AppNutri's real deployment (Neon Postgres + Next.js Server Actions on Vercel) uses short-lived, pooled connections, a pattern much closer to "cold" than to one long-lived session reusing a prepared statement 5+ times. The read benefit measured in the original benchmark (a warm session, 0.19-1.2ms per the design.md deviation entry) may not be what production Server Actions actually experience. This could not be resolved locally: it depends on Neon's actual PgBouncer pooling mode (transaction vs. session) and whether it preserves prepared-statement/plan-cache state across pooled connections, something only a real Neon branch can answer, not local Docker Postgres.

## Decision

Keep the composite btree index, `@@index([organizationId, startAt])`, as shipped in migration `20260827142542_replace_appointment_gist_with_btree_index`. Do not block PR #5 chasing a cold-plan fix that can't be validated outside production infrastructure.

Record a concrete re-benchmark trigger as a documented follow-up, not a blocking task: before any single organization's `Appointment` row count exceeds roughly 10,000 rows, or before production launch if that happens first, re-run the same `EXPLAIN (ANALYZE, BUFFERS)` methodology against a real Neon branch (not local Docker) with cold, non-warmed-up connections matching production's actual pooling behavior, to confirm which query plan Neon's pooling mode actually produces, and revisit the index strategy if it is still the less-selective plan.

## Alternatives considered

- **`ALTER ROLE ... SET plan_cache_mode = 'force_generic_plan'`.** Would force the generic (index-aware) plan from the first execution if it worked, closing the cold-plan gap without touching application code. Rejected: tested three times against a fresh dataset with no prior custom-plan history, and it consistently still chose the old, less selective `organizationId`-only index rather than the composite one. Not reliable enough to depend on, and still unverified against Neon's actual pooling behavior.
- **Block the PR until the cold-plan behavior is confirmed against a real Neon branch.** Would close the open question before merging. Rejected: this feature currently has zero production rows, the cold-plan gap only becomes practically significant once a single organization's history reaches roughly 50k+ rows where the competing plans' costs meaningfully diverge, and the index is strictly better than having none in every realistic near-term scenario regardless of which plan Neon picks. Delaying a mergeable, non-regressing change to chase a scale problem this feature does not yet have is the over-engineering this project's cost-optimization rule warns against.
- **Revert to no dedicated range-query index and rely on the existing `(professionalId, startAt)` and plain `organizationId` indexes.** Rejected outright: both were already confirmed not to serve this query (seq scan at 280k synthetic rows per the design.md deviation entry), so this would reintroduce a known-bad plan unconditionally, not just under cold-connection conditions.

## Consequences

Easier: the composite index adds no meaningful write cost beyond the existing `(professionalId, startAt)` index already on this table, and it is correctness-neutral either way, since RLS and the query's `WHERE` clause are unaffected by which index or plan services them; this is purely a performance question. It also gives a real, immediate read benefit for any sufficiently long-lived connection (a warm pool worker, a future reporting script) today.

Harder / accepted risk: production's actual per-request performance for this query, under Neon's pooling, remains unverified until the documented re-benchmark trigger fires (10,000 rows per organization, or launch). If Neon's pooling mode turns out to be closer to "cold" than "warm" for typical Server Action traffic, this index may deliver less benefit in production than the local benchmark suggested until that re-verification happens and, if needed, a follow-up decision is made. This ADR does not resolve that question; it documents why resolving it now was not worth blocking the PR, and commits to a concrete, measurable trigger for revisiting it rather than leaving it open-ended.

## Related

Spec: `.kiro/specs/phase-1c-appointments-calendar/`. See also the index-history deviation entry in that spec's `design.md` (`## Deviations`), which covers the GiST-to-btree replacement this ADR follows on from. Related but separate: ADR-0005 (FullCalendar timezone rendering), also from this spec.
