# Design: Preview Seed Data

## Architecture touched

One new standalone script (`prisma/seed-preview.mjs`) and an edit to the existing `.github/workflows/migrate.yml` (`migrate-preview` job only — `migrate-production` is untouched, satisfying REQ-003 structurally rather than by convention). No new Prisma model, no new migration, no new npm dependency: the script is plain ESM JavaScript run directly by Node (`node prisma/seed-preview.mjs`), reusing `@prisma/client` and `@node-rs/argon2`, both already dependencies. This is CI/CD + data tooling, not application code — no new route, no new UI. Specialist persona consulted: `database-architect.md`, for its RLS and least-privilege-credential lens, following `infra-migration-pipeline`'s precedent of applying that persona to this same CI surface — even though this spec adds no new schema or tenant-scoped table.

## Requirement coverage

| REQ | Covered by |
|---|---|
| REQ-001 | New `Seed preview data` step added immediately after the existing `prisma migrate deploy` step in `migrate-preview`, reusing `steps.neon.outputs.database_url` as its `DATABASE_URL` — no second Neon API call |
| REQ-002 | The script's first statement checks `process.env.SEED_PREVIEW_CONFIRM !== "1"` and exits 1 before importing `PrismaClient` or touching any connection; only the new CI step sets this variable |
| REQ-003 | `migrate-production`'s job definition is not edited at all — grep-verifiable, not just asserted |
| REQ-004 | `deleteExistingSeed()` looks up `Organization` by the hardcoded slug; if found, deletes in FK-safe order (below) inside a single `prisma.$transaction`; if not found, returns immediately and insertion proceeds |
| REQ-005 | Hardcoded slug: `preview-clinic` |
| REQ-006 | Four `User`+`Membership` rows (ADMIN, FRONT_DESK, 2×NUTRITIONIST, the latter two each with a `Professional`), fixed emails/password below |
| REQ-007 | 10 `Patient` rows (comfortably over the "at least 8" bar), one with `archivedAt` set |
| REQ-008 | 7 `Appointment` rows, explicit schedule below, covering all 5 statuses across both professionals with past/future placement matching each status's real-world meaning |
| REQ-009 | The 7 appointments are hand-placed (not randomly generated) specifically to respect the exclusion constraint and duration bounds — see "Appointment schedule" below |
| REQ-010 | `console.log` at the end prints slug + `email/role` pairs only; no `passwordHash`, no patient/appointment field, ever passed to `console.*` |
| REQ-011 | No top-level `try/catch` swallowing errors; an unhandled rejection or thrown error propagates to a non-zero Node exit code, which fails the CI step |
| REQ-012 | All names/emails/phones below are placeholder-obviously-fake; emails use the `example.com` reserved documentation domain (RFC 2606) |
| REQ-013 | `concurrency:` block added to the `migrate-preview` job only (not `migrate-production`, where cancelling a running migration mid-flight would be actively dangerous) |

## Why the seed script needs no `withTenant`

`withTenant` (`src/lib/db.ts`) injects `organizationId` via `AsyncLocalStorage` for application code running inside a request/session context that doesn't otherwise have a trusted tenant id to hand. A standalone script has no session and creates its own `Organization` from scratch — every write below sets `organizationId` explicitly and directly, which is what `withTenant` itself does internally; wrapping the script in it would add nothing.

This also means Row-Level Security needs a direct answer, not an assumption: `migrate-preview`'s connection string authenticates as the same role `prisma migrate deploy` already uses for schema changes on that branch, per `infra-migration-pipeline`'s `NEON_MIGRATION_ROLE_NAME`. That role is the tables' *owner* (required for DDL), and Postgres exempts a table's owner from its own RLS policies unless `FORCE ROW LEVEL SECURITY` is set — which `phase-1c-appointments-calendar`'s `database-architect` audit already confirmed is not the case here (`relforcerowsecurity = f`, checked live). So this script's plain, unscoped Prisma Client calls read/write every organization's rows without restriction, exactly like `prisma migrate deploy` itself does — acceptable specifically because a migration-role connection is exactly what it is, and the script only ever touches rows it created itself, identified by the fixed slug (REQ-004).

