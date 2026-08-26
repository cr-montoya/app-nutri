# Design: Phase 0, Scaffold, Auth, Multi-Tenant Skeleton

## Architecture touched

This is the first spec to touch the Prisma schema, so nothing existing is reused; instead this design establishes the exact patterns (`withTenant`, RLS policy shape, Server Action structure, route layout) that every later phase reuses without re-deciding. Layers touched, per `.kiro/steering/structure.md`: `prisma/schema.prisma`, `src/lib/db.ts`, `src/lib/auth.ts`, `src/server/actions/`, `src/middleware.ts`, `src/app/`.

Specialist personas applied: `database-architect.md` (schema and RLS below), `nextjs-architect.md` (routing below), and `security.md` (the deployed database-connection contract below).

## Neon-Vercel runtime connection contract (REQ-022 through REQ-024)

The Neon Vercel integration creates a separate database branch for each Preview deployment and supplies its pooled, branch-specific connection string as `DATABASE_URL`. The integration is configured in Neon to use `appnutri_app`, the non-owner, non-`BYPASSRLS` role created by the Phase 0 migration. Vercel exposes `VERCEL_ENV`, so the runtime can distinguish this trusted deployment environment from local tooling.

`src/lib/db.ts` will resolve its runtime URL as follows:

| Environment | Runtime connection | Reason |
|---|---|---|
| Vercel Preview / Production (`VERCEL_ENV` set) | `DATABASE_URL` | Neon updates it to the isolated branch URL for the selected restricted role. |
| Local / tests (`VERCEL_ENV` unset) | `APP_DATABASE_URL` | Keeps the migration-owner `DATABASE_URL` unavailable to the local application runtime. |

Both paths fail closed when their required variable is absent. There is no fallback from local `APP_DATABASE_URL` to `DATABASE_URL`, and no owner connection is configured in Vercel. `DATABASE_URL_UNPOOLED` remains managed by Neon but is not consumed by the application; Prisma 6 supports Neon's pooled URL for runtime queries.

No Prisma schema, migration, tenant policy, RBAC rule, or UI changes are required. The security persona's review requires a live preview check using `SELECT current_user` with the deployed branch URL or Neon/Vercel integration metadata, confirming the configured role is `appnutri_app`, followed by an HTTP request to `/register`.

This is the decision recorded in ADR-0003.

## Schema (database-architect)

```prisma
enum Role { ADMIN NUTRITIONIST FRONT_DESK }

model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  memberships Membership[]
  @@map("organizations")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  name         String
  tokenVersion Int      @default(0)
  createdAt    DateTime @default(now())
  membership   Membership?
  @@map("users")
}

model Membership {
  id             String   @id @default(cuid())
  userId         String   @unique
  organizationId String
  role           Role
  createdAt      DateTime @default(now())
  user           User         @relation(fields: [userId], references: [id])
  organization   Organization @relation(fields: [organizationId], references: [id])
  professional   Professional?
  @@index([organizationId])
  @@map("memberships")
}

model Professional {
  id             String  @id @default(cuid())
  membershipId   String  @unique
  organizationId String
  licenseNumber  String?
  specialty      String?
  signatureUrl   String?
  membership     Membership @relation(fields: [membershipId], references: [id])
  @@index([organizationId])
  @@map("professionals")
}
```

Design decisions on the schema, each closing a point `plan.md` left implicit:

- **`Membership.userId` is `@unique`**, not just unique per `(userId, organizationId)`. This enforces the Requirements-phase decision (one organization per user in this phase) at the database level, not just in application code. Removing this constraint later to support multi-org membership is an additive migration (drop one unique index, keep the table), not a breaking one, so it doesn't foreclose the deferred `plan.md` §10.5 decision.
- **`Professional.organizationId` is a denormalized column**, not derived only through `Membership`. `plan.md` §4 closes with "every tenant-scoped table has an indexed `organizationId`," which already resolves this without needing a debate: a direct column keeps the RLS policy a simple equality check instead of an `EXISTS` subquery against `Membership`, and it's set once at creation time from the same transaction that creates the `Membership`, never re-parented.
- No `Patient`/clinical models in this migration; out of scope per `requirements.md`.

