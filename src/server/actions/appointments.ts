"use server";

import { AppointmentStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db, withTenant } from "@/lib/db";
import { allowedNextStatuses } from "@/lib/appointments";
import {
  createAppointmentSchema,
  appointmentFieldsSchema,
  resolveAppointmentRange,
  GENERIC_APPOINTMENT_VALIDATION_ERROR,
  GENERIC_CONFLICT_ERROR,
  GENERIC_NOT_FOUND_ERROR,
  GENERIC_PATIENT_OR_PROFESSIONAL_NOT_FOUND_ERROR,
  GENERIC_INVALID_STATUS_FOR_EDIT_ERROR,
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
// Must match the constraint name literally, on both sides: defined in
// prisma/migrations/20260827022943_appointments_exclusion_and_rls/migration.sql
// ("ADD CONSTRAINT no_overlapping_active_appointments EXCLUDE USING gist
// (...)"). This string match is the only viable detection (see the comment
// above) -- there's no dedicated Prisma error code to key off instead -- so
// renaming the constraint in that migration file without updating this
// constant silently breaks conflict detection with no compile-time signal.
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
class AppointmentNotFoundError extends Error {}
class InvalidStatusForEditError extends Error {}

const EDITABLE_STATUSES: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED"];

/**
 * Resolves the `Organization.slug` for `revalidatePath`, same pattern as
 * `src/server/actions/patients.ts`'s `setPatientArchivedState`:
 * `Organization` isn't tenant-scoped (src/lib/db.ts), so this is a direct
 * `db.organization` read, not a `withTenant` query.
 */
async function revalidateAppointmentsPath(organizationId: string): Promise<void> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true },
  });
  if (organization) {
    revalidatePath(`/${organization.slug}/appointments`);
  }
}

export interface UpdateAppointmentActionResult {
  success: boolean;
  error?: string;
}

/**
 * T3.1, closes REQ-011, REQ-012. Reuses `appointmentFieldsSchema` (never
 * `patientId` -- REQ-011 explicitly forbids changing the patient; cancel
 * and recreate instead). Checks the appointment's current status is
 * `SCHEDULED`/`CONFIRMED` before applying any change (REQ-012), then
 * re-validates whichever fields changed exactly as `createAppointmentAction`
 * does (REQ-003, REQ-006 through REQ-010), including the same
 * `withTenant`-scoped `professionalId` lookup (REQ-008) and the same
 * EXCLUDE-constraint conflict mapping (REQ-006). This is also the code
 * path a calendar drag (REQ-013) and the detail sheet's non-drag edit
 * (REQ-024) both call, per design.md's routing section.
 */
export async function updateAppointmentAction(
  appointmentId: string,
  input: unknown
): Promise<UpdateAppointmentActionResult> {
  const session = await auth();
  if (!session) {
    return { success: false, error: GENERIC_FORBIDDEN_ERROR };
  }

  const parsed = appointmentFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: GENERIC_APPOINTMENT_VALIDATION_ERROR };
  }
  const data = parsed.data;

  // REQ-011 re-validates REQ-003 and REQ-006 through REQ-010, deliberately
  // not REQ-004: an appointment scheduled earlier the same day must stay
  // editable even after its startAt has slipped into the past.
  const range = resolveAppointmentRange(data, new Date(), false);
  if (range.error) {
    return { success: false, error: range.error };
  }

  try {
    await withTenant(
      { organizationId: session.organizationId, userId: session.user.id },
      async (tx) => {
        const [existing, professional] = await Promise.all([
          tx.appointment.findUnique({ where: { id: appointmentId } }),
          tx.professional.findUnique({ where: { id: data.professionalId } }),
        ]);
        if (!existing) {
          throw new AppointmentNotFoundError();
        }
        if (!EDITABLE_STATUSES.includes(existing.status)) {
          throw new InvalidStatusForEditError();
        }
        if (!professional) {
          throw new PatientOrProfessionalNotFoundError();
        }

        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            professionalId: data.professionalId,
            startAt: range.startAt!,
            endAt: range.endAt!,
            reason: data.reason || null,
            notes: data.notes || null,
          },
        });
      }
    );

    await revalidateAppointmentsPath(session.organizationId);
    return { success: true };
  } catch (error) {
    if (error instanceof AppointmentNotFoundError) {
      return { success: false, error: GENERIC_NOT_FOUND_ERROR };
    }
    if (error instanceof InvalidStatusForEditError) {
      return { success: false, error: GENERIC_INVALID_STATUS_FOR_EDIT_ERROR };
    }
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

export interface TransitionAppointmentStatusActionResult {
  success: boolean;
  error?: string;
}

const GENERIC_INVALID_TRANSITION_ERROR = "That status change isn't allowed.";
const GENERIC_STATUS_ALREADY_CHANGED_ERROR =
  "This appointment's status already changed. Refresh to see the current state.";

/**
 * T3.2/T3.3, closes REQ-014 through REQ-018. `expectedCurrentStatus` is
 * the status the caller last observed (the detail sheet's own fetched
 * data) -- REQ-018 requires the update be conditional on it, not on a
 * status re-read inside this same call, so two racing requests that both
 * observed `SCHEDULED` can never both win: `tx.appointment.updateMany`'s
 * `where` matches at most one of them, the loser's `count` is 0 and gets
 * `GENERIC_STATUS_ALREADY_CHANGED_ERROR` (REQ-018's "re-fetch the current
 * state rather than retry blindly"). `allowedNextStatuses` (src/lib/appointments.ts)
 * is checked before the update even runs (REQ-017), the same function the
 * detail sheet's status buttons (T4.6) use to decide what to render.
 */
const APPOINTMENT_STATUS_VALUES = Object.values(AppointmentStatus);

/**
 * Runtime guard for `expectedCurrentStatus`/`newStatus`, consistent with
 * `createAppointmentAction`/`updateAppointmentAction`'s `safeParse`-first
 * convention: both those actions validate `input: unknown` with Zod before
 * doing anything else, but this action's two parameters are typed
 * `AppointmentStatus` at the TypeScript level only -- nothing stops a
 * caller (or a stale/tampered client bundle) from passing a value outside
 * the enum at runtime. Without this check, an out-of-enum
 * `expectedCurrentStatus` falls through `allowedNextStatuses`'s switch
 * (src/lib/appointments.ts, no `default` case) as `undefined`, and
 * `undefined.includes(newStatus)` throws an unhandled `TypeError` instead
 * of returning the same generic rejection the other actions use for
 * invalid input.
 */
function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return typeof value === "string" && (APPOINTMENT_STATUS_VALUES as string[]).includes(value);
}

