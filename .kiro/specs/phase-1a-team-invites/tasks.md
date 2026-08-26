# Tasks: Phase 1a, Team Invites and Professional Profiles

Branch: `feat/phase-1a-team-invites`, created by `task-runner` from up-to-date `main` before T1.1, per `.agents/rules/trunk-based.md`. Depends on `phase-0-scaffold` being merged first.

## T1: Schema and RLS (REQ-020, REQ-021)

- [x] T1.1 Add the `Invite` model to `prisma/schema.prisma` per `design.md` (reusing the existing `Role` enum), plus the `Organization.invites` back-relation. Validation: `pnpm exec prisma validate`.
- [x] T1.2 Run the migration against the dev Neon branch. Validation: `pnpm exec prisma migrate dev` succeeds.
- [x] T1.3 Add the dual-branch RLS policy from `design.md`/ADR-0002 to the migration. Validation: manual `psql` check confirming RLS is enabled and the policy exists with both branches.
- [x] T1.4 Positive RLS test: an ADMIN session lists its own org's `Invite`s. Validation: `pnpm test -- invite-rls-positive`. Closes REQ-021 (app-layer half).
- [x] T1.5 Negative RLS test: a raw `pg` client scoped to org A gets zero rows querying org B's `Invite`s directly. Validation: `pnpm test -- invite-rls-negative`. Closes REQ-021 (db-layer half).
- [x] T1.6 Token-scoped RLS test: with `app.invite_lookup_token_hash` set to a specific invite's hash and `app.current_org_id` unset, exactly that one row is visible; a random 64-hex-char hash returns zero rows. Validation: `pnpm test -- invite-token-lookup-rls`. Closes REQ-006, REQ-020.

## T2: Sending, revoking, and listing invites (REQ-001 through REQ-005, REQ-014 through REQ-016)

- [x] T2.1 Write `src/validation/team.ts`'s invite schema (email format). Validation: `pnpm test -- validation`. Closes REQ-002.
- [x] T2.2 Implement `sendInviteAction` in `src/server/actions/team.ts`: `requireRole(['ADMIN'])`, global email-uniqueness check, duplicate-pending-invite check, token generation (`crypto.randomBytes(32)`) and SHA-256 hashing, `Invite` creation with `expiresAt` 7 days out. Validation: `pnpm test -- send-invite`. Closes REQ-001, REQ-003, REQ-004, REQ-005, REQ-016.
- [x] T2.3 Implement `revokeInviteAction`: `requireRole(['ADMIN'])`, conditional `updateMany` setting `revokedAt` only if still pending. Validation: `pnpm test -- revoke-invite`. Closes REQ-014, REQ-016.
- [x] T2.4 Build `src/app/(app)/[orgSlug]/team/page.tsx`: list of `Membership`s and pending `Invite`s, invite form, revoke buttons. Validation: `pnpm test:e2e -- team-page`. Closes REQ-015.

## T3: Accepting an invite (REQ-006 through REQ-013)

- [x] T3.1 Extend `src/validation/team.ts` with the accept-invite schema (name 1 to 100 chars, password min 12 chars). Validation: `pnpm test -- validation`. Closes REQ-007, REQ-008.
- [x] T3.2 Implement the token lookup half of `acceptInviteAction`: hash the incoming token, set `app.invite_lookup_token_hash`, query the `Invite`, evaluate the derived-pending check (not expired, not revoked, not accepted). Validation: `pnpm test -- invite-lookup`. Closes REQ-006, REQ-013.
- [x] T3.3 Implement the HIBP check reusing the same helper as `phase-0-scaffold`'s registration flow. Validation: `pnpm test -- invite-hibp`. Closes REQ-009.
- [x] T3.4 Implement the accept transaction: re-check pending at commit time, create `User` + `Membership` (role from the invite), conditional `updateMany` on the `Invite` setting `acceptedAt`, handling a zero-rows-affected result as the same generic error as REQ-013. Validation: `pnpm test -- accept-invite`. Closes REQ-010, REQ-012.
  <!-- Deviation: T3.3 and T3.4 share one commit. REQ-009's HIBP check gates
  entry into REQ-010's create transaction inside the same acceptInviteAction
  function -- there is no meaningful intermediate state where one exists
  without the other, so they were implemented together. Each task still has
  its own dedicated test file and both validation commands pass independently. -->
- [x] T3.5 Concurrency test: two simultaneous accept requests for the same invite/email, confirming exactly one succeeds and the loser gets the generic error, no duplicate `User`. Validation: `pnpm test -- accept-invite-race`. Closes REQ-011.
- [ ] T3.6 Concurrency test: a revoke and an accept racing on the same invite, confirming exactly one wins per REQ-012's rule. Validation: `pnpm test -- revoke-accept-race`. Closes REQ-012.
- [ ] T3.7 Build `src/app/(auth)/invite/[token]/page.tsx`: the accept form, wired to `acceptInviteAction`, showing the invited email read-only and the generic error for any invalid-token case. Validation: `pnpm test:e2e -- accept-invite`.

## T4: Professional profiles (REQ-017 through REQ-019)

- [ ] T4.1 Implement `updateProfessionalProfileAction` in `src/server/actions/team.ts`: `requireRole(['ADMIN', 'NUTRITIONIST'])`, derive the caller's own `Membership` via `userId` (never a client-supplied membership id), create-or-update the linked `Professional`. Validation: `pnpm test -- professional-profile`. Closes REQ-017, REQ-018, REQ-019.
- [ ] T4.2 Build `src/app/(app)/[orgSlug]/team/professional-profile/page.tsx`: the license/specialty form. Validation: `pnpm test:e2e -- professional-profile`.

## T5: End-to-end proof

- [ ] T5.1 Playwright E2E: ADMIN sends an invite, copies the link, opens it in a fresh session, accepts it as a `NUTRITIONIST`, logs in as that new user, confirms they can add their own professional profile but cannot see or edit the ADMIN's. Validation: `pnpm test:e2e -- team-invites-e2e`. Confirms REQ-001, REQ-010, REQ-016 through REQ-019 hold end to end.

## After T5.1

Run `spec-closeout`, then `pr-prep`.
