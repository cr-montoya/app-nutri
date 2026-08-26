# Design: Infra, Migration Pipeline

## Architecture touched

One new GitHub Actions workflow file (`.github/workflows/migrate.yml`) with two jobs, `migrate-production` and `migrate-preview` — see "Files to create or update". No application code, no Prisma schema change, no new route. This is CI/CD infrastructure sitting alongside `.github/workflows/security.yml` and `.github/workflows/dast.yml`. Specialist persona applied: `database-architect.md`, for its migration-safety and least-privilege-credential lens — no new schema or RLS surface here (the RLS checklist doesn't apply, there's no new tenant-scoped table), but the "every migration reviewed... safe to run against a database with existing rows" responsibility already belongs to whichever spec authored each individual migration file; this pipeline only automates *applying* already-authored, already-reviewed migrations, it doesn't re-review their content.

The credential-acquisition design follows ADR-0004 (split credentials), which followed a `decision-debate` the user confirmed: **Option B**, a static production secret plus a project-scoped Neon API key used only for preview lookup.

## Requirement coverage

| REQ | Covered by |
|---|---|
| REQ-001 | `migrate-production` job, triggered on `push` to `main`, no `needs:` dependency on `security.yml`'s jobs — runs as a fully independent workflow |
| REQ-002 | `migrate-preview` job, triggered on `pull_request: [opened, synchronize]` targeting `main` |
| REQ-003 | `migrate-preview`'s `if:` condition checks `github.event.pull_request.head.repo.full_name == github.repository`; the workflow uses the `pull_request` trigger (not `pull_request_target`), which GitHub never grants repo secrets to for fork-originated PRs by default — this is the standard, simpler fork-safety mechanism for `pull_request`-triggered workflows (`dast.yml`'s more roundabout `gh api .../pulls` check exists only because *its* trigger is `deployment_status`, which carries no head-repo information at all) |
| REQ-004 | A bounded poll loop (concrete budget below) against Neon's list-branches API before giving up |
| REQ-005 | Two dedicated GitHub Actions secrets (below), neither ever set in Vercel's environment variables — verified as a task validation step |
| REQ-006 | Same two secrets; `NEON_PROJECT_ID`/`NEON_MIGRATION_ROLE_NAME`/`NEON_DATABASE_NAME` are non-sensitive on their own (none grant access without `NEON_API_KEY`) and live as GitHub Actions **variables**, not secrets |
| REQ-007 | Both jobs run `prisma migrate deploy` with `set -euo pipefail`; any failure (migration error, branch never found, curl failure) is a non-zero exit, which GitHub reports as a failed check |
| REQ-008 | `prisma migrate deploy` itself guarantees this; the pipeline adds no wrapping logic that could break it |
| REQ-009 | Not solved by new code — named explicitly as relying on `prisma migrate deploy`'s built-in advisory lock, per requirements.md |
| REQ-010 | New workflow files only; `package.json`'s `build` script (already fixed to run `prisma generate && next build --turbopack` for the `phase-1a-team-invites` Vercel failure) is untouched by this spec |
| REQ-011 | No branch-cleanup logic added; not needed |

## Credentials (ADR-0004)

Two new GitHub Actions secrets, provisioned by the operator (out of scope for this spec's tasks, same as `appnutri_app`'s local password in `phase-0-scaffold`):

