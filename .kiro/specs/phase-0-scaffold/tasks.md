# Tasks: Phase 0, Scaffold, Auth, Multi-Tenant Skeleton

Branch: `feat/phase-0-scaffold`, created by `task-runner` from up-to-date `main` before T1.1, per `.agents/rules/trunk-based.md`.

## T1: Project scaffold

- [x] T1.1 Initialize the Next.js 15 project (TypeScript, App Router, Tailwind CSS v4) with `pnpm`. Validation: `pnpm build` succeeds on the empty scaffold.
- [x] T1.2 Install and configure shadcn/ui; add one primitive (`Button`) to confirm the setup. Validation: `pnpm build` succeeds with the primitive imported on a smoke page.
- [x] T1.3 Add Prisma, Auth.js v5, `@node-rs/argon2`, Zod, and React Hook Form as dependencies. Validation: `pnpm install` completes; only `pnpm-lock.yaml` exists, no `package-lock.json`/`yarn.lock` (`.agents/rules/pnpm-only.md`).

## T2: Schema and tenant isolation (REQ-012, REQ-013, REQ-020)

- [x] T2.1 Write `prisma/schema.prisma` per `design.md`: `Organization`, `User`, `Membership` (with `userId @unique`, REQ-020), `Professional`, `Role` enum. Validation: `pnpm exec prisma validate`.
- [x] T2.2 Run the initial migration against the dev Neon branch. Validation: `pnpm exec prisma migrate dev` succeeds and generates the migration file. **Deviation**: no Neon account/CLI is available in this environment; ran against a local Postgres 16 container (Docker) instead. Same engine, same migration SQL either way; running it against an actual Neon dev branch is still required before shipping and is noted in the PR as outstanding infrastructure setup.
- [x] T2.3 Add the RLS statements from `design.md` (`ENABLE ROW LEVEL SECURITY` + policy on `memberships` and `professionals`) to the migration. Validation: manual `psql` check confirming RLS is enabled and the policy exists on both tables. Verified: `relrowsecurity = t` on both tables and `tenant_isolation` policy present in `pg_policies` (local Postgres via Docker, see T2.2 deviation note). `database-architect` review flagged that the local `appnutri` DB role used for migrations is a superuser (`rolbypassrls = t`) that owns the tables, so RLS would enforce nothing for any connection using it; fixed by creating a dedicated non-superuser `appnutri_app` role (`NOSUPERUSER NOBYPASSRLS`) for the app/tests, kept separate from the migration/owner role. See `.env`, `.env.example` (`APP_DATABASE_URL`).
- [x] T2.4 Implement `src/lib/db.ts`: the Prisma Client Extension and `withTenant`, using `AsyncLocalStorage` and `SET LOCAL app.current_org_id` inside a transaction. Validation: `pnpm test -- db`, a unit test exercising `withTenant` with two fake org ids and asserting the injected filter. 8/8 tests passing (`src/lib/db.test.ts`, exercising the exported `applyTenantScope` injection logic directly with two fake org ids, no DB needed).
- [x] T2.5 Positive RLS test: a session scoped to org A reads/writes its own `Membership`/`Professional` rows through `withTenant`. Validation: `pnpm test -- rls-positive`. Closes REQ-012. `tests/integration/rls-positive.test.ts`, 3/3 passing against the local Postgres (Docker) instance via the non-superuser `appnutri_app` role.
- [x] T2.6 Negative RLS test: a raw `pg` client with `app.current_org_id` set to org A, querying `memberships`/`professionals` directly (bypassing Prisma), returns zero rows for org B. Validation: `pnpm test -- rls-negative`. Closes REQ-013. `tests/integration/rls-negative.test.ts`, 4/4 passing (also covers the no-org-set case).

## T3: Auth core (REQ-008, REQ-009, REQ-010, REQ-011, REQ-016, REQ-018)

