import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// `auth()` runs the jwt() callback's REQ-018 tokenVersion check against
// Postgres on every session read, including from middleware -- that needs
// real Node APIs (Prisma, node:async_hooks), not the Edge runtime
// middleware uses by default. Next.js 15's Node.js Middleware (stable)
// runs this middleware in the regular Node.js runtime instead.
export const runtime = "nodejs";

/**
 * REQ-016: an unauthenticated visitor requesting any workspace route is
 * redirected to /login instead of the route rendering.
 *
 * Route groups like `(app)` are stripped from the URL, so "matcher scoped
 * to (app)/*" (design.md) can't be expressed as a literal path pattern;
 * this runs on every path except Next.js internals and explicitly
 * allowlists the public auth routes instead, which is the documented
 * Auth.js v5 pattern for this exact case.
 */

const PUBLIC_PATHS = new Set(["/", "/login", "/register"]);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  // `/invite/[token]` (phase-1a-team-invites, T3.7) is a dynamic path, so it
  // can't be listed in the exact-match PUBLIC_PATHS set above; it must be
  // public since a visitor accepting an invite has no session yet -- that's
  // the entire point of the flow (ADR-0002).
  const isPublic =
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/invite/");

  if (!isPublic && !req.auth) {
    const loginUrl = new URL("/login", req.nextUrl);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
