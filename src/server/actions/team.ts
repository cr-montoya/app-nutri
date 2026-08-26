"use server";

import { createHash, randomBytes } from "node:crypto";
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
