import type { Role } from "@prisma/client";
import { withTenant } from "@/lib/db";

/**
 * Role guard used in Server Actions/Route Handlers, never only to hide UI
 * client-side (AGENTS.md: "RBAC always server-side").
 *
 * This phase has no route or Server Action that needs more than "is this
 * user's role ADMIN" (see design.md's "Multi-tenant isolation and RBAC
 * impact"): `NUTRITIONIST`/`FRONT_DESK` accounts can't be created until an
 * invite flow exists (out of scope, deferred to phase-1a-team-invites).
 * `requireRole` exists now so that pattern is already in place for later
 * phases to call, not left for them to invent from scratch.
 */

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface RoleCheckable {
  role: Role;
}

/**
 * Throws `ForbiddenError` if `actor` is missing or its `role` isn't one of
 * `allowedRoles`; otherwise returns `actor` narrowed to a non-null type, so
 * callers can use it directly:
 *
 * ```ts
 * const membership = requireRole(session?.membership, ["ADMIN"]);
 * ```
 */
export function requireRole<T extends RoleCheckable>(
  actor: T | null | undefined,
  allowedRoles: readonly Role[]
): T {
  if (!actor) {
    throw new ForbiddenError("No authenticated session.");
  }

  if (!allowedRoles.includes(actor.role)) {
    throw new ForbiddenError(
      `Role "${actor.role}" is not permitted here; requires one of: ${allowedRoles.join(", ")}.`
    );
  }

  return actor;
}

/**
 * Resolves the caller's own `Membership` (never a client-supplied id) for
 * `session`'s org, via `withTenant`. Plain module, not a Server Action, so
 * both `src/server/actions/team.ts`'s Server Actions and the `team/*`
 * Server Components can call it directly -- a `"use server"` file may only
 * export async functions, so this couldn't live there and be imported by a
 * Server Component (code-quality finding, phase-1a-team-invites
 * remediation: this replaced three independent, hand-duplicated copies of
 * the same `tx.membership.findUnique` + `withTenant` call).
 */
export async function getOwnMembership(session: { organizationId: string; user: { id: string } }) {
  return withTenant(
    { organizationId: session.organizationId, userId: session.user.id },
    (tx) => tx.membership.findUnique({ where: { userId: session.user.id } })
  );
}
