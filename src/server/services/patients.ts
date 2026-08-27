import type { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db";

/**
 * T4.1, closes REQ-015, REQ-016, REQ-017. Plain module (not a "use server"
 * Server Action file, same reason src/server/services/organization-slug.ts
 * isn't one): `src/app/(app)/[orgSlug]/patients/page.tsx`'s list Server
 * Component calls this directly for its data fetch, which a "use server"
 * export couldn't be (Next.js requires every export from such a file to be
 * an async Server Action, not a data-access read).
 */

export interface ListPatientsParams {
  organizationId: string;
  userId: string;
  /** REQ-017: matched case-insensitively (partial) against fullName, or
   * exactly against documentId. Empty/whitespace-only means "no filter". */
  query?: string;
  /** REQ-015/REQ-016: false (default) excludes archived patients entirely;
   * true includes both. */
  includeArchived?: boolean;
}

export async function listPatients(params: ListPatientsParams) {
  return withTenant({ organizationId: params.organizationId, userId: params.userId }, (tx) => {
    const where: Prisma.PatientWhereInput = {};

    if (!params.includeArchived) {
      where.archivedAt = null;
    }

    const query = params.query?.trim();
    if (query) {
      where.OR = [
        { fullName: { contains: query, mode: "insensitive" } },
        { documentId: query },
      ];
    }

    return tx.patient.findMany({ where, orderBy: { fullName: "asc" } });
  });
}
