import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T4.1, closes REQ-019. Runs against the real local Postgres, same
 * pattern as tests/integration/create-appointment.test.ts.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { getAppointmentsForRangeAction } = await import("@/server/actions/appointments");
const { auth } = await import("@/lib/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const runId = Date.now();
let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };
let professionalA: { id: string };
let professionalB: { id: string };
let patient: { id: string };

// beforeEach below runs once per test case, each time creating a fresh
// org/otherOrg/user/userB. Every id is tracked here so afterAll can clean
// up every test case's fixtures, not just whichever one happened to run
// last -- same array-accumulation pattern as
// tests/integration/update-appointment.test.ts. Without this, only the
// last test's org/otherOrg/etc. were ever deleted and every earlier test
// case's rows leaked permanently. The inline `otherUser` created in the
// "never returns another organization's appointments" test is pushed into
// userIds too, since (unlike update-appointment.test.ts's self-cleaning
// otherOrgUser) it isn't deleted inline within that test.
const orgIds: string[] = [];
const userIds: string[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Range Query Org ${runId}`, slug: `range-query-org-${runId}-${Math.random()}` },
  });
  orgIds.push(org.id);
  otherOrg = await adminDb.organization.create({
    data: { name: `Range Query Org B ${runId}`, slug: `range-query-org-b-${runId}-${Math.random()}` },
  });
  orgIds.push(otherOrg.id);
  user = await adminDb.user.create({
    data: { email: `range-query-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Actor" },
  });
  userIds.push(user.id);
  const membershipA = await adminDb.membership.create({
    data: { userId: user.id, organizationId: org.id, role: "FRONT_DESK" },
  });
  professionalA = await adminDb.professional.create({
    data: { membershipId: membershipA.id, organizationId: org.id, licenseNumber: `LIC-A-${runId}` },
  });
  const userB = await adminDb.user.create({
    data: { email: `range-query-b-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Actor B" },
  });
  userIds.push(userB.id);
  const membershipB = await adminDb.membership.create({
    data: { userId: userB.id, organizationId: org.id, role: "NUTRITIONIST" },
  });
  professionalB = await adminDb.professional.create({
    data: { membershipId: membershipB.id, organizationId: org.id, licenseNumber: `LIC-B-${runId}` },
  });
  patient = await adminDb.patient.create({
    data: { organizationId: org.id, fullName: "Range Query Patient", phone: "+15551230000" },
  });

  mockAuth.mockResolvedValue({ user: { id: user.id }, organizationId: org.id } as Session);
});

afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: { in: orgIds } } });
  await adminDb.patient.deleteMany({ where: { organizationId: { in: orgIds } } });
  await adminDb.professional.deleteMany({ where: { organizationId: { in: orgIds } } });
  await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
  await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
  await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  await adminDb.$disconnect();
});

describe("getAppointmentsForRangeAction (REQ-019)", () => {
  it("returns appointments overlapping the range, across professionals, scoped to the org", async () => {
    await adminDb.appointment.create({
      data: {
        organizationId: org.id,
        patientId: patient.id,
        professionalId: professionalA.id,
        startAt: new Date("2027-09-01T13:00:00.000Z"),
        endAt: new Date("2027-09-01T13:30:00.000Z"),
      },
    });
    await adminDb.appointment.create({
      data: {
        organizationId: org.id,
        patientId: patient.id,
        professionalId: professionalB.id,
        startAt: new Date("2027-09-01T15:00:00.000Z"),
        endAt: new Date("2027-09-01T15:30:00.000Z"),
      },
    });
    // Outside the queried range entirely.
    await adminDb.appointment.create({
      data: {
        organizationId: org.id,
        patientId: patient.id,
        professionalId: professionalA.id,
        startAt: new Date("2027-09-05T13:00:00.000Z"),
        endAt: new Date("2027-09-05T13:30:00.000Z"),
      },
    });

    const result = await getAppointmentsForRangeAction(
      "2027-09-01T00:00:00.000Z",
      "2027-09-02T00:00:00.000Z"
    );

    expect(result.success).toBe(true);
    expect(result.appointments).toHaveLength(2);
    const professionalIds = result.appointments!.map((a) => a.professionalId).sort();
    expect(professionalIds).toEqual([professionalA.id, professionalB.id].sort());
  });

  it("never returns another organization's appointments", async () => {
    const otherUser = await adminDb.user.create({
      data: { email: `range-query-other-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Other" },
    });
    userIds.push(otherUser.id);
    const otherMembership = await adminDb.membership.create({
      data: { userId: otherUser.id, organizationId: otherOrg.id, role: "ADMIN" },
    });
    const otherProfessional = await adminDb.professional.create({
      data: { membershipId: otherMembership.id, organizationId: otherOrg.id, licenseNumber: "LIC-OTHER" },
    });
    const otherPatient = await adminDb.patient.create({
      data: { organizationId: otherOrg.id, fullName: "Other Org Patient", phone: "+15559990000" },
    });
    await adminDb.appointment.create({
      data: {
        organizationId: otherOrg.id,
        patientId: otherPatient.id,
        professionalId: otherProfessional.id,
        startAt: new Date("2027-09-01T13:00:00.000Z"),
        endAt: new Date("2027-09-01T13:30:00.000Z"),
      },
    });

    const result = await getAppointmentsForRangeAction(
      "2027-09-01T00:00:00.000Z",
      "2027-09-02T00:00:00.000Z"
    );

    expect(result.success).toBe(true);
    expect(result.appointments).toHaveLength(0);
  });

  it("returns an empty list for a range with zero appointments", async () => {
    const result = await getAppointmentsForRangeAction(
      "2030-01-01T00:00:00.000Z",
      "2030-01-02T00:00:00.000Z"
    );
    expect(result.success).toBe(true);
    expect(result.appointments).toEqual([]);
  });
});
