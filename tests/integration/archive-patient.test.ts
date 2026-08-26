import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T3.5, closes REQ-013, REQ-014, REQ-021.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));

const { archivePatientAction, unarchivePatientAction } = await import("@/server/actions/patients");
const { auth } = await import("@/lib/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const runId = Date.now();
let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Archive Patient Org ${runId}`, slug: `archive-patient-org-${runId}-${Math.random()}` },
  });
  otherOrg = await adminDb.organization.create({
    data: { name: `Archive Patient Org B ${runId}`, slug: `archive-patient-org-b-${runId}-${Math.random()}` },
  });
  user = await adminDb.user.create({
    data: { email: `archive-patient-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Actor" },
  });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: org.id, role: "FRONT_DESK" } });
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

describe("archivePatientAction (REQ-013, REQ-021)", () => {
  it("sets archivedAt and logs the action", async () => {
    const patient = await adminDb.patient.create({
      data: { organizationId: org.id, fullName: "To Archive", phone: "+15550000010" },
    });

    const result = await archivePatientAction(patient.id);
    expect(result.success).toBe(true);

    const archived = await adminDb.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(archived.archivedAt).not.toBeNull();

    const logs = await adminDb.auditLog.findMany({ where: { entityId: patient.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("patient.archive");
  });

  it("cannot archive a patient belonging to a different organization", async () => {
    const foreign = await adminDb.patient.create({
      data: { organizationId: otherOrg.id, fullName: "Foreign", phone: "+15550000011" },
    });

    const result = await archivePatientAction(foreign.id);
    expect(result.success).toBe(false);

    const unchanged = await adminDb.patient.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(unchanged.archivedAt).toBeNull();
  });
});

describe("unarchivePatientAction (REQ-014, REQ-021)", () => {
  it("clears archivedAt and logs the action", async () => {
    const patient = await adminDb.patient.create({
      data: {
        organizationId: org.id,
        fullName: "To Unarchive",
        phone: "+15550000012",
        archivedAt: new Date(),
      },
    });

    const result = await unarchivePatientAction(patient.id);
    expect(result.success).toBe(true);

    const unarchived = await adminDb.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(unarchived.archivedAt).toBeNull();

    const logs = await adminDb.auditLog.findMany({ where: { entityId: patient.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("patient.unarchive");
  });
});
