import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { adminDb } from "../helpers/admin-db";

/**
 * Positive RLS test (T1.5, closes REQ-021): a session scoped to org A
 * reads and writes its own Appointment rows through `withTenant`. Same
 * pattern as tests/integration/patient-rls-positive.test.ts, against the
 * real local Postgres (standing in for a Neon dev branch) using the
 * non-superuser `appnutri_app` role so RLS actually applies.
 */

const prisma = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
const runId = Date.now();

let orgA: { id: string };
let orgB: { id: string };
let userA: { id: string };
let membershipA: { id: string };
let professionalA: { id: string };
let patientA: { id: string };

beforeAll(async () => {
  orgA = await adminDb.organization.create({
    data: { name: "Appointment RLS Positive Org A", slug: `appointment-rls-positive-org-a-${runId}` },
  });
  orgB = await adminDb.organization.create({
    data: { name: "Appointment RLS Positive Org B", slug: `appointment-rls-positive-org-b-${runId}` },
  });
  userA = await adminDb.user.create({
    data: { email: `appointment-rls-positive-a-${runId}@example.test`, passwordHash: "x", name: "User A" },
  });
  membershipA = await adminDb.membership.create({
    data: { userId: userA.id, organizationId: orgA.id, role: "NUTRITIONIST" },
  });
  professionalA = await adminDb.professional.create({
    data: { membershipId: membershipA.id, organizationId: orgA.id, licenseNumber: "LIC-POS-A" },
  });
  patientA = await adminDb.patient.create({
    data: { organizationId: orgA.id, fullName: "Positive RLS Patient", phone: "+15551230000" },
  });
});

afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.patient.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.professional.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.user.deleteMany({ where: { id: userA.id } });
  await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
  await adminDb.$disconnect();
});

describe("withTenant: positive RLS (Appointment)", () => {
  it("creates and reads its own Appointment, scoped to the caller's organization", async () => {
    const startAt = new Date("2027-01-10T14:00:00.000Z");
    const endAt = new Date("2027-01-10T14:30:00.000Z");

    // organizationId is a required scalar in Prisma's generated create-input
    // type, so it must be supplied here even inside withTenant; it's set to
    // orgB.id on purpose to prove withTenant's injection overrides whatever
    // the caller passes, rather than trusting it.
    const created = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.appointment.create({
        data: {
          patientId: patientA.id,
          professionalId: professionalA.id,
          startAt,
          endAt,
          organizationId: orgB.id,
        },
      })
    );
    expect(created.organizationId).toBe(orgA.id);

    const found = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.appointment.findUnique({ where: { id: created.id } })
    );
    expect(found?.id).toBe(created.id);
    expect(found?.organizationId).toBe(orgA.id);
  });

  it("updates its own Appointment row through withTenant", async () => {
    const appointment = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.appointment.create({
        data: {
          patientId: patientA.id,
          professionalId: professionalA.id,
          startAt: new Date("2027-01-11T14:00:00.000Z"),
          endAt: new Date("2027-01-11T14:30:00.000Z"),
          organizationId: orgA.id,
        },
      })
    );

    const updated = await withTenant({ organizationId: orgA.id, userId: userA.id }, (tx) =>
      tx.appointment.update({ where: { id: appointment.id }, data: { status: "CONFIRMED" } })
    );
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.organizationId).toBe(orgA.id);
  });
});
