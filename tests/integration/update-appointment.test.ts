import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T3.1, closes REQ-011, REQ-012. Runs against the real local Postgres, same
 * pattern as tests/integration/create-appointment.test.ts.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// updateAppointmentAction's revalidatePath call requires a real Next.js
// request/render scope that doesn't exist when calling the action directly
// in a Vitest test -- mocked the same way tests/integration/archive-patient.test.ts does.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateAppointmentAction } = await import("@/server/actions/appointments");
const { auth } = await import("@/lib/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const runId = Date.now();
let org: { id: string };
let user: { id: string };
let professional: { id: string };
let otherProfessional: { id: string };
let patient: { id: string };

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Update Appointment Org ${runId}`, slug: `update-appointment-org-${runId}-${Math.random()}` },
  });
  user = await adminDb.user.create({
    data: { email: `update-appointment-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Actor" },
  });
  const membership = await adminDb.membership.create({
    data: { userId: user.id, organizationId: org.id, role: "FRONT_DESK" },
  });
  professional = await adminDb.professional.create({
    data: { membershipId: membership.id, organizationId: org.id, licenseNumber: `LIC-${runId}` },
  });
  const otherUser = await adminDb.user.create({
    data: { email: `update-appointment-other-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Other" },
  });
  const otherMembership = await adminDb.membership.create({
    data: { userId: otherUser.id, organizationId: org.id, role: "NUTRITIONIST" },
  });
  otherProfessional = await adminDb.professional.create({
    data: { membershipId: otherMembership.id, organizationId: org.id, licenseNumber: `LIC-B-${runId}` },
  });
  patient = await adminDb.patient.create({
    data: { organizationId: org.id, fullName: "Update Appointment Patient", phone: "+15551230000" },
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

async function createFixtureAppointment(overrides?: Partial<{ status: "SCHEDULED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"; startAt: Date; endAt: Date; professionalId: string }>) {
  return adminDb.appointment.create({
    data: {
      organizationId: org.id,
      patientId: patient.id,
      professionalId: overrides?.professionalId ?? professional.id,
      startAt: overrides?.startAt ?? new Date("2027-07-01T14:00:00.000Z"),
      endAt: overrides?.endAt ?? new Date("2027-07-01T14:30:00.000Z"),
      status: overrides?.status ?? "SCHEDULED",
    },
  });
}

describe("updateAppointmentAction (REQ-011)", () => {
  it("updates date/time, professional, reason, and notes together", async () => {
    const appointment = await createFixtureAppointment();

    const result = await updateAppointmentAction(appointment.id, {
      professionalId: otherProfessional.id,
      date: "2027-07-02",
      time: "10:00",
      durationMinutes: "45",
      reason: "Follow-up",
      notes: "Bring lab results",
    });

    expect(result.success).toBe(true);

    const updated = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updated.professionalId).toBe(otherProfessional.id);
    expect(updated.startAt.toISOString()).toBe("2027-07-02T15:00:00.000Z");
    expect(updated.endAt.toISOString()).toBe("2027-07-02T15:45:00.000Z");
    expect(updated.reason).toBe("Follow-up");
    expect(updated.notes).toBe("Bring lab results");
  });

  it("never changes the patient (not accepted as input at all)", async () => {
    const appointment = await createFixtureAppointment();

    await updateAppointmentAction(appointment.id, {
      professionalId: professional.id,
      date: "2027-07-03",
      time: "10:00",
    });

    const updated = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updated.patientId).toBe(patient.id);
  });

  it("rejects invalid input before changing the record", async () => {
    const appointment = await createFixtureAppointment();

    const result = await updateAppointmentAction(appointment.id, {
      professionalId: professional.id,
      date: "2027-07-03",
      time: "10:00",
      durationMinutes: "9999",
    });

    expect(result.success).toBe(false);
    const unchanged = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(unchanged.startAt.toISOString()).toBe("2027-07-01T14:00:00.000Z");
  });

  it("rejects a professional belonging to a different organization", async () => {
    const otherOrg = await adminDb.organization.create({
      data: { name: `Update Appointment Org B ${runId}`, slug: `update-appointment-org-b-${runId}-${Math.random()}` },
    });
    const otherOrgUser = await adminDb.user.create({
      data: { email: `update-appointment-org-b-${runId}@example.test`, passwordHash: "x", name: "Org B User" },
    });
    const otherOrgMembership = await adminDb.membership.create({
      data: { userId: otherOrgUser.id, organizationId: otherOrg.id, role: "ADMIN" },
    });
    const otherOrgProfessional = await adminDb.professional.create({
      data: { membershipId: otherOrgMembership.id, organizationId: otherOrg.id, licenseNumber: "LIC-FOREIGN" },
    });

    const appointment = await createFixtureAppointment();
    const result = await updateAppointmentAction(appointment.id, {
      professionalId: otherOrgProfessional.id,
      date: "2027-07-03",
      time: "10:00",
    });
    expect(result.success).toBe(false);

    await adminDb.professional.deleteMany({ where: { organizationId: otherOrg.id } });
    await adminDb.membership.deleteMany({ where: { organizationId: otherOrg.id } });
    await adminDb.user.deleteMany({ where: { id: otherOrgUser.id } });
    await adminDb.organization.deleteMany({ where: { id: otherOrg.id } });
  });
});

describe("updateAppointmentAction status precondition (REQ-012)", () => {
  it.each(["COMPLETED", "CANCELLED", "NO_SHOW"] as const)(
    "rejects rescheduling an appointment in status %s",
    async (status) => {
      const appointment = await createFixtureAppointment({ status });

      const result = await updateAppointmentAction(appointment.id, {
        professionalId: professional.id,
        date: "2027-07-05",
        time: "10:00",
      });

      expect(result.success).toBe(false);
      const unchanged = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      expect(unchanged.startAt.toISOString()).toBe("2027-07-01T14:00:00.000Z");
    }
  );

  it.each(["SCHEDULED", "CONFIRMED"] as const)("allows rescheduling an appointment in status %s", async (status) => {
    const appointment = await createFixtureAppointment({ status });

    const result = await updateAppointmentAction(appointment.id, {
      professionalId: professional.id,
      date: "2027-07-06",
      time: "10:00",
    });

    expect(result.success).toBe(true);
  });
});

describe("updateAppointmentAction double-booking rejection (REQ-006)", () => {
  it("rejects a reschedule that overlaps another active appointment for the same professional", async () => {
    await createFixtureAppointment({
      startAt: new Date("2027-07-10T09:00:00.000Z"),
      endAt: new Date("2027-07-10T09:30:00.000Z"),
    });
    const toReschedule = await createFixtureAppointment({
      startAt: new Date("2027-07-10T12:00:00.000Z"),
      endAt: new Date("2027-07-10T12:30:00.000Z"),
    });

    // The existing fixture appointment is 09:00-09:30 UTC; America/Bogota
    // is UTC-5, so 04:15 Bogota == 09:15 UTC, inside that window.
    const result = await updateAppointmentAction(toReschedule.id, {
      professionalId: professional.id,
      date: "2027-07-10",
      time: "04:15",
      durationMinutes: "30",
    });

    expect(result.success).toBe(false);
  });

  it("never conflicts with its own current slot (a no-op reschedule succeeds)", async () => {
    const appointment = await createFixtureAppointment({
      startAt: new Date("2027-07-11T09:00:00.000Z"),
      endAt: new Date("2027-07-11T09:30:00.000Z"),
    });

    const result = await updateAppointmentAction(appointment.id, {
      professionalId: professional.id,
      date: "2027-07-11",
      time: "04:00",
      durationMinutes: "30",
      reason: "unchanged slot, changed reason",
    });

    expect(result.success).toBe(true);
  });
});