Migration safety: this is the first migration against an empty database, so the "existing rows" and "NOT NULL backfill" concerns in `database-architect.md` don't apply here; they will the first time a later phase adds a required column to one of these tables.

## RLS policy (database-architect checklist)

Applies to `memberships` and `professionals` only; `organizations` and `users` are not tenant-scoped (a `User` is a global login identity, looked up by email before any org context exists; an `Organization` is the tenant itself, not scoped to itself).

```sql
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON professionals
  USING ("organizationId" = current_setting('app.current_org_id', true));
```

- [x] `ENABLE ROW LEVEL SECURITY` present on both tables.
- [x] Both policies reference `current_setting('app.current_org_id', true)`, set server-side only (see Tenant-context propagation below), never a client-supplied value.
- [ ] Positive test (task, not yet run): a session scoped to org A reads/writes its own `Membership`/`Professional` rows. Satisfies REQ-012.
- [ ] Negative test (task, not yet run): a raw `psql`/`pg` client with `app.current_org_id` set to org A gets zero rows querying org B directly, bypassing Prisma entirely. Satisfies REQ-013.
- [x] Policy overhead: both policies filter on an indexed column (`organizationId` on both tables), so no sequential scan risk at any realistic Phase 0 scale.

Both boxes without a task yet are written up as concrete tasks in `tasks.md`, not left implicit.

## Routing and rendering (nextjs-architect)

| Route | Rendering | Data fetching | Streaming |
|---|---|---|---|
| `(auth)/register/page.tsx` | Server-rendered shell, Client Component for the form (needs client-side field state and submit handling) | Server Action (`src/server/actions/auth.ts`, `registerAction`) | No; single fast operation, a loading state on the submit button is enough |
| `(auth)/login/page.tsx` | Same pattern as `/register` | Auth.js Credentials provider `authorize()` callback in `src/lib/auth.ts` | No |
| `/(app)/[orgSlug]/dashboard` | Server Component, server-rendered per request | Direct Server Component fetch of the session and `Membership` row | No; one cheap query, nothing data-heavy yet in this phase |
| `middleware.ts` | N/A | Auth.js `auth()` export used directly as middleware, per Auth.js v5's documented pattern | N/A |
| `/(app)/[orgSlug]/layout.tsx` | Server Component | Resolves the session, checks `orgSlug` against the session's organization | N/A |

Route structure follows `src/app/(app)/[orgSlug]/...` exactly as `nextjs-architect.md` specifies, with public auth routes in a sibling `src/app/(auth)/` group. `middleware.ts` handles REQ-016 (unauthenticated redirect); the org layout handles REQ-017 (wrong-org 404), since only the layout has the `orgSlug` param needed to compare against the session's organization.

## Tenant-context propagation

`plan.md` §3 describes `withTenant` as an `AsyncLocalStorage`-scoped wrapper but doesn't specify where it's invoked in a Next.js App Router request. Resolved here: **each Server Component and Server Action independently resolves the session via `auth()` and wraps its own data access in `withTenant`**, rather than one `AsyncLocalStorage.run()` call wrapping an entire request tree from the layout down. Next.js App Router doesn't give a single function that wraps the full render of a route tree the way a traditional Express middleware would, so relying on one top-level `AsyncLocalStorage.run()` to reach every nested Server Component is not guaranteed. Each data-access point establishing its own scope, from the same `session.activeOrgId`, is more verbose but doesn't depend on an unstated assumption about Next.js's internal rendering/scheduling behavior.

```
Request → middleware.ts (auth() checks session exists) →
  [orgSlug]/layout.tsx (auth() again, compares session.org to orgSlug, 404 on mismatch) →
    dashboard/page.tsx (auth() again, withTenant(session, () => db.membership.findUnique(...)))
```

`auth()` itself is cheap (JWT decode, no DB call), so calling it more than once per request is an accepted, minor cost, not a performance concern at this scale.

## Requirement coverage

