import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { withTenant } from "@/lib/db";
import { adminDb } from "../helpers/admin-db";

/**
 * Positive RLS test (T1.4, closes REQ-021 app-layer half): an ADMIN session
 * lists its own org's Invites through withTenant, and only its own org's
 * Invites (REQ-015). Runs against a real Postgres instance (local Docker
 * container standing in for a Neon dev branch), using the non-superuser
 * `appnutri_app` role so RLS actually applies, same pattern as
 * rls-positive.test.ts.
 */

const prisma = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
const runId = Date.now();

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

let orgA: { id: string };
let orgB: { id: string };
let userA: { id: string };

beforeAll(async () => {
  orgA = await prisma.organization.create({
    data: { name: "Invite RLS Positive Org A", slug: `invite-rls-positive-org-a-${runId}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Invite RLS Positive Org B", slug: `invite-rls-positive-org-b-${runId}` },
  });
  userA = await prisma.user.create({
    data: { email: `invite-rls-positive-a-${runId}@example.test`, passwordHash: "x", name: "User A" },
  });
});

afterAll(async () => {
  // Cleanup uses the owner role (bypasses RLS): the app role used for the
  // assertions above can only see rows scoped by `app.current_org_id`,
  // which isn't set outside of a `withTenant` call.
  await adminDb.invite.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.user.deleteMany({ where: { id: userA.id } });
  await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
  await adminDb.$disconnect();
});

describe("withTenant: positive RLS on invites", () => {
  it("creates and reads its own Invite, scoped to the caller's organization", async () => {
    // organizationId is a required scalar in Prisma's generated create-input
    // type, so it must be supplied here even inside withTenant; it's set to
    // orgB.id on purpose to prove withTenant's injection overrides whatever
    // the caller passes, rather than trusting it.
    const created = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.invite.create({
        data: {
          email: `invitee-${runId}@example.test`,
          role: "NUTRITIONIST",
          tokenHash: hashToken(randomBytes(32).toString("hex")),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          organizationId: orgB.id,
        },
      })
    );
    expect(created.organizationId).toBe(orgA.id);

    const found = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.invite.findMany({ where: { id: created.id } })
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.organizationId).toBe(orgA.id);
  });

  it("lists only its own org's Invites, none from another organization", async () => {
    // Seeded directly via the owner role so it exists regardless of RLS,
    // representing another organization's pending invite that org A's
    // session must never see.
    await adminDb.invite.create({
      data: {
        email: `other-org-invitee-${runId}@example.test`,
        role: "FRONT_DESK",
        tokenHash: hashToken(randomBytes(32).toString("hex")),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        organizationId: orgB.id,
      },
    });

    const invitesForOrgA = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.invite.findMany()
    );
    expect(invitesForOrgA.length).toBeGreaterThan(0);
    expect(invitesForOrgA.every((invite) => invite.organizationId === orgA.id)).toBe(true);
  });
});
