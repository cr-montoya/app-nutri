import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T3.4, closes REQ-012, REQ-021. Same pattern as
 * tests/integration/create-patient.test.ts.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));

const { updatePatientAction } = await import("@/server/actions/patients");
const { auth } = await import("@/lib/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const runId = Date.now();
let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Update Patient Org ${runId}`, slug: `update-patient-org-${runId}-${Math.random()}` },
  });
  otherOrg = await adminDb.organization.create({
    data: { name: `Update Patient Org B ${runId}`, slug: `update-patient-org-b-${runId}-${Math.random()}` },
  });
  user = await adminDb.user.create({
    data: { email: `update-patient-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Actor" },
  });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: org.id, role: "NUTRITIONIST" } });
  mockAuth.mockResolvedValue({ user: { id: user.id }, organizationId: org.id } as Session);
});

afterAll(async () => {
  await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [org?.id, otherOrg?.id] } } });
  await adminDb.patient.deleteMany({ where: { organizationId: { in: [org?.id, otherOrg?.id] } } });
  await adminDb.membership.deleteMany({ where: { organizationId: org?.id } });
  await adminDb.user.deleteMany({ where: { id: user?.id } });
  await adminDb.organization.deleteMany({ where: { id: { in: [org?.id, otherOrg?.id] } } });
  await adminDb.$disconnect();
});

describe("updatePatientAction (REQ-012, REQ-021)", () => {
  it("updates the patient's fields and logs the action", async () => {
    const patient = await adminDb.patient.create({
      data: { organizationId: org.id, fullName: "Before", phone: "+15550000000" },
    });

    const result = await updatePatientAction(patient.id, {
      fullName: "After",
      phone: "+15551111111",
      email: "after@example.test",
    });
    expect(result.success).toBe(true);

    const updated = await adminDb.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(updated.fullName).toBe("After");
    expect(updated.phone).toBe("+15551111111");
    expect(updated.email).toBe("after@example.test");

    const logs = await adminDb.auditLog.findMany({ where: { entityId: patient.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("patient.update");
  });

  it("clears an optional field when it's submitted blank", async () => {
    const patient = await adminDb.patient.create({
      data: { organizationId: org.id, fullName: "Has Email", phone: "+15550000001", email: "old@example.test" },
    });

    const result = await updatePatientAction(patient.id, {
      fullName: "Has Email",
      phone: "+15550000001",
      email: "",
    });
    expect(result.success).toBe(true);

    const updated = await adminDb.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(updated.email).toBeNull();
  });

  it("rejects invalid input and leaves the record unchanged", async () => {
    const patient = await adminDb.patient.create({
      data: { organizationId: org.id, fullName: "Untouched", phone: "+15550000002" },
    });

    const result = await updatePatientAction(patient.id, { fullName: "", phone: "+15550000002" });
    expect(result.success).toBe(false);

    const unchanged = await adminDb.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(unchanged.fullName).toBe("Untouched");

    const logs = await adminDb.auditLog.findMany({ where: { entityId: patient.id } });
    expect(logs).toHaveLength(0);
  });

  it("cannot update a patient belonging to a different organization", async () => {
    const foreignPatient = await adminDb.patient.create({
      data: { organizationId: otherOrg.id, fullName: "Foreign", phone: "+15550000003" },
    });

    const result = await updatePatientAction(foreignPatient.id, {
      fullName: "Hijacked",
      phone: "+15550000003",
    });
    expect(result.success).toBe(false);

    const unchanged = await adminDb.patient.findUniqueOrThrow({ where: { id: foreignPatient.id } });
    expect(unchanged.fullName).toBe("Foreign");
  });
});
