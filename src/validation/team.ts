import { z } from "zod";

/**
 * Invite-sending validation (T2.1, closes REQ-002). Same Zod style as
 * src/validation/auth.ts's registerSchema: email format is normalized
 * (trimmed, lowercased) before hitting sendInviteAction's uniqueness and
 * duplicate-pending checks. Role is restricted to the existing `Role` enum
 * values (design.md: Invite.role reuses Role, not a separate InviteRole).
 */

export const sendInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["ADMIN", "NUTRITIONIST", "FRONT_DESK"]),
});

export type SendInviteInput = z.infer<typeof sendInviteSchema>;

/**
 * Accept-invite validation (T3.1, closes REQ-007, REQ-008). Same bounds as
 * src/validation/auth.ts's registerSchema: name 1-100 chars after
 * trimming, password min 12 chars. The invited email is deliberately not a
 * field here (REQ-006: "displayed but not editable") -- it comes from the
 * resolved `Invite` row via the token, never from client input; the raw
 * token itself is handled separately as a route param by
 * acceptInviteAction, not part of this schema.
 */
export const acceptInviteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12),
});

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

/**
 * Professional-profile validation (T4.1, closes REQ-017 through REQ-019).
 * Deliberately has no id field of any kind (`membershipId`, `professionalId`,
 * etc.) -- REQ-019 requires the profile a submission affects to always be
 * "mine," derived server-side from the caller's session
 * (updateProfessionalProfileAction), never from client-supplied input. Both
 * fields are optional free text (schema.prisma's `Professional.licenseNumber`/
 * `specialty` are nullable): an empty submitted value is normalized to
 * `undefined` so `updateProfessionalProfileAction`'s upsert can clear a
 * previously set value.
 */
const optionalProfileText = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => (value === "" ? undefined : value));

export const updateProfessionalProfileSchema = z.object({
  licenseNumber: optionalProfileText,
  specialty: optionalProfileText,
});

export type UpdateProfessionalProfileInput = z.infer<typeof updateProfessionalProfileSchema>;