| REQ | Covered by |
|---|---|
| REQ-001 | `registerAction`: `db.$transaction` creating `User` + `Organization` + `Membership` atomically |
| REQ-002 | `User.email` unique constraint; `registerAction` catches the Prisma unique-violation error and returns the generic message |
| REQ-003 | Zod email validation in `src/validation/auth.ts`, checked before `registerAction` touches the database |
| REQ-004 | Zod `min(12)` on password in the same schema |
| REQ-005 | HIBP range API call in `registerAction`, before the transaction |
| REQ-006 | Zod length validation on organization name in the same schema |
| REQ-007 | Slug generation helper in `registerAction`: base slug, then a loop appending `-2`, `-3`, ... querying `Organization.findUnique({ slug })` until free, inside the same transaction |
| REQ-008 | Auth.js Credentials provider, `authorize()` in `src/lib/auth.ts` |
| REQ-009 | `authorize()` returns `null` on any mismatch; Auth.js maps that to a generic credentials error |
| REQ-010 | `@node-rs/argon2` per ADR-0001 |
| REQ-011 | Auth.js JWT `maxAge: 60 * 60 * 8` |
| REQ-012 | `withTenant` + Prisma Client Extension, `src/lib/db.ts` |
| REQ-013 | RLS policies above |
| REQ-014 | Dashboard Server Component, reads session + `Membership` |
| REQ-015 | Auth.js `signOut()` |
| REQ-016 | `middleware.ts`, Auth.js `auth()` as middleware, matcher on `/(app)/*` |
| REQ-017 | `[orgSlug]/layout.tsx` comparing `session.orgSlug` to the route param, `notFound()` on mismatch, no distinction from a nonexistent slug |
| REQ-018 | `User.tokenVersion` field, checked in the Auth.js `jwt()` callback against the current DB value; no UI trigger built this phase |
| REQ-019 | Vercel project connected to the GitHub repo with Neon's Vercel integration for per-PR branching; a configuration task, not application code |
| REQ-020 | `Membership.userId @unique` in the schema above |
| REQ-021 | Zod length validation on the name field in `src/validation/auth.ts`, same file/pattern as REQ-006's org-name check |
| REQ-022 | Runtime URL resolver in `src/lib/db.ts`, selecting the Vercel-provided Neon URL only when `VERCEL_ENV` is present |
| REQ-023 | Neon integration configured for `appnutri_app`; deployment validation confirms the restricted current user, never an owner connection |
| REQ-024 | A redeployed PR preview uses the dynamic Neon URL and serves `/register` |

## Files to create or update

```
prisma/schema.prisma                          # new: Organization, User, Membership, Professional, Role
prisma/migrations/.../migration.sql            # generated; includes the RLS statements above, added manually after prisma migrate dev
src/lib/db.ts                                  # new: Prisma Client Extension, withTenant
src/lib/db.test.ts                             # update: unit coverage for local versus Vercel runtime URL resolution
src/lib/auth.ts                                # new: Auth.js v5 config, Credentials provider, jwt()/session() callbacks
src/lib/rbac.ts                                # new: requireRole stub
src/server/actions/auth.ts                     # new: registerAction
src/validation/auth.ts                         # new: Zod schemas for register/login
src/middleware.ts                              # new: auth() as middleware, matcher on (app)/*
src/app/(auth)/register/page.tsx               # new
src/app/(auth)/login/page.tsx                  # new
src/app/(app)/[orgSlug]/layout.tsx             # new: session/org-slug check
src/app/(app)/[orgSlug]/dashboard/page.tsx     # new
package.json, pnpm-lock.yaml                   # new: Next.js, Prisma, Auth.js, @node-rs/argon2, Zod, Tailwind, shadcn deps
```

## Multi-tenant isolation and RBAC impact

Every tenant-scoped table in this phase (`memberships`, `professionals`) is covered by both isolation layers per `.agents/rules/tenant-isolation.md`. No RBAC enforcement beyond "is this user's role ADMIN" is needed yet, since `FRONT_DESK`/`NUTRITIONIST` accounts can't be created until an invite flow exists (out of scope, see `requirements.md`); `src/lib/rbac.ts` is still stubbed in this phase with a single `requireRole` helper so the pattern exists for `Phase 1` to build on, not left for that phase to invent from scratch.

