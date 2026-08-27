"use server";

import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import {
  createAppointmentSchema,
  resolveAppointmentRange,
  GENERIC_APPOINTMENT_VALIDATION_ERROR,
  GENERIC_CONFLICT_ERROR,
  GENERIC_PATIENT_OR_PROFESSIONAL_NOT_FOUND_ERROR,
} from "@/validation/appointments";

/**
 * Appointment Server Actions (T2.2). REQ-023: no role restriction on any
 * action here -- `requireRole` (src/lib/rbac.ts) is deliberately never
 * called; any authenticated member of the session's own organization can
 * act, matching `phase-1b-patients`'s REQ-023 precedent.
 */

const GENERIC_FORBIDDEN_ERROR = "You must be signed in to do that.";

// Postgres exclusion-constraint violations (SQLSTATE 23P01) have no
// dedicated Prisma "known request error" code -- Prisma surfaces them as
// PrismaClientUnknownRequestError, distinguished only by the underlying
// Postgres error embedded in the message. Confirmed empirically (see
// tests/integration/create-appointment.test.ts's double-booking case)
// rather than assumed from Prisma's documented known-error-code list.
const EXCLUSION_CONSTRAINT_NAME = "no_overlapping_active_appointments";

/**
 * REQ-006/REQ-007: the `no_overlapping_active_appointments` EXCLUDE
 * constraint (T1.3) is what actually rejects an overlapping create or
 * reschedule; this is the one place that Postgres constraint-violation
 * error is mapped to the conflict message, shared by every action below
 * that can hit it.
 */
function mapAppointmentPersistenceError(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientUnknownRequestError)) {
    return undefined;
  }
  if (error.message.includes(EXCLUSION_CONSTRAINT_NAME)) {
    return GENERIC_CONFLICT_ERROR;
  }
  return undefined;
}

export interface CreateAppointmentActionResult {
  success: boolean;
  error?: string;
  appointmentId?: string;
}

/**
 * T2.2, closes REQ-001, REQ-006, REQ-008. `patientId`/`professionalId` are
 * resolved through `withTenant`-scoped lookups before the create, not left
 * to the foreign-key constraint alone: a `findUnique` inside `withTenant`
 * has `organizationId` injected into its `where` by the tenant-context
 * extension (src/lib/db.ts), so an id belonging to a different
 * organization simply matches no row -- rejected as "not found" (REQ-008),
 * never a hint that the id exists elsewhere. A plain FK constraint alone
 * would not catch this, since `Patient.id`/`Professional.id` are globally
 * unique, not scoped to an organization.
 */
export async function createAppointmentAction(
  input: unknown
): Promise<CreateAppointmentActionResult> {
  const session = await auth();
  if (!session) {
    return { success: false, error: GENERIC_FORBIDDEN_ERROR };
  }

  const parsed = createAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: GENERIC_APPOINTMENT_VALIDATION_ERROR };
  }
  const data = parsed.data;

  const range = resolveAppointmentRange(data);
  if (range.error) {
    return { success: false, error: range.error };
  }

  try {
    const appointment = await withTenant(
      { organizationId: session.organizationId, userId: session.user.id },
      async (tx) => {
        const [patient, professional] = await Promise.all([
          tx.patient.findUnique({ where: { id: data.patientId } }),
          tx.professional.findUnique({ where: { id: data.professionalId } }),
        ]);
        if (!patient || !professional) {
          throw new PatientOrProfessionalNotFoundError();
        }

        return tx.appointment.create({
          data: {
            patientId: data.patientId,
            professionalId: data.professionalId,
            startAt: range.startAt!,
            endAt: range.endAt!,
            reason: data.reason || undefined,
            notes: data.notes || undefined,
            organizationId: session.organizationId,
          },
        });
      }
    );

    return { success: true, appointmentId: appointment.id };
  } catch (error) {
    if (error instanceof PatientOrProfessionalNotFoundError) {
      return { success: false, error: GENERIC_PATIENT_OR_PROFESSIONAL_NOT_FOUND_ERROR };
    }
    const mapped = mapAppointmentPersistenceError(error);
    if (mapped) {
      return { success: false, error: mapped };
    }
    throw error;
  }
}

class PatientOrProfessionalNotFoundError extends Error {}
