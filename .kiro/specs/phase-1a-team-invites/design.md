# Design: Phase 1a, Team Invites and Professional Profiles

## Architecture touched

Extends the `phase-0-scaffold` skeleton: one new tenant-scoped model (`Invite`), one schema change to `Professional` (its role restriction moves from schema-adjacent prose to an application-layer check, no column change needed), and new routes under `(app)/[orgSlug]/team/` plus a public `(auth)/invite/[token]/` accept page. Specialist personas applied: `database-architect.md` (schema, RLS, and ADR-0002's token-scoped policy) and `nextjs-architect.md` (routing below).

## Schema (database-architect)

```prisma
model Invite {
  id             String      @id @default(cuid())
  organizationId String
  email          String
  role           Role
  tokenHash      String      @unique
  expiresAt      DateTime
  acceptedAt     DateTime?
  revokedAt      DateTime?
  createdAt      DateTime    @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id])
  @@index([organizationId])
  @@map("invites")
}
```

`Organization`'s `phase-0-scaffold` schema gains the corresponding back-relation: `invites Invite[]` added to its model block; Prisma requires both sides of a relation declared, and this one was previously only implicit.

Design decisions:

- **`Invite.role` reuses the existing `Role` enum from `phase-0-scaffold`**, not a new `InviteRole`. The two would have had identical members (`ADMIN`, `NUTRITIONIST`, `FRONT_DESK`); a second enum would just be a second place to update if a role is ever renamed, with no benefit.
- **`acceptedAt`/`revokedAt` as nullable timestamps, not a `status` enum.** An enum field alongside timestamps risks drift (what if `status = ACCEPTED` but `acceptedAt` is somehow null from a bug?). Deriving "pending" as `acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt > now()` has one source of truth per fact, no redundant state to keep in sync. This directly implements REQ-013's three-way check (expired, revoked, already accepted) as three independent, unambiguous conditions.
- **`tokenHash`, not the raw token, is stored.** The raw token exists only in the URL sent to the invitee; the database holds its SHA-256 hash, the same defensive posture as a password, appropriate for a bearer credential. Lookup hashes the incoming token and queries by `tokenHash`.
- **No schema change to `Professional`.** `phase-0-scaffold`'s schema already links `Professional.membershipId` to any `Membership` without a database-level role constraint; "who can have one" was only ever prose. REQ-017/REQ-018 (ADMIN or NUTRITIONIST can submit a profile, FRONT_DESK cannot) are enforced in `src/lib/rbac.ts`/the Server Action, not the schema. This is why no `phase-0-scaffold` migration needs revisiting.

## RLS policy (database-architect checklist, includes ADR-0002)

```sql
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invites
  USING (
    "organizationId" = current_setting('app.current_org_id', true)
    OR "tokenHash" = current_setting('app.invite_lookup_token_hash', true)
  );
```

- [x] `ENABLE ROW LEVEL SECURITY` present.
- [x] Policy references `current_setting`, never a client-supplied value directly; both session variables are set server-side (`app.current_org_id` from the session, `app.invite_lookup_token_hash` from the server-computed SHA-256 of the URL token, per ADR-0002).
- [ ] Positive test (task): an ADMIN session lists its own org's invites. Satisfies REQ-015.
- [ ] Positive test (task): the token-scoped branch returns exactly the one matching invite for a valid token, and nothing when a random 64-hex-char string is used instead. Satisfies REQ-006, REQ-013.
- [ ] Negative test (task): a session scoped to org A cannot read org B's invites through the org-scoped branch. Satisfies REQ-020, REQ-021.
- [x] Policy overhead: `organizationId` is indexed; `tokenHash` is `@unique` (Prisma creates an index), so both branches use an index scan, not a sequential scan.

`Professional`'s existing RLS policy from `phase-0-scaffold` is unchanged; this spec doesn't add a role-based DB constraint to it (see schema decision above).

## Routing and rendering (nextjs-architect)

| Route | Rendering | Data fetching | Streaming |
|---|---|---|---|
| `(app)/[orgSlug]/team/page.tsx` | Server Component | Direct fetch: `Membership`s + pending `Invite`s for the session's org | No; small, infrequent list |
| `(app)/[orgSlug]/team/invite-action.ts` (co-located Server Action) | N/A | `sendInviteAction`, `revokeInviteAction` | N/A |
| `(app)/[orgSlug]/team/professional-profile/page.tsx` | Server Component with a Client Component form | `updateProfessionalProfileAction` Server Action | No |
| `(auth)/invite/[token]/page.tsx` | Server Component shell, Client Component form (same pattern as `(auth)/register`) | `acceptInviteAction` Server Action | No |

`(auth)/invite/[token]/` sits alongside `(auth)/register` and `(auth)/login` from `phase-0-scaffold`, all public, all outside the `(app)/[orgSlug]` layout's session requirement, consistent with `nextjs-architect.md`'s existing route-group convention. `(app)/[orgSlug]/team/*` inherits tenant-context resolution from the org layout `phase-0-scaffold` already built; no new layout-level work needed.

## Tenant-context propagation (extends phase-0-scaffold)

`acceptInviteAction` is the one Server Action in this codebase that runs *before* `withTenant`'s normal session-derived flow applies, per ADR-0002: it first sets `app.invite_lookup_token_hash` for the single lookup query, reads the invite's `organizationId` from the result, and only then calls `withTenant({ organizationId: invite.organizationId, ... })` for the rest of the transaction (creating `User`/`Membership`, marking the invite accepted). Every other Server Action in this spec (`sendInviteAction`, `revokeInviteAction`, `updateProfessionalProfileAction`) uses the standard session-derived `withTenant` pattern from `phase-0-scaffold`, no exception.

## Requirement coverage

| REQ | Covered by |
|---|---|
| REQ-001 | `sendInviteAction`: creates `Invite`, generates raw token (`crypto.randomBytes(32)`), stores its SHA-256 as `tokenHash` |
| REQ-002 | Zod email validation in `src/validation/team.ts`, same pattern as `phase-0-scaffold` |
| REQ-003 | `User.email` global uniqueness check in `sendInviteAction` before creating the `Invite` |
| REQ-004 | Query for an existing pending `Invite` (derived-pending check) for the same email + org before creating a new one |
| REQ-005 | `expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)` set at creation |
| REQ-006 | `acceptInviteAction`'s lookup query (token-scoped RLS branch) plus the derived-pending check |
| REQ-007 | Zod length validation on name, same rule as `phase-0-scaffold` REQ-021 |
| REQ-008 | Zod `min(12)` on password, same as `phase-0-scaffold` REQ-004 |
| REQ-009 | HIBP range API check, same as `phase-0-scaffold` REQ-005 |
| REQ-010 | `acceptInviteAction`'s `db.$transaction`: re-checks pending, creates `User` + `Membership`, sets `acceptedAt` |
| REQ-011 | `User.email` unique constraint, inherited from `phase-0-scaffold` |
| REQ-012 | Both `revokeInviteAction` and `acceptInviteAction` operate via single-row conditional updates (`UPDATE ... WHERE id = ? AND acceptedAt IS NULL AND revokedAt IS NULL`); whichever commits first changes the row so the other's `WHERE` matches zero rows. Prisma's `updateMany` reports the affected count; zero means the loser rolls back its transaction and returns the same error as REQ-013 |
| REQ-013 | Derived-pending check (`acceptedAt`/`revokedAt`/`expiresAt`) in the lookup query, same generic error for all three cases |
| REQ-014 | `revokeInviteAction` sets `revokedAt` |
| REQ-015 | `team/page.tsx` query, `organizationId`-scoped via `withTenant` |
| REQ-016 | `requireRole(['ADMIN'])` from `src/lib/rbac.ts` on `sendInviteAction`, `revokeInviteAction`, and the team page |
| REQ-017 | `updateProfessionalProfileAction`, `requireRole(['ADMIN', 'NUTRITIONIST'])` |
| REQ-018 | Same action, role check excludes `FRONT_DESK` |
| REQ-019 | `updateProfessionalProfileAction` derives the caller's own `Membership` via `db.membership.findUnique({ where: { userId: session.userId } })` (session only carries `userId`/`organizationId` per `phase-0-scaffold`, not `membershipId`), then scopes the `Professional` lookup to that membership's id, never a client-supplied membership id |
| REQ-020 | `withTenant` on all `Invite`/`Professional` reads and writes except the one documented exception above |
| REQ-021 | RLS policies above |

## Files to create or update

```
prisma/schema.prisma                                          # update: Invite model, Organization.invites back-relation
prisma/migrations/.../migration.sql                            # generated; includes the RLS statements above, added manually
src/validation/team.ts                                         # new: Zod schemas for invite + professional profile forms
src/server/actions/team.ts                                     # new: sendInviteAction, revokeInviteAction, acceptInviteAction, updateProfessionalProfileAction
src/app/(app)/[orgSlug]/team/page.tsx                           # new
src/app/(app)/[orgSlug]/team/professional-profile/page.tsx      # new
src/app/(auth)/invite/[token]/page.tsx                          # new
src/lib/rbac.ts                                                 # update: requireRole gets its first real callers
```

## Multi-tenant isolation and RBAC impact

`Invite` is a new tenant-scoped table; both isolation layers apply (REQ-020, REQ-021), with the one documented, narrow exception in ADR-0002 for the pre-authentication token lookup, which authorizes by token possession rather than org membership, since org membership doesn't exist yet at that point in the flow. RBAC: invite-sending/revoking/team-list is `ADMIN`-only (REQ-016); professional-profile editing is `ADMIN`-or-`NUTRITIONIST`, scoped to one's own membership only (REQ-017 through REQ-019), closing the gap this design's Requirements phase found (an ADMIN cannot edit someone else's profile).

## Reused vs. new

Reused from `phase-0-scaffold`: `withTenant`, the RLS policy shape (extended, not replaced, per ADR-0002), the Server Action + Zod validation pattern, `requireRole` from the `rbac.ts` stub (now gets its first real caller), the `(auth)/*` route-group convention, and the password/HIBP validation rules (referenced, not re-implemented). New: the `Invite` model, the token-hash-and-lookup pattern (ADR-0002, intended for reuse by future token-bearing flows), and the professional-profile-ownership check (REQ-019).

## Deviations

None yet; this section is for `spec-closeout` to fill in if implementation diverges from this design.
