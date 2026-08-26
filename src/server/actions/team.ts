"use server";

import { createHash, randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { Prisma, type Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db, withTenant } from "@/lib/db";
import { ForbiddenError, getOwnMembership, requireRole } from "@/lib/rbac";
import {
  sendInviteSchema,
  acceptInviteSchema,
  updateProfessionalProfileSchema,
  GENERIC_INVALID_INVITE_ERROR,
} from "@/validation/team";
import { checkPasswordNotBreached, BreachedPasswordError } from "@/validation/auth";

/**
 * T2.2, T2.3: ADMIN-only invite management. Both actions re-derive the
 * caller's own Membership from the session (never trusting a client-supplied
 * role), per the pattern documented in the task briefing and already used by
 * src/app/(app)/[orgSlug]/dashboard/page.tsx -- the session/JWT only carries
 * `userId`/`organizationId`, not `role`.
 */

const GENERIC_FORBIDDEN_ERROR = "You are not allowed to perform this action.";
const GENERIC_VALIDATION_ERROR = "Please check the invite details and try again.";
const GENERIC_EMAIL_TAKEN_ERROR = "An account with this email already exists.";
const GENERIC_DUPLICATE_INVITE_ERROR = "There is already a pending invite for this email.";
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // REQ-005: exactly 7 days

class DuplicatePendingInviteError extends Error {}

/**
 * Resolves the caller's session and their own Membership (for its `role` and
 * `id`), then applies `requireRole` for `allowedRoles`. Throws
 * `ForbiddenError` (no session, or a session whose role isn't allowed) so
 * callers only need one try/catch. The Membership lookup itself is
 * `getOwnMembership` (src/lib/rbac.ts), shared with `team/page.tsx` and
 * `team/professional-profile/page.tsx`'s Server Components, which can't call
 * this function directly since it lives in a `"use server"` module.
 */
async function requireSession(allowedRoles: readonly Role[]) {
  const session = await auth();
  if (!session) {
    throw new ForbiddenError("No authenticated session.");
  }

  const membership = await getOwnMembership(session);
  const requiredMembership = requireRole(membership, allowedRoles);

  return { session, membership: requiredMembership };
}

type AuthorizedSession = Awaited<ReturnType<typeof requireSession>>["session"];
type AuthorizedMembership = Awaited<ReturnType<typeof requireSession>>["membership"];

interface AuthorizedActionResult {
  success: boolean;
  error?: string;
}

/**
 * Wraps `requireSession(allowedRoles)` plus the `ForbiddenError` ->
 * `GENERIC_FORBIDDEN_ERROR` mapping that was previously copy-pasted in
 * `sendInviteAction`, `revokeInviteAction`, and
 * `updateProfessionalProfileAction` (code-quality finding,
 * phase-1a-team-invites remediation). `fn` only runs once authorization
 * succeeds and receives the resolved session/membership; each action's own
 * validation and DB work moved into `fn` unchanged.
 */
async function withAuthorizedSession<T extends AuthorizedActionResult>(
  allowedRoles: readonly Role[],
  fn: (session: AuthorizedSession, membership: AuthorizedMembership) => Promise<T>
): Promise<T> {
  let session: AuthorizedSession;
  let membership: AuthorizedMembership;
  try {
    ({ session, membership } = await requireSession(allowedRoles));
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { success: false, error: GENERIC_FORBIDDEN_ERROR } as T;
    }
    throw error;
  }

  return fn(session, membership);
}

export interface SendInviteActionResult {
  success: boolean;
  error?: string;
  inviteUrl?: string;
}

/**
 * REQ-001, REQ-003, REQ-004, REQ-005, REQ-016. The raw token is only ever
 * returned here, in this result -- the database only ever stores its SHA-256
 * hash (design.md's "tokenHash, not the raw token, is stored"). There is no
 * email-sending infrastructure yet (requirements.md's "Out of scope"), so
 * the ADMIN shares `inviteUrl` manually.
 */
