"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db, withTenant } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  patientSchema,
  GENERIC_PATIENT_VALIDATION_ERROR,
  GENERIC_DUPLICATE_DOCUMENT_ID_ERROR,
} from "@/validation/patients";

/**
 * Patient CRUD Server Actions (T3.2, T3.4, T3.5). REQ-023: no role
 * restriction on any action here -- `requireRole` (src/lib/rbac.ts) is
 * deliberately never called; any authenticated member of the session's own
 * organization can act, so the only precondition below is "is there a
 * session at all" (REQ-019).
 */

const GENERIC_FORBIDDEN_ERROR = "You must be signed in to do that.";

/**
 * REQ-021/REQ-022's `ipAddress` field, read from `x-forwarded-for` (Vercel
 * sits in front of the app as a proxy) inside the Server Action per
 * design.md, not inside `logAudit()` itself (a generic helper that must
 * also work from contexts with no HTTP request at all). `headers()` throws
 * outside a real request scope (for instance, called directly in a unit
 * test); `ipAddress` is optional in `logAudit`'s signature for exactly
 * that case, so this fails safe to `undefined` rather than throwing.
 */
async function resolveIpAddress(): Promise<string | undefined> {
  try {
    const headerList = await headers();
    const forwardedFor = headerList.get("x-forwarded-for");
    return forwardedFor?.split(",")[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export interface CreatePatientActionResult {
  success: boolean;
  error?: string;
  patientId?: string;
}

/**
 * T3.2, closes REQ-001, REQ-005, REQ-006, REQ-021. The `documentId`
 * unique-constraint violation (`@@unique([organizationId, documentId])`,
 * REQ-006) is caught here as Prisma's P2002 and mapped to the same generic
 * error REQ-005 specifies -- this is also what makes REQ-007's race
 * outcome correct: whichever of two concurrent creates commits first wins,
 * the loser hits this same P2002 branch.
 */
export async function createPatientAction(input: unknown): Promise<CreatePatientActionResult> {
  const session = await auth();
  if (!session) {
    return { success: false, error: GENERIC_FORBIDDEN_ERROR };
  }

  const parsed = patientSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: GENERIC_PATIENT_VALIDATION_ERROR };
  }
  const data = parsed.data;
  const ipAddress = await resolveIpAddress();

  try {
    const patient = await withTenant(
      { organizationId: session.organizationId, userId: session.user.id },
      async (tx) => {
        // organizationId is a required scalar in Prisma's generated
        // create-input type, so it's supplied here even inside withTenant;
        // the tenant-context extension (src/lib/db.ts) injects the real
        // value regardless of what's passed.
        const created = await tx.patient.create({
          data: {
            fullName: data.fullName,
            phone: data.phone,
            documentId: data.documentId,
            birthDate: data.birthDate,
            sex: data.sex,
            email: data.email,
            address: data.address,
            organizationId: session.organizationId,
          },
        });

        await logAudit(tx, {
          action: "patient.create",
          entityType: "Patient",
          entityId: created.id,
          userId: session.user.id,
          organizationId: session.organizationId,
          ipAddress,
        });

        return created;
      }
    );

    return { success: true, patientId: patient.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, error: GENERIC_DUPLICATE_DOCUMENT_ID_ERROR };
    }
    throw error;
  }
}

export interface UpdatePatientActionResult {
  success: boolean;
  error?: string;
}

const GENERIC_NOT_FOUND_ERROR = "Patient not found.";

/**
 * T3.4, closes REQ-012, REQ-021. Reuses `patientSchema` unchanged (REQ-012:
 * "the same validations as creation"); a failed `safeParse` returns before
 * any query runs, leaving the existing row untouched. This is a full-record
 * edit (the form resubmits every field), so an optional field left blank
 * explicitly clears the stored value (`?? null`) rather than silently
 * leaving a stale value in place -- unlike `createPatientAction`, where
 * `undefined` on a brand-new row and `null` are equivalent.
 *
 * `tx.patient.update({ where: { id: patientId }, ... })` doesn't add
 * `organizationId` to `where` manually: the tenant-context extension
 * (src/lib/db.ts's `applyTenantScope`) injects it for every `update` call,
 * so a `patientId` belonging to a different organization simply matches no
 * row and Prisma throws P2025, mapped below to the same generic
 * "not found" a nonexistent id would get -- never a hint that the id
 * belongs to someone else's organization (REQ-019).
 */
