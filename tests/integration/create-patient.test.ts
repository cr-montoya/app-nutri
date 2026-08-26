import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T3.2, closes REQ-001, REQ-005, REQ-006, REQ-021. Runs against the real
 * local Postgres so the `(organizationId, documentId)` unique constraint
 * (REQ-006) and the RLS-protected `logAudit()` write are exercised for
 * real, same pattern as tests/integration/register-action.test.ts and
 * tests/integration/revoke-accept-race.test.ts (mocking `@/lib/auth`, not
 * the database).
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.9" })),
}));

const { createPatientAction } = await import("@/server/actions/patients");
const { auth } = await import("@/lib/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const runId = Date.now();
let org: { id: string };
let user: { id: string };

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Create Patient Org ${runId}`, slug: `create-patient-org-${runId}-${Math.random()}` },
  });
  user = await adminDb.user.create({
    data: { email: `create-patient-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Actor" },
  });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: org.id, role: "FRONT_DESK" } });
  mockAuth.mockResolvedValue({ user: { id: user.id }, organizationId: org.id } as Session);
});

afterAll(async () => {
  await adminDb.auditLog.deleteMany({ where: { organizationId: org?.id } });
  await adminDb.patient.deleteMany({ where: { organizationId: org?.id } });
  await adminDb.membership.deleteMany({ where: { organizationId: org?.id } });
  await adminDb.user.deleteMany({ where: { id: user?.id } });
  await adminDb.organization.deleteMany({ where: { id: org?.id } });
  await adminDb.$disconnect();
});

describe("createPatientAction (REQ-001, REQ-021)", () => {
  it("creates a Patient scoped to the caller's organization and logs the action", async () => {
    const result = await createPatientAction({ fullName: "Jane Doe", phone: "+15551234567" });

    expect(result.success).toBe(true);
    expect(result.patientId).toBeTruthy();

    const patient = await adminDb.patient.findUniqueOrThrow({ where: { id: result.patientId } });
    expect(patient.organizationId).toBe(org.id);
    expect(patient.fullName).toBe("Jane Doe");

    const logs = await adminDb.auditLog.findMany({ where: { entityId: patient.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("patient.create");
    expect(logs[0]?.userId).toBe(user.id);
    expect(logs[0]?.organizationId).toBe(org.id);
    expect(logs[0]?.ipAddress).toBe("203.0.113.9");
  });

  it("rejects an unauthenticated call and creates nothing", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await createPatientAction({ fullName: "Nope", phone: "+15551234567" });
    expect(result.success).toBe(false);
    const count = await adminDb.patient.count({ where: { fullName: "Nope" } });
    expect(count).toBe(0);
  });

  it("rejects invalid input before creating any record", async () => {
    const result = await createPatientAction({ fullName: "", phone: "+15551234567" });
    expect(result.success).toBe(false);
    const count = await adminDb.patient.count({ where: { organizationId: org.id } });
    expect(count).toBe(0);
  });
});

describe("createPatientAction documentId uniqueness (REQ-005, REQ-006)", () => {
  it("rejects a second patient with the same documentId in the same organization", async () => {
    const first = await createPatientAction({
      fullName: "First Patient",
      phone: "+15551110000",
      documentId: "DUP-001",
    });
    expect(first.success).toBe(true);

    const second = await createPatientAction({
      fullName: "Second Patient",
      phone: "+15552220000",
      documentId: "DUP-001",
    });
    expect(second.success).toBe(false);
    expect(second.error).toBeTruthy();

    const count = await adminDb.patient.count({ where: { organizationId: org.id, documentId: "DUP-001" } });
    expect(count).toBe(1);
  });

  it("allows two patients with no documentId in the same organization", async () => {
    const first = await createPatientAction({ fullName: "No Doc One", phone: "+15551110001" });
    const second = await createPatientAction({ fullName: "No Doc Two", phone: "+15551110002" });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });

  it("allows the same documentId in a different organization", async () => {
    const otherOrg = await adminDb.organization.create({
      data: { name: `Create Patient Org B ${runId}`, slug: `create-patient-org-b-${runId}-${Math.random()}` },
    });
    const otherUser = await adminDb.user.create({
      data: { email: `create-patient-b-${runId}@example.test`, passwordHash: "x", name: "Actor B" },
    });
    await adminDb.membership.create({
      data: { userId: otherUser.id, organizationId: otherOrg.id, role: "ADMIN" },
    });

    const first = await createPatientAction({
      fullName: "Org A Patient",
      phone: "+15551110003",
      documentId: "SHARED-ID",
    });
    expect(first.success).toBe(true);

    mockAuth.mockResolvedValue({ user: { id: otherUser.id }, organizationId: otherOrg.id } as Session);
    const second = await createPatientAction({
      fullName: "Org B Patient",
      phone: "+15551110004",
      documentId: "SHARED-ID",
    });
    expect(second.success).toBe(true);

    await adminDb.auditLog.deleteMany({ where: { organizationId: otherOrg.id } });
    await adminDb.patient.deleteMany({ where: { organizationId: otherOrg.id } });
    await adminDb.membership.deleteMany({ where: { organizationId: otherOrg.id } });
    await adminDb.user.deleteMany({ where: { id: otherUser.id } });
    await adminDb.organization.deleteMany({ where: { id: otherOrg.id } });
  });
});
