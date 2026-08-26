import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";
import {
  authorizeCredentials,
  refreshOrInvalidate,
  EIGHT_HOURS_IN_SECONDS,
  type AppJWT,
} from "./auth-core";

/**
 * Auth.js v5 configuration. Credentials-only in this phase (REQ-008,
 * REQ-009): argon2id password verification (REQ-010, ADR-0001), an 8-hour
 * JWT session (REQ-011) carrying the user id and their organization's id as
 * the active-org claim (REQ-008), and a `tokenVersion` check on every
 * session read so an admin can force-invalidate all of a user's sessions by
 * bumping it in the database (REQ-018; no UI trigger ships this phase).
 *
 * The actual REQ-008/REQ-009/REQ-018 logic lives in ./auth-core.ts, unit
 * tested there (src/lib/auth.test.ts) without pulling in Auth.js's runtime.
 */

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string };
    organizationId: string;
  }

  interface User {
    organizationId: string;
    tokenVersion: number;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: EIGHT_HOURS_IN_SECONDS,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: authorizeCredentials,
    }),
  ],
  callbacks: {
    async jwt({ token, user }): Promise<JWT | null> {
      const appToken = token as AppJWT;

      if (user) {
        appToken.userId = user.id;
        appToken.organizationId = user.organizationId;
        appToken.tokenVersion = user.tokenVersion;
        return appToken;
      }

      return refreshOrInvalidate(appToken);
    },
    async session({ session, token }) {
      const appToken = token as AppJWT;
      if (appToken.userId) {
        session.user.id = appToken.userId;
      }
      if (appToken.organizationId) {
        session.organizationId = appToken.organizationId;
      }
      return session;
    },
  },
});
