import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { adminDb } from "../helpers/admin-db";

/**
 * Exclusion-constraint race test (T1.7, closes REQ-007): two concurrent
 * creation attempts for the same professional with overlapping
 * [startAt, endAt) ranges. The `no_overlapping_active_appointments`
 * EXCLUDE constraint (T1.3) is a database-level guarantee, so this races
 * two real Postgres transactions via `Promise.allSettled` rather than
 * mocking anything -- exactly one must succeed, the other must fail on the
 * constraint with no partial write, regardless of application-level
 * timing.
 */

const prisma = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
const runId = Date.now();

let org: { id: string };
let userA: { id: string };
let membershipA: { id: string };
let professional: { id: string };
let patient: { id: string };

beforeAll(async () => {
  org = await adminDb.organization.create({
    data: { name: "Exclusion Race Org", slug: `exclusion-race-org-${runId}` },
  });
  userA = await adminDb.user.create({
    data: { email: `exclusion-race-${runId}@example.test`, passwordHash: "x", name: "Actor" },
  });
  membershipA = await adminDb.membership.create({
    data: { userId: userA.id, organizationId: org.id, role: "FRONT_DESK" },
  });
  professional = await adminDb.professional.create({
    data: { membershipId: membershipA.id, organizationId: org.id, licenseNumber: "LIC-RACE" },
  });
  patient = await adminDb.patient.create({
    data: { organizationId: org.id, fullName: "Race Patient", phone: "+15559990000" },
  });
});

afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: org?.id } });
  await adminDb.patient.deleteMany({ where: { organizationId: org?.id } });
  await adminDb.professional.deleteMany({ where: { organizationId: org?.id } });
  await adminDb.membership.deleteMany({ where: { organizationId: org?.id } });
  await adminDb.user.deleteMany({ where: { id: userA?.id } });
  await adminDb.organization.deleteMany({ where: { id: org?.id } });
  await prisma.$disconnect();
  await adminDb.$disconnect();
});

describe("no_overlapping_active_appointments EXCLUDE constraint (REQ-007)", () => {
  it("lets exactly one of two racing, overlapping creates for the same professional succeed", async () => {
    const startAt = new Date("2027-03-01T14:00:00.000Z");
    const endAt = new Date("2027-03-01T14:30:00.000Z");
    const overlappingStartAt = new Date("2027-03-01T14:15:00.000Z");
    const overlappingEndAt = new Date("2027-03-01T14:45:00.000Z");

    const attempt = (start: Date, end: Date) =>
      withTenant({ organizationId: org.id, userId: userA.id }, (tx) =>
        tx.appointment.create({
          data: {
            patientId: patient.id,
            professionalId: professional.id,
            startAt: start,
            endAt: end,
            organizationId: org.id,
          },
        })
      );

    const [resultA, resultB] = await Promise.allSettled([
      attempt(startAt, endAt),
      attempt(overlappingStartAt, overlappingEndAt),
    ]);

    // Never both, never neither.
    const outcomes = [resultA.status, resultB.status];
    expect(outcomes.filter((status) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((status) => status === "rejected")).toHaveLength(1);

    const loser = resultA.status === "rejected" ? resultA : (resultB as PromiseRejectedResult);
    expect(String(loser.reason)).toMatch(/no_overlapping_active_appointments|exclusion/i);

    const appointments = await adminDb.appointment.findMany({
      where: { organizationId: org.id, professionalId: professional.id },
    });
    expect(appointments).toHaveLength(1);
  });

  it("allows a new appointment once the conflicting one is no longer active (CANCELLED)", async () => {
    const startAt = new Date("2027-03-02T09:00:00.000Z");
    const endAt = new Date("2027-03-02T09:30:00.000Z");

    const first = await withTenant({ organizationId: org.id, userId: userA.id }, (tx) =>
      tx.appointment.create({
        data: {
          patientId: patient.id,
          professionalId: professional.id,
          startAt,
          endAt,
          organizationId: org.id,
        },
      })
    );

    await withTenant({ organizationId: org.id, userId: userA.id }, (tx) =>
      tx.appointment.update({ where: { id: first.id }, data: { status: "CANCELLED" } })
    );

    // Same slot, same professional -- allowed now that the prior row is
    // CANCELLED, since the constraint's WHERE clause only covers
    // SCHEDULED/CONFIRMED.
    const second = await withTenant({ organizationId: org.id, userId: userA.id }, (tx) =>
      tx.appointment.create({
        data: {
          patientId: patient.id,
          professionalId: professional.id,
          startAt,
          endAt,
          organizationId: org.id,
        },
      })
    );

    expect(second.id).not.toBe(first.id);
  });
});
