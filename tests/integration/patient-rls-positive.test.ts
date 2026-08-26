import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { adminDb } from "../helpers/admin-db";

/**
 * Positive RLS test (T1.5, closes REQ-019): a session scoped to org A
 * reads and writes its own Patient and AuditLog rows through `withTenant`.
 * Same pattern as tests/integration/rls-positive.test.ts, against the real
 * local Postgres (standing in for a Neon dev branch) using the
 * non-superuser `appnutri_app` role so RLS actually applies.
 */

const prisma = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
const runId = Date.now();

let orgA: { id: string };
let orgB: { id: string };
let userA: { id: string };

beforeAll(async () => {
  orgA = await prisma.organization.create({
    data: { name: "Patient RLS Positive Org A", slug: `patient-rls-positive-org-a-${runId}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Patient RLS Positive Org B", slug: `patient-rls-positive-org-b-${runId}` },
  });
  userA = await prisma.user.create({
    data: { email: `patient-rls-positive-a-${runId}@example.test`, passwordHash: "x", name: "User A" },
  });
});

afterAll(async () => {
  // Cleanup uses the owner role (bypasses RLS): the app role used for the
  // assertions above can only see rows scoped by `app.current_org_id`,
  // which isn't set outside of a `withTenant` call.
  await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.patient.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.user.deleteMany({ where: { id: userA.id } });
  await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
  await adminDb.$disconnect();
});

describe("withTenant: positive RLS (Patient, AuditLog)", () => {
  it("creates and reads its own Patient, scoped to the caller's organization", async () => {
    // organizationId is a required scalar in Prisma's generated create-input
    // type, so it must be supplied here even inside withTenant; it's set to
    // orgB.id on purpose to prove withTenant's injection overrides whatever
    // the caller passes, rather than trusting it.
    const created = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.patient.create({
        data: { fullName: "Jane Doe", phone: "+15551234567", organizationId: orgB.id },
      })
    );
    expect(created.organizationId).toBe(orgA.id);

    const found = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.patient.findUnique({ where: { id: created.id } })
    );
    expect(found?.id).toBe(created.id);
    expect(found?.organizationId).toBe(orgA.id);
  });

  it("updates its own Patient row through withTenant", async () => {
    const patient = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.patient.create({ data: { fullName: "Update Me", phone: "+15557654321" } })
    );

    const updated = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.patient.update({ where: { id: patient.id }, data: { archivedAt: new Date() } })
    );
    expect(updated.archivedAt).not.toBeNull();
    expect(updated.organizationId).toBe(orgA.id);
  });

  it("creates and reads its own AuditLog, scoped to the caller's organization", async () => {
    const patient = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.patient.create({ data: { fullName: "Audited Patient", phone: "+15551112222" } })
    );

    const createdLog = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.auditLog.create({
        data: {
          action: "patient.create",
          entityType: "Patient",
          entityId: patient.id,
          userId: userA.id,
          organizationId: orgB.id, // same override-proof check as above
        },
      })
    );
    expect(createdLog.organizationId).toBe(orgA.id);

    const foundLogs = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.auditLog.findMany({ where: { entityId: patient.id } })
    );
    expect(foundLogs).toHaveLength(1);
    expect(foundLogs[0]?.organizationId).toBe(orgA.id);
  });
});