export async function updatePatientAction(
  patientId: string,
  input: unknown
): Promise<UpdatePatientActionResult> {
  const session = await auth();
  if (!session) {
    return { success: false, error: GENERIC_FORBIDDEN_ERROR };
  }

  const parsed = patientSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: GENERIC_PATIENT_VALIDATION_ERROR };
  }
  const data = parsed.data;
  const ipAddress = await resolveIpAddress();

  try {
    await withTenant(
      { organizationId: session.organizationId, userId: session.user.id },
      async (tx) => {
        const updated = await tx.patient.update({
          where: { id: patientId },
          data: {
            fullName: data.fullName,
            phone: data.phone,
            documentId: data.documentId ?? null,
            birthDate: data.birthDate ?? null,
            sex: data.sex ?? null,
            email: data.email ?? null,
            address: data.address || null,
          },
        });

        await logAudit(tx, {
          action: "patient.update",
          entityType: "Patient",
          entityId: updated.id,
          userId: session.user.id,
          organizationId: session.organizationId,
          ipAddress,
        });
      }
    );

    return { success: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, error: GENERIC_DUPLICATE_DOCUMENT_ID_ERROR };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { success: false, error: GENERIC_NOT_FOUND_ERROR };
    }
    throw error;
  }
}

export interface ArchivePatientActionResult {
  success: boolean;
  error?: string;
}

/**
 * T3.5, closes REQ-013, REQ-014, REQ-021. `archivePatientAction`/
 * `unarchivePatientAction` are thin wrappers around the same helper, one
 * setting `archivedAt`, the other clearing it -- both call `logAudit()` on
 * success with a distinct action name (REQ-021 requires the action be
 * named). Same wrong-organization handling as `updatePatientAction`: the
 * tenant-context extension injects `organizationId` into `where`, so a
 * foreign `patientId` throws P2025, mapped to the same generic
 * "not found".
 *
 * T4.5: revalidates exactly the list and detail paths that display this
 * patient (`nextjs-architect.md`'s scoped-revalidation guidance), not a
 * broader invalidation. `Organization` isn't tenant-scoped (src/lib/db.ts),
 * so resolving its slug for the path is a direct `db.organization` read,
 * same pattern as src/app/(app)/[orgSlug]/dashboard/page.tsx -- this keeps
 * the function's own parameters unchanged (just `patientId`), rather than
 * threading `orgSlug` through from the caller.
 */
async function setPatientArchivedState(
  patientId: string,
  archivedAt: Date | null,
  action: "patient.archive" | "patient.unarchive"
): Promise<ArchivePatientActionResult> {
  const session = await auth();
  if (!session) {
    return { success: false, error: GENERIC_FORBIDDEN_ERROR };
  }
  const ipAddress = await resolveIpAddress();

  try {
    await withTenant(
      { organizationId: session.organizationId, userId: session.user.id },
      async (tx) => {
        const updated = await tx.patient.update({ where: { id: patientId }, data: { archivedAt } });

        await logAudit(tx, {
          action,
          entityType: "Patient",
          entityId: updated.id,
          userId: session.user.id,
          organizationId: session.organizationId,
          ipAddress,
        });
      }
    );

    const organization = await db.organization.findUnique({
      where: { id: session.organizationId },
      select: { slug: true },
    });
    if (organization) {
      revalidatePath(`/${organization.slug}/patients`);
      revalidatePath(`/${organization.slug}/patients/${patientId}`);
    }

    return { success: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { success: false, error: GENERIC_NOT_FOUND_ERROR };
    }
    throw error;
  }
}

export async function archivePatientAction(patientId: string): Promise<ArchivePatientActionResult> {
  return setPatientArchivedState(patientId, new Date(), "patient.archive");
}

export async function unarchivePatientAction(patientId: string): Promise<ArchivePatientActionResult> {
  return setPatientArchivedState(patientId, null, "patient.unarchive");
}
