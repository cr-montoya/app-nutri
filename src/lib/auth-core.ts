import type { JWT } from "next-auth/jwt";
import { verify } from "@node-rs/argon2";
import { db } from "./db";

/**
 * REQ-008/REQ-009/REQ-010/REQ-018 logic, kept in its own module (no runtime
 * import of `next-auth`/`next-auth/providers/*`) so it can be unit-tested
 * (src/lib/auth.test.ts) without pulling in Auth.js's Next.js-runtime-only
 * dependencies. `src/lib/auth.ts` wires these into the actual Auth.js
 * config.
 */

/**
 * `declare module "next-auth/jwt"` augmentation doesn't resolve under this
 * project's `moduleResolution: "bundler"` (a known TypeScript limitation
 * merging declarations through a package's `exports` subpath, unrelated to
 * next-auth itself -- a plain `import type` from the same subpath resolves
 * fine, only the `declare module` augmentation form doesn't). Extending the
 * imported `JWT` type locally and asserting it at the callback boundary
 * avoids that limitation without resorting to `any`.
 */
export interface AppJWT extends JWT {
  userId?: string;
  organizationId?: string;
  tokenVersion?: number;
}

export const EIGHT_HOURS_IN_SECONDS = 60 * 60 * 8;

/**
 * REQ-008/REQ-009/REQ-010: verifies email+password against the database and
 * returns the fields the `jwt` callback needs, or `null` for any failure
 * (unknown email, no membership yet, wrong password) -- always the same
 * generic outcome, never revealing which part was wrong.
 */
export async function authorizeCredentials(
  credentials: Partial<Record<string, unknown>> | undefined
) {
  const email = typeof credentials?.email === "string" ? credentials.email : undefined;
  const password = typeof credentials?.password === "string" ? credentials.password : undefined;

  if (!email || !password) {
    return null;
  }

  const user = await db.user.findUnique({
    where: { email },
    include: { membership: true },
  });

  // No user, or a user with no membership yet (shouldn't happen post T4.2,
  // but defensive): same generic failure, no enumeration signal.
  if (!user || !user.membership) {
    return null;
  }

  const validPassword = await verify(user.passwordHash, password);
  if (!validPassword) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    organizationId: user.membership.organizationId,
    tokenVersion: user.tokenVersion,
  };
}

/**
 * REQ-018: checked on every session read. Returns the token unchanged if
 * its `tokenVersion` still matches the database, or `null` (Auth.js's
 * signal for "no session") if it doesn't -- or if the user no longer
 * exists.
 */
export async function refreshOrInvalidate(token: AppJWT): Promise<AppJWT | null> {
  if (!token.userId) {
    return token;
  }

  const current = await db.user.findUnique({
    where: { id: token.userId },
    select: { tokenVersion: true },
  });

  if (!current || current.tokenVersion !== token.tokenVersion) {
    return null;
  }

  return token;
}
