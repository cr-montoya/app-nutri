import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { ForbiddenError, getOwnMembership, requireRole } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfessionalProfileForm } from "./professional-profile-form";

/**
 * T4.2, closes REQ-017 through REQ-019. Same shape as
 * src/app/(app)/[orgSlug]/team/page.tsx: resolves its own session and
 * tenant scope, and an authorization-shaped rejection (wrong role, no
 * session) renders the same 404 the rest of this route group uses, not a
 * thrown error page.
 *
 * The caller's own `Professional` row (if any) is read here, server-side,
 * keyed off `membership.id` -- never a client-supplied id -- and passed to
 * the form as pre-filled defaults; there is no picker and no other member's
 * data ever reaches this page (REQ-019).
 */
export default async function ProfessionalProfilePage() {
  const session = await auth();

  // Defensive: middleware and the parent layout already gate the
  // unauthenticated case.
  if (!session) {
    notFound();
  }

  const membership = await getOwnMembership(session);

  let requiredMembership: NonNullable<typeof membership>;
  try {
    requiredMembership = requireRole(membership, ["ADMIN", "NUTRITIONIST"]);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      // REQ-018: a FRONT_DESK session viewing this route gets the same 404
      // shape team/page.tsx uses for a non-ADMIN visitor.
      notFound();
    }
    throw error;
  }

  const professional = await withTenant(
    { organizationId: session.organizationId, userId: session.user.id },
    (tx) => tx.professional.findUnique({ where: { membershipId: requiredMembership.id } })
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>My professional profile</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfessionalProfileForm
            licenseNumber={professional?.licenseNumber ?? ""}
            specialty={professional?.specialty ?? ""}
          />
        </CardContent>
      </Card>
    </div>
  );
}
