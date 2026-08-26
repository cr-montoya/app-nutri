import { z } from "zod";

/**
 * Shared create/update validation (T3.1), reused as-is by both
 * `createPatientAction` and `updatePatientAction` (REQ-012: "the same
 * validations as creation"). Bounds and formats come straight from
 * requirements.md REQ-002 through REQ-011.
 *
 * Only `fullName`/`phone` are mandatory (REQ-001); every other field
 * accepts an empty string ("" -- the shape a blank HTML field submits) as
 * "not provided," via `z.union([<real shape>, z.literal("")])` rather than
 * `z.preprocess`. This keeps the schema's Zod *input* type equal to its
 * *output* type (every field a plain string), which `zodResolver` needs to
 * type a `useForm` generic against and give inline per-field errors --
 * same convention `src/validation/team.ts`'s `updateProfessionalProfileSchema`
 * already established for this exact "optional form field" problem (an
 * earlier version of this file used `z.preprocess` instead, diverged from
 * that convention, and lost `patient-form.tsx`'s inline validation as a
 * result -- a `code-quality` gate finding fixed here, see design.md's
 * `## Deviations`). The Server Action normalizes a resulting `""` to
 * `undefined`/`null` before writing to Prisma, the same `|| undefined`
 * idiom `updateProfessionalProfileAction` already uses.
 */
export const patientSchema = z.object({
  // REQ-002: 1-200 chars after trimming.
  fullName: z.string().trim().min(1).max(200),

  // REQ-003: E.164-style -- optional leading "+", 7 to 15 digits.
  phone: z
    .string()
    .trim()
    .regex(/^\+?\d{7,15}$/, "Enter a valid phone number (7 to 15 digits, optional leading +)."),

  // REQ-004: optional; when provided, 1-50 chars after trimming, no other
  // format restriction (valid document types vary). Whitespace-only input
  // matches the first union branch, trims to an empty string, and fails
  // `.min(1)` there -- REQ-004's "empty after trimming" rejection. A
  // genuinely empty submission matches the `z.literal("")` branch instead
  // and skips the bounds check entirely.
  documentId: z.union([z.string().trim().min(1).max(50), z.literal("")]).optional(),

  // REQ-008: kept as a plain string here, the shape an `<input type="date">`
  // submits. Parsed and future-checked by `parseBirthDate` below, called
  // from the Server Action after this schema passes -- isolates the one
  // field that needs real coercion instead of making the whole schema's
  // input type diverge from what the form actually submits.
  birthDate: z.string().optional(),

  // REQ-010: optional; when provided, must be MALE or FEMALE.
  sex: z.union([z.enum(["MALE", "FEMALE"]), z.literal("")]).optional(),

  // REQ-009: optional; when provided, must be a valid email format.
  email: z
    .union([z.string().trim().toLowerCase().email("Enter a valid email address."), z.literal("")])
    .optional(),

  // REQ-011: optional; when provided, at most 300 chars after trimming. No
  // minimum-length rejection specified (unlike documentId), so a
  // whitespace-only address simply trims to an empty, valid string.
  address: z.string().trim().max(300).optional(),
});

export type PatientInput = z.infer<typeof patientSchema>;

export const GENERIC_PATIENT_VALIDATION_ERROR = "Please check the patient details and try again.";
export const GENERIC_DUPLICATE_DOCUMENT_ID_ERROR =
  "A patient with this document ID already exists in your organization.";
export const GENERIC_BIRTH_DATE_ERROR = "Enter a valid birth date, not in the future.";

export interface ParsedBirthDate {
  value?: Date;
  error?: string;
}

/**
 * REQ-008: parses `raw` (`patientSchema.birthDate`'s value -- `""`,
 * `undefined`, or a `"YYYY-MM-DD"`-shaped string) into a `Date | undefined`,
 * rejecting an unparseable string or a future date. Called from the Server
 * Action after `patientSchema.safeParse` succeeds, still before any record
 * is created or updated -- REQ-008 only requires the rejection happen
 * before persistence, not that it live inside the Zod schema itself.
 */
export function parseBirthDate(raw: string | undefined): ParsedBirthDate {
  if (!raw) {
    return {};
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime()) || parsed > new Date()) {
    return { error: GENERIC_BIRTH_DATE_ERROR };
  }

  return { value: parsed };
}