export async function sendInviteAction(input: unknown): Promise<SendInviteActionResult> {
  return withAuthorizedSession(["ADMIN"], async (session) => {
    const parsed = sendInviteSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: GENERIC_VALIDATION_ERROR };
    }
    const { email, role } = parsed.data;

    // REQ-003: global uniqueness check against User.email. User isn't
    // tenant-scoped (src/lib/db.ts), so this is a direct query, no withTenant.
    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser) {
      return { success: false, error: GENERIC_EMAIL_TAKEN_ERROR };
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);

    try {
      await withTenant(
        { organizationId: session.organizationId, userId: session.user.id },
        async (tx) => {
          // REQ-004: derived-pending check (design.md: no `status` enum),
          // scoped to this org + email, inside the same withTenant call since
          // Invite is tenant-scoped.
          const existingPending = await tx.invite.findFirst({
            where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          });
          if (existingPending) {
            throw new DuplicatePendingInviteError();
          }

          // organizationId is a required scalar in Prisma's generated
          // create-input type, so it must be supplied here even inside
          // withTenant; the tenant-context extension (src/lib/db.ts) injects
          // the real value regardless of what's passed, same as
          // tests/integration/invite-rls-positive.test.ts.
          await tx.invite.create({
            data: { email, role, tokenHash, expiresAt, organizationId: session.organizationId },
          });
        }
      );
    } catch (error) {
      if (error instanceof DuplicatePendingInviteError) {
        return { success: false, error: GENERIC_DUPLICATE_INVITE_ERROR };
      }
      throw error;
    }

    return { success: true, inviteUrl: `/invite/${rawToken}` };
  });
}

export interface RevokeInviteActionResult {
  success: boolean;
  error?: string;
}

/**
 * REQ-014, REQ-016. A conditional `updateMany` so a revoke can never
 * resurrect or overwrite an invite that was already accepted or revoked
 * (design.md's REQ-012 race handling: whichever operation commits first
 * changes the row, so the loser's WHERE matches zero rows). `count === 0`
 * covers three cases this task has no dedicated REQ for (already accepted,
 * already revoked, or nonexistent/wrong-org id) -- treated uniformly as a
 * generic failure rather than distinguished, since REQ-014 only specifies
 * the happy path ("invalidate its token immediately") and distinguishing
 * them would leak which case it was to the caller.
 */
export async function revokeInviteAction(inviteId: string): Promise<RevokeInviteActionResult> {
  return withAuthorizedSession(["ADMIN"], async (session) => {
    const { count } = await withTenant(
      { organizationId: session.organizationId, userId: session.user.id },
      (tx) =>
        // organizationId is injected by the tenant-context extension
        // (src/lib/db.ts's applyTenantScope), never added manually here.
        tx.invite.updateMany({
          where: { id: inviteId, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        })
    );

    if (count === 0) {
      return { success: false, error: "This invite can no longer be revoked." };
    }

    return { success: true };
  });
}

/**
 * T3.2, closes REQ-006, REQ-013 (the lookup half of `acceptInviteAction`).
 *
 * Shape of the raw `invites` row this module's pre-authentication lookup
 * reads. Field names match the Prisma model's camelCase names 1:1 -- unlike
 * table/column-name mapping via `@@map`, there is no `@map` on any of
 * `Invite`'s individual fields (prisma/migrations/20260826152343_add_invite_model),
 * so no renaming is needed between the raw SQL result and this type.
 */
interface InviteRow {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * REQ-013's derived-pending check (design.md: no `status` enum on `Invite`):
 * not expired, not revoked, not already accepted. Shared by the initial
 * token lookup (T3.2) and, conceptually, the accept transaction's re-check
 * at commit time (T3.4) -- though that re-check is expressed as a single
 * conditional SQL `UPDATE ... WHERE`, not a second call to this function,
 * since it must be atomic with the write itself (see acceptInviteAction).
 */
function isInvitePending(
  invite: Pick<InviteRow, "acceptedAt" | "revokedAt" | "expiresAt">,
  now: Date = new Date()
): boolean {
  return invite.acceptedAt === null && invite.revokedAt === null && invite.expiresAt > now;
}

// GENERIC_INVALID_INVITE_ERROR now lives in src/validation/team.ts (imported
// above), not here: a "use server" module may only export async functions
// (Next.js's Server Actions build transform rejects any other export), so it
// couldn't be exported from this file for src/app/(auth)/invite/[token]/
// page.tsx to import directly -- that's why it was hand-duplicated there
// before this refactor (code-quality finding, phase-1a-team-invites
// remediation).

/**
 * Looks up an `Invite` by its raw (unhashed) URL token, *before* any
 * session or organization context exists -- the org is a result of this
 * lookup, not a precondition of it. This is the one documented exception to
 * `withTenant` per ADR-0002 (docs/adr/0002-token-scoped-rls-lookup.md) and
 * .agents/rules/tenant-isolation.md: `Invite` is tenant-scoped
 * (TENANT_SCOPED_MODELS in src/lib/db.ts), so the normal Prisma model
 * methods (`db.invite.findUnique`, etc.) would either throw (no
 * `withTenant` context) or, if forced through `withTenant`, need an
 * `organizationId` this call doesn't have yet -- discovering it is the
 * whole point.
 *
 * Uses `$executeRaw`/`$queryRaw`, Prisma's raw-SQL escape hatch, which is
 * NOT intercepted by the tenant-context extension's `$allModels.
 * $allOperations` hook (that hook only wraps the generated model methods
 * like `.findUnique`, never raw SQL) -- the same reason
 * tests/integration/invite-token-lookup-rls.test.ts (T1.6) could exercise
 * this RLS branch at all, just via a raw `pg` client there instead of
 * Prisma. `app.invite_lookup_token_hash` is set to the server-computed
 * SHA-256 hash of the raw token (never the raw token or a client-supplied
 * value directly) immediately before the one query that needs it, per the
 * RLS policy's token-scoped branch.
 *
 * Returns `null` uniformly for "no such invite", "expired", "revoked", and
 * "already accepted" (REQ-013: the same generic outcome in all four cases,
 * never distinguished to the caller).
 */
export async function findPendingInviteByToken(rawToken: string): Promise<InviteRow | null> {
  const tokenHash = hashInviteToken(rawToken);

  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.invite_lookup_token_hash', ${tokenHash}, true)`;
    return tx.$queryRaw<InviteRow[]>`SELECT * FROM invites WHERE "tokenHash" = ${tokenHash}`;
  });

  const invite = rows[0];
  if (!invite || !isInvitePending(invite)) {
    return null;
  }

  return invite;
}

