import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db, withTenant } from "@/lib/db";

/**
 * REQ-014: shows the organization's name and the user's own role. No
 * patient or clinical data -- none exists yet in this phase, and there is
 * nothing here to display even once it does; that's a later spec's route.
 *
 * Each Server Component resolves its own session and tenant scope
 * independently (design.md's "Tenant-context propagation"), rather than
 * trusting data the layout already fetched.
 */
export default async function DashboardPage() {
  const session = await auth();

  // Defensive: middleware and the parent layout already gate this.
  if (!session) {
    notFound();
  }

  const organization = await db.organization.findUnique({
    where: { id: session.organizationId },
  });

  const membership = await withTenant(
    { organizationId: session.organizationId, userId: session.user.id },
    (tx) => tx.membership.findUnique({ where: { userId: session.user.id } })
  );

  if (!organization || !membership) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-4">
      <h1 className="text-2xl font-semibold">{organization.name}</h1>
      <p className="text-muted-foreground">Role: {membership.role}</p>
    </div>
  );
}
