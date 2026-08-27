# Tasks: Infra, Migration Pipeline

`task-runner` must rebase or recreate `chore/infra-migration-pipeline` from up-to-date `main` before T1.1. The pre-existing worktree is for the spec only; no implementation starts until these tasks are approved.

Operator setup from design.md (`PROD_MIGRATION_DATABASE_URL`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_MIGRATION_ROLE_NAME`, and `NEON_DATABASE_NAME`) is a precondition for T3 and T4. It is not an implementation task. If unavailable, `task-runner` marks T3/T4 `[BLOCKED]` with that reason under `.agents/rules/human-escalation.md`.

## T1: Workflow implementation

- [x] T1.1 Create `.github/workflows/migrate.yml` with minimal `contents: read` permissions, the migration-only `push` and `pull_request` triggers, `workflow_dispatch`, and the `migrate-production` job. Pin third-party actions by SHA, install with `pnpm install --frozen-lockfile --ignore-scripts`, and run `pnpm exec prisma migrate deploy` with only `secrets.PROD_MIGRATION_DATABASE_URL`. Validation: `ruby -e 'require "yaml"; YAML.load_file(ARGV.fetch(0))' .github/workflows/migrate.yml && rg -q 'migrate-production' .github/workflows/migrate.yml && rg -q -- '--ignore-scripts' .github/workflows/migrate.yml`. Closes REQ-001, REQ-007, REQ-008, REQ-010, REQ-012, REQ-013, REQ-014.

- [x] T1.2 Add the `migrate-preview` job: `pull_request` only for automatic PR execution, an internal-PR condition, and no `pull_request_target` or closed-PR cleanup job. Check out the PR head only for an internal PR; use the default branch for manual dispatch. Validate the presence of the preview branch by polling Neon 20 times at 15-second intervals, obtain its URI through the Neon API, mask it before writing it to the step output, then run `pnpm exec prisma migrate deploy`. Validation: `ruby -e 'require "yaml"; YAML.load_file(ARGV.fetch(0))' .github/workflows/migrate.yml && rg -q 'migrate-preview' .github/workflows/migrate.yml && rg -q 'head.repo.full_name == github.repository' .github/workflows/migrate.yml && ! rg -q 'pull_request_target|types: \[closed\]' .github/workflows/migrate.yml`. Closes REQ-002, REQ-003, REQ-004, REQ-007, REQ-008, REQ-009, REQ-011, REQ-013, REQ-014.

- [BLOCKED] T1.3 Perform a credential-exposure review of the complete workflow: the only credential consumers are the two migration commands and Neon API lookup; no lifecycle script runs; no raw connection URI or API response is logged. Validation: `! rg -n -e 'echo.*NEON_API_KEY|cat.*uri|curl.*connection_uri.*\|' .github/workflows/migrate.yml && rg -q '::add-mask::\$uri' .github/workflows/migrate.yml && rg -q 'database_url=\$uri.*GITHUB_OUTPUT' .github/workflows/migrate.yml && rg -q -- '--ignore-scripts' .github/workflows/migrate.yml`; record the manual full-file review in the task completion note. Blocked: the implementation author cannot self-approve this review; it requires an independent security reviewer. Closes REQ-005, REQ-006, REQ-014.

## T2: Security documentation

- [x] T2.1 Update the A05 row in `docs/testing-and-security.md` to distinguish Vercel runtime secrets from CI-only GitHub Actions secrets, and state that schema-modification credentials never belong in Vercel. Validation: `rg -q 'GitHub Actions' docs/testing-and-security.md && rg -q 'Vercel' docs/testing-and-security.md`. Closes REQ-005, REQ-006.

## T3: Operator setup

- [x] T3.1 Confirm the two GitHub Actions secrets and three repository variables documented in design.md exist, without printing their values. Validation: `gh secret list | rg -q '^PROD_MIGRATION_DATABASE_URL' && gh secret list | rg -q '^NEON_API_KEY' && gh variable list | rg -q '^NEON_PROJECT_ID' && gh variable list | rg -q '^NEON_MIGRATION_ROLE_NAME' && gh variable list | rg -q '^NEON_DATABASE_NAME'`. Closes REQ-005, REQ-006.

## T4: Live workflow verification

- [BLOCKED] T4.1 Dispatch the production job from this trusted branch after T3 succeeds, wait for its run, and confirm the result is successful; an already-in-sync result is the expected idempotency proof. Validation: `gh run list --workflow=migrate.yml --branch chore/infra-migration-pipeline --json conclusion,event --jq '[.[] | select(.event=="workflow_dispatch")][0].conclusion' | rg -x 'success'`. Blocked: waiting for T3.1 operator setup. Closes REQ-001, REQ-007, REQ-008, REQ-013.

- [BLOCKED] T4.2 Dispatch the preview job for an existing repository preview branch after T3 succeeds, wait for its run, and confirm the result is successful. Validation: `gh run list --workflow=migrate.yml --branch chore/infra-migration-pipeline --json conclusion,event --jq '[.[] | select(.event=="workflow_dispatch")][0].conclusion' | rg -x 'success'`. Blocked: waiting for T3.1 operator setup and an existing Neon preview branch. Closes REQ-004, REQ-005, REQ-006, REQ-007, REQ-013.

- [x] T4.3 Validate the automatic-trigger and concurrency configuration without introducing a throwaway database migration: confirm the workflow is scoped to migration-path changes, forbids `pull_request_target`, accepts only internal PRs, and delegates concurrency to Prisma rather than GitHub `concurrency`. Validation: `rg -q 'prisma/migrations/\*\*' .github/workflows/migrate.yml && ! rg -q 'pull_request_target|^[[:space:]]*concurrency:' .github/workflows/migrate.yml && rg -q 'head.repo.full_name == github.repository' .github/workflows/migrate.yml`. Closes REQ-002, REQ-003, REQ-009, REQ-012.

After all tasks pass, apply the `qa`, `code-quality`, and `reviewer` personas, then run `security-scan`, `spec-closeout`, and `pr-prep` in that order.
