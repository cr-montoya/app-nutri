"use server";

import { hash } from "@node-rs/argon2";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { registerSchema, checkPasswordNotBreached, BreachedPasswordError } from "@/validation/auth";
import { slugify } from "@/server/services/organization-slug";

/**
 * REQ-001, REQ-002, REQ-007, REQ-020: creates a brand-new organization's
 * `User` + `Organization` + `Membership` (role ADMIN) atomically in one
 * transaction. This is the one place `Membership` is created outside
 * `withTenant` -- see design.md's Deviations section and the doc comment on
 * the tenant-context guard in src/lib/db.ts, "documented exception for
 * create/createMany" -- because there is no existing tenant session to
 * scope a new organization's very first membership from.
 */

export interface RegisterActionResult {
  success: boolean;
  error?: string;
}

const GENERIC_EMAIL_TAKEN_ERROR = "An account with this email already exists.";
const GENERIC_VALIDATION_ERROR = "Please check your registration details and try again.";

export async function registerAction(input: unknown): Promise<RegisterActionResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    // REQ-003, REQ-004, REQ-006, REQ-021: rejected before any record is
    // created. Field-level detail from Zod stays server-side; never echo
    // the submitted password back in any form.
    return { success: false, error: GENERIC_VALIDATION_ERROR };
  }

  const { email, name, password, organizationName } = parsed.data;

  try {
    // REQ-005: rejected before any record is created.
    await checkPasswordNotBreached(password);
  } catch (error) {
    if (error instanceof BreachedPasswordError) {
      return { success: false, error: error.message };
    }
    throw error;
  }

  const passwordHash = await hash(password); // argon2id defaults, ADR-0001
  const baseSlug = slugify(organizationName);

  try {
    await db.$transaction(async (tx) => {
      // REQ-007: disambiguation loop, `-2`, `-3`, ... within the same
      // transaction so the check-then-create is consistent with what this
      // transaction itself is about to insert.
      let slug = baseSlug;
      let suffix = 2;
      // Intentionally sequential: each check depends on the previous one.
      while (await tx.organization.findUnique({ where: { slug } })) {
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }

      const organization = await tx.organization.create({
        data: { name: organizationName, slug },
      });

      // REQ-002: DB-level unique constraint on User.email is what actually
      // enforces this, not a pre-check; see the catch block below.
      const user = await tx.user.create({
        data: { email, name, passwordHash },
      });

      // The Prisma extension's create-bootstrap exception (src/lib/db.ts)
      // lets this create run without an ambient withTenant() context, but
      // the RLS policy on `memberships` still checks
      // app.current_org_id on INSERT (design.md's RLS policy section: the
      // policy has no separate WITH CHECK, so Postgres uses USING for
      // both). Nothing has set that session variable yet in this
      // transaction, so without this line RLS itself would reject the
      // insert -- which is the defense-in-depth layer doing exactly its
      // job. Setting it here, to the org this same transaction just
      // created, is the bootstrap case's equivalent of withTenant()'s
      // SET LOCAL.
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organization.id}, true)`;

      // REQ-001, REQ-020: the one documented create outside withTenant
      // (see doc comment above); organizationId is supplied explicitly
      // because this bootstraps the org's tenant context, it doesn't
      // inherit one.
      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: "ADMIN",
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // REQ-002: same generic error whether this is the first attempt or
      // the losing side of a concurrent race on the same email -- the
      // unique constraint is what guarantees only one can ever succeed.
      return { success: false, error: GENERIC_EMAIL_TAKEN_ERROR };
    }
    throw error;
  }

  return { success: true };
}
