import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T3.2, closes REQ-014 through REQ-017. Runs against the real local
 * Postgres, same pattern as tests/integration/update-appointment.test.ts.
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

// beforeEach below runs once per test case (this file uses it.each in
// several places), each time creating a fresh org/user/professional/
// patient. Every id is tracked here so afterAll can clean up every test
// case's fixtures, not just whichever one happened to run last -- same
// array-accumulation pattern as tests/integration/register-action.test.ts's
// `createdEmails`. Without this, only the last test's org/user/etc. were
// ever deleted and every earlier test case's rows leaked permanently.
const orgIds: string[] = [];
const userIds: string[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Transition Appointment Org ${runId}`, slug: `transition-appointment-org-${runId}-${Math.random()}` },
  });
  orgIds.push(org.id);
  user = await adminDb.user.create({
    data: { email: `transition-appointment-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Actor" },
  });
  userIds.push(user.id);
  const membership = await adminDb.membership.create({
    data: { userId: user.id, organizationId: org.id, role: "FRONT_DESK" },
  });
  professional = await adminDb.professional.create({
    data: { membershipId: membership.id, organizationId: org.id, licenseNumber: `LIC-${runId}` },
  });
  patient = await adminDb.patient.create({
    data: { organizationId: org.id, fullName: "Transition Patient", phone: "+15551230000" },
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

async function createFixtureAppointment(status: "SCHEDULED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW") {
  // Each fixture gets its own non-overlapping hour slot, far enough apart
  // that the EXCLUDE constraint (scoped to SCHEDULED/CONFIRMED) never
  // rejects two fixtures created in the same test run.
  const startAt = new Date(Date.now() + 1000 * 60 * 60 * Math.random() * 100000);
  return adminDb.appointment.create({
    data: {
      organizationId: org.id,
      patientId: patient.id,
      professionalId: professional.id,
      startAt,
      endAt: new Date(startAt.getTime() + 30 * 60_000),
      status,
    },
  });
}

describe("transitionAppointmentStatusAction allowed transitions", () => {
  it("REQ-014: allows SCHEDULED -> CONFIRMED", async () => {
    const appointment = await createFixtureAppointment("SCHEDULED");
    const result = await transitionAppointmentStatusAction(appointment.id, "SCHEDULED", "CONFIRMED");
    expect(result.success).toBe(true);
    const updated = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updated.status).toBe("CONFIRMED");
  });

  it.each(["SCHEDULED", "CONFIRMED"] as const)("REQ-015: allows %s -> COMPLETED", async (from) => {
    const appointment = await createFixtureAppointment(from);
    const result = await transitionAppointmentStatusAction(appointment.id, from, "COMPLETED");
    expect(result.success).toBe(true);
  });

  it.each(["SCHEDULED", "CONFIRMED"] as const)("REQ-016: allows %s -> CANCELLED", async (from) => {
    const appointment = await createFixtureAppointment(from);
    const result = await transitionAppointmentStatusAction(appointment.id, from, "CANCELLED");
    expect(result.success).toBe(true);
  });

  it.each(["SCHEDULED", "CONFIRMED"] as const)("REQ-016: allows %s -> NO_SHOW", async (from) => {
    const appointment = await createFixtureAppointment(from);
    const result = await transitionAppointmentStatusAction(appointment.id, from, "NO_SHOW");
    expect(result.success).toBe(true);
  });
});

describe("transitionAppointmentStatusAction disallowed transitions (REQ-017)", () => {
  it.each(["COMPLETED", "CANCELLED", "NO_SHOW"] as const)(
    "rejects any transition away from terminal status %s",
    async (from) => {
      const appointment = await createFixtureAppointment(from);
      const result = await transitionAppointmentStatusAction(appointment.id, from, "CONFIRMED");
      expect(result.success).toBe(false);
      const unchanged = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      expect(unchanged.status).toBe(from);
    }
  );

  it("rejects CONFIRMED -> SCHEDULED (not in the allowed table)", async () => {
    const appointment = await createFixtureAppointment("CONFIRMED");
    const result = await transitionAppointmentStatusAction(appointment.id, "CONFIRMED", "SCHEDULED");
    expect(result.success).toBe(false);
  });
});