## Deletion order (REQ-004)

No relation in the schema declares `onDelete: Cascade`, so cleanup is explicit, inside one `prisma.$transaction` (all-or-nothing — a partial delete would leave the next insert colliding on the `slug`/`documentId`/`tokenHash` unique constraints):

```
1. Look up Organization by slug "preview-clinic". If none, return (nothing to delete).
2. Collect: user ids for this org's Memberships (needed because `User` has no `organizationId` column of its own — everything else below is deleted by a direct `organizationId` filter and needs no collected ids).
3. Delete AuditLog        where organizationId = org.id
4. Delete Appointment     where organizationId = org.id
5. Delete Patient         where organizationId = org.id
6. Delete Invite          where organizationId = org.id
7. Delete Professional    where organizationId = org.id   (references Membership)
8. Delete Membership      where organizationId = org.id
9. Delete User            where id in (collected user ids)   -- Membership.userId is @unique,
                                                               -- so every seeded user belongs to
                                                               -- exactly this one org; safe to
                                                               -- delete without affecting others
10. Delete Organization   where id = org.id
```

## Seed content (REQ-005–009)

**Organization**: `{ name: "Preview Clinic", slug: "preview-clinic" }`.

**Users / Memberships / Professionals** (password below hashed once with `@node-rs/argon2`'s `hash()`, default params — the same call `src/lib/auth.test.ts` uses, matching `auth-core.ts`'s `verify()` on the login side exactly):

| Email | Role | Professional? |
|---|---|---|
| `admin@preview.example.com` | ADMIN | no |
| `frontdesk@preview.example.com` | FRONT_DESK | no |
| `nutri1@preview.example.com` | NUTRITIONIST | yes — "Dr. Ana Rivera", `specialty: "Clinical Nutrition"` |
| `nutri2@preview.example.com` | NUTRITIONIST | yes — "Dr. Luis Torres", `specialty: "Sports Nutrition"` |

Fixed password for all four: `Preview1234!` (REQ-006 already documents that committing this is deliberate, not an oversight).

