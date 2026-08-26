"use server";

import { createHash, randomBytes } from "node:crypto";
import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db, withTenant } from "@/lib/db";
import { ForbiddenError, requireRole } from "@/lib/rbac";
import { sendInviteSchema } from "@/validation/team";

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
 * Resolves the caller's session and their own Membership (for its `role`),
 * then applies `requireRole`. Throws `ForbiddenError` (no session, or a
 * session whose role isn't allowed) so callers only need one try/catch.
 */
async function requireAdminSession() {
  const session = await auth();
  if (!session) {
    throw new ForbiddenError("No authenticated session.");
  }

  const membership = await withTenant(
    { organizationId: session.organizationId, userId: session.user.id },
    (tx) => tx.membership.findUnique({ where: { userId: session.user.id } })
  );

  requireRole(membership, ["ADMIN"]);

  return session;
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
  let session: Awaited<ReturnType<typeof requireAdminSession>>;
  try {
    session = await requireAdminSession();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { success: false, error: GENERIC_FORBIDDEN_ERROR };
    }
    throw error;
  }

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
  let session: Awaited<ReturnType<typeof requireAdminSession>>;
  try {
    session = await requireAdminSession();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { success: false, error: GENERIC_FORBIDDEN_ERROR };
    }
    throw error;
  }

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

export const GENERIC_INVALID_INVITE_ERROR = "This invite link is invalid or has expired.";

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
