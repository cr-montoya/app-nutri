# Requirements: Infra, Migration Pipeline

## Objective

Every Prisma migration merged to `main` must reach the production Neon branch, and every migration on an open PR must reach that PR's Neon preview branch, without a human running `prisma migrate deploy` by hand. Today this is entirely manual: `phase-1a-team-invites` merged with its `Invite` table never applied to either the production or preview Neon branch, discovered only when someone tried to click through the deployed app. The pipeline must do this without ever exposing the schema-owning Postgres role to Vercel or to the app's runtime environment — that separation is the entire point of `.agents/rules/tenant-isolation.md`'s RLS defense-in-depth layer, and ADR-0003 already deliberately kept the owner credential out of Vercel for exactly this reason.

## User stories

- As a developer merging a spec to `main`, I want its migrations to apply to the production database automatically, so that production never silently drifts behind the schema `main` expects.
- As a developer opening or updating a PR, I want its migrations to apply to that PR's Neon preview branch automatically, so that the deployed preview (and anyone testing it, human or agent) reflects the code actually under review instead of 500ing on a missing table.
- As a security reviewer, I want the credential capable of altering schema to live only where it's actually needed, so that a compromised Vercel deployment or a bug in app code can never reach it.
- As a developer, I want a failed migration to fail loudly in CI, so that a broken migration is caught before anyone assumes the database is in sync.

## Requirements

- **REQ-001**: WHEN a commit is pushed to `main`, THE SYSTEM SHALL apply every not-yet-applied migration in `prisma/migrations/` to the production Neon branch, as a CI job independent of and not blocking on the existing `security.yml` checks (which don't touch the database).
- **REQ-002**: WHEN a pull request from a branch of this repository (not a fork) is opened or synchronized (new commits pushed) against `main`, THE SYSTEM SHALL apply every not-yet-applied migration to that pull request's Neon preview branch.
- **REQ-003**: THE SYSTEM SHALL NEVER run a migration job triggered by a pull request originating from a fork, and SHALL NEVER use a workflow trigger (e.g. `pull_request_target`) that would expose the migration credential to code from an untrusted PR. A fork-originated PR simply gets no automatic migration run; the preview stays on whatever schema its Neon branch already had.
- **REQ-004**: WHEN the Neon preview branch for a pull request does not yet exist at the time its migration job would run, THE SYSTEM SHALL poll for it (interval and total budget are a Design-phase decision, but the budget SHALL be a concrete, finite duration stated in `design.md`, not left as "bounded") and SHALL fail visibly (REQ-007) if it never appears within that budget.
- **REQ-005**: THE SYSTEM SHALL ALWAYS run migrations using a Postgres role with schema-modification privileges that is never assigned to `DATABASE_URL`/`APP_DATABASE_URL` in any Vercel environment (Preview, Production, or Development) and never reachable by application/Server Action code.
- **REQ-006**: THE SYSTEM SHALL ALWAYS store that role's credential (or the means to obtain it, e.g. a Neon API key) as a secret scoped only to the CI job that runs migrations, never as a Vercel environment variable.
- **REQ-007**: WHEN a migration fails to apply (production or preview), THE SYSTEM SHALL fail the corresponding CI check visibly (non-zero exit, a failed GitHub check) rather than continuing silently.
- **REQ-008**: WHEN the same migration set has already been fully applied to a target branch, THE SYSTEM SHALL exit successfully without error (idempotent re-run — this is `prisma migrate deploy`'s existing guarantee, not new logic to build, but the pipeline around it must not break that guarantee).
- **REQ-009**: WHEN two migration-job runs are triggered concurrently for the same target branch (e.g. two rapid `synchronize` events on the same PR), THE SYSTEM SHALL rely on `prisma migrate deploy`'s own advisory-lock behavior to serialize them safely rather than adding separate concurrency-control logic.
- **REQ-010**: WHEN this pipeline runs, THE SYSTEM SHALL NOT alter, replace, or duplicate the existing Vercel build/deploy flow (`pnpm run build`, including its `prisma generate` step) — migrations and the Vercel deployment are triggered independently, per ADR-0003's existing contract that Vercel only ever sees the restricted runtime role.
- **REQ-011**: WHEN a pull request is closed (merged or abandoned), THE SYSTEM SHALL NOT need to do anything to clean up that PR's Neon preview branch — branch lifecycle (creation and deletion) is already owned by the existing Neon-Vercel integration, out of scope here.
- **REQ-012**: WHEN a `push` to `main` or an eligible pull-request update contains no change under `prisma/migrations/`, THE SYSTEM SHALL NOT start an automatic migration job for that event.
- **REQ-013**: WHEN a repository collaborator manually dispatches the migration workflow, THE SYSTEM SHALL support running the production migration or selecting an existing repository preview branch for a preview migration; this manual path SHALL remain unavailable to fork-originated pull-request code.

Assumption this spec relies on but doesn't itself build: `main` is protected against direct pushes (`.agents/rules/trunk-based.md`'s existing convention), so in practice a commit only reaches `main` via a merged PR, which means REQ-002's preview run already exercised that migration before REQ-001 ever applies it to production. If `main`'s branch protection doesn't already enforce PR-only merges at the GitHub repo-settings level, that's a gap in an existing convention, not something this spec's tasks will configure.

## Out of scope

- Rollback automation or down-migrations. If a bad migration reaches production, remediation is a manual/incident-response decision, not something this pipeline automates.
- Schema drift detection (e.g., detecting a manual `psql` change made outside a migration file). `prisma migrate deploy` already fails if the migrations table and actual schema diverge in a way it can't reconcile; this spec doesn't add detection beyond that.
- Seeding data of any kind.
- Zero-downtime migration strategy/tooling (expand-contract patterns, etc.) — deferred until a migration actually needs it.
- Provisioning the Neon API key / owner-role credential itself. This spec defines what the pipeline needs and how it's consumed; actually generating it in the Neon dashboard and storing it as a GitHub Actions secret is an operator step outside version control, the same way `appnutri_app`'s local password was in `phase-0-scaffold`.
- Automating any migration step that isn't plain SQL DDL. `phase-0-scaffold` already had one migration (`20260826054241_login_membership_lookup_function`) that requires a manual `ALTER ROLE ... PASSWORD` outside the migration file itself; this pipeline runs `prisma migrate deploy` and nothing more. A green migration-pipeline run means "every `.sql` file applied," not "every environment is fully configured" — a future migration with its own manual follow-up step still needs that step done by an operator, same as today.
- Any change to the OWASP checklist row in `docs/testing-and-security.md` claiming "Secrets only in Vercel environment variables" — this spec's design phase will determine whether that statement needs updating to also name GitHub Actions secrets as a legitimate second location, but that's a design-time documentation decision, not a requirement.