/**
 * Read-only subset of `findPendingInviteByToken`'s result, for the invite
 * page's read-only email display (T3.7) -- never the full row (organizationId,
 * tokenHash, etc. have no reason to reach a Server Component's rendered
 * output). `acceptInviteAction` calls `findPendingInviteByToken` directly
 * instead, since it needs `id`/`organizationId`/`role`.
 */
export async function lookupInviteByToken(
  rawToken: string
): Promise<{ email: string; role: Role } | null> {
  const invite = await findPendingInviteByToken(rawToken);
  if (!invite) {
    return null;
  }
  return { email: invite.email, role: invite.role };
}

export interface AcceptInviteActionResult {
  success: boolean;
  error?: string;
}

const GENERIC_ACCEPT_VALIDATION_ERROR = "Please check your details and try again.";
// REQ-011 reuses the same GENERIC_EMAIL_TAKEN_ERROR constant (module scope,
// above) sendInviteAction already uses -- the exact same generic error as
// phase-0-scaffold's REQ-002/registerAction's own P2002 handling, since
// both are the same underlying User.email unique-constraint race.

/**
 * Thrown inside the accept transaction (T3.4) when the commit-time
 * conditional UPDATE on `invites` affects zero rows -- REQ-012's race
 * (revoked/accepted/expired between the initial lookup and this write).
 * Throwing inside `db.$transaction`'s callback rolls back the whole
 * transaction, including the `User`/`Membership` rows just created.
 */
class InviteNoLongerPendingError extends Error {}

/**
 * T3.3, T3.4: closes REQ-009, REQ-010, REQ-012. Built as one function since
 * REQ-009's HIBP check gates entry into REQ-010's create transaction --
 * there is no meaningful intermediate state where one exists without the
 * other (see the T3.3/T3.4 commit note in the spec's task history).
 *
 * `rawToken` comes from the `[token]` route param (T3.7), never from the
 * form body itself -- `acceptInviteSchema` (T3.1) deliberately has no
 * `email`/`token` field, so there is no client-writable way to target a
 * different invite than the one the URL resolved to.
 */
