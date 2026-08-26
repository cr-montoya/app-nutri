import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Registration validation (T4.1). Every field check here runs before
 * registerAction (T4.2) touches the database, per REQ-003, REQ-004,
 * REQ-006, REQ-021. Password strength (REQ-004) and the HIBP breach check
 * (REQ-005) are separate: Zod validates shape/length synchronously, the
 * HIBP check is a separate async step since it requires a network call.
 */

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12),
  organizationName: z.string().trim().min(2).max(100),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export class BreachedPasswordError extends Error {
  constructor(message = "This password has appeared in a data breach. Please choose a different one.") {
    super(message);
    this.name = "BreachedPasswordError";
  }
}

/**
 * REQ-005: rejects a password found in the HIBP breached-password range
 * API. Uses the k-anonymity range API (https://haveibeenpwned.com/API/v3#PwnedPasswords):
 * only the first 5 hex characters of the password's SHA-1 hash are ever
 * sent, never the password itself or its full hash (REQ-010's "never store
 * or log a plaintext password" spirit extends to never transmitting one
 * in full, even hashed, to a third party).
 *
 * If the HIBP API is unreachable or errors, this fails open (does not
 * block registration) rather than making a third-party outage block every
 * new signup; that tradeoff isn't specified by requirements.md and is
 * recorded in design.md's Deviations section.
 */
export async function checkPasswordNotBreached(
  password: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  let response: Response;
  try {
    response = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
    });
  } catch {
    return; // network failure: fail open, see doc comment above
  }

  if (!response.ok) {
    return; // HIBP outage/error: fail open, see doc comment above
  }

  const body = await response.text();
  const isBreached = body
    .split("\n")
    .some((line) => line.split(":")[0]?.trim() === suffix);

  if (isBreached) {
    throw new BreachedPasswordError();
  }
}