## Reused vs. new

Everything is new; this phase has no prior code to reuse. It exists specifically to be the thing later phases reuse: the `withTenant` wrapper, the RLS policy shape, the Server Action + Zod validation pattern, and the route layout convention.

## Deviations

- **`checkPasswordNotBreached` (`src/validation/auth.ts`) fails open when the HIBP range API is unreachable or errors**, rather than blocking every registration on a third-party outage. REQ-005 doesn't specify this failure mode. Only the password's SHA-1 hash prefix (5 hex chars, k-anonymity) is ever sent, never the password or its full hash.
- **`src/middleware.ts` opts into Next.js 15's Node.js Middleware (`export const runtime = "nodejs"`)**, not the default Edge runtime. REQ-018 requires the `tokenVersion` check on every session read, including from middleware; that check calls Prisma (`node:async_hooks`, native/WASM `@node-rs/argon2` transitively through the shared Auth.js config), none of which the Edge runtime supports. Middleware's matcher also can't literally express "`(app)/*`" as design.md's routing table says, since Next.js strips route groups from the URL; it runs on every path except static assets and explicitly allowlists the public auth routes (`/`, `/login`, `/register`, `/api/auth/*`) instead, which is the documented Auth.js v5 pattern for this exact case.
- **`slugify` lives in `src/server/services/organization-slug.ts`, not inside `src/server/actions/auth.ts`** despite design.md's coverage table describing it as part of `registerAction`. Next.js requires every export from a `"use server"` file to itself be an async Server Action; `slugify` is a small sync pure helper, so it's a compile error to export it alongside `registerAction` in the same file. Matches `.kiro/steering/structure.md`'s placement rule ("new use case/orchestration -> src/server/actions/ or src/server/services/").
- **Login needed a second, narrower RLS bootstrap fix beyond registration's.** `authorizeCredentials` (src/lib/auth-core.ts) has to find which organization a user belongs to *before* any tenant session exists to scope that lookup by -- there is no `organizationId` to `SET LOCAL` yet, unlike `registerAction`, because finding it is the whole point of the query. A plain `db.user.findUnique({ include: { membership: true } })` silently returned zero membership rows (RLS blocking the join, `app.current_org_id` unset) and made every login fail with `CredentialsSignin`, caught by `tests/e2e/login.spec.ts` actually running against Postgres. Fixed with a narrow `SECURITY DEFINER` Postgres function, `get_membership_for_login(userId)` (migration `20260826054241_login_membership_lookup_function`), grantable only to `appnutri_app` and returning only `organizationId`/`role` for one specific `userId` -- not a blanket RLS bypass. That same migration also formalizes the `appnutri_app` role's creation and table grants as an idempotent migration instead of the ad hoc local `psql` session T2.3 originally set it up with, so a fresh database (Neon, CI) can reach the same state via `prisma migrate deploy` alone; a password still has to be set out-of-band per environment (`ALTER ROLE appnutri_app PASSWORD '...'`) so no secret is committed to a migration file.
- **`src/server/actions/session.ts` (`loginAction`, `logoutAction`) is a separate file from `src/server/actions/auth.ts` (`registerAction`)**, for the same reason `src/lib/auth-core.ts` is split from `src/lib/auth.ts`: importing the actual `NextAuth(...)` instance (`@/lib/auth`) pulls in Auth.js's Next.js-runtime-only dependencies, which made `tests/integration/register-action.test.ts` fail to load under Vitest when `loginAction`/`logoutAction` lived in the same file.
- **`src/app/page.tsx` (the root landing page) is now a Server Component that checks `auth()` and renders a "Log out" button wired to `logoutAction` when a session exists**, instead of always showing "Log in". This wasn't in design.md's file list, but T5.2 needs *some* real UI to click through end-to-end (`tests/e2e/logout.spec.ts`), and the org-slug workspace routes that would normally host this don't exist until T6.
- **Security review findings (T1-T3 gate, `security` persona) and their resolutions:**
  - `src/lib/db.ts`'s `createBaseClient()` used to silently fall back to `DATABASE_URL` (the RLS-bypassing owner role) if `APP_DATABASE_URL` was unset, which would quietly disable the entire RLS defense-in-depth layer in a misconfigured environment. Fixed: it now throws at startup if `APP_DATABASE_URL` isn't set, no fallback.
  - `pnpm audit --audit-level=high` had 4 high findings, all transitive (`sharp`/`postcss` pinned inside `next`'s own dependency tree; `deepmerge-ts` inside `@prisma/config`), none from a direct dependency this project chose. Fixed via `pnpm-workspace.yaml`'s `overrides`, forcing the patched versions; `pnpm audit --audit-level=high` is clean and `pnpm build`/`pnpm test` still pass with the overrides applied.
  - The RLS policies' `WITH CHECK` was implicit (Postgres derives it from `USING` for a `FOR ALL` policy with none specified) rather than written out, which works today but could silently regress if a future edit changes `USING` without adding `WITH CHECK`. Fixed via migration `20260826052804_rls_explicit_with_check`, `ALTER POLICY ... WITH CHECK (...)` added explicitly; no behavior change, existing RLS tests pass unchanged.
  - **Not actioned, by design**: the review flagged the Credentials auth endpoint (`/api/auth/[...nextauth]`, live once T3.1 landed even with no login UI yet) as lacking rate limiting. `requirements.md`'s "Out of scope" section already explicitly defers "authentication rate limiting" to Phase 5 (`plan.md` §8); adding it now would be scope creep beyond this spec's approved requirements, not a gap this spec left open. Recorded here so it isn't silently dropped, and flagged again for whoever plans Phase 5.
- **`registerAction` (`src/server/actions/auth.ts`) calls `set_config('app.current_org_id', ...)` manually inside its transaction, right after creating the `Organization` and before creating the `Membership`.** The RLS policy on `memberships` has no separate `WITH CHECK`, so Postgres uses its `USING` clause for INSERT too (design.md's "RLS policy" section); without this, RLS itself -- not the Prisma extension -- rejects the bootstrap `Membership` insert, because nothing has set `app.current_org_id` yet in a transaction that never calls `withTenant`. This was caught by `tests/integration/register-action.test.ts` actually running against Postgres, not by the Prisma-layer bootstrap exception alone. It's the bootstrap case's equivalent of what `withTenant` does automatically.
- **`withTenant`'s guard makes a documented exception for `create`/`createMany` on a tenant-scoped model.** Every other operation (read, update, delete) on `Membership`/`Professional` throws if called outside `withTenant`. `create`/`createMany` are allowed outside it *only* if `organizationId` is already present in the payload (TypeScript already requires this, since it's a non-optional scalar in the generated Prisma create-input type), because REQ-001 requires `registerAction` (T4.2) to create a brand-new organization's very first `User` + `Organization` + `Membership` atomically in one `db.$transaction`, before any tenant session exists to derive a `withTenant` context from. Inside `withTenant`, the extension still always overwrites `organizationId` with the context's value regardless of what a caller passes in `data`, so this exception never lets a caller's `organizationId` value survive when a real tenant context is active; see `src/lib/db.ts` and the "prove the override" comment in `tests/integration/rls-positive.test.ts`.
- **Prisma pinned to `6.19.3`, not the `latest`/`prev` dist-tag (`7.x`/`8.x`).** As of implementation, Prisma 7 made the classic `datasource { url = env("DATABASE_URL") }` schema syntax invalid, requiring a `prisma.config.ts` and a driver adapter (`@prisma/adapter-pg` or similar) passed explicitly to the `PrismaClient` constructor instead. That's a real architecture decision (which adapter, how it composes with the `withTenant`/`AsyncLocalStorage` pattern and Neon's serverless driver) that isn't in this design and wasn't debated. Rather than silently absorb it mid-task, this implementation stays on the latest Prisma 6.x (`6.19.3`), which keeps the schema-based `url = env(...)` datasource and plain `new PrismaClient()` this design assumes. Revisiting the Prisma 7 driver-adapter migration is a follow-up for its own spec/ADR, not something folded into Phase 0.
