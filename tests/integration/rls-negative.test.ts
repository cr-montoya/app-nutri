import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminDb } from "../helpers/admin-db";

/**
 * Negative RLS test (T2.6, closes REQ-013): a raw `pg` client -- bypassing
 * Prisma and the `withTenant` extension entirely -- with
 * `app.current_org_id` set to org A must still get zero rows querying org
 * B's `memberships`/`professionals` directly. This is what proves RLS
 * itself (not just the Prisma Client Extension) is the enforcement layer,
 * per .kiro/specs/phase-0-scaffold/design.md's "RLS policy" section.
 */

const runId = Date.now();

let orgA: { id: string };
let orgB: { id: string };
let userA: { id: string };
let userB: { id: string };
let membershipA: { id: string };
let membershipB: { id: string };

beforeAll(async () => {
  orgA = await adminDb.organization.create({
    data: { name: "RLS Negative Org A", slug: `rls-negative-org-a-${runId}` },
  });
  orgB = await adminDb.organization.create({
    data: { name: "RLS Negative Org B", slug: `rls-negative-org-b-${runId}` },
  });
  userA = await adminDb.user.create({
    data: { email: `rls-negative-a-${runId}@example.test`, passwordHash: "x", name: "User A" },
  });
  userB = await adminDb.user.create({
    data: { email: `rls-negative-b-${runId}@example.test`, passwordHash: "x", name: "User B" },
  });
  membershipA = await adminDb.membership.create({
    data: { userId: userA.id, organizationId: orgA.id, role: "ADMIN" },
  });
  membershipB = await adminDb.membership.create({
    data: { userId: userB.id, organizationId: orgB.id, role: "ADMIN" },
  });
  await adminDb.professional.create({
    data: { membershipId: membershipA.id, organizationId: orgA.id, licenseNumber: "LIC-A" },
  });
  await adminDb.professional.create({
    data: { membershipId: membershipB.id, organizationId: orgB.id, licenseNumber: "LIC-B" },
  });
});

afterAll(async () => {
  await adminDb.professional.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await adminDb.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await adminDb.$disconnect();
});

async function queryAsOrg(organizationId: string, sql: string, params: string[]) {
  // Raw `pg`, not Prisma: the non-superuser appnutri_app role, which is the
  // role RLS policies actually apply to (see tasks.md T2.3's note on the
  // owner role bypassing RLS).
  const client = new Client({ connectionString: process.env.APP_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [organizationId]);
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return result.rows;
  } finally {
    await client.end();
  }
}

describe("Raw pg client: negative RLS", () => {
  it("returns zero memberships rows for org B when scoped to org A", async () => {
    const rows = await queryAsOrg(orgA.id, "SELECT * FROM memberships WHERE id = $1", [membershipB.id]);
    expect(rows).toHaveLength(0);
  });

  it("returns zero professionals rows for org B when scoped to org A", async () => {
    const rows = await queryAsOrg(
      orgA.id,
      'SELECT * FROM professionals WHERE "membershipId" = $1',
      [membershipB.id]
    );
    expect(rows).toHaveLength(0);
  });

  it("still returns org A's own rows when scoped to org A (RLS isn't blocking everything)", async () => {
    const rows = await queryAsOrg(orgA.id, "SELECT * FROM memberships WHERE id = $1", [membershipA.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(orgA.id);
  });

  it("returns zero rows for either org with no app.current_org_id set at all", async () => {
    const client = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query("SELECT * FROM memberships WHERE id IN ($1, $2)", [
        membershipA.id,
        membershipB.id,
      ]);
      expect(result.rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });
});
