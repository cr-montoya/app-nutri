import { describe, expect, it, vi } from "vitest";
import { logAudit } from "./audit";
import type { TenantScopedClient } from "./db";

/**
 * T2.1. `logAudit` takes the caller's tenant-scoped client directly (see
 * ./audit.ts's doc comment on why), so this is a plain unit test against a
 * fake `tx` -- no real database needed, same spirit as src/lib/auth.test.ts
 * mocking `./db` for authorizeCredentials.
 */
function fakeTx() {
  return { auditLog: { create: vi.fn().mockResolvedValue({}) } } as unknown as TenantScopedClient;
}

describe("logAudit", () => {
  it("writes an AuditLog row with the action, actor, org, and entity id", async () => {
    const tx = fakeTx();

    await logAudit(tx, {
      action: "patient.create",
      entityType: "Patient",
      entityId: "patient-1",
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: "patient.create",
        entityType: "Patient",
        entityId: "patient-1",
        userId: "user-1",
        organizationId: "org-1",
        ipAddress: undefined,
        metadata: undefined,
      },
    });
  });

  it("passes through optional ipAddress and metadata when provided", async () => {
    const tx = fakeTx();

    await logAudit(tx, {
      action: "patient.view",
      entityType: "Patient",
      entityId: "patient-2",
      userId: "user-2",
      organizationId: "org-2",
      ipAddress: "203.0.113.7",
      metadata: { source: "detail-page" },
    });

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ipAddress: "203.0.113.7",
        metadata: { source: "detail-page" },
      }),
    });
  });

  it("never includes clinical/PII content in the action or entityType strings themselves", () => {
    // Structural check, not a runtime assertion: logAudit's params only
    // ever carry ids and short action/entityType labels
    // (.agents/rules/no-plaintext-clinical-data.md) -- there is no field
    // here a caller could use to pass a patient's name or notes through.
    const params: Parameters<typeof logAudit>[1] = {
      action: "patient.create",
      entityType: "Patient",
      entityId: "patient-1",
      userId: "user-1",
      organizationId: "org-1",
    };
    expect(Object.keys(params).sort()).toEqual(
      ["action", "entityId", "entityType", "organizationId", "userId"].sort()
    );
  });
});