**Patients**: 10 rows, obviously-fake names ("Test Patient One" .. "Test Patient Ten"), varied `sex`/`birthDate`/`phone` (`+1555...` reserved-for-fiction prefix), numbered 1–10. Patient 10 ("Test Patient Ten") has `archivedAt: new Date()` set (REQ-007's archived case) and, deliberately, is **never** linked to any seeded `Appointment` below — an archived patient with a live scheduled appointment would misrepresent what "archived" means and could confuse whoever is reviewing the preview.

**Appointment schedule** (REQ-008/009 — `now` = the seed script's execution time; all times illustrative, exact minutes finalized at implementation). Each row also gets a short, obviously-fictitious `reason` (e.g. "Follow-up consultation", "Initial assessment") so the calendar's event chips and the detail sheet have real content to review, not blank fields — patients assigned round-robin from patients 1–9 (patient 10 excluded, see above):

| Professional | Patient | When (relative to `now`) | Duration | Status |
|---|---|---|---|---|
| Dr. Rivera | Test Patient One | 2 days ago, 14:00 | 30 min | `CANCELLED` |
| Dr. Rivera | Test Patient Two | yesterday, 09:00 | 45 min | `COMPLETED` |
| Dr. Rivera | Test Patient Three | today, 15:00 | 45 min | `SCHEDULED` |
| Dr. Rivera | Test Patient Four | tomorrow, 10:00 | 30 min | `CONFIRMED` |
| Dr. Torres | Test Patient Five | yesterday, 11:00 | 30 min | `NO_SHOW` |
| Dr. Torres | Test Patient Six | today, 09:00 | 30 min | `SCHEDULED` |
| Dr. Torres | Test Patient Seven | in 2 days, 13:00 | 60 min | `CONFIRMED` |

All 5 `AppointmentStatus` values present; both professionals have at least one past and one future appointment; per-professional time ranges never overlap (the only thing the exclusion constraint restricts, and only for `SCHEDULED`/`CONFIRMED` rows per its `WHERE` clause — verified against the actual constraint definition in `prisma/migrations/20260827022943_appointments_exclusion_and_rls/migration.sql`); every duration is within the 5–480 minute bound. "In 3+ days" and "3+ days ago" are left with zero appointments, so the calendar's empty-state (REQ-027 from `phase-1c-appointments-calendar`) is also directly reachable by navigating a couple of days forward.

## Workflow changes (`.github/workflows/migrate.yml`)

The `pull_request.paths` filter includes `prisma/migrations/**`,
`prisma/seed-preview.mjs`, and `.github/workflows/migrate.yml`, so a PR that
changes the seed or its wiring can execute the live proof even when it adds no
migration. The `push.paths` filter remains migration-only: merging seed-only or
workflow-only changes must not trigger the production migration job.

```yaml
jobs:
  migrate-preview:
    concurrency:
      group: migrate-preview-${{ github.event.pull_request.number || inputs.pr_branch }}
      cancel-in-progress: true
    if: >-
      ...   # unchanged
    steps:
      - uses: actions/checkout@<pinned-sha>
      - name: Resolve preview branch connection string
        id: neon
        # ... unchanged ...
      - uses: pnpm/action-setup@<pinned-sha>
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prisma generate
      - run: pnpm exec prisma migrate deploy
        env:
          DATABASE_URL: ${{ steps.neon.outputs.database_url }}
      - name: Seed preview data
        run: node prisma/seed-preview.mjs
        env:
          DATABASE_URL: ${{ steps.neon.outputs.database_url }}
          SEED_PREVIEW_CONFIRM: "1"
```

`migrate-production` gains no new step and no `concurrency:` block — a production migration should never be cancelled mid-flight by a newer push, which is exactly what `cancel-in-progress` would do if applied there.

The explicit `prisma generate` is required because the workflow deliberately
installs with `--ignore-scripts`; `prisma migrate deploy` does not require the
generated client, while `seed-preview.mjs` imports `@prisma/client` and does.
Keeping generation explicit preserves the install hardening and makes the seed
runtime dependency visible in the job definition.

## Multi-tenant isolation and RBAC impact

None on the application's own isolation model: no Server Action, no route, no RLS policy changes. The script's ability to write across the RLS boundary is a property of the migration role it runs as (see above), identical in kind to what `prisma migrate deploy` already does on every run today — this spec doesn't grant that role anything it didn't already have.

## Reused vs. new

Reused: `@prisma/client`, `@node-rs/argon2`'s `hash()` call shape from `auth.test.ts`, `migrate-preview`'s already-resolved `DATABASE_URL` output, the fork-safety/credential-scoping already established by `infra-migration-pipeline`. New: `prisma/seed-preview.mjs`, one CI step, one `concurrency:` block.

## Files to create or update

```
prisma/seed-preview.mjs                # new: the seed script
.github/workflows/migrate.yml          # update: new step + concurrency block in migrate-preview only
```

## Deviations

- T3.1's protected Vercel preview was verified with a one-off headless Chromium
  session using Vercel CLI's authenticated protection bypass rather than an
  interactive browser session. The browser logged in independently as all four
  seeded users and exercised the same patient/calendar routes and assertions;
  no bypass credential or test runner was committed.
- The five integration suites share `tests/helpers/preview-seed.ts` and a
  filesystem lock helper. The approved design listed only production files;
  these test-only helpers were added after QA exposed duplicate setup/cleanup
  and default timeout flakiness while the real-database suites ran in parallel.
