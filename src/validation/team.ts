import { z } from "zod";

/**
 * Invite-sending validation (T2.1, closes REQ-002). Same Zod style as
 * src/validation/auth.ts's registerSchema: email format is normalized
 * (trimmed, lowercased) before hitting sendInviteAction's uniqueness and
 * duplicate-pending checks. Role is restricted to the existing `Role` enum
 * values (design.md: Invite.role reuses Role, not a separate InviteRole).
 *
 * The accept-invite schema (name/password, T3.1) is added to this same file
 * later, per design.md's "Files to create or update" -- not yet, out of
 * this task's scope.
 */

export const sendInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["ADMIN", "NUTRITIONIST", "FRONT_DESK"]),
});

export type SendInviteInput = z.infer<typeof sendInviteSchema>;
