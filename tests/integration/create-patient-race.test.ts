import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { adminDb } from "../helpers/admin-db";

/**
 * T3.3, closes REQ-007. Two concurrent `createPatientAction` calls, same
 * organization and `documentId`, raced via `Promise.all` -- same pattern as
 * tests/integration/revoke-accept-race.test.ts. REQ-007 only guarantees
 * exactly one of the two wins (the `@@unique([organizationId, documentId])`
 * constraint from T1.1/REQ-006 is what actually decides which); this
 * asserts the invariant, not which request wins.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));

const { createPatientAction } = await import("@/server/actions/patients");
const { auth } = await import("@/lib/auth");
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

const runId = Date.now();
let org: { id: string };
let user: { id: string };

beforeEach(async () => {
  vi.clearAllMocks();
  org = await adminDb.organization.create({
    data: { name: `Create Patient Race Org ${runId}`, slug: `create-patient-race-org-${runId}-${Math.random()}` },
  });
  user = await adminDb.user.create({
    data: { email: `create-patient-race-${runId}-${Math.random()}@example.test`, passwordHash: "x", name: "Actor" },
  });
  await adminDb.membership.create({ data: { userId: user.id, organizationId: org.id, role: "ADMIN" } });
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

describe("createPatientAction concurrency (REQ-007)", () => {
  it("lets exactly one of two racing creates with the same documentId succeed", async () => {
    const [resultA, resultB] = await Promise.all([
      createPatientAction({ fullName: "Racer A", phone: "+15551110000", documentId: "RACE-001" }),
      createPatientAction({ fullName: "Racer B", phone: "+15552220000", documentId: "RACE-001" }),
    ]);

    // Never both, never neither.
    expect(resultA.success !== resultB.success).toBe(true);

    const loser = resultA.success ? resultB : resultA;
    expect(loser.error).toBeTruthy();

    const patients = await adminDb.patient.findMany({
      where: { organizationId: org.id, documentId: "RACE-001" },
    });
    expect(patients).toHaveLength(1);
  });
});