- [x] T3.1 Implement `src/lib/auth.ts`: Auth.js v5 config, Credentials provider using `@node-rs/argon2` to verify the password, JWT session carrying `userId` and `organizationId`, `maxAge` of 8 hours, and a `jwt()` callback that rejects the session if `tokenVersion` no longer matches the database. Validation: `pnpm test -- auth`. Closes REQ-008, REQ-009, REQ-010, REQ-011, REQ-018. 25/25 tests passing; also added `src/lib/auth-core.ts` (the testable REQ-008/009/018 logic, split out so the unit test doesn't have to load Auth.js's Next.js-runtime-only dependencies) and `src/app/api/auth/[...nextauth]/route.ts` (the route handler Auth.js needs, not separately called out in design.md's file list but required plumbing).
- [x] T3.2 Implement `src/lib/rbac.ts`: a `requireRole` stub for later phases to build on. Validation: `pnpm test -- rbac`. 5/5 tests passing.
- [x] T3.3 Implement `src/middleware.ts` using Auth.js's `auth()` export as middleware, matcher scoped to `(app)/*`. Validation: `pnpm test:e2e -- auth-redirect`. Closes REQ-016. 4/4 Playwright tests passing. See design.md's Deviations for the Node.js Middleware runtime note and the matcher/allowlist approach.

## T4: Registration (REQ-001 through REQ-007, REQ-020, REQ-021)

- [x] T4.1 Write `src/validation/auth.ts`: Zod schemas for registration (email format, name 1 to 100 chars trimmed, password min 12 chars, org name 2 to 100 chars trimmed) and an async HIBP range-API check. Validation: `pnpm test -- validation`. Closes REQ-003, REQ-004, REQ-005, REQ-006, REQ-021. 15/15 tests passing (HIBP check tested with a mocked `fetch`, no live network call).
- [x] T4.2 Implement `src/server/actions/auth.ts`'s `registerAction`: a `db.$transaction` creating `User` (including `name`) + `Organization` + `Membership` atomically, the slug disambiguation loop (`-2`, `-3`, ...), and handling the `User.email` unique-constraint violation with the generic error from REQ-002. Validation: `pnpm test -- register-action`. Closes REQ-001, REQ-002, REQ-007, REQ-020. 4/4 tests passing against the real local Postgres. See design.md's Deviations for the RLS bootstrap fix this surfaced.
- [x] T4.3 Build `src/app/(auth)/register/page.tsx` and its form component, wired to `registerAction`. Validation: `pnpm test:e2e -- register`. 6/6 Playwright tests passing (auth-redirect + register together).

## T5: Login and session (REQ-008, REQ-009, REQ-015)

- [x] T5.1 Build `src/app/(auth)/login/page.tsx` and its form component, wired to Auth.js `signIn`, showing the generic error from REQ-009 on failure. Validation: `pnpm test:e2e -- login`. Closes REQ-008, REQ-009. 3/3 Playwright tests passing. Surfaced and fixed a login-time RLS bootstrap gap, see design.md's Deviations.
- [x] T5.2 Wire logout (`signOut`) with a redirect to `/login`. Validation: `pnpm test:e2e -- logout`. Closes REQ-015. 1/1 Playwright test passing, wired through a real "Log out" button on `/` (see design.md's Deviations on why).

## T6: Workspace routes (REQ-014, REQ-017)

- [ ] T6.1 Build `src/app/(app)/[orgSlug]/layout.tsx`: resolve the session, compare `orgSlug` to the session's organization, `notFound()` on any mismatch (REQ-017's undifferentiated 404). Validation: `pnpm test:e2e -- wrong-org`. Closes REQ-017.
- [ ] T6.2 Build `src/app/(app)/[orgSlug]/dashboard/page.tsx`: display the organization's name and the user's role, no clinical data. Validation: `pnpm test:e2e -- dashboard`. Closes REQ-014.

## T7: Deploy (REQ-019)

- [ ] T7.1 Connect the Vercel project to the GitHub repo and configure the Neon Vercel integration for per-PR database branching. Validation: open a throwaway PR against `main` and confirm both a Vercel preview URL and a Neon branch are created. Closes REQ-019.

## T8: End-to-end isolation proof

- [ ] T8.1 Playwright E2E covering the phase's actual purpose: register organization A, register organization B, log in as A, confirm the dashboard shows only A's data, then while still authenticated as A request B's dashboard URL and confirm a 404 with no leaked data. Validation: `pnpm test:e2e -- multi-tenant-isolation`. Confirms REQ-012, REQ-013, REQ-016, REQ-017 hold end to end, not just in isolated unit tests.

## After T8.1

Run `spec-closeout`, then `pr-prep`.
