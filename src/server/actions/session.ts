"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth";
import { loginSchema } from "@/validation/auth";

/**
 * Kept separate from src/server/actions/auth.ts's `registerAction`: this
 * file imports `@/lib/auth` (the actual `NextAuth(...)` instance), which
 * pulls in Auth.js's Next.js-runtime-only dependencies. Bundling that into
 * the same file as `registerAction` would make
 * tests/integration/register-action.test.ts fail to even load under
 * Vitest, the same problem src/lib/auth-core.ts was split out to avoid.
 */

/**
 * REQ-008, REQ-009: authenticates via the Credentials provider
 * (src/lib/auth-core.ts's `authorizeCredentials`, argon2id). Any failure --
 * unknown email, wrong password, or malformed input -- returns the exact
 * same generic error, never revealing which case it was.
 */
export interface LoginActionResult {
  success: boolean;
  error?: string;
}

const GENERIC_LOGIN_ERROR = "Incorrect email or password.";

export async function loginAction(input: unknown): Promise<LoginActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: GENERIC_LOGIN_ERROR };
  }

  try {
    // redirect: false so this action can return a result the client form
    // handles itself (loading state, error message), rather than Auth.js
    // performing the redirect: workspace routes don't exist to redirect
    // into until T6, and even once they do, the target depends on the
    // user's organization slug, which the caller resolves, not this
    // action.
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { success: false, error: GENERIC_LOGIN_ERROR };
    }
    throw error;
  }

  return { success: true };
}

/**
 * REQ-015: invalidates the session and sends the user back to /login.
 */
export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
