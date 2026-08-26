import { z } from "zod";

/**
 * Shared create/update validation (T3.1), reused as-is by both
 * `createPatientAction` and `updatePatientAction` (REQ-012: "the same
 * validations as creation"). Bounds and formats come straight from
 * requirements.md REQ-002 through REQ-011.
 *
 * Only `fullName`/`phone` are mandatory (REQ-001); every other field is
 * optional. For each optional field, an empty-string submission (the
 * normal shape a blank HTML form field takes, never literally `undefined`)
 * means "not provided" and is valid; a *non-empty* submission is still
 * checked against that field's bounds/format, which is what actually
 * enforces "empty after trimming" (whitespace-only) as a rejection for
 * `documentId` (REQ-004), the one field with no other format check to
 * catch it.
 */

function emptyToUndefined(val: unknown) {
  return val === "" || val === undefined || val === null ? undefined : val;
}

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
  // trims to an empty string, which fails `.min(1)` here -- REQ-004's
  // "empty after trimming" rejection.
  documentId: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).max(50).optional()
  ),

  // REQ-008: optional; when provided, must not be in the future. Checked
  // with `.refine` (not `z.date().max(new Date())`, evaluated once at
  // module load) so "now" is read fresh on every parse.
  birthDate: z.preprocess(
    emptyToUndefined,
    z.coerce
      .date()
      .optional()
      .refine((date) => !date || date <= new Date(), "Birth date cannot be in the future.")
  ),

  // REQ-010: optional; when provided, must be MALE or FEMALE.
  sex: z.preprocess(emptyToUndefined, z.enum(["MALE", "FEMALE"]).optional()),

  // REQ-009: optional; when provided, must be a valid email format.
  email: z.preprocess(
    emptyToUndefined,
    z.string().trim().toLowerCase().email("Enter a valid email address.").optional()
  ),

  // REQ-011: optional; when provided, at most 300 chars after trimming. No
  // minimum-length rejection specified (unlike documentId), so a
  // whitespace-only address simply trims to an empty, valid string.
  address: z.string().trim().max(300).optional(),
});

export type PatientInput = z.infer<typeof patientSchema>;

export const GENERIC_PATIENT_VALIDATION_ERROR = "Please check the patient details and try again.";
export const GENERIC_DUPLICATE_DOCUMENT_ID_ERROR =
  "A patient with this document ID already exists in your organization.";
