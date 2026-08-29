import { withTenant } from "@/lib/db";

/**
 * Org-scoped patient/professional lists for the create/edit form's
 * selection dropdowns (REQ-008: "the UI's own organization-scoped
 * selection lists"). Plain module, not a "use server" Server Action file,
 * same reason `src/server/services/patients.ts`/`organization-slug.ts`
 * aren't ones: `src/app/(app)/[orgSlug]/appointments/new/page.tsx`'s
 * Server Component calls this directly for its data fetch. Not listed in
 * design.md's "Files to create or update" table, but required for T4.7's
 * create form to populate anything at all -- same category as
 * `src/lib/db.ts`'s `TENANT_SCOPED_MODELS` addition, recorded in
 * design.md's `## Deviations`.
 */

export interface SchedulingOptions {
  patients: { id: string; fullName: string }[];
  professionals: { id: string; displayName: string }[];
}

export async function listSchedulingOptions(params: {
  organizationId: string;
  userId: string;
}): Promise<SchedulingOptions> {
  return withTenant(params, async (tx) => {
    const [patients, professionals] = await Promise.all([
      tx.patient.findMany({
        where: { archivedAt: null },
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
      }),
      tx.professional.findMany({
        include: { membership: { include: { user: { select: { name: true } } } } },
        orderBy: { id: "asc" },
      }),
    ]);

    return {
      patients,
      professionals: professionals.map((professional) => ({
        id: professional.id,
        displayName: professional.membership.user.name,
      })),
    };
  });
}
