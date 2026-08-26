import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";

/**
 * Tenant-context Prisma Client Extension + `withTenant` wrapper.
 *
 * Primary layer of the two-layer multi-tenant isolation model
 * (.kiro/steering/structure.md, plan.md §3). Postgres Row-Level Security
 * is the defense-in-depth second layer (prisma/migrations, RLS policies on
 * `memberships` and `professionals`).
 *
 * Every read/write on a tenant-scoped model must go through `withTenant`;
 * see .agents/rules/tenant-isolation.md. Querying a tenant-scoped model
 * outside `withTenant` throws instead of silently running unscoped.
 */

export interface TenantContext {
  organizationId: string;
  userId: string;
}

/**
 * Models that carry an `organizationId` column and must never be queried
 * without a tenant scope. `Organization` and `User` are intentionally
 * excluded: a `User` is a global login identity looked up by email before
 * any org context exists, and an `Organization` is the tenant itself.
 */
const TENANT_SCOPED_MODELS = new Set(["Membership", "Professional"]);

const tenantStorage = new AsyncLocalStorage<TenantContext>();

const OPERATIONS_WITH_WHERE = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "delete",
  "deleteMany",
  "update",
  "updateMany",
]);

type QueryArgs = Record<string, unknown>;

/**
 * Pure injection logic, exported for unit testing without a database
 * connection (see src/lib/db.test.ts). This is what makes it structurally
 * hard to forget the `organizationId` filter in a new Server Action: any
 * query on a tenant-scoped model gets it merged in here, not left to the
 * caller to remember.
 */
function withoutOrganizationId(data: QueryArgs | undefined): QueryArgs {
  const rest = { ...(data ?? {}) };
  delete rest.organizationId;
  return rest;
}

export function applyTenantScope(
  operation: string,
  args: QueryArgs | undefined,
  organizationId: string
): QueryArgs {
  const nextArgs: QueryArgs = { ...(args ?? {}) };

  if (OPERATIONS_WITH_WHERE.has(operation)) {
    nextArgs.where = {
      ...((nextArgs.where as QueryArgs | undefined) ?? {}),
      organizationId,
    };
  }

  if (operation === "create") {
    nextArgs.data = {
      ...((nextArgs.data as QueryArgs | undefined) ?? {}),
      organizationId,
    };
  }

  if (operation === "createMany") {
    const data = nextArgs.data as QueryArgs[] | QueryArgs | undefined;
    nextArgs.data = Array.isArray(data)
      ? data.map((item) => ({ ...item, organizationId }))
      : { ...(data ?? {}), organizationId };
  }

  // Never let an update payload move a row to a different organization.
  if (operation === "update" || operation === "updateMany") {
    nextArgs.data = withoutOrganizationId(nextArgs.data as QueryArgs | undefined);
  }

  if (operation === "upsert") {
    nextArgs.where = {
      ...((nextArgs.where as QueryArgs | undefined) ?? {}),
      organizationId,
    };
    nextArgs.create = {
      ...((nextArgs.create as QueryArgs | undefined) ?? {}),
      organizationId,
    };
    nextArgs.update = withoutOrganizationId(nextArgs.update as QueryArgs | undefined);
  }

  return nextArgs;
}

function createBaseClient() {
  const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  return new PrismaClient(url ? { datasourceUrl: url } : undefined);
}

const CREATE_OPERATIONS = new Set(["create", "createMany"]);

function extendWithTenantContext(client: PrismaClient) {
  return client.$extends({
    name: "tenant-context",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const context = tenantStorage.getStore();
          if (!context) {
            // `create`/`createMany` are the one documented exception: the
            // Prisma schema already requires `organizationId` as a scalar
            // field on both tenant-scoped models, so TypeScript refuses to
            // compile a create call that omits it, and this is the only
            // path a new organization's very first Membership can be
            // created on (registerAction, T4.2) -- there is no existing
            // tenant session to derive a context from yet. Every other
            // operation (reads, updates, deletes) has no such bootstrap
            // case and always requires withTenant().
            if (CREATE_OPERATIONS.has(operation)) {
              const data = (args as QueryArgs | undefined)?.data;
              const rows = Array.isArray(data) ? data : [data];
              const missingOrgId = rows.some(
                (row) => !(row as QueryArgs | undefined)?.organizationId
              );
              if (missingOrgId) {
                throw new Error(
                  `Tenant-scoped model "${model}" created outside withTenant() must set organizationId explicitly. ` +
                    "See .agents/rules/tenant-isolation.md."
                );
              }
              return query(args);
            }

            throw new Error(
              `Tenant-scoped model "${model}" was queried outside withTenant(). ` +
                "See .agents/rules/tenant-isolation.md."
            );
          }

          return query(applyTenantScope(operation, args as QueryArgs, context.organizationId));
        },
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof extendWithTenantContext>;
};

/**
 * Tenant-aware Prisma Client. Safe to import and use directly for
 * non-tenant-scoped models (`Organization`, `User`). Tenant-scoped models
 * (`Membership`, `Professional`) must only be queried inside `withTenant`.
 */
export const db = globalForPrisma.prisma ?? extendWithTenantContext(createBaseClient());

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

export type TenantScopedClient = typeof db;

/**
 * Runs `callback` inside a transaction scoped to `context.organizationId`:
 * - Sets the Postgres session variable `app.current_org_id` via
 *   `SET LOCAL` (through `set_config`, parameterized to avoid injection),
 *   which the RLS policies on `memberships`/`professionals` read directly,
 *   so RLS holds even if the Prisma extension above is ever bypassed.
 * - Scopes the AsyncLocalStorage store for the duration of the callback, so
 *   the extension above injects `organizationId` into every tenant-scoped
 *   query issued through the client passed into `callback`.
 */
export async function withTenant<T>(
  context: TenantContext,
  callback: (tx: TenantScopedClient) => Promise<T>
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${context.organizationId}, true)`;
    // `callback` is awaited *inside* `run()`, not merely returned from it:
    // Prisma's query methods return a lazily-executed thenable that only
    // dispatches (and only then reaches the extension's $allOperations
    // below) once awaited. Returning that thenable from `run()` without
    // awaiting it would let the eventual `.then()` fire outside the
    // AsyncLocalStorage scope, so `tenantStorage.getStore()` would see
    // nothing by the time the extension runs.
    return tenantStorage.run(context, async () => {
      return await callback(tx as unknown as TenantScopedClient);
    });
  });
}