- `PROD_MIGRATION_DATABASE_URL` — a direct Postgres connection string for a schema-modification-capable role on the production Neon branch. Reuses whichever role/credential was originally used to apply `phase-0-scaffold`'s migrations to production (Neon's default project role, already present without extra provisioning), unless the operator prefers to provision a narrower dedicated role at that time — either is compatible with this design, the workflow only needs *a* working connection string in this secret. Never touched by any Neon API call.
- `NEON_API_KEY` — a **project-scoped** Neon API key (Editor access, per Neon's current key-scoping model; there is no narrower/read-only key type available), used exclusively by the `migrate-preview` job to look up a PR's branch and its connection URI. Never used for anything touching the production branch.

Plus three non-secret GitHub Actions **variables** (none grant access on their own without `NEON_API_KEY`):

- `NEON_PROJECT_ID` — the Neon project's id, needed to construct API URLs.
- `NEON_MIGRATION_ROLE_NAME` — the Postgres role name to request via `connection_uri` for preview lookups. Deliberately a variable, not a hardcoded value in the workflow file: Neon's `connection_uri` endpoint requires an explicit `role_name` with no default (verified against Neon's API reference — `branch_id` and `endpoint_id` default sensibly if omitted, `role_name` and `database_name` do not), and there's no reliable way to auto-discover "the migration-capable role" from Neon's list-roles response (no owner/default flag on a role entry — picking "whichever role isn't `appnutri_app`" is a fragile heuristic that breaks the moment a third role exists). Rather than hardcode a name nobody in this session could actually verify against the live Neon project, the operator sets it once during setup to match whatever role `PROD_MIGRATION_DATABASE_URL`'s connection string already uses, so both environments run migrations under the same logical role.
- `NEON_DATABASE_NAME` — the database name to request via `connection_uri`. Same reasoning: local Postgres uses `appnutri` as both role and database name, but nothing in this session confirmed Neon's database is named identically rather than a Neon-generated default (`neondb` is Neon's typical out-of-the-box name) — a variable avoids hardcoding a guess. If the guess is wrong, `connection_uri` fails clearly (curl error, non-zero exit, REQ-007) rather than silently misbehaving, but there's no reason to guess at all when a variable costs nothing extra.

## `migrate-preview`'s branch lookup (REQ-002, REQ-004)

Neon's Vercel-managed integration names each preview branch `preview/<git-branch>` (documented convention). For a `pull_request` event, `github.head_ref` is the PR's source branch name, so the target is always `preview/${{ github.head_ref }}`.

Lookup sequence:
1. `GET https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches`, filter client-side (`jq`) for `.name == "preview/<head_ref>"`.
2. If not found, sleep 15s and retry. **Budget: 20 attempts (5 minutes total)** — long enough to cover the Vercel-integration's typical branch-provisioning time (it fires from the same `pull_request`/push event this workflow does, so both start around the same moment), short enough that a genuinely stuck pipeline fails within a coffee break, not silently hangs. If the budget is exhausted, exit 1 (REQ-004, REQ-007).
3. Once the branch id is found: `GET .../connection_uri?branch_id=<id>&database_name=$NEON_DATABASE_NAME&role_name=$NEON_MIGRATION_ROLE_NAME` to get the ready-to-use connection string.
4. **Immediately mask the fetched connection string** with `::add-mask::` before any further step, since it embeds a live password and — unlike a registered `secrets.*` value — GitHub's automatic log redaction does not know to hide a value it didn't itself inject. No step in this job echoes the raw API response or the connection string; this is a hard requirement on the implementation, not a nice-to-have, and directly serves REQ-005/REQ-006's intent (a credential that never leaks is the whole point of keeping it out of Vercel in the first place).

## Workflow sketch

