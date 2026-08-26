"use server";

import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
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
