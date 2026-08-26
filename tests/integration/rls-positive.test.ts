import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { adminDb } from "../helpers/admin-db";

/**
 * Positive RLS test (T2.5, closes REQ-012): a session scoped to org A reads
 * and writes its own Membership/Professional rows through `withTenant`.
 * Runs against a real Postgres instance (local Docker container standing in
 * for a Neon dev branch, see tasks.md T2.2's deviation note), using the
 * non-superuser `appnutri_app` role so RLS actually applies.
 */

const prisma = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
const runId = Date.now();

let orgA: { id: string };
let orgB: { id: string };
let userA: { id: string };
let userB: { id: string };

beforeAll(async () => {
  orgA = await prisma.organization.create({
    data: { name: "RLS Positive Org A", slug: `rls-positive-org-a-${runId}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "RLS Positive Org B", slug: `rls-positive-org-b-${runId}` },
  });
  userA = await prisma.user.create({
    data: { email: `rls-positive-a-${runId}@example.test`, passwordHash: "x", name: "User A" },
  });
  userB = await prisma.user.create({
    data: { email: `rls-positive-b-${runId}@example.test`, passwordHash: "x", name: "User B" },
  });
});

afterAll(async () => {
  // Cleanup uses the owner role (bypasses RLS): the app role used for the
  // assertions above can only see rows scoped by `app.current_org_id`,
  // which isn't set outside of a `withTenant` call.
  await adminDb.professional.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
  await adminDb.$disconnect();
});

describe("withTenant: positive RLS", () => {
  it("creates and reads its own Membership, scoped to the caller's organization", async () => {
    // organizationId is a required scalar in Prisma's generated create-input
    // type, so it must be supplied here even inside withTenant; it's set to
    // orgB.id on purpose to prove withTenant's injection overrides whatever
    // the caller passes, rather than trusting it.
    const created = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.membership.create({ data: { userId: userA.id, role: "ADMIN", organizationId: orgB.id } })
    );
    expect(created.organizationId).toBe(orgA.id);

    const found = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.membership.findUnique({ where: { userId: userA.id } })
    );
    expect(found?.id).toBe(created.id);
    expect(found?.organizationId).toBe(orgA.id);
  });

  it("creates and reads its own Professional, scoped to the caller's organization", async () => {
    const membership = await withTenant({ organizationId: orgB.id, userId: userB.id }, (tx) =>
      tx.membership.create({ data: { userId: userB.id, role: "NUTRITIONIST", organizationId: orgB.id } })
    );

    const created = await withTenant({ organizationId: orgB.id, userId: userB.id }, (tx) =>
      tx.professional.create({
        data: { membershipId: membership.id, licenseNumber: "LIC-001", organizationId: orgB.id },
      })
    );
    expect(created.organizationId).toBe(orgB.id);

    const found = await withTenant({ organizationId: orgB.id, userId: userB.id }, (tx) =>
      tx.professional.findUnique({ where: { membershipId: membership.id } })
    );
    expect(found?.id).toBe(created.id);
    expect(found?.organizationId).toBe(orgB.id);
  });

  it("updates its own Membership row through withTenant", async () => {
    const membership = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.membership.findUniqueOrThrow({ where: { userId: userA.id } })
    );

    const updated = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.membership.update({ where: { id: membership.id }, data: { role: "FRONT_DESK" } })
    );
    expect(updated.role).toBe("FRONT_DESK");
    expect(updated.organizationId).toBe(orgA.id);
  });
});
