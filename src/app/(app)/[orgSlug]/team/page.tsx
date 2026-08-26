import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { ForbiddenError, getOwnMembership, requireRole } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteForm } from "./invite-form";
import { RevokeInviteButton } from "./revoke-invite-button";

/**
 * REQ-015, REQ-016: lists every Membership and pending Invite for the
 * session's own organization, ADMIN-only. Small, infrequent list (design.md
 * routing table): plain Server Component, no streaming/Suspense.
 *
 * Same pattern as src/app/(app)/[orgSlug]/dashboard/page.tsx: resolves its
 * own session and tenant scope rather than trusting the layout, and an
 * authorization-shaped rejection (wrong role, no session) renders the same
 * 404 the layout already uses for a wrong-org slug, not a thrown error page.
 */
export default async function TeamPage() {
  const session = await auth();

  // Defensive: middleware and the parent layout already gate the
  // unauthenticated case.
  if (!session) {
    notFound();
  }

  const membership = await getOwnMembership(session);

  try {
    requireRole(membership, ["ADMIN"]);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      // REQ-016: a NUTRITIONIST/FRONT_DESK session viewing this route gets
      // the same 404 shape as a wrong-org slug, never a hint the route
      // exists but is off-limits.
      notFound();
    }
    throw error;
  }

  const [memberships, pendingInvites] = await withTenant(
    { organizationId: session.organizationId, userId: session.user.id },
    async (tx) => {
      const members = await tx.membership.findMany({
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      });
      // Derived-pending filter (design.md: no `status` enum on Invite).
      const invites = await tx.invite.findMany({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });
      return [members, invites] as const;
    }
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Team members</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {memberships.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between border-b pb-2 last:border-0"
              >
                <div>
                  <p className="font-medium">{member.user.name}</p>
                  <p className="text-sm text-muted-foreground">{member.user.email}</p>
                </div>
                <span className="text-sm text-muted-foreground">{member.role}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invites</CardTitle>
        </CardHeader>
        <CardContent>
          {pendingInvites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending invites.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {pendingInvites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex items-center justify-between border-b pb-2 last:border-0"
                >
                  <div>
                    <p className="font-medium">{invite.email}</p>
                    <p className="text-sm text-muted-foreground">{invite.role}</p>
                  </div>
                  <RevokeInviteButton inviteId={invite.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invite someone</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteForm />
        </CardContent>
      </Card>
    </div>
  );
}
