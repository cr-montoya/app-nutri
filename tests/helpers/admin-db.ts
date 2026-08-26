import { PrismaClient } from "@prisma/client";

/**
 * Test-only client connected as the table-owning migration role
 * (`DATABASE_URL`), which bypasses RLS. Integration tests use this only for
 * fixture teardown across organizations -- never for the assertions under
 * test, which must go through `withTenant`/`APP_DATABASE_URL` so RLS and the
 * tenant-context extension are actually exercised.
 */
export const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
