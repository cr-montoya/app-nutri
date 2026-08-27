import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T3.3, closes REQ-018. Two concurrent status-transition requests for the
 * same Appointment, both expecting the same current status, raced via
 * `Promise.all` -- same pattern as
 * tests/integration/create-patient-race.test.ts. Exactly one must
 * succeed; the loser must report the status already changed rather than
 * silently overwriting it, per the conditional `updateMany` in
 * `transitionAppointmentStatusAction`.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { transitionAppointmentStatusAction } = await import("@/server/actions/appointments");
const { auth } = await import("@/lib/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const runId = Date.now();
let org: { id: string };
let user: { id: string };
let professional: { id: string };
let patient: { id: string };

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Transition Race Org ${runId}`, slug: `transition-race-org-${runId}-${Math.random()}` },
  });
  user = await adminDb.user.create({
    data: { email: `transition-race-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Actor" },
  });
  const membership = await adminDb.membership.create({
    data: { userId: user.id, organizationId: org.id, role: "FRONT_DESK" },
  });
  professional = await adminDb.professional.create({
    data: { membershipId: membership.id, organizationId: org.id, licenseNumber: `LIC-${runId}` },
  });
  patient = await adminDb.patient.create({
    data: { organizationId: org.id, fullName: "Transition Race Patient", phone: "+15551230000" },
  });

  mockAuth.mockResolvedValue({ user: { id: user.id }, organizationId: org.id } as Session);
});

afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: org?.id } });
  await adminDb.patient.deleteMany({ where: { organizationId: org?.id } });
  await adminDb.professional.deleteMany({ where: { organizationId: org?.id } });
  await adminDb.membership.deleteMany({ where: { organizationId: org?.id } });
  await adminDb.organization.deleteMany({ where: { id: org?.id } });
  await adminDb.$disconnect();
});

describe("transitionAppointmentStatusAction concurrency (REQ-018)", () => {
  it("lets exactly one of two racing transitions from the same expected status succeed", async () => {
    const appointment = await adminDb.appointment.create({
      data: {
        organizationId: org.id,
        patientId: patient.id,
        professionalId: professional.id,
        startAt: new Date("2027-08-01T14:00:00.000Z"),
        endAt: new Date("2027-08-01T14:30:00.000Z"),
        status: "SCHEDULED",
      },
    });

    const [resultA, resultB] = await Promise.all([
      transitionAppointmentStatusAction(appointment.id, "SCHEDULED", "CONFIRMED"),
      transitionAppointmentStatusAction(appointment.id, "SCHEDULED", "CANCELLED"),
    ]);

    // Never both, never neither.
    expect(resultA.success !== resultB.success).toBe(true);

    const loser = resultA.success ? resultB : resultA;
    expect(loser.error).toBeTruthy();

    const final = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(["CONFIRMED", "CANCELLED"]).toContain(final.status);
  });
});
