# Tasks: Infra, Migration Pipeline

Branch: `chore/infra-migration-pipeline`, created by `task-runner` from up-to-date `main` before T1.1, per `.agents/rules/trunk-based.md`.

Operator setup (design.md's "Operator setup" section: `PROD_MIGRATION_DATABASE_URL`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_MIGRATION_ROLE_NAME`, `NEON_DATABASE_NAME`) is a precondition for T3 and T4, not something any task here performs. If it isn't done yet when `task-runner` reaches those tasks, mark them `[BLOCKED]` with that reason per `.agents/rules/human-escalation.md` — this is a wait on the user/operator, not a bug to iterate on.

## T1: Workflow file (REQ-001, REQ-004, REQ-007, REQ-008, REQ-009, REQ-010)

- [ ] T1.1 Create `.github/workflows/migrate.yml` with the `migrate-production` job exactly as `design.md`'s workflow sketch (push-to-`main` and `workflow_dispatch` triggers, `paths: ["prisma/migrations/**"]` on the push trigger, pinned `actions/checkout`/`pnpm/action-setup` SHAs matching current tags, `pnpm exec prisma migrate deploy` using `secrets.PROD_MIGRATION_DATABASE_URL`). Validation: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/migrate.yml'))"` succeeds (valid YAML) and `grep -q "migrate-production" .github/workflows/migrate.yml`. Closes REQ-001, REQ-007, REQ-008, REQ-010.
- [ ] T1.2 Add the `migrate-preview` job to the same file: `pull_request`/`workflow_dispatch` triggers, the fork-safety `if:` condition, the Neon branch-lookup step (list-branches poll loop, 20 attempts / 15s interval / 5-minute budget, `connection_uri` call using `vars.NEON_MIGRATION_ROLE_NAME`/`vars.NEON_DATABASE_NAME`, `::add-mask::` immediately after fetching the URI, no step that echoes the raw curl response), then `prisma migrate deploy` using the masked output. Validation: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/migrate.yml'))"` succeeds and `grep -q "migrate-preview" .github/workflows/migrate.yml`. Closes REQ-002, REQ-003, REQ-004, REQ-007, REQ-008, REQ-009.
- [ ] T1.3 Manual review pass (no automated check can catch this): confirm no step in `migrate-preview` logs the raw `connection_uri` API response or the unmasked `$uri` variable (`grep -nE "echo.*uri|cat.*uri" .github/workflows/migrate.yml` as a starting point, then read the full job by eye). Validation: the grep above returns nothing, plus an explicit statement in the task's completion note confirming the by-eye read happened. Closes REQ-005, REQ-006 (the log-leak half of "never reachable").

## T2: Documentation (REQ-005, REQ-006)

- [ ] T2.1 Update `docs/testing-and-security.md`'s A05 row (currently "Secrets only in Vercel environment variables, never in the client bundle") to also name GitHub Actions secrets as a legitimate location, per `design.md`'s "Files to create or update". Validation: `grep -q "GitHub Actions" docs/testing-and-security.md`.

## T3: Operator-provisioned credentials exist (precondition for T4)

- [ ] T3.1 Confirm the two secrets and three variables from `design.md`'s "Operator setup" section exist in the GitHub repo. Validation: `gh secret list | grep -q PROD_MIGRATION_DATABASE_URL && gh secret list | grep -q NEON_API_KEY && gh variable list | grep -q NEON_PROJECT_ID && gh variable list | grep -q NEON_MIGRATION_ROLE_NAME && gh variable list | grep -q NEON_DATABASE_NAME`. If any are missing, mark `[BLOCKED]`: waiting on operator provisioning, not a task-runner failure.

## T4: End-to-end proof (REQ-001 through REQ-009, live against real GitHub Actions runs)

- [ ] T4.1 Push T1-T2's commits to `main` (via this spec's own PR merge) and confirm `migrate-production` actually runs and succeeds — since `main` already has every migration in this repo applied (per `phase-1a-team-invites`'s manual fix), this run is expected to report "already in sync," which is itself the proof: real credentials, real connection, real idempotent no-op. Validation: `gh run list --workflow=migrate.yml --json conclusion,event --jq '[.[] | select(.event=="push")][0].conclusion'` prints `success`. Closes REQ-001, REQ-007, REQ-008.
- [ ] T4.2 Manually dispatch `migrate-preview` (via `gh workflow run migrate.yml -f pr_branch=<any branch with an active Neon preview>`) and confirm it resolves the branch, fetches a connection string, and runs `prisma migrate deploy` successfully. Validation: `gh run list --workflow=migrate.yml --json conclusion,event --jq '[.[] | select(.event=="workflow_dispatch")][0].conclusion'` prints `success`. Closes REQ-004, REQ-005, REQ-006, REQ-007.
- [ ] T4.3 Open a throwaway PR that touches a `prisma/migrations/**` file trivially (or wait for the next real spec's PR that does) to confirm `migrate-preview` fires automatically on `pull_request` — not just via manual dispatch — and that a fresh Neon preview branch (one `migrate-preview` hasn't already warmed via T4.2) is found within the poll budget. Validation: `gh run list --workflow=migrate.yml --json conclusion,event,headBranch --jq '[.[] | select(.event=="pull_request")][0].conclusion'` prints `success`. If no real spec PR is ready to serve this purpose yet, this task may be deferred to be validated by the next spec's first PR rather than manufacturing a throwaway one — note that explicitly rather than silently skipping it. Closes REQ-002, REQ-003, REQ-004, REQ-009.

## After T4.3

Run `spec-closeout`, then `pr-prep`.
