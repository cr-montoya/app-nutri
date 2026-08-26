import type { TenantScopedClient } from "./db";

/**
 * First real implementation of `logAudit()` (design.md's "correction found
 * during this design": `AuditLog` was only ever prose in `plan.md` §4
 * before this spec). Every later phase that needs audit logging
 * (`ClinicalHistory`, `Consultation`, and so on) calls this same helper;
 * it is never reimplemented per-entity.
 *
 * Takes the caller's tenant-scoped Prisma client (`tx`, the same one
 * `withTenant`'s callback already has) rather than opening its own
 * `withTenant` scope: `audit_logs` is RLS-protected (T1.4) exactly like
 * `patients`, so an insert needs `app.current_org_id` set on its own
 * Postgres transaction via `SET LOCAL` -- writing through a *separate*
 * `withTenant` call here would run in a different transaction with no
 * session variable set, and Postgres would reject the insert outright.
 * Calling `logAudit(tx, ...)` from inside the same `withTenant` callback
 * as the mutation it's recording keeps both writes in one transaction, so
 * they succeed or roll back together too.
 */

export interface LogAuditParams {
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  organizationId: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export async function logAudit(tx: TenantScopedClient, params: LogAuditParams): Promise<void> {
  await tx.auditLog.create({
    data: {
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      userId: params.userId,
      organizationId: params.organizationId,
      ipAddress: params.ipAddress,
      metadata: params.metadata,
    },
  });
}