```yaml
# .github/workflows/migrate.yml
name: migrate

on:
  push:
    branches: [main]
    paths: ["prisma/migrations/**"]
  pull_request:
    branches: [main]
    types: [opened, synchronize]
    paths: ["prisma/migrations/**"]
  workflow_dispatch:
    inputs:
      pr_branch:
        description: "Git branch name to migrate as a preview (leave empty to only run migrate-production)"
        required: false

jobs:
  migrate-production:
    if: github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.pr_branch == '')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<pinned-sha>
      - uses: pnpm/action-setup@<pinned-sha>
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.PROD_MIGRATION_DATABASE_URL }}

  migrate-preview:
    if: >-
      (github.event_name == 'pull_request' &&
       github.event.pull_request.head.repo.full_name == github.repository) ||
      (github.event_name == 'workflow_dispatch' && inputs.pr_branch != '')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<pinned-sha>
      - name: Resolve preview branch connection string
        id: neon
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          NEON_PROJECT_ID: ${{ vars.NEON_PROJECT_ID }}
          NEON_MIGRATION_ROLE_NAME: ${{ vars.NEON_MIGRATION_ROLE_NAME }}
          NEON_DATABASE_NAME: ${{ vars.NEON_DATABASE_NAME }}
          BRANCH_NAME: preview/${{ github.event_name == 'workflow_dispatch' && inputs.pr_branch || github.head_ref }}
        run: |
          set -euo pipefail
          branch_id=""
          for i in $(seq 1 20); do
            branch_id=$(curl -sf -H "Authorization: Bearer $NEON_API_KEY" \
              "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
              | jq -r --arg n "$BRANCH_NAME" '.branches[] | select(.name==$n) | .id')
            [ -n "$branch_id" ] && break
            sleep 15
          done
          if [ -z "$branch_id" ]; then
            echo "::error::Neon branch $BRANCH_NAME did not appear within 5 minutes"
            exit 1
          fi
          uri=$(curl -sf -H "Authorization: Bearer $NEON_API_KEY" \
            "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/connection_uri?branch_id=$branch_id&database_name=$NEON_DATABASE_NAME&role_name=$NEON_MIGRATION_ROLE_NAME" \
            | jq -r '.uri')
          echo "::add-mask::$uri"
          echo "database_url=$uri" >> "$GITHUB_OUTPUT"
      - uses: pnpm/action-setup@<pinned-sha>
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prisma migrate deploy
        env:
          DATABASE_URL: ${{ steps.neon.outputs.database_url }}
```

Action versions are pinned by SHA at implementation time (matching `dast.yml`'s existing convention of pinned third-party actions), not written out here since the current SHAs aren't known until the task actually runs `dependabot`/checks the tag.

`workflow_dispatch` exists so this spec's own tasks (and any operator, later) have a way to exercise both jobs on demand — including proving the pipeline works at all once the operator secrets exist — without needing an actual migration file change to trigger the `paths:` filter. It's restricted to repository collaborators by GitHub's own permission model (not a `pull_request`-shaped trigger), so REQ-003's fork concern doesn't apply to it.

## Multi-tenant isolation and RBAC impact

None. This pipeline touches no tenant-scoped model, no RLS policy, no application code path a `Membership`/`Patient`/session ever runs through. Its only relationship to the isolation model is credential hygiene (REQ-005/006), already covered above.

## Reused vs. new

Reused: `prisma migrate deploy` (no new migration-running logic, just automating an existing command), the pinned-third-party-action convention from `dast.yml`, the "verify not a fork" safety concern `dast.yml` already established for a different (lower-stakes) secret. New: the two workflow jobs, the two GitHub Actions secrets, the three GitHub Actions variables, ADR-0004.

## Files to create or update

```
.github/workflows/migrate.yml            # new: migrate-production and migrate-preview jobs
docs/testing-and-security.md              # update: A05 row currently says "Secrets only in Vercel environment variables" -- no longer accurate once PROD_MIGRATION_DATABASE_URL/NEON_API_KEY exist as GitHub Actions-only secrets; reword to name both locations explicitly
docs/adr/0004-split-migration-credentials.md   # already created during this phase
```

## Operator setup (outside version control, before T1 can be validated)

1. Confirm or provision the production migration role's connection string; store it as the `PROD_MIGRATION_DATABASE_URL` GitHub Actions secret.
2. Create a project-scoped Neon API key (Editor access — no narrower option exists); store it as the `NEON_API_KEY` secret.
3. Add `NEON_PROJECT_ID`, `NEON_MIGRATION_ROLE_NAME` (matching whichever role `PROD_MIGRATION_DATABASE_URL` uses), and `NEON_DATABASE_NAME` as GitHub Actions repository variables.

`task-runner` cannot perform these steps itself (no Neon dashboard/API credential access from this environment, and doesn't need one — that's the entire point of REQ-005/006). Tasks that depend on these existing will validate their *presence* (`gh secret list`, `gh variable list`) rather than their values.

## Deviations

None yet; filled in by `spec-closeout` if implementation diverges.
