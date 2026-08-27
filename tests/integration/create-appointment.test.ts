import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T2.2, closes REQ-001, REQ-006, REQ-008. Runs against the real local
 * Postgres so the `no_overlapping_active_appointments` EXCLUDE constraint
 * (REQ-006) and the tenant-scoped patient/professional lookups (REQ-008)
 * are exercised for real, same pattern as
 * tests/integration/create-patient.test.ts.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { createAppointmentAction } = await import("@/server/actions/appointments");
const { auth } = await import("@/lib/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const runId = Date.now();
let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };
let professional: { id: string };
let otherOrgProfessional: { id: string };
let patient: { id: string };
let otherOrgPatient: { id: string };
let otherUser: { id: string };

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Create Appointment Org ${runId}`, slug: `create-appointment-org-${runId}-${Math.random()}` },
  });
  otherOrg = await adminDb.organization.create({
    data: { name: `Create Appointment Org B ${runId}`, slug: `create-appointment-org-b-${runId}-${Math.random()}` },
  });
  user = await adminDb.user.create({
    data: { email: `create-appointment-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Actor" },
  });
  const membership = await adminDb.membership.create({
    data: { userId: user.id, organizationId: org.id, role: "FRONT_DESK" },
  });
  professional = await adminDb.professional.create({
    data: { membershipId: membership.id, organizationId: org.id, licenseNumber: `LIC-${runId}` },
  });
  patient = await adminDb.patient.create({
    data: { organizationId: org.id, fullName: "Create Appointment Patient", phone: "+15551230000" },
  });

  otherUser = await adminDb.user.create({
    data: { email: `create-appointment-other-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Other Actor" },
  });
  const otherMembership = await adminDb.membership.create({
    data: { userId: otherUser.id, organizationId: otherOrg.id, role: "FRONT_DESK" },
  });
  otherOrgProfessional = await adminDb.professional.create({
    data: { membershipId: otherMembership.id, organizationId: otherOrg.id, licenseNumber: `LIC-B-${runId}` },
  });
  otherOrgPatient = await adminDb.patient.create({
    data: { organizationId: otherOrg.id, fullName: "Other Org Patient", phone: "+15559990000" },
  });

  mockAuth.mockResolvedValue({ user: { id: user.id }, organizationId: org.id } as Session);
});

afterAll(async () => {
  await adminDb.appointment.deleteMany({ where: { organizationId: { in: [org?.id, otherOrg?.id] } } });
  await adminDb.patient.deleteMany({ where: { organizationId: { in: [org?.id, otherOrg?.id] } } });
  await adminDb.professional.deleteMany({ where: { organizationId: { in: [org?.id, otherOrg?.id] } } });
  await adminDb.membership.deleteMany({ where: { organizationId: { in: [org?.id, otherOrg?.id] } } });
  await adminDb.user.deleteMany({ where: { id: { in: [user?.id, otherUser?.id] } } });
  await adminDb.organization.deleteMany({ where: { id: { in: [org?.id, otherOrg?.id] } } });
  await adminDb.$disconnect();
});

describe("createAppointmentAction (REQ-001)", () => {
  it("creates an Appointment with status SCHEDULED, scoped to the caller's organization", async () => {
    const result = await createAppointmentAction({
      patientId: patient.id,
      professionalId: professional.id,
      date: "2027-06-15",
      time: "14:00",
    });

    expect(result.success).toBe(true);
    expect(result.appointmentId).toBeTruthy();

    const appointment = await adminDb.appointment.findUniqueOrThrow({
      where: { id: result.appointmentId },
    });
    expect(appointment.organizationId).toBe(org.id);
    expect(appointment.status).toBe("SCHEDULED");
    expect(appointment.startAt.toISOString()).toBe("2027-06-15T19:00:00.000Z");
    expect(appointment.endAt.toISOString()).toBe("2027-06-15T19:30:00.000Z");
  });

  it("rejects an unauthenticated call and creates nothing", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await createAppointmentAction({
      patientId: patient.id,
      professionalId: professional.id,
      date: "2027-06-15",
      time: "14:00",
    });
    expect(result.success).toBe(false);
    const count = await adminDb.appointment.count({ where: { organizationId: org.id } });
    expect(count).toBe(0);
  });

  it("rejects invalid input before creating any record", async () => {
    const result = await createAppointmentAction({
      patientId: patient.id,
      professionalId: professional.id,
      date: "2027-06-15",
      time: "14:00",
      durationMinutes: "3",
    });
    expect(result.success).toBe(false);
    const count = await adminDb.appointment.count({ where: { organizationId: org.id } });
    expect(count).toBe(0);
  });
});

describe("createAppointmentAction cross-tenant rejection (REQ-008)", () => {
  it("rejects a patient belonging to a different organization", async () => {
    const result = await createAppointmentAction({
      patientId: otherOrgPatient.id,
      professionalId: professional.id,
      date: "2027-06-15",
      time: "14:00",
    });
    expect(result.success).toBe(false);
    const count = await adminDb.appointment.count({ where: { organizationId: org.id } });
    expect(count).toBe(0);
  });

  it("rejects a professional belonging to a different organization", async () => {
    const result = await createAppointmentAction({
      patientId: patient.id,
      professionalId: otherOrgProfessional.id,
      date: "2027-06-15",
      time: "14:00",
    });
    expect(result.success).toBe(false);
    const count = await adminDb.appointment.count({ where: { organizationId: org.id } });
    expect(count).toBe(0);
  });
});

describe("createAppointmentAction double-booking rejection (REQ-006)", () => {
  it("rejects a second appointment overlapping the same professional's existing slot", async () => {
    const first = await createAppointmentAction({
      patientId: patient.id,
      professionalId: professional.id,
      date: "2027-06-16",
      time: "09:00",
      durationMinutes: "60",
    });
    expect(first.success).toBe(true);

    const second = await createAppointmentAction({
      patientId: patient.id,
      professionalId: professional.id,
      date: "2027-06-16",
      time: "09:30",
      durationMinutes: "30",
    });
    expect(second.success).toBe(false);
    expect(second.error).toBeTruthy();

    const count = await adminDb.appointment.count({
      where: { organizationId: org.id, professionalId: professional.id },
    });
    expect(count).toBe(1);
  });

  it("allows a non-overlapping appointment for the same professional", async () => {
    const first = await createAppointmentAction({
      patientId: patient.id,
      professionalId: professional.id,
      date: "2027-06-17",
      time: "09:00",
      durationMinutes: "30",
    });
    expect(first.success).toBe(true);

    const second = await createAppointmentAction({
      patientId: patient.id,
      professionalId: professional.id,
      date: "2027-06-17",
      time: "10:00",
      durationMinutes: "30",
    });
    expect(second.success).toBe(true);
  });
});
