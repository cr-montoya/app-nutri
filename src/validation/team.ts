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
 * `specialty` are nullable). No `.transform()` here (unlike, e.g., normalizing
 * email elsewhere): `@hookform/resolvers/zod`'s typing ties `useForm`'s
 * generic to this schema's pre-transform input type, so
 * `updateProfessionalProfileAction` normalizes an empty submitted string to
 * `undefined` itself, after parsing.
 */
const optionalProfileText = z.string().trim().max(100).optional();

export const updateProfessionalProfileSchema = z.object({
  licenseNumber: optionalProfileText,
  specialty: optionalProfileText,
});

export type UpdateProfessionalProfileInput = z.infer<typeof updateProfessionalProfileSchema>;

/**
 * REQ-013's exact generic wording for an invalid, expired, revoked, or
 * already-accepted invite token. Shared by `src/server/actions/team.ts`
 * (`acceptInviteAction`/`findPendingInviteByToken`) and
 * `src/app/(auth)/invite/[token]/page.tsx`'s "invalid invite" render.
 * Lives here, not in `team.ts`, because a `"use server"` module may only
 * export async functions (discovered when this was first attempted as a
 * plain exported string there), so it can't be imported by the Server
 * Component page directly; this plain module has no such restriction
 * (code-quality finding, phase-1a-team-invites remediation: this replaced a
 * hand-duplicated copy of the same string with a "keep these in sync"
 * comment).
 */
export const GENERIC_INVALID_INVITE_ERROR = "This invite link is invalid or has expired.";
