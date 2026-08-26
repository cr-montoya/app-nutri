# Design: Phase 0, Scaffold, Auth, Multi-Tenant Skeleton

## Architecture touched

This is the first spec to touch the Prisma schema, so nothing existing is reused; instead this design establishes the exact patterns (`withTenant`, RLS policy shape, Server Action structure, route layout) that every later phase reuses without re-deciding. Layers touched, per `.kiro/steering/structure.md`: `prisma/schema.prisma`, `src/lib/db.ts`, `src/lib/auth.ts`, `src/server/actions/`, `src/middleware.ts`, `src/app/`.

Specialist personas applied: `database-architect.md` (schema and RLS below) and `nextjs-architect.md` (routing below).

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

## Files to create or update

```
prisma/schema.prisma                          # new: Organization, User, Membership, Professional, Role
prisma/migrations/.../migration.sql            # generated; includes the RLS statements above, added manually after prisma migrate dev
src/lib/db.ts                                  # new: Prisma Client Extension, withTenant
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

- **`src/middleware.ts` opts into Next.js 15's Node.js Middleware (`export const runtime = "nodejs"`)**, not the default Edge runtime. REQ-018 requires the `tokenVersion` check on every session read, including from middleware; that check calls Prisma (`node:async_hooks`, native/WASM `@node-rs/argon2` transitively through the shared Auth.js config), none of which the Edge runtime supports. Middleware's matcher also can't literally express "`(app)/*`" as design.md's routing table says, since Next.js strips route groups from the URL; it runs on every path except static assets and explicitly allowlists the public auth routes (`/`, `/login`, `/register`, `/api/auth/*`) instead, which is the documented Auth.js v5 pattern for this exact case.
- **`withTenant`'s guard makes a documented exception for `create`/`createMany` on a tenant-scoped model.** Every other operation (read, update, delete) on `Membership`/`Professional` throws if called outside `withTenant`. `create`/`createMany` are allowed outside it *only* if `organizationId` is already present in the payload (TypeScript already requires this, since it's a non-optional scalar in the generated Prisma create-input type), because REQ-001 requires `registerAction` (T4.2) to create a brand-new organization's very first `User` + `Organization` + `Membership` atomically in one `db.$transaction`, before any tenant session exists to derive a `withTenant` context from. Inside `withTenant`, the extension still always overwrites `organizationId` with the context's value regardless of what a caller passes in `data`, so this exception never lets a caller's `organizationId` value survive when a real tenant context is active; see `src/lib/db.ts` and the "prove the override" comment in `tests/integration/rls-positive.test.ts`.
- **Prisma pinned to `6.19.3`, not the `latest`/`prev` dist-tag (`7.x`/`8.x`).** As of implementation, Prisma 7 made the classic `datasource { url = env("DATABASE_URL") }` schema syntax invalid, requiring a `prisma.config.ts` and a driver adapter (`@prisma/adapter-pg` or similar) passed explicitly to the `PrismaClient` constructor instead. That's a real architecture decision (which adapter, how it composes with the `withTenant`/`AsyncLocalStorage` pattern and Neon's serverless driver) that isn't in this design and wasn't debated. Rather than silently absorb it mid-task, this implementation stays on the latest Prisma 6.x (`6.19.3`), which keeps the schema-based `url = env(...)` datasource and plain `new PrismaClient()` this design assumes. Revisiting the Prisma 7 driver-adapter migration is a follow-up for its own spec/ADR, not something folded into Phase 0.

