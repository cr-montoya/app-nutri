import { z } from "zod";

/**
 * Shared create/edit field validation (T2.1), reused by both
 * `createAppointmentAction` and `updateAppointmentAction`/the detail
 * sheet's edit form (REQ-011: "the same rules... applying REQ-003 and
 * REQ-006 through REQ-010"). `patientId` is intentionally not part of this
 * shared shape -- REQ-011 forbids changing the patient on an existing
 * appointment, so only `createAppointmentSchema` (below) adds it.
 *
 * `date`/`time` are the shape native `<input type="date">`/`<input
 * type="time">` submit; `resolveAppointmentRange` below is what turns them
 * into the stored `startAt`/`endAt` UTC instants, per REQ-005's
 * America/Bogota boundary. `durationMinutes`/`reason`/`notes` follow the
 * same "`""` means not provided" union-with-literal convention
 * `src/validation/patients.ts` established, so `zodResolver` keeps a
 * stable input/output type for `useForm`.
 */
export const appointmentFieldsSchema = z.object({
  professionalId: z.string().trim().min(1, "Select a professional."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Select a valid date."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Select a valid time."),
  // REQ-002/REQ-003: optional; defaults to 30, must be 5-480 when provided.
  durationMinutes: z.union([z.string().regex(/^\d+$/), z.literal("")]).optional(),
  // REQ-009: optional; when provided, at most 200 chars after trimming.
  reason: z.union([z.string().trim().max(200), z.literal("")]).optional(),
  // REQ-010: optional; when provided, at most 2000 chars after trimming.
  notes: z.union([z.string().trim().max(2000), z.literal("")]).optional(),
});

export type AppointmentFieldsInput = z.infer<typeof appointmentFieldsSchema>;

export const createAppointmentSchema = appointmentFieldsSchema.extend({
  patientId: z.string().trim().min(1, "Select a patient."),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const GENERIC_APPOINTMENT_VALIDATION_ERROR =
  "Please check the appointment details and try again.";
export const GENERIC_CONFLICT_ERROR =
  "This professional already has an appointment that overlaps this time.";
export const GENERIC_NOT_FOUND_ERROR = "Appointment not found.";
export const GENERIC_PATIENT_OR_PROFESSIONAL_NOT_FOUND_ERROR =
  "Select a patient and professional from your organization.";
export const GENERIC_INVALID_STATUS_FOR_EDIT_ERROR =
  "This appointment can no longer be rescheduled or edited.";
export const GENERIC_DURATION_ERROR = "Duration must be between 5 and 480 minutes.";
export const GENERIC_PAST_START_ERROR = "Choose a start date/time that isn't in the past.";

const DEFAULT_DURATION_MINUTES = 30;
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 480;

// REQ-005: America/Bogota is UTC-5 year-round (no daylight saving), fixed
// for this phase (multi-timezone support is explicitly out of scope). A
// Bogota wall-clock instant converts to UTC by adding this offset. Exported
// so calendar.tsx's ADR-0005 display-instant shift reuses this single
// definition instead of redeclaring the same constant.
export const BOGOTA_UTC_OFFSET_HOURS = 5;

export interface ResolvedAppointmentRange {
  startAt?: Date;
  endAt?: Date;
  error?: string;
}

/**
 * REQ-002 through REQ-005: parses `fields.date`/`fields.time` as an
 * America/Bogota wall-clock instant, converts to the UTC `startAt` that's
 * actually stored, defaults/validates the duration, and rejects a past
 * `startAt`. Called from the Server Action after `appointmentFieldsSchema`/
 * `createAppointmentSchema` already passed, still before any record is
 * created or updated -- REQ-003/REQ-004 only require the rejection happen
 * before persistence, not that it live inside the Zod schema itself (same
 * convention as `src/validation/patients.ts`'s `parseBirthDate`).
 *
 * `checkPast` (REQ-004) defaults to on for `createAppointmentAction`, but
 * `updateAppointmentAction` passes `false`: REQ-011 lists exactly which
 * requirements an edit re-validates ("REQ-003 and REQ-006 through
 * REQ-010"), deliberately not REQ-004 -- an appointment whose original
 * `startAt` has since slipped into the past (the normal case for editing
 * an appointment scheduled earlier the same day) must still be editable
 * (reason, notes, status), not permanently locked out by a check meant for
 * new submissions.
 */
export function resolveAppointmentRange(
  fields: Pick<AppointmentFieldsInput, "date" | "time" | "durationMinutes">,
  now: Date = new Date(),
  checkPast = true
): ResolvedAppointmentRange {
  const [year, month, day] = fields.date.split("-").map(Number);
  const [hour, minute] = fields.time.split(":").map(Number);

  const startAt = new Date(Date.UTC(year, month - 1, day, hour + BOGOTA_UTC_OFFSET_HOURS, minute));
  if (Number.isNaN(startAt.getTime())) {
    return { error: GENERIC_APPOINTMENT_VALIDATION_ERROR };
  }

  if (checkPast && startAt < now) {
    return { error: GENERIC_PAST_START_ERROR };
  }

  const durationRaw = fields.durationMinutes?.trim();
  const durationMinutes = durationRaw ? Number(durationRaw) : DEFAULT_DURATION_MINUTES;
  if (durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
    return { error: GENERIC_DURATION_ERROR };
  }

  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  return { startAt, endAt };
}

/**
 * The inverse of `resolveAppointmentRange`'s date/time half: formats a
 * stored UTC `startAt` back into the `date`/`time` shape the create/edit
 * form's native inputs expect, in America/Bogota local time. Used by the
 * detail sheet (T4.5) to pre-fill the edit form with an appointment's
 * current values.
 */
export function formatBogotaDateAndTime(instant: Date): { date: string; time: string } {
  // Re-derive from UTC getters against a shifted instant, so this has no
  // dependency on the host's own timezone (Intl/Date's local getters would).
  const shifted = new Date(instant.getTime() - BOGOTA_UTC_OFFSET_HOURS * 60 * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  const time = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  return { date, time };
}

/**
 * Returns the [start, end) UTC instants of "today" in America/Bogota,
 * containing `now`. Used by `appointments/page.tsx`'s Server Component
 * shell for its default landing range (design.md: "the initial visible
 * day's appointments").
 */
export function getBogotaDayRange(now: Date = new Date()): { start: Date; end: Date } {
  const { date } = formatBogotaDateAndTime(now);
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, BOGOTA_UTC_OFFSET_HOURS, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  return { start, end };
}
