import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * REQ-017: a workspace route under an organization slug that isn't the
 * caller's own organization gets the same 404 as a slug that doesn't exist
 * at all -- no part of the route, including this layout's own data, tells
 * the two cases apart. Middleware (src/middleware.ts) already handles the
 * unauthenticated case (REQ-016); this only has to compare `orgSlug` to
 * the session's organization.
 *
 * `Organization` isn't tenant-scoped (src/lib/db.ts), so this is a direct
 * `db.organization` read, no `withTenant`.
 */
export default async function OrgWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await auth();

  // Defensive: middleware already redirects an unauthenticated visitor to
  // /login before this layout ever renders.
  if (!session) {
    notFound();
  }

  const organization = await db.organization.findUnique({ where: { slug: orgSlug } });

  // Same 404 either way: no such organization, or an organization that
  // isn't this session's own.
  if (!organization || organization.id !== session.organizationId) {
    notFound();
  }

  return <>{children}</>;
}