export async function acceptInviteAction(
  rawToken: string,
  input: unknown
): Promise<AcceptInviteActionResult> {
  const parsed = acceptInviteSchema.safeParse(input);
  if (!parsed.success) {
    // REQ-007, REQ-008: rejected before any record is created.
    return { success: false, error: GENERIC_ACCEPT_VALIDATION_ERROR };
  }
  const { name, password } = parsed.data;

  // REQ-006, REQ-013: the initial lookup. A second, atomic re-check happens
  // at commit time below (REQ-010, REQ-012) to close the TOCTOU gap between
  // this call and the write.
  const invite = await findPendingInviteByToken(rawToken);
  if (!invite) {
    return { success: false, error: GENERIC_INVALID_INVITE_ERROR };
  }

  try {
    // REQ-009: rejected before any record is created. Same helper
    // registerAction uses (src/server/actions/auth.ts), same fail-open
    // behavior on an HIBP outage -- nothing new to decide here.
    await checkPasswordNotBreached(password);
  } catch (error) {
    if (error instanceof BreachedPasswordError) {
      return { success: false, error: error.message };
    }
    throw error;
  }

  const passwordHash = await hash(password); // argon2id defaults, ADR-0001

  try {
    await db.$transaction(async (tx) => {
      // Bootstrap tenant context for this invite's organization. There is
      // no `withTenant` session yet, and the new `User`'s id (needed for a
      // real `TenantContext`) doesn't exist until this same transaction
      // creates it -- the exact chicken-and-egg case registerAction's own
      // first `Membership` create documents (src/server/actions/auth.ts).
      // This also satisfies the invites RLS policy's org-scoped branch for
      // the conditional UPDATE below.
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${invite.organizationId}, true)`;

      // REQ-011: the `User.email` unique constraint (phase-0-scaffold) is
      // what actually guarantees only one of two racing accepts for the
      // same email succeeds; caught as P2002 below, same pattern as
      // registerAction.
      const user = await tx.user.create({
        data: { email: invite.email, name, passwordHash },
      });

      // Tenant-scoped create bootstrap exception (src/lib/db.ts's
      // documented exception for create/createMany outside withTenant()),
      // same shape as registerAction's very first Membership:
      // organizationId is supplied explicitly, and Postgres RLS's WITH
      // CHECK against app.current_org_id (set above) is what actually
      // enforces it lands in the right organization.
      await tx.membership.create({
        data: { userId: user.id, organizationId: invite.organizationId, role: invite.role },
      });

      // REQ-010, REQ-012: raw SQL, not tx.invite.updateMany. `Invite` is
      // tenant-scoped and this transaction never entered withTenant()'s
      // AsyncLocalStorage scope (see doc comment above), so the extension
      // in src/lib/db.ts would reject a model-method call here regardless
      // of an explicit organizationId (that bootstrap exception only
      // covers create/createMany, not updateMany). This one conditional
      // UPDATE both re-checks "still pending" at commit time and performs
      // the write atomically: whichever of a racing revoke/accept commits
      // first changes the row, so the loser's WHERE matches zero rows.
      const acceptedCount = await tx.$executeRaw`
        UPDATE invites
        SET "acceptedAt" = now()
        WHERE id = ${invite.id}
          AND "acceptedAt" IS NULL
          AND "revokedAt" IS NULL
          AND "expiresAt" > now()
      `;

      if (acceptedCount === 0) {
        // Rolls back the User/Membership created above too.
        throw new InviteNoLongerPendingError();
      }
    });
  } catch (error) {
    if (error instanceof InviteNoLongerPendingError) {
      return { success: false, error: GENERIC_INVALID_INVITE_ERROR };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, error: GENERIC_EMAIL_TAKEN_ERROR };
    }
    throw error;
  }

  return { success: true };
}

export interface UpdateProfessionalProfileActionResult {
  success: boolean;
  error?: string;
}

const GENERIC_PROFILE_VALIDATION_ERROR = "Please check your profile details and try again.";

/**
 * T4.1, closes REQ-017, REQ-018, REQ-019. `requireSession(["ADMIN",
 * "NUTRITIONIST"])` rejects FRONT_DESK (REQ-018) and yields the caller's own
 * Membership (`membership.id`), the only identifier this function ever uses
 * to target a `Professional` row -- `input` (validated against
 * `updateProfessionalProfileSchema`, T4.1) carries no id of any kind, so
 * there is no client-writable way to target any profile but the caller's own
 * (REQ-019, including for an ADMIN acting on another member's profile).
 *
 * `Professional.membershipId` is `@unique` (prisma/schema.prisma), so a
 * `withTenant`-scoped `upsert` keyed on it is create-or-update in one call
 * (REQ-017). Per src/lib/db.ts's `applyTenantScope`, the tenant-context
 * extension injects `organizationId` into both the `where` and `create`
 * branches and strips any from `update`, so it's never passed manually here.
 */
export async function updateProfessionalProfileAction(
  input: unknown
): Promise<UpdateProfessionalProfileActionResult> {
  return withAuthorizedSession(["ADMIN", "NUTRITIONIST"], async (session, membership) => {
    const parsed = updateProfessionalProfileSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: GENERIC_PROFILE_VALIDATION_ERROR };
    }
    // updateProfessionalProfileSchema (src/validation/team.ts) deliberately
    // has no `.transform()` for typing reasons documented there; normalize
    // an empty submitted string to `undefined` here instead, so a cleared
    // field is stored as null rather than "".
    const licenseNumber = parsed.data.licenseNumber || undefined;
    const specialty = parsed.data.specialty || undefined;

    await withTenant(
      { organizationId: session.organizationId, userId: session.user.id },
      (tx) =>
        // organizationId is a required scalar in Prisma's generated
        // upsert-create-input type (same reason sendInviteAction's
        // tx.invite.create above supplies it explicitly), so it must be
        // passed here even inside withTenant; applyTenantScope
        // (src/lib/db.ts) injects the real value into `create` regardless
        // of what's passed, and strips any organizationId from `update` so
        // this can never move a row to a different organization.
        tx.professional.upsert({
          where: { membershipId: membership.id },
          create: {
            membershipId: membership.id,
            organizationId: session.organizationId,
            licenseNumber,
            specialty,
          },
          update: { licenseNumber, specialty },
        })
    );

    return { success: true };
  });
}