export async function transitionAppointmentStatusAction(
  appointmentId: string,
  expectedCurrentStatus: AppointmentStatus,
  newStatus: AppointmentStatus
): Promise<TransitionAppointmentStatusActionResult> {
  const session = await auth();
  if (!session) {
    return { success: false, error: GENERIC_FORBIDDEN_ERROR };
  }

  if (!isAppointmentStatus(expectedCurrentStatus) || !isAppointmentStatus(newStatus)) {
    return { success: false, error: GENERIC_APPOINTMENT_VALIDATION_ERROR };
  }

  if (!allowedNextStatuses(expectedCurrentStatus).includes(newStatus)) {
    return { success: false, error: GENERIC_INVALID_TRANSITION_ERROR };
  }

  const result = await withTenant(
    { organizationId: session.organizationId, userId: session.user.id },
    (tx) =>
      tx.appointment.updateMany({
        where: { id: appointmentId, status: expectedCurrentStatus },
        data: { status: newStatus },
      })
  );

  if (result.count === 0) {
    return { success: false, error: GENERIC_STATUS_ALREADY_CHANGED_ERROR };
  }

  await revalidateAppointmentsPath(session.organizationId);
  return { success: true };
}

export interface AppointmentForCalendar {
  id: string;
  patientId: string;
  patientName: string;
  professionalId: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  reason: string | null;
  notes: string | null;
}

export interface GetAppointmentsForRangeActionResult {
  success: boolean;
  error?: string;
  appointments?: AppointmentForCalendar[];
}

/**
 * T4.1, closes REQ-019. Range-scoped, org-scoped (via `withTenant`) query
 * behind an actual Server Action, not a plain data-access module like
 * `src/server/services/patients.ts`'s `listPatients` -- design.md's
 * routing table has the calendar's Client Component call this directly on
 * every range navigation (day/week change), which only a Server Action
 * (not a Server-Component-only read) supports. The initial page load
 * (`appointments/page.tsx`) calls this same function server-side for its
 * first paint. Dates cross the client/server boundary as ISO strings, not
 * `Date` objects (React Server Action serialization).
 */
export async function getAppointmentsForRangeAction(
  rangeStartISO: string,
  rangeEndISO: string
): Promise<GetAppointmentsForRangeActionResult> {
  const session = await auth();
  if (!session) {
    return { success: false, error: GENERIC_FORBIDDEN_ERROR };
  }

  const rangeStart = new Date(rangeStartISO);
  const rangeEnd = new Date(rangeEndISO);

  const rows = await withTenant(
    { organizationId: session.organizationId, userId: session.user.id },
    (tx) =>
      tx.appointment.findMany({
        where: { startAt: { lt: rangeEnd }, endAt: { gt: rangeStart } },
        include: { patient: { select: { fullName: true } } },
        orderBy: { startAt: "asc" },
      })
  );

  return {
    success: true,
    appointments: rows.map((row) => ({
      id: row.id,
      patientId: row.patientId,
      patientName: row.patient.fullName,
      professionalId: row.professionalId,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      status: row.status,
      reason: row.reason,
      notes: row.notes,
    })),
  };
}
